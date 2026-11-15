const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/* cycle_attendance is no longer read: attendance is retired and is not a draw condition */
const EXPECTED_TABLES = [
  'associations','profiles','association_memberships','shares','association_cycles',
  'installment_periods','installment_obligations','installment_receipts','receipt_corrections',
  'draws','draw_eligible_shares','chat_messages','chat_read_states',
  'association_events','association_notification_settings','association_user_preferences',
  'invitations','join_requests','notifications','reminders','user_preferences'
];

function loadRemoteGateway(options = {}) {
  const calls = { tables: [], rpc: [], realtime: [], removed: 0 };
  const storeRef = { value: null };
  const profile = {
    id:'user-1', fullName:'أحمد محمد علي', avatarKey:'avatar-01',
    completed:true, phone:'+967777123456', city:'تعز'
  };
  const remoteUser = { id:'user-1', email:'person@example.com', email_confirmed_at:'2026-11-14T00:00:00Z' };
  const client = {
    from(table) {
      calls.tables.push(table);
      return {
        select() {
          let start=0,end=499;
          const query = {
            order(column,opts) { calls.orders=(calls.orders||[]).concat([{table,column,opts}]); return query; },
            range(from,to) { start=from;end=to;calls.ranges=(calls.ranges||[]).concat([{table,from,to}]);return query; },
            then(resolve,reject) {
              const rows=(options.tableData&&options.tableData[table])||[];
              return Promise.resolve({ data:rows.slice(start,end+1), error:null }).then(resolve,reject);
            }
          };
          return query;
        },
        upsert: async () => ({ error:null })
      };
    },
    rpc: async (name,args) => {
      calls.rpc.push({ name,args });
      if(options.rpcErrors&&options.rpcErrors[name])return {data:null,error:options.rpcErrors[name]};
      if(options.rpcData&&Object.prototype.hasOwnProperty.call(options.rpcData,name))return {data:options.rpcData[name],error:null};
      if(name==='send_installment_reminders')return {data:1,error:null};
      if(name==='create_association')return { data:'association-1', error:null };
      if(name==='create_association_unified')return { data:'association-1', error:null };
      if(name==='manage_association_public_link')return { data:{id:'link-1',token:'public-token',status:'active'}, error:null };
      if(name==='create_invitations_bulk')return { data:{
        total:1,sentCount:1,failedCount:0,
        results:[{status:'sent',id:'invite-1',name:'مدعو',token:'invite-token'}]
      }, error:null };
      if(name==='get_my_invitation_inbox')return { data:[], error:null };
      if(name==='accept_invitation')return { data:{association_id:'association-1',membership_id:'membership-1',shares_added:1}, error:null };
      return { data:true,error:null };
    },
    channel(name) {
      const channel = {
        name,
        on(type,filter,callback) { calls.realtime.push({type,filter,callback}); return channel; },
        subscribe() { return channel; }
      };
      return channel;
    },
    removeChannel() { calls.removed++; }
  };
  const window = {
    location:{origin:'https://sahm.example',pathname:'/app.html'},
    SahmSupabase:{
      user:async()=>remoteUser,
      profile:async()=>profile,
      client:()=>client,
      friendlyError:e=>String(e&&e.message||e||'error')
    },
    SahmData:{ VERSION:'test-v1', normalizeDb:db=>db },
    SahmCore:{ parseMoney:(value)=>Number(value)||0, normalizeReadiness:(r)=>({ ready:!!r.ready, reasons:r.reasons||[] }) },
    SahmApp:{
      useRemoteStore(db){storeRef.value=db;},
      clearStore(){storeRef.value=null;},
      report(){}
    }
  };
  const code=fs.readFileSync(path.join(__dirname,'..','sahm-supabase-data.js'),'utf8');
  vm.runInNewContext(code,{window,console,Date,Promise,Array,Object,String,Number,Math,setTimeout,clearTimeout});
  return { gateway:window.SahmSupabaseData, window, calls, storeRef, profile };
}

