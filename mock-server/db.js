/**
 * TMS Mock 数据库（阶段 2b 增强版）
 * ------------------------------------------------------------
 * 目标：字段与 prd/测试任务管理/ 下 5 个原型页面的数据模型 100% 对齐，
 * 让 webview 侧通过 __TMS_HOOKS__.{taskList,design,execution,defect,review}
 * 的 setData 直接替换原型内部数据源后，表格/统计/筛选逻辑全部沿用原生实现。
 *
 * 数据结构要点：
 *   TASKS       —— 同阶段 1，保持不变（已被 task-list / workbench 复用）
 *   WORKBENCH   —— 同阶段 1，保持不变
 *   CASES       —— key: taskId；每条 case 同时兼容 design 与 execution 两个页面
 *   DEFECTS     —— 字段完全按 proto-defect.html 的 RAW_BUGS 模型
 *   REVIEWS     —— 字段完全按 proto-review.html 的 RAW_REVIEWS 模型
 *   REPORTS     —— 与 proto-report.html 的弱接入仅为计数提示
 */

// -------------------- 通用常量（与原型一致） --------------------

const OWNERS = [
  { name: '张小明', short: '张', color: '#0052d9' },
  { name: '李工程师', short: '李', color: '#2ba471' },
  { name: '王测试', short: '王', color: '#7b3fe4' },
  { name: '赵架构师', short: '赵', color: '#e37318' },
  { name: '孙小红', short: '孙', color: '#d64b8a' },
  { name: '周小刚', short: '周', color: '#1e9fff' }
];

/** 通过姓名取 owner 对象，缺失用第 0 个兜底——与原型 pickOwner 保持一致 */
function pickOwner(name) {
  return OWNERS.find(o => o.name === name) || OWNERS[0];
}

const STAGE_NAME = { smoke: '冒烟', st: '系统测试', regression: '回归', uat: 'UAT' };

/**
 * 任务 → 子任务 → 阶段 的约束集（与 prd 原型 SUBTASKS_BY_TASK 严格对齐）
 * 必须保持 id / stages 完全一致，否则 case/defect/review 按子任务筛选会落空
 *
 * 注：前 6 条保留老 legacyId（T001~T006）定义；后续通过 aliasTaskSubtasks() 把它们
 * 复制到新 id（T-2026-0112 等），并为另外 16 条新任务补上合理的子任务种子。
 */
const TASK_SUBTASKS = {
  T001: [
    { id: 'sub-pay-api',  name: '支付核心 API 重构',        stages: ['smoke', 'st', 'regression', 'uat'] },
    { id: 'sub-cashier',  name: '收银台前端改版',           stages: ['smoke', 'st', 'uat'] },
    { id: 'sub-risk',     name: '风控规则引擎接入',         stages: ['st', 'regression'] },
    { id: 'sub-channel',  name: '第三方渠道对接（银联/支付宝）', stages: ['smoke', 'st', 'uat'] }
  ],
  T002: [
    { id: 'sub-coupon-core',  name: '优惠券核心逻辑',   stages: ['smoke', 'st', 'regression', 'uat'] },
    { id: 'sub-coupon-ui',    name: '优惠券领取页面 H5', stages: ['smoke', 'st', 'uat'] },
    { id: 'sub-coupon-share', name: '优惠券分享与裂变', stages: ['smoke', 'st', 'uat'] }
  ],
  T003: [
    { id: 'sub-search-recall', name: '搜索召回算法回归', stages: ['st', 'regression'] },
    { id: 'sub-search-rank',   name: '搜索排序算法回归', stages: ['st', 'regression'] },
    { id: 'sub-search-ui',     name: '搜索结果页面兼容', stages: ['smoke', 'st', 'regression', 'uat'] }
  ],
  T004: [
    { id: 'sub-fulfill-perf',  name: '履约引擎压测',      stages: ['st', 'regression'] },
    { id: 'sub-fulfill-break', name: '履约系统断路测试',  stages: ['st'] }
  ],
  T005: [
    { id: 'sub-i18n-gateway',  name: '国际化网关测试',    stages: ['smoke', 'st', 'regression', 'uat'] },
    { id: 'sub-i18n-template', name: '多语言模板渲染',    stages: ['smoke', 'st', 'uat'] }
  ],
  T006: [
    { id: 'sub-login-mfa',  name: 'MFA 多因素认证流程',  stages: ['smoke', 'st', 'uat'] },
    { id: 'sub-login-risk', name: '登录风控拦截',         stages: ['st', 'regression'] }
  ]
};

/**
 * 为另外 16 条新任务补上子任务模板（按 task.id 直接索引）
 * 每条任务至少 2 个子任务，覆盖 ST / 回归 / UAT 等组合，保证详情页可见
 */
