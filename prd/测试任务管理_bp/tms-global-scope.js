/**
 * TMS 全局测试范围状态管理
 * ------------------------------------------------------------
 * 用于在 "设计管理 / 执行管理 / 缺陷管理 / 评审管理" 等页面之间
 * 共享 "测试子任务 / 测试阶段 / 测试轮次" 的选中值。
 *
 * 注意：各页面的子任务/阶段/轮次 id 体系可能不一致，因此这里
 *      存储的是用户可见的"名称"。各页面在渲染下拉后，按名称去
 *      匹配本页的选项，匹配成功则选中，匹配不上时回退到页面默认
 *      值并把新的名称回写全局。
 *
 * 对外 API：window.TMSScope
 *   - getSubtaskName()              获取当前子任务名
 *   - getStageName()                获取当前阶段名
 *   - getRoundName()                获取当前轮次名
 *   - setSubtaskName(name)          设置子任务名（会广播）
 *   - setStageName(name)            设置阶段名（会广播）
 *   - setRoundName(name)            设置轮次名（会广播）
 *   - onChange(cb)                  订阅范围变化，cb({field, from, to, crossTab})
 *   - pickMatch(list, keyGetter, wanted)  按名称匹配列表中某一项（忽略大小写/空格）
 */
(function(w){
  var KEY_SUBTASK = "tms_scope_subtask_name";
  var KEY_STAGE   = "tms_scope_stage_name";
  var KEY_ROUND   = "tms_scope_round_name";
  var EVT         = "tms:scope-change";

  function read(k){
    try{ return w.localStorage.getItem(k) || ""; }catch(e){ return ""; }
  }
  function write(k, v){
    try{
      if(v == null || v === "") w.localStorage.removeItem(k);
      else w.localStorage.setItem(k, v);
    }catch(e){}
  }

  var listeners = [];
  function onChange(cb){ if(typeof cb === "function") listeners.push(cb); }
  function emit(detail){
    listeners.forEach(function(cb){ try{ cb(detail); }catch(e){} });
    try{ w.dispatchEvent(new CustomEvent(EVT, { detail: detail })); }catch(e){}
  }

  function setValue(field, key, name){
    var from = read(key);
    name = name == null ? "" : String(name);
    if(from === name) return false;
    write(key, name);
    emit({ field: field, from: from, to: name });
    return true;
  }

  /* 跨标签页同步 */
  w.addEventListener("storage", function(e){
    if(e.key === KEY_SUBTASK){
      emit({ field:"subtask", from:e.oldValue||"", to:e.newValue||"", crossTab:true });
    }else if(e.key === KEY_STAGE){
      emit({ field:"stage", from:e.oldValue||"", to:e.newValue||"", crossTab:true });
    }else if(e.key === KEY_ROUND){
      emit({ field:"round", from:e.oldValue||"", to:e.newValue||"", crossTab:true });
    }
  });

  /* 任务切换时，清空子任务/阶段/轮次（因为它们是任务相关的） */
  if(w.TMSGlobal && typeof w.TMSGlobal.onChange === "function"){
    w.TMSGlobal.onChange(function(){
      write(KEY_SUBTASK, "");
      write(KEY_STAGE, "");
      write(KEY_ROUND, "");
    });
  }else{
    /* 若此时 TMSGlobal 尚未就绪，延迟绑定 */
    w.addEventListener("load", function(){
      if(w.TMSGlobal && typeof w.TMSGlobal.onChange === "function"){
        w.TMSGlobal.onChange(function(){
          write(KEY_SUBTASK, "");
          write(KEY_STAGE, "");
          write(KEY_ROUND, "");
        });
      }
    });
  }

  /* 名称归一化：去空格，小写 */
  function norm(s){ return String(s == null ? "" : s).trim().toLowerCase(); }

  /**
   * 从 list 中按名称匹配一项；匹配不到返回 null
   * @param list       任意数组
   * @param nameGetter (item)=>string，提取该项的显示名
   * @param wanted     希望匹配的名称
   */
  function pickMatch(list, nameGetter, wanted){
    var w = norm(wanted);
    if(!w || !list || !list.length) return null;
    for(var i=0;i<list.length;i++){
      if(norm(nameGetter(list[i])) === w) return list[i];
    }
    return null;
  }

  w.TMSScope = {
    getSubtaskName: function(){ return read(KEY_SUBTASK); },
    getStageName:   function(){ return read(KEY_STAGE); },
    getRoundName:   function(){ return read(KEY_ROUND); },
    setSubtaskName: function(n){ return setValue("subtask", KEY_SUBTASK, n); },
    setStageName:   function(n){ return setValue("stage",   KEY_STAGE,   n); },
    setRoundName:   function(n){ return setValue("round",   KEY_ROUND,   n); },
    onChange: onChange,
    pickMatch: pickMatch
  };
})(window);
