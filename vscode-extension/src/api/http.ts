import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

/** 统一的错误类型 */
export class ApiError extends Error {
    constructor(
        public readonly kind: 'network' | 'timeout' | 'http' | 'business' | 'parse',
        message: string,
        public readonly status?: number,
        public readonly bizCode?: number
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

function getConfig() {
    const cfg = vscode.workspace.getConfiguration('tms.api');
    return {
        baseUrl: (cfg.get<string>('baseUrl') || 'http://localhost:3001').replace(/\/+$/, ''),
        timeout: cfg.get<number>('timeout') || 8000,
        retry: cfg.get<number>('retry') ?? 1
    };
}

export interface ApiResp<T> {
    code: number;
    data: T;
    msg: string;
}

/** 发起 GET 请求（纯 Node，无三方依赖） */
export async function apiGet<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    return apiRequest<T>('GET', path, undefined, query);
}

/**
 * 发起写请求（POST/PUT/DELETE/PATCH）
 *   body 传 JSON 对象；DELETE 可不传
 */
export async function apiSend<T>(
    method: 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    body?: any,
    query?: Record<string, string | number | undefined>
): Promise<T> {
    return apiRequest<T>(method, path, body, query);
}

async function apiRequest<T>(
    method: string,
    path: string,
    body: any,
    query?: Record<string, string | number | undefined>
): Promise<T> {
    const { baseUrl, timeout, retry } = getConfig();
    const url = new URL(path, baseUrl + '/');
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
        }
    }
    let lastErr: unknown;
    for (let i = 0; i <= retry; i++) {
        try {
            return await requestOnce<T>(method, url, timeout, body);
        } catch (e) {
            lastErr = e;
            // 只对网络/超时错误重试
            if (e instanceof ApiError && (e.kind === 'network' || e.kind === 'timeout')) continue;
            throw e;
        }
    }
    throw lastErr;
}

function requestOnce<T>(method: string, url: URL, timeout: number, body?: any): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const mod = url.protocol === 'https:' ? https : http;
        const payload = body != null ? Buffer.from(JSON.stringify(body), 'utf8') : null;
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (payload) {
            headers['Content-Type'] = 'application/json; charset=utf-8';
            headers['Content-Length'] = String(payload.length);
        }
        const req = mod.request(
            {
                method,
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                headers,
                timeout
            },
            res => {
                const chunks: Buffer[] = [];
                res.on('data', c => chunks.push(Buffer.from(c)));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    const status = res.statusCode || 0;
                    if (status < 200 || status >= 300) {
                        return reject(new ApiError('http', `HTTP ${status}: ${text.slice(0, 200)}`, status));
                    }
                    try {
                        const bodyResp = JSON.parse(text) as ApiResp<T>;
                        if (bodyResp.code !== 0) {
                            return reject(new ApiError('business', bodyResp.msg || '业务错误', status, bodyResp.code));
                        }
                        resolve(bodyResp.data);
                    } catch (e) {
                        reject(new ApiError('parse', '响应解析失败: ' + (e as Error).message, status));
                    }
                });
            }
        );
        req.on('timeout', () => {
            req.destroy();
            reject(new ApiError('timeout', `请求超时 ${timeout}ms`));
        });
        req.on('error', e => reject(new ApiError('network', e.message)));
        if (payload) req.write(payload);
        req.end();
    });
}
