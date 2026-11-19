/* SAHM managed-group detail workspace.
   Isolated presentation layer: it consumes existing read models and existing action handlers.
   No database, Supabase, engine, or shared-screen behavior is changed here. */
(function (root) {
  'use strict';
  const state = { cycle: null, installment: 'current', status: 'all', query: '', drawView: 'summary', memberFiltersOpen: false, drawFiltersOpen: false, installmentFiltersOpen: false, installmentSelectMode: false, installmentSelected: new Set(), installmentSelectionGroupId: null };
  const readCache = new Map();
  let renderVersion = 0;
  let dashboardTimer = null;
  function cachedRead(key, loader, ttl) {
    const now = Date.now(), existing = readCache.get(key);
    if (existing && (existing.promise || existing.expiresAt > now)) return existing.promise || Promise.resolve(existing.value);
    const entry = { promise: null, value: null, expiresAt: 0 };
    entry.promise = Promise.resolve().then(loader).then(value => {
      entry.value = value; entry.expiresAt = Date.now() + (ttl || 12000); entry.promise = null;
      return value;
    }).catch(error => { readCache.delete(key); throw error; });
    readCache.set(key, entry);
    return entry.promise;
  }
  function invalidateReads() { readCache.clear(); }
  function loadingPanel(label) {
    return '<div class="mgd-loading" role="status"><span class="mgd-loading-spinner"></span><span>جارٍ تحميل ' + esc(label) + '...</span></div>';
  }
  function commitRender(g, d, active, content) {
    const manager = !!(d.role && d.role.manager);
    if (active === 'installments' && manager) {
      shell('التحصيل', 'groups', '<main class="mgd-content mgd-collection-page">' + content + '</main>');
    } else {
      shell('تفاصيل الجمعية', 'groups', identity(g, d) + tabs(active, manager) + '<main class="mgd-content">' + content + '</main>');
    }
    const activeTab = document.querySelector && document.querySelector('.mgd-tabs button.active');
    if (activeTab && typeof activeTab.scrollIntoView === 'function') activeTab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (active === 'members') bindMemberSearch();
    if (active === 'installments') bindInstallmentFilters(g, d);
    if (active === 'draws') bindDrawFilters();
    if (active === 'shares') { const f=document.getElementById('mgdShareStatus'); if(f) f.addEventListener('change',()=>{state.shareStatus=f.value; const box=document.getElementById('mgdShareList'); if(box)box.innerHTML=loadingPanel('الأسهم'); shareCards(g);}); }
    if (groupDetailTab === 'chat') bindChatComposer();
  }

  const esc = value => escapeHtml(String(value == null ? '' : value));
  const moneyValue = (value, currency) => minorMoney(value, currency);
  const row = (icon, label, value) =>
    '<div class="mgd-fact"><span>' + uiIcon(icon, 17) + '<span>' + esc(label) + '</span></span><b>' + esc(value) + '</b></div>';
  const actionButton = (label, action, attrs, cls) =>
    '<button type="button" class="mgd-action ' + (cls || '') + '" data-action="' + action + '" ' + (attrs || '') + '>' + label + '</button>';
  const currentRole = g => g.managerParticipates ? 'مدير وعضو' : 'مدير';
  const progress = d => {
    const total = Math.max(0, Number(d.rounds) || 0), done = Math.max(0, Number(d.drawn) || 0);
    return { total, done, pct: total ? Math.min(100, Math.round(done / total * 100)) : 0 };
  };
  function identity(g, d) {
    const p=progress(d), manager=!!(d.role&&d.role.manager), role=manager?(g.managerParticipates&&(d.role.shares||0)>0?'مدير وعضو':'مدير الجمعية'):'عضو مشارك';
    const current=Math.min(p.total||1,Math.max(1,Number(d.cycle||1))), snap=SahmApp.installmentRows(g.id,{cycle:current,status:'all'});
    const obligations=snap&&snap.ok?snap.rows||[]:[], paid=obligations.filter(x=>x.status==='paid').length, pct=obligations.length?Math.round(paid/obligations.length*100):0;
    return '<section class="mgd-identity"><div class="mgd-identity-top"><div><strong>'+esc(g.name)+'</strong><small class="mgd-identity-sub">'+esc(role)+'</small></div><span class="mgd-role">'+(manager?'إدارة':'مشاركة')+'</span></div>'+
      '<div class="mgd-identity-metrics"><span>'+uiIcon('wallet',15)+'<b>'+esc(money(g.share,g.currency))+'</b></span><span>'+uiIcon('users',15)+'<b>'+esc(d.members||0)+'</b></span><span>'+uiIcon('layers',15)+'<b>'+esc(g.shares||d.totalShares||'—')+'</b></span><span>'+uiIcon('shuffle',15)+'<b>'+p.total+'</b></span></div>'+
      '<div class="mgd-progress-head"><span>إنجاز الجمعية</span><b>'+p.pct+'%</b></div><div class="mgd-progress"><i style="width:'+p.pct+'%"></i></div><small class="mgd-progress-caption">'+p.done+' من '+p.total+' قرعة مكتملة · '+Math.max(0,p.total-p.done)+' متبقية</small>'+
      (manager?'<div class="mgd-current-round"><div class="mgd-current-round-head"><b>القرعة الحالية · '+current+'</b><span>'+pct+'% تحصيل</span></div><div class="mgd-round-progress"><i style="width:'+pct+'%"></i></div><small>'+paid+' من '+obligations.length+' التزاماً مسدداً</small></div>':'')+'</section>';
  }
  function tabs(active, manager) {
    if (manager) return '';
    const members=[['overview','layout-dashboard','ملخصي'],['installments','receipt','أقساطي'],['shares','layers','أسهمي'],['draws','shuffle','القرعات'],['communication','messages','التواصل']];
    const selected=['news','chat','audit'].includes(active)?'communication':active;
    return '<nav class="mgd-tabs" aria-label="أقسام الجمعية" role="tablist">'+members.map(([id,icon,label])=>'<button type="button" role="tab" aria-selected="'+(selected===id?'true':'false')+'" class="'+(selected===id?'active':'')+'" data-action="managed-tab" data-tab="'+id+'">'+uiIcon(icon,17)+'<span>'+label+'</span></button>').join('')+'</nav>';
  }
  function backToTab(tab) {
    const label = tab === 'draws' ? 'القرعات' : tab === 'settings' ? 'الإعدادات' : tab === 'installments' ? 'الأقساط' : 'الأعضاء';
    return '<button type="button" class="mgd-back" data-action="managed-back" data-tab="' + (tab || 'members') + '">' + uiIcon('back-screen',18) + '<span>العودة إلى ' + label + '</span></button>';
  }
  async function shareCards(g) {
    const result = await cachedRead('shares:' + g.id, () => SahmApp.shareList(g.id, {status: 'all'}), 12000);
    const all = result && result.ok ? result.shares || [] : [];
    const list = state.shareStatus === 'all' ? all : all.filter(s => s.status === (state.shareStatus || 'eligible'));
    const target = document.getElementById('mgdShareList');
    const summary = document.getElementById('mgdShareSummary');
    if (summary) {
      const won = all.filter(s => s.status === 'won').length;
      const eligible = all.filter(s => s.status === 'eligible').length;
      summary.innerHTML = '<article><small>إجمالي الأسهم</small><b>' + all.length + '</b></article><article><small>أسهم مؤهلة</small><b>' + eligible + '</b></article><article><small>أسهم فائزة</small><b>' + won + '</b></article>';
    }
    if (!target) return '';
    if (!result || !result.ok) {
      target.innerHTML = '<div class="mgd-empty">' + esc(result && result.message || 'تعذر تحميل سجل الأسهم') + '</div>';
      return target.innerHTML;
    }
    target.innerHTML = list.map(s => '<article class="mgd-installment-card"><div class="mgd-installment-top"><b>السهم ' + esc(s.shareNo) + '</b>' + '<span class="mgd-share-state ' + (s.status === 'won' ? 'won' : 'eligible') + '">' + (s.status === 'won' ? 'فائز' : 'مؤهل') + '</span>' + '</div><div class="mgd-installment-member">' + esc(s.ownerName) + '</div><div class="mgd-installment-meta"><span>' + (s.status === 'won' ? 'فائز بالقرعة رقم ' + esc(s.winnerRound) : 'مؤهل للقرعات المتبقية') + '</span></div></article>').join('') || '<div class="mgd-empty">لا توجد أسهم بهذه الحالة</div>';
    return target.innerHTML;
  }
  function bindInlineFilterToggle(toolbarId,toggleId,stateKey) {
    const toolbar=document.getElementById(toolbarId),toggle=document.getElementById(toggleId);
    if(!toolbar||!toggle)return;
    const apply=()=>{
      const open=!!state[stateKey];
      toolbar.classList.toggle('filters-open',open);
      toggle.setAttribute('aria-expanded',open?'true':'false');
      toggle.title=open?'إخفاء الفلترة':'إظهار الفلترة';
    };
    apply();
  }
  function bindDrawFilters() {
    const search=document.getElementById('mgdDrawSearch'), status=document.getElementById('mgdDrawStatus'), list=document.getElementById('mgdDrawList');
    if(!list)return;
    bindInlineFilterToggle('mgdDrawToolbar','mgdDrawFilterToggle','drawFiltersOpen');
    const apply=()=>{const q=search?search.value.trim():'';const st=status?status.value:'all';list.querySelectorAll('.mgd-cycle-card').forEach(card=>{card.hidden=(q&&!card.dataset.round.includes(q))||(st!=='all'&&card.dataset.status!==st);});};
    if(search)search.addEventListener('input',apply);if(status)status.addEventListener('change',apply);apply();
  }
  function memberCards(g) {
    const result = SahmApp.memberList(g.id);
    if (!result || !result.ok) return '<div class="mgd-empty">تعذر تحميل قائمة الأعضاء</div>';
    const list = result.members || [];
    const totalShares = list.reduce((sum,m)=>sum+Number(m.shares||0),0);
    const wonShares = list.reduce((sum,m)=>sum+Number(m.wonShares||0),0);
    const eligibleShares = list.reduce((sum,m)=>sum+Number(m.eligibleShares==null?m.shares:m.eligibleShares),0);
    const managerCount = list.filter(m=>m.isManager).length;
    const rows = list.map(m =>
      '<article class="mgd-member-card mgd-member-card-static" data-member-status="' + (m.memberStatus==='won'?'won':'eligible') + '">' +
      '<span class="mgd-avatar">' + esc((m.name || '؟').slice(0, 1)) + '</span><span class="mgd-member-main"><b>' + esc(m.name) + '</b>' +
      '<small>' + (m.isManager ? ((g.managerParticipates && Number(m.shares||0)>0) ? 'مدير وعضو' : 'مدير الجمعية') : 'عضو') + (m.isMe ? ' · حسابك' : '') + '</small></span>' +
      '<span class="mgd-member-shares"><b>' + Number(m.shares || 0) + '</b><small>أسهم</small><small>' + Number(m.wonShares||0) + ' فائز · ' + Number(m.eligibleShares==null?m.shares:m.eligibleShares) + ' مؤهل</small><small class="mgd-member-state">' + (m.memberStatus==='won'?'فائز بكل أسهمه':'مؤهل') + '</small></span></article>'
    ).join('');
    return '<div class="mgd-member-overview"><article><small>الأعضاء</small><b>' + list.length + '</b></article><article><small>المديرون</small><b>' + managerCount + '</b></article><article><small>إجمالي الأسهم</small><b>' + totalShares + '</b></article><article><small>فائزة / مؤهلة</small><b>' + wonShares + ' / ' + eligibleShares + '</b></article></div>' +
      '<div class="mgd-list-head"><b>قائمة الأعضاء</b><span>' + list.length + ' عضو</span></div>' +
      '<div class="mgd-filterbar mgd-member-filters'+(state.memberFiltersOpen?' filters-open':'')+'" id="mgdMemberToolbar"><label class="mgd-search">' + uiIcon('search',18) + '<input id="mgdMemberSearch" type="search" placeholder="اسم العضو" autocomplete="off"></label>' +
      '<button type="button" class="mgd-inline-filter-toggle" data-action="managed-inline-filter-toggle" id="mgdMemberFilterToggle" data-filter-state="memberFiltersOpen" aria-label="فلترة الأعضاء" aria-controls="mgdMemberFilters" aria-expanded="'+(state.memberFiltersOpen?'true':'false')+'">' + uiIcon('sliders-horizontal',18) + '</button>' +
      '<div class="mgd-filter-fields" id="mgdMemberFilters"><label class="mgd-select"><select id="mgdMemberStatus" aria-label="حالة العضو"><option value="all">كل الحالات</option><option value="eligible">مؤهل</option><option value="won">فائز بكل أسهمه</option></select></label></div></div>' +
      '<div class="mgd-list" id="mgdMemberList">' + (rows || '<div class="mgd-empty">لا يوجد أعضاء مسجلون</div>') + '</div>';
  }

  function bindMemberSearch() {
    const input=document.getElementById('mgdMemberSearch'),status=document.getElementById('mgdMemberStatus'),list=document.getElementById('mgdMemberList');
    if(!list)return;
    bindInlineFilterToggle('mgdMemberToolbar','mgdMemberFilterToggle','memberFiltersOpen');
    const apply=()=>{const q=input?input.value.trim().toLocaleLowerCase():'';const st=status?status.value:'all';list.querySelectorAll('.mgd-member-card').forEach(card=>{const name=card.querySelector('.mgd-member-main b').textContent.toLocaleLowerCase();const memberState=card.dataset.memberStatus||'eligible';card.hidden=(!name.includes(q))||(st!=='all'&&memberState!==st);});};
    if(input)input.addEventListener('input',apply);if(status)status.addEventListener('change',apply);apply();
  }
  async function cycleCards(g, d) {
    const [historyResult, readinessResult] = await Promise.all([
      cachedRead('history:' + g.id, () => SahmApp.getDrawHistory(g.id), 15000),
      cachedRead('draw-ready:' + g.id, () => SahmApp.getDrawReadiness(g.id), 7000)
    ]);
    const history=historyResult&&historyResult.ok?(historyResult.history||[]):[];
    const ready=!!(readinessResult&&readinessResult.ok&&readinessResult.canDraw);
    const byRound=new Map(history.map(x=>[Number(x.round_no||x.round),x]));
    const total=Math.max(0,Number(d.rounds)||0),current=Math.min(total,(Number(d.drawn)||0)+1);
    const cards=Array.from({length:total},(_,i)=>{
      const n=i+1,draw=byRound.get(n);
      const snap=SahmApp.installmentRows(g.id,{cycle:n,status:'all'})||{};
      const rows=snap.ok?snap.rows||[]:[];
      const paid=rows.filter(x=>x.status==='paid').length;
      const pct=rows.length?Math.round(paid/rows.length*100):0;
      const waiting=!!(readinessResult&&readinessResult.ok&&readinessResult.dateReached&& !readinessResult.timeReached);
      const status=draw?'completed':n===current?(ready?'ready':pct===100?'waiting':'collecting'):'upcoming';
      const label=draw?'نتيجة مثبتة':n===current?(ready?'جاهزة لإجراء القرعة':pct===100?(waiting?'اكتمل التحصيل · بانتظار الموعد':'اكتمل التحصيل · بانتظار الجاهزية'):'جارٍ تحصيل الأقساط'):'قرعة قادمة';
      const winner=draw?(draw.winner_owner_name||draw.winnerLabel||'—'):'';
      return '<article class="mgd-cycle-card mgd-cycle-card-static" data-round="'+n+'" data-status="'+status+'">'+
        '<span class="mgd-cycle-number">'+n+'</span><span class="mgd-cycle-main"><b>القرعة '+n+'</b><small>'+esc(winner||label)+'</small>'+
        '<span class="mgd-cycle-progress"><i style="width:'+pct+'%"></i></span><small>'+pct+'% اكتمال الأقساط</small></span>'+
        '<span class="mgd-cycle-state">'+esc(label)+'</span>'+(draw ? '<small class="mgd-cycle-winner">الفائز: '+esc(winner)+'</small>' : '')+'</article>';
    }).join('');
    const completedCount = Math.min(total, Math.max(Number(d.drawn) || 0, history.filter(x => Number(x.round_no || x.round) <= total).length));
    const currentStatus = !total ? 'غير محددة' : completedCount >= total ? 'اكتملت' : ready ? 'جاهزة' : 'قيد التحصيل';
    return '<div class="mgd-draw-overview"><article><small>إجمالي القرعات</small><b>' + total + '</b></article><article><small>نتائج مثبتة</small><b>' + completedCount + '</b></article><article><small>القرعات المتبقية</small><b>' + Math.max(0,total-completedCount) + '</b></article><article><small>حالة الحالية</small><b>' + currentStatus + '</b></article></div>' +
      '<div class="mgd-list-head"><b>قائمة القرعات</b><span>'+total+' قرعة</span></div>'+
      '<div class="mgd-filterbar mgd-draw-filters'+(state.drawFiltersOpen?' filters-open':'')+'" id="mgdDrawToolbar"><label class="mgd-search">'+uiIcon('search',16)+'<input id="mgdDrawSearch" type="search" placeholder="رقم القرعة" inputmode="numeric"></label>'+
      '<button type="button" class="mgd-inline-filter-toggle" data-action="managed-inline-filter-toggle" id="mgdDrawFilterToggle" data-filter-state="drawFiltersOpen" aria-label="فلترة القرعات" aria-controls="mgdDrawFilters" aria-expanded="'+(state.drawFiltersOpen?'true':'false')+'">'+uiIcon('sliders-horizontal',18)+'</button>'+
      '<div class="mgd-filter-fields" id="mgdDrawFilters"><label class="mgd-select"><select id="mgdDrawStatus" aria-label="حالة القرعة"><option value="all">كل الحالات</option><option value="completed">مكتملة</option><option value="collecting">قيد التحصيل</option><option value="ready">جاهزة</option><option value="waiting">بانتظار الموعد</option><option value="upcoming">قادمة</option></select></label></div></div>'+

      '<div class="mgd-list" id="mgdDrawList">'+(cards||'<div class="mgd-empty">لا توجد قرعات لعرضها</div>')+'</div>';
  }
  function currentInstallmentNo(rows, g) {
    const list = Array.isArray(rows) ? rows : [];
    const today = SahmApp.todayIn(g.tz || 'Asia/Aden');
    const inRange = list.find(x => String(today) >= String(x.periodStart) && String(today) <= String(x.periodEnd));
    const fallback = inRange || list.find(x => x.status === 'due' || x.status === 'late') || list[0];
    return fallback && Number.isInteger(Number(fallback.no)) ? Number(fallback.no) : null;
  }
  function installmentRows(g, d, opts) {
    opts = opts || {};
    const cycle = Number(opts.cycle || state.cycle || d.cycle || 1);
    let installment;
    if (Object.prototype.hasOwnProperty.call(opts, 'installment')) {
      installment = opts.installment;
    } else if (state.installment === 'all') {
      installment = null;
    } else if (state.installment === 'current') {
      const current = SahmApp.installmentRows(g.id, {cycle, status: 'all'});
      installment = currentInstallmentNo(current && current.ok ? current.rows : [], g);
    } else {
      installment = Number(state.installment);
    }
    const result = SahmApp.installmentRows(g.id, {
      cycle, status: opts.status == null ? state.status : opts.status,
      installment: installment == null && state.installment !== 'all' ? -1 : installment || null,
      query: opts.query == null ? state.query : opts.query
    });
    if (!result || !result.ok) return '<div class="mgd-empty">' + esc(result && result.message || 'تعذر تحميل الأقساط') + '</div>';
    const rows = result.rows || [], manager = !!(d.role && d.role.manager);
    const icons = {paid:['check-circle','مدفوع','paid'],due:['clock-3','مستحق','due'],late:['alert-circle','متأخر','late'],upcoming:['calendar-clock','لم يحن موعده','upcoming']};
    return rows.map(x => {
      const key = String(x.memberId)+'|'+String(x.cycle)+'|'+String(x.no);
      const selectable = manager && (x.status === 'due' || x.status === 'late');
      const selected = state.installmentSelectMode && selectable && state.installmentSelected.has(key);
      const meta = icons[x.status] || ['circle-help',String(x.status||'غير محدد'),'unknown'];
      const attrs = 'data-member="'+esc(x.memberId)+'" data-cycle="'+esc(x.cycle)+'" data-no="'+esc(x.no)+'"';
      const collect = x.status === 'due' || x.status === 'late' || x.status === 'upcoming', remind = x.status === 'due' || x.status === 'late';
      const actions = manager && x.status === 'paid' ? '<div class="mgd-row-actions"><span class="mgd-paid-state" role="status">'+uiIcon('check',14)+'<span>مدفوع</span></span></div>' :
        manager && (collect || remind) ? '<div class="mgd-row-actions">'+
        (collect ? actionButton('تحصيل','record-paid',attrs,'primary') : '')+
        (remind ? actionButton('تذكير','send-reminder',attrs,'') : '')+'</div>' : '';
      const accessibility = state.installmentSelectMode && selectable ? ' role="checkbox" aria-checked="'+(selected?'true':'false')+'"' : ' role="group"';
      return '<article class="mgd-installment-card'+(selectable?' is-selectable':'')+(state.installmentSelectMode&&selected?' is-selected':'')+'"'+accessibility+' data-installment-key="'+esc(key)+'" data-selectable="'+(selectable?'true':'false')+'" tabindex="'+(state.installmentSelectMode&&selectable?'0':'-1')+'">'+
        '<div class="mgd-installment-top"><span class="mgd-installment-status-icon '+meta[2]+'" title="'+esc(meta[1])+'" aria-label="'+esc(meta[1])+'">'+uiIcon(meta[0],19)+'</span><b>'+esc(x.memberName)+'</b>'+
        (state.installmentSelectMode&&selectable?'<span class="mgd-select-mark">'+uiIcon(selected?'check-circle-2':'circle',20)+'</span>':'')+'</div>'+
        '<div class="mgd-installment-meta">'+
          '<div class="mgd-installment-stat"><div class="mgd-installment-stat-label">'+uiIcon('layers',14)+'<span>الأسهم</span></div><b>'+esc(x.shares||0)+'</b></div>'+
          '<div class="mgd-installment-stat"><div class="mgd-installment-stat-label">'+uiIcon('wallet',14)+'<span>المبلغ</span></div><b>'+esc(moneyValue(x.total,g.currency))+'</b></div>'+
          '<div class="mgd-installment-stat"><div class="mgd-installment-stat-label">'+uiIcon('calendar-days',14)+'<span>القسط</span></div><b>'+esc(x.no)+'</b></div>'+
        '</div>'+actions+'</article>';
    }).join('') || '<div class="mgd-empty">لا توجد أقساط مطابقة للبحث والفلترة</div>';
  }
  function bindInstallmentFilters(g, d) {
    const search=document.getElementById('mgdInstallmentSearch'), status=document.getElementById('mgdInstallmentStatus');
    const cycle=document.getElementById('mgdInstallmentCycle'), number=document.getElementById('mgdInstallmentNumber');
    const list=document.getElementById('mgdInstallmentList'), toolbar=document.getElementById('mgdInstallmentToolbar');
    const filterToggle=document.getElementById('mgdInstallmentFilterToggle');
    const selectionBar=document.getElementById('mgdInstallmentSelectionBar');
    const selectionCount=document.getElementById('mgdInstallmentSelectionCount');
    const selectVisible=document.getElementById('mgdInstallmentSelectVisible');
    const cancelSelection=document.getElementById('mgdInstallmentCancelSelection');
    const bulk=document.getElementById('mgdInstallmentBulkReminder');
    const update=()=>{
      state.query=search?search.value.trim():'';
      state.cycle=cycle?Number(cycle.value):Number(d.cycle||1);
      if(number) state.installment=number.value;
      const snapshot=SahmApp.installmentRows(g.id,{cycle:state.cycle,status:'all'});
      const all=snapshot&&snapshot.ok?snapshot.rows||[]:[];
      const currentNo=currentInstallmentNo(all,g);
      const selectedNo=state.installment==='all'?null:state.installment==='current'?currentNo:Number(state.installment);
      const scoped=state.installment==='all'?all:selectedNo==null?[]:all.filter(x=>Number(x.no)===selectedNo);
      const valid=scoped.map(x=>x.status);
      const options=[['all','كل الحالات'],['due','مستحق'],['late','متأخر'],['paid','مدفوع'],['upcoming','لم يحن موعده']].filter(([value])=>value==='all'||valid.includes(value));
      const previousStatus=status?status.value:state.status;
      if(!options.some(([value])=>value===state.status)) state.status='all';
      if(status){
        status.innerHTML=options.map(([value,label])=>'<option value="'+value+'">'+label+'</option>').join('');
        status.value=options.some(([value])=>value===previousStatus)?previousStatus:state.status;
        state.status=status.value;
      }
      if(list) list.innerHTML=installmentRows(g,d,{cycle:state.cycle,installment:selectedNo==null&&state.installment!=='all'?-1:selectedNo,status:state.status,query:state.query});
      const summary=document.querySelector('.mgd-installment-summary'),stats=summary&&summary.querySelector('.mgd-summary-stats');
      if(stats){
        const paid=scoped.filter(x=>x.status==='paid').length,late=scoped.filter(x=>x.status==='late').length,pending=scoped.filter(x=>x.status==='due'||x.status==='upcoming').length;
        stats.innerHTML='<span>الإجمالي <b>'+scoped.length+'</b></span><span>مدفوعة <b>'+paid+'</b></span><span>معلقة <b>'+pending+'</b></span><span>متأخرة <b>'+late+'</b></span>';
      }
      if(toolbar)toolbar.classList.toggle('filters-open',state.installmentFiltersOpen);
      if(filterToggle)filterToggle.setAttribute('aria-expanded',state.installmentFiltersOpen?'true':'false');
      if(selectionBar)selectionBar.hidden=!state.installmentSelectMode;
      if(selectionCount)selectionCount.textContent=state.installmentSelected.size+' محدد';
      if(selectVisible)selectVisible.disabled=!list||!list.querySelector('.mgd-installment-card[data-selectable="true"]');
      if(bulk){
        bulk.disabled=!state.installmentSelected.size;
        bulk.setAttribute('aria-label','تذكير جماعي لعدد '+state.installmentSelected.size+' من الأقساط المحددة');
        bulk.title='تذكير جماعي · '+state.installmentSelected.size+' محدد';
        bulk.innerHTML=uiIcon('bell',15)+'<span>تذكير</span>';
      }
    };
    [search,status,cycle,number].forEach(el=>el&&el.addEventListener(el===search?'input':'change',update));
    if(filterToggle)filterToggle.addEventListener('click',()=>{state.installmentFiltersOpen=!state.installmentFiltersOpen;update();});
    if(cancelSelection)cancelSelection.addEventListener('click',()=>{state.installmentSelectMode=false;state.installmentSelected.clear();update();});
    if(selectVisible)selectVisible.addEventListener('click',()=>{
      if(!list)return;
      list.querySelectorAll('.mgd-installment-card[data-selectable="true"]').forEach(card=>state.installmentSelected.add(card.dataset.installmentKey));
      update();
    });
    if(list){
      let pressTimer=null,pressCard=null,longPressTriggered=false,pressStartX=0,pressStartY=0,suppressCardClickUntil=0;
      const clearPress=()=>{if(pressTimer)clearTimeout(pressTimer);pressTimer=null;pressCard=null;};
      const toggle=card=>{
        const key=card&&card.dataset.installmentKey;
        if(!key||card.dataset.selectable!=='true')return;
        if(state.installmentSelected.has(key))state.installmentSelected.delete(key);else state.installmentSelected.add(key);
        update();
      };
      list.addEventListener('pointerdown',e=>{
        const card=e.target.closest('.mgd-installment-card[data-selectable="true"]');
        if(!card||e.target.closest('button')||e.button!==0)return;
        clearPress();pressCard=card;longPressTriggered=false;pressStartX=e.clientX;pressStartY=e.clientY;
        pressTimer=setTimeout(()=>{
          if(!pressCard)return;
          longPressTriggered=true;
          state.installmentSelectMode=true;
          state.installmentSelected.add(pressCard.dataset.installmentKey);
        },480);
      });
      list.addEventListener('pointermove',e=>{
        if(!pressTimer)return;
        if(Math.hypot(e.clientX-pressStartX,e.clientY-pressStartY)>10)clearPress();
      });
      list.addEventListener('pointerup',()=>{
        if(!pressCard&&!longPressTriggered)return;
        if(pressTimer)clearTimeout(pressTimer);
        pressTimer=null;
        if(longPressTriggered){suppressCardClickUntil=Date.now()+650;update();}
        pressCard=null;
      });
      list.addEventListener('pointercancel',clearPress);
      list.addEventListener('pointerleave',e=>{if(pressTimer&&!e.relatedTarget)clearPress();});
      list.addEventListener('click',e=>{
        if(e.target.closest('button'))return;
        const card=e.target.closest('.mgd-installment-card[data-selectable="true"]');
        if(!card)return;
        if(Date.now()<suppressCardClickUntil){e.preventDefault();return;}
        if(state.installmentSelectMode)toggle(card);
      });
      list.addEventListener('keydown',e=>{
        if(e.key!=='Enter'&&e.key!==' ')return;
        const card=e.target.closest('.mgd-installment-card[data-selectable="true"]');
        if(card&&state.installmentSelectMode){e.preventDefault();toggle(card);}
      });
    }
    if(bulk)bulk.addEventListener('click',async()=>{
      if(!state.installmentSelected.size||bulk.disabled)return;
      const selected=Array.from(state.installmentSelected).map(key=>{
        const parts=key.split('|');
        return {memberId:parts[0],cycle:Number(parts[1]),no:Number(parts[2])};
      });
      const rowsByCycle=new Map();
      selected.forEach(item=>{
        if(rowsByCycle.has(item.cycle))return;
        const result=SahmApp.installmentRows(g.id,{cycle:item.cycle,status:'all'});
        rowsByCycle.set(item.cycle,result&&result.ok?result.rows||[]:[]);
      });
      const eligible=selected.filter(item=>{
        const row=(rowsByCycle.get(item.cycle)||[]).find(x=>String(x.memberId)===item.memberId&&Number(x.no)===item.no);
        return row&&(row.status==='due'||row.status==='late');
      });
      if(!eligible.length){toast('لا توجد أقساط مستحقة للتذكير ضمن التحديد');return;}
      if(!window.confirm('سيتم إرسال تذكير إلى '+eligible.length+' من الأعضاء عن الأقساط المحددة. هل تريد المتابعة؟'))return;
      bulk.disabled=true;
      let sent=0,failed=0,skipped=0,refreshFailed=false;
      try{
        for(const item of eligible){
          let result=await SahmApp.sendReminder({groupId:g.id,memberId:item.memberId,cycle:item.cycle,no:item.no,skipRefresh:true});
          if(result&&result.code==='REMINDER_REPEAT'){
            if(window.confirm(result.message+'\nهل تريد إعادة إرسال هذا التذكير؟')){
              result=await SahmApp.sendReminder({groupId:g.id,memberId:item.memberId,cycle:item.cycle,no:item.no,confirmRepeat:true,skipRefresh:true});
            }else{skipped++;continue;}
          }
          if(result&&result.ok)sent++;else failed++;
        }
        try{await SahmApp.refreshStore();}catch(error){refreshFailed=true;}
        state.installmentSelected.clear();
        state.installmentSelectMode=false;
        invalidateReads();
        refreshData();
        const summary='تم إرسال '+sent+' تذكير'+(skipped?'، تخطّي '+skipped:'')+(failed?'، تعذر '+failed:'');
        toast(summary+(refreshFailed?' · تعذر تحديث البيانات المعروضة':''));
        redraw();
      }catch(error){
        toast(error&&error.message||'تعذر إكمال التذكيرات المحددة');
        if(bulk.isConnected)bulk.disabled=false;
      }
    });
    update();
  }
  function receiptHistoryPanel(g) {
    const result = SahmApp.receiptList(g.id, {includeVoided: true});
    if (!result || !result.ok) return '<section class="mgd-detail-card"><div class="mgd-empty">' + esc(result && result.message || 'تعذر تحميل سجل الاستلام') + '</div></section>';
    const rows = result.receipts || [];
    const recent = rows.slice(0, 15);
    return '<details class="mgd-inline-receipts"><summary>سجل الاستلام والتصحيحات <span>' + rows.length + ' سجل</span></summary>' +
      '<div class="mgd-receipt-list">' + (recent.map(x =>
        '<button type="button" class="mgd-receipt-row" data-action="receipt-open" data-id="' + esc(x.id) + '">' +
        '<span class="mgd-receipt-mark ' + (x.voided ? 'voided' : 'valid') + '">' + (x.voided ? '!' : '✓') + '</span>' +
        '<span class="mgd-member-main"><b>' + esc(x.memberName) + ' · القسط ' + Number(x.no || 0) + '</b><small>القرعة ' + Number(x.cycle || 0) + ' · ' + esc(dateLabel(String(x.recordedAt || '').slice(0,10))) + '</small></span>' +
        '<span class="mgd-receipt-value"><b>' + esc(minorMoney(x.amount, x.currency || g.currency)) + '</b><small>' + (x.voided ? 'مصحح' : 'مسجل') + '</small></span></button>'
      ).join('') || '<div class="mgd-empty">لا توجد سجلات استلام</div>') + '</div>' +
      (rows.length > recent.length ? '<small class="mgd-receipt-note">يعرض آخر ' + recent.length + ' سجلاً من أصل ' + rows.length + '.</small>' : '') +
      '</details>';
  }
  function installmentsPanel(g,d) {
    if(state.installmentSelectionGroupId!==g.id){
      state.installmentSelectionGroupId=g.id;
      state.installmentSelected.clear();
      state.installmentSelectMode=false;
      state.installmentFiltersOpen=false;
      state.installment='current';
      state.status='all';
      state.query='';
      state.cycle=null;
    }
    const manager=!!(d.role&&d.role.manager),totalCycles=Math.max(1,Number(d.rounds)||1),cycle=Math.min(totalCycles,Math.max(1,Number(state.cycle||d.cycle||1)));
    const snap=SahmApp.installmentRows(g.id,{cycle,status:'all'})||{},all=snap.ok?snap.rows||[]:[];
    const currentNo=currentInstallmentNo(all,g);
    const chosen=state.installment==='all'?null:state.installment==='current'?currentNo:Number(state.installment);
    const shown=state.installment==='all'?all:chosen==null?[]:all.filter(x=>Number(x.no)===chosen);
    const paid=shown.filter(x=>x.status==='paid').length,late=shown.filter(x=>x.status==='late').length,pending=shown.filter(x=>x.status==='due'||x.status==='upcoming').length,first=shown[0]||{};
    const totalAmount=shown.reduce((sum,x)=>sum+Number(x.total||0),0);
    const remainingAmount=shown.reduce((sum,x)=>sum+Number(x.remaining||0),0);
    const collectedAmount=Math.max(0,totalAmount-remainingAmount);
    const cycleOptions=Array.from({length:totalCycles},(_,i)=>'<option value="'+(i+1)+'" '+(cycle===i+1?'selected':'')+'>القرعة '+(i+1)+'</option>').join('');
    const installmentOptions='<option value="current" '+(state.installment==='current'?'selected':'')+'>القسط الحالي</option><option value="all" '+(state.installment==='all'?'selected':'')+'>جميع الأقساط</option>'+
      Array.from({length:Math.max(1,Number(g.installments)||1)},(_,i)=>i+1).filter(no=>currentNo==null||no!==currentNo).map(no=>'<option value="'+no+'" '+(String(state.installment)===String(no)?'selected':'')+'>القسط '+no+'</option>').join('');
    return '<section class="mgd-installment-summary"><div class="mgd-summary-top"><b>القرعة '+cycle+'</b><span>'+(state.installment==='all'?'جميع الأقساط':state.installment==='current'?'القسط الحالي':'القسط '+state.installment)+' · '+esc(first.periodStart?dateLabel(first.periodStart):'—')+' – '+esc(first.periodEnd?dateLabel(first.periodEnd):'—')+'</span></div><div class="mgd-summary-stats"><span>السجلات <b>'+shown.length+'</b></span><span>مدفوعة <b>'+paid+'</b></span><span>معلقة <b>'+pending+'</b></span><span>متأخرة <b>'+late+'</b></span></div><div class="mgd-summary-stats"><span>المستحق <b>'+esc(moneyValue(totalAmount,g.currency))+'</b></span><span>المحصّل <b>'+esc(moneyValue(collectedAmount,g.currency))+'</b></span><span>المتبقي <b>'+esc(moneyValue(remainingAmount,g.currency))+'</b></span></div></section>'+
      '<div class="mgd-installment-toolbar" id="mgdInstallmentToolbar"><label class="mgd-search mgd-installment-search">'+uiIcon('search',17)+'<input id="mgdInstallmentSearch" type="search" placeholder="ابحث باسم العضو" autocomplete="off"></label>'+
      '<button type="button" class="mgd-tool-icon" data-action="managed-installment-filter" id="mgdInstallmentFilterToggle" aria-label="الفلاتر" aria-expanded="'+(state.installmentFiltersOpen?'true':'false')+'">'+uiIcon('sliders-horizontal',19)+'</button>'+
      '<div class="mgd-installment-filter-fields"><label class="mgd-select"><select id="mgdInstallmentCycle" aria-label="القرعة">'+cycleOptions+'</select></label><label class="mgd-select"><select id="mgdInstallmentNumber" aria-label="القسط">'+installmentOptions+'</select></label><label class="mgd-select"><select id="mgdInstallmentStatus" aria-label="حالة القسط"><option value="all">كل الحالات</option></select></label></div></div>'+
      (manager?'<div class="mgd-selection-bar" id="mgdInstallmentSelectionBar" hidden><span class="mgd-selection-count" id="mgdInstallmentSelectionCount">0 محدد</span><button type="button" class="mgd-selection-secondary" data-action="managed-installment-select-visible" id="mgdInstallmentSelectVisible">تحديد الظاهر</button><button type="button" class="mgd-selection-reminder" data-action="managed-installment-bulk-reminder" id="mgdInstallmentBulkReminder" disabled>'+uiIcon('bell',15)+'<span>تذكير</span></button><button type="button" class="mgd-selection-cancel" data-action="managed-installment-cancel-selection" id="mgdInstallmentCancelSelection" aria-label="إلغاء التحديد">'+uiIcon('x',17)+'</button></div>':'')+
      '<div id="mgdInstallmentList" class="mgd-installment-list"></div>' + (manager ? receiptHistoryPanel(g) : '<button type="button" class="mgd-secondary-link" data-go="receipts">سجل الاستلام والتصحيحات '+uiIcon('back-screen',16)+'</button>');
  }
  async function cycleDetail(g, d, round) {
    const historyResult = await cachedRead('history:' + g.id, () => SahmApp.getDrawHistory(g.id), 15000), history = historyResult && historyResult.ok ? (historyResult.history || []) : [];
    const draw = history.find(x => Number(x.round_no || x.round) === round);
    const rows = SahmApp.installmentRows(g.id, { cycle: round, status: 'all' });
    const obligations = rows && rows.ok ? rows.rows || [] : [];
    return backToTab('draws') + '<div class="mgd-detail-heading"><b>القرعة ' + round + '</b>' + (draw ? '<span class="mgd-role">نتيجة مثبتة</span>' : '<span class="mgd-role">تفاصيل القرعة</span>') + '</div>' +
      (draw ? '<section class="mgd-detail-card">' + row('trophy', 'الفائز', draw.winner_owner_name || draw.winnerLabel || '—') +
        row('hash', 'رقم السهم', draw.winner_share_no || '—') +
        row('calendar-days', 'تاريخ القرعة', dateLabel(draw.scheduled_on || draw.date)) +
        row('coins', 'الجائزة المستهدفة', moneyValue(draw.prize_target_minor || draw.prize || 0, draw.currency || g.currency)) +
        row('monitor', 'حالة العرض', draw.presentation_status || '—') + '</section>' : '') +
      '<div class="mgd-list-head"><b>أقساط القرعة</b><span>' + obligations.length + ' سجل</span></div>' +
      '<div class="mgd-list">' + (obligations.map(x => '<div class="mgd-simple-row"><span><b>' + esc(x.memberName) + '</b><small>القسط ' + x.no + '</small></span>' + pill(x.status) + '</div>').join('') || '<div class="mgd-empty">لا توجد بيانات أقساط لهذه القرعة</div>') + '</div>';
  }
  function drawWheelMarkup(eligible, draw) {
    const count=Math.max(eligible.length,1), colors=['#0f766e','#1d4ed8','#b45309','#7c3aed','#be123c','#0369a1','#4d7c0f'];
    const gradient=eligible.length?'conic-gradient('+eligible.map((x,i)=>colors[i%colors.length]+' '+(i*360/count)+'deg '+((i+1)*360/count)+'deg').join(',')+')':'conic-gradient(#cbd5e1 0deg 360deg)';
    const index=draw&&Number.isInteger(Number(draw.winner_index))?Number(draw.winner_index):0;
    const rotation=draw?(360*5+(360-((index+.5)*360/count))):0;
    const animate=!!drawAnimationPending; if(animate)drawAnimationPending=false;
    return '<div class="draw-wheel-wrap mgd-wheel-wrap"><div class="draw-pointer"></div><div class="draw-wheel" data-final-rotation="'+rotation+'" style="background:'+gradient+';transform:rotate('+(animate?0:rotation)+'deg);'+(animate?'transition:transform 4.2s cubic-bezier(.12,.72,.12,1);':'transition:none;')+'"><span>سهم</span></div></div>';
  }
  async function drawPanel(g, d, allViews) {
    if (allViews) {
      const previousView = params.managedDrawView;
      const sections = [];
      try {
        for (const viewName of ['summary','eligible','schedule','result','history']) {
          params.managedDrawView = viewName;
          const rendered = await drawPanel(g, d, false);
          const navEnd = rendered.indexOf('</nav>');
          const panel = navEnd >= 0 ? rendered.slice(navEnd + 6) : rendered;
          sections.push(panel.replace(/ id="mgd-draw-panel" role="tabpanel" aria-labelledby="mgd-draw-tab-[^"]+"/, ''));
        }
      } finally { params.managedDrawView = previousView; }
      return '<div class="mgd-draw-all-sections">' + sections.join('') + '</div>';
    }
    const manager = !!(d.role && d.role.manager);
    const allowedViews = manager ? ['summary','eligible','schedule','result','history'] : ['summary','eligible','result','history'];
    const requestedView = params.managedDrawView || 'summary';
    const view = allowedViews.includes(requestedView) ? requestedView : 'summary';
    const roomPromise = cachedRead('draw-room:' + g.id, () => SahmApp.getDrawRoom(g.id), 7000);
    // These RPCs are manager-only. A participant must never call them.
    const readinessPromise = manager && (view === 'summary' || view === 'result')
      ? cachedRead('draw-ready:' + g.id, () => SahmApp.getDrawReadiness(g.id), 7000) : null;
    const financialPromise = manager && view === 'summary'
      ? cachedRead('financial:' + g.id, () => SahmApp.getFinancialSummary(g.id), 7000) : null;
    const roomResult = await roomPromise;
    if (!roomResult || !roomResult.ok) return '<div class="mgd-empty">' + esc(roomResult && roomResult.message || 'تعذر تحميل غرفة القرعة') + '</div>';
    const room = roomResult.room || {}, cycle = room.cycle || {}, draw = room.draw || null, eligible = room.eligible_shares || [];
    let readiness = {}, financial = null, history = [];
    if (readinessPromise && (view === 'summary' || !draw)) {
      const results = await Promise.all([readinessPromise, financialPromise].filter(Boolean));
      readiness = results[0] && results[0].ok ? results[0] : {};
      financial = view === 'summary' && results[1] && results[1].ok ? results[1].summary : null;
    }
    if (view === 'history') {
      const historyResult = await cachedRead('history:' + g.id, () => SahmApp.getDrawHistory(g.id), 15000);
      history = historyResult && historyResult.ok ? historyResult.history || [] : [];
    }
    const states = { none: 'لم تبدأ القرعة', pending: 'بانتظار الموعد', scheduled: 'موعد محدد', open: 'مفتوحة', presenting: 'جارٍ عرض النتيجة', completed: 'اكتمل العرض', failed: 'تعذر العرض' };
    const reasons = { NO_SHARES: 'لا توجد أسهم مؤهلة', DRAW_COMPLETE: 'اكتملت جميع جولات القرعة', DRAW_NOT_DUE: 'لم يحن موعد القرعة بعد', INSTALLMENTS_UNPAID: 'توجد أقساط غير مكتملة', FINANCIAL_NOT_READY: 'لم تكتمل المتطلبات المالية' };
    const drawTabs = manager
      ? [['summary','الملخص'],['eligible','الأسهم المؤهلة'],['schedule','الموعد'],['result','النتيجة'],['history','السجل']]
      : [['summary','الملخص'],['eligible','الأسهم المؤهلة'],['result','النتيجة'],['history','السجل']];
    const nav = '<nav class="mgd-draw-nav" aria-label="أقسام غرفة القرعة" role="tablist">' + drawTabs.map(([id,label]) =>
      '<button id="mgd-draw-tab-' + id + '" type="button" role="tab" aria-selected="' + (view === id ? 'true' : 'false') + '" aria-controls="mgd-draw-panel" tabindex="' + (view === id ? '0' : '-1') + '" class="' + (view === id ? 'active' : '') + '" data-action="managed-draw-view" data-view="' + id + '">' + label + '</button>').join('') + '</nav>';
    let body = '';
    const wheel = drawWheelMarkup(eligible,draw);
    if (view === 'summary') {
      const totals = financial && financial.totals || {}, shares = financial && financial.shares || {};
      body = wheel + '<section class="mgd-detail-card"><div class="mgd-detail-heading"><b>القرعة ' + esc(room.round_no || '—') + ' من ' + esc(room.rounds_total || d.rounds || '—') + '</b><span class="mgd-role">' + esc(states[room.state] || room.state || '—') + '</span></div>' +
        row('calendar-days', 'تاريخ الاستحقاق', dateLabel(cycle.due_on)) +
        row('clock', 'موعد القرعة', cycle.draw_scheduled_at ? SahmCore.fmtDateTime(cycle.draw_scheduled_at, 'Asia/Aden') : 'غير محدد') +
        row('users', 'الأسهم المؤهلة', eligible.length) +
        (manager ? row('shield-check', 'الجاهزية', readiness.canDraw ? 'جاهزة للتنفيذ' : 'غير جاهزة') : row('info', 'حالة القرعة', states[room.state] || 'قيد المتابعة')) +
        (draw ? row('trophy', 'الفائز', draw.winner_owner_name || '—') : '') + '</section>' +
        (manager && readiness.reasons && readiness.reasons.length ? '<section class="mgd-detail-card"><b>متطلبات الجاهزية</b>' + readiness.reasons.map(x => '<div class="mgd-reason">' + esc(reasons[x] || x) + '</div>').join('') + '</section>' : '') +
        (manager && financial ? '<section class="mgd-detail-card"><b>ملخص مالي</b>' + row('wallet', 'الالتزامات', moneyValue(totals.due_minor || 0, g.currency)) +
          row('check-circle', 'المستلم', moneyValue(totals.collected_minor || 0, g.currency)) +
          row('clock', 'المتبقي', moneyValue(totals.remaining_minor || 0, g.currency)) +
          row('alert', 'المتأخر', moneyValue(totals.overdue_minor || 0, g.currency)) +
          row('users', 'الأسهم المكتملة مالياً', (shares.complete || 0) + ' من ' + (shares.total || 0)) + '</section>' : '');
    } else if (view === 'eligible') {
      body = '<div class="mgd-list-head"><b>الأسهم المؤهلة</b><span>' + eligible.length + ' سهم</span></div><div class="mgd-list">' +
        (eligible.map(x => '<div class="mgd-simple-row"><span class="mgd-share-no">' + esc(x.share_no || '—') + '</span><span class="mgd-member-main"><b>' + esc(x.owner_name || 'مشارك') + '</b><small>السهم ' + esc(x.share_no || '—') + '</small></span><span class="mgd-status-ok">مؤهل</span></div>').join('') || '<div class="mgd-empty">لا توجد أسهم مؤهلة حاليًا</div>') + '</div>';
    } else if (view === 'schedule') {
      body = '<section class="mgd-detail-card"><b>موعد القرعة · توقيت اليمن</b><label class="mgd-date-field"><span>تاريخ ووقت التنفيذ</span><input id="drawScheduledAt" type="datetime-local" value="' + esc(utcToAdenDateTime(cycle.draw_scheduled_at)) + '" ' + (draw ? 'disabled' : '') + '></label>' +
        (draw ? '<div class="mgd-reason">تم تثبيت نتيجة هذه القرعة؛ لا يمكن تغيير موعدها.</div>' : actionButton('حفظ موعد القرعة', 'schedule-draw', '', 'primary')) + '</section>';
    } else if (view === 'result') {
      body = wheel + '<section class="mgd-detail-card"><div class="mgd-detail-heading"><b>نتيجة القرعة</b>' + pill(room.state || 'pending') + '</div>' +
        (draw ? '<div class="mgd-winner"><span>' + uiIcon('trophy', 25) + '</span><b>' + esc(draw.winner_owner_name || 'الفائز') + '</b><small>السهم ' + esc(draw.winner_share_no || '—') + '</small></div>' :
          '<div class="mgd-empty">' + (manager ? 'لم تُثبت نتيجة القرعة بعد' : 'لم تُعلن نتيجة هذه القرعة بعد') + '</div>') +
        (manager ? (draw ? '<div class="mgd-actions">' + actionButton('تسجيل اكتمال العرض', 'draw-presentation-completed', '', 'primary') + actionButton('تسجيل تعذر العرض', 'draw-presentation-failed', '', '') + '</div>' :
          actionButton('تنفيذ القرعة وتثبيت النتيجة', 'run-draw', readiness.canDraw ? '' : 'disabled', 'primary')) : '') + '</section>';
    } else {
      body = '<div class="mgd-list-head"><b>سجل القرعات</b><span>' + history.length + ' نتيجة</span></div><div class="mgd-list">' +
        (history.map(x => '<div class="mgd-simple-row"><span class="mgd-cycle-number">' + esc(x.round_no || x.round) + '</span><span class="mgd-member-main"><b>القرعة ' + esc(x.round_no || x.round) + ' · ' + esc(x.winner_owner_name || x.winnerLabel || '—') + '</b><small>' + esc(dateLabel(x.scheduled_on || x.date)) + '</small></span><span class="mgd-status-ok">مثبتة</span></div>').join('') || '<div class="mgd-empty">لا توجد نتائج مثبتة بعد</div>') + '</div>';
    }
    return nav + '<section id="mgd-draw-panel" class="mgd-draw-panel" role="tabpanel" aria-labelledby="mgd-draw-tab-' + view + '">' + body + '</section>';
  }
  async function newsPanel(g, d) {
    const result = await cachedRead('news:' + g.id, () => SahmApp.getNews(g.id, 50), 12000);
    if (!result || !result.ok) return '<div class="mgd-empty">' + esc(result && result.message || 'تعذر تحميل أخبار الجمعية') + '</div>';
    const labels = { received:'استلام قسط', completed:'اكتمال الأقساط', late:'تأخر قسط', drawSoon:'اقتراب القرعة', drawDue:'موعد القرعة', drawResult:'نتيجة القرعة', joined:'انضمام عضو', motivate:'خبر الجمعية' };
    const rows = (result.news || []).map(x =>
      '<article class="mgd-feed-card"><div class="mgd-feed-icon">' + uiIcon(x.type === 'drawResult' ? 'trophy' : 'wall', 18) + '</div><div class="mgd-feed-copy"><b>' + esc(x.title || labels[x.type] || 'خبر الجمعية') + '</b>' +
      (x.body ? '<p>' + esc(x.body) + '</p>' : '') +
      (x.subject_visible === true && x.subject_name ? '<small>' + esc(x.subject_name) + '</small>' : '') +
      '<small class="mgd-feed-time">' + esc(x.occurred_at || '') + '</small></div></article>'
    ).join('');
    return '<div class="mgd-list-head"><b>أخبار الجمعية</b><span>' + (result.news || []).length + ' خبر</span></div>' +
      '<div class="mgd-feed-list">' + (rows || '<div class="mgd-empty">لا توجد أخبار منشورة</div>') + '</div>';
  }
  function notificationSettingsPanel(d) {
    const group = d.group || {};
    const channel = (key, label, map) => '<section class="mgd-detail-card"><b>' + label + '</b>' +
      SahmApp.notifyTypes().map(t => '<label class="mgd-toggle-row"><span>' + esc(t.label) + '</span><input type="checkbox" data-action="notify-channel-toggle" data-channel="' + key + '" data-type="' + esc(t.id) + '" ' + (map && map[t.id] ? 'checked' : '') + '></label>').join('') + '</section>';
    return '<div class="mgd-list-head"><b>إعدادات النشر</b><span>للأخبار ومحادثة الجمعية</span></div>' +
      channel('feed', 'النشر في أخبار الجمعية', group.notify) +
      channel('chat', 'النشر في محادثة الجمعية', group.notifyChat) +
      channel('names', 'إظهار أسماء الأعضاء في الأخبار', group.notifyNames);
  }
  function chatPanel(g) {
    const result = SahmApp.chatView(g.id);
    if (!result || !result.ok) return '<div class="mgd-empty">' + esc(result && result.message || 'تعذر تحميل محادثة الجمعية') + '</div>';
    SahmApp.markChatRead(g.id);
    const rows = (result.messages || []).map(x =>
      '<article class="chatbubble ' + (x.kind === 'member' && x.mine ? 'mine' : '') + '"><b>' +
      (x.kind === 'system' ? 'سهم' : esc(x.senderName || 'مشارك')) + '</b><div>' + esc(x.text) + '</div><small class="eyebrow">' +
      esc(x.timeLabel || SahmApp.chatTime(x.at)) + '</small></article>'
    ).join('');
    return '<div class="mgd-chat-list" id="mgdChatMessages">' + (rows || '<div class="mgd-empty">لا توجد رسائل بعد</div>') + '</div>' +
      '<form id="mgdChatForm" class="mgd-chat-form"><label for="mgdChatInput">رسالتك</label>' +
      '<textarea id="mgdChatInput" name="text" maxlength="' + SahmApp.maxMessage() + '" placeholder="اكتب رسالة..." required></textarea>' +
      '<div class="mgd-chat-footer"><small id="mgdChatCount">0 / ' + SahmApp.maxMessage() + '</small>' +
      '<button type="submit" class="mgd-action primary">إرسال</button></div></form>';
  }
  async function auditPanel(g) {
    const result = await cachedRead('audit:' + g.id, () => SahmApp.getAuditLog(g.id, 100), 12000);
    if (!result || !result.ok) return '<div class="mgd-empty">' + esc(result && result.message || 'تعذر تحميل سجل العمليات') + '</div>';
    const labels = { association_created:'إنشاء الجمعية', association_updated:'تعديل الجمعية', member_joined:'انضمام عضو', member_removed:'إزالة عضو', shares_added:'إضافة أسهم', shares_removed:'إزالة أسهم', invitation_created:'إنشاء دعوة', invitation_cancelled:'إلغاء دعوة', receipt_recorded:'تسجيل استلام', installment_received:'استلام قسط', receipt_corrected:'تصحيح استلام', draw_result:'تثبيت نتيجة القرعة', draw_scheduled:'تحديد موعد القرعة', draw_presentation_completed:'اكتمال عرض القرعة', draw_presentation_failed:'فشل عرض القرعة', notification_settings_updated:'تعديل إعدادات النشر', reminders_sent:'إرسال تذكيرات' };
    const items = (result.log || []).map(x =>
      '<article class="mgd-audit-item"><div class="mgd-audit-icon">' + uiIcon('clipboard-list', 17) + '</div><div class="mgd-audit-copy"><b>' + esc(labels[x.event_type] || x.event_type || 'عملية إدارية') +
      '</b><small>' + esc(x.actor_name || 'سهم') + ' · ' + esc(x.entity_type || '') + '</small><small>' + esc(x.occurred_at || '') + '</small>' +
      (x.after_data ? '<details><summary>تفاصيل العملية</summary><pre>' + esc(JSON.stringify(x.after_data, null, 2)) + '</pre></details>' : '') + '</div></article>'
    ).join('');
    return '<div class="mgd-list-head"><b>سجل العمليات</b><span>' + (result.log || []).length + ' عملية</span></div>' +
      '<div class="mgd-audit-list">' + (items || '<div class="mgd-empty">لا توجد عمليات مسجلة</div>') + '</div>';
  }
  function bindChatComposer() {
    const input = document.getElementById('mgdChatInput'), count = document.getElementById('mgdChatCount');
    if (!input || !count) return;
    input.addEventListener('input', () => { count.textContent = input.value.length + ' / ' + SahmApp.maxMessage(); });
  }
  function ownMemberId(g) {
    const result=SahmApp.memberList(g.id), members=result&&result.ok?result.members||[]:[];
    const own=members.find(x=>x.isMe);
    return own&&own.memberId||'';
  }
  function memberOverview(g,d) {
    const st=SahmApp.memberStatement(g.id,ownMemberId(g)); if(!st||!st.ok)return '<div class="mgd-empty">تعذر تحميل ملخص مشاركتك</div>';
    const cycle=(st.cycles||[]).slice(-1)[0],p=cycle&&cycle.progress||d.myProgress||{},r=SahmApp.myShareList(g.id,{status:'all'}),shares=r&&r.ok?r.shares||[]:[];
    return '<section class="mgd-detail-card"><div class="mgd-list-head"><b>مشاركتك في الجمعية</b><span>'+esc(st.memberName)+'</span></div><div class="mgd-member-stat-grid"><div><small>أسهمك</small><b>'+Number(st.shares||0)+'</b></div><div><small>فائزة</small><b>'+ (r&&r.ok?shares.filter(x=>x.status==='won').length:'—') +'</b></div><div><small>مؤهلة</small><b>'+ (r&&r.ok?shares.filter(x=>x.status==='eligible').length:'—') +'</b></div></div><div class="mgd-detail-heading"><b>التزامات القرعة الحالية</b><span>'+(p.paid||0)+' / '+(p.total||0)+'</span></div><div class="mgd-round-progress"><i style="width:'+(p.total?Math.round((p.paid||0)/p.total*100):0)+'%"></i></div><div class="mgd-summary-stats"><span>إجمالي الالتزام <b>'+esc(moneyValue(st.commitment&&st.commitment.overall,st.currency))+'</b></span><span>الأقساط <b>'+(p.paid||0)+' من '+(p.total||0)+'</b></span></div></section><section class="mgd-detail-card">'+row('user','مدير الجمعية',g.admin||'—')+row('calendar','بداية الجمعية',dateLabel(g.start||g.startDate))+'</section>';
  }
  function memberInstallments(g) {
    const st=SahmApp.memberStatement(g.id,ownMemberId(g)); if(!st||!st.ok)return '<div class="mgd-empty">تعذر تحميل أقساطك</div>';
    return (st.cycles||[]).slice().reverse().map(c=>{const paid=(c.rows||[]).filter(x=>x.status==='paid').length;return '<section class="mgd-detail-card"><div class="mgd-detail-heading"><b>القرعة '+c.cycle+'</b><span>'+paid+' من '+(c.rows||[]).length+' مدفوع</span></div><div class="mgd-round-progress"><i style="width:'+(c.rows&&c.rows.length?Math.round(paid/c.rows.length*100):0)+'%"></i></div>'+(c.rows||[]).map(x=>'<div class="mgd-simple-row"><span><b>القسط '+x.no+'</b><small>'+esc(dateLabel(x.periodStart))+' – '+esc(dateLabel(x.periodEnd))+'</small></span>'+pill(x.status)+'<b>'+esc(moneyValue(x.total,st.currency))+'</b></div>').join('')+'</section>';}).join('')||'<div class="mgd-empty">لا توجد أقساط مسجلة لمشاركتك بعد</div>';
  }
  function memberShares(g) {
    const result=SahmApp.myShareList(g.id,{status:'all'});
    if(!result||!result.ok)return '<div class="mgd-empty">'+esc(result&&result.message||'تعذر تحميل أسهمك')+'</div>';
    const list=result.shares||[],won=list.filter(x=>x.status==='won').length;
    return '<div class="mgd-list-head"><b>أسهمك</b><span>'+list.length+' سهم · '+won+' فائزة</span></div><div class="mgd-list">'+
      (list.map(x=>'<article class="mgd-installment-card"><div class="mgd-installment-top"><b>السهم '+esc(x.shareNo)+'</b><span class="mgd-share-state '+(x.status==='won'?'won':'eligible')+'">'+(x.status==='won'?'فائز':'مؤهل')+'</span></div><div class="mgd-installment-meta"><span>'+(x.status==='won'?'فاز في القرعة رقم '+esc(x.winnerRound):'ما زال مؤهلاً للقرعات المتبقية')+'</span></div></article>').join('')||'<div class="mgd-empty">لا توجد أسهم مرتبطة بحسابك</div>')+'</div>';
  }
  async function memberDraws(g) {
    const r=await cachedRead('history:'+g.id,()=>SahmApp.drawHistory(g.id),15000),history=r&&r.ok?(r.history||r.draws||[]):[];
    return '<section class="mgd-detail-card mgd-member-draw-entry"><div class="mgd-detail-heading"><b>غرفة القرعة</b><span>'+history.length+' نتيجة مثبتة</span></div><p>تابع حالة القرعة والأسهم المؤهلة والنتيجة المعتمدة من داخل الغرفة.</p><button type="button" class="mgd-action primary mgd-room-entry" data-action="managed-draw-view" data-view="summary">'+uiIcon('shuffle',17)+' فتح غرفة القرعة</button></section>';
  }
  function memberCommunication() {return '<div class="mgd-settings-grid"><button type="button" data-action="managed-settings-view" data-view="news">'+uiIcon('wall',18)+'<span>أخبار الجمعية</span></button><button type="button" data-action="managed-settings-view" data-view="chat">'+uiIcon('messages',18)+'<span>محادثة الأعضاء</span></button></div>';}

  function memberDashboard(g, d) {
    if (dashboardTimer) { clearInterval(dashboardTimer); dashboardTimer = null; }
    const statement = SahmApp.memberStatement(g.id, ownMemberId(g));
    if (!statement || !statement.ok) {
      shell('الجمعية', 'groups', '<main class="mgd-home"><div class="mgd-empty">تعذر تحميل ملخص مشاركتك</div></main>');
      return;
    }
    const cycle = (statement.cycles || []).slice(-1)[0];
    const progress = cycle && cycle.progress || d.myProgress || {};
    const shareResult = SahmApp.myShareList(g.id, { status: 'all' });
    const shares = shareResult && shareResult.ok ? shareResult.shares || [] : [];
    const paid = Number(progress.paid || 0), total = Number(progress.total || 0);
    const completion = total ? Math.round(paid / total * 100) : 0;
    const won = shares.filter(x => x.status === 'won').length;
    const slides = [
      { title: 'أسهمك', value: Number(statement.shares || 0), note: 'إجمالي الأسهم المسجلة باسمك', icon: 'layers', tone: 'blue' },
      { title: 'الأسهم الفائزة', value: won, note: 'الأسهم التي فازت في القرعات', icon: 'trophy', tone: 'gold' },
      { title: 'إنجاز السداد', value: completion + '%', note: paid + ' من ' + total + ' التزامات مسددة', icon: 'receipt', tone: 'dark' },
      { title: 'إجمالي التزامك', value: moneyValue(statement.commitment && statement.commitment.overall, statement.currency), note: 'قيمة التزاماتك المسجلة في الجمعية', icon: 'wallet', tone: 'blue' }
    ];
    const memberSections = [
      ['installments', 'receipt', 'أقساطي'],
      ['shares', 'layers', 'أسهمي'],
      ['draws', 'shuffle', 'القرعات'],
      ['communication', 'messages', 'التواصل']
    ];
    const slidesHtml = slides.map((x, i) =>
      '<article class="mgd-home-slide ' + x.tone + (i === 0 ? ' active' : '') + '" data-mgd-slide="' + i + '" aria-hidden="' + (i !== 0) + '">' +
      '<span class="mgd-home-slide-icon">' + uiIcon(x.icon, 27) + '</span><span class="mgd-home-slide-copy"><b>' + esc(x.title) + '</b><strong>' + esc(x.value) + '</strong><small>' + esc(x.note) + '</small></span>' +
      '<span class="mgd-home-slide-index">0' + (i + 1) + ' / 0' + slides.length + '</span></article>'
    ).join('');
    const dots = slides.map((x, i) => '<button type="button" data-action="managed-home-slide" class="' + (i === 0 ? 'active' : '') + '" data-mgd-slide-to="' + i + '" aria-label="عرض ' + esc(x.title) + '" aria-pressed="' + (i === 0) + '"></button>').join('');
    const cards = memberSections.map(([id, icon, label]) =>
      '<button type="button" class="mgd-home-section" data-action="managed-home-section" data-section="' + id + '">' +
      '<span class="mgd-home-section-icon">' + uiIcon(icon, 29) + '</span><span>' + label + '</span></button>'
    ).join('');
    shell('الجمعية', 'groups',
      '<main class="mgd-home">' +
      '<section class="mgd-home-summary" aria-label="ملخص مشاركتك"><div class="mgd-home-carousel" id="mgdHomeCarousel" aria-live="polite">' + slidesHtml + '</div>' +
      '<div class="mgd-home-dots" role="group" aria-label="التنقل بين الملخصات">' + dots + '</div></section>' +
      '<section class="mgd-home-sections" aria-label="أقسام مشاركتك">' + cards + '</section></main>');
    let active = 0, startX = 0;
    const carousel = document.getElementById('mgdHomeCarousel');
    const show = next => {
      if (!carousel) return;
      const all = Array.from(carousel.querySelectorAll('[data-mgd-slide]'));
      active = (next + all.length) % all.length;
      all.forEach((slide, i) => { slide.classList.toggle('active', i === active); slide.setAttribute('aria-hidden', String(i !== active)); });
      document.querySelectorAll('.mgd-home-dots [data-mgd-slide-to]').forEach((dot, i) => { dot.classList.toggle('active', i === active); dot.setAttribute('aria-pressed', String(i === active)); });
    };
    document.querySelectorAll('.mgd-home-dots [data-mgd-slide-to]').forEach(dot => dot.addEventListener('click', () => show(Number(dot.dataset.mgdSlideTo) || 0)));
    if (carousel) {
      carousel.addEventListener('pointerdown', event => { startX = event.clientX; });
      carousel.addEventListener('pointerup', event => { const delta = event.clientX - startX; if (Math.abs(delta) > 35) show(active + (delta < 0 ? 1 : -1)); });
    }
    dashboardTimer = setInterval(() => show(active + 1), 5000);
  }

  function managerDashboard(g, d) {
    if (dashboardTimer) { clearInterval(dashboardTimer); dashboardTimer = null; }
    const rounds = Math.max(0, Number(d.rounds) || 0), drawn = Math.max(0, Number(d.drawn) || 0);
    const current = Math.min(rounds || 1, Math.max(1, Number(d.cycle || 1)));
    const snapshot = SahmApp.installmentRows(g.id, { cycle: current, status: 'all' });
    const obligations = snapshot && snapshot.ok ? snapshot.rows || [] : [];
    const paid = obligations.filter(x => x.status === 'paid').length;
    const collection = obligations.length ? Math.round(paid / obligations.length * 100) : 0;
    const slides = [
      { title: 'أعضاء الجمعية', value: Number(d.members || 0), note: 'إجمالي الأعضاء', icon: 'users', tone: 'blue' },
      { title: 'إجمالي الأسهم', value: Number(g.shares || d.totalShares || 0), note: 'الأسهم المسجلة في الجمعية', icon: 'layers', tone: 'gold' },
      { title: 'إنجاز القرعات', value: drawn + ' / ' + rounds, note: 'القرعات المكتملة من الإجمالي', icon: 'shuffle', tone: 'dark' },
      { title: 'تحصيل القرعة الحالية', value: collection + '%', note: paid + ' من ' + obligations.length + ' التزاماً مسدداً', icon: 'wallet', tone: 'blue' }
    ];
    const sections = [
      ['installments','receipt','التحصيل'],
      ['draws','shuffle','القرعات'],
      ['shares','layers','الأسهم'],
      ['members','users','الأعضاء'],
      ['invites','user-plus','الدعوات'],
      ['chat','messages','الدردشة'],
      ['room','door-open','الغرفة'],
      ['information','info','المعلومات'],
      ['settings','settings','الإعدادات'],
      ['audit','history','السجل']
    ];
    const slidesHtml = slides.map((x, i) =>
      '<article class="mgd-home-slide ' + x.tone + (i === 0 ? ' active' : '') + '" data-mgd-slide="' + i + '" aria-hidden="' + (i !== 0) + '">' +
      '<span class="mgd-home-slide-icon">' + uiIcon(x.icon, 27) + '</span><span class="mgd-home-slide-copy"><b>' + esc(x.title) + '</b><strong>' + esc(x.value) + '</strong><small>' + esc(x.note) + '</small></span>' +
      '<span class="mgd-home-slide-index">0' + (i + 1) + ' / 0' + slides.length + '</span></article>'
    ).join('');
    const dots = slides.map((x, i) => '<button type="button" data-action="managed-home-slide" class="' + (i === 0 ? 'active' : '') + '" data-mgd-slide-to="' + i + '" aria-label="عرض ' + esc(x.title) + '" aria-pressed="' + (i === 0) + '"></button>').join('');
    const cards = sections.map(([id, icon, label]) =>
      '<button type="button" class="mgd-home-section" data-action="managed-home-section" data-section="' + id + '">' +
      '<span class="mgd-home-section-icon">' + uiIcon(icon, 29) + '</span><span>' + label + '</span></button>'
    ).join('');
    shell('الجمعية', 'groups',
      '<main class="mgd-home">' +
      '<section class="mgd-home-summary" aria-label="ملخص الجمعية"><div class="mgd-home-carousel" id="mgdHomeCarousel" aria-live="polite">' + slidesHtml + '</div>' +
      '<div class="mgd-home-dots" role="group" aria-label="التنقل بين الملخصات">' + dots + '</div></section>' +
      '<section class="mgd-home-sections" aria-label="أقسام الجمعية">' + cards + '</section></main>');
    let active = 0, startX = 0;
    const carousel = document.getElementById('mgdHomeCarousel');
    const show = next => {
      const all = Array.from(carousel.querySelectorAll('[data-mgd-slide]'));
      active = (next + all.length) % all.length;
      all.forEach((slide, i) => { slide.classList.toggle('active', i === active); slide.setAttribute('aria-hidden', String(i !== active)); });
      document.querySelectorAll('.mgd-home-dots [data-mgd-slide-to]').forEach((dot, i) => { dot.classList.toggle('active', i === active); dot.setAttribute('aria-pressed', String(i === active)); });
    };
    document.querySelectorAll('.mgd-home-dots [data-mgd-slide-to]').forEach(dot => dot.addEventListener('click', () => show(Number(dot.dataset.mgdSlideTo) || 0)));
    if (carousel) {
      carousel.addEventListener('pointerdown', event => { startX = event.clientX; });
      carousel.addEventListener('pointerup', event => { const delta = event.clientX - startX; if (Math.abs(delta) > 35) show(active + (delta < 0 ? 1 : -1)); });
    }
    dashboardTimer = setInterval(() => show(active + 1), 5000);
  }

  /* Dedicated manager workspaces. The legacy tab-driven manager path is bypassed. */
  const MANAGER_SECTION_TITLES = Object.freeze({
    installments: 'التحصيل', draws: 'القرعات', shares: 'الأسهم', members: 'الأعضاء',
    invites: 'الدعوات', chat: 'الدردشة', room: 'الغرفة', information: 'المعلومات',
    settings: 'الإعدادات', audit: 'السجل', news: 'أخبار الجمعية'
  });
  function managerSectionFrame(g, title, content) {
    return '<main class="mgd-new-screen"><header class="mgd-new-screen-head">' +
      '<button type="button" class="mgd-new-screen-back" data-action="managed-section-home" aria-label="العودة إلى لوحة الجمعية">' + uiIcon('arrow-right',18) + '</button>' +
      '<div class="mgd-new-screen-title"><small>' + esc(g.name || 'الجمعية') + '</small><h1>' + esc(title) + '</h1></div>' +
      '</header><section class="mgd-new-screen-body">' + content + '</section></main>';
  }
  function mountManagerSection(g, title, content) {
    shell(title, 'groups', managerSectionFrame(g, title, content));
  }
  function managerInformationContent(g, d) {
    return '<section class="mgd-new-info-grid">' +
      '<article><span>بداية الجمعية</span><b>' + esc(dateLabel(g.start || g.startDate)) + '</b></article>' +
      '<article><span>أول موعد للقرعة</span><b>' + esc(dateLabel(g.first || g.firstDrawOn)) + '</b></article>' +
      '<article><span>قيمة السهم</span><b>' + esc(money(g.share, g.currency)) + '</b></article>' +
      '<article><span>عدد الأقساط</span><b>' + esc(g.installments || '—') + '</b></article>' +
      '<article><span>مدة فترة التحصيل</span><b>' + esc((g.cycleDays || g.periodDays || '—') + ' يوم') + '</b></article>' +
      '<article><span>الجائزة المستهدفة</span><b>' + esc(moneyValue(d.plan && d.plan.prizeTarget || 0, g.currency)) + '</b></article>' +
      '<article><span>عدد الأعضاء</span><b>' + esc(d.members || 0) + '</b></article>' +
      '<article><span>إجمالي الأسهم</span><b>' + esc(g.shares || d.totalShares || 0) + '</b></article>' +
    '</section>' +
    (g.rules ? '<section class="mgd-detail-card mgd-new-rules"><b>قواعد الجمعية</b><p>' + esc(g.rules) + '</p></section>' : '');
  }
  async function renderManagerSection(g, d, section, version, isLatest) {
    const title = MANAGER_SECTION_TITLES[section];
    if (!title) { managerDashboard(g, d); return; }
    if (section === 'installments') {
      mountManagerSection(g, title, '<div class="mgd-collection-page">' + installmentsPanel(g, d) + '</div>');
      bindInstallmentFilters(g, d);
      return;
    }
    if (section === 'draws') {
      mountManagerSection(g, title, loadingPanel(title));
      let content = '';
      try { content = await cycleCards(g, d); }
      catch (error) { content = '<div class="mgd-empty">تعذر تحميل القرعات. تحقق من الاتصال والصلاحيات ثم أعد المحاولة.</div>'; }
      if (!isLatest()) return;
      mountManagerSection(g, title, content);
      bindDrawFilters();
      return;
    }
    if (section === 'shares') {
      state.shareStatus = state.shareStatus || 'eligible';
      mountManagerSection(g, title,
        '<div class="mgd-share-overview" id="mgdShareSummary">' + loadingPanel(title) + '</div>' +
        '<div class="mgd-new-toolbar"><div><b>سجل الأسهم</b><small>حالة الأسهم ومالك كل سهم</small></div>' +
        '<label class="mgd-select"><select id="mgdShareStatus" aria-label="تصفية الأسهم"><option value="eligible">مؤهلة</option><option value="won">فائزة</option><option value="all">كل الأسهم</option></select></label></div>' +
        '<div id="mgdShareList" class="mgd-list">' + loadingPanel(title) + '</div>');
      const filter = document.getElementById('mgdShareStatus');
      if (filter) {
        filter.value = state.shareStatus;
        filter.addEventListener('change', () => {
          state.shareStatus = filter.value;
          const target = document.getElementById('mgdShareList');
          if (target) target.innerHTML = loadingPanel(title);
          shareCards(g);
        });
      }
      await shareCards(g);
      return;
    }
    if (section === 'members') {
      mountManagerSection(g, title, memberCards(g));
      bindMemberSearch();
      return;
    }
    if (section === 'invites') {
      const result = SahmApp.inviteList(g.id);
      if (!result || !result.ok) {
        mountManagerSection(g, title, '<div class="mgd-empty">' + esc(result && result.message || 'تعذر تحميل الدعوات') + '</div>');
        return;
      }
      const items = result.invites || [];
      const requests = (db.joinRequests || []).filter(x => x.groupId === g.id)
        .slice().sort((a,b) => String(b.submittedAt||'').localeCompare(String(a.submittedAt||'')));
      const pendingRequests = requests.filter(x => x.status === 'pending');
      const activeInvites = items.filter(x => x.status === 'pending' && !['declined','legacy_accepted'].includes(x.responseStatus));
      const canInvite = !!(d.permissions && d.permissions.canInvite);
      const responseLabels = { pending_response: 'بانتظار رد المدعو', interested: 'مهتم بالانضمام', declined: 'رفض الدعوة', deferred: 'أجّل الرد', legacy_accepted: 'دعوة قديمة مقبولة' };
      const requestLabels = { pending: 'بانتظار المراجعة', approved: 'مقبول', rejected: 'مرفوض', cancelled: 'ملغى' };
      const inviteRows = items.map(item =>
        '<article class="mgd-new-invite-row"><div class="mgd-avatar">' + esc((item.name || '؟').slice(0, 1)) + '</div><div class="mgd-member-main"><b>' + esc(item.name || 'مدعو') + '</b><small>' + esc(item.phone || 'لا يوجد رقم محفوظ') + '</small><small>' + esc(responseLabels[item.responseStatus] || item.responseStatus || '—') + ' · ' + esc(dateLabel(String(item.createdAt || '').slice(0, 10))) + '</small><small>' + (item.isLegacy ? 'دعوة قديمة · ' + Number(item.shares || 0) + ' سهم' : 'يحدد المدعو الأسهم عند تقديم طلب الانضمام') + '</small></div>' +
        (item.status === 'pending' && item.responseStatus !== 'declined' ? '<button type="button" class="mgd-action" data-action="cancel-invite" data-id="' + esc(item.id) + '">إلغاء الدعوة</button>' : '<span class="mgd-role">' + esc(item.status === 'cancelled' ? 'ملغاة' : 'مكتملة') + '</span>') + '</article>'
      ).join('');
      const requestRows = requests.map(request =>
        '<article class="mgd-join-request-row"><div class="mgd-avatar">' + esc((request.applicantName || 'م').slice(0, 1)) + '</div><div class="mgd-member-main"><b>' + esc(request.applicantName || 'مقدم الطلب') + '</b><small>' + Number(request.requestedShares || 0) + ' أسهم · ' + esc(moneyValue(request.estimatedAmountMinor || 0, request.currency || g.currency)) + '</small><small>' + (request.sourceType === 'invitation' ? 'دعوة شخصية' : 'رابط عام') + ' · ' + esc(dateLabel(String(request.submittedAt || '').slice(0, 10))) + '</small><small>' + esc(requestLabels[request.status] || request.status || '—') + (request.rejectionReason ? ' · ' + esc(request.rejectionReason) : '') + '</small></div>' +
        (request.status === 'pending' ? (canInvite
          ? '<div class="mgd-request-actions"><button type="button" class="mgd-action primary" data-action="approve-join-request" data-id="' + esc(request.id) + '">موافقة</button><button type="button" class="mgd-action" data-action="reject-join-request" data-id="' + esc(request.id) + '">رفض</button></div>'
          : '<span class="mgd-role">الاتفاق مقفل</span>') : '<span class="mgd-role">' + esc(requestLabels[request.status] || request.status) + '</span>') + '</article>'
      ).join('');
      const composer = canInvite
        ? '<details class="mgd-inline-invite"><summary>إضافة دعوات جديدة</summary>' + (typeof root.managedInviteComposerMarkup === 'function' ? root.managedInviteComposerMarkup() : '<div class="mgd-empty">تعذر فتح نموذج الدعوة</div>') + '</details>'
        : '<div class="mgd-empty">استقبال الأعضاء مغلق؛ يمكنك مراجعة الدعوات والطلبات السابقة فقط.</div>';
      mountManagerSection(g, title,
        '<div class="mgd-invite-summary"><article><small>دعوات نشطة</small><b>' + activeInvites.length + '</b></article><article><small>كل الدعوات</small><b>' + items.length + '</b></article><article><small>طلبات تنتظر المراجعة</small><b>' + pendingRequests.length + '</b></article><article><small>إجمالي الطلبات</small><b>' + requests.length + '</b></article></div>' +
        composer +
        '<section class="mgd-detail-card"><div class="mgd-list-head"><b>طلبات الانضمام</b><span>' + pendingRequests.length + ' قيد المراجعة</span></div><div class="mgd-join-request-list">' + (requestRows || '<div class="mgd-empty">لا توجد طلبات انضمام</div>') + '</div></section>' +
        '<section class="mgd-detail-card"><div class="mgd-list-head"><b>الدعوات المرسلة</b><span>' + items.length + ' دعوة</span></div><div class="mgd-new-invite-list">' + (inviteRows || '<div class="mgd-empty">لا توجد دعوات مسجلة</div>') + '</div></section>');
      if (canInvite && typeof root.bindManagedInviteComposer === 'function') root.bindManagedInviteComposer();
      return;
    }
    if (section === 'chat') {
      mountManagerSection(g, title, chatPanel(g));
      bindChatComposer();
      const list = document.getElementById('mgdChatMessages');
      if (list) list.scrollTop = list.scrollHeight;
      return;
    }
    if (section === 'room') {
      params.managedDrawView = params.managedDrawView || 'summary';
      mountManagerSection(g, title, loadingPanel('غرفة القرعة'));
      let content = '';
      try { content = await drawPanel(g, d, true); }
      catch (error) { content = '<div class="mgd-empty">تعذر تحميل غرفة القرعة. تحقق من الاتصال والصلاحيات ثم أعد المحاولة.</div>'; }
      if (isLatest()) mountManagerSection(g, title, content);
      return;
    }
    if (section === 'information') {
      mountManagerSection(g, title, managerInformationContent(g, d));
      return;
    }
    if (section === 'settings') {
      const canInvite = !!(d.permissions && d.permissions.canInvite);
      mountManagerSection(g, title,
        '<section class="mgd-detail-card"><div class="mgd-detail-heading"><b>حالة إدارة الجمعية</b><span>' + (canInvite ? 'استقبال الأعضاء مفتوح' : 'استقبال الأعضاء مغلق') + '</span></div>' +
        '<div class="mgd-simple-row"><span>حالة الاتفاق</span><b>' + (d.agreementLocked ? 'مقفل' : 'قابل للتعديل') + '</b></div>' +
        '<div class="mgd-simple-row"><span>صلاحية استقبال أعضاء جدد</span><b>' + (canInvite ? 'متاحة' : 'غير متاحة') + '</b></div></section>' +
        notificationSettingsPanel(d));
      return;
    }
    if (section === 'audit' || section === 'news') {
      mountManagerSection(g, title, loadingPanel(title));
      let content = '';
      try { content = section === 'audit' ? await auditPanel(g) : await newsPanel(g, d); }
      catch (error) { content = '<div class="mgd-empty">تعذر تحميل ' + esc(title) + '</div>'; }
      if (isLatest()) mountManagerSection(g, title, content);
      return;
    }
    managerDashboard(g, d);
  }

  async function render(g, d) {
    if (dashboardTimer) { clearInterval(dashboardTimer); dashboardTimer = null; }
    const version = ++renderVersion;
    const isLatest = () => version === renderVersion;
    const view = params.managedView || '';
    if (state.groupId !== g.id) {
      state.groupId=g.id; state.cycle=null; state.installment='all'; state.status='all';
      state.query=''; state.shareStatus='eligible'; state.memberStatus='all';
    }
    const manager = !!(d.role && d.role.manager);
    if (manager) {
      await renderManagerSection(g, d, String(params.managedSection || ''), version, isLatest);
      return;
    }
    if (!view && groupDetailTab === 'overview') {
      memberDashboard(g, d);
      return;
    }
    const memberTabs = ['overview','installments','shares','draws','communication','news','chat'];
    const active = memberTabs.includes(groupDetailTab) ? groupDetailTab : 'overview';
    let content = '', deferred = null;
    if (!view) {
      if (active === 'overview') content = memberOverview(g,d);
      else if (active === 'installments') content = memberInstallments(g);
      else if (active === 'shares') content = memberShares(g);
      else if (active === 'draws') { content = loadingPanel('القرعات'); deferred = () => memberDraws(g); }
      else if (active === 'communication') content = memberCommunication();
      else if (active === 'news') { content = loadingPanel('أخبار الجمعية'); deferred = () => newsPanel(g,d); }
      else if (active === 'chat') content = chatPanel(g);
      commitRender(g,d,active,content);
      if (deferred) {
        try { content = await deferred(); }
        catch (error) { content = '<div class="mgd-empty">تعذر تحميل البيانات. حاول مرة أخرى.</div>'; }
        if (isLatest()) commitRender(g,d,active,content);
      }
      return;
    }
    if (view === 'member') {
      const memberId = String(params.memberId || '');
      const statement = SahmApp.memberStatement(g.id, memberId);
      const memberResult = SahmApp.memberList(g.id);
      const member = memberResult && memberResult.ok ? (memberResult.members || []).find(x => String(x.memberId) === memberId) : null;
      if (!statement || !statement.ok) content = backToTab('members') + '<div class="mgd-empty">' + esc(statement && statement.message || 'تعذر تحميل ملف العضو') + '</div>';
      else content = backToTab('members') + '<div class="mgd-detail-heading"><b>' + esc(statement.memberName) + '</b><span class="mgd-role">' + (member && member.isManager ? 'مدير الجمعية' : 'عضو') + '</span></div>' +
        '<section class="mgd-detail-card">' + row('users', 'عدد الأسهم', statement.shares) + row('wallet', 'إجمالي الالتزام', moneyValue(statement.commitment && statement.commitment.overall, statement.currency)) + '</section>' +
        (statement.cycles || []).map(c => '<section class="mgd-detail-card"><div class="mgd-detail-heading"><b>القرعة ' + esc(c.cycle) + '</b><span>' + Number(c.progress && c.progress.paid || 0) + ' من ' + Number(c.progress && c.progress.total || 0) + ' أقساط</span></div>' +
          (c.rows || []).map(x => '<div class="mgd-simple-row"><span><b>القسط ' + esc(x.no) + '</b><small>' + esc(dateLabel(x.periodStart)) + ' – ' + esc(dateLabel(x.periodEnd)) + '</small></span>' + pill(x.status) + '<b>' + esc(moneyValue(x.total, statement.currency)) + '</b></div>').join('') + '</section>').join('');
      shell('ملف العضو', 'groups', content);
      return;
    }
    if (view === 'cycle') {
      shell('تفاصيل القرعة', 'groups', identity(g, d) + loadingPanel('تفاصيل القرعة'));
      try { content = await cycleDetail(g, d, Number(params.round) || 1); }
      catch (error) { content = backToTab('draws') + '<div class="mgd-empty">تعذر تحميل تفاصيل القرعة</div>'; }
      if (isLatest()) shell('تفاصيل القرعة', 'groups', identity(g, d) + content);
      return;
    }
    if (view === 'draw') {
      shell('غرفة القرعة', 'groups', identity(g, d) + loadingPanel('غرفة القرعة'));
      try { content = await drawPanel(g, d); }
      catch (error) { content = '<div class="mgd-empty">تعذر تحميل غرفة القرعة. تحقق من الاتصال والصلاحيات ثم أعد المحاولة.</div>'; }
      if (isLatest()) {
        shell('غرفة القرعة', 'groups', identity(g, d) + content);
        const activeDrawTab = document.querySelector('.mgd-draw-nav [aria-selected="true"]');
        if (activeDrawTab && typeof activeDrawTab.scrollIntoView === 'function') activeDrawTab.scrollIntoView({block:'nearest',inline:'nearest'});
        const wheel = document.querySelector('.mgd-wheel-wrap .draw-wheel');
        if (wheel && wheel.dataset.finalRotation && wheel.style.transition !== 'none') requestAnimationFrame(() => {
          wheel.style.transform = 'rotate(' + Number(wheel.dataset.finalRotation) + 'deg)';
        });
      }
      return;
    }
    memberDashboard(g, d);
  }

  function redraw() {
    const g = currentGroup(), d = g && SahmApp.groupDetail(g.id);
    if (!g || !d || !d.ok) return;
    render(g, d);
  }
  document.addEventListener('click', event => {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (['managed-installment-filter','managed-installment-select-visible','managed-installment-cancel-selection','managed-installment-bulk-reminder'].includes(action)) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (['record-paid','send-reminder','schedule-draw','run-draw','draw-presentation-completed','draw-presentation-failed','notify-channel-toggle','approve-join-request-confirm'].includes(action)) invalidateReads();
    if (!['managed-home-slide','managed-home-section','managed-tab','managed-open-member','managed-open-cycle','managed-back','managed-draw-view','managed-settings-view','managed-inline-filter-toggle','managed-section-home'].includes(action)) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (action === 'managed-inline-filter-toggle') {
      const toolbar=el.closest('.mgd-filterbar');
      const stateKey=el.dataset.filterState;
      if(!toolbar||!['memberFiltersOpen','drawFiltersOpen'].includes(stateKey))return;
      state[stateKey]=!state[stateKey];
      const open=state[stateKey];
      toolbar.classList.toggle('filters-open',open);
      el.setAttribute('aria-expanded',open?'true':'false');
      el.title=open?'إخفاء الفلترة':'إظهار الفلترة';
      return;
    }
    if (action === 'managed-home-section') {
      const section = el.dataset.section || '';
      if (isManager()) {
        if (!MANAGER_SECTION_TITLES[section]) return;
        params = { managedSection: section };
        if (section === 'room') params.managedDrawView = 'summary';
        groupDetailTab = 'overview';
      } else {
        const memberSections = ['installments','shares','draws','communication'];
        if (!memberSections.includes(section)) return;
        params = {};
        groupDetailTab = section;
      }
      syncNavigationContext();
      redraw();
      return;
    }
    if (action === 'managed-section-home') {
      params = {};
      groupDetailTab = 'overview';
      syncNavigationContext();
      redraw();
      return;
    }
    if (action === 'managed-tab') {
      const allowed = ['installments','shares','draws','members','settings','news','chat','audit','overview','communication'];
      groupDetailTab = allowed.includes(el.dataset.tab) ? el.dataset.tab : (isManager()?'members':'overview');
      params = {};
      syncNavigationContext();
      redraw();
      return;
    }
    if (action === 'managed-open-member' || action === 'managed-open-cycle') {
      if (!isManager()) {
        if (action === 'managed-open-member') {
          go('group-detail', { managedView: 'member', memberId: el.dataset.memberId }, { currentGroupId: currentGroupId, groupDetailTab: 'members' });
        } else {
          go('group-detail', { managedView: 'cycle', round: el.dataset.round }, { currentGroupId: currentGroupId, groupDetailTab: 'draws' });
        }
      }
      return;
    }
    if (action === 'managed-back') {
      const tab = el.dataset.tab || '';
      if (isManager()) {
        params = { managedSection: ['draws','members','installments','shares','settings','chat','audit','news'].includes(tab) ? tab : 'draws' };
        groupDetailTab = 'overview';
      } else {
        const allowed = ['installments','shares','draws','members','settings','news','chat','audit','overview','communication'];
        groupDetailTab = allowed.includes(tab) ? tab : 'overview';
        params = {};
      }
      syncNavigationContext();
      redraw();
      return;
    }
    if (action === 'managed-draw-view') {
      const manager = isManager();
      const allowedViews = manager ? ['summary','eligible','schedule','result','history'] : ['summary','eligible','result','history'];
      const requested = el.dataset.view || 'summary';
      if (!allowedViews.includes(requested)) { toast('هذا القسم متاح لمدير الجمعية فقط'); return; }
      if (manager) return;
      else {
        groupDetailTab = 'draws';
        params = { managedView: 'draw', managedDrawView: requested };
      }
      syncNavigationContext();
      redraw();
      return;
    }
    if (action === 'managed-settings-view') {
      if (isManager()) return;
      const next = ['news','chat','audit'].includes(el.dataset.view) ? el.dataset.view : 'settings';
      groupDetailTab = next; params = {}; syncNavigationContext(); redraw();
    }
  });
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!form || form.id !== 'mgdChatForm') return;
    event.preventDefault();
    const input = form.querySelector('[name="text"]');
    const message = String(input && input.value || '').trim();
    if (!message || message.length > SahmApp.maxMessage()) { toast('تحقق من نص الرسالة وطولها'); return; }
    const button = form.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; button.textContent = 'جارٍ الإرسال...'; }
    try {
      const result = await SahmApp.sendMessage(currentGroupId, message);
      if (result && result.ok) { invalidateReads(); refreshData(); redraw(); toast('تم إرسال الرسالة'); }
      else { toast(result && result.message || 'تعذر إرسال الرسالة'); if (button) { button.disabled = false; button.textContent = 'إرسال'; } }
    } catch (error) { toast(error && error.message || 'تعذر إرسال الرسالة'); if (button) { button.disabled = false; button.textContent = 'إرسال'; } }
  });
  root.SahmManagedGroup = { render, redraw };
})(window);
