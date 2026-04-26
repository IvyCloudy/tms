import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TaskState, TaskChangeEvent } from './TaskState';
import { Api, ApiError } from './api';

export type PageKey =
    | 'workbench'
    | 'task-list'
    | 'task-detail'
    | 'design'
    | 'execution'
    | 'defect'
    | 'report'
    | 'review';

const PAGE_TITLES: Record<PageKey, string> = {
    'workbench':   '工作台',
    'task-list':   '测试任务',
    'task-detail': '任务详情',
    'design':      '设计管理',
    'execution':   '执行管理',
    'defect':      '缺陷管理',
    'report':      '测试报告',
    'review':      '评审管理'
};

/** Tab 图标文件名（位于 resources/nav/），与侧边栏菜单 iconSvg key 对应 */
const PAGE_ICON_FILES: Record<PageKey, string> = {
    'workbench':   'workbench.svg',
    'task-list':   'tasks.svg',
    'task-detail': 'task-detail.svg',
    'design':      'design.svg',
    'execution':   'execution.svg',
    'defect':      'defect.svg',
    'report':      'report.svg',
    'review':      'review.svg'
};

/**
 * 主区 WebviewPanel：单 Panel 路由切换；切换页面时直接替换 html
 */
export class MainPanel {
    private static instance: MainPanel | undefined;

    public static currentPage(): PageKey | null {
        return MainPanel.instance ? MainPanel.instance.currentKey : null;
    }

    public static broadcastTaskChange(ev: TaskChangeEvent) {
        if (!MainPanel.instance) return;
        MainPanel.instance.panel.webview.postMessage({
            type: 'task-change',
            payload: ev
        });
    }

    public static show(
        context: vscode.ExtensionContext,
        state: TaskState,
        key: PageKey,
        title: string
    ) {
        if (MainPanel.instance) {
            MainPanel.instance.switchTo(key);
            MainPanel.instance.panel.reveal(vscode.ViewColumn.One);
            return;
        }
        MainPanel.instance = new MainPanel(context, state, key, title);
    }

    private readonly panel: vscode.WebviewPanel;
    private currentKey: PageKey;
    /** 原型 HTML 所在根目录（仓库的 prd/测试任务管理/） */
    private readonly protoRoot: vscode.Uri;
    private readonly disposables: vscode.Disposable[] = [];

