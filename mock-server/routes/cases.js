const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * 用例列表
 *   GET /api/cases?taskId=T001&status=passed&keyword=xxx&page=1&pageSize=20
 */
router.get('/', (req, res) => {
  const { taskId, status, keyword } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(1000, Math.max(1, Number(req.query.pageSize) || 20));
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  let list = (db.CASES[taskId] || []).slice();
  if (status) list = list.filter(c => c.status === status);
  if (keyword) {
    const kw = String(keyword).toLowerCase();
    list = list.filter(
      c =>
        (c.title || c.name || '').toLowerCase().includes(kw) ||
        (c.code || '').toLowerCase().includes(kw) ||
        (c.module || '').toLowerCase().includes(kw)
    );
  }
  const total = list.length;
  const start = (page - 1) * pageSize;
  res.ok({ total, page, pageSize, list: list.slice(start, start + pageSize) });
});

/**
 * 整体同步：PUT /api/cases?taskId=T001   body = { list: [...] }
 */
router.put('/', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const list = Array.isArray(req.body && req.body.list) ? req.body.list : null;
  if (!list) return res.fail('body.list 必须为数组', 400, 400);
  db.CASES[taskId] = list.slice();
  res.ok({ taskId, total: list.length, syncedAt: Date.now() });
});

/** 新建：POST /api/cases?taskId=T001  body = 用例对象 */
router.post('/', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const c = req.body || {};
  if (!c.id) return res.fail('缺少 id', 400, 400);
  if (!db.CASES[taskId]) db.CASES[taskId] = [];
  const idx = db.CASES[taskId].findIndex(x => x.id === c.id);
  if (idx >= 0) db.CASES[taskId][idx] = c; else db.CASES[taskId].push(c);
  res.ok(c);
});

/** 更新：PUT /api/cases/:id?taskId=T001  body = 变更字段 */
router.put('/:id', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const arr = db.CASES[taskId] || [];
  const idx = arr.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.fail('用例不存在', 404, 404);
  arr[idx] = Object.assign({}, arr[idx], req.body || {});
  res.ok(arr[idx]);
});

/** 删除：DELETE /api/cases/:id?taskId=T001 */
router.delete('/:id', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const arr = db.CASES[taskId] || [];
  const idx = arr.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.fail('用例不存在', 404, 404);
  const [removed] = arr.splice(idx, 1);
  res.ok(removed);
});

/**
 * 执行用例：POST /api/cases/:id/execute?taskId=T001
 *   body = { result: 'passed'|'failed'|'blocked'|'skipped', duration, remark }
 */
router.post('/:id/execute', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const arr = db.CASES[taskId] || [];
  const idx = arr.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.fail('用例不存在', 404, 404);
  const body = req.body || {};
  const result = body.result || 'passed';
  arr[idx] = Object.assign({}, arr[idx], {
    execStatus: result,
    executed: true,
    execTime: new Date().toISOString().slice(0, 16).replace('T', ' '),
    duration: Number(body.duration) || arr[idx].duration || 0,
    remark: body.remark || arr[idx].remark || ''
  });
  res.ok(arr[idx]);
});

module.exports = router;
