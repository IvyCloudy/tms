import * as vscode from 'vscode';
import { TaskState, TaskChangeEvent, Task } from './TaskState';

/**
 * 侧边栏（WebviewView）：顶部显示任务切换器，中部为 7 个菜单
 */
export class SidebarProvider implements vscode.WebviewViewProvider {
    private view: vscode.WebviewView | undefined;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly state: TaskState
    ) {}

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };
        webviewView.webview.html = this.renderHtml();

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            if (!msg || !msg.type) return;
            switch (msg.type) {
                case 'open-page':
                    if (msg.page) {
                        vscode.commands.executeCommand(`tms.open${pascalCase(msg.page)}`);
                    }
                    return;
                case 'set-task':
                    if (msg.taskId) await this.state.setCurrent(msg.taskId);
                    return;
                case 'request-task-state':
                    this.broadcastTaskChange(null);
                    return;
                case 'run-command':
                    if (msg.command) vscode.commands.executeCommand(msg.command);
                    return;
            }
        });
    }

    public refresh() {
        if (this.view) this.view.webview.html = this.renderHtml();
    }

    public broadcastTaskChange(_ev: TaskChangeEvent | null) {
        if (!this.view) return;
        this.view.webview.postMessage({
            type: 'task-state',
            payload: {
                all: this.state.getAll(),
                currentId: this.state.getCurrentId()
            }
        });
    }

    /** API 任务列表刷新完成后调用：前端依赖同一消息驱动重绘 */
    public refreshTaskList() {
        this.broadcastTaskChange(null);
    }

    private renderHtml(): string {
        const tasks = this.state.getAll();
        const cur = this.state.getCurrentId();
        const csp = this.view
            ? `default-src 'none'; style-src ${this.view.webview.cspSource} 'unsafe-inline'; script-src ${this.view.webview.cspSource} 'unsafe-inline';`
            : '';

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  /* ========= 基础 ========= */
  * { box-sizing: border-box; }
  body {
    padding: 0; margin: 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background, transparent);
  }
  body.is-dark .tc-tag.tag-exec   { background: rgba(227,115,24,.18);  color: #ffb070; }
  body.is-dark .tc-tag.tag-design { background: rgba(0,82,217,.22);    color: #7fb3ff; }
  body.is-dark .tc-tag.tag-review { background: rgba(123,63,228,.22);  color: #c7a8ff; }
  body.is-dark .tc-tag.tag-done   { background: rgba(43,164,113,.20);  color: #6fd4a4; }

  /* 滚动条美化 */
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }
  ::-webkit-scrollbar-track { background: transparent; }

  /* ========= 分节标题 ========= */
  .section-title {
    padding: 10px 12px 4px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    letter-spacing: .3px;
    display: flex; align-items: center; gap: 6px;
  }
  .section-title::after {
    content: ''; flex: 1; height: 1px;
    background: var(--vscode-panel-border, transparent);
    opacity: .5;
  }

  /* ========= 任务切换卡片 ========= */
  .task-block { padding: 10px 10px; }
  .task-card {
    position: relative;
    border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, #3c3c3c));
    background: var(--vscode-input-background);
    border-radius: 6px;
    padding: 9px 30px 9px 11px;
    cursor: pointer;
    user-select: none;
    transition: border-color .15s, background .15s;
    outline: none;
  }
  .task-card:hover,
  .task-card:focus-visible { border-color: var(--vscode-focusBorder); }
  .task-card.open { border-color: var(--vscode-focusBorder); }
  .tc-row1 { display: flex; align-items: center; gap: 6px; }
  .tc-code {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 10.5px;
    color: var(--vscode-descriptionForeground);
    background: var(--vscode-badge-background);
    padding: 1px 5px;
    border-radius: 3px;
    opacity: .85;
  }
  .tc-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: #e37318;
    box-shadow: 0 0 0 2px rgba(227,115,24,.22);
    animation: pulse 1.8s ease-in-out infinite;
  }
  .tc-name {
    font-weight: 600; font-size: 13px; line-height: 1.35;
    word-break: break-all;
    margin-top: 4px;
    color: var(--vscode-foreground);
  }
  .tc-meta {
    display: flex; align-items: center; gap: 6px;
    margin-top: 6px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  .tc-tag {
    padding: 1px 6px; border-radius: 3px;
    font-size: 10px; line-height: 1.5;
    font-weight: 500;
  }
  .tag-exec   { background: #fff3e0; color: #e37318; }
  .tag-design { background: #e8f3ff; color: #0052d9; }
  .tag-review { background: #f3e8ff; color: #7b3fe4; }
  .tag-done   { background: #e8f8f0; color: #2ba471; }
  .tc-owner { display: inline-flex; align-items: center; gap: 4px; }
  .tc-arrow {
    position: absolute; top: 50%; right: 10px;
    transform: translateY(-50%);
    transition: transform .2s;
    color: var(--vscode-descriptionForeground);
    display: inline-flex;
  }
  .task-card.open .tc-arrow { transform: translateY(-50%) rotate(180deg); }

  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 2px rgba(227,115,24,.22); }
    50%      { box-shadow: 0 0 0 4px rgba(227,115,24,.05); }
  }

  /* ========= 任务列表 ========= */
  .task-list {
    display: none;
    margin-top: 6px;
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 6px;
    overflow: hidden;
    background: var(--vscode-editor-background);
  }
  .task-list.show { display: block; }
  .tl-search {
    padding: 6px 8px;
    border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
    background: var(--vscode-input-background);
  }
  .tl-search input {
    width: 100%;
    padding: 4px 8px;
    font-size: 12px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 3px;
    outline: none;
    font-family: inherit;
  }
  .tl-search input:focus { border-color: var(--vscode-focusBorder); }
  .tl-body { max-height: 240px; overflow-y: auto; }
  .task-item {
    padding: 7px 10px;
    cursor: pointer;
    font-size: 12px;
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
    display: flex; align-items: center; gap: 6px;
    transition: background .1s;
  }
  .task-item:last-child { border-bottom: none; }
  .task-item:hover { background: var(--vscode-list-hoverBackground); }
  .task-item.current {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
  .task-item.current .ti-code { opacity: .85; }
  .task-item .ti-check {
    width: 14px; display: inline-flex; justify-content: center;
    color: var(--vscode-focusBorder);
    opacity: 0;
  }
  .task-item.current .ti-check { opacity: 1; }
  .task-item .ti-code {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 10px;
    opacity: .6;
    flex-shrink: 0;
  }
  .task-item .ti-name {
    flex: 1;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .task-item.hidden { display: none; }
  .tl-empty {
    padding: 14px 10px;
    text-align: center;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    display: none;
  }
  .tl-empty.show { display: block; }

  /* ========= 菜单 ========= */
  .menu { padding: 2px 0 4px; }
  .menu-item {
    display: flex; align-items: center; gap: 10px;
    padding: 7px 12px 7px 10px;
    cursor: pointer;
    font-size: 13px;
    border-left: 2px solid transparent;
    color: var(--vscode-foreground);
    outline: none;
    position: relative;
    user-select: none;
  }
  .menu-item:hover { background: var(--vscode-list-hoverBackground); }
  .menu-item:focus-visible {
    background: var(--vscode-list-hoverBackground);
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  .menu-item.active {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
    border-left-color: var(--vscode-focusBorder);
  }
  .menu-item.active .menu-icon { color: var(--vscode-list-activeSelectionForeground); }
  .menu-icon {
    width: 16px; height: 16px;
    display: inline-flex; align-items: center; justify-content: center;
    color: var(--vscode-icon-foreground, var(--vscode-foreground));
    opacity: .85;
    flex-shrink: 0;
  }
  .menu-icon svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .menu-label { flex: 1; }
  .menu-badge {
    font-size: 10px;
    padding: 0 5px;
    min-width: 16px; height: 14px; line-height: 14px;
    text-align: center;
    border-radius: 7px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }

  /* ========= 底部操作区 ========= */
  .actions {
    padding: 8px 10px 12px;
    border-top: 1px solid var(--vscode-panel-border, transparent);
    margin-top: 8px;
    display: flex; gap: 6px;
  }
  .act-btn {
    flex: 1;
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    padding: 5px 6px;
    font-size: 11.5px;
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    background: var(--vscode-button-secondaryBackground, transparent);
    border: 1px solid var(--vscode-panel-border, #3c3c3c);
    border-radius: 4px;
    cursor: pointer;
    outline: none;
    transition: background .1s, border-color .1s;
  }
  .act-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground, var(--vscode-list-hoverBackground));
    border-color: var(--vscode-focusBorder);
  }
  .act-btn:focus-visible { border-color: var(--vscode-focusBorder); }
  .act-btn svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
</style>
</head>
<body>

<div class="task-block">
  <div class="task-card" id="taskCard" tabindex="0" role="button" aria-expanded="false" title="点击展开任务列表">
    <div class="tc-row1">
      <span class="tc-dot" id="tcDot" aria-hidden="true"></span>
      <span class="tc-code" id="tcCode">${escapeHtml(taskCode(tasks, cur))}</span>
    </div>
    <div class="tc-name" id="tcName">${escapeHtml(taskName(tasks, cur))}</div>
    <div class="tc-meta">
      <span class="tc-tag ${tagClass(taskOf(tasks, cur))}" id="tcTag">${escapeHtml(taskStatus(tasks, cur))}</span>
      <span class="tc-owner" id="tcOwner">负责人：${escapeHtml(taskOwner(tasks, cur))}</span>
    </div>
    <span class="tc-arrow" aria-hidden="true">
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </span>
  </div>
  <div class="task-list" id="taskList" role="listbox">
    <div class="tl-search">
      <input type="text" id="tlSearch" placeholder="搜索任务名称或编号…" autocomplete="off" spellcheck="false" />
    </div>
    <div class="tl-body" id="tlBody">
      ${tasks.map(t => taskItemHtml(t, cur)).join('')}
      <div class="tl-empty" id="tlEmpty">未找到匹配的任务</div>
    </div>
  </div>
</div>

<div class="section-title">功能导航</div>
<div class="menu" id="menu" role="menu">
  <div class="menu-item" tabindex="0" role="menuitem" data-page="Workbench">
    <span class="menu-icon">${iconSvg('workbench')}</span>
    <span class="menu-label">工作台</span>
  </div>
  <div class="menu-item" tabindex="0" role="menuitem" data-page="TaskList">
    <span class="menu-icon">${iconSvg('tasks')}</span>
    <span class="menu-label">测试任务</span>
  </div>
  <div class="menu-item" tabindex="0" role="menuitem" data-page="TaskDetail">
    <span class="menu-icon">${iconSvg('task-detail')}</span>
    <span class="menu-label">任务详情</span>
  </div>
  <div class="menu-item" tabindex="0" role="menuitem" data-page="Design">
    <span class="menu-icon">${iconSvg('design')}</span>
    <span class="menu-label">设计管理</span>
  </div>
  <div class="menu-item" tabindex="0" role="menuitem" data-page="Execution">
    <span class="menu-icon">${iconSvg('play')}</span>
    <span class="menu-label">执行管理</span>
  </div>
  <div class="menu-item" tabindex="0" role="menuitem" data-page="Defect">
    <span class="menu-icon">${iconSvg('bug')}</span>
    <span class="menu-label">缺陷管理</span>
  </div>
  <div class="menu-item" tabindex="0" role="menuitem" data-page="Report">
    <span class="menu-icon">${iconSvg('report')}</span>
    <span class="menu-label">测试报告</span>
  </div>
  <div class="menu-item" tabindex="0" role="menuitem" data-page="Review">
    <span class="menu-icon">${iconSvg('review')}</span>
    <span class="menu-label">评审管理</span>
  </div>
</div>

<div class="actions">
              <button class="act-btn" id="btnPalette" title="打开命令面板，输入 测试 查看全部命令">
    ${iconSvg('cmd')}
    <span>命令面板</span>
  </button>
  <button class="act-btn" id="btnSwitch" title="快速切换测试任务">
    ${iconSvg('switch')}
    <span>切换任务</span>
  </button>
</div>

<script>
(function(){
  var vscode = acquireVsCodeApi();

  /* 主题判定：通过 body 的配色亮度推断 */
  function detectTheme(){
    try {
      var bg = getComputedStyle(document.body).color || '';
      /* VSCode 深色主题前景色通常偏亮，简单兜底即可 */
      var m = bg.match(/\\d+/g);
      if (m && m.length >= 3) {
        var lum = (parseInt(m[0])*0.299 + parseInt(m[1])*0.587 + parseInt(m[2])*0.114);
        if (lum > 160) document.body.classList.add('is-dark');
        else document.body.classList.remove('is-dark');
      }
    } catch(e) {}
  }
  detectTheme();
  var mo = new MutationObserver(detectTheme);
  mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });

  /* 任务卡片展开/收起 */
  var card = document.getElementById('taskCard');
  var list = document.getElementById('taskList');
  var search = document.getElementById('tlSearch');
  function toggleList(show){
    var open = typeof show === 'boolean' ? show : !list.classList.contains('show');
    list.classList.toggle('show', open);
    card.classList.toggle('open', open);
    card.setAttribute('aria-expanded', String(open));
    if (open) setTimeout(function(){ search && search.focus(); }, 30);
  }
  card.addEventListener('click', function(e){ e.stopPropagation(); toggleList(); });
  card.addEventListener('keydown', function(e){
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleList(); }
    else if (e.key === 'Escape') toggleList(false);
  });
  document.addEventListener('click', function(){ toggleList(false); });
  list.addEventListener('click', function(e){ e.stopPropagation(); });

  /* 搜索过滤 */
  var emptyTip = document.getElementById('tlEmpty');
  search && search.addEventListener('input', function(){
    var kw = (search.value || '').trim().toLowerCase();
    var items = list.querySelectorAll('.task-item');
    var visible = 0;
    items.forEach(function(el){
      var hay = (el.getAttribute('data-search') || '').toLowerCase();
      var hit = !kw || hay.indexOf(kw) !== -1;
      el.classList.toggle('hidden', !hit);
      if (hit) visible++;
    });
    emptyTip.classList.toggle('show', visible === 0);
  });
  search && search.addEventListener('keydown', function(e){
    if (e.key === 'Escape') toggleList(false);
  });

  /* 选中任务 */
  list.querySelectorAll('.task-item').forEach(function(el){
    el.addEventListener('click', function(){
      var id = el.getAttribute('data-id');
      vscode.postMessage({ type: 'set-task', taskId: id });
      toggleList(false);
    });
  });

  /* 菜单交互：点击 + 键盘 */
  var menuItems = document.querySelectorAll('.menu-item');
  function activateMenu(el){
    menuItems.forEach(function(x){ x.classList.remove('active'); });
    el.classList.add('active');
    vscode.postMessage({ type: 'open-page', page: el.getAttribute('data-page') });
  }
  menuItems.forEach(function(el, idx){
    el.addEventListener('click', function(){ activateMenu(el); });
    el.addEventListener('keydown', function(e){
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateMenu(el); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); (menuItems[idx+1] || menuItems[0]).focus(); }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); (menuItems[idx-1] || menuItems[menuItems.length-1]).focus(); }
    });
  });

  /* 底部按钮 */
  var btnPalette = document.getElementById('btnPalette');
  var btnSwitch  = document.getElementById('btnSwitch');
  btnPalette && btnPalette.addEventListener('click', function(){
    vscode.postMessage({ type: 'run-command', command: 'workbench.action.showCommands' });
  });
  btnSwitch && btnSwitch.addEventListener('click', function(){
    vscode.postMessage({ type: 'run-command', command: 'tms.switchTask' });
  });

  /* 接收任务状态变化 */
  window.addEventListener('message', function(e){
    var d = e.data || {};
    if (d.type === 'task-state' && d.payload) {
      var all = d.payload.all || [];
      var cur = d.payload.currentId;
      var t = all.find(function(x){ return x.id === cur; }) || all[0];
      if (t) {
        document.getElementById('tcName').textContent = t.name;
        document.getElementById('tcCode').textContent = t.code || '';
        document.getElementById('tcOwner').textContent = '负责人：' + t.owner;
        var tag = document.getElementById('tcTag');
        tag.textContent = t.statusText;
        tag.className = 'tc-tag ' + tagClassOf(t.statusClass);
      }
      list.querySelectorAll('.task-item').forEach(function(el){
        el.classList.toggle('current', el.getAttribute('data-id') === cur);
      });
    }
  });

  function tagClassOf(sc){
    return ({
      'status-exec':'tag-exec','status-design':'tag-design',
      'status-review':'tag-review','status-done':'tag-done'
    })[sc] || 'tag-exec';
  }
})();
</script>
</body>
</html>`;
    }
}

function pascalCase(s: string) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function taskOf(tasks: Task[], id: string): Task | undefined {
    return tasks.find(t => t.id === id) || tasks[0];
}

function taskName(tasks: Task[], id: string): string {
    return taskOf(tasks, id)?.name || '—';
}

function taskStatus(tasks: Task[], id: string): string {
    return taskOf(tasks, id)?.statusText || '—';
}

function taskOwner(tasks: Task[], id: string): string {
    return taskOf(tasks, id)?.owner || '—';
}

function tagClass(t: Task | undefined): string {
    if (!t) return 'tag-exec';
    return ({
        'status-exec': 'tag-exec',
        'status-design': 'tag-design',
        'status-review': 'tag-review',
        'status-done': 'tag-done'
    } as Record<string, string>)[t.statusClass] || 'tag-exec';
}

function taskCode(tasks: Task[], id: string): string {
    return taskOf(tasks, id)?.code || '';
}

function taskItemHtml(t: Task, currentId: string): string {
    const searchKey = `${t.code} ${t.name} ${t.owner} ${t.statusText}`;
    return `