const EXTRA_TASK_SUBTASKS = {
  'T-2026-0120': [
    { id: 'sub-sdk-compat', name: '埋点 SDK 兼容性测试', stages: ['smoke', 'st'] },
    { id: 'sub-sdk-perf',   name: '埋点 SDK 性能测试',   stages: ['st', 'regression'] }
  ],
  'T-2026-0121': [
    { id: 'sub-im-read',    name: 'IM 已读回执核心逻辑', stages: ['smoke', 'st', 'regression', 'uat'] },
    { id: 'sub-im-push',    name: 'IM 推送联动测试',     stages: ['st', 'uat'] }
  ],
  'T-2026-0122': [
    { id: 'sub-unionpay-core', name: '银联通道核心流程', stages: ['smoke', 'st', 'regression', 'uat'] },
    { id: 'sub-unionpay-fb',   name: '银联异常回滚测试', stages: ['st', 'regression'] }
  ],
  'T-2026-0099': [
    { id: 'sub-rbac-core',  name: 'RBAC 权限核心测试',    stages: ['st', 'regression', 'uat'] },
    { id: 'sub-rbac-audit', name: '操作审计日志验证',     stages: ['st', 'uat'] }
  ],
  'T-2026-0100': [
    { id: 'sub-danmu-perf',    name: '弹幕服务压测',        stages: ['st', 'regression'] },
    { id: 'sub-danmu-degrade', name: '弹幕降级策略测试',    stages: ['st'] }
  ],
  'T-2026-0123': [
    { id: 'sub-order-filter', name: '订单筛选器重构',    stages: ['smoke', 'st', 'uat'] },
    { id: 'sub-order-export', name: '筛选结果导出测试',  stages: ['st', 'regression'] }
  ],
  'T-2026-0124': [
    { id: 'sub-share-ui',    name: '分享卡片样式改版',  stages: ['smoke', 'st', 'uat'] },
    { id: 'sub-share-track', name: '分享埋点与跳转测试', stages: ['st'] }
  ],
  'T-2026-0125': [
    { id: 'sub-sms-switch', name: '短信通道切换演练',   stages: ['st', 'regression'] },
    { id: 'sub-sms-alert',  name: '故障告警联动测试',   stages: ['st', 'uat'] }
  ],
  'T-2026-0126': [
    { id: 'sub-live-gift',   name: '礼物特效回归测试', stages: ['smoke', 'st', 'regression'] },
    { id: 'sub-live-perf',   name: '礼物动画性能专项', stages: ['st', 'regression'] }
  ],
  'T-2026-0127': [
    { id: 'sub-fx-core',     name: '多币种汇率核心测试', stages: ['smoke', 'st', 'regression', 'uat'] },
    { id: 'sub-fx-degrade',  name: '汇率降级策略测试',   stages: ['st'] }
  ],
  'T-2026-0101': [
    { id: 'sub-audit-text',  name: '文本审核全链路',    stages: ['st', 'regression', 'uat'] },
    { id: 'sub-audit-image', name: '图片审核全链路',    stages: ['st', 'uat'] }
  ],
  'T-2026-0128': [
    { id: 'sub-coupon-mix',   name: '优惠券叠加规则核心', stages: ['smoke', 'st', 'regression', 'uat'] },
    { id: 'sub-coupon-gray',  name: '优惠券灰度策略测试', stages: ['st', 'regression'] }
  ],
  'T-2026-0129': [
    { id: 'sub-ab-connect',   name: 'AB 实验平台对接', stages: ['smoke', 'st'] },
    { id: 'sub-ab-rule',      name: '分流规则验证',    stages: ['st', 'regression'] }
  ],
  'T-2026-0130': [
    { id: 'sub-app-cold',     name: 'App 冷启动基线',    stages: ['st', 'regression'] },
    { id: 'sub-app-memory',   name: 'App 内存占用评测',  stages: ['st', 'regression'] }
  ],
  'T-2026-0102': [
    { id: 'sub-weak-network', name: '弱网场景专项测试',  stages: ['st', 'regression'] },
    { id: 'sub-reconnect',    name: '断线重连测试',      stages: ['st'] }
  ],
  'T-2026-0131': [
    { id: 'sub-pos-match',    name: 'POS 对账核心逻辑',  stages: ['smoke', 'st', 'regression', 'uat'] },
    { id: 'sub-pos-retry',    name: 'POS 异常重试测试',  stages: ['st', 'regression'] }
  ]
};

function findSubtask(taskId, subId) {
  const list = TASK_SUBTASKS[taskId] || [];
  return list.find(s => s.id === subId) || list[0];
}

// -------------------- 测试任务（task-list 页面） --------------------

