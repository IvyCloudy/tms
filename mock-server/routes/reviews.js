const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * 评审列表
 *   GET /api/reviews?taskId=T001
 */
router.get('/', (req, res) => {
  const { taskId } = req.query;
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const list = (db.REVIEWS[taskId] || []).slice();
  res.ok({ total: list.length, list });
});

/** 整体同步：PUT /api/reviews?taskId=T001  body = { list: [...] } */
router.put('/', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const list = Array.isArray(req.body && req.body.list) ? req.body.list : null;
  if (!list) return res.fail('body.list 必须为数组', 400, 400);
  db.REVIEWS[taskId] = list.slice();
  res.ok({ taskId, total: list.length, syncedAt: Date.now() });
});

/** 新建：POST /api/reviews?taskId=T001 */
router.post('/', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const r = req.body || {};
  if (!r.id) return res.fail('缺少 id', 400, 400);
  if (!db.REVIEWS[taskId]) db.REVIEWS[taskId] = [];
  const idx = db.REVIEWS[taskId].findIndex(x => x.id === r.id);
  if (idx >= 0) db.REVIEWS[taskId][idx] = r; else db.REVIEWS[taskId].push(r);
  res.ok(r);
});

/** 更新：PUT /api/reviews/:id?taskId=T001 */
router.put('/:id', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const arr = db.REVIEWS[taskId] || [];
  const idx = arr.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.fail('评审不存在', 404, 404);
  arr[idx] = Object.assign({}, arr[idx], req.body || {});
  res.ok(arr[idx]);
});

/** 删除：DELETE /api/reviews/:id?taskId=T001 */
router.delete('/:id', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const arr = db.REVIEWS[taskId] || [];
  const idx = arr.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.fail('评审不存在', 404, 404);
  const [removed] = arr.splice(idx, 1);
  res.ok(removed);
});

/**
 * 状态流转：POST /api/reviews/:id/transition?taskId=T001
 *   body = { to: 'reviewing'|'passed'|'failed'|'canceled', comment }
 */
router.post('/:id/transition', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const arr = db.REVIEWS[taskId] || [];
  const idx = arr.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.fail('评审不存在', 404, 404);
  const to = req.body && req.body.to;
  const allow = ['pending', 'reviewing', 'passed', 'failed', 'canceled'];
  if (!allow.includes(to)) return res.fail('非法状态: ' + to, 400, 400);
  arr[idx] = Object.assign({}, arr[idx], { status: to });
  res.ok(arr[idx]);
});

module.exports = router;
