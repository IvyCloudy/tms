/*!
 * tms-scope-dropdown.js
 * 将顶部栏 .top-filters .scope-select 原生 <select> 增强为自定义下拉，
 * 保证下拉面板始终「向下」展开（原生 select 的弹出方向由浏览器决定，
 * 无法通过 CSS 控制，故改用自定义面板实现）。
 *
 * 用法：页面加载 tms-scope-dropdown.css 与 本脚本 后，在 DOMContentLoaded
 * 之后自动扫描 .top-filters select.scope-select 并完成增强。
 * 业务代码无需改动：原 <select> 的 value / change 事件 / option 动态写入
 * 仍按常规方式使用，组件会自动同步。
 */
(function(global){
  "use strict";

  function qsa(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }

  function buildPanel(selectEl){
    var wrap = document.createElement("div");
    wrap.className = "tms-dd-wrap";
    if(selectEl.classList.contains("round-sel")) wrap.classList.add("tms-dd-wrap-round");

    var trigger = document.createElement("div");
    trigger.className = "tms-dd-trigger";
    trigger.tabIndex = 0;

    var label = document.createElement("span");
    label.className = "tms-dd-label";

    var arrow = document.createElement("span");
    arrow.className = "tms-dd-arrow";
    arrow.innerHTML = "▾";

    trigger.appendChild(label);
    trigger.appendChild(arrow);

    var panel = document.createElement("div");
    panel.className = "tms-dd-panel";

    wrap.appendChild(trigger);
    wrap.appendChild(panel);

    // 将原 select 隐藏并放入 wrap，保持 value/change 仍能被外部代码使用
    selectEl.parentNode.insertBefore(wrap, selectEl);
    wrap.appendChild(selectEl);
    selectEl.classList.add("tms-dd-native");

    return { wrap: wrap, trigger: trigger, label: label, panel: panel };
  }

  function renderPanel(parts, selectEl){
    var panel = parts.panel;
    panel.innerHTML = "";
    var opts = selectEl.options;
    var curVal = selectEl.value;
    var hasAny = false;
    for(var i=0;i<opts.length;i++){
      var o = opts[i];
      if(o.disabled && o.hidden) continue;
      var item = document.createElement("div");
      item.className = "tms-dd-item";
      if(o.disabled) item.classList.add("is-disabled");
      if(o.value === curVal){ item.classList.add("is-active"); hasAny = true; }
      item.setAttribute("data-value", o.value);
      item.textContent = o.text;
      if(!o.disabled){
        (function(val){
          item.addEventListener("click", function(ev){
            ev.stopPropagation();
            if(selectEl.value !== val){
              selectEl.value = val;
              // 派发原生 change 事件以便业务代码响应
              var evt;
              try { evt = new Event("change", { bubbles: true }); }
              catch(e){ evt = document.createEvent("HTMLEvents"); evt.initEvent("change", true, false); }
              selectEl.dispatchEvent(evt);
            }
            closePanel(parts);
            syncLabel(parts, selectEl);
          });
        })(o.value);
      }
      panel.appendChild(item);
    }
    if(!panel.childNodes.length){
      var empty = document.createElement("div");
      empty.className = "tms-dd-empty";
      empty.textContent = "暂无可选项";
      panel.appendChild(empty);
    }
  }

  function syncLabel(parts, selectEl){
    var opts = selectEl.options;
    var txt = "";
    for(var i=0;i<opts.length;i++){
      if(opts[i].value === selectEl.value){ txt = opts[i].text; break; }
    }
    parts.label.textContent = txt || "";
    if(selectEl.disabled){
      parts.wrap.classList.add("is-disabled");
      parts.trigger.setAttribute("aria-disabled","true");
    } else {
      parts.wrap.classList.remove("is-disabled");
      parts.trigger.removeAttribute("aria-disabled");
    }
  }

  function openPanel(parts, selectEl){
    // 关闭其它已打开的面板
    qsa(".tms-dd-wrap.is-open").forEach(function(w){ if(w!==parts.wrap) w.classList.remove("is-open"); });
    renderPanel(parts, selectEl);
    parts.wrap.classList.add("is-open");
  }
  function closePanel(parts){
    parts.wrap.classList.remove("is-open");
  }

  function enhance(selectEl){
    if(selectEl.__tmsDDEnhanced) return;
    selectEl.__tmsDDEnhanced = true;

    var parts = buildPanel(selectEl);
    syncLabel(parts, selectEl);

    parts.trigger.addEventListener("click", function(ev){
      ev.stopPropagation();
      if(selectEl.disabled) return;
      if(parts.wrap.classList.contains("is-open")){
        closePanel(parts);
      } else {
        openPanel(parts, selectEl);
      }
    });

    // 原 <select> 通过脚本 .value = xxx 或 innerHTML 重建 option 时，同步显示
    selectEl.addEventListener("change", function(){ syncLabel(parts, selectEl); });

    var mo = new MutationObserver(function(){
      syncLabel(parts, selectEl);
      if(parts.wrap.classList.contains("is-open")) renderPanel(parts, selectEl);
    });
    mo.observe(selectEl, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled","value"] });

    // 兜底：定时检查 value（处理外部直接赋值 .value = x 的场景）
    var lastVal = selectEl.value;
    setInterval(function(){
      if(selectEl.value !== lastVal){
        lastVal = selectEl.value;
        syncLabel(parts, selectEl);
      }
    }, 250);
  }

  function init(){
    qsa(".top-filters select.scope-select").forEach(enhance);
  }

  // 全局点击关闭
  document.addEventListener("click", function(){
    qsa(".tms-dd-wrap.is-open").forEach(function(w){ w.classList.remove("is-open"); });
  });
  // ESC 关闭
  document.addEventListener("keydown", function(e){
    if(e.key === "Escape"){
      qsa(".tms-dd-wrap.is-open").forEach(function(w){ w.classList.remove("is-open"); });
    }
  });

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  global.TmsScopeDropdown = { init: init, enhance: enhance };
})(window);