const TASKS = [
  // —— 前 6 条：保留与原 mock 语义一致，id 升级为新格式，老 id 保留为 legacyId 供 TASK_SUBTASKS/CASES/DEFECTS/REVIEWS 复用
  { id: 'T-2026-0112', legacyId: 'T001', code: 'T-2026-0112', name: '支付中心重构测试',           statusClass: 'status-exec',   statusText: '执行中', owner: '张小明',   progress: 68,  startDate: '2026-03-01', endDate: '2026-05-08', desc: '重构核心支付链路并完成全流程回归测试' },
  { id: 'T-2026-0115', legacyId: 'T002', code: 'T-2026-0115', name: '会员体系 H5 新增优惠券模块', statusClass: 'status-design', statusText: '设计中', owner: '李工程师', progress: 25,  startDate: '2026-03-20', endDate: '2026-05-15', desc: '会员 H5 增加优惠券领取与核销模块' },
  { id: 'T-2026-0108', legacyId: 'T003', code: 'T-2026-0108', name: '商品搜索算法优化回归测试',   statusClass: 'status-review', statusText: '评审中', owner: '王测试',   progress: 82,  startDate: '2026-02-10', endDate: '2026-04-28', desc: '搜索排序算法升级后回归测试' },
  { id: 'T-2026-0113', legacyId: 'T004', code: 'T-2026-0113', name: '订单履约系统性能测试',       statusClass: 'status-exec',   statusText: '执行中', owner: '赵架构师', progress: 45,  startDate: '2026-03-15', endDate: '2026-05-05', desc: '订单履约链路端到端性能压测' },
  { id: 'T-2026-0117', legacyId: 'T005', code: 'T-2026-0117', name: '消息推送服务国际化改造',     statusClass: 'status-exec',   statusText: '执行中', owner: '孙小红',   progress: 55,  startDate: '2026-03-25', endDate: '2026-05-10', desc: '消息推送多语言与多时区支持' },
  { id: 'T-2026-0098', legacyId: 'T006', code: 'T-2026-0098', name: '用户登录安全增强验收',       statusClass: 'status-done',   statusText: '已完成', owner: '周小刚',   progress: 100, startDate: '2026-01-10', endDate: '2026-04-18', desc: '登录链路安全增强项验收' },

  // —— 扩展 17 条：覆盖全部 9 种状态（含 draft/pending/paused/delay/closed），与 proto-task-list.html / tms-global-task.js 数据保持一致
  { id: 'T-2026-0120', code: 'T-2026-0120', name: '客户端埋点 SDK 升级测试',     statusClass: 'status-draft',   statusText: '草稿',   owner: '孙小红',   progress: 0,  startDate: '2026-04-10', endDate: '',           desc: '埋点 SDK 1.x → 2.0 升级兼容测试（草稿）' },
  { id: 'T-2026-0121', code: 'T-2026-0121', name: 'IM 消息已读回执功能测试',     statusClass: 'status-design',  statusText: '设计中', owner: '孙小红',   progress: 22, startDate: '2026-04-12', endDate: '2026-05-12', desc: 'IM 消息已读/未读回执、推送联动测试' },
  { id: 'T-2026-0122', code: 'T-2026-0122', name: '支付渠道扩展-银联通道接入',   statusClass: 'status-exec',    statusText: '执行中', owner: '张小明',   progress: 70, startDate: '2026-03-18', endDate: '2026-05-06', desc: '新增银联支付通道，核心链路与回滚方案验证' },
  { id: 'T-2026-0099', code: 'T-2026-0099', name: '后台权限模块重构验收',         statusClass: 'status-done',    statusText: '已完成', owner: '李工程师', progress: 100,startDate: '2026-01-20', endDate: '2026-04-10', desc: 'RBAC 权限改造与操作审计日志验收' },
  { id: 'T-2026-0100', code: 'T-2026-0100', name: '视频弹幕服务压测',             statusClass: 'status-done',    statusText: '已完成', owner: '王测试',   progress: 100,startDate: '2026-02-01', endDate: '2026-04-08', desc: '弹幕服务高并发压测与降级策略验证' },
  { id: 'T-2026-0123', code: 'T-2026-0123', name: '商家后台订单筛选优化',         statusClass: 'status-review',  statusText: '评审中', owner: '赵架构师', progress: 80, startDate: '2026-03-05', endDate: '2026-04-30', desc: '筛选器重构与筛选结果导出优化' },
  { id: 'T-2026-0124', code: 'T-2026-0124', name: '小程序分享卡片改版',           statusClass: 'status-design',  statusText: '设计中', owner: '孙小红',   progress: 20, startDate: '2026-04-05', endDate: '2026-05-16', desc: '分享卡片样式与交互改版' },
  { id: 'T-2026-0125', code: 'T-2026-0125', name: '短信通道容灾切换演练',         statusClass: 'status-exec',    statusText: '执行中', owner: '张小明',   progress: 48, startDate: '2026-03-28', endDate: '2026-05-04', desc: '短信通道故障切换与监控告警联动演练' },
  { id: 'T-2026-0126', code: 'T-2026-0126', name: '直播间礼物特效回归',           statusClass: 'status-paused',  statusText: '已暂停', owner: '王测试',   progress: 55, startDate: '2026-03-22', endDate: '2026-05-02', desc: '礼物动画回归与性能专项，当前暂停' },
  { id: 'T-2026-0127', code: 'T-2026-0127', name: '海外支付汇率转换测试',         statusClass: 'status-design',  statusText: '设计中', owner: '李工程师', progress: 18, startDate: '2026-04-08', endDate: '2026-05-20', desc: '多币种汇率核心与降级策略设计' },
  { id: 'T-2026-0101', code: 'T-2026-0101', name: '内容审核链路端到端验收',       statusClass: 'status-done',    statusText: '已完成', owner: '孙小红',   progress: 100,startDate: '2026-02-18', endDate: '2026-04-14', desc: '文本/图片审核全链路验收' },
  { id: 'T-2026-0128', code: 'T-2026-0128', name: '优惠券叠加规则灰度测试',       statusClass: 'status-review',  statusText: '评审中', owner: '张小明',   progress: 86, startDate: '2026-03-10', endDate: '2026-04-26', desc: '优惠券叠加规则核心与灰度策略评审' },
  { id: 'T-2026-0129', code: 'T-2026-0129', name: '推荐位 AB 实验平台对接',       statusClass: 'status-pending', statusText: '待启动', owner: '王测试',   progress: 0,  startDate: '',           endDate: '',           desc: '推荐位 AB 实验平台对接（待启动）' },
  { id: 'T-2026-0130', code: 'T-2026-0130', name: 'App 启动性能基线评测',         statusClass: 'status-delay',   statusText: '已延期', owner: '赵架构师', progress: 52, startDate: '2026-03-20', endDate: '2026-05-05', desc: 'App 冷启动基线压测，因环境资源不足延期' },
  { id: 'T-2026-0102', code: 'T-2026-0102', name: '音视频会议弱网专项',           statusClass: 'status-closed',  statusText: '已关闭', owner: '王测试',   progress: 100,startDate: '2026-02-05', endDate: '2026-04-05', desc: '弱网场景专项测试，已关闭归档' },
  { id: 'T-2026-0131', code: 'T-2026-0131', name: '门店 POS 机对账功能测试',     statusClass: 'status-design',  statusText: '设计中', owner: '李工程师', progress: 15, startDate: '2026-04-11', endDate: '2026-05-18', desc: '门店 POS 对账核心与异常重试设计' }
];