function associationRow(id, extra) {
  return Object.assign({
    id, manager_user_id:'user-1', name:'جمعية '+id, currency:'YER',
    start_date:'2026-12-01', invite_opens_on:null, invite_closes_on:null,
    time_zone:'Asia/Aden', cycle_type:'weekly', cycle_days:7,
    share_amount_minor:100, installments_count:1, target_shares:10,
    max_shares_per_member:2, manager_participates:false, quorum_percent:66,
    rules:'', locked_at:null, locked_share_count:null, status:'active', created_at:'2026-11-14T00:00:00Z'
  }, extra || {});
}

test('remote gateway loads the full RLS-scoped table snapshot into SahmApp', async()=>{
  const {gateway,calls,storeRef,profile}=loadRemoteGateway();
  const db=await gateway.init(profile);
  assert.deepEqual([...new Set(calls.tables)].sort(),[...EXPECTED_TABLES].sort());
  assert.equal(calls.tables.length,EXPECTED_TABLES.length);
  assert.equal(calls.ranges.length,EXPECTED_TABLES.length);
  assert.equal(calls.orders.length,EXPECTED_TABLES.length);
  assert.ok(calls.orders.every(x=>x.opts.ascending===true));
  assert.equal(calls.tables.includes('cycle_attendance'),false);
  assert.equal(db.prefs.user.id,'user-1');
  assert.equal(db.prefs.user.email,'person@example.com');
  assert.equal(db.prefs.user.name,'أحمد محمد علي');
  assert.equal(db.groups.length,0);
  assert.equal(storeRef.value,db);
  assert.equal(gateway.isRemote(),true);
});

test('remote mutation layer creates the date-based unified association through RPC', async()=>{
  const {gateway,window,calls}=loadRemoteGateway();
  await gateway.init();
  gateway.install();
  const result=await window.SahmApp.createGroup({
    name:'جمعية موحدة',currency:'YER',startDate:'2026-12-01',firstDrawOn:'2026-12-31',
    durationDays:30,shareAmountMinor:10000,installmentMode:'amount',
    installmentAmountMinor:4000,managerMode:'only',quorum:66,tz:'Asia/Aden'
  });
  assert.equal(result.ok,true);
  assert.equal(result.groupId,'association-1');
  const call=calls.rpc.find(x=>x.name==='create_association_unified');
  assert.ok(call);
  assert.equal(call.args.p_payload.firstDrawOn,'2026-12-31');
  assert.equal(call.args.p_payload.installmentMode,'amount');
  assert.equal(call.args.p_payload.installmentAmountMinor,4000);
  const link=calls.rpc.find(x=>x.name==='manage_association_public_link');
  assert.ok(link);
  assert.equal(link.args.p_action,'create');
  assert.match(result.publicLink.url,/\\?join=public-token$/);
});

test('association creation payload carries neither quorum nor time zone', async()=>{
  const {gateway,window,calls}=loadRemoteGateway();
  await gateway.init();
  gateway.install();
  await window.SahmApp.createGroup({
    name:'جمعية',currency:'YER',startDate:'2026-12-01',firstDrawOn:'2026-12-31',
    shareAmountMinor:10000,installmentMode:'count',installments:3,managerMode:'only',quorum:66,tz:'Asia/Aden'
  });
  const payload=calls.rpc.find(x=>x.name==='create_association_unified').args.p_payload;
  assert.equal(Object.prototype.hasOwnProperty.call(payload,'quorum'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload,'timeZone'),false);
  assert.equal(payload.installments,3);
});