    private constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly state: TaskState,
        key: PageKey,
        _title: string
    ) {
        this.currentKey = key;
        // extensionUri = .../vscode-extension/，原型在 ../prd/测试任务管理/
        this.protoRoot = vscode.Uri.joinPath(context.extensionUri, '..', 'prd', '测试任务管理');

        this.panel = vscode.window.createWebviewPanel(
            'tms.mainPanel',
            PAGE_TITLES[key],
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this.protoRoot, context.extensionUri]
            }
        );
        this.panel.iconPath = this.iconFor(key);

        this.panel.webview.html = this.renderPage(key);

        // 接收 Webview → Extension 消息
        this.panel.webview.onDidReceiveMessage(
            (msg) => this.handleMessage(msg),
            null,
            this.disposables
        );

        // 初次渲染后把当前任务主动推送给页面，使筛选条对齐
        const all = this.state.getAll();
        const curId = this.state.getCurrentId();
        const to = all.find(t => t.id === curId) || all[0];
        if (to) {
            setTimeout(() => {
                this.panel.webview.postMessage({
                    type: 'task-change',
                    payload: { from: null, to }
                });
            }, 150);
        }

        // 销毁
        this.panel.onDidDispose(
            () => {
                MainPanel.instance = undefined;
                this.disposables.forEach(d => d.dispose());
            },
            null,
            this.disposables
        );
    }

    private switchTo(key: PageKey) {
        this.currentKey = key;
        this.panel.title = PAGE_TITLES[key];
        this.panel.iconPath = this.iconFor(key);
        this.panel.webview.html = this.renderPage(key);
        // 新页面加载后主动下发一次当前任务，确保 selSubtask/selStage/selRound
        // 立即对齐侧边栏选中的任务（否则会沿用原型 localStorage 里的旧 id）
        const all = this.state.getAll();
        const curId = this.state.getCurrentId();
        const to = all.find(t => t.id === curId) || all[0];
        if (to) {
            // 延迟一拍，等待原型脚本（tms-global-task.js）加载并初始化 TMSGlobal
            setTimeout(() => {
                this.panel.webview.postMessage({
                    type: 'task-change',
                    payload: { from: null, to }
                });
            }, 150);
        }
    }

    private async handleMessage(msg: any) {
        if (!msg || !msg.type) return;
        switch (msg.type) {
            case 'navigate': {
                // 侧边菜单或链接跳转：msg.page 形如 'proto-defect.html' 或 'defect'
                const key = normalizePageKey(msg.page);
                if (key) {
                    this.switchTo(key);
                }
                return;
            }
            case 'set-task': {
                if (msg.taskId && msg.taskId !== this.state.getCurrentId()) {
                    await this.state.setCurrent(msg.taskId);
                }
                return;
            }
            case 'request-task-state': {
                this.panel.webview.postMessage({
                    type: 'task-state',
                    payload: {
                        all: this.state.getAll(),
                        currentId: this.state.getCurrentId()
                    }
                });
                return;
            }
            case 'open-external': {
                if (msg.url) vscode.env.openExternal(vscode.Uri.parse(msg.url));
                return;
            }
            case 'toast': {
                if (msg.message) vscode.window.showInformationMessage(String(msg.message));
                return;
            }
            case 'api-call': {
                await this.handleApiCall(msg);
                return;
            }
        }
    }

    /**
     * Webview → 扩展：请求后端 API
     * Webview 内因 CSP + 端口限制不能直连本地 HTTP，所以统一由扩展代理
     * 请求结构：{ type:'api-call', id:string, name:string, params?:any }
     * 响应结构：{ type:'api-result', id, ok:boolean, data?:any, error?:string }
     */
    private async handleApiCall(msg: any) {
        const id: string = msg.id;
        const name: string = msg.name;
        const params = msg.params || {};
        const reply = (payload: any) => this.panel.webview.postMessage({
            type: 'api-result',
            id,
            ...payload
        });
        try {
            let data: any;
            switch (name) {
                case 'listTasks':
                    data = await Api.listTasks(params.keyword, params.status);
                    break;
                case 'getTask':
                    data = await Api.getTask(params.id);
                    break;
                case 'workbenchSummary':
                    data = await Api.workbenchSummary(params.taskId || this.state.getCurrentId());
                    break;
                case 'listCases':
                    data = await Api.listCases(params.taskId || this.state.getCurrentId(), params);
                    break;
                case 'listDefects':
                    data = await Api.listDefects(params.taskId || this.state.getCurrentId(), params);
                    break;
                case 'listReports':
                    data = await Api.listReports(params.taskId || this.state.getCurrentId());
                    break;
                case 'listReviews':
                    data = await Api.listReviews(params.taskId || this.state.getCurrentId());
                    break;

                /* ---------------- 写操作（B+ 阶段） ---------------- */
                /* Tasks */
                case 'createTask':
                    data = await Api.createTask(params.payload);
                    break;
                case 'updateTask':
                    data = await Api.updateTask(params.id, params.patch || {});
                    break;
                case 'deleteTask':
                    data = await Api.deleteTask(params.id);
                    break;

                /* Task Stages（任务详情-编辑阶段） */
                case 'listStages':
                    data = await Api.listStages(params.taskId || this.state.getCurrentId());
                    break;
                case 'updateStage':
                    data = await Api.updateStage(
                        params.taskId || this.state.getCurrentId(),
                        params.subId,
                        params.stageKey,
                        params.patch || {}
                    );
                    break;

                /* Cases */
                case 'createCase':
                    data = await Api.createCase(params.taskId || this.state.getCurrentId(), params.payload);
                    break;
                case 'updateCase':
                    data = await Api.updateCase(params.taskId || this.state.getCurrentId(), params.id, params.patch || {});
                    break;
                case 'deleteCase':
                    data = await Api.deleteCase(params.taskId || this.state.getCurrentId(), params.id);
                    break;
                case 'executeCase':
                    data = await Api.executeCase(params.taskId || this.state.getCurrentId(), params.id, params.payload || { result: 'passed' });
                    break;

                /* Defects */
                case 'createDefect':
                    data = await Api.createDefect(params.taskId || this.state.getCurrentId(), params.payload);
                    break;
                case 'updateDefect':
                    data = await Api.updateDefect(params.taskId || this.state.getCurrentId(), params.id, params.patch || {});
                    break;
                case 'deleteDefect':
                    data = await Api.deleteDefect(params.taskId || this.state.getCurrentId(), params.id);
                    break;
                case 'transitionDefect':
                    data = await Api.transitionDefect(params.taskId || this.state.getCurrentId(), params.id, params.to, params.comment);
                    break;

                /* Reviews */
                case 'createReview':
                    data = await Api.createReview(params.taskId || this.state.getCurrentId(), params.payload);
                    break;
                case 'updateReview':
                    data = await Api.updateReview(params.taskId || this.state.getCurrentId(), params.id, params.patch || {});
                    break;
                case 'deleteReview':
                    data = await Api.deleteReview(params.taskId || this.state.getCurrentId(), params.id);
                    break;
                case 'transitionReview':
                    data = await Api.transitionReview(params.taskId || this.state.getCurrentId(), params.id, params.to, params.comment);
                    break;

                /* Reports */
                case 'createReport':
                    data = await Api.createReport(params.taskId || this.state.getCurrentId(), params.payload);
                    break;
                case 'updateReport':
                    data = await Api.updateReport(params.taskId || this.state.getCurrentId(), params.id, params.patch || {});
                    break;
                case 'deleteReport':
                    data = await Api.deleteReport(params.taskId || this.state.getCurrentId(), params.id);
                    break;

                default:
                    return reply({ ok: false, error: 'unknown api: ' + name });
            }
            reply({ ok: true, data });
        } catch (e) {
            const err = e instanceof ApiError ? `[${e.kind}] ${e.message}` : String(e);
            reply({ ok: false, error: err });
        }
    }

    /**
     * 返回当前 PageKey 对应的 Tab 图标 URI（与侧边栏菜单图标保持一致）。
     * 使用 { light, dark } 对象形式，VSCode 会根据当前主题自动选择：
     *  - light/*.svg：深灰描边（#424242），适配浅色主题
     *  - dark/*.svg： 浅灰描边（#C5C5C5），适配深色主题
     * 与 VSCode 内置 codicon 的着色规范保持一致，避免描边与背景同色不可见。
     */
    private iconFor(key: PageKey): { light: vscode.Uri; dark: vscode.Uri } {
        const file = PAGE_ICON_FILES[key];
        return {
            light: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'nav', 'light', file),
            dark:  vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'nav', 'dark',  file)
        };
    }

    private renderPage(key: PageKey): string {
        const filename = `proto-${key}.html`;
        const htmlPath = path.join(this.protoRoot.fsPath, filename);
        if (!fs.existsSync(htmlPath)) {
            return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px"><h2>未找到原型文件</h2><p>${escapeHtml(htmlPath)}</p></body></html>`;
        }
        let html = fs.readFileSync(htmlPath, 'utf-8');
        return transformHtml(html, this.panel.webview, this.protoRoot, key);
    }
}

/* =============== HTML 转换：把相对资源路径与跳转改造为 Webview 兼容 =============== */