// -------------------- 工作台（workbench 页面） --------------------

// 保留老 legacyId 的细化数据，同时下方为 22 条新 id 补上合理汇总
const WORKBENCH = {
  T001: {
    summary: { totalCases: 324, designed: 298, executed: 210, passed: 180, failed: 30, blocked: 8, defects: 26 },
    todo: [
      { id: 'W1', type: '用例执行', text: '支付-退款失败场景 12 条用例待执行', time: '今天 10:00' },
      { id: 'W2', type: '缺陷跟进', text: 'BUG-2026-0123 待复测', time: '今天 14:30' },
      { id: 'W3', type: '评审',   text: '性能测试用例评审会', time: '明天 10:00' }
    ]
  },
  T002: {
    summary: { totalCases: 120, designed: 60, executed: 0, passed: 0, failed: 0, blocked: 0, defects: 0 },
    todo: [{ id: 'W1', type: '用例设计', text: '优惠券核销异常分支用例补充', time: '今天 17:00' }]
  },
  T003: {
    summary: { totalCases: 260, designed: 260, executed: 240, passed: 212, failed: 22, blocked: 6, defects: 18 },
    todo: [{ id: 'W1', type: '评审', text: '测试报告定稿评审', time: '明天 16:00' }]
  },
  T004: { summary: { totalCases: 180, designed: 150, executed: 85, passed: 70, failed: 10, blocked: 5, defects: 9 }, todo: [] },
  T005: { summary: { totalCases: 210, designed: 190, executed: 110, passed: 95, failed: 12, blocked: 3, defects: 11 }, todo: [] },
  T006: { summary: { totalCases: 156, designed: 156, executed: 156, passed: 150, failed: 6, blocked: 0, defects: 6 }, todo: [] }
};

/** 根据任务状态构造工作台汇总与待办，与 CASES/DEFECTS 数量一致 */
function buildWorkbenchForTask(task) {
  const cases = CASES[task.id] || [];
  const defects = DEFECTS[task.id] || [];
  const executed = cases.filter(c => c.executed).length;
  const passed   = cases.filter(c => c.execStatus === 'passed').length;
  const failed   = cases.filter(c => c.execStatus === 'failed').length;
  const blocked  = cases.filter(c => c.execStatus === 'blocked').length;
  const designed = cases.filter(c => c.status === 'approved' || c.status === 'review').length;
  const todo = [];
  if (failed > 0) todo.push({ id: 'W-' + task.id + '-1', type: '用例执行', text: '待复测失败用例 ' + failed + ' 条', time: '今天 10:00' });
  if (defects.length > 0) todo.push({ id: 'W-' + task.id + '-2', type: '缺陷跟进', text: '待跟进缺陷 ' + defects.length + ' 个', time: '今天 14:30' });
  if (task.statusClass === 'status-review') todo.push({ id: 'W-' + task.id + '-3', type: '评审', text: '测试报告评审会', time: '明天 10:00' });
  if (task.statusClass === 'status-design') todo.push({ id: 'W-' + task.id + '-4', type: '用例设计', text: '核心用例大纲设计', time: '今天 17:00' });
  return {
    summary: {
      totalCases: cases.length,
      designed: designed,
      executed: executed,
      passed: passed,
      failed: failed,
      blocked: blocked,
      defects: defects.length
    },
    todo: todo
  };
}

// 老 legacyId 的细化手写数据优先映射到对应新 id；剩下新 id 的自动构造推迟到 CASES/DEFECTS 初始化之后执行
TASKS.forEach(function (t) {
  if (t.legacyId && WORKBENCH[t.legacyId] && !WORKBENCH[t.id]) {
    WORKBENCH[t.id] = WORKBENCH[t.legacyId];
  }
});

// -------------------- 用例（design + execution 共用） --------------------

/**
 * 每条 case 同时具备 design/execution 所需字段：
 *   design 必需：id,name,path,type,priority,status(+statusText),owner(name),subtask,stage,updated
 *   execution 必需：id,name,path,type,priority,execType,ownerIdx,subtask,stage
 *     （execution 还需要 execStatus/execTime/duration/bugs 等运行时字段，
 *      但原型 execution 自己会从初始态开始填充；为了让 hook 注入后仍能正确呈现，
 *      我们直接把这些字段塞成合理初值——passed/failed 会被执行统计用到）
 */
const DESIGN_STATUS = [
  { c: 'draft',      t: '草稿' },
  { c: 'review',     t: '评审中' },
  { c: 'approved',   t: '已通过' },
  { c: 'deprecated', t: '已废弃' }
];

