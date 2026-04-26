/**
 * TMS Mock 后端服务
 * 默认监听 http://localhost:3001
 *
 * 启动：
 *   cd mock-server
 *   npm install
 *   npm start
 *
 * 环境变量：
 *   PORT     监听端口（默认 3001）
 *   LATENCY  模拟延迟毫秒数（默认 120）
 */
const express = require('express');
const cors = require('cors');

const db = require('./db');
const tasksRouter = require('./routes/tasks');
const workbenchRouter = require('./routes/workbench');
const casesRouter = require('./routes/cases');
const defectsRouter = require('./routes/defects');
const reportsRouter = require('./routes/reports');
const reviewsRouter = require('./routes/reviews');
const authRouter = require('./routes/auth');

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const LATENCY = Number(process.env.LATENCY) || 120;

app.use(cors());
app.use(express.json());

// 访问日志
app.use((req, _res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.url}`);
  next();
});

// 模拟网络延迟
app.use((_req, _res, next) => {
  if (LATENCY > 0) {
    setTimeout(next, LATENCY);
  } else {
    next();
  }
});

// 统一响应包装：成功 → { code:0, data, msg:"ok" }
// 路由内部只需 res.ok(data) 或抛错，由全局错误处理处理
app.use((_req, res, next) => {
  res.ok = (data) => res.json({ code: 0, data, msg: 'ok' });
  res.fail = (msg, code = 500, httpStatus = 500) =>
    res.status(httpStatus).json({ code, data: null, msg });
  next();
});

// 写操作自动持久化：所有 非-GET/HEAD 请求响应结束后触发一次 db.persist()
// 这样每条路由无需显式调用，新增/修改/删除自动落盘 data.json
app.use((req, res, next) => {
  const m = req.method.toUpperCase();
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try { db.persist(); } catch (_) { /* ignore */ }
      }
    });
  }
  next();
});

// 健康检查
app.get('/api/ping', (_req, res) => {
  res.ok({ pong: true, time: Date.now() });
});

// 业务路由
app.use('/api/auth', authRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/workbench', workbenchRouter);
app.use('/api/cases', casesRouter);
app.use('/api/defects', defectsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/reviews', reviewsRouter);

// 404
app.use((req, res) => {
  res.status(404).json({ code: 404, data: null, msg: `Not Found: ${req.method} ${req.url}` });
});

// 全局错误处理
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ code: 500, data: null, msg: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log('----------------------------------------------');
  console.log(' TMS Mock Server 启动成功');
  console.log(` 监听地址: http://localhost:${PORT}`);
  console.log(` 健康检查: http://localhost:${PORT}/api/ping`);
  console.log(` 数据概览: ${db.TASKS.length} 个任务`);
  console.log('----------------------------------------------');
});
