# TMS — 测试任务管理平台（Test Management System）

> 一站式管理「测试任务 → 子任务 → 阶段 → 轮次 → 用例 → 执行 → 缺陷 → 评审 → 报告」完整链路的内部平台。
>
> 当前阶段：**原型 + Mock 后端**。产品形态覆盖 Web 原型与 VSCode 插件两种载体。

---

## ✨ 平台速览

- 🎯 **面向角色**：测试负责人、ST / UAT 负责人、子任务负责人、产品 / 开发 Leader、QA 总监
- 🧩 **核心域模型**：任务（Task）→ 子任务（Subtask）→ 阶段（Stage：`ST 阶段` / `UAT 阶段` / `合并测试阶段`，后者与前两者互斥）→ 轮次（Round）
- 🧱 **技术栈**：
  - 前端原型：纯 HTML/CSS/JS（无构建步骤，可直接双击打开）
  - Mock 后端：Node.js + Express（本地 `http://localhost:3001`，JSON 文件持久化）
  - VSCode 插件：TypeScript + Webview，把全部原型页以树视图嵌入 IDE 侧边栏
- 📄 **文档**：`prd/测试任务管理/PRD.html`（评审稿 v2.1，含 9 个原型页内嵌展示）

---

## 📁 目录结构

```
tms/
├── README.md                         ← 本文件
├── .gitignore
│
├── prd/                              PRD 与原型（产品交付物）
│   ├── 测试任务管理/                   ★ 当前主版本（对接了 Mock 后端）
│   │   ├── PRD.html                  评审稿 v2.1（推荐用浏览器打开）
│   │   ├── PRD.md                    纯文本版 PRD
│   │   ├── proto-workbench.html      工作台（任务卡片 + 待办 + KPI）
│   │   ├── proto-task-list.html      测试任务列表
│   │   ├── proto-task-detail.html    任务详情（含测试范围 CRUD）
│   │   ├── proto-design.html         设计管理（用例 + 测试大纲 XMind）
│   │   ├── proto-execution.html      执行管理
│   │   ├── proto-defect.html         缺陷管理
│   │   ├── proto-review.html         评审管理
│   │   ├── proto-report.html         测试报告
│   │   ├── tms-common.css            公共样式
│   │   ├── tms-global-task.js        全局任务上下文（跨页同步）
│   │   ├── tms-global-scope.js       全局范围上下文（子任务/阶段/轮次）
│   │   ├── tms-scope-dropdown.*      范围筛选下拉组件
│   │   └── tms-api.js                前端通用后端接入器 ★
│   └── 测试任务管理_bp/                历史基线版本（勿改，仅作对比）
│
├── mock-server/                      Node + Express Mock 后端
│   ├── server.js                     入口；默认监听 3001
│   ├── db.js                         内存 DB + 文件持久化（data.json）
│   ├── routes/                       REST 路由
│   │   ├── tasks.js   workbench.js
│   │   ├── cases.js   defects.js
│   │   ├── reports.js reviews.js
│   │   └── auth.js
│   ├── package.json
│   └── README.md                     后端详细接口说明
│
└── vscode-extension/                 VSCode 插件（把原型嵌入 IDE）
    ├── src/                          TypeScript 源码
    ├── media/                        侧边栏 Webview 前端资源
    ├── resources/                    图标、原型资源
    ├── package.json                  命令、配置、视图声明
    └── README.md                     插件用法
```

---

## 🚀 快速启动

### 前置依赖

| 依赖 | 版本要求 | 说明 |
|---|---|---|
| Node.js | ≥ 16 | 用于 Mock 后端与 VSCode 插件编译 |
| 浏览器 | Chrome / Edge 现代版 | 打开 HTML 原型 |
| VSCode | ≥ 1.80 | （可选）运行 VSCode 插件 |

### 1️⃣ 启动 Mock 后端（必需）

```bash
cd mock-server
npm install
npm start
```

启动成功后会输出：

```
 TMS Mock Server 启动成功
 监听地址: http://localhost:3001
 健康检查: http://localhost:3001/api/ping
 数据概览: N 个任务
```

> 可通过环境变量调整：`PORT=3002 LATENCY=0 npm start`

### 2️⃣ 浏览原型（任选其一）

- **方式 A**：直接双击 `prd/测试任务管理/proto-workbench.html` 在浏览器打开。
- **方式 B**：在 `prd/测试任务管理/` 下启动一个静态 HTTP 服务，避免部分浏览器对 `file://` 协议的限制：
  ```bash
  cd prd/测试任务管理
  npx http-server -p 5500
  # 然后访问 http://localhost:5500/proto-workbench.html
  ```

页面加载后会自动通过 `tms-api.js` 向 `http://localhost:3001` 拉取数据并落盘写回。

### 3️⃣ （可选）运行 VSCode 插件

```bash
cd vscode-extension
npm install
npm run compile
```

在 VSCode 中按 `F5` 启动 Extension Host，左侧活动栏会出现「测试任务管理」图标，点开即可在 IDE 中使用所有原型页。