test('remote gateway paginates association records beyond a single page',async()=>{
  const groups=Array.from({length:501},(_,i)=>associationRow('g-'+(i+1)));
  const {gateway,calls}=loadRemoteGateway({tableData:{associations:groups}});
  const db=await gateway.init();
  assert.equal(db.groups.length,501);
  const pages=calls.ranges.filter(x=>x.table==='associations');
  assert.equal(pages.length,2);
  assert.deepEqual(pages.map(x=>[x.from,x.to]),[[0,499],[500,999]]);
  assert.equal(calls.orders.find(x=>x.table==='associations').column,'id');
});

test('snapshot maps publishing channels, draw time and cycle status and drops the quorum field', async()=>{
  const {gateway}=loadRemoteGateway({tableData:{
    associations:[associationRow('g-1')],
    association_cycles:[{id:'c1',association_id:'g-1',cycle_no:1,status:'open',draw_scheduled_at:'2026-12-01T10:00:00Z'}],
    association_notification_settings:[{
      association_id:'g-1',enabled_types:['received'],feed_enabled_types:['received','late'],
      chat_enabled_types:['joined'],name_visible_types:['drawResult','joined']
    }]
  }});
  const db=await gateway.init();
  const group=db.groups[0];
  assert.equal(group.notify.received,true);
  assert.equal(group.notify.late,true);
  assert.equal(group.notify.joined,false);
  assert.equal(group.notifyChat.joined,true);
  assert.equal(group.notifyChat.received,false);
  assert.equal(group.notifyNames.joined,true);
  assert.equal(group.notifyNames.received,false);
  assert.equal(group.drawRound,1);
  assert.equal(group.drawScheduledAt,'2026-12-01T10:00:00Z');
  assert.equal(group.cycleStatus,'open');
  assert.equal(Object.prototype.hasOwnProperty.call(group,'quorum'),false);
});

test('groups without a settings row publish everything to feed and chat and show names only for the draw result', async()=>{
  const {gateway}=loadRemoteGateway({tableData:{associations:[associationRow('g-1')]}});
  const db=await gateway.init();
  const group=db.groups[0];
  assert.ok(Object.keys(group.notify).every(t=>group.notify[t]===true));
  assert.ok(Object.keys(group.notifyChat).every(t=>group.notifyChat[t]===true));
  assert.equal(group.notifyNames.drawResult,true);
  assert.equal(group.notifyNames.received,false);
});

test('attendance is retired: the gateway refuses locally and never calls the database', async()=>{
  const {gateway,window,calls}=loadRemoteGateway();
  await gateway.init();
  gateway.install();
  const result=await window.SahmApp.setAttendance('membership-1',true);
  assert.equal(result.ok,false);
  assert.equal(result.code,'ATTENDANCE_RETIRED');
  assert.equal(calls.rpc.some(x=>x.name==='set_cycle_attendance'),false);
});

test('draw time and presentation status go through their dedicated RPCs', async()=>{
  const {gateway,window,calls}=loadRemoteGateway({rpcData:{
    set_draw_scheduled_at:{cycle_id:'c1',round_no:1,draw_scheduled_at:'2026-12-01T10:00:00Z'},
    set_draw_presentation_status:{round_no:1,status:'completed',changed:true}
  }});
  await gateway.init();
  gateway.install();
  const scheduled=await window.SahmApp.setDrawScheduledAt('association-1','2026-12-01T10:00:00Z');
  assert.equal(scheduled.ok,true);
  assert.equal(scheduled.roundNo,1);
  const sched=calls.rpc.find(x=>x.name==='set_draw_scheduled_at');
  assert.equal(sched.args.p_association_id,'association-1');
  assert.equal(sched.args.p_scheduled_at,'2026-12-01T10:00:00.000Z');
  const invalid=await window.SahmApp.setDrawScheduledAt('association-1','not-a-time');
  assert.equal(invalid.ok,false);
  assert.equal(calls.rpc.filter(x=>x.name==='set_draw_scheduled_at').length,1);
  const shown=await window.SahmApp.setDrawPresentationStatus('association-1',1,'completed');
  assert.equal(shown.ok,true);
  assert.equal(shown.status,'completed');
  assert.equal(shown.changed,true);
  const pres=calls.rpc.find(x=>x.name==='set_draw_presentation_status');
  assert.equal(pres.args.p_round_no,1);
  assert.equal(pres.args.p_status,'completed');
});