// 简单的 execType 推断
function inferExecType(name) {
  const n = String(name);
  if (/性能|压测|并发|吞吐/.test(n)) return 'perf';
  if (/安全|权限|越权|注入/.test(n)) return 'security';
  if (/接口|API|回调/.test(n)) return 'api';
  return 'func';
}

// 每个 (taskId, subId, stage) 下的用例标题模板——每项 3 条，保证筛选后可见
const CASE_TITLE_TPL = {
  'sub-pay-api':  ['创建支付订单-主流程', '支付回调-签名校验', '退款申请-部分退款'],
  'sub-cashier':  ['收银台首屏渲染', '收银台-优惠券选择', '收银台-重复提交拦截'],
  'sub-risk':     ['风控规则命中-拦截', '风控白名单放行', '风控策略-阈值调整'],
  'sub-channel':  ['银联渠道-支付成功', '支付宝渠道-异常降级', '渠道路由-默认通道'],
  'sub-coupon-core':  ['优惠券发放-正常', '优惠券核销-金额充足', '优惠券互斥校验'],
  'sub-coupon-ui':    ['领券页-首屏加载', '领券页-已领取提示', '领券-移动端兼容'],
  'sub-coupon-share': ['分享链路-微信', '分享奖励-发放', '裂变层级-上限校验'],
  'sub-search-recall': ['关键词召回-精准', '关键词召回-模糊', '同义词扩展召回'],
  'sub-search-rank':   ['排序算法-热销优先', '排序算法-相关度', '排序降级-默认策略'],
  'sub-search-ui':     ['结果页-首屏', '结果页-空结果兜底', '结果页-无限滚动'],
  'sub-fulfill-perf':  ['履约引擎-并发 500', '履约引擎-并发 1000', '履约引擎-持续 10min'],
  'sub-fulfill-break': ['依赖库存断路', '依赖WMS断路', '依赖物流断路'],
  'sub-i18n-gateway':  ['网关-多语言头解析', '网关-时区转换', '网关-语言回退策略'],
  'sub-i18n-template': ['模板-中英切换', '模板-阿拉伯语 RTL', '模板-缺失回退默认'],
  'sub-login-mfa':     ['短信验证码-登录成功', 'TOTP-登录成功', '备用码-登录'],
  'sub-login-risk':    ['异地登录-拦截', '设备指纹-拦截', '登录频控-拦截']
};

const PRIORITIES = ['P0', 'P1', 'P2', 'P3'];

/** 根据 taskId 生成完整 case 数组（design + execution 双兼容） */
function buildCasesForTask(taskId) {
  const subs = TASK_SUBTASKS[taskId] || [];
  const out = [];
  let idx = 0;
  subs.forEach(sub => {
    sub.stages.forEach(stageCode => {
      const titles = CASE_TITLE_TPL[sub.id] || ['用例1', '用例2', '用例3'];
      titles.forEach((title, ti) => {
        const ownerIdx = (idx + ti) % OWNERS.length;
        const ownerObj = OWNERS[ownerIdx];
        const designStat = DESIGN_STATUS[(idx + ti) % DESIGN_STATUS.length];
        const day = String(10 + ((idx * 3 + ti) % 15)).padStart(2, '0');
        const hour = 9 + ((idx + ti) % 9);
        // 模拟 execution 的执行状态：30% passed, 20% failed, 10% blocked, 其余 pending
        const r = (idx * 7 + ti * 11) % 10;
        let execStatus = 'pending';
        if (r < 3) execStatus = 'passed';
        else if (r < 5) execStatus = 'failed';
        else if (r < 6) execStatus = 'blocked';
        const executed = execStatus !== 'pending';
        const type = inferExecType(title);
        out.push({
          id: 'CASE-' + (2600 + idx * 10 + ti),
          // design 字段
          name: title,
          title: title,                                   // route 层按 title 搜索
          code: 'TC-' + taskId + '-' + (idx * 10 + ti),    // route 层按 code 搜索
          module: sub.name,                                // route 层按 module 搜索
          path: sub.name + ' / ' + STAGE_NAME[stageCode],
          type: type,
          priority: PRIORITIES[(idx + ti) % PRIORITIES.length],
          status: designStat.c,
          statusText: designStat.t,
          owner: ownerObj.name,
          ownerObj: ownerObj,
          subtask: sub.id,
          stage: stageCode,
          updated: '2026-04-' + day + ' ' + hour + ':30',
          // execution 额外字段
          execType: type,
          ownerIdx: ownerIdx,
          execStatus: execStatus,
          executed: executed,
          execTime: executed ? '2026-04-' + day + ' ' + hour + ':45' : '',
          duration: executed ? ((ti + 1) * 120) : 0,       // 秒
          bugs: execStatus === 'failed' ? 1 : 0,
          round: 1
        });
      });
      idx++;
    });
  });
  return out;
}

// 先把 legacyId(T001~T006) 的子任务定义复制到新 id；再合并 16 条新任务的子任务定义
// 这样 TASK_SUBTASKS 就同时具备 22 条（legacyId + 新 id 双键交叠，老数据/老调用也兼容）
TASKS.forEach(function (t) {
  if (t.legacyId && TASK_SUBTASKS[t.legacyId] && !TASK_SUBTASKS[t.id]) {
    // 深拷贝，避免后续修改相互影响
    TASK_SUBTASKS[t.id] = TASK_SUBTASKS[t.legacyId].map(function (s) {
      return { id: s.id, name: s.name, stages: s.stages.slice() };
    });
  }
});
Object.keys(EXTRA_TASK_SUBTASKS).forEach(function (k) {
  if (!TASK_SUBTASKS[k]) TASK_SUBTASKS[k] = EXTRA_TASK_SUBTASKS[k];
});

