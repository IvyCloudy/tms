const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * 缺陷列表
 *   GET /api/defects?taskId=T001&status=open&severity=S1
 */
router.get('/', (req, res) => {
  const { taskId, status, severity } = req.query;
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  let list = (db.DEFECTS[taskId] || []).slice();
  if (status) list = list.filter(d => d.status === status);
  if (severity) list = list.filter(d => d.severity === severity);
  res.ok({ total: list.length, list });
});

/** 整体同步：PUT /api/defects?taskId=T001  body = { list: [...] } */
router.put('/', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const list = Array.isArray(req.body && req.body.list) ? req.body.list : null;
  if (!list) return res.fail('body.list 必须为数组', 400, 400);
  db.DEFECTS[taskId] = list.slice();
  res.ok({ taskId, total: list.length, syncedAt: Date.now() });
});

/** 新建：POST /api/defects?taskId=T001 */
router.post('/', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const d = req.body || {};
  if (!d.id) return res.fail('缺少 id', 400, 400);
  if (!db.DEFECTS[taskId]) db.DEFECTS[taskId] = [];
  const idx = db.DEFECTS[taskId].findIndex(x => x.id === d.id);
  if (idx >= 0) db.DEFECTS[taskId][idx] = d; else db.DEFECTS[taskId].push(d);
  res.ok(d);
});

/** 更新：PUT /api/defects/:id?taskId=T001 */
router.put('/:id', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const arr = db.DEFECTS[taskId] || [];
  const idx = arr.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.fail('缺陷不存在', 404, 404);
  arr[idx] = Object.assign({}, arr[idx], req.body || {});
  res.ok(arr[idx]);
});

/** 删除：DELETE /api/defects/:id?taskId=T001 */
router.delete('/:id', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const arr = db.DEFECTS[taskId] || [];
  const idx = arr.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.fail('缺陷不存在', 404, 404);
  const [removed] = arr.splice(idx, 1);
  res.ok(removed);
});

/**
 * 状态流转：POST /api/defects/:id/transition?taskId=T001
 *   body = { to: 'fixed'|'verifying'|'closed'|'reopen'|'rejected', comment }
 */
router.post('/:id/transition', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const arr = db.DEFECTS[taskId] || [];
  const idx = arr.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.fail('缺陷不存在', 404, 404);
  const to = req.body && req.body.to;
  const allow = ['open', 'in_progress', 'fixed', 'verifying', 'closed', 'reopen', 'rejected'];
  if (!allow.includes(to)) return res.fail('非法状态: ' + to, 400, 400);
  arr[idx] = Object.assign({}, arr[idx], { status: to });
  res.ok(arr[idx]);
});

module.exports = router;
