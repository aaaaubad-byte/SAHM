/* SAHM managed-group detail workspace.
   Isolated presentation layer: it consumes existing read models and existing action handlers.
   No database, Supabase, engine, or shared-screen behavior is changed here. */
(function (root) {
  'use strict';
  const state = { cycle: null, installment: 'all', status: 'all', query: '', drawView: 'summary' };
  const readCache = new Map();
  let renderVersion = 0;
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
    shell('تفاصيل الجمعية', 'groups', identity(g, d) + tabs(active) + '<main class="mgd-content">' + content + '</main>');
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
    const p = progress(d);
    return '<section class="mgd-identity">' +
      '<div class="mgd-identity-top"><strong>' + esc(g.name) + '</strong><span class="mgd-role">' + esc(currentRole(g)) + '</span></div>' +
      '<div class="mgd-identity-metrics">' +
      '<span title="قيمة السهم">' + uiIcon('wallet',16) + '<b>' + esc(money(g.share,g.currency)) + '</b></span>' +
      '<span title="عدد الأعضاء">' + uiIcon('users',16) + '<b>' + esc(d.members||0) + '</b></span>' +
      '<span title="إجمالي القرعات">' + uiIcon('shuffle',16) + '<b>' + p.total + '</b></span></div>' +
      '<div class="mgd-progress-head"><span>إنجاز القرعات</span><b>' + p.pct + '%</b></div>' +
      '<div class="mgd-progress"><i style="width:' + p.pct + '%"></i></div><small class="mgd-progress-caption">' + p.done + ' من ' + p.total + ' قرعة مكتملة</small></section>';
  }
  function tabs(active) {
    const items = [
      ['installments','receipt','الأقساط'], ['shares','layers','الأسهم'],
      ['draws','shuffle','القرعات'], ['members','users','الأعضاء'],
      ['settings','settings','الإعدادات']
    ];
    const selected = ['news','chat','audit'].includes(active) ? 'settings' : active;
    return '<nav class="mgd-tabs" aria-label="أقسام الجمعية" role="tablist">' + items.map(([id, icon, label]) =>
      '<button type="button" role="tab" aria-selected="' + (selected === id ? 'true' : 'false') + '" class="' + (selected === id ? 'active' : '') + '" data-action="managed-tab" data-tab="' + id + '">' +
      uiIcon(icon, 17) + '<span>' + label + '</span></button>').join('') + '</nav>';
  }
  function backToTab(tab) {
    const label = tab === 'draws' ? 'القرعات' : tab === 'settings' ? 'الإعدادات' : tab === 'installments' ? 'الأقساط' : 'الأعضاء';
    return '<button type="button" class="mgd-back" data-action="managed-back" data-tab="' + (tab || 'members') + '">' + uiIcon('back-screen',18) + '<span>العودة إلى ' + label + '</span></button>';
  }
  async function shareCards(g) {
    const result = await SahmApp.shareList(g.id, {status: state.shareStatus || 'eligible'});
    const list = result && result.ok ? result.shares || [] : [];
    const target = document.getElementById('mgdShareList');
    if (!target) return '';
    target.innerHTML = list.map(s => '<article class="mgd-installment-card"><div class="mgd-installment-top"><b>السهم ' + esc(s.shareNo) + '</b>' + '<span class="mgd-share-state ' + (s.status === 'won' ? 'won' : 'eligible') + '">' + (s.status === 'won' ? 'فائز' : 'مؤهل') + '</span>' + '</div><div class="mgd-installment-member">' + esc(s.ownerName) + '</div><div class="mgd-installment-meta"><span>' + (s.status === 'won' ? 'فائز بالقرعة رقم ' + esc(s.winnerRound) : 'مؤهل للقرعات المتبقية') + '</span></div></article>').join('') || '<div class="mgd-empty">لا توجد أسهم بهذه الحالة</div>';
    return target.innerHTML;
  }
  function bindDrawFilters() {
    const search=document.getElementById('mgdDrawSearch'), status=document.getElementById('mgdDrawStatus'), list=document.getElementById('mgdDrawList');
    if(!list)return;
    const apply=()=>{const q=search?search.value.trim():'';const st=status?status.value:'all';list.querySelectorAll('.mgd-cycle-card').forEach(card=>{card.hidden=(q&&!card.dataset.round.includes(q))||(st!=='all'&&card.dataset.status!==st);});};
    if(search)search.addEventListener('input',apply);if(status)status.addEventListener('change',apply);apply();
  }
  function memberCards(g) {
    const result = SahmApp.memberList(g.id);
    if (!result || !result.ok) return '<div class="mgd-empty">تعذر تحميل قائمة الأعضاء</div>';
    const list = result.members || [];
    const rows = list.map(m =>
      '<button type="button" class="mgd-member-card" data-action="managed-open-member" data-member-id="' + esc(m.memberId) + '" data-member-status="' + (m.memberStatus==='won'?'won':'eligible') + '">' +
      '<span class="mgd-avatar">' + esc((m.name || '؟').slice(0, 1)) + '</span><span class="mgd-member-main"><b>' + esc(m.name) + '</b>' +
      '<small>' + (m.isManager ? 'مدير وعضو' : 'عضو') + (m.isMe ? ' · حسابك' : '') + '</small></span>' +
      '<span class="mgd-member-shares"><b>' + Number(m.shares || 0) + '</b><small>أسهم</small><small>' + Number(m.wonShares||0) + ' فاز · ' + Number(m.eligibleShares==null?m.shares:m.eligibleShares) + ' مؤهل</small><small class="mgd-member-state">' + (m.memberStatus==='won'?'فائز بكل أسهمه':'مؤهل') + '</small></span>' + uiIcon('back-screen', 18) + '</button>'
    ).join('');
    return '<div class="mgd-list-head"><b>الأعضاء</b><span>' + list.length + ' عضو</span></div>' +
      '<div class="mgd-filterbar mgd-member-filters"><label class="mgd-search">' + uiIcon('search',18) + '<input id="mgdMemberSearch" type="search" placeholder="اسم العضو" autocomplete="off"></label>' +
      '<label class="mgd-select"><select id="mgdMemberStatus" aria-label="حالة العضو"><option value="all">كل الحالات</option><option value="eligible">مؤهل</option><option value="won">فائز بكل أسهمه</option></select></label>' +
      '<button type="button" class="mgd-reminder-icon" data-go="invite" title="إضافة عضو">' + uiIcon('user-plus',17) + '</button></div>' +
      '<div class="mgd-list" id="mgdMemberList">' + (rows || '<div class="mgd-empty">لا يوجد أعضاء مسجلون</div>') + '</div>' +
      '<div class="mgd-member-tools"><button type="button" data-go="member-reception">إدارة استقبال الأعضاء</button></div>';
  }
  function bindMemberSearch() {
    const input=document.getElementById('mgdMemberSearch'),status=document.getElementById('mgdMemberStatus'),list=document.getElementById('mgdMemberList');
    if(!list)return;
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
      const status=draw?'completed':n===current?(ready?'ready':pct===100?'collecting':'collecting'):'upcoming';
      const label=draw?'نتيجة مثبتة':n===current?(ready?'جاهزة لإجراء القرعة':pct===100?'اكتمل التحصيل':'جارٍ تحصيل الأقساط'):'قرعة قادمة';
      const winner=draw?(draw.winner_owner_name||draw.winnerLabel||'—'):'';
      return '<button type="button" class="mgd-cycle-card" data-action="managed-open-cycle" data-round="'+n+'" data-status="'+status+'">'+
        '<span class="mgd-cycle-number">'+n+'</span><span class="mgd-cycle-main"><b>القرعة '+n+'</b><small>'+esc(winner||label)+'</small>'+
        '<span class="mgd-cycle-progress"><i style="width:'+pct+'%"></i></span><small>'+pct+'% اكتمال الأقساط</small></span>'+
        '<span class="mgd-cycle-state">'+esc(label)+'</span>'+uiIcon('back-screen',18)+'</button>';
    }).join('');
    return '<div class="mgd-list-head"><b>القرعات</b><span>'+total+' قرعة</span></div>'+
      '<div class="mgd-filterbar mgd-draw-filters"><label class="mgd-search">'+uiIcon('search',16)+'<input id="mgdDrawSearch" type="search" placeholder="رقم القرعة" inputmode="numeric"></label>'+
      '<label class="mgd-select"><select id="mgdDrawStatus" aria-label="حالة القرعة"><option value="all">كل الحالات</option><option value="completed">مكتملة</option><option value="collecting">قيد التحصيل</option><option value="ready">جاهزة</option><option value="upcoming">قادمة</option></select></label></div>'+
      '<button type="button" class="mgd-action primary mgd-room-entry" data-action="managed-draw-view" data-view="summary">'+uiIcon('shuffle',17)+' دخول غرفة القرعة</button>'+
      '<div class="mgd-list" id="mgdDrawList">'+(cards||'<div class="mgd-empty">لا توجد قرعات لعرضها</div>')+'</div>';
  }
  function installmentRows(g, d, opts) {
    opts = opts || {};
    const cycle = Number(opts.cycle || state.cycle || d.cycle || 1);
    const result = SahmApp.installmentRows(g.id, {
      cycle, status: opts.status || state.status, installment: opts.installment || (state.installment === 'all' ? null : Number(state.installment)),
      query: opts.query == null ? state.query : opts.query
    });
    if (!result || !result.ok) return '<div class="mgd-empty">' + esc(result && result.message || 'تعذر تحميل الأقساط') + '</div>';
    const rows = result.rows || [];
    return rows.map(x => {
      const attrs = 'data-member="' + esc(x.memberId) + '" data-cycle="' + esc(x.cycle) + '" data-no="' + esc(x.no) + '"';
      const actions = (x.status === 'due' || x.status === 'late' || x.status === 'upcoming')
        ? '<div class="mgd-row-actions">' + actionButton('تسجيل السداد', 'record-paid', attrs, 'primary') +
          actionButton('تذكير', 'send-reminder', attrs, '') + '</div>' : '';
      return '<article class="mgd-installment-card"><div class="mgd-installment-top"><b>القسط ' + x.no + ' من ' + x.of + '</b>' + pill(x.status) + '</div>' +
        '<div class="mgd-installment-member">' + esc(x.memberName) + '</div><div class="mgd-installment-meta">' +
        '<span>' + esc(dateLabel(x.periodStart)) + ' – ' + esc(dateLabel(x.periodEnd)) + '</span><b>' + esc(moneyValue(x.total, g.currency)) + '</b></div>' + actions + '</article>';
    }).join('') || '<div class="mgd-empty">لا توجد أقساط مطابقة للبحث والفلترة</div>';
  }
  function bindInstallmentFilters(g, d) {
    const search = document.getElementById('mgdInstallmentSearch'), status = document.getElementById('mgdInstallmentStatus');
    const cycle = document.getElementById('mgdInstallmentCycle'), number = document.getElementById('mgdInstallmentNumber');
    const list = document.getElementById('mgdInstallmentList');
    const update = () => {
      state.query = search ? search.value.trim() : '';
      state.status = status ? status.value : 'all';
      state.cycle = cycle ? Number(cycle.value) : 1;
      state.installment = number ? number.value : 'all';
      selectedInstallmentCycle = state.cycle;
      if (list) list.innerHTML = installmentRows(g, d);
      const summary=document.querySelector('.mgd-installment-summary');
      if(summary){const all=(SahmApp.installmentRows(g.id,{cycle:state.cycle,status:'all'})||{}).rows||[];const selected=state.installment==='all'?all:all.filter(x=>Number(x.no)===Number(state.installment));const paid=selected.filter(x=>x.status==='paid').length;const late=selected.filter(x=>x.status==='late').length;const pending=selected.filter(x=>x.status==='due'||x.status==='upcoming').length;summary.querySelector('.mgd-summary-stats').innerHTML='<span>الإجمالي <b>'+selected.length+'</b></span><span>مكتملة <b>'+paid+'</b></span><span>معلقة <b>'+pending+'</b></span><span>متأخرة <b>'+late+'</b></span>';}
    };
    [search, status, cycle, number].forEach(el => el && el.addEventListener(el === search ? 'input' : 'change', update));
    update();
  }
  function installmentsPanel(g, d) {
    const totalCycles=Math.max(1,Number(d.rounds)||1), cycle=Math.min(totalCycles,Math.max(1,Number(state.cycle||d.cycle||1)));
    const snapshot=SahmApp.installmentRows(g.id,{cycle:cycle,status:'all'})||{};
    const allRows=snapshot.ok?snapshot.rows||[]:[];
    const today=SahmApp.todayIn(g.tz||'Asia/Aden');
    const inRange=allRows.find(x=>String(today)>=String(x.periodStart)&&String(today)<=String(x.periodEnd));
    if(state.installment==='all')state.installment=inRange?String(inRange.no):'all';
    const chosen=state.installment==='all'?null:Number(state.installment);
    const shown=chosen?allRows.filter(x=>Number(x.no)===chosen):allRows;
    const paid=shown.filter(x=>x.status==='paid').length, late=shown.filter(x=>x.status==='late').length;
    const pending=shown.filter(x=>x.status==='due'||x.status==='upcoming').length;
    const first=shown[0]||{};
    const cycleOptions=Array.from({length:totalCycles},(_,i)=>'<option value="'+(i+1)+'" '+(cycle===i+1?'selected':'')+'>القرعة '+(i+1)+'</option>').join('');
    const installmentOptions=Array.from({length:Math.max(1,Number(g.installments)||1)},(_,i)=>'<option value="'+(i+1)+'" '+(String(state.installment)===String(i+1)?'selected':'')+'>القسط '+(i+1)+'</option>').join('');
    return '<section class="mgd-installment-summary"><div class="mgd-summary-top"><b>القرعة '+cycle+'</b><span>'+esc(first.periodStart?dateLabel(first.periodStart):'—')+' – '+esc(first.periodEnd?dateLabel(first.periodEnd):'—')+'</span></div>'+
      '<div class="mgd-summary-stats"><span>الإجمالي <b>'+shown.length+'</b></span><span>مكتملة <b>'+paid+'</b></span><span>معلقة <b>'+pending+'</b></span><span>متأخرة <b>'+late+'</b></span></div></section>'+
      '<div class="mgd-filterbar mgd-installment-filters"><label class="mgd-select"><select id="mgdInstallmentCycle" aria-label="رقم القرعة">'+cycleOptions+'</select></label>'+
      '<label class="mgd-select"><select id="mgdInstallmentNumber" aria-label="رقم القسط"><option value="all">كل الأقساط</option>'+installmentOptions+'</select></label>'+
      '<label class="mgd-select"><select id="mgdInstallmentStatus" aria-label="حالة القسط"><option value="all">كل الحالات</option><option value="due">مستحق</option><option value="paid">مدفوع</option><option value="late">متأخر</option><option value="upcoming">لم يحن موعده</option></select></label>'+
      '<button type="button" class="mgd-reminder-icon" data-action="send-reminder-all" title="تذكير جماعي">'+uiIcon('bell',17)+'</button></div>'+
      '<label class="mgd-search mgd-installment-search">'+uiIcon('search',17)+'<input id="mgdInstallmentSearch" type="search" placeholder="ابحث باسم العضو" autocomplete="off"></label>'+
      '<div id="mgdInstallmentList" class="mgd-installment-list"></div>'+
      '<button type="button" class="mgd-secondary-link" data-go="receipts">سجل الاستلام والتصحيحات '+uiIcon('back-screen',16)+'</button>';
  }
  async function cycleDetail(g, d, round) {
    const historyResult = await cachedRead('history:' + g.id, () => SahmApp.getDrawHistory(g.id), 15000), history = historyResult && historyResult.ok ? (historyResult.history || []) : [];
    const draw = history.find(x => Number(x.round_no || x.round) === round);
    const rows = SahmApp.installmentRows(g.id, { cycle: round, status: 'all' });
    const obligations = rows && rows.ok ? rows.rows || [] : [];
    return backToTab('draws') + '<div class="mgd-detail-heading"><b>القرعة ' + round + '</b>' + (draw ? '<span class="mgd-role">نتيجة مثبتة</span>' : '<span class="mgd-role">تفاصيل القرعة</span>') + '</div>' +
      (draw ? '<section class="mgd-detail-card">' + row('trophy', 'الفائز', draw.winner_owner_name || draw.winnerLabel || '—') +
        row('hash', 'رقم السهم', draw.winner_share_no || draw.winnerShareId || '—') +
        row('calendar-days', 'تاريخ القرعة', dateLabel(draw.scheduled_on || draw.date)) +
        row('coins', 'الجائزة المستهدفة', moneyValue(draw.prize_target_minor || draw.prize || 0, draw.currency || g.currency)) +
        row('monitor', 'حالة العرض', draw.presentation_status || '—') + '</section>' : '') +
      '<div class="mgd-list-head"><b>أقساط القرعة</b><span>' + obligations.length + ' سجل</span></div>' +
      '<div class="mgd-list">' + (obligations.map(x => '<div class="mgd-simple-row"><span><b>' + esc(x.memberName) + '</b><small>القسط ' + x.no + '</small></span>' + pill(x.status) + '</div>').join('') || '<div class="mgd-empty">لا توجد بيانات أقساط لهذه القرعة</div>') + '</div>';
  }
  async function drawPanel(g, d) {
    const view = params.managedDrawView || 'summary';
    const roomPromise = cachedRead('draw-room:' + g.id, () => SahmApp.getDrawRoom(g.id), 7000);
    const readinessPromise = (view === 'summary' || view === 'result')
      ? cachedRead('draw-ready:' + g.id, () => SahmApp.getDrawReadiness(g.id), 7000) : null;
    const financialPromise = view === 'summary'
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
    const nav = '<nav class="mgd-draw-nav">' + [['summary','ملخص القرعة'],['eligible','الأسهم المؤهلة'],['schedule','موعد القرعة'],['result','النتيجة'],['history','السجل']].map(([id,label]) =>
      '<button type="button" class="' + (view === id ? 'active' : '') + '" data-action="managed-draw-view" data-view="' + id + '">' + label + '</button>').join('') + '</nav>';
    let body = '';
    if (view === 'summary') {
      const totals = financial && financial.totals || {}, shares = financial && financial.shares || {};
      body = '<section class="mgd-detail-card"><div class="mgd-detail-heading"><b>القرعة ' + esc(room.round_no || '—') + ' من ' + esc(room.rounds_total || d.rounds || '—') + '</b><span class="mgd-role">' + esc(states[room.state] || room.state || '—') + '</span></div>' +
        row('calendar-days', 'تاريخ الاستحقاق', dateLabel(cycle.due_on)) +
        row('clock', 'موعد القرعة', cycle.draw_scheduled_at ? SahmCore.fmtDateTime(cycle.draw_scheduled_at, 'Asia/Aden') : 'غير محدد') +
        row('users', 'الأسهم المؤهلة', eligible.length) +
        row('shield-check', 'الجاهزية', readiness.canDraw ? 'جاهزة للتنفيذ' : 'غير جاهزة') +
        (draw ? row('trophy', 'الفائز', draw.winner_owner_name || '—') : '') + '</section>' +
        (readiness.reasons && readiness.reasons.length ? '<section class="mgd-detail-card"><b>متطلبات الجاهزية</b>' + readiness.reasons.map(x => '<div class="mgd-reason">' + esc(reasons[x] || x) + '</div>').join('') + '</section>' : '') +
        (financial ? '<section class="mgd-detail-card"><b>ملخص مالي</b>' + row('wallet', 'الالتزامات', moneyValue(totals.due_minor || 0, g.currency)) +
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
      body = '<section class="mgd-detail-card"><div class="mgd-detail-heading"><b>تنفيذ نتيجة القرعة</b>' + pill(room.state || 'pending') + '</div>' +
        (draw ? '<div class="mgd-winner"><span>' + uiIcon('trophy', 25) + '</span><b>' + esc(draw.winner_owner_name || 'الفائز') + '</b><small>السهم ' + esc(draw.winner_share_no || '—') + '</small></div>' :
          '<div class="mgd-empty">لم تُثبت نتيجة القرعة بعد</div>') +
        (draw ? '<div class="mgd-actions">' + actionButton('تسجيل اكتمال العرض', 'draw-presentation-completed', '', 'primary') + actionButton('تسجيل تعذر العرض', 'draw-presentation-failed', '', '') + '</div>' :
          actionButton('تنفيذ القرعة وتثبيت النتيجة', 'run-draw', readiness.canDraw ? '' : 'disabled', 'primary') ) + '</section>';
    } else {
      body = '<div class="mgd-list-head"><b>سجل القرعات</b><span>' + history.length + ' نتيجة</span></div><div class="mgd-list">' +
        (history.map(x => '<div class="mgd-simple-row"><span class="mgd-cycle-number">' + esc(x.round_no || x.round) + '</span><span class="mgd-member-main"><b>القرعة ' + esc(x.round_no || x.round) + ' · ' + esc(x.winner_owner_name || x.winnerLabel || '—') + '</b><small>' + esc(dateLabel(x.scheduled_on || x.date)) + '</small></span><span class="mgd-status-ok">مثبتة</span></div>').join('') || '<div class="mgd-empty">لا توجد نتائج مثبتة بعد</div>') + '</div>';
    }
    return nav + body;
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
    const channel = (key, label, map) => '<section class="mgd-detail-card"><b>' + label + '</b>' +
      SahmApp.notifyTypes().map(t => '<label class="mgd-toggle-row"><span>' + esc(t.label) + '</span><input type="checkbox" data-action="notify-channel-toggle" data-channel="' + key + '" data-type="' + esc(t.id) + '" ' + (map && map[t.id] ? 'checked' : '') + '></label>').join('') + '</section>';
    return '<div class="mgd-list-head"><b>أخبار الجمعية</b><span>' + (result.news || []).length + ' خبر</span></div>' +
      '<div class="mgd-feed-list">' + (rows || '<div class="mgd-empty">لا توجد أخبار منشورة</div>') + '</div>' +
      '<div class="mgd-list-head mgd-settings-heading"><b>إعدادات النشر</b><span>تحكم بما يظهر في الأخبار والمحادثة</span></div>' +
      channel('feed', 'النشر في أخبار الجمعية', d.group && d.group.notify) +
      channel('chat', 'النشر في محادثة الجمعية', d.group && d.group.notifyChat) +
      channel('names', 'إظهار أسماء الأعضاء في الأخبار', d.group && d.group.notifyNames);
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
  async function render(g, d) {
    const version = ++renderVersion;
    const isLatest = () => version === renderVersion;
    const view = params.managedView || '';
    if (state.groupId !== g.id) { state.groupId=g.id; state.cycle=null; state.installment='all'; state.status='all'; state.query=''; state.shareStatus='eligible'; state.memberStatus='all'; }
    const active = ['installments','shares','draws','members','settings','news','chat','audit'].includes(groupDetailTab) ? groupDetailTab : 'members';
    let content = '';

    if (view === 'member') {
      const memberId = String(params.memberId || '');
      const statement = SahmApp.memberStatement(g.id, memberId);
      const member = (SahmApp.memberList(g.id).members || []).find(x => String(x.memberId) === memberId);
      if (!statement || !statement.ok) content = backToTab('members') + '<div class="mgd-empty">' + esc(statement && statement.message || 'تعذر تحميل ملف العضو') + '</div>';
      else content = backToTab('members') + '<div class="mgd-detail-heading"><b>' + esc(statement.memberName) + '</b><span class="mgd-role">' + (member && member.isManager ? 'مدير الجمعية' : 'عضو') + '</span></div>' +
        '<section class="mgd-detail-card">' + row('users', 'عدد الأسهم', statement.shares) + row('wallet', 'إجمالي الالتزام', moneyValue(statement.commitment && statement.commitment.overall, statement.currency)) + '</section>' +
        (statement.cycles || []).map(c => '<section class="mgd-detail-card"><div class="mgd-detail-heading"><b>القرعة ' + c.cycle + '</b><span>' + (c.progress.paid || 0) + ' من ' + (c.progress.total || 0) + ' أقساط</span></div>' +
          (c.rows || []).map(x => '<div class="mgd-simple-row"><span><b>القسط ' + x.no + '</b><small>' + esc(dateLabel(x.periodStart)) + ' – ' + esc(dateLabel(x.periodEnd)) + '</small></span>' + pill(x.status) + '<b>' + esc(moneyValue(x.total, statement.currency)) + '</b></div>').join('') + '</section>').join('');
      shell('ملف العضو', 'groups', identity(g, d) + content);
      return;
    }
    if (view === 'cycle') {
      shell('تفاصيل القرعة', 'groups', identity(g, d) + loadingPanel('تفاصيل القرعة'));
      try { content = await cycleDetail(g, d, Number(params.round) || 1); }
      catch (error) { content = backToTab('draws') + '<div class="mgd-empty">تعذر تحميل تفاصيل القرعة</div>'; }
      if (isLatest()) shell('تفاصيل القرعة', 'groups', identity(g, d) + content);
      return;
    }
    if (view) {
      shell('غرفة القرعة', 'groups', identity(g, d) + backToTab('draws') + loadingPanel('غرفة القرعة'));
      try { content = await drawPanel(g, d); }
      catch (error) { content = '<div class="mgd-empty">تعذر تحميل غرفة القرعة</div>'; }
      if (isLatest()) shell('غرفة القرعة', 'groups', identity(g, d) + backToTab('draws') + content);
      return;
    }

    let deferred = null;
    if (active === 'members') {
      content = memberCards(g) +
        '<section class="mgd-detail-card mgd-group-extra"><div class="mgd-list-head"><b>إدارة الجمعية</b><span>' + ((db.joinRequests || []).filter(x => x.groupId === g.id && x.status === 'pending').length) + ' طلبات معلقة</span></div>' +
        '<div class="mgd-member-tools"><button type="button" data-go="member-reception">استقبال الأعضاء</button><button type="button" data-go="invite">دعوة عضو</button></div></section>';
    } else if (active === 'draws') {
      const counts = d.counts || {};
      content = '<section class="mgd-detail-card mgd-group-facts">' +
        row('calendar-days', 'تاريخ البداية', dateLabel(g.start)) +
        row('calendar-days', 'أول قرعة محسوبة', dateLabel(g.first)) +
        row('wallet', 'حصة السهم في القرعة', money(g.share, g.currency)) +
        row('receipt', 'الأقساط داخل القرعة', g.installments) +
        row('trophy', 'جائزة القرعة المستهدفة', moneyValue(d.plan && d.plan.prizeTarget || 0, g.currency)) +
        row('check-circle', 'الأقساط المدفوعة', counts.paid || 0) +
        row('alert', 'الأقساط المتأخرة', counts.late || 0) + '</section>' + loadingPanel('القرعات');
      deferred = () => cycleCards(g, d);
    } else if (active === 'shares') {
      content = '<div class="mgd-list-head"><b>الأسهم</b><span>حالة كل سهم</span></div><div class="mgd-filterbar"><label class="mgd-select"><select id="mgdShareStatus" aria-label="حالة السهم"><option value="eligible">مؤهل</option><option value="won">فائز</option><option value="all">الكل</option></select></label></div><div id="mgdShareList" class="mgd-list">'+loadingPanel('الأسهم')+'</div>';
      deferred = () => shareCards(g);
    } else if (active === 'installments') {
      content = installmentsPanel(g, d);
    } else if (active === 'settings') {
      content = '<div class="mgd-list-head"><b>إعدادات الجمعية</b></div><div class="mgd-settings-grid">' +
        '<button type="button" data-action="managed-settings-view" data-view="news">' + uiIcon('wall',18) + '<span>الأخبار والنشر</span></button>' +
        '<button type="button" data-action="managed-settings-view" data-view="chat">' + uiIcon('messages',18) + '<span>محادثة الجمعية</span></button>' +
        '<button type="button" data-action="managed-settings-view" data-view="audit">' + uiIcon('clipboard-list',18) + '<span>سجل العمليات</span></button>' +
        '<button type="button" data-go="invite">' + uiIcon('link',18) + '<span>رابط الدعوة</span></button></div>';
    } else if (active === 'news') {
      content = loadingPanel('أخبار الجمعية');
      deferred = () => newsPanel(g, d);
    } else if (active === 'chat') {
      content = chatPanel(g);
    } else if (active === 'audit') {
      content = loadingPanel('سجل العمليات');
      deferred = () => auditPanel(g);
    }

    commitRender(g, d, active, content);
    if (deferred) {
      try { content = await deferred(); }
      catch (error) { content = '<div class="mgd-empty">تعذر تحميل البيانات. حاول مرة أخرى.</div>'; }
      if (isLatest()) commitRender(g, d, active, content);
    }
  }
  function redraw() {
    const g = currentGroup(), d = g && SahmApp.groupDetail(g.id);
    if (!g || !d || !d.ok || !d.role.manager) return;
    render(g, d);
  }
  document.addEventListener('click', event => {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (['record-paid','send-reminder','send-reminder-all','schedule-draw','run-draw','draw-presentation-completed','draw-presentation-failed','notify-channel-toggle'].includes(action)) invalidateReads();
    if (!['managed-tab','managed-open-member','managed-open-cycle','managed-back','managed-draw-view','managed-settings-view'].includes(action)) return;
    event.preventDefault();
    event.stopPropagation();

    if (action === 'managed-tab') {
      const allowed = ['installments','shares','draws','members','settings','news','chat','audit'];
      groupDetailTab = allowed.includes(el.dataset.tab) ? el.dataset.tab : 'members';
      params = {};
      syncNavigationContext();
      redraw();
      return;
    }
    if (action === 'managed-open-member') {
      go('group-detail', { managedView: 'member', memberId: el.dataset.memberId }, {
        currentGroupId: currentGroupId, groupDetailTab: 'members'
      });
      return;
    }
    if (action === 'managed-open-cycle') {
      go('group-detail', { managedView: 'cycle', round: el.dataset.round }, {
        currentGroupId: currentGroupId, groupDetailTab: 'draws'
      });
      return;
    }
    if (action === 'managed-back') {
      const allowed = ['installments','shares','draws','members','settings','news','chat','audit'];
      groupDetailTab = allowed.includes(el.dataset.tab) ? el.dataset.tab : 'members';
      params = {};
      syncNavigationContext();
      redraw();
      return;
    }
    if (action === 'managed-draw-view') {
      groupDetailTab = 'draws'; params = { managedView: 'draw', managedDrawView: el.dataset.view || 'summary' }; syncNavigationContext(); redraw(); return;
    }
    if (action === 'managed-settings-view') {
      groupDetailTab = ['news','chat','audit'].includes(el.dataset.view) ? el.dataset.view : 'settings'; params = {}; syncNavigationContext(); redraw();
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