详细用法见 [`vscode-extension/README.md`](vscode-extension/README.md)。

---

## 🧭 核心概念

### 域模型三级结构

```
任务 Task
 └─ 子任务 Subtask
     └─ 阶段 Stage  （ST 阶段 / UAT 阶段 / 合并测试阶段，三选一或 ST+UAT）
         └─ 轮次 Round  （R1、R2 …）
             └─ 用例执行、缺陷
```

### 阶段互斥规则（重要）

- 一个子任务的阶段只能在以下两种组合中选择：
  - 「ST 阶段」和/或「UAT 阶段」（可同时存在，生成两条阶段记录）
  - 「合并测试阶段」（独占）
- 「合并测试阶段」与「ST/UAT 阶段」**不可同时勾选**，前端在保存时做校验并 Toast 提示。

### 全局上下文

- `TMSGlobal`（[tms-global-task.js](prd/测试任务管理/tms-global-task.js)）：顶部"切换任务"器，跨页同步当前任务 ID，刷新页面数据。
- `TMSScope`（[tms-global-scope.js](prd/测试任务管理/tms-global-scope.js)）：子任务 / 阶段 / 轮次筛选上下文，供设计 / 执行 / 缺陷 / 评审共享。

### 前后端对接

- 每个原型页只需暴露 `window.__TMS_HOOKS__`（键：`taskList` / `design` / `execution` / `defect` / `review` / `report` / `workbench`），[`tms-api.js`](prd/测试任务管理/tms-api.js) 会自动完成：
  - 初始加载拉取 → `setData` 覆盖
  - 每 800ms 脏检测 + 300ms 防抖整表 PUT 写回
  - 任务切换时 flush 旧任务、载入新任务
  - `beforeunload` 时 `navigator.sendBeacon` 兜底落盘

---

## 🔌 Mock 后端接口速查

| 资源 | Method | 路径 |
|---|---|---|
| 健康检查 | GET | `/api/ping` |
| 任务 | GET / PUT | `/api/tasks` |
| 子任务树 | GET / PUT | `/api/tasks/:id/subtasks` |
| 用例 | GET / POST / PUT / DELETE | `/api/cases` |
| 用例执行 | POST | `/api/cases/:id/execute` |
| 缺陷 | GET / POST / PUT / DELETE | `/api/defects` |
| 评审 | GET / POST / PUT / DELETE | `/api/reviews` |
| 报告 | GET / POST / PUT / DELETE | `/api/reports` |
| 工作台聚合 | GET | `/api/workbench/summary?taskId=xxx` |

统一响应结构：`{ code: 0, data: ..., msg: "ok" }`。详细字段见 [`mock-server/README.md`](mock-server/README.md)。

---

## 🛠️ 常用开发任务

| 目的 | 命令 / 操作 |
|---|---|
| 重启 Mock 服务 | 在 `mock-server/` 目录 `Ctrl+C` 后 `npm start` |
| 重置 Mock 数据 | 删除 `mock-server/data.json`（或从 `.bak` 恢复）后重启 |
| 修改接口契约 | 改 `mock-server/routes/*.js` + 改 `prd/测试任务管理/tms-api.js` |
| 新增前端页面 | 复制一份 `proto-*.html` + 挂 `window.__TMS_HOOKS__` |
| 更新 PRD | 编辑 `prd/测试任务管理/PRD.html`（源） + 同步 `PRD.md` |
| 打包 VSCode 插件 | `cd vscode-extension && npm run package` |

---

## 📌 命名约定

- 分支：`feat/*` / `fix/*` / `docs/*` / `refactor/*`
- PRD 版本：`vX.Y`，文档头 meta、左上角 Logo、左侧目录三处同步更新
- 历史基线：`prd/测试任务管理_bp/`（带 `_bp` 后缀表示 baseline，**只读**，用于对比与回滚）

---

## 📚 文档索引

- 📘 **[产品需求文档（PRD）](prd/测试任务管理/PRD.html)** — 评审稿 v2.1，推荐入口
- 📗 **[Mock 后端说明](mock-server/README.md)** — 接口清单、数据结构、调试技巧
- 📙 **[VSCode 插件说明](vscode-extension/README.md)** — 命令、配置、打包
- 📝 [PRD Markdown 版](prd/测试任务管理/PRD.md) — 便于 diff 的纯文本版本

---

## 🗺️ 路线图

- [x] 9 个核心页面原型（工作台 / 任务列表 / 任务详情 / 设计 / 执行 / 缺陷 / 评审 / 报告）
- [x] Mock 后端 + 整表同步持久化
- [x] VSCode 插件壳 + Webview 接入
- [x] PRD v2.1（含前后端对接章节、任务详情页、阶段互斥规则）
- [ ] 真实后端替换（保留 REST 契约）
- [ ] 接入单点登录 / 权限体系
- [ ] 报告 PDF 导出 + 水印

---

## 📝 许可与内部使用

当前为内部项目，默认仅限团队内部使用。如需对外发布，请先移除 `.idea/` 与 `data.json` 等本地数据。
