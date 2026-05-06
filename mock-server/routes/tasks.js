const express = require('express');
const router = express.Router();
const db = require('../db');

// --------- task-list 原型期望的扁平子任务形态投影 ---------
// 原始 SUBTASKS[taskId] 元素：{ id, name, stages:[{c,n,status,owner,...}], ... }
// 目标形态：{ id, name, stage, stageText, status, statusText, owner:{name,avatar,color}, passRate, tags, updatedAt }
const STAGE_TEXT = {
  design: '设计中', smoke: '冒烟测试', st: '系统测试(ST)',
  regression: '回归测试', uat: '用户验收(UAT)', merge: '合并测试'
};
const SUB_STATUS_TEXT = {
  pending: '未开始', ongoing: '进行中', blocked: '阻塞',
  passed: '已通过', failed: '未通过', skipped: '跳过'
};
const AVATAR_POOL = [
  { color: '#0052d9' }, { color: '#2ba471' }, { color: '#e37318' },
  { color: '#7b3fe4' }, { color: '#d64b8a' }, { color: '#00a870' }
];
function hashColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_POOL[Math.abs(h) % AVATAR_POOL.length].color;
}
function wrapOwner(input, fallbackName) {
  if (input && typeof input === 'object' && input.name) return input;
  const name = (typeof input === 'string' && input) || fallbackName || '未分配';
  return { name, short: name.charAt(0), color: hashColor(name) };
}
/** 从 stages[*].status 汇总为整条子任务的 status */
function aggStatus(stages) {
  if (!stages || !stages.length) return 'pending';
  const st = stages.map(s => s.status || 'pending');
  if (st.every(x => x === 'passed')) return 'passed';
  if (st.some(x => x === 'blocked')) return 'blocked';
  if (st.some(x => x === 'failed')) return 'failed';
  if (st.some(x => x === 'ongoing')) return 'ongoing';
  return 'pending';
}
/** 选一个"代表阶段"：非 passed 的最靠后阶段；全 passed 则取最后一个 */
function repStage(stages) {
  if (!stages || !stages.length) return { c: 'st', n: 'ST' };
  const nonPassed = stages.filter(s => s.status !== 'passed');
  return (nonPassed.length ? nonPassed[nonPassed.length - 1] : stages[stages.length - 1]);
}
/** 按 CASES 估算该子任务通过率（仅当有用例且状态=passed 时给出数字，否则 null） */
function estPassRate(taskId, subId) {
  const cases = (db.CASES && db.CASES[taskId]) || [];
  const scoped = cases.filter(c => c.subtask === subId);
  if (!scoped.length) return null;
  const passed = scoped.filter(c => c.execStatus === 'passed' || c.status === 'passed').length;
  return Math.round((passed / scoped.length) * 100);
}
function flattenSubtasks(task) {
  const raw = (db.SUBTASKS && db.SUBTASKS[task.id]) || [];
  if (!raw.length) return [];
  return raw.map(sub => {
    const rep = repStage(sub.stages);
    const status = aggStatus(sub.stages);
    const ownerSrc = (sub.stages && sub.stages[0] && sub.stages[0].owner) || task.owner;
    return {
      id: sub.id,
      name: sub.name,
      stage: rep.c,
      stageText: STAGE_TEXT[rep.c] || rep.n || rep.c,
      status,
      statusText: SUB_STATUS_TEXT[status] || status,
      owner: wrapOwner(ownerSrc, task.owner),
      passRate: status === 'passed' ? 100 : estPassRate(task.id, sub.id),
      tags: Array.isArray(sub.tags) ? sub.tags : [],
      updatedAt: sub.updatedAt || task.endDate || ''
    };
  });
}
/** 把一条 task 附上 subtasks 供 task-list 原型直接消费 */
function decorateTask(t) {
  return Object.assign({}, t, { subtasks: flattenSubtasks(t) });
}

/**
 * 任务列表
 *   GET /api/tasks?keyword=xxx&status=status-exec
 */
