import * as vscode from 'vscode';
import { SidebarProvider } from './SidebarProvider';
import { MainPanel, PageKey } from './MainPanel';
import { TaskState } from './TaskState';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
    // 1. 初始化全局状态管理（内部已用缓存数据完成首屏兜底）
    const taskState = new TaskState(context);

    // 2. 注册侧边栏 WebviewView
    const sidebarProvider = new SidebarProvider(context, taskState);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('tms.sidebarView', sidebarProvider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // 3. StatusBar 状态栏：显示当前任务，点击可快速切换
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = 'tms.switchTask';
    statusBarItem.tooltip = '点击切换当前测试任务';
    context.subscriptions.push(statusBarItem);
    refreshStatusBar(taskState);

    // 任务变化时刷新状态栏 + 通知 Panel + 通知 Sidebar
    taskState.onChange((ev) => {
        refreshStatusBar(taskState);
        MainPanel.broadcastTaskChange(ev);
        sidebarProvider.broadcastTaskChange(ev);
    });

    // 任务列表变化（来自 API）：刷新状态栏显示 + 通知 Sidebar 重绘
    taskState.onListChange(() => {
        refreshStatusBar(taskState);
        sidebarProvider.refreshTaskList?.();
    });

    // 4. 注册各页面打开命令
    const pageMap: { cmd: string; key: PageKey; title: string }[] = [
        { cmd: 'tms.openWorkbench',  key: 'workbench',   title: '工作台' },
        { cmd: 'tms.openTaskList',   key: 'task-list',   title: '测试任务' },
        { cmd: 'tms.openTaskDetail', key: 'task-detail', title: '任务详情' },
        { cmd: 'tms.openDesign',     key: 'design',      title: '设计管理' },
        { cmd: 'tms.openExecution',  key: 'execution',   title: '执行管理' },
        { cmd: 'tms.openDefect',     key: 'defect',      title: '缺陷管理' },
        { cmd: 'tms.openReport',     key: 'report',      title: '测试报告' },
        { cmd: 'tms.openReview',     key: 'review',      title: '评审管理' }
    ];
    pageMap.forEach(p => {
        context.subscriptions.push(
            vscode.commands.registerCommand(p.cmd, () => {
                MainPanel.show(context, taskState, p.key, p.title);
            })
        );
    });

    // 5. 切换任务命令（QuickPick）
    context.subscriptions.push(
        vscode.commands.registerCommand('tms.switchTask', async () => {
            const tasks = taskState.getAll();
            const cur = taskState.getCurrentId();
            const items: vscode.QuickPickItem[] = tasks.map(t => ({
                label: `${t.id === cur ? '$(check) ' : '   '}${t.name}`,
                description: t.code,
                detail: `负责人：${t.owner}　状态：${t.statusText}`
            }));
            const picked = await vscode.window.showQuickPick(items, {
                placeHolder: '选择要切换的测试任务',
                matchOnDescription: true,
                matchOnDetail: true
            });
            if (!picked) return;
            const idx = items.indexOf(picked);
            taskState.setCurrent(tasks[idx].id);
        })
    );

    // 6. 手动刷新数据（从 mock/后端重新拉取）
    context.subscriptions.push(
        vscode.commands.registerCommand('tms.refreshData', async () => {
            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Window, title: '正在刷新任务列表…' },
                async () => {
                    const ok = await taskState.refreshFromApi(false);
                    if (ok) vscode.window.setStatusBarMessage('任务列表已更新', 2000);
                }
            );
        })
    );

    // 7. 快速修改后端地址
    context.subscriptions.push(
        vscode.commands.registerCommand('tms.setApiBaseUrl', async () => {
            const cfg = vscode.workspace.getConfiguration('tms.api');
            const current = cfg.get<string>('baseUrl') || 'http://localhost:3001';
            const input = await vscode.window.showInputBox({
                prompt: '设置 TMS 后端 Base URL',
                value: current,
                placeHolder: 'http://localhost:3001'
            });
            if (!input) return;
            await cfg.update('baseUrl', input, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage(`已更新后端地址：${input}`);
            await taskState.refreshFromApi(false);
        })
    );

    // 8. 启动：异步拉取一次后端数据（不阻塞 UI）
    taskState.bootstrap();

    // 9. 启动后默认展示工作台
    vscode.commands.executeCommand('tms.openWorkbench');
}

function refreshStatusBar(state: TaskState) {
    const t = state.getCurrent();
    if (!t) {
        statusBarItem.hide();
        return;
    }
    const offlineTag = state.isOffline() ? ' $(warning)' : '';
    statusBarItem.text = `$(checklist) ${t.name}${offlineTag}`;
    statusBarItem.tooltip = state.isOffline()
        ? '⚠ 后端不可达，当前使用本地缓存。点击切换任务；可通过命令「tms.refreshData」重试'
        : '点击切换当前测试任务';
    statusBarItem.show();
}

export function deactivate() {}