// 为 22 条新 id 全量生成用例，同时保留 legacyId 的老数据以方便旧 hook 兼容
const CASES = {};
TASKS.forEach(function (t) { CASES[t.id] = buildCasesForTask(t.id); });
// legacyId 同时保留一份，便于老 hook/旧数据入口
TASKS.forEach(function (t) {
  if (t.legacyId) CASES[t.legacyId] = buildCasesForTask(t.id);
});

// -------------------- 缺陷（defect 页面） --------------------

/**
 * proto-defect.html RAW_BUGS 字段：
 *   id, title, severity(S0/S1/S2/S3), priority(P0-P3), type(功能/UI/性能/安全/兼容/接口),
 *   status(open/in_progress/fixed/verifying/closed/rejected/reopen),
 *   module, stage, assignee(姓名), reporter(姓名), created
 *
 * 注意：原型 BUGS = RAW_BUGS.map(注入 assigneeObj/reporterObj/subtask)
 *       我们这里直接给"完整态"（即 map 后的结果），hook 内兼容地检测 assigneeObj 存在则跳过 map
 */
const DEFECT_TYPES = ['功能', 'UI', '性能', '安全', '兼容', '接口'];
const DEFECT_STATUSES = ['open', 'in_progress', 'fixed', 'verifying', 'closed', 'reopen', 'rejected'];
const SEVERITIES = ['S0', 'S1', 'S2', 'S3'];

function buildDefectsForTask(taskId, count) {
  const subs = TASK_SUBTASKS[taskId] || [];
  const out = [];
  for (let i = 0; i < count; i++) {
    const sub = subs[i % subs.length];
    const stage = sub.stages[i % sub.stages.length];
    const assigneeObj = OWNERS[i % OWNERS.length];
    const reporterObj = OWNERS[(i + 2) % OWNERS.length];
    const sev = SEVERITIES[i % SEVERITIES.length];
    const status = DEFECT_STATUSES[i % DEFECT_STATUSES.length];
    const type = DEFECT_TYPES[i % DEFECT_TYPES.length];
    const prio = PRIORITIES[i % PRIORITIES.length];
    const day = String(5 + (i % 20)).padStart(2, '0');
    out.push({
      id: 'BUG-' + taskId + '-' + String(1000 + i).slice(1),
      code: 'BUG-' + taskId + '-' + String(1000 + i).slice(1),
      title: '[' + sub.name + '] 缺陷 ' + (i + 1) + ' - ' + type,
      severity: sev,
      priority: prio,
      type: type,
      status: status,
      module: sub.name,
      stage: stage,
      assignee: assigneeObj.name,
      reporter: reporterObj.name,
      assigneeObj: assigneeObj,
      reporterObj: reporterObj,
      subtask: sub.id,
      created: '2026-04-' + day,
      // 兼容 task-list 工作台统计里用的 owner/created 字段
      owner: assigneeObj.name
    });
  }
  return out;
}

/** 根据任务状态决定缺陷数量 */
function pickDefectCount(task) {
  switch (task.statusClass) {
    case 'status-done':    return 8;
    case 'status-closed':  return 6;
    case 'status-exec':    return 10;
    case 'status-review':  return 12;
    case 'status-delay':   return 9;
    case 'status-paused':  return 7;
    case 'status-design':  return 2;
    case 'status-pending': return 0;
    case 'status-draft':   return 0;
    default:               return 3;
  }
}

const DEFECTS = {};
TASKS.forEach(function (t) { DEFECTS[t.id] = buildDefectsForTask(t.id, pickDefectCount(t)); });
TASKS.forEach(function (t) {
  if (t.legacyId) DEFECTS[t.legacyId] = buildDefectsForTask(t.id, pickDefectCount(t));
});

// WORKBENCH 的 summary 依赖 CASES/DEFECTS，上面只做了 legacyId → 新 id 的继承映射；
// 这里才能调 buildWorkbenchForTask 给剩下的新 id（16 条扩展任务）生成汇总与待办。
TASKS.forEach(function (t) {
  if (!WORKBENCH[t.id]) WORKBENCH[t.id] = buildWorkbenchForTask(t);
});

// -------------------- 评审（review 页面） --------------------

/**
 * proto-review.html RAW_REVIEWS 字段：
 *   id, title, type(plan/design/summary), way(email/meeting),
 *   subtask, owner(0-based index), members(index array),
 *   time, status(pending/reviewing/passed/failed/canceled), pass, total
 *
 * 原型 REVIEWS = RAW_REVIEWS.map 注入 ownerObj / memberObjs
 * 这里同样给"完整态"，hook 会检测 ownerObj 已存在则跳过 map
 */
const REVIEW_TYPES = ['plan', 'design', 'summary'];
const REVIEW_WAYS  = ['email', 'meeting'];
const REVIEW_STATUS = ['pending', 'reviewing', 'passed', 'failed', 'canceled'];