router.get('/', (req, res) => {
  const { keyword, status } = req.query;
  let list = db.TASKS.slice();
  if (keyword) {
    const kw = String(keyword).toLowerCase();
    list = list.filter(
      t =>
        t.name.toLowerCase().includes(kw) ||
        t.code.toLowerCase().includes(kw) ||
        t.owner.toLowerCase().includes(kw)
    );
  }
  if (status) list = list.filter(t => t.statusClass === status);
  const decorated = list.map(decorateTask);
  res.ok({ total: decorated.length, list: decorated });
});

/** 任务详情： GET /api/tasks/:id */
router.get('/:id', (req, res) => {
  const t = db.TASKS.find(x => x.id === req.params.id);
  if (!t) return res.fail('任务不存在', 404, 404);
  res.ok(decorateTask(t));
});

/**
 * 整体同步：PUT /api/tasks   body = { list: [...] }
 * mock 采用"整替换"语义——直接用 body 覆盖 db.TASKS
 * 真实后端可拆分为 POST/PUT/DELETE 单条
 */
router.put('/', (req, res) => {
  const list = Array.isArray(req.body && req.body.list) ? req.body.list : null;
  if (!list) return res.fail('body.list 必须为数组', 400, 400);
  db.TASKS.length = 0;
  list.forEach(t => db.TASKS.push(t));
  res.ok({ total: db.TASKS.length, syncedAt: Date.now() });
});

/** 新建单条：POST /api/tasks  body = task 对象 */
router.post('/', (req, res) => {
  const t = req.body || {};
  if (!t.id) return res.fail('缺少 id', 400, 400);
  const idx = db.TASKS.findIndex(x => x.id === t.id);
  if (idx >= 0) db.TASKS[idx] = t; else db.TASKS.push(t);
  res.ok(t);
});

/** 更新单条：PUT /api/tasks/:id  body = 变更字段 */
router.put('/:id', (req, res) => {
  const idx = db.TASKS.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.fail('任务不存在', 404, 404);
  db.TASKS[idx] = Object.assign({}, db.TASKS[idx], req.body || {});
  res.ok(db.TASKS[idx]);
});

/** 删除单条：DELETE /api/tasks/:id */
router.delete('/:id', (req, res) => {
  const idx = db.TASKS.findIndex(x => x.id === req.params.id);
  if (idx < 0) return res.fail('任务不存在', 404, 404);
  const [removed] = db.TASKS.splice(idx, 1);
  res.ok(removed);
});

/**
 * 切换当前任务：POST /api/tasks/current   body = { id: 'T001' }
 * mock 只记录到内存变量，真实后端可写入用户偏好
 */
router.post('/current', (req, res) => {
  const id = req.body && req.body.id;
  if (!id) return res.fail('缺少 id', 400, 400);
  const t = db.TASKS.find(x => x.id === id);
  if (!t) return res.fail('任务不存在', 404, 404);
  db.__currentTaskId = id;
  res.ok({ id, name: t.name });
});

/** 读取当前任务：GET /api/tasks/current */
router.get('/_/current', (req, res) => {
  res.ok({ id: db.__currentTaskId || (db.TASKS[0] && db.TASKS[0].id) || null });
});

/* ---------------- 阶段扩展字段（任务详情-编辑阶段） ---------------- */

/**
 * 读取整任务下所有阶段扩展字段
 *   GET /api/tasks/:id/stages
 *   返回：{ [subtaskId]: { [stageKey]: { status,startDate,endDate,plan,design,prepare,execute,report,alias,updatedAt } } }
 */
router.get('/:id/stages', (req, res) => {
  const taskId = req.params.id;
  const t = db.TASKS.find(x => x.id === taskId);
  if (!t) return res.fail('任务不存在', 404, 404);
  res.ok(db.STAGE_EXT[taskId] || {});
});

/**
 * 局部更新某个子任务-阶段的扩展字段
 *   PUT /api/tasks/:id/stages/:subId/:stageKey
 *   body = { status?, startDate?, endDate?, plan?, design?, prepare?, execute?, report?, alias?, c? }
 *   stageKey 建议使用数组下标（"0"/"1"/...），也兼容 "st"/"uat"/... 这种 code
 */
