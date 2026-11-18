/* SAHM managed-group detail workspace.
   Isolated presentation layer: it consumes existing read models and existing action handlers.
   No database, Supabase, engine, or shared-screen behavior is changed here. */
(function (root) {
  'use strict';
  const state = { cycle: null, installment: 'all', status: 'all', query: '', drawView: 'summary' };
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
    shell('تفاصيل الجمعية', 'groups', identity(g, d) + tabs(active, !!(d.role&&d.role.manager)) + '<main class="mgd-content">' + content + '</main>');
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
    const managers=[['installments','receipt','الأقساط'],['shares','layers','الأسهم'],['draws','shuffle','القرعات'],['members','users','الأعضاء'],['settings','settings','الإعدادات']];
    const members=[['overview','layout-dashboard','ملخصي'],['installments','receipt','أقساطي'],['shares','layers','أسهمي'],['draws','shuffle','القرعات'],['communication','messages','التواصل']];
    const items=manager?managers:members, selected=['news','chat','audit'].includes(active)?(manager?'settings':'communication'):active;
    return '<nav class="mgd-tabs" aria-label="أقسام الجمعية" role="tablist">'+items.map(([id,icon,label])=>'<button type="button" role="tab" aria-selected="'+(selected===id?'true':'false')+'" class="'+(selected===id?'active':'')+'" data-action="managed-tab" data-tab="'+id+'">'+uiIcon(icon,17)+'<span>'+label+'</span></button>').join('')+'</nav>';
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
      '<small>' + (m.isManager ? ((g.managerParticipates && Number(m.shares||0)>0) ? 'مدير وعضو' : 'مدير الجمعية') : 'عضو') + (m.isMe ? ' · حسابك' : '') + '</small></span>' +
      '<span class="mgd-member-shares"><b>' + Number(m.shares || 0) + '</b><small>أسهم</small><small>' + Number(m.wonShares||0) + ' فاز · ' + Number(m.eligibleShares==null?m.shares:m.eligibleShares) + ' مؤهل</small><small class="mgd-member-state">' + (m.memberStatus==='won'?'فائز بكل أسهمه':'مؤهل') + '</small></span>' + uiIcon('back-screen', 18) + '</button>'
    ).join('');
    return '<div class="mgd-list-head"><b>الأعضاء</b><span>' + list.length + ' عضو</span></div>' +
      '<div class="mgd-filterbar mgd-member-filters"><label class="mgd-search">' + uiIcon('search',18) + '<input id="mgdMemberSearch" type="search" placeholder="اسم العضو" autocomplete="off"></label>' +
      '<label class="mgd-select"><select id="mgdMemberStatus" aria-label="حالة العضو"><option value="all">كل الحالات</option><option value="eligible">مؤهل</option><option value="won">فائز بكل أسهمه</option></select></label>' +
      '<button type="button" class="mgd-reminder-icon" data-go="invite" title="دعوة عضو">' + uiIcon('user-plus',17) + '</button></div>' +
      '<div class="mgd-list" id="mgdMemberList">' + (rows || '<div class="mgd-empty">لا يوجد أعضاء مسجلون</div>') + '</div>';
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
      const waiting=!!(readinessResult&&readinessResult.ok&&readinessResult.dateReached&& !readinessResult.timeReached);
      const status=draw?'completed':n===current?(ready?'ready':pct===100?'waiting':'collecting'):'upcoming';
      const label=draw?'نتيجة مثبتة':n===current?(ready?'جاهزة لإجراء القرعة':pct===100?(waiting?'اكتمل التحصيل · بانتظار الموعد':'اكتمل التحصيل · بانتظار الجاهزية'):'جارٍ تحصيل الأقساط'):'قرعة قادمة';
      const winner=draw?(draw.winner_owner_name||draw.winnerLabel||'—'):'';
      return '<button type="button" class="mgd-cycle-card" data-action="managed-open-cycle" data-round="'+n+'" data-status="'+status+'">'+
        '<span class="mgd-cycle-number">'+n+'</span><span class="mgd-cycle-main"><b>القرعة '+n+'</b><small>'+esc(winner||label)+'</small>'+
        '<span class="mgd-cycle-progress"><i style="width:'+pct+'%"></i></span><small>'+pct+'% اكتمال الأقساط</small></span>'+
        '<span class="mgd-cycle-state">'+esc(label)+'</span>'+uiIcon('back-screen',18)+'</button>';
    }).join('');
    return '<div class="mgd-list-head"><b>القرعات</b><span>'+total+' قرعة</span></div>'+
      '<div class="mgd-filterbar mgd-draw-filters"><label class="mgd-search">'+uiIcon('search',16)+'<input id="mgdDrawSearch" type="search" placeholder="رقم القرعة" inputmode="numeric"></label>'+
      '<label class="mgd-select"><select id="mgdDrawStatus" aria-label="حالة القرعة"><option value="all">كل الحالات</option><option value="completed">مكتملة</option><option value="collecting">قيد التحصيل</option><option value="ready">جاهزة</option><option value="waiting">بانتظار الموعد</option><option value="upcoming">قادمة</option></select></label></div>'+
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
    const memberResult=SahmApp.memberList(g.id), memberMap=new Map(((memberResult&&memberResult.ok&&memberResult.members)||[]).map(x=>[String(x.memberId),Number(x.shares||0)]));
    return rows.map(x => {
      const attrs = 'data-member="' + esc(x.memberId) + '" data-cycle="' + esc(x.cycle) + '" data-no="' + esc(x.no) + '"';
      const actions = (x.status === 'due' || x.status === 'late' || x.status === 'upcoming')
        ? '<div class="mgd-row-actions">' + actionButton('تسجيل السداد', 'record-paid', attrs, 'primary') +
          actionButton('تذكير', 'send-reminder', attrs, '') + '</div>' : '';
      return '<article class="mgd-installment-card"><div class="mgd-installment-top"><b>القسط ' + x.no + ' من ' + x.of + '</b>' + pill(x.status) + '</div>' +
        '<div class="mgd-installment-member">' + esc(x.memberName) + '</div><div class="mgd-installment-meta"><span>'+(memberMap.get(String(x.memberId))||0)+' سهم</span>' +
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
  async function drawPanel(g, d) {
    const manager = !!(d.role && d.role.manager);
    if (manager && !view) { managerDashboard(g, d); return; }
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
      '<span class="mgd-home-slide-icon">' + uiIcon(x.icon, 25) + '</span><span class="mgd-home-slide-copy"><b>' + esc(x.title) + '</b><strong>' + esc(x.value) + '</strong><small>' + esc(x.note) + '</small></span>' +
      '<span class="mgd-home-slide-index">0' + (i + 1) + ' / 0' + slides.length + '</span></article>'
    ).join('');
    const dots = slides.map((x, i) => '<button type="button" class="' + (i === 0 ? 'active' : '') + '" data-mgd-slide-to="' + i + '" aria-label="عرض ' + esc(x.title) + '" aria-pressed="' + (i === 0) + '"></button>').join('');
    const cards = sections.map(([id, icon, label]) =>
      '<button type="button" class="mgd-home-section" data-action="managed-home-section" data-section="' + id + '">' +
      '<span class="mgd-home-section-icon">' + uiIcon(icon, 21) + '</span><span>' + label + '</span></button>'
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
  async function render(g, d) {
    const version = ++renderVersion;
    const isLatest = () => version === renderVersion;
    const view = params.managedView || '';
    if (state.groupId !== g.id) { state.groupId=g.id; state.cycle=null; state.installment='all'; state.status='all'; state.query=''; state.shareStatus='eligible'; state.memberStatus='all'; }
    const manager = !!(d.role && d.role.manager);
    const managerTabs = ['installments','shares','draws','members','settings','news','chat','audit'];
    const memberTabs = ['overview','installments','shares','draws','communication','news','chat'];
    const active = (manager ? managerTabs : memberTabs).includes(groupDetailTab) ? groupDetailTab : (manager ? 'members' : 'overview');
    let content = '';
    let deferred = null;
    if (!manager && !view) {
      if (active === 'overview') content = memberOverview(g,d);
      else if (active === 'installments') content = memberInstallments(g);
      else if (active === 'shares') content = memberShares(g);
      else if (active === 'draws') { content = loadingPanel('القرعات'); deferred = () => memberDraws(g); }
      else if (active === 'communication') content = memberCommunication();
      else if (active === 'news') { content = loadingPanel('أخبار الجمعية'); deferred = () => newsPanel(g,d); }
      else if (active === 'chat') content = chatPanel(g);
      commitRender(g,d,active,content);
      if (deferred) { try { content = await deferred(); } catch (error) { content = '<div class="mgd-empty">تعذر تحميل البيانات. حاول مرة أخرى.</div>'; } if (isLatest()) commitRender(g,d,active,content); }
      return;
    }

    if (view === 'information') {
      content = backToTab('members') + '<div class="mgd-list-head"><b>معلومات الجمعية</b></div>' +
        '<section class="mgd-detail-card">' +
        row('calendar', 'بداية الجمعية', dateLabel(g.start || g.startDate)) +
        row('calendar-days', 'أول موعد للقرعة', dateLabel(g.first || g.firstDrawOn)) +
        row('wallet', 'قيمة السهم', money(g.share, g.currency)) +
        row('receipt', 'عدد الأقساط', g.installments || '—') +
        row('clock', 'مدة فترة التحصيل', (g.cycleDays || g.periodDays || '—') + ' يوم') +
        row('trophy', 'الجائزة المستهدفة', moneyValue(d.plan && d.plan.prizeTarget || 0, g.currency)) +
        '</section>';
      shell('معلومات الجمعية', 'groups', identity(g, d) + content);
      return;
    }
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
    if (view === 'draw') {
      shell('غرفة القرعة', 'groups', identity(g, d) + backToTab('draws') + loadingPanel('غرفة القرعة'));
      try { content = await drawPanel(g, d); }
      catch (error) { content = '<div class="mgd-empty">تعذر تحميل غرفة القرعة. تحقق من الاتصال والصلاحيات ثم أعد المحاولة.</div>'; }
      if (isLatest()) {
        shell('غرفة القرعة', 'groups', identity(g, d) + backToTab('draws') + content);
        const activeDrawTab=document.querySelector('.mgd-draw-nav [aria-selected="true"]');
        if(activeDrawTab&&typeof activeDrawTab.scrollIntoView==='function')activeDrawTab.scrollIntoView({block:'nearest',inline:'nearest'});
        const wheel=document.querySelector('.mgd-wheel-wrap .draw-wheel');
        if(wheel&&wheel.dataset.finalRotation&&wheel.style.transition!=='none')requestAnimationFrame(()=>{wheel.style.transform='rotate('+Number(wheel.dataset.finalRotation)+'deg)';});
      }
      return;
    }

    if (active === 'members') {
      content = memberCards(g) +
        '<section class="mgd-detail-card mgd-group-extra"><div class="mgd-list-head"><b>إدارة الجمعية</b><span>' + ((db.joinRequests || []).filter(x => x.groupId === g.id && x.status === 'pending').length) + ' طلبات معلقة</span></div>' +
        '<div class="mgd-member-tools"><button type="button" data-go="member-reception">استقبال الأعضاء</button><button type="button" data-go="invite">دعوة عضو</button></div></section>';
    } else if (active === 'draws') {
      content = loadingPanel('القرعات');
      deferred = () => cycleCards(g, d);
    } else if (active === 'shares') {
      content = '<div class="mgd-list-head"><b>الأسهم</b><span>حالة كل سهم</span></div><div class="mgd-filterbar"><label class="mgd-select"><select id="mgdShareStatus" aria-label="حالة السهم"><option value="eligible">مؤهل</option><option value="won">فائز</option><option value="all">الكل</option></select></label></div><div id="mgdShareList" class="mgd-list">'+loadingPanel('الأسهم')+'</div>';
      deferred = () => shareCards(g);
    } else if (active === 'installments') {
      content = installmentsPanel(g, d);
    } else if (active === 'settings') {
      content = '<div class="mgd-list-head"><b>إدارة الجمعية وإعداداتها</b></div><section class="mgd-detail-card">'+row('calendar','بداية الجمعية',dateLabel(g.start||g.startDate))+row('calendar-days','أول موعد للقرعة',dateLabel(g.first||g.firstDrawOn))+row('wallet','قيمة السهم',money(g.share,g.currency))+row('receipt','عدد الأقساط',g.installments||'—')+row('clock','مدة فترة التحصيل',((g.cycleDays||g.periodDays||'—')+' يوم'))+row('trophy','الجائزة المستهدفة',moneyValue(d.plan&&d.plan.prizeTarget||0,g.currency))+'</section><div class="mgd-settings-grid">' +
        '<button type="button" data-action="managed-settings-view" data-view="news">' + uiIcon('wall',18) + '<span>الأخبار والنشر</span></button>' +
        '<button type="button" data-action="managed-settings-view" data-view="chat">' + uiIcon('messages',18) + '<span>محادثة الجمعية</span></button>' +
        '<button type="button" data-action="managed-settings-view" data-view="audit">' + uiIcon('clipboard-list',18) + '<span>سجل العمليات</span></button></div>' + notificationSettingsPanel(d);
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
    if (!g || !d || !d.ok) return;
    render(g, d);
  }
  document.addEventListener('click', event => {
    const el = event.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (['record-paid','send-reminder','send-reminder-all','schedule-draw','run-draw','draw-presentation-completed','draw-presentation-failed','notify-channel-toggle'].includes(action)) invalidateReads();
    if (!['managed-tab','managed-open-member','managed-open-cycle','managed-back','managed-draw-view','managed-settings-view'].includes(action)) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (action === 'managed-home-section') {
      const section = el.dataset.section || '';
      if (section === 'invites') { go('invites'); return; }
      if (section === 'room') {
        groupDetailTab = 'draws';
        params = { managedView: 'draw', managedDrawView: 'summary' };
      } else if (section === 'information') {
        groupDetailTab = 'members';
        params = { managedView: 'information' };
      } else {
        const allowed = ['installments','draws','shares','members','chat','settings','audit'];
        if (!allowed.includes(section)) return;
        groupDetailTab = section;
        params = {};
      }
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
      const allowed = ['installments','shares','draws','members','settings','news','chat','audit','overview','communication'];
      groupDetailTab = allowed.includes(el.dataset.tab) ? el.dataset.tab : (isManager()?'members':'overview');
      params = {};
      syncNavigationContext();
      redraw();
      return;
    }
    if (action === 'managed-draw-view') {
      const manager = isManager();
      const allowedViews = manager ? ['summary','eligible','schedule','result','history'] : ['summary','eligible','result','history'];
      const requested = el.dataset.view || 'summary';
      if (!allowedViews.includes(requested)) { toast('هذا القسم متاح لمدير الجمعية فقط'); return; }
      groupDetailTab = 'draws';
      params = { managedView: 'draw', managedDrawView: requested };
      syncNavigationContext();
      redraw();
      return;
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
