const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * 测试报告列表
 *   GET /api/reports?taskId=T001
 */
router.get('/', (req, res) => {
  const { taskId } = req.query;
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const list = (db.REPORTS[taskId] || []).slice();
  res.ok({ total: list.length, list });
});

/** 整体同步：PUT /api/reports?taskId=T001  body = { list: [...] } */
router.put('/', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const list = Array.isArray(req.body && req.body.list) ? req.body.list : null;
  if (!list) return res.fail('body.list 必须为数组', 400, 400);
  db.REPORTS[taskId] = list.slice();
  res.ok({ taskId, total: list.length, syncedAt: Date.now() });
});

/** 新建：POST /api/reports?taskId=T001 */
router.post('/', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const r = req.body || {};
  if (!r.id) return res.fail('缺少 id', 400, 400);
  if (!db.REPORTS[taskId]) db.REPORTS[taskId] = [];
  const idx = db.REPORTS[taskId].findIndex(x => x.id === r.id);
  if (idx >= 0) db.REPORTS[taskId][idx] = r; else db.REPORTS[taskId].push(r);
  res.ok(r);
});

/** 更新：PUT /api/reports/:id?taskId=T001 */
router.put('/:id', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const arr = db.REPORTS[taskId] || [];
  const idx = arr.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.fail('报告不存在', 404, 404);
  arr[idx] = Object.assign({}, arr[idx], req.body || {});
  res.ok(arr[idx]);
});

/** 删除：DELETE /api/reports/:id?taskId=T001 */
router.delete('/:id', (req, res) => {
  const taskId = String(req.query.taskId || '');
  if (!taskId) return res.fail('缺少 taskId', 400, 400);
  const arr = db.REPORTS[taskId] || [];
  const idx = arr.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.fail('报告不存在', 404, 404);
  const [removed] = arr.splice(idx, 1);
  res.ok(removed);
});

module.exports = router;