router.put('/:id/stages/:subId/:stageKey', (req, res) => {
  const taskId = req.params.id;
  const t = db.TASKS.find(x => x.id === taskId);
  if (!t) return res.fail('任务不存在', 404, 404);

  const subId = req.params.subId;
  const stageKey = req.params.stageKey;
  if (!subId || !stageKey) return res.fail('缺少 subId/stageKey', 400, 400);

  const patch = req.body || {};
  // 简单校验
  if (patch.startDate && patch.endDate && patch.startDate > patch.endDate) {
    return res.fail('开始时间不能晚于结束时间', 400, 400);
  }

  if (!db.STAGE_EXT[taskId]) db.STAGE_EXT[taskId] = {};
  if (!db.STAGE_EXT[taskId][subId]) db.STAGE_EXT[taskId][subId] = {};
  const old = db.STAGE_EXT[taskId][subId][stageKey] || {};
  const merged = Object.assign({}, old, patch, { updatedAt: Date.now() });
  db.STAGE_EXT[taskId][subId][stageKey] = merged;

  res.ok(merged);
});

/**
 * 批量覆盖整任务的 stages 扩展（可选，便于整体同步）
 *   PUT /api/tasks/:id/stages   body = { data: { [subId]: { [stageKey]: {...} } } }
 */
router.put('/:id/stages', (req, res) => {
  const taskId = req.params.id;
  const t = db.TASKS.find(x => x.id === taskId);
  if (!t) return res.fail('任务不存在', 404, 404);
  const data = req.body && req.body.data;
  if (!data || typeof data !== 'object') return res.fail('body.data 必须为对象', 400, 400);
  db.STAGE_EXT[taskId] = data;
  res.ok(db.STAGE_EXT[taskId]);
});

/* ---------------- 子任务（任务详情-测试范围） ---------------- */

/**
 * 读取整任务的子任务列表（含阶段/轮次结构）
 *   GET /api/tasks/:id/subtasks
 *   返回：{ list: [ { id, name, desc, dueDate, tags, stages:[{c,n,ct,status,startDate,endDate,rounds:[],owner}] } ] }
 *   说明：若后端未被前端覆盖过（SUBTASKS[taskId] 为空/不存在），返回 list=[]，
 *        前端拿到空数组表示"使用本地 TASK_DETAIL 默认种子"。
 */
router.get('/:id/subtasks', (req, res) => {
  const taskId = req.params.id;
  const t = db.TASKS.find(x => x.id === taskId);
  if (!t) return res.fail('任务不存在', 404, 404);
  const list = Array.isArray(db.SUBTASKS[taskId]) ? db.SUBTASKS[taskId] : [];
  res.ok({ list });
});

/**
 * 整体覆盖任务的子任务列表
 *   PUT /api/tasks/:id/subtasks   body = { list: [ {...} ] }
 *   说明：任务详情页的"新建/编辑子任务""新建/删除轮次""同步到测试计划"等操作都是改当前 detail 对象，
 *        前端每次写操作后一次性把 detail.subtasks 全部 PUT 上来，后端整体替换即可，最简单稳妥。
 */
router.put('/:id/subtasks', (req, res) => {
  const taskId = req.params.id;
  const t = db.TASKS.find(x => x.id === taskId);
  if (!t) return res.fail('任务不存在', 404, 404);
  const list = req.body && req.body.list;
  if (!Array.isArray(list)) return res.fail('body.list 必须为数组', 400, 400);
  // 简单校验：每个 subtask 至少带 id/name
  for (let i = 0; i < list.length; i++) {
    const s = list[i] || {};
    if (!s.id) return res.fail(`第 ${i + 1} 条子任务缺少 id`, 400, 400);
    if (!s.name) return res.fail(`第 ${i + 1} 条子任务缺少 name`, 400, 400);
    if (s.stages && !Array.isArray(s.stages)) {
      return res.fail(`第 ${i + 1} 条子任务 stages 必须为数组`, 400, 400);
    }
  }
  db.SUBTASKS[taskId] = list.slice();
  res.ok({ taskId, total: list.length, syncedAt: Date.now() });
});

module.exports = router;
