import { apiGet, apiSend } from './http';
import type { Task } from '../TaskState';

export interface TaskListResp {
    total: number;
    list: Task[];
}

/**
 * 扩展进程中统一的后端调用入口。
 * 读接口（list/get）走 apiGet；写接口（create/update/delete/transition）走 apiSend。
 * Webview 通过 postMessage 的 api-call 命令间接使用这些方法。
 */
export const Api = {
    // ============ Tasks ============
    listTasks: (keyword?: string, status?: string) =>
        apiGet<TaskListResp>('/api/tasks', { keyword, status }),

    getTask: (id: string) => apiGet<Task>(`/api/tasks/${encodeURIComponent(id)}`),

    createTask: (payload: Partial<Task> & { id: string }) =>
        apiSend<Task>('POST', '/api/tasks', payload),

    updateTask: (id: string, patch: Partial<Task>) =>
        apiSend<Task>('PUT', `/api/tasks/${encodeURIComponent(id)}`, patch),

    deleteTask: (id: string) =>
        apiSend<Task>('DELETE', `/api/tasks/${encodeURIComponent(id)}`),

    // ============ Task Stages (任务详情-编辑阶段) ============
    listStages: (taskId: string) =>
        apiGet<Record<string, Record<string, any>>>(`/api/tasks/${encodeURIComponent(taskId)}/stages`),

    updateStage: (taskId: string, subId: string, stageKey: string, patch: any) =>
        apiSend<any>(
            'PUT',
            `/api/tasks/${encodeURIComponent(taskId)}/stages/${encodeURIComponent(subId)}/${encodeURIComponent(stageKey)}`,
            patch
        ),

    // ============ Workbench ============
    workbenchSummary: (taskId: string) =>
        apiGet<{ summary: any; todo: any[] }>('/api/workbench/summary', { taskId }),

    // ============ Cases ============
    listCases: (taskId: string, opts?: { status?: string; keyword?: string; page?: number; pageSize?: number }) =>
        apiGet<{ total: number; page: number; pageSize: number; list: any[] }>('/api/cases', {
            taskId,
            status: opts?.status,
            keyword: opts?.keyword,
            page: opts?.page,
            pageSize: opts?.pageSize
        }),

    createCase: (taskId: string, payload: any) =>
        apiSend<any>('POST', '/api/cases', payload, { taskId }),

    updateCase: (taskId: string, id: string, patch: any) =>
        apiSend<any>('PUT', `/api/cases/${encodeURIComponent(id)}`, patch, { taskId }),

    deleteCase: (taskId: string, id: string) =>
        apiSend<any>('DELETE', `/api/cases/${encodeURIComponent(id)}`, undefined, { taskId }),

    executeCase: (taskId: string, id: string, payload: { result: string; duration?: number; remark?: string }) =>
        apiSend<any>('POST', `/api/cases/${encodeURIComponent(id)}/execute`, payload, { taskId }),

    // ============ Defects ============
    listDefects: (taskId: string, opts?: { status?: string; severity?: string }) =>
        apiGet<{ total: number; list: any[] }>('/api/defects', { taskId, ...opts }),

    createDefect: (taskId: string, payload: any) =>
        apiSend<any>('POST', '/api/defects', payload, { taskId }),

    updateDefect: (taskId: string, id: string, patch: any) =>
        apiSend<any>('PUT', `/api/defects/${encodeURIComponent(id)}`, patch, { taskId }),

    deleteDefect: (taskId: string, id: string) =>
        apiSend<any>('DELETE', `/api/defects/${encodeURIComponent(id)}`, undefined, { taskId }),

    transitionDefect: (taskId: string, id: string, to: string, comment?: string) =>
        apiSend<any>('POST', `/api/defects/${encodeURIComponent(id)}/transition`, { to, comment }, { taskId }),

    // ============ Reviews ============
    listReviews: (taskId: string) =>
        apiGet<{ total: number; list: any[] }>('/api/reviews', { taskId }),

    createReview: (taskId: string, payload: any) =>
        apiSend<any>('POST', '/api/reviews', payload, { taskId }),

    updateReview: (taskId: string, id: string, patch: any) =>
        apiSend<any>('PUT', `/api/reviews/${encodeURIComponent(id)}`, patch, { taskId }),

    deleteReview: (taskId: string, id: string) =>
        apiSend<any>('DELETE', `/api/reviews/${encodeURIComponent(id)}`, undefined, { taskId }),

    transitionReview: (taskId: string, id: string, to: string, comment?: string) =>
        apiSend<any>('POST', `/api/reviews/${encodeURIComponent(id)}/transition`, { to, comment }, { taskId }),

    // ============ Reports ============
    listReports: (taskId: string) =>
        apiGet<{ total: number; list: any[] }>('/api/reports', { taskId }),

    createReport: (taskId: string, payload: any) =>
        apiSend<any>('POST', '/api/reports', payload, { taskId }),

    updateReport: (taskId: string, id: string, patch: any) =>
        apiSend<any>('PUT', `/api/reports/${encodeURIComponent(id)}`, patch, { taskId }),

    deleteReport: (taskId: string, id: string) =>
        apiSend<any>('DELETE', `/api/reports/${encodeURIComponent(id)}`, undefined, { taskId })
};

export { ApiError } from './http';