function normalizePageKey(input: string | undefined): PageKey | null {
    if (!input) return null;
    let s = String(input).trim().toLowerCase();
    s = s.replace(/^\.\//, '').replace(/\.html.*$/, '').replace(/^proto-/, '');
    const allow: PageKey[] = ['workbench', 'task-list', 'task-detail', 'design', 'execution', 'defect', 'report', 'review'];
    return allow.includes(s as PageKey) ? (s as PageKey) : null;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
}

/**
 * 将原型 HTML 适配 Webview：
 * 1. <link href="xxx.css">、<script src="xxx.js"> 转 webview.asWebviewUri
 * 2. 注入 CSP <meta>
 * 3. 注入桥接脚本，劫持 <a href="proto-xxx.html"> 改为 postMessage('navigate')
 * 4. 注入 acquireVsCodeApi 适配层（替换原型中的 localStorage 跨标签同步）
 */
function transformHtml(
    html: string,
    webview: vscode.Webview,
    protoRoot: vscode.Uri,
    currentKey: PageKey
): string {
    // 替换相对 css/js 引用
    const replaceAttr = (regex: RegExp) => {
        html = html.replace(regex, (_m, prefix, url, suffix) => {
            // 跳过绝对 URL
            if (/^(https?:|data:|vscode-webview-resource:|\/\/)/i.test(url)) {
                return _m;
            }
            const fileUri = vscode.Uri.joinPath(protoRoot, url);
            const wvUri = webview.asWebviewUri(fileUri);
            return `${prefix}${wvUri}${suffix}`;
        });
    };
    replaceAttr(/(<link[^>]+href=")([^"]+)(")/gi);
    replaceAttr(/(<script[^>]+src=")([^"]+)(")/gi);
    replaceAttr(/(<img[^>]+src=")([^"]+)(")/gi);

    // 隐藏原型中的"左侧菜单"与"任务切换器"——侧边栏 WebviewView 已承载这两项能力，
    // 主区不再重复展示。注意：**不能**用正则去剥离 DOM，因为原型里 .side-menu 内部有
    // 嵌套 <div class="menu-item active">...</div>，非贪婪正则会误吃嵌套的 </div>，
    // 导致 DOM 破损、页面错位；贪婪正则又会吃掉后面所有兄弟节点。
    // 正确做法：保留原 DOM 不动，仅用 CSS display:none 隐藏（不占空间、不破坏布局），
    // 同时脚本仍可访问 #taskSwitcher 内部节点（便于未来联动读取当前任务状态）。

    // 注入 CSP（尽可能宽松，便于内联脚本与样式工作）
    const csp = [
        `default-src 'none';`,
        `img-src ${webview.cspSource} https: data: blob:;`,
        `style-src ${webview.cspSource} 'unsafe-inline';`,
        `script-src ${webview.cspSource} 'unsafe-inline' 'unsafe-eval';`,
        `font-src ${webview.cspSource} https: data:;`,
        `connect-src ${webview.cspSource} http: https:;`
    ].join(' ');
    const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    // 兜底 CSS：用最高优先级 display:none 隐藏 side-menu / task-switcher
    // （DOM 节点仍保留，不破坏原型脚本里可能的 getElementById('taskSwitcher') 访问）
    const patchCss = `<style>
      .side-menu{display:none!important;}
      .task-switcher,.task-switcher.flash{display:none!important;}
      /* 任务切换器隐藏后，顶部栏页面标题左侧的分隔线没必要保留 */
      .top-bar .top-page-title{border-left:none!important;padding-left:20px!important;}
      /* 主内容区自动占满（.layout 原本是 flex，隐藏 side-menu 后 main-content 自然占满） */
      .layout .main-content{flex:1 1 auto;}
    </style>`;
    if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${cspMeta}\n${patchCss}`);
    } else {
        html = cspMeta + patchCss + html;
    }

    // 注入桥接脚本：放在 </body> 之前
    const bridge = `
<script>
(function(){
  if (window.__tmsBridgeInjected) return;
  window.__tmsBridgeInjected = true;
    var vscode = acquireVsCodeApi();
  window.__tmsVscode = vscode;
  window.__tmsCurrentPage = ${JSON.stringify(currentKey)};

  /* 0) API 中转：Webview 不能直连本地 HTTP，统一由扩展代理
        用法：TMSApi.call('listTasks').then(data => ...) */
  (function(){
    var seq = 0;
    var waiting = Object.create(null);
    window.TMSApi = {
      call: function(name, params){
        return new Promise(function(resolve, reject){
          var id = 'api_' + (++seq) + '_' + Date.now();
          waiting[id] = { resolve: resolve, reject: reject };
          vscode.postMessage({ type: 'api-call', id: id, name: name, params: params || {} });
          /* 10 秒超时兜底（扩展端 timeout 默认 8s，这里稍宽松） */
          setTimeout(function(){
            if (waiting[id]) {
              var w = waiting[id]; delete waiting[id];
              w.reject(new Error('api timeout: ' + name));
            }
          }, 12000);
        });
      }
    };
    window.addEventListener('message', function(e){
      var data = e.data || {};
      if (data.type !== 'api-result' || !data.id || !waiting[data.id]) return;
      var w = waiting[data.id]; delete waiting[data.id];
      if (data.ok) w.resolve(data.data); else w.reject(new Error(data.error || 'api error'));
    });
  })();

  /* 1) 拦截侧边菜单与所有指向 proto-xxx.html 的链接，改为命令路由 */
  document.addEventListener('click', function(e){
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (!href || href === '#' || href.charAt(0) === '#') {
      // 锚点：交给原页面处理
      return;
    }
    if (/^https?:|^mailto:/i.test(href)) {
      e.preventDefault();
      vscode.postMessage({ type: 'open-external', url: href });
      return;
    }
    if (/proto-[a-z\\-]+\\.html/i.test(href)) {
      e.preventDefault();
      vscode.postMessage({ type: 'navigate', page: href });
      return;
    }
    /* 其他 *.html 相对路径默认拦截（避免白屏） */
    if (/\\.html(\\?|#|$)/i.test(href)) {
      e.preventDefault();
      var target = href.replace(/^.*?proto-([a-z\\-]+)\\.html.*/i, '$1');
      vscode.postMessage({ type: 'navigate', page: target });
    }
  }, true);

  /* 2) 屏蔽 window.open 跳转，改为命令 */
  var _open = window.open;
  window.open = function(url){
    if (!url) return null;
    if (/proto-[a-z\\-]+\\.html/i.test(url)) {
      vscode.postMessage({ type: 'navigate', page: url });
      return null;
    }
    if (/^https?:/i.test(url)) {
      vscode.postMessage({ type: 'open-external', url: url });
      return null;
    }
    return _open ? _open.apply(window, arguments) : null;
  };

  /* 2.1) 拦截 location.href / location.assign / location.replace 跳转
         原型脚本里有 window.location.href = 'proto-xxx.html'，
         在 Webview 中会让整个 Webview 进入加载错误的协议路径，必须劫持 */
  function routeOrExternal(url){
    if (!url) return false;
    if (/proto-[a-z\\-]+\\.html/i.test(url)) {
      vscode.postMessage({ type: 'navigate', page: url });
      return true;
    }
    if (/^https?:/i.test(url)) {
      vscode.postMessage({ type: 'open-external', url: url });
      return true;
    }
    if (/\\.html(\\?|#|$)/i.test(url)) {
      var k = url.replace(/^.*?proto-([a-z\\-]+)\\.html.*/i, '$1');
      vscode.postMessage({ type: 'navigate', page: k });
      return true;
    }
    return false;
  }
  try {
    var LocProto = window.Location && window.Location.prototype;
    if (LocProto) {
      var d = Object.getOwnPropertyDescriptor(LocProto, 'href');
      if (d && d.set) {
        Object.defineProperty(LocProto, 'href', {
          configurable: true, enumerable: true,
          get: function(){ return d.get ? d.get.call(this) : ''; },
          set: function(v){
            if (routeOrExternal(String(v))) return;
            try { d.set.call(this, v); } catch(e) {}
          }
        });
      }
      var _assign = LocProto.assign;
      LocProto.assign = function(v){ if (!routeOrExternal(String(v))) _assign && _assign.call(this, v); };
      var _replace = LocProto.replace;
      LocProto.replace = function(v){ if (!routeOrExternal(String(v))) _replace && _replace.call(this, v); };
    }
  } catch(err) { /* 某些环境下 Location.prototype 不可改，忽略 */ }

  /* 2.2) 拦截 form.submit() 的 action 是 proto-xxx.html 的情况，避免页面跳转 */
  document.addEventListener('submit', function(e){
    var f = e.target;
    if (f && f.action && /proto-[a-z\\-]+\\.html/i.test(f.action)) {
      e.preventDefault();
      vscode.postMessage({ type: 'navigate', page: f.action });
    }
  }, true);

  /* 3) 监听扩展 → Webview 消息，做任务广播兼容 */
  window.addEventListener('message', function(e){
    var data = e.data || {};
    if (data.type === 'task-change' && data.payload && data.payload.to && data.payload.to.id) {
      var newId = data.payload.to.id;
      /* 关键防环标记：由扩展下发触发的本地 setCurrent，内部的 onChange 回调
         不再 postMessage('set-task') 回传扩展（否则会形成
         扩展 → Webview → 扩展 → Webview … 的死循环） */
      window.__tmsApplyingExternal = true;
      var handled = false;
      if (window.TMSGlobal && typeof window.TMSGlobal.setCurrent === 'function') {
        try { handled = !!window.TMSGlobal.setCurrent(newId); } catch(err) {}
      }
      /* 如果本次切换没触发（例如目标 id 与当前一致），立即释放标记；
         若触发了，会在 onChange 回调里释放（见下文 hookTMSGlobal） */
      if (!handled) window.__tmsApplyingExternal = false;

      if (!handled) {
        /* TMSGlobal 尚未加载或任务不在列表中：兜底写 localStorage + 派发自定义事件 */
        try {
          if (window.localStorage) {
            window.localStorage.setItem('tms_current_task_id', newId);
          }
        } catch(err) {}
        try {
          window.dispatchEvent(new CustomEvent('tms:current-task-change', { detail: data.payload }));
        } catch(err) {}
        /* 如果 TMSGlobal 随后再加载，等挂载后再补触发一次。
           注意：**不要**先切 other 再切 newId —— 那会导致扩展进程被写成 other 并广播回来，形成死循环 */
        var retry = 0;
        var retryTimer = setInterval(function(){
          retry++;
          if (window.TMSGlobal && typeof window.TMSGlobal.setCurrent === 'function') {
            clearInterval(retryTimer);
            window.__tmsApplyingExternal = true;
            var applied = false;
            try { applied = !!window.TMSGlobal.setCurrent(newId); } catch(err) {}
            if (!applied) window.__tmsApplyingExternal = false;
          } else if (retry > 50) {
            clearInterval(retryTimer);
          }
        }, 100);
      }
    }
  });

  /* 4) 当 TMSGlobal 切换任务时，回传扩展进程，保持全局一致
        但必须过滤掉"扩展下发的反向回调"，否则会构成循环 */
  function hookTMSGlobal(){
    if (!window.TMSGlobal || window.__tmsHooked) return;
    window.__tmsHooked = true;
    if (typeof window.TMSGlobal.onChange === 'function') {
      window.TMSGlobal.onChange(function(ev){
        /* ① 扩展下发触发的本地变更：只释放标记，不回传 */
        if (window.__tmsApplyingExternal) {
          window.__tmsApplyingExternal = false;
          return;
        }
        /* ② 用户在 Webview 内部主动切（例如原型里的任务卡点击）：回传扩展 */
        if (ev && ev.to) {
          vscode.postMessage({ type: 'set-task', taskId: ev.to.id });
        }
      });
    }
  }
  /* 原型脚本可能稍后加载，轮询挂载 */
  var hookTimer = setInterval(function(){
    hookTMSGlobal();
    if (window.__tmsHooked) clearInterval(hookTimer);
  }, 100);
  setTimeout(function(){ clearInterval(hookTimer); }, 5000);

  /* 5) 各页面的 API 数据接入
        - workbench：重建 #myTaskGrid 的 task-card 节点
        - task-list / design / execution / defect / review：
            通过原型 IIFE 末尾暴露的 __TMS_HOOKS__.{key}.setData(arr) 直接替换内部数据源
            然后由原型自己的渲染函数重新绘制，VSCode 与浏览器独立运行零差异 */
  function escHtml(s){ s = String(s == null ? '' : s); return s.replace(/[&<>]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; }); }
  function escAttr(s){ s = String(s == null ? '' : s); return s.replace(/["&<>]/g, function(c){ return {'"':'&quot;','&':'&amp;','<':'&lt;','>':'&gt;'}[c]; }); }

  /** 轮询等待 __TMS_HOOKS__[hookKey] 出现（原型脚本可能在 DOMContentLoaded 之后才执行） */
  function waitHook(hookKey, timeoutMs){
    timeoutMs = timeoutMs || 5000;
    return new Promise(function(resolve, reject){
      var deadline = Date.now() + timeoutMs;
      (function loop(){
        var h = window.__TMS_HOOKS__ && window.__TMS_HOOKS__[hookKey];
        if (h && typeof h.setData === 'function') return resolve(h);
        if (Date.now() > deadline) return reject(new Error('hook timeout: ' + hookKey));
        setTimeout(loop, 50);
      })();
    });
  }

  /** 获取当前任务 id——先读原型全局态，退化到 localStorage，兜底 T001 */
  function getCurrentTaskId(){
    try {
      if (window.TMSGlobal && typeof TMSGlobal.getCurrent === 'function') {
        var t = TMSGlobal.getCurrent();
        if (t && t.id) return t.id;
      }
      var ls = (localStorage.getItem('tms_current_task_id') || '').trim();
      if (ls) return ls;
    } catch(e) {}
    return 'T001';
  }

  function logApiFallback(label, err){
    console.warn('[TMS] ' + label + ' API 失败，保留原型兜底数据：', err && err.message);
  }

  /** workbench —— 用 API 任务列表重建 task-card */
  function injectWorkbenchTasks(){
    var grid = document.getElementById('myTaskGrid');
    if (!grid) return;
    TMSApi.call('listTasks').then(function(resp){
      if (!resp || !Array.isArray(resp.list) || !resp.list.length) return;
      var currentId = getCurrentTaskId();

      Array.prototype.slice.call(grid.querySelectorAll('.task-card')).forEach(function(n){ n.remove(); });

      var frag = document.createDocumentFragment();
      resp.list.forEach(function(t){
        var d = document.createElement('div');
        var isCur = t.id === currentId;
        d.className = 'task-card' + (isCur ? ' current' : '');
        d.setAttribute('data-task-id', t.id);
        d.setAttribute('data-task-name', t.name || '');
        d.setAttribute('data-task-status', t.statusText || '');
        d.setAttribute('data-status-class', t.statusClass || 'status-exec');
        d.innerHTML =
          '<span class="tc-current-badge">● 当前任务</span>' +
          (isCur ? '' : '<span class="tc-switch-hint">点击切换为当前任务</span>') +
          '<div class="tc-title" title="' + escAttr(t.name) + '">' + escHtml(t.name) + '</div>' +
          '<div class="tc-subcount">' + (t.code || '') + '</div>';
        frag.appendChild(d);
      });
      grid.insertBefore(frag, grid.firstChild);

      try {
        // 优先走"重置 + 折叠"入口：默认只显示 6 张，点更多再加载
        if (typeof window.resetMyTaskView === 'function') window.resetMyTaskView();
        else if (typeof window.applyView === 'function') window.applyView();
        else if (typeof window.render === 'function') window.render();
      } catch(err) { console.warn('[TMS] applyView failed', err); }
    }).catch(function(err){ logApiFallback('workbench listTasks', err); });
  }

  /** task-list —— 替换原型的 TASKS 数组 */
  function injectTaskList(){
    Promise.all([ waitHook('taskList'), TMSApi.call('listTasks') ])
      .then(function(arr){
        var hook = arr[0], resp = arr[1];
        if (!resp || !Array.isArray(resp.list) || !resp.list.length) return;
        // ---- 字段归一化：后端 statusClass="status-exec"  →  原型 status="exec"
        // 原型 proto-task-list 的统计卡片 / 筛选器按 t.status 短名计数，
        // 若不做映射，所有状态数量都会是 0。
        var STATUS_LABEL = {
          draft:'草稿', design:'设计中', exec:'执行中', review:'评审中', done:'已完成',
          paused:'已暂停', pending:'待启动', delay:'已延期', closed:'已关闭'
        };
        var normalized = resp.list.map(function(t){
          var shortStatus = t.status;
          if (!shortStatus && typeof t.statusClass === 'string') {
            shortStatus = t.statusClass.replace(/^status-/, '');
          }
          if (!shortStatus) shortStatus = 'draft';
          return Object.assign({}, t, {
            status: shortStatus,
            statusClass: t.statusClass || ('status-' + shortStatus),
            statusText: t.statusText || STATUS_LABEL[shortStatus] || shortStatus
          });
        });
        hook.setData(normalized);
      })
      .catch(function(err){ logApiFallback('taskList', err); });
  }

  /** design —— 替换原型的 ALL_CASES 数组 */
  function injectDesign(){
    var taskId = getCurrentTaskId();
    Promise.all([ waitHook('design'), TMSApi.call('listCases', { taskId: taskId, pageSize: 200 }) ])
      .then(function(arr){
        var hook = arr[0], resp = arr[1];
        if (!resp || !Array.isArray(resp.list) || !resp.list.length) return;
        hook.setData(resp.list);
      })
      .catch(function(err){ logApiFallback('design', err); });
  }

  /** execution —— 替换原型的 CASE_POOL 数组 */
  function injectExecution(){
    var taskId = getCurrentTaskId();
    Promise.all([ waitHook('execution'), TMSApi.call('listCases', { taskId: taskId, pageSize: 200 }) ])
      .then(function(arr){
        var hook = arr[0], resp = arr[1];
        if (!resp || !Array.isArray(resp.list) || !resp.list.length) return;
        hook.setData(resp.list);
      })
      .catch(function(err){ logApiFallback('execution', err); });
  }

  /** defect —— 替换原型的 BUGS 数组 */
  function injectDefect(){
    var taskId = getCurrentTaskId();
    Promise.all([ waitHook('defect'), TMSApi.call('listDefects', { taskId: taskId }) ])
      .then(function(arr){
        var hook = arr[0], resp = arr[1];
        if (!resp || !Array.isArray(resp.list) || !resp.list.length) return;
        hook.setData(resp.list);
      })
      .catch(function(err){ logApiFallback('defect', err); });
  }

  /** review —— 替换原型的 REVIEWS 数组 */
  function injectReview(){
    var taskId = getCurrentTaskId();
    Promise.all([ waitHook('review'), TMSApi.call('listReviews', { taskId: taskId }) ])
      .then(function(arr){
        var hook = arr[0], resp = arr[1];
        if (!resp || !Array.isArray(resp.list) || !resp.list.length) return;
        hook.setData(resp.list);
      })
      .catch(function(err){ logApiFallback('review', err); });
  }

  /** 当前页对应的 injector 路由表 */
  var PAGE_INJECTORS = {
    'workbench': injectWorkbenchTasks,
    'task-list': injectTaskList,
    'design':    injectDesign,
    'execution': injectExecution,
    'defect':    injectDefect,
    'review':    injectReview
  };

  /* ================= B+ 写操作通道 ================= */
  /** 刷新当前页数据（写入后调用） */
  function refreshCurrentPage(){
    var fn = PAGE_INJECTORS[window.__tmsCurrentPage];
    if (fn) { try { fn(); } catch(err) { console.warn('[TMS] refresh', err); } }
  }
  function toast(msg){
    try { vscode.postMessage({ type: 'toast', message: String(msg) }); } catch(e) {}
  }
  function uid(prefix){
    return prefix + '-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  }
  /** 简易表单（避免依赖原型样式）—— fields: [{key, label, type, options?, value?}] */
  function openForm(title, fields, onSubmit){
    var mask = document.createElement('div');
    mask.className = 'tms-write-mask';
    var box = document.createElement('div');
    box.className = 'tms-write-dialog';
    var html = '<div class="tms-write-title">' + escHtml(title) + '</div><div class="tms-write-body">';
    fields.forEach(function(f){
      html += '<label class="tms-write-row"><span>' + escHtml(f.label) + '</span>';
      if (f.type === 'select') {
        html += '<select data-k="' + escAttr(f.key) + '">';
        (f.options || []).forEach(function(o){
          var sel = (f.value === o.value) ? ' selected' : '';
          html += '<option value="' + escAttr(o.value) + '"' + sel + '>' + escHtml(o.label) + '</option>';
        });
        html += '</select>';
      } else if (f.type === 'textarea') {
        html += '<textarea data-k="' + escAttr(f.key) + '" rows="3">' + escHtml(f.value || '') + '</textarea>';
      } else {
        html += '<input data-k="' + escAttr(f.key) + '" type="' + escAttr(f.type || 'text') + '" value="' + escAttr(f.value || '') + '">';
      }
      html += '</label>';
    });
    html += '</div><div class="tms-write-foot"><button class="tms-btn-cancel">取消</button><button class="tms-btn-ok">确定</button></div>';
    box.innerHTML = html;
    mask.appendChild(box);
    document.body.appendChild(mask);
    function close(){ try { document.body.removeChild(mask); } catch(e) {} }
    box.querySelector('.tms-btn-cancel').addEventListener('click', close);
    box.querySelector('.tms-btn-ok').addEventListener('click', function(){
      var out = {};
      fields.forEach(function(f){
        var el = box.querySelector('[data-k="' + f.key + '"]');
        out[f.key] = el ? el.value : '';
      });
      close();
      try { onSubmit(out); } catch(err) { console.warn('[TMS] form submit', err); }
    });
    mask.addEventListener('click', function(e){ if (e.target === mask) close(); });
  }
  /** 简易确认框 */
  function confirmBox(message, onYes){
    openForm('确认', [{ key: '_', label: message, type: 'text', value: '' }], function(){ onYes(); });
  }

  /** 业务写操作封装（由悬浮面板按钮触发） */
  window.TMSWrite = {
    // -------- Task --------
    createTask: function(){
      openForm('新建测试任务', [
        { key: 'name', label: '任务名称', type: 'text', value: '新任务' },
        { key: 'owner', label: '负责人', type: 'text', value: '张小明' },
        { key: 'desc', label: '描述', type: 'textarea', value: '' },
        { key: 'statusClass', label: '状态', type: 'select', value: 'status-design', options: [
          { value: 'status-draft',   label: '草稿' },
          { value: 'status-design',  label: '设计中' },
          { value: 'status-exec',    label: '执行中' },
          { value: 'status-review',  label: '评审中' },
          { value: 'status-done',    label: '已完成' },
          { value: 'status-paused',  label: '已暂停' },
          { value: 'status-pending', label: '待启动' },
          { value: 'status-delay',   label: '已延期' },
          { value: 'status-closed',  label: '已关闭' }
        ]}
      ], function(v){
        var id = uid('T');
        var statusText = ({
          'status-draft':'草稿','status-design':'设计中','status-exec':'执行中',
          'status-review':'评审中','status-done':'已完成','status-paused':'已暂停',
          'status-pending':'待启动','status-delay':'已延期','status-closed':'已关闭'
        })[v.statusClass] || '设计中';
        var today = new Date().toISOString().slice(0, 10);
        TMSApi.call('createTask', { payload: {
          id: id, code: 'T-' + id, name: v.name || '未命名任务', owner: v.owner || '张小明',
          statusClass: v.statusClass, statusText: statusText,
          progress: 0, startDate: today, endDate: today, desc: v.desc || ''
        }}).then(function(){
          toast('新建任务成功');
          refreshCurrentPage();
        }).catch(function(err){ toast('新建失败：' + err.message); });
      });
    },
    updateTask: function(id, currentName){
      openForm('编辑任务', [
        { key: 'name', label: '任务名称', type: 'text', value: currentName || '' }
      ], function(v){
        TMSApi.call('updateTask', { id: id, patch: { name: v.name } }).then(function(){
          toast('已更新'); refreshCurrentPage();
        }).catch(function(err){ toast('失败：' + err.message); });
      });
    },
    deleteTask: function(id, name){
      if (!window.confirm('确认删除任务 "' + (name || id) + '" ?')) return;
      TMSApi.call('deleteTask', { id: id }).then(function(){
        toast('已删除'); refreshCurrentPage();
      }).catch(function(err){ toast('失败：' + err.message); });
    },
    nextTaskStatus: function(id, currentClass){
      var order = ['status-draft','status-design','status-exec','status-review','status-done'];
      var label = { 'status-draft': '草稿', 'status-design': '设计中', 'status-exec': '执行中', 'status-review': '评审中', 'status-done': '已完成' };
      var i = order.indexOf(currentClass);
      var next = order[(i < 0 ? 1 : i + 1) % order.length];
      TMSApi.call('updateTask', { id: id, patch: { statusClass: next, statusText: label[next] } }).then(function(){
        toast('状态 → ' + label[next]); refreshCurrentPage();
      }).catch(function(err){ toast('失败：' + err.message); });
    },

    // -------- Case --------
    createCase: function(){
      var taskId = getCurrentTaskId();
      openForm('新建测试用例', [
        { key: 'title', label: '用例标题', type: 'text', value: '新用例' },
        { key: 'module', label: '所属模块', type: 'text', value: '' },
        { key: 'priority', label: '优先级', type: 'select', value: 'P1', options: [
          { value: 'P0', label: 'P0' }, { value: 'P1', label: 'P1' }, { value: 'P2', label: 'P2' }, { value: 'P3', label: 'P3' }
        ]}
      ], function(v){
        var id = uid('CASE');
        TMSApi.call('createCase', { taskId: taskId, payload: {
          id: id, code: id, name: v.title, title: v.title,
          module: v.module || '通用模块', path: (v.module || '通用模块') + ' / 系统测试',
          type: 'func', priority: v.priority, status: 'draft', statusText: '草稿',
          owner: '张小明', subtask: '', stage: 'st', execStatus: 'pending', executed: false
        }}).then(function(){
          toast('用例已创建'); refreshCurrentPage();
        }).catch(function(err){ toast('失败：' + err.message); });
      });
    },
    deleteCase: function(id){
      if (!window.confirm('确认删除该用例？')) return;
      var taskId = getCurrentTaskId();
      TMSApi.call('deleteCase', { taskId: taskId, id: id }).then(function(){
        toast('已删除'); refreshCurrentPage();
      }).catch(function(err){ toast('失败：' + err.message); });
    },
    executeCase: function(){
      var taskId = getCurrentTaskId();
      openForm('执行用例', [
        { key: 'id', label: '用例 ID', type: 'text', value: '' },
        { key: 'result', label: '执行结果', type: 'select', value: 'passed', options: [
          { value: 'passed', label: '通过' }, { value: 'failed', label: '失败' },
          { value: 'blocked', label: '阻塞' }, { value: 'skipped', label: '跳过' }
        ]},
        { key: 'remark', label: '备注', type: 'textarea', value: '' }
      ], function(v){
        if (!v.id) { toast('请输入用例 ID'); return; }
        TMSApi.call('executeCase', { taskId: taskId, id: v.id, payload: { result: v.result, remark: v.remark } }).then(function(){
          toast('已记录执行结果'); refreshCurrentPage();
        }).catch(function(err){ toast('失败：' + err.message); });
      });
    },

    // -------- Defect --------
    createDefect: function(){
      var taskId = getCurrentTaskId();
      openForm('新建缺陷', [
        { key: 'title', label: '标题', type: 'text', value: '新缺陷' },
        { key: 'severity', label: '严重度', type: 'select', value: 'S2', options: [
          { value: 'S0', label: 'S0' }, { value: 'S1', label: 'S1' }, { value: 'S2', label: 'S2' }, { value: 'S3', label: 'S3' }
        ]},
        { key: 'priority', label: '优先级', type: 'select', value: 'P1', options: [
          { value: 'P0', label: 'P0' }, { value: 'P1', label: 'P1' }, { value: 'P2', label: 'P2' }, { value: 'P3', label: 'P3' }
        ]},
        { key: 'assignee', label: '处理人', type: 'text', value: '张小明' }
      ], function(v){
        var id = uid('BUG');
        var today = new Date().toISOString().slice(0, 10);
        TMSApi.call('createDefect', { taskId: taskId, payload: {
          id: id, code: id, title: v.title, severity: v.severity, priority: v.priority,
          type: '功能', status: 'open', module: '通用', stage: 'st',
          assignee: v.assignee, reporter: v.assignee, owner: v.assignee, created: today
        }}).then(function(){
          toast('缺陷已创建'); refreshCurrentPage();
        }).catch(function(err){ toast('失败：' + err.message); });
      });
    },
    deleteDefect: function(id){
      if (!window.confirm('确认删除该缺陷？')) return;
      var taskId = getCurrentTaskId();
      TMSApi.call('deleteDefect', { taskId: taskId, id: id }).then(function(){
        toast('已删除'); refreshCurrentPage();
      }).catch(function(err){ toast('失败：' + err.message); });
    },
    transitionDefect: function(){
      var taskId = getCurrentTaskId();
      openForm('缺陷状态流转', [
        { key: 'id', label: '缺陷 ID', type: 'text', value: '' },
        { key: 'to', label: '目标状态', type: 'select', value: 'fixed', options: [
          { value: 'open', label: '待处理' }, { value: 'in_progress', label: '处理中' },
          { value: 'fixed', label: '已修复' }, { value: 'verifying', label: '待验证' },
          { value: 'closed', label: '已关闭' }, { value: 'reopen', label: '重开' },
          { value: 'rejected', label: '已驳回' }
        ]},
        { key: 'comment', label: '备注', type: 'textarea', value: '' }
      ], function(v){
        if (!v.id) { toast('请输入缺陷 ID'); return; }
        TMSApi.call('transitionDefect', { taskId: taskId, id: v.id, to: v.to, comment: v.comment }).then(function(){
          toast('状态已变更'); refreshCurrentPage();
        }).catch(function(err){ toast('失败：' + err.message); });
      });
    },

    // -------- Review --------
    createReview: function(){
      var taskId = getCurrentTaskId();
      openForm('新建评审', [
        { key: 'title', label: '评审主题', type: 'text', value: '测试计划评审' },
        { key: 'type', label: '类型', type: 'select', value: 'plan', options: [
          { value: 'plan', label: '计划评审' }, { value: 'design', label: '设计评审' }, { value: 'summary', label: '总结评审' }
        ]},
        { key: 'way', label: '方式', type: 'select', value: 'meeting', options: [
          { value: 'meeting', label: '会议' }, { value: 'email', label: '邮件' }
        ]}
      ], function(v){
        var id = uid('RV');
        var today = new Date().toISOString().slice(0, 16).replace('T', ' ');
        TMSApi.call('createReview', { taskId: taskId, payload: {
          id: id, title: v.title, type: v.type, way: v.way,
          subtask: '', owner: 0, members: [0, 1, 2],
          ownerObj: { name: '张小明', short: '张', color: '#0052d9' },
          memberObjs: [
            { name: '张小明', short: '张', color: '#0052d9' },
            { name: '李工程师', short: '李', color: '#2ba471' },
            { name: '王测试', short: '王', color: '#7b3fe4' }
          ],
          time: today, status: 'pending', pass: 0, total: 3
        }}).then(function(){
          toast('评审已创建'); refreshCurrentPage();
        }).catch(function(err){ toast('失败：' + err.message); });
      });
    },
    deleteReview: function(id){
      if (!window.confirm('确认删除该评审？')) return;
      var taskId = getCurrentTaskId();
      TMSApi.call('deleteReview', { taskId: taskId, id: id }).then(function(){
        toast('已删除'); refreshCurrentPage();
      }).catch(function(err){ toast('失败：' + err.message); });
    },
    transitionReview: function(){
      var taskId = getCurrentTaskId();
      openForm('评审状态流转', [
        { key: 'id', label: '评审 ID', type: 'text', value: '' },
        { key: 'to', label: '目标状态', type: 'select', value: 'passed', options: [
          { value: 'pending', label: '待开始' }, { value: 'reviewing', label: '评审中' },
          { value: 'passed', label: '通过' }, { value: 'failed', label: '未通过' },
          { value: 'canceled', label: '已取消' }
        ]}
      ], function(v){
        if (!v.id) { toast('请输入评审 ID'); return; }
        TMSApi.call('transitionReview', { taskId: taskId, id: v.id, to: v.to }).then(function(){
          toast('状态已变更'); refreshCurrentPage();
        }).catch(function(err){ toast('失败：' + err.message); });
      });
    },

    // -------- Report --------
    createReport: function(){
      var taskId = getCurrentTaskId();
      openForm('新建报告', [
        { key: 'title', label: '报告标题', type: 'text', value: '测试报告' },
        { key: 'round', label: '轮次', type: 'text', value: '第1轮' }
      ], function(v){
        var id = uid('R');
        var today = new Date().toISOString().slice(0, 10);
        TMSApi.call('createReport', { taskId: taskId, payload: {
          id: id, code: id, title: v.title, round: v.round,
          status: 'draft', owner: '张小明', created: today
        }}).then(function(){
          toast('报告已创建'); refreshCurrentPage();
        }).catch(function(err){ toast('失败：' + err.message); });
      });
    },
    deleteReport: function(id){
      if (!window.confirm('确认删除该报告？')) return;
      var taskId = getCurrentTaskId();
      TMSApi.call('deleteReport', { taskId: taskId, id: id }).then(function(){
        toast('已删除'); refreshCurrentPage();
      }).catch(function(err){ toast('失败：' + err.message); });
    }
  };

  /* 按当前页渲染"写操作悬浮面板"（右下角） */
  function mountWritePanel(){
    if (document.getElementById('tms-write-panel')) return;
    var page = window.__tmsCurrentPage;
    var actions = {
      'task-list': [
        { label: '＋ 新建任务', fn: 'createTask' }
      ],
      'design': [
        { label: '＋ 新建用例', fn: 'createCase' }
      ],
      'execution': [
        { label: '▷ 执行用例', fn: 'executeCase' }
      ],
      'defect': [
        { label: '＋ 新建缺陷', fn: 'createDefect' },
        { label: '↻ 状态流转', fn: 'transitionDefect' }
      ],
      'review': [
        { label: '＋ 发起评审', fn: 'createReview' },
        { label: '↻ 状态流转', fn: 'transitionReview' }
      ],
      'report': [
        { label: '＋ 新建报告', fn: 'createReport' }
      ]
    }[page];
    if (!actions || !actions.length) return;

    // 样式
    var style = document.createElement('style');
    style.textContent =
      '#tms-write-panel{position:fixed;right:24px;bottom:24px;z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:flex-end;}' +
      '#tms-write-panel button{padding:8px 16px;border-radius:20px;border:none;background:var(--vscode-button-background,#0052d9);color:var(--vscode-button-foreground,#fff);font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);}' +
      '#tms-write-panel button:hover{opacity:.88;}' +
      '.tms-write-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:center;justify-content:center;}' +
      '.tms-write-dialog{background:var(--vscode-editor-background,#fff);color:var(--vscode-editor-foreground,#222);border-radius:8px;padding:16px 20px;min-width:360px;max-width:480px;box-shadow:0 8px 32px rgba(0,0,0,.3);}' +
      '.tms-write-title{font-size:15px;font-weight:600;margin-bottom:10px;}' +
      '.tms-write-body{display:flex;flex-direction:column;gap:10px;max-height:60vh;overflow:auto;}' +
      '.tms-write-row{display:flex;flex-direction:column;gap:4px;font-size:12px;}' +
      '.tms-write-row input,.tms-write-row select,.tms-write-row textarea{padding:6px 8px;border:1px solid var(--vscode-input-border,#ccc);background:var(--vscode-input-background,#fff);color:var(--vscode-input-foreground,#222);border-radius:4px;font-size:13px;box-sizing:border-box;}' +
      '.tms-write-foot{margin-top:14px;display:flex;justify-content:flex-end;gap:8px;}' +
      '.tms-write-foot button{padding:6px 14px;border-radius:4px;border:none;cursor:pointer;font-size:13px;}' +
      '.tms-btn-cancel{background:var(--vscode-button-secondaryBackground,#e5e6eb);color:var(--vscode-button-secondaryForeground,#222);}' +
      '.tms-btn-ok{background:var(--vscode-button-background,#0052d9);color:var(--vscode-button-foreground,#fff);}';
    document.head.appendChild(style);

    var panel = document.createElement('div');
    panel.id = 'tms-write-panel';
    actions.forEach(function(a){
      var btn = document.createElement('button');
      btn.textContent = a.label;
      btn.addEventListener('click', function(){
        try { window.TMSWrite[a.fn](); } catch(err) { console.warn('[TMS] write', err); }
      });
      panel.appendChild(btn);
    });
    document.body.appendChild(panel);
  }

  function bootPageApi(){
    var fn = PAGE_INJECTORS[window.__tmsCurrentPage];
    if (fn) {
      try { fn(); } catch(err) { console.warn('[TMS] bootPageApi', err); }
    }
    try { mountWritePanel(); } catch(err) { console.warn('[TMS] mountWritePanel', err); }
  }

  /* 6) 任务切换时，对列表类页面二次刷新数据（避免沿用旧任务的列表） */
  window.addEventListener('message', function(e){
    var data = e.data || {};
    if (data.type !== 'task-change' || !data.payload || !data.payload.to) return;
    /* 延迟一拍，让原型自己的 onChange 先把筛选栏/子任务下拉重建完 */
    setTimeout(function(){
      if (window.__tmsCurrentPage === 'design')    injectDesign();
      else if (window.__tmsCurrentPage === 'execution') injectExecution();
      else if (window.__tmsCurrentPage === 'defect')    injectDefect();
      else if (window.__tmsCurrentPage === 'review')    injectReview();
    }, 150);
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootPageApi);
  } else {
    setTimeout(bootPageApi, 50);
  }
})();
</script>`;
    if (/<\/body>/i.test(html)) {
        html = html.replace(/<\/body>/i, bridge + '\n</body>');
    } else {
        html = html + bridge;
    }
    return html;
}