function buildReviewsForTask(taskId, count) {
  const subs = TASK_SUBTASKS[taskId] || [];
  const out = [];
  for (let i = 0; i < count; i++) {
    const sub = subs[i % subs.length];
    const ownerIdx = i % OWNERS.length;
    const memberIdxs = [ownerIdx, (ownerIdx + 1) % OWNERS.length, (ownerIdx + 3) % OWNERS.length];
    const type = REVIEW_TYPES[i % REVIEW_TYPES.length];
    const way = REVIEW_WAYS[i % REVIEW_WAYS.length];
    const status = REVIEW_STATUS[i % REVIEW_STATUS.length];
    const total = 3;
    const pass = status === 'passed' ? 3 : status === 'reviewing' ? 1 : 0;
    const day = String(10 + (i % 18)).padStart(2, '0');
    const hour = 9 + (i % 9);
    out.push({
      id: 'RV-' + taskId + '-' + String(1000 + i).slice(1),
      title: '[' + sub.name + '] ' + (type === 'plan' ? '测试计划评审' : type === 'design' ? '测试设计评审' : '测试总结评审'),
      type: type,
      way: way,
      subtask: sub.id,
      owner: ownerIdx,
      members: memberIdxs,
      ownerObj: OWNERS[ownerIdx],
      memberObjs: memberIdxs.map(k => OWNERS[k]),
      time: '2026-04-' + day + ' ' + hour + ':30',
      status: status,
      pass: pass,
      total: total
    });
  }
  return out;
}

function pickReviewCount(task) {
  switch (task.statusClass) {
    case 'status-done':
    case 'status-closed':  return 5;
    case 'status-exec':    return 4;
    case 'status-review':  return 6;
    case 'status-delay':   return 4;
    case 'status-paused':  return 3;
    case 'status-design':  return 3;
    case 'status-pending': return 1;
    case 'status-draft':   return 0;
    default:               return 2;
  }
}

const REVIEWS = {};
TASKS.forEach(function (t) {
  REVIEWS[t.id] = buildReviewsForTask(t.id, pickReviewCount(t));
});
TASKS.forEach(function (t) {
  if (t.legacyId) REVIEWS[t.legacyId] = buildReviewsForTask(t.id, pickReviewCount(t));
});

// -------------------- 测试报告（report 页面弱接入） --------------------

/** 根据任务状态决定生成几份报告、以何种状态 */
function buildReportsForTask(task) {
  const list = [];
  const shortName = task.name.replace(/测试$|验收$|回归$|改造$|专项$|演练$/, '') || task.name;
  const owner = task.owner || '张小明';
  const id = task.id;
  switch (task.statusClass) {
    case 'status-done':
    case 'status-closed':
      list.push({ id: 'R-' + id + '-1', code: 'RPT-' + id + '-1', title: shortName + '-整体测试报告', round: '终版', status: 'published', owner: owner, created: task.endDate || '2026-04-20' });
      break;
    case 'status-review':
      list.push({ id: 'R-' + id + '-1', code: 'RPT-' + id + '-1', title: shortName + '-阶段测试报告', round: '第1轮', status: 'published', owner: owner, created: '2026-04-15' });
      list.push({ id: 'R-' + id + '-2', code: 'RPT-' + id + '-2', title: shortName + '-评审版报告', round: '评审稿', status: 'draft', owner: owner, created: '2026-04-22' });
      break;
    case 'status-exec':
    case 'status-delay':
      list.push({ id: 'R-' + id + '-1', code: 'RPT-' + id + '-1', title: shortName + '-阶段一测试报告', round: '第1轮', status: 'published', owner: owner, created: '2026-04-10' });
      list.push({ id: 'R-' + id + '-2', code: 'RPT-' + id + '-2', title: shortName + '-阶段二测试报告', round: '第2轮', status: 'draft', owner: owner, created: '2026-04-22' });
      break;
    case 'status-paused':
      list.push({ id: 'R-' + id + '-1', code: 'RPT-' + id + '-1', title: shortName + '-当前阶段报告', round: '第1轮', status: 'draft', owner: owner, created: '2026-04-18' });
      break;
    default:
      // draft / pending / design 等：暂无报告
      break;
  }
  return list;
}

const REPORTS = {};
TASKS.forEach(function (t) { REPORTS[t.id] = buildReportsForTask(t); });
TASKS.forEach(function (t) {
  if (t.legacyId) REPORTS[t.legacyId] = buildReportsForTask(t);
});

// -------------------- 阶段扩展字段（任务详情页的"编辑阶段") --------------------
// 结构：STAGE_EXT[taskId][subtaskId][stageKey] = {
//    alias, status, startDate, endDate, plan, design, prepare, execute, report, updatedAt
// }
// stageKey 建议使用阶段数组下标（"0"/"1"/...），这样对老数据也能稳定绑定，
// 若原型切换了 stage.c，也不会引起数据错位。
// 初始为空，所有字段由前端编辑后落盘；不存在即视为未编辑。
const STAGE_EXT = {};

// -------------------- 子任务持久化（任务详情页的子任务 / 阶段 / 轮次） --------------------
// 结构：SUBTASKS[taskId] = [ { id, name, desc, dueDate, tags, stages:[{c,n,ct,status,startDate,endDate,rounds:[{name,date,synced}],owner}] } ]
// 为 22 条任务生成完整的子任务种子，任务详情页打开任何一条新任务都能正常展示子任务/阶段数据
const STAGE_LABEL = { smoke: '冒烟', st: 'ST', regression: '回归', uat: 'UAT' };

