const express = require('express');
const router = express.Router();
const db = require('../db');

/** GET /api/workbench/summary?taskId=T001 */
router.get('/summary', (req, res) => {
  const taskId = String(req.query.taskId || '');
  const info = db.WORKBENCH[taskId];
  if (!info) return res.ok({ summary: null, todo: [] });
  res.ok(info);
});

module.exports = router;