test('draw readiness maps the database financial_ready flag to the core view model', async()=>{
  const {gateway,window,calls}=loadRemoteGateway({rpcData:{get_draw_readiness:{
    financial_ready:true,can_draw:false,date_reached:true,time_reached:false,
    round_no:'2',due_on:'2026-12-01',draw_scheduled_at:'2026-12-01T10:00:00Z',cycle_status:'open',reasons:[]
  }}});
  await gateway.init();
  gateway.install();
  const result=await window.SahmApp.getDrawReadiness('association-1');
  assert.equal(result.ok,true);
  assert.equal(result.readiness.ready,true);
  assert.equal(result.financialReady,true);
  assert.equal(result.canDraw,false);
  assert.equal(result.dateReached,true);
  assert.equal(result.timeReached,false);
  assert.equal(result.roundNo,2);
  assert.equal(result.dueOn,'2026-12-01');
  assert.equal(calls.rpc.find(x=>x.name==='get_draw_readiness').args.p_association_id,'association-1');
});

test('draw room, history, financial summary, news and audit log use the new read RPCs', async()=>{
  const {gateway,window,calls}=loadRemoteGateway({rpcData:{
    get_draw_room:{state:'pending',eligible_shares:[]},
    get_draw_history:[{round_no:1}],
    get_association_financial_summary:{totals:{due_minor:10}},
    get_association_news:[{event_id:'e1'}],
    get_association_audit_log:[{event_id:'e1'},{event_id:'e2'}]
  }});
  await gateway.init();
  gateway.install();
  const room=await window.SahmApp.getDrawRoom('association-1');
  assert.equal(room.ok,true);
  assert.equal(room.room.state,'pending');
  const roomCall=calls.rpc.find(x=>x.name==='get_draw_room');
  assert.equal(roomCall.args.p_round_no,null);
  await window.SahmApp.getDrawRoom('association-1',3);
  assert.equal(calls.rpc.filter(x=>x.name==='get_draw_room')[1].args.p_round_no,3);
  const history=await window.SahmApp.getDrawHistory('association-1');
  assert.equal(history.history.length,1);
  const summary=await window.SahmApp.getFinancialSummary('association-1');
  assert.equal(summary.summary.totals.due_minor,10);
  const news=await window.SahmApp.getNews('association-1',20);
  assert.equal(news.news.length,1);
  const newsCall=calls.rpc.find(x=>x.name==='get_association_news');
  assert.equal(newsCall.args.p_limit,20);
  assert.equal(Object.prototype.hasOwnProperty.call(newsCall.args,'p_before'),false);
  const audit=await window.SahmApp.getAuditLog('association-1');
  assert.equal(audit.log.length,2);
  assert.equal(calls.rpc.find(x=>x.name==='get_association_audit_log').args.p_limit,100);
});

test('notification settings send channels as type lists and keep omitted channels untouched', async()=>{
  const {gateway,window,calls}=loadRemoteGateway();
  await gateway.init();
  gateway.install();
  const result=await window.SahmApp.setNotifySettings('association-1',{
    feed:{received:true,late:true,joined:false},chat:['joined','unknown'],names:null
  });
  assert.equal(result.ok,true);
  const call=calls.rpc.find(x=>x.name==='set_association_notification_settings');
  assert.equal(call.args.p_association_id,'association-1');
  assert.deepEqual([...call.args.p_feed_types],['received','late']);
  assert.deepEqual([...call.args.p_chat_types],['joined']);
  assert.equal(call.args.p_name_visible_types,null);
});

