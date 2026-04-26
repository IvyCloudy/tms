import * as vscode from 'vscode';
import { Api, ApiError } from './api';

export interface Task {
    id: string;
    code: string;
    name: string;
    statusClass: string;
    statusText: string;
    owner: string;
    progress?: number;
    startDate?: string;
    endDate?: string;
    desc?: string;
}

export interface TaskChangeEvent {
    from: Task | null;
    to: Task;
}

export interface TaskListChangeEvent {
    tasks: Task[];
    fromCache: boolean;
    offline: boolean;
}

const STATE_KEY_CURRENT = 'tms.currentTaskId';
const STATE_KEY_TASKS = 'tms.cachedTasks';

/** 内置兜底数据：API 不可达 + 无缓存时使用，保证首启可用 */
const FALLBACK_TASKS: Task[] = [
    { id: 'T001', code: 'T-2026-001', name: '支付中心重构测试',          statusClass: 'status-exec',   statusText: '执行中', owner: '张小明' },
    { id: 'T002', code: 'T-2026-002', name: '会员体系 H5 新增优惠券模块', statusClass: 'status-design', statusText: '设计中', owner: '李工程师' },
    { id: 'T003', code: 'T-2026-003', name: '商品搜索算法优化回归测试',   statusClass: 'status-review', statusText: '评审中', owner: '王测试' },
    { id: 'T004', code: 'T-2026-004', name: '订单履约系统性能测试',       statusClass: 'status-exec',   statusText: '执行中', owner: '赵架构师' },
    { id: 'T005', code: 'T-2026-005', name: '消息推送服务国际化改造',     statusClass: 'status-exec',   statusText: '执行中', owner: '孙小红' },
    { id: 'T006', code: 'T-2026-006', name: '用户登录安全增强验收',       statusClass: 'status-done',   statusText: '已完成', owner: '周小刚' }
];

/**
 * 任务状态：首屏使用缓存秒开，后台异步拉取 API 刷新
 */
export class TaskState {
    private tasks: Task[] = [];
    private offline = false;

    private readonly _onChange = new vscode.EventEmitter<TaskChangeEvent>();
    public readonly onChange = this._onChange.event;

    private readonly _onListChange = new vscode.EventEmitter<TaskListChangeEvent>();
    public readonly onListChange = this._onListChange.event;

    constructor(private readonly context: vscode.ExtensionContext) {
        // 首屏：优先读取持久化缓存；没有缓存则用 FALLBACK，避免空白
        const cached = this.context.globalState.get<Task[]>(STATE_KEY_TASKS);
        this.tasks = (cached && cached.length ? cached : FALLBACK_TASKS).slice();
    }

    /** 启动时主动触发首次 API 拉取（异步，不阻塞 UI） */
    async bootstrap(): Promise<void> {
        await this.refreshFromApi(true);
    }

    /** 向外广播一次当前列表状态（供新订阅者拿到初始数据） */
    emitInitial(): void {
        this._onListChange.fire({ tasks: this.getAll(), fromCache: true, offline: this.offline });
    }

    isOffline(): boolean {
        return this.offline;
    }

    getAll(): Task[] {
        return this.tasks.slice();
    }

    findById(id: string): Task | null {
        return this.tasks.find(t => t.id === id) || null;
    }

    getCurrentId(): string {
        const id = this.context.globalState.get<string>(STATE_KEY_CURRENT);
        if (id && this.findById(id)) return id;
        return this.tasks[0]?.id || '';
    }

    getCurrent(): Task | null {
        return this.findById(this.getCurrentId());
    }

    async setCurrent(id: string): Promise<boolean> {
        const to = this.findById(id);
        if (!to) return false;
        const fromId = this.getCurrentId();
        if (fromId === id) return false;
        const from = this.findById(fromId);
        await this.context.globalState.update(STATE_KEY_CURRENT, id);
        this._onChange.fire({ from, to });
        return true;
    }

    /**
     * 从 API 拉取任务列表
     * @param silent true = 失败时不弹提示，仅写日志
     */
    async refreshFromApi(silent = false): Promise<boolean> {
        try {
            const resp = await Api.listTasks();
            if (resp && Array.isArray(resp.list) && resp.list.length > 0) {
                this.tasks = resp.list;
                await this.context.globalState.update(STATE_KEY_TASKS, this.tasks);
                this.offline = false;
                this._onListChange.fire({ tasks: this.getAll(), fromCache: false, offline: false });

                // 若当前选中的任务被后端删了，回退到第一个
                const curId = this.context.globalState.get<string>(STATE_KEY_CURRENT);
                if (curId && !this.findById(curId) && this.tasks[0]) {
                    await this.setCurrent(this.tasks[0].id);
                }
                return true;
            }
            return false;
        } catch (e) {
            this.offline = true;
            this._onListChange.fire({ tasks: this.getAll(), fromCache: true, offline: true });
            const msg = e instanceof ApiError ? `[${e.kind}] ${e.message}` : String(e);
            console.warn('[TMS] refreshFromApi failed:', msg);
            if (!silent) {
                vscode.window.showWarningMessage(`无法连接后端，使用本地缓存数据。${msg}`);
            }
            return false;
        }
    }
}