<div class="task-item ${t.id === currentId ? 'current' : ''}" role="option" data-id="${escapeAttr(t.id)}" data-search="${escapeAttr(searchKey)}" title="${escapeAttr(t.name)}">
  <span class="ti-check" aria-hidden="true">
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </span>
  <span class="ti-code">${escapeHtml(t.code)}</span>
  <span class="ti-name">${escapeHtml(t.name)}</span>
  <span class="tc-tag ${tagClass(t)}">${escapeHtml(t.statusText)}</span>
</div>`;
}

/**
 * Inline SVG 图标集，风格与 VSCode codicon 接近
 */
function iconSvg(key: string): string {
    const icons: Record<string, string> = {
        workbench: `<svg viewBox="0 0 16 16"><rect x="2" y="2.5" width="5" height="5" rx="1"/><rect x="9" y="2.5" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="4.5" rx="1"/><rect x="9" y="9" width="5" height="4.5" rx="1"/></svg>`,
        tasks:     `<svg viewBox="0 0 16 16"><path d="M3 4h10M3 8h10M3 12h6"/><circle cx="13" cy="12" r="1.6"/></svg>`,
        'task-detail': `<svg viewBox="0 0 16 16"><path d="M3 2.5h7l3 3V13a.5.5 0 01-.5.5h-9.5A.5.5 0 013 13z"/><path d="M10 2.5v3h3"/><path d="M5.5 8.5h5M5.5 10.5h5M5.5 12.5h3"/></svg>`,
        design:    `<svg viewBox="0 0 16 16"><path d="M2.5 13.5L6 10l4 4M2.5 13.5L10 6l3 3L5.5 13.5z"/><path d="M10 6l2-2 2 2-2 2"/></svg>`,
        play:      `<svg viewBox="0 0 16 16"><path d="M4 3.2v9.6L13 8z" stroke-linejoin="round"/></svg>`,
        bug:       `<svg viewBox="0 0 16 16"><rect x="5" y="5" width="6" height="8" rx="3"/><path d="M8 5V3M5 7H3M11 7h2M5 13H3M11 13h2M5 10H3M11 10h2"/></svg>`,
        report:    `<svg viewBox="0 0 16 16"><path d="M3 2.5h7l3 3V13a.5.5 0 01-.5.5h-9.5A.5.5 0 013 13z"/><path d="M10 2.5v3h3M6 8h4M6 10.5h4M6 13h2.5"/></svg>`,
        review:    `<svg viewBox="0 0 16 16"><path d="M2.5 4h11v7H8l-2.5 2.5V11H2.5z"/><path d="M5 6.5h6M5 8.5h4"/></svg>`,
        cmd:       `<svg viewBox="0 0 16 16"><rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M4.5 6.5l2 1.5-2 1.5M7.5 10h4"/></svg>`,
        switch:    `<svg viewBox="0 0 16 16"><path d="M3 6h9l-2-2M13 10H4l2 2"/></svg>`,
    };
    return icons[key] || '';
}

function escapeHtml(s: string): string {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
}
function escapeAttr(s: string): string {
    return escapeHtml(s);
}
