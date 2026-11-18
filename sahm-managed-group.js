/* SAHM managed-group detail workspace.
   Isolated presentation layer: it consumes existing read models and existing action handlers.
   No database, Supabase, engine, or shared-screen behavior is changed here. */
(function (root) {
  'use strict';
  const state = { cycle: null, installment: 'all', status: 'all', query: '', drawView: 'summary' };
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
      '<div class="mgd-facts">' +
      '<div class="mgd-fact"><span>' + uiIcon('wallet', 18) + '<span>قيمة السهم</span></span><b>' + esc(money(g.share, g.currency)) + '</b></div>' +
      '<div class="mgd-fact"><span>' + uiIcon('calendar-days', 18) + '<span>مدة الدورة</span></span><b>' + esc((d.plan && d.plan.durationDays) || g.cycleDays || '—') + ' يوم</b></div>' +
      '<div class="mgd-fact"><span>' + uiIcon('users', 18) + '<span>عدد الأعضاء</span></span><b>' + esc(d.members || 0) + '</b></div>' +
      '<div class="mgd-fact"><span>' + uiIcon('shield-check', 18) + '<span>صفة المستخدم</span></span><b>' + esc(currentRole(g)) + '</b></div>' +
      '</div><div class="mgd-progress-head"><span>تقدم الدورات</span><b>' + p.done + ' من ' + p.total + '</b></div>' +
      '<div class="mgd-progress"><i style="width:' + p.pct + '%"></i></div></section>';
  }
  function tabs(active) {
    const items = [
      ['members', 'users', 'الأعضاء'],
      ['cycles', 'calendar-days', 'الدورات'],
      ['installments', 'receipt', 'الأقساط'],
      ['draw-room', 'shuffle', 'غرفة القرعة']
    ];
    return '<nav class="mgd-tabs" aria-label="إدارة الجمعية">' + items.map(([id, icon, label]) =>
      '<button type="button" class="' + (active === id ? 'active' : '') + '" data-action="managed-tab" data-tab="' + id + '">' +
      uiIcon(icon, 19) + '<span>' + label + '</span></button>').join('') + '</nav>';
  }
  function backToTab(tab) {
    return '<button type="button" class="mgd-back" data-action="managed-back" data-tab="' + (tab || 'members') + '">' +
      uiIcon('back-screen', 18) + '<span>العودة إلى ' + (tab === 'cycles' ? 'الدورات' : tab === 'installments' ? 'الأقساط' : tab === 'draw-room' ? 'غرفة القرعة' : 'الأعضاء') + '</span></button>';
  }
  function memberCards(g) {
    const result = SahmApp.memberList(g.id);
    if (!result || !result.ok) return '<div class="mgd-empty">تعذر تحميل قائمة الأعضاء</div>';
    const list = result.members || [];
    const rows = list.map(m =>
      '<button type="button" class="mgd-member-card" data-action="managed-open-member" data-member-id="' + esc(m.memberId) + '">' +
      '<span class="mgd-avatar">' + esc((m.name || '؟').slice(0, 1)) + '</span><span class="mgd-member-main"><b>' + esc(m.name) + '</b>' +
      '<small>' + (m.isManager ? 'مدير الجمعية' : 'عضو') + (m.isMe ? ' · حسابك' : '') + '</small></span>' +
      '<span class="mgd-member-shares"><b>' + Number(m.shares || 0) + '</b><small>أسهم</small></span>' + uiIcon('back-screen', 18) + '</button>'
    ).join('');
    return '<div class="mgd-list-head"><b>الأعضاء</b><span>' + list.length + ' عضو</span></div>' +
      '<label class="mgd-search">' + uiIcon('search', 18) + '<input id="mgdMemberSearch" type="search" placeholder="البحث باسم العضو" autocomplete="off"></label>' +
      '<div class="mgd-list" id="mgdMemberList">' + (rows || '<div class="mgd-empty">لا يوجد أعضاء مسجلون</div>') + '</div>' +
      '<div class="mgd-member-tools"><button type="button" data-go="member-reception">إدارة استقبال الأعضاء</button><button type="button" data-go="invite">دعوة عضو</button></div>';
  }
  function bindMemberSearch() {
    const input = document.getElementById('mgdMemberSearch'), list = document.getElementById('mgdMemberList');
    if (!input || !list) return;
    input.addEventListener('input', () => {
      const q = input.value.trim().toLocaleLowerCase();
      list.querySelectorAll('.mgd-member-card').forEach(card => {
        card.hidden = !card.querySelector('.mgd-member-main b').textContent.toLocaleLowerCase().includes(q);
      });
    });
  }
  function cycleCards(g, d) {
    const historyResult = SahmApp.getDrawHistory(g.id);
    const history = historyResult && historyResult.ok ? (historyResult.history || []) : [];
    const byRound = new Map(history.map(x => [Number(x.round_no || x.round), x]));
    const total = Math.max(0, Number(d.rounds) || 0), current = Math.min(total, (Number(d.drawn) || 0) + 1);
    const cards = Array.from({ length: total }, (_, i) => {
      const n = i + 1, draw = byRound.get(n);
      const stateLabel = draw ? 'نتيجة مثبتة' : n === current ? 'الدورة الحالية' : 'قادمة';
      const winner = draw ? (draw.winner_owner_name || draw.winnerLabel || '—') : 'لم تُنفذ القرعة';
      return '<button type="button" class="mgd-cycle-card" data-action="managed-open-cycle" data-round="' + n + '">' +
        '<span class="mgd-cycle-number">' + n + '</span><span class="mgd-cycle-main"><b>الدورة ' + n + '</b><small>' + esc(winner) + '</small></span>' +
        '<span class="mgd-cycle-state">' + esc(stateLabel) + '</span>' + uiIcon('back-screen', 18) + '</button>';
    }).join('');
    return '<div class="mgd-list-head"><b>الدورات</b><span>' + total + ' دورة</span></div>' +
      '<div class="mgd-list">' + (cards || '<div class="mgd-empty">لا توجد دورات لعرضها</div>') + '</div>';
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
      const actions = (x.status === 'due' || x.status === 'late')
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
    };
    [search, status, cycle, number].forEach(el => el && el.addEventListener(el === search ? 'input' : 'change', update));
    update();
  }
  function installmentsPanel(g, d) {
    const totalCycles = Math.max(1, Number(d.rounds) || 1), cycle = Math.min(totalCycles, Math.max(1, Number(state.cycle || d.cycle || 1)));
    const cycleOptions = Array.from({ length: totalCycles }, (_, i) => '<option value="' + (i + 1) + '" ' + (cycle === i + 1 ? 'selected' : '') + '>الدورة ' + (i + 1) + '</option>').join('');
    const installmentOptions = Array.from({ length: Math.max(1, Number(g.installments) || 1) }, (_, i) => '<option value="' + (i + 1) + '" ' + (String(state.installment) === String(i + 1) ? 'selected' : '') + '>القسط ' + (i + 1) + '</option>').join('');
    return '<div class="mgd-list-head"><b>الأقساط</b><span>إدارة التحصيل</span></div>' +
      '<div class="mgd-filter-grid"><label class="mgd-search">' + uiIcon('search', 18) + '<input id="mgdInstallmentSearch" type="search" placeholder="ابحث باسم العضو" autocomplete="off"></label>' +
      '<label class="mgd-select"><span>الدورة</span><select id="mgdInstallmentCycle">' + cycleOptions + '</select></label>' +
      '<label class="mgd-select"><span>رقم القسط</span><select id="mgdInstallmentNumber"><option value="all">كل الأقساط</option>' + installmentOptions + '</select></label>' +
      '<label class="mgd-select"><span>حالة القسط</span><select id="mgdInstallmentStatus"><option value="all">جميع الحالات</option><option value="due">مستحق</option><option value="paid">مدفوع</option><option value="late">متأخر</option><option value="upcoming">لم يحن موعده</option></select></label></div>' +
      '<div id="mgdInstallmentList" class="mgd-installment-list"></div>' +
      '<section class="mgd-bulk-reminder"><label>تذكير جماعي بالقسط<select id="reminderInstallment">' + installmentOptions + '</select></label><button type="button" data-action="send-reminder-all">إرسال للمستحقين والمتأخرين</button></section>' +
      '<button type="button" class="mgd-secondary-link" data-go="receipts">سجل الاستلام والتصحيحات ' + uiIcon('back-screen', 16) + '</button>';
  }
  function cycleDetail(g, d, round) {
    const historyResult = SahmApp.getDrawHistory(g.id), history = historyResult && historyResult.ok ? (historyResult.history || []) : [];
    const draw = history.find(x => Number(x.round_no || x.round) === round);
    const rows = SahmApp.installmentRows(g.id, { cycle: round, status: 'all' });
    const obligations = rows && rows.ok ? rows.rows || [] : [];
    return backToTab('cycles') + '<div class="mgd-detail-heading"><b>الدورة ' + round + '</b>' + (draw ? '<span class="mgd-role">نتيجة مثبتة</span>' : '<span class="mgd-role">تفاصيل الدورة</span>') + '</div>' +
      (draw ? '<section class="mgd-detail-card">' + row('trophy', 'الفائز', draw.winner_owner_name || draw.winnerLabel || '—') +
        row('hash', 'رقم السهم', draw.winner_share_no || draw.winnerShareId || '—') +
        row('calendar-days', 'تاريخ القرعة', dateLabel(draw.scheduled_on || draw.date)) +
        row('coins', 'الجائزة المستهدفة', moneyValue(draw.prize_target_minor || draw.prize || 0, draw.currency || g.currency)) +
        row('monitor', 'حالة العرض', draw.presentation_status || '—') + '</section>' : '') +
      '<div class="mgd-list-head"><b>أقساط الدورة</b><span>' + obligations.length + ' سجل</span></div>' +
      '<div class="mgd-list">' + (obligations.map(x => '<div class="mgd-simple-row"><span><b>' + esc(x.memberName) + '</b><small>القسط ' + x.no + '</small></span>' + pill(x.status) + '</div>').join('') || '<div class="mgd-empty">لا توجد بيانات أقساط لهذه الدورة</div>') + '</div>';
  }
  async function drawPanel(g, d) {
    const view = params.managedDrawView || 'summary';
    const roomResult = await SahmApp.getDrawRoom(g.id);
    if (!roomResult || !roomResult.ok) return '<div class="mgd-empty">' + esc(roomResult && roomResult.message || 'تعذر تحميل غرفة القرعة') + '</div>';
    const room = roomResult.room || {}, cycle = room.cycle || {}, draw = room.draw || null, eligible = room.eligible_shares || [];
    const readinessResult = await SahmApp.getDrawReadiness(g.id);
    const financeResult = await SahmApp.getFinancialSummary(g.id);
    const readiness = readinessResult && readinessResult.ok ? readinessResult : {};
    const financial = financeResult && financeResult.ok ? financeResult.summary : null;
    const states = { none: 'لم تبدأ الجولة', pending: 'بانتظار الموعد', scheduled: 'موعد محدد', open: 'مفتوحة', presenting: 'جارٍ عرض النتيجة', completed: 'اكتمل العرض', failed: 'تعذر العرض' };
    const reasons = { NO_SHARES: 'لا توجد أسهم مؤهلة', DRAW_COMPLETE: 'اكتملت جميع جولات القرعة', DRAW_NOT_DUE: 'لم يحن موعد القرعة بعد', INSTALLMENTS_UNPAID: 'توجد أقساط غير مكتملة', FINANCIAL_NOT_READY: 'لم تكتمل المتطلبات المالية' };
    const nav = '<nav class="mgd-draw-nav">' + [['summary','ملخص الجولة'],['eligible','الأسهم المؤهلة'],['schedule','موعد القرعة'],['result','النتيجة'],['history','السجل']].map(([id,label]) =>
      '<button type="button" class="' + (view === id ? 'active' : '') + '" data-action="managed-draw-view" data-view="' + id + '">' + label + '</button>').join('') + '</nav>';
    let body = '';
    if (view === 'summary') {
      const totals = financial && financial.totals || {}, shares = financial && financial.shares || {};
      body = '<section class="mgd-detail-card"><div class="mgd-detail-heading"><b>الجولة ' + esc(room.round_no || '—') + ' من ' + esc(room.rounds_total || d.rounds || '—') + '</b><span class="mgd-role">' + esc(states[room.state] || room.state || '—') + '</span></div>' +
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
        (draw ? '<div class="mgd-reason">تم تثبيت نتيجة هذه الجولة؛ لا يمكن تغيير موعدها.</div>' : actionButton('حفظ موعد القرعة', 'schedule-draw', '', 'primary')) + '</section>';
    } else if (view === 'result') {
      body = '<section class="mgd-detail-card"><div class="mgd-detail-heading"><b>تنفيذ نتيجة الجولة</b>' + pill(room.state || 'pending') + '</div>' +
        (draw ? '<div class="mgd-winner"><span>' + uiIcon('trophy', 25) + '</span><b>' + esc(draw.winner_owner_name || 'الفائز') + '</b><small>السهم ' + esc(draw.winner_share_no || '—') + '</small></div>' :
          '<div class="mgd-empty">لم تُثبت نتيجة القرعة بعد</div>') +
        (draw ? '<div class="mgd-actions">' + actionButton('تسجيل اكتمال العرض', 'draw-presentation-completed', '', 'primary') + actionButton('تسجيل تعذر العرض', 'draw-presentation-failed', '', '') + '</div>' :
          actionButton('تنفيذ القرعة وتثبيت النتيجة', 'run-draw', readiness.canDraw ? '' : 'disabled', 'primary') ) + '</section>';
    } else {
      const historyResult = SahmApp.getDrawHistory(g.id), history = historyResult && historyResult.ok ? historyResult.history || [] : [];
      body = '<div class="mgd-list-head"><b>سجل القرعات</b><span>' + history.length + ' نتيجة</span></div><div class="mgd-list">' +
        (history.map(x => '<div class="mgd-simple-row"><span class="mgd-cycle-number">' + esc(x.round_no || x.round) + '</span><span class="mgd-member-main"><b>الجولة ' + esc(x.round_no || x.round) + ' · ' + esc(x.winner_owner_name || x.winnerLabel || '—') + '</b><small>' + esc(dateLabel(x.scheduled_on || x.date)) + '</small></span><span class="mgd-status-ok">مثبتة</span></div>').join('') || '<div class="mgd-empty">لا توجد نتائج مثبتة بعد</div>') + '</div>';
    }
    return nav + body;
  }
  async function render(g, d) {
    const view = params.managedView || '';
    let active = ['members','cycles','installments','draw-room'].includes(groupDetailTab) ? groupDetailTab : 'members';
    let content = '';
    if (view === 'member') {
      const memberId = String(params.memberId || '');
      const statement = SahmApp.memberStatement(g.id, memberId);
      const member = (SahmApp.memberList(g.id).members || []).find(x => String(x.memberId) === memberId);
      if (!statement || !statement.ok) content = backToTab('members') + '<div class="mgd-empty">' + esc(statement && statement.message || 'تعذر تحميل ملف العضو') + '</div>';
      else content = backToTab('members') + '<div class="mgd-detail-heading"><b>' + esc(statement.memberName) + '</b><span class="mgd-role">' + (member && member.isManager ? 'مدير الجمعية' : 'عضو') + '</span></div>' +
        '<section class="mgd-detail-card">' + row('users', 'عدد الأسهم', statement.shares) + row('wallet', 'إجمالي الالتزام', moneyValue(statement.commitment && statement.commitment.overall, statement.currency)) + '</section>' +
        (statement.cycles || []).map(c => '<section class="mgd-detail-card"><div class="mgd-detail-heading"><b>الدورة ' + c.cycle + '</b><span>' + (c.progress.paid || 0) + ' من ' + (c.progress.total || 0) + ' أقساط</span></div>' +
          (c.rows || []).map(x => '<div class="mgd-simple-row"><span><b>القسط ' + x.no + '</b><small>' + esc(dateLabel(x.periodStart)) + ' – ' + esc(dateLabel(x.periodEnd)) + '</small></span>' + pill(x.status) + '<b>' + esc(moneyValue(x.total, statement.currency)) + '</b></div>').join('') + '</section>').join('');
      shell('ملف العضو', 'groups', identity(g, d) + content);
      return;
    }
    if (view === 'cycle') {
      content = cycleDetail(g, d, Number(params.round) || 1);
      shell('تفاصيل الدورة', 'groups', identity(g, d) + content);
      return;
    }
    if (view) {
      const sub = await drawPanel(g, d);
      shell('غرفة القرعة', 'groups', identity(g, d) + backToTab('draw-room') + sub);
      return;
    }
    if (active === 'members') { content = memberCards(g); }
    else if (active === 'cycles') { content = cycleCards(g, d); }
    else if (active === 'installments') { content = installmentsPanel(g, d); }
    else { params.managedDrawView = params.managedDrawView || 'summary'; content = await drawPanel(g, d); }
    shell('تفاصيل الجمعية', 'groups', identity(g, d) + tabs(active) + '<main class="mgd-content">' + content + '</main>' +
      '<nav class="mgd-utilities" aria-label="روابط الجمعية"><button data-go="news">أخبار الجمعية</button><button data-go="chat">محادثة الجمعية</button><button data-go="audit">سجل العمليات</button></nav>');
    if (active === 'members') bindMemberSearch();
    if (active === 'installments') bindInstallmentFilters(g, d);
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
    if (!['managed-tab', 'managed-open-member', 'managed-open-cycle', 'managed-back', 'managed-draw-view'].includes(action)) return;
    event.preventDefault();
    event.stopPropagation();

    if (action === 'managed-tab') {
      const allowed = ['members', 'cycles', 'installments', 'draw-room'];
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
        currentGroupId: currentGroupId, groupDetailTab: 'cycles'
      });
      return;
    }
    if (action === 'managed-back') {
      const allowed = ['members', 'cycles', 'installments', 'draw-room'];
      groupDetailTab = allowed.includes(el.dataset.tab) ? el.dataset.tab : 'members';
      params = {};
      syncNavigationContext();
      redraw();
      return;
    }
    if (action === 'managed-draw-view') {
      params = { managedView: 'draw', managedDrawView: el.dataset.view || 'summary' };
      syncNavigationContext();
      redraw();
    }
  });
  root.SahmManagedGroup = { render, redraw };
})(window);