test('remote gateway subscribes only to chat and notifications and clears channel state', async()=>{
  const {gateway,calls}=loadRemoteGateway();
  await gateway.init();
  gateway.startRealtime(()=>{});
  assert.equal(calls.realtime.length,5);
  assert.ok(calls.realtime.some(x=>x.filter.table==='chat_messages'));
  assert.ok(calls.realtime.some(x=>x.filter.table==='notifications'&&x.filter.filter==='user_id=eq.user-1'));
  assert.ok(calls.realtime.some(x=>x.filter.table==='join_requests'));
  assert.ok(calls.realtime.some(x=>x.filter.table==='invitations'));
  gateway.clear();
  assert.equal(calls.removed,1);
  assert.equal(gateway.isRemote(),false);
});


test('coalesces related invitation and join-request realtime events into one snapshot refresh', async()=>{
  const {gateway,calls}=loadRemoteGateway();
  await gateway.init();
  const initialReads=calls.tables.length;
  const delivered=[];
  gateway.startRealtime(payload=>delivered.push(payload.table));

  const joinSubscription=calls.realtime.find(x=>x.filter.table==='join_requests');
  const inviteSubscription=calls.realtime.find(x=>x.filter.table==='invitations');
  assert.ok(joinSubscription&&inviteSubscription);

  joinSubscription.callback({table:'join_requests',eventType:'INSERT',new:{id:'request-1'}});
  inviteSubscription.callback({table:'invitations',eventType:'UPDATE',new:{id:'invite-1'}});

  await new Promise(resolve=>setTimeout(resolve,180));
  assert.equal(calls.tables.length-initialReads,EXPECTED_TABLES.length);
  assert.deepEqual(delivered,['join_requests','invitations']);
  gateway.clear();
});

test('remote reminder gateway maps repeat guard and forwards explicit confirmation', async()=>{
  const options={
    tableData:{association_cycles:[{id:'cycle-1',association_id:'association-1',cycle_no:1}]},
    rpcErrors:{send_installment_reminders:{code:'RPT01',message:'أُرسل تذكير بهذا القسط خلال الساعات الست الماضية. هل تريد إرسال تذكير آخر؟'}}
  };
  const {gateway,window,calls}=loadRemoteGateway(options);
  await gateway.init();
  gateway.install();

  const first=await window.SahmApp.sendReminder({groupId:'association-1',cycle:1,no:1});
  assert.equal(first.ok,false);
  assert.equal(first.code,'REMINDER_REPEAT');
  assert.equal(first.needsConfirm,true);
  const firstReminderCalls=calls.rpc.filter(x=>x.name==='send_installment_reminders');
  assert.equal(firstReminderCalls.length,1);
  assert.equal(firstReminderCalls[0].args.p_confirm_repeat,false);

  delete options.rpcErrors.send_installment_reminders;
  const second=await window.SahmApp.sendReminder({groupId:'association-1',cycle:1,no:1,confirmRepeat:true});
  assert.equal(second.ok,true);
  const reminderCalls=calls.rpc.filter(x=>x.name==='send_installment_reminders');
  assert.equal(reminderCalls.length,2);
  assert.equal(reminderCalls[1].args.p_confirm_repeat,true);
  gateway.clear();
});

test('remote gateway sends selected contacts through the bulk invitation RPC', async()=>{
  const {gateway,window,calls}=loadRemoteGateway();
  await gateway.init();
  gateway.install();
  const result=await window.SahmApp.createInvitationsBulk('association-1',[{name:'مدعو',phone:'+967777123456'}]);
  assert.equal(result.ok,true);
  assert.equal(result.sentCount,1);
  assert.equal(result.failedCount,0);
  assert.match(result.results[0].url,/\\?invite=invite-token$/);
  const call=calls.rpc.find(x=>x.name==='create_invitations_bulk');
  assert.ok(call);
  assert.equal(call.args.p_association_id,'association-1');
  assert.equal(call.args.p_invitees[0].name,'مدعو');
});
