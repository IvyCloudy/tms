# TMS 测试任务管理 · VSCode 插件

在 VSCode 中直接打开"工作台 / 测试任务 / 设计管理 / 执行管理 / 缺陷管理 / 测试报告 / 评审管理"七个页面，并提供统一的**当前测试任务**上下文切换。

> 本插件的 UI 直接复用仓库中 `prd/测试任务管理/proto-*.html` 的原型页，通过 Webview 加载，不做二次实现；新增 / 修改原型页后，**插件无需改动**即可同步生效。

## 功能

| 功能 | 说明 |
|---|---|
| Activity Bar 图标 | 左侧活动栏新增 "TMS 测试任务" 入口 |
| 侧边栏 (WebviewView) | 顶部任务切换器 + 7 个页面菜单 |
| 主区 (WebviewPanel) | 单 Panel 路由切换，点击菜单不开新 Tab |
| StatusBar | 底部状态栏显示当前任务，点击可切换 |
| 命令面板 | `Cmd/Ctrl+Shift+P` → `TMS:` 查看所有命令 |
| 任务状态持久化 | 使用 `ExtensionContext.globalState` 跨会话记忆 |
| 跨 Webview 同步 | 主 Panel 与侧边栏通过扩展进程广播同步任务切换 |

## 目录结构

```
vscode-extension/
├── package.json              # 插件清单
├── tsconfig.json
├── resources/
│   └── icon.svg              # Activity Bar 图标
├── src/
│   ├── extension.ts          # 插件入口：注册视图、命令、StatusBar
│   ├── TaskState.ts          # 全局任务状态管理（替代浏览器 localStorage）
│   ├── SidebarProvider.ts    # 侧边栏 WebviewView
│   └── MainPanel.ts          # 主区 WebviewPanel（加载原型 HTML）
├── .vscode/
│   ├── launch.json           # F5 调试
│   └── tasks.json            # npm 任务
└── out/                      # tsc 编译产物（自动生成）
```

## 本地开发

```bash
# 1. 进入插件目录
cd vscode-extension

# 2. 安装依赖
npm install

# 3. 编译
npm run compile          # 或 npm run watch 监听模式

# 4. 启动调试
# 在 VSCode 中打开 vscode-extension/ 目录，按 F5
# 会启动一个新的扩展宿主窗口，左侧活动栏可见 TMS 图标
```

## 打包发布

```bash
# 安装打包工具（若未全局安装）
npm i -g @vscode/vsce

# 打包 .vsix
npm run package
# 产物：tms-test-management-0.1.0.vsix

# 本地安装
code --install-extension tms-test-management-0.1.0.vsix
```

## 架构设计

### 单 Panel 路由 vs 多 Panel Tab

本插件采用**单 Panel 路由切换**：同一时间只存在一个主 Webview Panel，点击侧边栏菜单只是调用 `panel.webview.html = ...` 替换内容，避免用户在多个 Tab 间迷失。

### Webview 如何加载原型 HTML

原型 HTML 位于仓库的 `prd/测试任务管理/`，与 `vscode-extension/` 同级。`MainPanel.ts` 会：

1. 读取原型 HTML 文件内容
2. 把所有 `<link href="xxx.css">`、`<script src="xxx.js">` 的相对路径用 `webview.asWebviewUri()` 转换为 `vscode-webview-resource://` URI
3. 注入 CSP `<meta>` 标签
4. 注入**桥接脚本**：
   - 拦截所有 `<a href="proto-xxx.html">` 点击，改为 `postMessage({ type:'navigate', page:'xxx' })`
   - Hook `window.open(...)`
   - 监听扩展 → Webview 消息，派发 `tms:current-task-change` 给原型里的 `TMSGlobal`

### 任务状态同步

```
┌──────────────────┐   setCurrent   ┌────────────────────┐
│ 侧边栏 Webview    │ ─────────────▶ │ Extension (Node)   │
└──────────────────┘                │ TaskState          │
                                    │ + globalState      │
┌──────────────────┐   setCurrent   │ + EventEmitter     │
│ 主区 Webview      │ ─────────────▶ │                    │
└──────────────────┘                └────────────────────┘
         ▲                                    │
         │  postMessage('task-change')        │
         └────────────────────────────────────┘
```

## 命令列表

| 命令 ID | 标题 |
|---|---|
| `tms.openWorkbench` | TMS: 打开工作台 |
| `tms.openTaskList` | TMS: 打开测试任务列表 |
| `tms.openDesign` | TMS: 打开设计管理 |
| `tms.openExecution` | TMS: 打开执行管理 |
| `tms.openDefect` | TMS: 打开缺陷管理 |
| `tms.openReport` | TMS: 打开测试报告 |
| `tms.openReview` | TMS: 打开评审管理 |
| `tms.switchTask` | TMS: 切换当前测试任务（QuickPick） |
| `tms.refreshSidebar` | TMS: 刷新侧边栏 |
| `tms.openInBrowser` | TMS: 在浏览器中打开当前页面 |

## 已知限制

1. 原型使用了大量内联 `<script>`，CSP 允许 `'unsafe-inline' 'unsafe-eval'`，生产发布前建议改为 nonce 方案
2. 原型中 `localStorage` 仍被使用，但仅作页面内部兜底；跨 Webview 真实同步走 `postMessage`
3. 若新增原型页，需要在 `MainPanel.ts` 的 `PageKey` 类型与 `package.json` 的 `commands` 里补充对应命令

## 后续增强

- [ ] 真实后端 API 对接（Token 注入 + 离线缓存）
- [ ] 命令面板新建 / 分配缺陷
- [ ] 编辑器内选中函数右键 "关联到测试案例"
- [ ] 侧边栏 StatusBar 红点提醒（待办 / 评审）
- [ ] 深色 / 高对比主题样式精修
