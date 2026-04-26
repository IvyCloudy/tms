/**
 * TMS 全局测试任务状态管理
 * ------------------------------------------------------------
 * 用于在"工作台 / 测试任务 / 设计管理 / 执行管理 / 缺陷管理 / 评审管理"
 * 等所有页面共享同一个"当前测试任务"。
 *
 * 对外 API：window.TMSGlobal
 *   - getAll()              获取所有可切换的任务列表
 *   - getCurrent()          获取当前任务对象
 *   - getCurrentId()        获取当前任务 id
 *   - setCurrent(id)        切换当前任务，自动广播给所有监听器
 *   - onChange(cb)          订阅当前任务变化（跨页面/跨标签页）
 *   - mount(selector, opts) 将某个 .task-switcher 元素挂载为全局组件
 *                           - opts.showToast   切换时是否显示 Toast（默认 true）
 *   - renderDropdown(el)    把任务列表渲染到下拉面板
 */
(function(w){
  var LS_KEY = "tms_current_task_id";
  var EVT    = "tms:current-task-change";

  /* =========== 统一任务数据 =========== */
  /* statusClass 覆盖全链路典型状态：
     status-draft   草稿（尚未启动）
     status-pending 待启动（已创建但未开始）
     status-design  设计中
     status-exec    执行中
     status-review  评审中
     status-paused  已暂停
     status-delay   已延期（进行中但超期）
     status-done    已完成
     status-closed  已关闭（归档） */
  var STATUS_STYLE = {
    "status-draft":   { bg:"#f0f2f5", color:"#8a94a6", text:"草稿" },
    "status-pending": { bg:"#eef4ff", color:"#2d6cdf", text:"待启动" },
    "status-design":  { bg:"#e8f3ff", color:"#0052d9", text:"设计中" },
    "status-exec":    { bg:"#fff3e0", color:"#e37318", text:"执行中" },
    "status-review":  { bg:"#f3e8ff", color:"#7b3fe4", text:"评审中" },
    "status-paused":  { bg:"#fff8e0", color:"#bb8500", text:"已暂停" },
    "status-delay":   { bg:"#fef0f0", color:"#e34d59", text:"已延期" },
    "status-done":    { bg:"#e8f8f0", color:"#2ba471", text:"已完成" },
    "status-closed":  { bg:"#edf0f5", color:"#606c7f", text:"已关闭" }
  };

  /* 统一任务池（与 proto-task-list.html 完全对齐；ID 统一 T-2026-XXXX 格式）
     覆盖：草稿 / 待启动 / 设计中 / 执行中 / 评审中 / 已暂停 / 已延期 / 已完成 / 已关闭 9 种状态 */
  var TASKS = [
    { id:"T-2026-0112", code:"T-2026-0112", name:"支付中心重构测试",
      statusClass:"status-exec",    statusText:"执行中",   owner:"张小明" },
    { id:"T-2026-0115", code:"T-2026-0115", name:"会员体系 H5 新增优惠券模块",
      statusClass:"status-design",  statusText:"设计中",   owner:"李工程师" },
    { id:"T-2026-0108", code:"T-2026-0108", name:"商品搜索算法优化回归测试",
      statusClass:"status-review",  statusText:"评审中",   owner:"王测试" },
    { id:"T-2026-0113", code:"T-2026-0113", name:"订单履约系统性能测试",
      statusClass:"status-delay",   statusText:"已延期",   owner:"赵架构师" },
    { id:"T-2026-0117", code:"T-2026-0117", name:"消息推送服务国际化改造",
      statusClass:"status-exec",    statusText:"执行中",   owner:"孙小红" },
    { id:"T-2026-0098", code:"T-2026-0098", name:"用户登录安全增强验收",
      statusClass:"status-done",    statusText:"已完成",   owner:"周小刚" },
    { id:"T-2026-0120", code:"T-2026-0120", name:"客户端埋点 SDK 升级测试",
      statusClass:"status-draft",   statusText:"草稿",     owner:"陈晓晨" },
    { id:"T-2026-0121", code:"T-2026-0121", name:"IM 消息已读回执功能测试",
      statusClass:"status-design",  statusText:"设计中",   owner:"孙小红" },
    { id:"T-2026-0122", code:"T-2026-0122", name:"支付渠道扩展-银联通道接入",
      statusClass:"status-exec",    statusText:"执行中",   owner:"张小明" },
    { id:"T-2026-0099", code:"T-2026-0099", name:"后台权限模块重构验收",
      statusClass:"status-done",    statusText:"已完成",   owner:"李工程师" },
    { id:"T-2026-0100", code:"T-2026-0100", name:"视频弹幕服务压测",
      statusClass:"status-closed",  statusText:"已关闭",   owner:"王测试" },
    { id:"T-2026-0123", code:"T-2026-0123", name:"商家后台订单筛选优化",
      statusClass:"status-review",  statusText:"评审中",   owner:"赵架构师" },
    { id:"T-2026-0124", code:"T-2026-0124", name:"小程序分享卡片改版",
      statusClass:"status-pending", statusText:"待启动",   owner:"孙小红" },
    { id:"T-2026-0125", code:"T-2026-0125", name:"短信通道容灾切换演练",
      statusClass:"status-exec",    statusText:"执行中",   owner:"张小明" },
    { id:"T-2026-0126", code:"T-2026-0126", name:"直播间礼物特效回归",
      statusClass:"status-paused",  statusText:"已暂停",   owner:"王测试" },
    { id:"T-2026-0127", code:"T-2026-0127", name:"海外支付汇率转换测试",
      statusClass:"status-design",  statusText:"设计中",   owner:"李工程师" },
    { id:"T-2026-0101", code:"T-2026-0101", name:"内容审核链路端到端验收",
      statusClass:"status-done",    statusText:"已完成",   owner:"孙小红" },
    { id:"T-2026-0128", code:"T-2026-0128", name:"优惠券叠加规则灰度测试",
      statusClass:"status-review",  statusText:"评审中",   owner:"张小明" },
    { id:"T-2026-0130", code:"T-2026-0130", name:"App 启动性能基线评测",
      statusClass:"status-delay",   statusText:"已延期",   owner:"赵架构师" },
    { id:"T-2026-0131", code:"T-2026-0131", name:"门店 POS 机对账功能测试",
      statusClass:"status-pending", statusText:"待启动",   owner:"李工程师" }
  ];

  function getAll(){ return TASKS.slice(); }
  function findById(id){
    for(var i = 0; i < TASKS.length; i++) if(TASKS[i].id === id) return TASKS[i];
    return null;
  }
  function getCurrentId(){
    var id = null;
    try{ id = w.localStorage.getItem(LS_KEY); }catch(e){}
    if(!id || !findById(id)) id = TASKS[0].id;
    return id;
  }
  function getCurrent(){ return findById(getCurrentId()); }

  var listeners = [];
  function onChange(cb){ if(typeof cb === "function") listeners.push(cb); }
  function emit(detail){
    listeners.forEach(function(cb){ try{ cb(detail); }catch(e){} });
    try{
      w.dispatchEvent(new CustomEvent(EVT, { detail: detail }));
    }catch(e){}
  }

  function setCurrent(id){
    var to = findById(id);
    if(!to) return false;
    var fromId = getCurrentId();
    if(fromId === id) return false;
    var from = findById(fromId);
    try{ w.localStorage.setItem(LS_KEY, id); }catch(e){}
    emit({ from: from, to: to });
    return true;
  }

  /* 跨标签页同步 */
  w.addEventListener("storage", function(e){
    if(e.key !== LS_KEY) return;
    var to = findById(e.newValue);
    var from = findById(e.oldValue);
    if(!to) return;
    emit({ from: from, to: to, crossTab: true });
  });

  /* =========== DOM：挂载任务切换器 =========== */
  function escapeHtml(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  /**
   * 把 .task-switcher 根据全局状态完整渲染一次（含下拉面板）
   * opts: { showToast: true|false }
   */
  function mount(rootSelectorOrEl, opts){
    opts = opts || {};
    var root = typeof rootSelectorOrEl === "string"
      ? document.querySelector(rootSelectorOrEl)
      : rootSelectorOrEl;
    if(!root) return;

    root.classList.add("tms-switcher");
    root.setAttribute("data-tms-switcher", "1");

    /* 若原有结构缺失节点，则补齐；保留外层样式类 .task-switcher */
    if(!root.querySelector(".ts-current")){
      root.innerHTML =
        '<span class="ts-current"></span>' +
        '<span class="ts-arrow">▼</span>';
    }

    /* 创建下拉面板（若不存在） */
    var panelId = root.getAttribute("data-dropdown-id") || "tmsTaskDropdown";
    var panel = document.getElementById(panelId);
    if(!panel){
      panel = document.createElement("div");
      panel.id = panelId;
      panel.className = "tms-dropdown";
      document.body.appendChild(panel);
      injectDropdownStyle();
    }
    root.setAttribute("data-dropdown-id", panelId);

    /* 渲染一次 */
    renderSwitcher(root);
    renderDropdown(panel);

    /* 展开/收起 */
    root.addEventListener("click", function(e){
      e.stopPropagation();
      var visible = panel.style.display === "block";
      /* 先关闭其他所有下拉 */
      document.querySelectorAll(".tms-dropdown").forEach(function(p){ p.style.display = "none"; });
      if(!visible){
        var r = root.getBoundingClientRect();
        panel.style.display = "block";
        panel.style.top  = (r.bottom + window.scrollY + 4) + "px";
        panel.style.left = (r.left + window.scrollX) + "px";
        panel.style.minWidth = r.width + "px";
      }
    });
    document.addEventListener("click", function(e){
      if(!e.target.closest(".tms-dropdown") && !e.target.closest('[data-tms-switcher]')){
        panel.style.display = "none";
      }
    });

    /* 绑定自定义 tooltip，鼠标移入立即显示完整任务名 */
    bindTooltip(root);

    /* 订阅变更 */
    onChange(function(ev){
      renderSwitcher(root);
      renderDropdown(panel);
      /* 闪烁动画 */
      root.classList.remove("tms-flash");
      void root.offsetWidth;
      root.classList.add("tms-flash");
      /* Toast */
      if(opts.showToast !== false && ev && ev.to){
        showToast(ev.from, ev.to);
      }
    });
  }

  function renderSwitcher(root){
    var cur = getCurrent();
    var cn = root.querySelector(".ts-current");
    if(cn){
      cn.innerHTML = escapeHtml(cur.name);
    }
    /* 在根节点上记录当前任务名，供自定义 tooltip 读取 */
    root.setAttribute("data-tms-fullname", cur.name);
    /* 移除浏览器原生 title，避免与自定义 tooltip 叠加显示 */
    root.removeAttribute("title");
    if(cn) cn.removeAttribute("title");
  }

  /* =========== 自定义 Tooltip （鼠标移入立即显示完整任务名） =========== */
  var tipEl = null, tipTimer = null;
  function ensureTip(){
    if(tipEl) return tipEl;
    tipEl = document.createElement("div");
    tipEl.className = "tms-switcher-tip";
    document.body.appendChild(tipEl);
    return tipEl;
  }
  function showTip(root){
    var name = root.getAttribute("data-tms-fullname") || "";
    if(!name) return;
    var tip = ensureTip();
    tip.textContent = name;
    tip.style.display = "block";
    var r = root.getBoundingClientRect();
    /* 先显示以获取实际宽高，再计算位置：放置到切换器右侧 */
    var tw = tip.offsetWidth;
    var th = tip.offsetHeight;
    var gap = 8;
    var left = r.right + window.scrollX + gap;
    /* 若右侧放不下则回落到左侧 */
    var viewportRight = window.scrollX + document.documentElement.clientWidth - 8;
    if(left + tw > viewportRight){
      left = r.left + window.scrollX - tw - gap;
      if(left < window.scrollX + 8) left = window.scrollX + 8;
    }
    /* 垂直方向与切换器居中对齐 */
    var top = r.top + window.scrollY + (r.height - th) / 2;
    if(top < window.scrollY + 8) top = window.scrollY + 8;
    tip.style.top  = top + "px";
    tip.style.left = left + "px";
    /* 触发淡入动画 */
    requestAnimationFrame(function(){ tip.classList.add("show"); });
  }
  function hideTip(){
    if(!tipEl) return;
    tipEl.classList.remove("show");
    clearTimeout(tipTimer);
    tipTimer = setTimeout(function(){
      if(tipEl) tipEl.style.display = "none";
    }, 150);
  }
  function bindTooltip(root){
    if(root.getAttribute("data-tms-tip-bound") === "1") return;
    root.setAttribute("data-tms-tip-bound", "1");
    root.addEventListener("mouseenter", function(){ showTip(root); });
    root.addEventListener("mouseleave", hideTip);
  }

  function renderDropdown(panel){
    var cur = getCurrentId();
    panel.innerHTML =
      '<div class="tms-dropdown-head">' +
        '<input class="tms-dropdown-search" placeholder="搜索任务名 / 编号 / 负责人">' +
      '</div>' +
      '<div class="tms-dropdown-list">' +
        TASKS.map(function(t){
          var sty = STATUS_STYLE[t.statusClass] || STATUS_STYLE["status-exec"];
          return '<div class="tms-dropdown-item' + (t.id === cur ? " current" : "") + '" data-id="' + t.id + '">' +
            '<div class="tms-di-main">' +
            '<span class="tms-di-code">' + escapeHtml(t.code) + '</span>' +
              '<span class="tms-di-name" title="' + escapeHtml(t.name) + '">' + escapeHtml(t.name) + '</span>' +
            '</div>' +
            '<span class="tms-di-tag" style="background:' + sty.bg + ';color:' + sty.color + '">' +
              escapeHtml(t.statusText) +
            '</span>' +
            (t.id === cur ? '<span class="tms-di-check">✓</span>' : '') +
          '</div>';
        }).join("") +
      '</div>';

    panel.querySelectorAll(".tms-dropdown-item").forEach(function(el){
      el.addEventListener("click", function(e){
        e.stopPropagation();
        setCurrent(el.getAttribute("data-id"));
        panel.style.display = "none";
      });
    });

    var kw = panel.querySelector(".tms-dropdown-search");
    if(kw){
      kw.addEventListener("click", function(e){ e.stopPropagation(); });
      kw.addEventListener("input", function(){
        var q = kw.value.trim().toLowerCase();
        panel.querySelectorAll(".tms-dropdown-item").forEach(function(el){
          var id = el.getAttribute("data-id");
          var t = findById(id);
          var hay = (t.name + " " + t.code + " " + t.owner).toLowerCase();
          el.style.display = (!q || hay.indexOf(q) >= 0) ? "" : "none";
        });
      });
    }
  }

  /* =========== 样式注入 =========== */
  function injectDropdownStyle(){
    if(document.getElementById("tms-dropdown-style")) return;
    var s = document.createElement("style");
    s.id = "tms-dropdown-style";
    s.innerHTML =
      ".tms-dropdown{position:absolute;z-index:9999;display:none;background:#fff;" +
      "border:1px solid #e5e9ef;border-radius:4px;box-shadow:0 6px 18px rgba(0,0,0,.1);" +
      "min-width:340px;max-width:460px;padding:8px 0;font-size:12.5px;color:#333}" +
      ".tms-dropdown-head{padding:4px 10px 8px;border-bottom:1px solid #f0f2f5;margin-bottom:4px}" +
      ".tms-dropdown-search{width:100%;padding:5px 8px;font-size:12px;border:1px solid #dde3ea;" +
      "border-radius:3px;outline:none}" +
      ".tms-dropdown-search:focus{border-color:#0052d9}" +
      ".tms-dropdown-list{max-height:320px;overflow-y:auto;padding:0 6px 4px}" +
      ".tms-dropdown-item{display:flex;align-items:center;padding:7px 8px;border-radius:3px;cursor:pointer}" +
      ".tms-dropdown-item:hover{background:#f0f6ff}" +
      ".tms-dropdown-item.current{background:#f0f6ff}" +
      ".tms-di-main{flex:1;display:flex;align-items:baseline;gap:8px;min-width:0}" +
      ".tms-di-code{font-family:'SF Mono','Menlo',monospace;font-size:10.5px;color:#888;flex-shrink:0}" +
      ".tms-di-name{color:#1a1a1a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".tms-di-tag{font-size:10px;padding:1px 6px;border-radius:2px;margin-left:6px;flex-shrink:0}" +
      ".tms-di-check{color:#0052d9;font-weight:600;margin-left:6px}" +
      ".tms-flash{animation:tmsSwitcherFlash .8s ease}" +
      "@keyframes tmsSwitcherFlash{" +
      "  0%{box-shadow:0 0 0 0 rgba(0,82,217,.55);background:#e8f3ff}" +
      " 100%{box-shadow:0 0 0 8px rgba(0,82,217,0);background:inherit}}" +
      /* 全局 Toast */
      ".tms-toast{position:fixed;top:70px;left:50%;transform:translateX(-50%) translateY(-16px);" +
      "background:#1a1a1a;color:#fff;padding:10px 18px;border-radius:4px;font-size:12.5px;" +
      "box-shadow:0 6px 18px rgba(0,0,0,.25);opacity:0;pointer-events:none;transition:all .25s;z-index:10000}" +
      ".tms-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}" +
      ".tms-toast .tc-from{opacity:.7;margin:0 4px}" +
      ".tms-toast .tc-to{color:#7fd0ff;font-weight:600;margin-left:4px}" +
      /* 自定义完整任务名 Tooltip（显示在切换器右侧，浅色背景 + 深色字） */
      ".tms-switcher-tip{position:absolute;z-index:10001;display:none;max-width:420px;" +
      "padding:6px 10px;background:#ffffff;color:#1a1a1a;font-size:12.5px;" +
      "line-height:1.4;border:1px solid #e5e9ef;border-radius:4px;" +
      "box-shadow:0 6px 18px rgba(0,0,0,.12);" +
      "white-space:normal;word-break:break-all;pointer-events:none;opacity:0;transform:translateX(-2px);" +
      "transition:opacity .12s ease,transform .12s ease}" +
      ".tms-switcher-tip.show{opacity:1;transform:translateX(0)}";
    document.head.appendChild(s);
  }

  /* =========== Toast =========== */
  var toastEl = null, toastTimer = null;
  function showToast(from, to){
    injectDropdownStyle();
    if(!toastEl){
      toastEl = document.createElement("div");
      toastEl.className = "tms-toast";
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = '✓ 已切换当前任务：' +
      '<span class="tc-from">' + escapeHtml(from ? from.name : "—") + '</span>' +
      '→<span class="tc-to">' + escapeHtml(to.name) + '</span>';
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove("show"); }, 2400);
  }

  /* =========== 暴露 =========== */
  w.TMSGlobal = {
    getAll: getAll,
    getCurrent: getCurrent,
    getCurrentId: getCurrentId,
    setCurrent: setCurrent,
    onChange: onChange,
    mount: mount,
    renderDropdown: renderDropdown,
    STATUS_STYLE: STATUS_STYLE,
    /**
     * 注册/合并外部任务（列表页里完整任务池的任一行，点击任务编号时调用）
     * info: { id, code, name, statusClass, statusText, owner }
     */
    upsertTask: function(info){
      if(!info || !info.id) return;
      var exist = findById(info.id);
      if(exist){
        Object.keys(info).forEach(function(k){ if(info[k] != null) exist[k] = info[k]; });
      }else{
        TASKS.push({
          id: info.id,
          code: info.code || info.id,
          name: info.name || info.id,
          statusClass: info.statusClass || "status-exec",
          statusText: info.statusText || "执行中",
          owner: info.owner || "—"
        });
      }
    }
  };
})(window);