function buildSeedSubtasksForTask(task) {
  const subs = TASK_SUBTASKS[task.id] || [];
  if (!subs.length) return [];
  const cases = CASES[task.id] || [];
  return subs.map(function (sub) {
    return {
      id: sub.id,
      name: sub.name,
      desc: sub.name + ' 的测试范围与关键场景',
      dueDate: task.endDate || '',
      tags: [],
      stages: sub.stages.map(function (code) {
        const ct = cases.filter(c => c.subtask === sub.id && c.stage === code).length;
        return {
          c: code,
          n: STAGE_LABEL[code] || code,
          ct: ct,
          status: 'pending',
          startDate: task.startDate || '',
          endDate: task.endDate || '',
          owner: task.owner || '',
          rounds: []
        };
      })
    };
  });
}

const SUBTASKS = {};
TASKS.forEach(function (t) { SUBTASKS[t.id] = buildSeedSubtasksForTask(t); });

// -------------------- 数据持久化（B+ 阶段新增） --------------------
// 将可变集合（TASKS/CASES/DEFECTS/REVIEWS/REPORTS/WORKBENCH）落盘到 data.json。
// 启动时若存在则优先加载，使重启后新增/修改/删除的数据不丢。
// 只持久化"可写"部分，OWNERS/TASK_SUBTASKS 仍保留为静态约束。

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const MUTABLE_KEYS = ['TASKS', 'WORKBENCH', 'CASES', 'DEFECTS', 'REPORTS', 'REVIEWS', 'STAGE_EXT', 'SUBTASKS'];

/** 把 memory 中的对象内容 in-place 替换为 src 的内容，保持外部 require 的引用不变 */
function replaceInPlace(target, src) {
  if (Array.isArray(target)) {
    target.length = 0;
    if (Array.isArray(src)) src.forEach(x => target.push(x));
    return;
  }
  if (target && typeof target === 'object') {
    Object.keys(target).forEach(k => { delete target[k]; });
    if (src && typeof src === 'object') {
      Object.keys(src).forEach(k => { target[k] = src[k]; });
    }
  }
}

/**
 * 老版本 data.json 迁移：如果数据桶的 key 还是 T001~T006 （而内存 TASKS 已是新 id），
 * 按 legacyId → id 把数据拷一份到新 id，老持久化数据既不丢又能被新路由命中
 */
function migrateLegacyKeys(bucket) {
  if (!bucket || typeof bucket !== 'object') return;
  TASKS.forEach(function (t) {
    if (!t.legacyId) return;
    if (bucket[t.legacyId] !== undefined && bucket[t.id] === undefined) {
      bucket[t.id] = bucket[t.legacyId];
    }
  });
}

function loadFromDisk() {
  try {
    if (!fs.existsSync(DATA_FILE)) return false;
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return false;
    const mem = { TASKS, WORKBENCH, CASES, DEFECTS, REPORTS, REVIEWS, STAGE_EXT, SUBTASKS };
    MUTABLE_KEYS.forEach(k => {
      if (data[k] !== undefined) replaceInPlace(mem[k], data[k]);
    });
    // 老版本 key 自动迁移（T001~T006 → T-2026-xxxx）
    ['WORKBENCH', 'CASES', 'DEFECTS', 'REPORTS', 'REVIEWS', 'STAGE_EXT', 'SUBTASKS'].forEach(function (k) {
      migrateLegacyKeys(mem[k]);
    });
    // 迁移后对新任务（老 data.json 中没有的 16 条）补上种子数据
    TASKS.forEach(function (t) {
      if (!CASES[t.id]) CASES[t.id] = buildCasesForTask(t.id);
      if (!DEFECTS[t.id]) DEFECTS[t.id] = buildDefectsForTask(t.id, pickDefectCount(t));
      if (!REVIEWS[t.id]) REVIEWS[t.id] = buildReviewsForTask(t.id, pickReviewCount(t));
      if (!REPORTS[t.id]) REPORTS[t.id] = buildReportsForTask(t);
      if (!WORKBENCH[t.id]) WORKBENCH[t.id] = buildWorkbenchForTask(t);
      if (!Array.isArray(SUBTASKS[t.id]) || SUBTASKS[t.id].length === 0) {
        SUBTASKS[t.id] = buildSeedSubtasksForTask(t);
      }
    });
    console.log('[db] 已从 data.json 恢复数据（含老 key 自动迁移与种子补齐）');
    return true;
  } catch (e) {
    console.warn('[db] 加载 data.json 失败：', e.message);
    return false;
  }
}

// 异步防抖写入：50ms 合并同一批连续写操作
let persistTimer = null;
function persist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const snapshot = { TASKS, WORKBENCH, CASES, DEFECTS, REPORTS, REVIEWS, STAGE_EXT, SUBTASKS };
      fs.writeFileSync(DATA_FILE, JSON.stringify(snapshot, null, 2), 'utf-8');
    } catch (e) {
      console.warn('[db] 写入 data.json 失败：', e.message);
    }
  }, 50);
}

/** 清空持久化数据，回到初始种子数据（主要用于测试） */
function resetPersisted() {
  try { if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE); } catch (_) {}
}

loadFromDisk();

module.exports = {
  TASKS,
  WORKBENCH,
  CASES,
  DEFECTS,
  REPORTS,
  REVIEWS,
  STAGE_EXT,
  SUBTASKS,
  TASK_SUBTASKS,
  OWNERS,
  persist,
  resetPersisted
};
