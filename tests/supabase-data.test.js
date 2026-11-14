const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const EXPECTED_TABLES = [
  'associations','profiles','association_memberships','shares','association_cycles',
  'installment_periods','installment_obligations','installment_receipts','receipt_corrections',
  'draws','draw_eligible_shares','cycle_attendance','chat_messages','chat_read_states',
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
        on(type,filter,callback) { calls.realtime.push({type,filter}); return channel; },
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
    SahmCore:{ parseMoney:(value)=>Number(value)||0 },
    SahmApp:{
      useRemoteStore(db){storeRef.value=db;},
      clearStore(){storeRef.value=null;},
      report(){}
    }
  };
  const code=fs.readFileSync(path.join(__dirname,'..','sahm-supabase-data.js'),'utf8');
  vm.runInNewContext(code,{window,console,Date,Promise,Array,Object,String,Number,Math});
  return { gateway:window.SahmSupabaseData, window, calls, storeRef, profile };
}

test('remote gateway loads the full RLS-scoped table snapshot into SahmApp', async()=>{
  const {gateway,calls,storeRef,profile}=loadRemoteGateway();
  const db=await gateway.init(profile);
  assert.deepEqual([...new Set(calls.tables)].sort(),[...EXPECTED_TABLES].sort());
  assert.equal(calls.tables.length,EXPECTED_TABLES.length);
  assert.equal(calls.ranges.length,EXPECTED_TABLES.length);
  assert.equal(calls.orders.length,EXPECTED_TABLES.length);
  assert.ok(calls.orders.every(x=>x.opts.ascending===true));
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


test('remote gateway paginates association records beyond a single page',async()=>{
  const association=(n)=>({
    id:'g-'+n,manager_user_id:'user-1',name:'جمعية '+n,currency:'YER',
    start_date:'2026-12-01',invite_opens_on:null,invite_closes_on:null,
    time_zone:'Asia/Aden',cycle_type:'weekly',cycle_days:7,
    share_amount_minor:100,installments_count:1,target_shares:10,
    max_shares_per_member:2,manager_participates:false,quorum_percent:66,
    rules:'',locked_at:null,locked_share_count:null,status:'active',created_at:'2026-11-14T00:00:00Z'
  });
  const groups=Array.from({length:501},(_,i)=>association(i+1));
  const {gateway,calls}=loadRemoteGateway({tableData:{associations:groups}});
  const db=await gateway.init();
  assert.equal(db.groups.length,501);
  const pages=calls.ranges.filter(x=>x.table==='associations');
  assert.equal(pages.length,2);
  assert.deepEqual(pages.map(x=>[x.from,x.to]),[[0,499],[500,999]]);
  assert.equal(calls.orders.find(x=>x.table==='associations').column,'id');
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
