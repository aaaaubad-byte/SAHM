/* SAHM remote data gateway. All business state is read from Supabase and every mutation is confirmed by a database RPC. */
(function (root) {
  'use strict';
  var app = null, client = null, user = null, profile = null, store = null, raw = {}, realtimeChannel = null, realtimeCallback = null;
  var NOTIFY = ['received','completed','late','drawSoon','drawDue','drawResult','joined','motivate'];

  function c() {
    if (!root.SahmSupabase) throw new Error('مكتبة الاتصال غير جاهزة');
    return root.SahmSupabase.client();
  }
  function fail(error) {
    var result={ ok:false, code:error && (error.code || error.status) || 'REMOTE_ERROR',
      message:root.SahmSupabase ? root.SahmSupabase.friendlyError(error) : (error && error.message || 'تعذر تنفيذ العملية على الخادم') };
    if(app&&app.report)app.report('supabase',result);
    return result;
  }
  async function rows(table, select) {
    var pageSize=500,offset=0,all=[];
    var orderColumn=({
      association_notification_settings:'association_id',
      user_preferences:'user_id',
      join_requests:'submitted_at'
    })[table] || 'id';
    while(true){
      var q=c().from(table).select(select || '*')
        .order(orderColumn,{ascending:true})
        .range(offset,offset+pageSize-1);
      var r=await q;
      if(r.error)throw r.error;
      var page=r.data||[];
      all=all.concat(page);
      if(page.length<pageSize)return all;
      offset+=pageSize;
    }
  }
  function profileName(id, profiles) {
    return profiles[id] && profiles[id].full_name || (id === (user && user.id) && profile ? profile.fullName : 'مشارك');
  }
  function mapEventType(type) {
    return ({association_created:'created',association_updated:'settings',member_joined:'join',member_removed:'leave',
      shares_added:'shares',shares_removed:'shares',invitation_created:'invite',invitation_cancelled:'invite',
      receipt_recorded:'receipt',receipt_corrected:'correction',draw_result:'draw',reminders_sent:'reminder',
      attendance_marked:'attendance',chat_message:'message',
      join_request_submitted:'join-request',join_request_approved:'join-request',join_request_rejected:'join-request',join_request_cancelled:'join-request',
      invitation_interested:'invite',invitation_declined:'invite',invitation_deferred:'invite',public_link_created:'invite'})[type] || type || 'activity';
  }
  function eventText(e, profiles) {
    var a=e.after_data||{}, b=e.before_data||{};
    switch(e.event_type) {
      case 'association_created': return 'أُنشئت الجمعية «'+(a.name||'')+'»';
      case 'association_updated': return 'تم تعديل إعدادات الجمعية';
      case 'member_joined': return 'انضم عضو جديد إلى الجمعية';
      case 'member_removed': return 'تمت إزالة عضو من الجمعية';
      case 'shares_added': return 'تمت إضافة '+(a.count||'')+' سهم';
      case 'shares_removed': return 'تم تقليل '+(a.count||'')+' سهم';
      case 'invitation_created': return 'تم إنشاء دعوة إلى '+(a.invitee_name||'عضو');
      case 'invitation_cancelled': return 'تم إلغاء الدعوة';
      case 'invitation_interested': return 'وافق المدعو على استكمال طلب الانضمام';
      case 'invitation_declined': return 'رفض المدعو الدعوة';
      case 'invitation_deferred': return 'أجّل المدعو الرد على الدعوة';
      case 'join_request_submitted': return 'وصل طلب انضمام جديد';
      case 'join_request_approved': return 'تمت الموافقة على طلب الانضمام';
      case 'join_request_rejected': return 'تم رفض طلب الانضمام';
      case 'join_request_cancelled': return 'ألغى مقدم الطلب طلب الانضمام';
      case 'public_link_created': return 'تم إنشاء رابط انضمام عام';
      case 'receipt_recorded': return 'تم تسجيل استلام قسط';
      case 'receipt_corrected': return 'تم تصحيح سجل استلام';
      case 'draw_result': return 'تم تثبيت نتيجة القرعة';
      case 'reminders_sent': return 'تم إرسال '+(a.recipients||0)+' تذكير';
      default: return e.event_type || 'نشاط';
    }
  }
  function groupCycle(cycles, aid, no) {
    return cycles.find(function(x){return x.association_id===aid && Number(x.cycle_no)===Number(no);}) || null;
  }
  function profileCompletionRows(p) {
    return p && p.completed ? p : {id:user.id,fullName:'',avatarKey:'avatar-01',completed:false,phone:'',city:''};
  }

  async function loadSnapshot(profileValue) {
    user = await root.SahmSupabase.user();
    profile = profileValue || await root.SahmSupabase.profile(user.id);
    var names = ['associations','profiles','association_memberships','shares','association_cycles',
      'installment_periods','installment_obligations','installment_receipts','receipt_corrections',
      'draws','draw_eligible_shares','cycle_attendance','chat_messages','chat_read_states',
      'association_events','association_notification_settings','association_user_preferences',
      'invitations','join_requests','notifications','reminders','user_preferences'];
    var result = await Promise.all(names.map(function(name){ return rows(name); }));
    raw = {};
    names.forEach(function(n,i){raw[n]=result[i];});
    var profileMap = {};
    raw.profiles.forEach(function(p){profileMap[p.id]=p;});
    if (!profileMap[user.id]) profileMap[user.id]={id:user.id,full_name:profile.fullName,avatar_key:profile.avatarKey,profile_completed:profile.completed};

    var memberships = raw.association_memberships.filter(function(m){return m.status==='active';});
    var membershipMap = {};
    memberships.forEach(function(m){membershipMap[m.id]=m;});
    var activeShares = raw.shares.filter(function(s){return s.status==='active';});
    var shareMap = {};
    activeShares.forEach(function(s){shareMap[s.id]=s;});
    var cycles = raw.association_cycles;
    var cycleMap = {};
    cycles.forEach(function(x){cycleMap[x.id]=x;});
    var periodMap = {};
    raw.installment_periods.forEach(function(x){periodMap[x.id]=x;});
    var obligationMap = {};
    raw.installment_obligations.forEach(function(x){obligationMap[x.id]=x;});

    var db = {
      version:root.SahmData.VERSION, seededOn:new Date().toISOString().slice(0,10), seq:0,
      groups:[],members:[],shares:[],receipts:[],draws:[],messages:[],events:[],
      notifications:[],chatReads:{},reminders:[],invites:[],joinRequests:[],corrections:[],emitted:{},
      meta:{createdAt:new Date().toISOString(),migrations:[]},
      prefs:{
        session:true,verified:!!user.email_confirmed_at,
        user:{id:user.id,name:profile.fullName||'',phone:profile.phone||'',city:profile.city||'',email:user.email||'',avatarKey:profile.avatarKey||'avatar-01'},
        notifications:true,biometric:false,mute:{}
      }
    };

    var settingsMap={};
    raw.association_notification_settings.forEach(function(x){settingsMap[x.association_id]=x;});
    var associationIds=raw.associations.map(function(a){return a.id;});
    raw.associations.forEach(function(a){
      var st=settingsMap[a.id], enabled=st ? st.enabled_types : NOTIFY;
      var notify={}; NOTIFY.forEach(function(t){notify[t]=enabled.indexOf(t)>=0;});
      db.groups.push({
        id:a.id,name:a.name,tone:'blue',currency:a.currency,tz:a.time_zone||'Asia/Aden',
        cycleType:a.cycle_type,cycleDays:Number(a.cycle_days),firstDrawOn:a.first_draw_on||null,
        installmentMode:a.installment_mode||'count',installmentAmountMinor:a.installment_amount_minor==null?null:Number(a.installment_amount_minor),
        installments:Number(a.installments_count),shareAmount:Number(a.share_amount_minor),
        startDate:a.start_date,createdOn:String(a.created_at||'').slice(0,10),
        maxPerMember:a.max_shares_per_member==null?null:Number(a.max_shares_per_member),targetShares:a.target_shares==null?null:Number(a.target_shares),
        quorum:Number(a.quorum_percent),rules:a.rules||'',notify:notify,
        managerUserId:a.manager_user_id,managerName:profileName(a.manager_user_id,profileMap),
        inviteCode:null,inviteOpensOn:a.invite_opens_on||a.start_date,inviteClosesOn:a.invite_closes_on||null,
        lockedAt:a.locked_at||null,lockedShareCount:a.locked_share_count||null,
        managerParticipates:!!a.manager_participates,status:a.status
      });
    });

    memberships.forEach(function(m){
      var a=raw.associations.find(function(x){return x.id===m.association_id;});
      if(!a)return;
      var currentCycle=cycles.filter(function(x){return x.association_id===a.id;})
        .sort(function(x,y){return Number(y.cycle_no)-Number(x.cycle_no);})[0];
      var attendance=currentCycle && raw.cycle_attendance.find(function(x){
        return x.cycle_id===currentCycle.id && x.membership_id===m.id;
      });
      db.members.push({
        id:m.id,groupId:m.association_id,name:profileName(m.user_id,profileMap),userId:m.user_id,
        isManager:m.user_id===a.manager_user_id,joinedAt:String(m.joined_at||'').slice(0,10),
        present:!!(attendance&&attendance.present),status:m.status
      });
    });
    activeShares.forEach(function(s){
      if(!membershipMap[s.membership_id])return;
      db.shares.push({id:s.id,groupId:s.association_id,memberId:s.membership_id,no:Number(s.share_no),addedAt:s.added_at});
    });

    raw.installment_receipts.forEach(function(r){
      var obligation=obligationMap[r.obligation_id],period=obligation&&periodMap[obligation.period_id];
      var cyc=obligation&&cycleMap[obligation.cycle_id],member=membershipMap[r.membership_id];
      if(!obligation||!period||!cyc||!member)return;
      var shareIds=db.shares.filter(function(s){return s.memberId===r.membership_id;})
        .sort(function(a,b){return a.no-b.no;}).slice(0,Number(r.shares_count)||obligation.shares_count).map(function(s){return s.id;});
      db.receipts.push({
        id:r.id,groupId:r.association_id,memberId:r.membership_id,beneficiaryId:r.membership_id,
        cycle:Number(cyc.cycle_no),no:Number(period.installment_no),shareIds:shareIds,
        sharesCount:Number(obligation.shares_count),amount:Number(r.amount_minor),currency:r.currency,
        recordedAt:r.recorded_at,recordedBy:r.recorded_by_user_id,
        recordedByName:profileName(r.recorded_by_user_id,profileMap),
        self:!!r.self_recorded,periodStart:period.starts_on,periodEnd:period.ends_on,
        status:r.status,voided:r.status!=='active'
      });
    });

    var eligibleMap={};
    raw.draw_eligible_shares.forEach(function(x){(eligibleMap[x.draw_id]||(eligibleMap[x.draw_id]=[])).push(x.share_id);});
    raw.draws.forEach(function(d){
      var win=shareMap[d.winner_share_id] || raw.shares.find(function(s){return s.id===d.winner_share_id;});
      db.draws.push({
        id:d.id,groupId:d.association_id,round:Number(d.round_no),date:d.scheduled_on,at:d.drawn_at,
        by:null,winnerShareId:d.winner_share_id,winnerMemberId:win&&win.membership_id||null,
        shareCount:Number(d.share_count_at_draw),prize:Number(d.prize_target_minor),
        recordedAtDraw:Number(d.prize_target_minor),eligibleShareIds:eligibleMap[d.id]||[],
        quorum:{people:Number(d.quorum_people),required:Number(d.quorum_required)},overrideQuorum:false
      });
    });

    raw.chat_messages.forEach(function(m){
      db.messages.push({
        id:m.id,groupId:m.association_id,kind:m.kind,senderName:m.kind==='system'?'سهم':profileName(m.sender_user_id,profileMap),
        senderId:m.sender_user_id||'sahm-system',userId:m.sender_user_id||null,
        type:m.system_type||null,text:m.body,at:m.created_at
      });
    });
    raw.association_events.forEach(function(e){
      db.events.push({
        id:e.id,groupId:e.association_id,at:e.occurred_at,type:mapEventType(e.event_type),
        eventType:e.event_type,text:eventText(e,profileMap),actor:e.actor_user_id?profileName(e.actor_user_id,profileMap):'سهم',
        memberId:e.entity_type==='membership'?e.entity_id:null,
        vis:e.visibility==='all'?'group':e.visibility==='manager'?'manager':e.visibility==='private'?'private':'group',
        data:e.after_data||null,before:e.before_data||null
      });
    });
    raw.invitations.forEach(function(i){
      db.invites.push({
        id:i.id,groupId:i.association_id,name:i.invitee_name,phone:i.invitee_phone_e164||'',
        shares:i.shares_requested==null?null:Number(i.shares_requested),isLegacy:i.shares_requested!=null,
        responseStatus:i.response_status||'pending_response',status:i.status,createdAt:i.created_at,createdBy:i.created_by,
        expiresAt:i.expires_at,invitedUserId:i.invited_user_id,respondedAt:i.responded_at||null
      });
    });
    raw.join_requests.forEach(function(r){
      var a=raw.associations.find(function(x){return x.id===r.association_id;});
      db.joinRequests.push({id:r.id,groupId:r.association_id,applicantUserId:r.applicant_user_id,
        applicantName:profileName(r.applicant_user_id,profileMap),invitationId:r.invitation_id||null,
        publicLinkId:r.public_link_id||null,sourceType:r.source_type,requestedShares:Number(r.requested_shares),
        estimatedAmountMinor:Number(r.estimated_amount_minor),currency:a&&a.currency||'YER',status:r.status,
        submittedAt:r.submitted_at,decidedAt:r.decided_at||null,decidedByUserId:r.decided_by_user_id||null,
        rejectionReason:r.rejection_reason||'',membershipId:r.membership_id||null});
    });
    raw.notifications.forEach(function(n){
      var mute=raw.association_user_preferences.find(function(p){return p.association_id===n.association_id && p.user_id===user.id;});
      db.notifications.push({
        id:n.id,groupId:n.association_id,userId:n.user_id,type:n.type,
        at:n.created_at,read:!!n.read_at,muted:!!(mute&&(mute.mute_group||(n.type==='reminder'&&mute.mute_reminders))),
        text:n.body,title:n.title,relatedEntityId:n.related_entity_id
      });
    });
    raw.chat_read_states.forEach(function(x){if(x.user_id===user.id)db.chatReads[x.association_id]=x.last_read_at;});

    var reminderGroups={};
    raw.reminders.forEach(function(r){
      var obligation=obligationMap[r.obligation_id];
      if(!obligation)return;
      var period=periodMap[obligation.period_id],cyc=cycleMap[obligation.cycle_id];
      if(!period||!cyc)return;
      var key=[r.batch_id||r.id,r.association_id,cyc.cycle_no,period.installment_no].join(':');
      var item=reminderGroups[key]||(reminderGroups[key]={id:r.batch_id||r.id,groupId:r.association_id,
        cycle:Number(cyc.cycle_no),no:Number(period.installment_no),recipients:[],at:r.sent_at,by:r.sent_by_user_id});
      item.recipients.push(r.recipient_user_id);
    });
    Object.keys(reminderGroups).forEach(function(k){db.reminders.push(reminderGroups[k]);});

    raw.receipt_corrections.forEach(function(x){
      db.corrections.push({
        id:x.id,groupId:x.association_id,receiptId:x.receipt_id,actor:x.corrected_by_user_id,
        reason:x.reason,kind:x.action,at:x.corrected_at,before:x.before_snapshot,after:x.after_snapshot
      });
    });
    raw.association_user_preferences.forEach(function(p){
      if(p.user_id!==user.id)return;
      db.prefs.mute[p.association_id]={group:!!p.mute_group,reminders:!!p.mute_reminders};
    });
    var up=raw.user_preferences.find(function(x){return x.user_id===user.id;});
    db.prefs.notifications=up ? !!up.notifications_enabled : true;
    db.prefs.user.notifications=db.prefs.notifications;
    db.prefs.user.biometric=false;

    db= root.SahmData.normalizeDb(db);
    store=db;
    if (root.SahmApp && root.SahmApp.useRemoteStore) root.SahmApp.useRemoteStore(db);
    return db;
  }

  async function refresh() {
    if (!profile || !user) throw new Error('لا توجد جلسة حساب نشطة');
    return loadSnapshot(profile);
  }
  async function invoke(name,args) {
    var r=await c().rpc(name,args||{});
    if(r.error)throw r.error;
    return r.data;
  }
  function moneyMinor(value,currency) {
    return root.SahmCore.parseMoney(value,currency);
  }
  function currentCycle(aid) {
    var list=raw.association_cycles.filter(function(x){return x.association_id===aid;})
      .sort(function(x,y){return Number(x.cycle_no)-Number(y.cycle_no);});
    return list.find(function(x){var now=new Date().toISOString().slice(0,10);return x.starts_on<=now && x.ends_on>=now;}) || list[list.length-1] || null;
  }
  function findObligation(groupId,memberId,cycleNo,installmentNo) {
    var cyc=groupCycle(raw.association_cycles,groupId,cycleNo);
    if(!cyc)return null;
    var period=raw.installment_periods.find(function(p){return p.cycle_id===cyc.id && Number(p.installment_no)===Number(installmentNo);});
    if(!period)return null;
    return raw.installment_obligations.find(function(o){return o.association_id===groupId&&o.membership_id===memberId&&o.period_id===period.id;})||null;
  }
  function phoneE164(value) {
    var v=String(value||'').replace(/[٠-٩]/g,function(d){return '٠١٢٣٤٥٦٧٨٩'.indexOf(d);}).replace(/\s/g,'').replace(/[().-]/g,'');
    if(/^00/.test(v))v='+'+v.slice(2);
    if(/^\+/.test(v))return v;
    return '+967'+v.replace(/^0+/,'');
  }
  async function afterMutation(result,extra) {
    await refresh();
    return Object.assign({ok:true},extra||{},result && typeof result==='object'?result:{data:result});
  }
  async function createGroup(input) {
    try {
      input=input||{};
      var startDate=String(input.startDate||''),firstDrawOn=String(input.firstDrawOn||'');
      if(!firstDrawOn&&startDate&&Number(input.durationDays)>0)firstDrawOn=root.SahmCore.addDays(startDate,Number(input.durationDays));
      var amount=input.shareAmountMinor!==undefined?Number(input.shareAmountMinor):moneyMinor(input.shareAmount,input.currency);
      var mode=input.installmentMode==='amount'?'amount':'count';
      var participates=input.managerMode==='both'||input.managerParticipates===true;
      var payload={name:String(input.name||'').trim(),currency:input.currency,startDate:startDate,firstDrawOn:firstDrawOn,
        inviteOpensOn:input.inviteOpensOn||null,inviteClosesOn:input.inviteClosesOn||null,
        timeZone:input.timeZone||input.tz||'Asia/Aden',shareAmountMinor:amount,installmentMode:mode,
        installments:mode==='count'?Number(input.installments):undefined,
        installmentAmountMinor:mode==='amount'?(input.installmentAmountMinor!==undefined?Number(input.installmentAmountMinor):moneyMinor(input.installmentAmount,input.currency)):undefined,
        managerParticipates:participates,managerShares:participates?Number(input.managerShares)||0:0,
        quorum:Number(input.quorum)||66,rules:input.rules||''};
      var id=await invoke('create_association_unified',{p_payload:payload});
      var link=null,linkWarning=null;
      try{
        var ld=await invoke('manage_association_public_link',{p_association_id:id,p_action:'create'});
        link={id:ld.id,token:ld.token,status:ld.status,url:root.location.origin+root.location.pathname+'?join='+encodeURIComponent(ld.token)};
      }catch(le){linkWarning=root.SahmSupabase.friendlyError(le);}
      await refresh();
      return {ok:true,groupId:id,group:store.groups.find(function(g){return g.id===id;})||null,publicLink:link,linkWarning:linkWarning};
    }catch(e){return fail(e);}
  }
  async function updateGroup(groupId,patch) {
    try {
      patch=patch||{};
      var p={};
      Object.keys(patch).forEach(function(k){
        var map={startDate:'startDate',inviteOpensOn:'inviteOpensOn',inviteClosesOn:'inviteClosesOn',
          cycleType:'cycleType',cycleDays:'cycleDays',installments:'installments',
          maxPerMember:'maxPerMember',targetShares:'targetShares',quorum:'quorum',
          name:'name',currency:'currency',rules:'rules'};
        if(map[k])p[map[k]]=patch[k];
      });
      if(patch.shareAmount!==undefined)p.shareAmountMinor=moneyMinor(patch.shareAmount,(patch.currency)||((store.groups.find(function(g){return g.id===groupId;})||{}).currency));
      var id=await invoke('update_association',{p_association_id:groupId,p_payload:p});
      await refresh();return {ok:true,groupId:id};
    } catch(e){return fail(e);}
  }
  async function createInvite(groupId,input) {
    try{
      input=input||{};var phone=input.phone?phoneE164(input.phone):null;
      var data=await invoke('create_invitation',{p_association_id:groupId,p_name:String(input.name||'').trim(),p_phone:phone});
      await refresh();
      var link=root.location.origin+root.location.pathname+'?invite='+encodeURIComponent(data.token);
      return {ok:true,invite:{id:data.id,name:input.name,phone:phone||'',shares:null,isLegacy:false,
        responseStatus:'pending_response',status:'pending',token:data.token,link:link,expiresInDays:data.expires_in_days},
        summary:root.SahmApp.inviteSummary(groupId)};
    }catch(e){return fail(e);}
  }
  async function cancelInvite(inviteId){
    try{await invoke('cancel_invitation',{p_invitation_id:inviteId});await refresh();return {ok:true};}catch(e){return fail(e);}
  }
  async function previewInvite(token){
    try{return {ok:true,invite:await invoke('preview_invitation',{p_token:token})};}catch(e){return fail(e);}
  }
  async function acceptInvite(token){
    try{
      var data=await invoke('accept_invitation',{p_token:token});
      await refresh();return {ok:true,groupId:data.association_id,membershipId:data.membership_id,sharesAdded:data.shares_added};
    }catch(e){return fail(e);}
  }
  async function respondToInvite(invitationId,action){
    try{var d=await invoke('respond_to_invitation',{p_invitation_id:invitationId,p_action:action});await refresh();return Object.assign({ok:true},d||{});}catch(e){return fail(e);}
  }
  async function submitJoinRequest(sourceType,token,requestedShares){
    try{var d=await invoke('submit_join_request',{p_source_type:sourceType,p_token:token,p_requested_shares:Number(requestedShares)});await refresh();return Object.assign({ok:true},d||{});}catch(e){return fail(e);}
  }
  async function cancelJoinRequest(requestId){
    try{var d=await invoke('cancel_join_request',{p_request_id:requestId});await refresh();return Object.assign({ok:true},d||{});}catch(e){return fail(e);}
  }
  async function approveJoinRequest(requestId){
    try{var d=await invoke('approve_join_request',{p_request_id:requestId});await refresh();return Object.assign({ok:true},d||{});}catch(e){return fail(e);}
  }
  async function rejectJoinRequest(requestId,reason){
    try{var d=await invoke('reject_join_request',{p_request_id:requestId,p_reason:reason||null});await refresh();return Object.assign({ok:true},d||{});}catch(e){return fail(e);}
  }
  async function managePublicLink(groupId,action){
    try{var d=await invoke('manage_association_public_link',{p_association_id:groupId,p_action:action});await refresh();
      if(d&&d.token)d.url=root.location.origin+root.location.pathname+'?join='+encodeURIComponent(d.token);
      return Object.assign({ok:true},d||{});
    }catch(e){return fail(e);}
  }
  async function previewPublicJoinLink(token){
    try{return {ok:true,link:await invoke('preview_public_join_link',{p_token:token})};}catch(e){return fail(e);}
  }
  async function listMyInvitations(){
    try{return {ok:true,invitations:await invoke('list_my_invitations',{})||[]};}catch(e){return fail(e);}
  }
  async function addShares(memberId,count){
    try{var n=await invoke('add_shares',{p_membership_id:memberId,p_count:Number(count)});await refresh();return {ok:true,added:n};}catch(e){return fail(e);}
  }
  async function removeShares(memberId,count){
    try{var n=await invoke('remove_shares',{p_membership_id:memberId,p_count:Number(count)});await refresh();return {ok:true,removed:n};}catch(e){return fail(e);}
  }
  async function removeMember(memberId){
    try{await invoke('remove_member',{p_membership_id:memberId});await refresh();return {ok:true};}catch(e){return fail(e);}
  }
  async function setAttendance(memberId,present){
    try{
      var m=store.members.find(function(x){return x.id===memberId;});
      if(!m)throw new Error('العضو غير موجود');
      var cyc=currentCycle(m.groupId);if(!cyc)throw new Error('لا توجد دورة نشطة لتسجيل الحضور');
      await invoke('set_cycle_attendance',{p_cycle_id:cyc.id,p_membership_id:memberId,p_present:!!present});
      await refresh();return {ok:true};
    }catch(e){return fail(e);}
  }
  async function recordPaid(p){
    try{
      var ob=findObligation(p.groupId,p.memberId,p.cycle,p.no);
      if(!ob)throw new Error('التزام القسط غير موجود في قاعدة البيانات');
      var id=await invoke('record_installment_receipt',{p_obligation_id:ob.id});
      await refresh();return {ok:true,receiptId:id};
    }catch(e){return fail(e);}
  }
  async function correctReceipt(receiptId,input){
    try{
      var reason=String(input&&input.reason||'').trim();
      var id=await invoke('correct_installment_receipt',{p_receipt_id:receiptId,p_reason:reason});
      await refresh();return {ok:true,correctionId:id};
    }catch(e){return fail(e);}
  }
  async function sendReminder(p){
    try{
      var cyc=groupCycle(raw.association_cycles,p.groupId,p.cycle);
      if(!cyc)throw new Error('الدورة المطلوبة غير موجودة');
      var member=p.memberId||null;
      var count=await invoke('send_installment_reminders',{
        p_cycle_id:cyc.id,p_installment_no:Number(p.no),p_membership_id:member
      });
      await refresh();return {ok:true,recipients:count};
    }catch(e){return fail(e);}
  }
  async function performDraw(groupId){
    try{
      var next=raw.draws.filter(function(x){return x.association_id===groupId;}).length+1;
      var data=await invoke('perform_draw',{p_association_id:groupId,p_expected_round_no:next});
      await refresh();
      var d=store.draws.find(function(x){return x.id===data.draw_id;});
      var sh=store.shares.find(function(x){return x.id===data.winner_share_id;});
      var m=sh&&store.members.find(function(x){return x.id===sh.memberId;});
      return {ok:true,drawId:data.draw_id,round:data.round,winner:{shareId:data.winner_share_id,memberId:m&&m.id,label:m?m.name+' · السهم '+sh.no:'—'},locked:!!data.locked};
    }catch(e){return fail(e);}
  }
  async function sendMessage(groupId,body){
    try{var id=await invoke('send_chat_message',{p_association_id:groupId,p_body:body});await refresh();return {ok:true,messageId:id};}catch(e){return fail(e);}
  }
  async function setNotifyType(groupId,type,enabled){
    try{
      var g=store.groups.find(function(x){return x.id===groupId;});if(!g)throw new Error('الجمعية غير موجودة');
      var types=NOTIFY.filter(function(t){return t===type?!!enabled:!!g.notify[t];});
      await invoke('set_association_notification_types',{p_association_id:groupId,p_enabled_types:types});
      await refresh();return {ok:true};
    }catch(e){return fail(e);}
  }
  async function setMute(groupId,patch){
    try{
      var old=store.prefs.mute[groupId]||{group:false,reminders:false};
      patch=patch||{};
      await invoke('set_association_user_preferences',{
        p_association_id:groupId,p_mute_group:patch.group===undefined?!!old.group:!!patch.group,
        p_mute_reminders:patch.reminders===undefined?!!old.reminders:!!patch.reminders
      });
      await refresh();return {ok:true};
    }catch(e){return fail(e);}
  }
  async function markChatRead(groupId){
    try{
      var stamp=new Date().toISOString();
      var res=await c().from('chat_read_states').upsert({
        association_id:groupId,user_id:user.id,last_read_at:stamp,updated_at:stamp
      },{onConflict:'association_id,user_id'});
      if(res.error)throw res.error;
      store.chatReads[groupId]=stamp;return {ok:true};
    }catch(e){return fail(e);}
  }
  async function markNotificationsRead(ids){
    try{
      var list=store.notifications.filter(function(n){return !n.read&&(!ids||ids.indexOf(n.id)>=0);});
      for(var i=0;i<list.length;i++)await invoke('mark_my_notification_read',{p_notification_id:list[i].id});
      list.forEach(function(n){n.read=true;});
      return {ok:true,marked:list.length};
    }catch(e){return fail(e);}
  }
  function handleRealtime(payload){
    if(!store||!payload||!payload.new)return;
    var row=payload.new, table=payload.table;
    if(table==='join_requests'||table==='invitations'){
      refresh().then(function(){if(typeof realtimeCallback==='function')realtimeCallback(payload);})
        .catch(function(error){if(app&&app.report)app.report('supabase',fail(error));});
      return;
    }
    if(table==='chat_messages' && payload.eventType==='INSERT'){
      if(store.messages.some(function(m){return m.id===row.id;}))return;
      raw.chat_messages.push(row);
      store.messages.push({
        id:row.id,groupId:row.association_id,kind:row.kind,
        senderName:row.kind==='system'?'سهم':profileName(row.sender_user_id,raw.profiles.reduce(function(a,p){a[p.id]=p;return a;},{})),
        senderId:row.sender_user_id||'sahm-system',userId:row.sender_user_id||null,
        type:row.system_type||null,text:row.body,at:row.created_at
      });
    }
    if(table==='notifications' && payload.eventType==='INSERT'){
      if(store.notifications.some(function(n){return n.id===row.id;}))return;
      raw.notifications.push(row);
      var pref=raw.association_user_preferences.find(function(p){return p.association_id===row.association_id&&p.user_id===user.id;});
      store.notifications.push({
        id:row.id,groupId:row.association_id,userId:row.user_id,type:row.type,
        at:row.created_at,read:!!row.read_at,
        muted:!!(pref&&(pref.mute_group||(row.type==='reminder'&&pref.mute_reminders))),
        text:row.body,title:row.title,relatedEntityId:row.related_entity_id
      });
    }
    if(table==='notifications' && payload.eventType==='UPDATE'){
      var existing=store.notifications.find(function(n){return n.id===row.id;});
      if(existing)existing.read=!!row.read_at;
      var rawRow=raw.notifications.find(function(n){return n.id===row.id;});
      if(rawRow)rawRow.read_at=row.read_at;
    }
    if(typeof realtimeCallback==='function')realtimeCallback(payload);
  }

  function startRealtime(callback){
    if(!user)return false;
    realtimeCallback=callback||null;
    if(realtimeChannel){
      try{c().removeChannel(realtimeChannel);}catch(_){}
      realtimeChannel=null;
    }
    realtimeChannel=c().channel('sahm-user-'+user.id)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'chat_messages'},handleRealtime)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:'user_id=eq.'+user.id},handleRealtime)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'notifications',filter:'user_id=eq.'+user.id},handleRealtime)
      .on('postgres_changes',{event:'*',schema:'public',table:'join_requests'},handleRealtime)
      .on('postgres_changes',{event:'*',schema:'public',table:'invitations'},handleRealtime)
      .subscribe();
    return true;
  }

  function stopRealtime(){
    if(realtimeChannel){
      try{c().removeChannel(realtimeChannel);}catch(_){}
      realtimeChannel=null;
    }
    realtimeCallback=null;
  }

  async function updateMyProfile(fullName,city){
    try{
      await invoke('update_my_profile',{p_full_name:String(fullName||'').trim(),p_city:String(city||'').trim()});
      profile=await root.SahmSupabase.profile(user.id);
      await refresh();
      return {ok:true,profile:profile};
    }catch(e){return fail(e);}
  }
  async function savePrefs(){
    try{
      var res=await c().from('user_preferences').upsert({
        user_id:user.id,notifications_enabled:store.prefs.notifications!==false,updated_at:new Date().toISOString()
      },{onConflict:'user_id'});
      if(res.error)throw res.error;
      return {ok:true};
    }catch(e){return fail(e);}
  }
  function install(){
    app=root.SahmApp;
    if(!app)throw new Error('SahmApp is not loaded');
    app.createGroup=createGroup;
    app.updateGroup=updateGroup;
    app.createInvite=createInvite;
    app.cancelInvite=cancelInvite;
    app.respondToInvite=respondToInvite;
    app.submitJoinRequest=submitJoinRequest;
    app.cancelJoinRequest=cancelJoinRequest;
    app.approveJoinRequest=approveJoinRequest;
    app.rejectJoinRequest=rejectJoinRequest;
    app.managePublicLink=managePublicLink;
    app.addShares=addShares;
    app.removeShares=removeShares;
    app.removeMember=removeMember;
    app.setAttendance=setAttendance;
    app.recordPaid=recordPaid;
    app.correctReceipt=correctReceipt;
    app.sendReminder=sendReminder;
    app.performDraw=performDraw;
    app.sendMessage=sendMessage;
    app.setNotifyType=setNotifyType;
    app.setMute=setMute;
    app.markChatRead=markChatRead;
    app.markNotificationsRead=markNotificationsRead;
    app.savePrefs=savePrefs;
    return true;
  }
  async function init(profileValue){
    user=await root.SahmSupabase.user();
    profile=profileValue || await root.SahmSupabase.profile(user.id);
    return loadSnapshot(profile);
  }
  function clear(){
    stopRealtime();user=null;profile=null;store=null;raw={};
    if(app&&app.clearStore)app.clearStore();
  }
  root.SahmSupabaseData={
    init:init,refresh:refresh,store:function(){return store;},raw:function(){return raw;},
    previewInvite:previewInvite,acceptInvite:acceptInvite,respondToInvite:respondToInvite,
    submitJoinRequest:submitJoinRequest,cancelJoinRequest:cancelJoinRequest,approveJoinRequest:approveJoinRequest,
    rejectJoinRequest:rejectJoinRequest,managePublicLink:managePublicLink,previewPublicJoinLink:previewPublicJoinLink,
    listMyInvitations:listMyInvitations,updateMyProfile:updateMyProfile,
    startRealtime:startRealtime,stopRealtime:stopRealtime,install:install,clear:clear,
    isRemote:function(){return !!store;},savePrefs:savePrefs
  };
})(window);
