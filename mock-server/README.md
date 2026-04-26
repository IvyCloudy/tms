# TMS Mock Server

为 VSCode 插件（测试任务管理）提供 Mock 数据的独立 Node.js 后端服务。

## 启动

```bash
cd mock-server
npm install
npm start
```

默认监听 `http://localhost:3001`。可通过环境变量调整：

| 变量      | 默认值 | 说明               |
| --------- | ------ | ------------------ |
| `PORT`    | 3001   | 监听端口           |
| `LATENCY` | 120    | 模拟网络延迟（ms） |

## 接口一览

所有成功响应统一返回：

```json
{ "code": 0, "data": <对象/数组>, "msg": "ok" }
```

### 读接口

| 方法 | 路径                                 | 说明                     |
| ---- | ------------------------------------ | ------------------------ |
| GET  | `/api/ping`                          | 健康检查                 |
| GET  | `/api/tasks?keyword=&status=`        | 任务列表                 |
| GET  | `/api/tasks/:id`                     | 任务详情                 |
| GET  | `/api/workbench/summary?taskId=`     | 工作台汇总与待办         |
| GET  | `/api/cases?taskId=&status=&keyword=&page=&pageSize=` | 用例分页 |
| GET  | `/api/defects?taskId=&status=&severity=` | 缺陷列表             |
| GET  | `/api/reports?taskId=`               | 测试报告列表             |
| GET  | `/api/reviews?taskId=`               | 评审列表                 |

### 写接口（B+ 阶段）

所有写操作成功后由 `server.js` 中间件自动触发 `db.persist()` 把内存状态落盘到 `data.json`，重启服务后自动恢复。

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| POST | `/api/auth/login` | 登录（mock，任意账号） |
| POST | `/api/auth/logout` | 登出 |
| POST / PUT / DELETE | `/api/tasks` / `/api/tasks/:id` | 新增 / 更新 / 删除任务 |
| POST | `/api/tasks/current` | 设置当前任务 |
| POST / PUT / DELETE | `/api/cases?taskId=` / `/api/cases/:id?taskId=` | 新增 / 更新 / 删除用例 |
| POST | `/api/cases/:id/execute?taskId=` | 记录用例执行结果 |
| POST / PUT / DELETE | `/api/defects?taskId=` / `/api/defects/:id?taskId=` | 新增 / 更新 / 删除缺陷 |
| POST | `/api/defects/:id/transition?taskId=` | 缺陷状态流转 |
| POST / PUT / DELETE | `/api/reviews?taskId=` / `/api/reviews/:id?taskId=` | 新增 / 更新 / 删除评审 |
| POST | `/api/reviews/:id/transition?taskId=` | 评审状态流转 |
| POST / PUT / DELETE | `/api/reports?taskId=` / `/api/reports/:id?taskId=` | 新增 / 更新 / 删除报告 |

### 数据持久化

- 可变集合（TASKS / WORKBENCH / CASES / DEFECTS / REPORTS / REVIEWS）在首次写操作后自动写入 `mock-server/data.json`。
- 启动时优先加载 `data.json` 覆盖内存种子数据；删除 `data.json` 即可恢复初始数据。
- 只读集合（OWNERS / TASK_SUBTASKS）保持为静态约束，不会被写操作污染。

## 与插件对接

在 VSCode 设置中可配置：

```json
{
  "tms.api.baseUrl": "http://localhost:3001"
}
```

插件默认即指向此地址，启动 mock server 后直接生效。
