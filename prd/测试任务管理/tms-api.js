/**
 * TMS 通用后端 API 接入器
 * ------------------------------------------------------------
 * 作用：
 *   1) 为所有页面提供统一的 fetch 封装 window.TMSApi；
 *   2) 自动识别每个页面暴露的 __TMS_HOOKS__.{taskList,design,execution,defect,review} 钩子，
 *      页面加载后：
 *        - GET  从后端拉取数据 → 调 hook.setData 覆盖本地数组；
 *        - 周期性脏检测：若 hook.getData() 返回的数组内容变化，
 *          自动整表 PUT 到后端；
 *        - 切换当前任务 / 页面卸载前 flush 一次。
 *   3) 让 task-list 页面点"+ 新建测试任务"等写操作天然生效，无需改页面源码。
 *
 * 依赖：
 *   - 必须在 tms-global-task.js 之后加载（需要 TMSGlobal.getCurrentId）；
 *   - mock-server 已实现 /api/tasks, /api/cases, /api/defects, /api/reviews, /api/reports。
 *
 * 后端地址：默认 http://localhost:3001，可通过 window.TMS_BACKEND_BASE 覆盖。
 */
(function (w) {
  var BASE = w.TMS_BACKEND_BASE || "http://localhost:3001";

  /* ==================== 基础 fetch 封装 ==================== */
  function req(method, url, body) {
    var opts = { method: method };
    if (body !== undefined) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }
    return fetch(BASE + url, opts).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return null; }).then(function (j) {
          throw new Error((j && j.msg) || ("HTTP " + r.status));
        });
      }
      return r.json();
    }).then(function (j) {
      if (j && j.code === 0) return j.data;
      throw new Error((j && j.msg) || "bad resp");
    });
  }

  var TMSApi = {
    base: BASE,
    // ----------- tasks -----------
    listTasks: function () { return req("GET", "/api/tasks"); },
    putTasks: function (list) { return req("PUT", "/api/tasks", { list: list }); },
    // ----------- cases -----------
    listCases: function (taskId) {
      return req("GET", "/api/cases?taskId=" + encodeURIComponent(taskId) + "&pageSize=500");
    },
    putCases: function (taskId, list) {
      return req("PUT", "/api/cases?taskId=" + encodeURIComponent(taskId), { list: list });
    },
    // ----------- defects -----------
    listDefects: function (taskId) {
      return req("GET", "/api/defects?taskId=" + encodeURIComponent(taskId));
    },
    putDefects: function (taskId, list) {
      return req("PUT", "/api/defects?taskId=" + encodeURIComponent(taskId), { list: list });
    },
    // ----------- reviews -----------
    listReviews: function (taskId) {
      return req("GET", "/api/reviews?taskId=" + encodeURIComponent(taskId));
    },
    putReviews: function (taskId, list) {
      return req("PUT", "/api/reviews?taskId=" + encodeURIComponent(taskId), { list: list });
    },
    // ----------- reports -----------
    listReports: function (taskId) {
      return req("GET", "/api/reports?taskId=" + encodeURIComponent(taskId));
    },
    putReports: function (taskId, list) {
      return req("PUT", "/api/reports?taskId=" + encodeURIComponent(taskId), { list: list });
    },
    // ----------- subtasks (任务详情页用) -----------
    listSubtasks: function (taskId) {
      return req("GET", "/api/tasks/" + encodeURIComponent(taskId) + "/subtasks");
    },
    putSubtasks: function (taskId, list) {
      return req("PUT", "/api/tasks/" + encodeURIComponent(taskId) + "/subtasks", { list: list });
    },
    // ----------- workbench -----------
    getWorkbenchSummary: function (taskId) {
      return req("GET", "/api/workbench/summary?taskId=" + encodeURIComponent(taskId || ""));
    }
  };

  w.TMSApi = TMSApi;

  /* ==================== 通用 Toast（静默提示写入结果） ==================== */
  var toastEl, toastTimer;
  function showToast(msg, isError) {
    try {
      if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.style.cssText =
          "position:fixed;right:20px;bottom:20px;z-index:10002;" +
          "padding:8px 14px;border-radius:4px;font-size:12.5px;" +
          "color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.2);opacity:0;" +
          "transition:opacity .2s;pointer-events:none";
        document.body.appendChild(toastEl);
      }
      toastEl.style.background = isError ? "#d54941" : "#2ba471";
      toastEl.textContent = msg;
      toastEl.style.opacity = "1";
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.style.opacity = "0"; }, 1800);
    } catch (e) {}
  }

  /* ==================== 序列化工具（剔除循环引用） ==================== */
  function safeClone(arr) {
    try {
      return JSON.parse(JSON.stringify(arr || []));
    } catch (e) {
      return [];
    }
  }

  /* ==================== Hook 自动挂载器 ==================== */
  /**
   * 为单个 hook 注入"加载→脏检测→自动写回"链路。
   * opts:
   *   - name        : 用于 toast 的中文名（如 "用例"）
   *   - hookKey     : __TMS_HOOKS__ 下的 key（taskList/design/execution/defect/review）
   *   - needTaskId  : true 表示该资源按 taskId 分桶（cases/defects/reviews）；false 表示全局（tasks）
   *   - load(taskId): 返回 Promise<Array>
   *   - save(taskId, list): 返回 Promise
   *   - isEmpty(list): 可选，判断 list 是否"空可忽略"
   */
  function attachHook(opts) {
    var hooks = w.__TMS_HOOKS__ || {};
    var hook = hooks[opts.hookKey];
    if (!hook || typeof hook.setData !== "function" || typeof hook.getData !== "function") {
      return; // 当前页面没有这个 hook，跳过
    }

    var curTaskId = null;
    var baseline = "[]";      // 上次 PUT 成功后的快照
    var syncing = false;      // 正在 PUT 中，避免并发
    var dirtyTimer = null;    // 防抖定时器

    function getTaskId() {
      if (!opts.needTaskId) return null;
      try {
        return (w.TMSGlobal && w.TMSGlobal.getCurrentId && w.TMSGlobal.getCurrentId()) || null;
      } catch (e) { return null; }
    }

    /** 首次/切换任务时加载 */
    function reload() {
      var tid = getTaskId();
      curTaskId = tid;
      var p = opts.needTaskId ? opts.load(tid) : opts.load();
      return p.then(function (list) {
        if (!Array.isArray(list)) return;
        // 若后端返回空数组但本地已有种子数据，保持本地数据（避免清空原型）
        var local = [];
        try { local = hook.getData() || []; } catch (e) {}
        if (list.length === 0 && local.length > 0) {
          try { baseline = JSON.stringify(safeClone(local)); } catch (e) {}
          return;
        }
        try {
          hook.setData(list);
          baseline = JSON.stringify(safeClone(hook.getData()));
        } catch (e) {
          console.warn("[TMSApi] setData failed:", e);
        }
      }).catch(function (err) {
        // 后端不可达时静默（仍使用原型的本地种子数据）
        console.warn("[TMSApi] " + opts.hookKey + " 加载失败，使用本地数据：", err && err.message);
        try { baseline = JSON.stringify(safeClone(hook.getData())); } catch (e) {}
      });
    }

    /** 触发一次脏检测：若与 baseline 不同则 PUT */
    function flush(sync) {
      if (syncing) return;
      var cur;
      try { cur = JSON.stringify(safeClone(hook.getData())); } catch (e) { return; }
      if (cur === baseline) return;
      var snapshot = cur;            // 捕获此刻的快照值
      var listCopy = JSON.parse(cur);
      syncing = true;
      var p = opts.needTaskId ? opts.save(curTaskId, listCopy) : opts.save(listCopy);
      p.then(function () {
        baseline = snapshot;
        showToast("✓ " + opts.name + "已保存");
      }).catch(function (err) {
        console.warn("[TMSApi] " + opts.hookKey + " 写入失败：", err && err.message);
        showToast("✗ " + opts.name + "保存失败：" + (err && err.message || err), true);
      }).then(function () {
        syncing = false;
      });
    }

    /** 防抖的 flush（被轮询调用） */
    function scheduleFlush() {
      if (dirtyTimer) return;
      dirtyTimer = setTimeout(function () {
        dirtyTimer = null;
        flush();
      }, 300);
    }

    /* 初次加载 */
    reload();

    /* 轮询脏检测：每 800ms 比一次，足够覆盖所有"先改数组再调 render"的写操作 */
    setInterval(function () {
      if (syncing) return;
      try {
        var cur = JSON.stringify(safeClone(hook.getData()));
        if (cur !== baseline) scheduleFlush();
      } catch (e) {}
    }, 800);

    /* 切换当前任务：先 flush 旧任务，再重新 load 新任务 */
    if (opts.needTaskId && w.TMSGlobal && typeof w.TMSGlobal.onChange === "function") {
      w.TMSGlobal.onChange(function () {
        // 先同步把当前未落盘的提交
        flush();
        // 略作延迟确保上面的 put 已发出，再 reload
        setTimeout(reload, 350);
      });
    }

    /* 离开页面前 flush（使用 sendBeacon 兜底） */
    w.addEventListener("beforeunload", function () {
      try {
        var cur = JSON.stringify(safeClone(hook.getData()));
        if (cur === baseline) return;
        var url = opts.beaconUrl && opts.beaconUrl(curTaskId);
        if (!url || !navigator.sendBeacon) return;
        var blob = new Blob([JSON.stringify({ list: JSON.parse(cur) })], {
          type: "application/json"
        });
        navigator.sendBeacon(url, blob);
      } catch (e) {}
    });
  }

  /* ==================== 工作台只读挂载 ====================
   * workbench 页提供 __TMS_HOOKS__.workbench = {
   *   // 单任务 summary（切换任务时调用）
   *   applySummary: function (payload) { ... }  // payload = { summary, todo }
   *   // 可选：聚合所有任务的 todo，供"全局待办"视图使用
   *   mergeTodos:   function (items) { ... }    // items = [{id,type,text,time,taskId,taskName}]
   * }
   * - 首次加载：对 TMSGlobal.getAll() 中的每个任务并发拉取 summary，合并所有 todo
   *   调 mergeTodos（若存在），再对当前任务调 applySummary；
   * - 切换任务：对新的当前任务调 applySummary。
   */
  function attachWorkbench() {
    var hooks = w.__TMS_HOOKS__ || {};
    var hook = hooks.workbench;
    if (!hook || (typeof hook.applySummary !== "function" && typeof hook.mergeTodos !== "function")) return;

    function getCurTaskId() {
      try {
        return (w.TMSGlobal && w.TMSGlobal.getCurrentId && w.TMSGlobal.getCurrentId()) || null;
      } catch (e) { return null; }
    }

    function loadCurrent() {
      var tid = getCurTaskId();
      if (!tid || typeof hook.applySummary !== "function") return;
      TMSApi.getWorkbenchSummary(tid).then(function (payload) {
        try { hook.applySummary(payload || { summary: null, todo: [] }); }
        catch (e) { console.warn("[TMSApi] workbench.applySummary failed:", e); }
      }).catch(function (err) {
        console.warn("[TMSApi] workbench 加载失败：", err && err.message);
      });
    }

    function loadAllTodos() {
      if (typeof hook.mergeTodos !== "function") return;
      var tasks = [];
      try { tasks = (w.TMSGlobal && w.TMSGlobal.getAll && w.TMSGlobal.getAll()) || []; } catch (e) {}
      if (!tasks.length) return;
      // 并发拉取，失败忽略单个任务
      var promises = tasks.map(function (t) {
        return TMSApi.getWorkbenchSummary(t.id).then(function (p) {
          var todos = (p && p.todo) || [];
          return todos.map(function (x) {
            return Object.assign({}, x, { taskId: t.id, taskName: t.name });
          });
        }).catch(function () { return []; });
      });
      Promise.all(promises).then(function (arrs) {
        var merged = [];
        arrs.forEach(function (a) { merged = merged.concat(a); });
        try { hook.mergeTodos(merged); }
        catch (e) { console.warn("[TMSApi] workbench.mergeTodos failed:", e); }
      });
    }

    // 首次 + 任务切换
    loadAllTodos();
    loadCurrent();
    if (w.TMSGlobal && typeof w.TMSGlobal.onChange === "function") {
      w.TMSGlobal.onChange(function () { setTimeout(loadCurrent, 50); });
    }
  }

  /* ==================== 子任务下拉数据预拉取（design/execution/defect/review 共用） ====================
   * 4 个业务页面都有独立的 #selSubtask 下拉，数据源依赖本地 SUBTASKS_BY_TASK，
   * 但该字典只配置了老 legacyId(T001~T006)。若当前任务是扩展出来的新 id
   * （如 T-2026-0115 会员体系 H5），resolveSubtasks 会落到 DEFAULT_SUBTASKS，
   * 导致下拉里看不到真正的测试子任务（sub-coupon-core 等），无法过滤出用例/缺陷/评审。
   *
   * 做法：启动 / 切换任务时，从 /api/tasks/:id/subtasks 拉取完整子任务列表，
   *      转为原型期望的 { id, name, stages:[{code,name}] } 结构，
   *      挂到 window.TMS_SUBTASKS[taskId] 和 window.TMS_SUBTASKS_CURRENT，
   *      并派发 'tms_subtasks_ready' 事件让页面重渲染下拉。
   */
  var STAGE_NAME_MAP = {
    smoke: "冒烟测试", st: "系统测试（ST）", regression: "回归测试",
    uat: "用户验收（UAT）", design: "设计中", merge: "合并测试"
  };

  function normalizeSubtasksPayload(raw) {
    // 后端 /api/tasks/:id/subtasks 返回形态 {list:[{id,name,stages:[{c,n,...}]}]}
    var list = (raw && raw.list) || (Array.isArray(raw) ? raw : []);
    return list.map(function (s) {
      var stages = Array.isArray(s.stages) ? s.stages : [];
      var mapped = stages.map(function (st) {
        // st 可能是 {c,n} 对象（详情页结构），也可能是纯 code 字符串（TASK_SUBTASKS 简化结构）
        if (typeof st === "string") {
          return { code: st, name: STAGE_NAME_MAP[st] || st };
        }
        var code = st.c || st.code || "";
        var name = st.n || st.name || STAGE_NAME_MAP[code] || code;
        return { code: code, name: name };
      }).filter(function (x) { return x.code; });
      return { id: s.id, name: s.name, stages: mapped };
    });
  }

  function attachSubtasksPreloader() {
    w.TMS_SUBTASKS = w.TMS_SUBTASKS || {};

    function pullFor(tid) {
      if (!tid) return Promise.resolve([]);
      return TMSApi.listSubtasks(tid).then(function (data) {
        var normalized = normalizeSubtasksPayload(data);
        w.TMS_SUBTASKS[tid] = normalized;
        return normalized;
      }).catch(function (err) {
        console.warn("[TMSApi] 预拉取 subtasks 失败：", err && err.message);
        return [];
      });
    }

    function refreshCurrent() {
      var tid = null;
      try { tid = w.TMSGlobal && w.TMSGlobal.getCurrentId && w.TMSGlobal.getCurrentId(); } catch (e) {}
      if (!tid) return;
      pullFor(tid).then(function (list) {
        w.TMS_SUBTASKS_CURRENT = list;
        try {
          w.dispatchEvent(new CustomEvent("tms_subtasks_ready", {
            detail: { taskId: tid, list: list }
          }));
        } catch (e) {}
      });
    }

    refreshCurrent();
    if (w.TMSGlobal && typeof w.TMSGlobal.onChange === "function") {
      w.TMSGlobal.onChange(function () { setTimeout(refreshCurrent, 50); });
    }
    // 暴露手动刷新入口，便于页面调用
    TMSApi.refreshSubtasks = refreshCurrent;
  }

  /* ==================== 页面就绪后按 hook 匹配注入 ==================== */
  function autoAttach() {
    attachSubtasksPreloader();
    attachHook({
      name: "测试任务", hookKey: "taskList", needTaskId: false,
      /**
       * 列表页本地 TASKS 里带着后端未下发的展示字段（如任务列表展开行依赖的
       * subtasks[stage/statusText/owner/passRate...] 子任务摘要、tags、mine 等），
       * 直接用后端返回覆盖会把这些字段洗掉，导致"展开任务行子任务空"。
       * 这里按 id 合并：以后端字段为主，本地专有字段兜底保留。
       */
      load: function () {
        return TMSApi.listTasks().then(function (d) {
          var remote = (d && d.list) || [];
          var hooks = w.__TMS_HOOKS__ || {};
          var hook = hooks.taskList;
          var localArr = [];
          try { localArr = (hook && hook.getData && hook.getData()) || []; } catch (e) {}
          var localMap = {};
          localArr.forEach(function (t) { if (t && t.id) localMap[t.id] = t; });
          return remote.map(function (r) {
            var l = localMap[r.id];
            if (!l) return r;
            var merged = Object.assign({}, l, r); // 后端字段优先
            // 列表展开行用的子任务摘要（结构与详情页不同）由本地兜底
            if (!Array.isArray(r.subtasks) || r.subtasks.length === 0) {
              if (Array.isArray(l.subtasks)) merged.subtasks = l.subtasks;
            }
            // 同理保留 tags / mine / status 这类本地展示字段（后端若下发则以后端为准）
            if (r.tags === undefined && l.tags !== undefined) merged.tags = l.tags;
            if (r.mine === undefined && l.mine !== undefined) merged.mine = l.mine;
            if (r.status === undefined && l.status !== undefined) merged.status = l.status;
            return merged;
          });
        });
      },
      save: function (list) { return TMSApi.putTasks(list); },
      beaconUrl: function () { return BASE + "/api/tasks"; }
    });
    attachHook({
      name: "测试用例", hookKey: "design", needTaskId: true,
      load: function (tid) { return tid ? TMSApi.listCases(tid).then(function (d) { return d && d.list; }) : Promise.resolve([]); },
      save: function (tid, list) { return tid ? TMSApi.putCases(tid, list) : Promise.reject(new Error("无 taskId")); },
      beaconUrl: function (tid) { return BASE + "/api/cases?taskId=" + encodeURIComponent(tid); }
    });
    attachHook({
      name: "用例执行", hookKey: "execution", needTaskId: true,
      load: function (tid) { return tid ? TMSApi.listCases(tid).then(function (d) { return d && d.list; }) : Promise.resolve([]); },
      save: function (tid, list) { return tid ? TMSApi.putCases(tid, list) : Promise.reject(new Error("无 taskId")); },
      beaconUrl: function (tid) { return BASE + "/api/cases?taskId=" + encodeURIComponent(tid); }
    });
    attachHook({
      name: "缺陷", hookKey: "defect", needTaskId: true,
      load: function (tid) { return tid ? TMSApi.listDefects(tid).then(function (d) { return d && d.list; }) : Promise.resolve([]); },
      save: function (tid, list) { return tid ? TMSApi.putDefects(tid, list) : Promise.reject(new Error("无 taskId")); },
      beaconUrl: function (tid) { return BASE + "/api/defects?taskId=" + encodeURIComponent(tid); }
    });
    attachHook({
      name: "评审", hookKey: "review", needTaskId: true,
      load: function (tid) { return tid ? TMSApi.listReviews(tid).then(function (d) { return d && d.list; }) : Promise.resolve([]); },
      save: function (tid, list) { return tid ? TMSApi.putReviews(tid, list) : Promise.reject(new Error("无 taskId")); },
      beaconUrl: function (tid) { return BASE + "/api/reviews?taskId=" + encodeURIComponent(tid); }
    });
    attachHook({
      name: "测试报告", hookKey: "report", needTaskId: true,
      load: function (tid) { return tid ? TMSApi.listReports(tid).then(function (d) { return d && d.list; }) : Promise.resolve([]); },
      save: function (tid, list) { return tid ? TMSApi.putReports(tid, list) : Promise.reject(new Error("无 taskId")); },
      beaconUrl: function (tid) { return BASE + "/api/reports?taskId=" + encodeURIComponent(tid); }
    });
    /* workbench：只读聚合视图，不走脏检测写回，单独挂 */
    attachWorkbench();
  }

  /* 等 DOMContentLoaded 后再跑，确保 hook 脚本已执行 */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { setTimeout(autoAttach, 0); });
  } else {
    setTimeout(autoAttach, 0);
  }
})(window);
