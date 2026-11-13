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
  'invitations','notifications','reminders','user_preferences'
];

function loadRemoteGateway() {
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
          const query = {
            then(resolve,reject) {
              return Promise.resolve({ data:[], error:null }).then(resolve,reject);
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
  assert.equal(db.prefs.user.id,'user-1');
  assert.equal(db.prefs.user.email,'person@example.com');
  assert.equal(db.prefs.user.name,'أحمد محمد علي');
  assert.equal(db.groups.length,0);
  assert.equal(storeRef.value,db);
  assert.equal(gateway.isRemote(),true);
});

test('remote mutation layer writes through database RPC, not SahmData local operations', async()=>{
  const {gateway,window,calls}=loadRemoteGateway();
  await gateway.init();
  gateway.install();
  const result=await window.SahmApp.createGroup({
    name:'جمعية الاختبار',currency:'YER',startDate:'2026-12-01',
    cycleType:'monthly',shareAmount:'100',installments:2,targetShares:10,
    maxPerMember:2,managerMode:'only',quorum:66,tz:'Asia/Aden'
  });
  assert.equal(result.ok,true);
  assert.equal(result.groupId,'association-1');
  const call=calls.rpc.find(x=>x.name==='create_association');
  assert.ok(call);
  assert.equal(call.args.p_payload.name,'جمعية الاختبار');
  assert.equal(call.args.p_payload.shareAmountMinor,100);
});

test('remote gateway subscribes only to chat and notifications and clears channel state', async()=>{
  const {gateway,calls}=loadRemoteGateway();
  await gateway.init();
  gateway.startRealtime(()=>{});
  assert.equal(calls.realtime.length,3);
  assert.ok(calls.realtime.some(x=>x.filter.table==='chat_messages'));
  assert.ok(calls.realtime.some(x=>x.filter.table==='notifications'&&x.filter.filter==='user_id=eq.user-1'));
  gateway.clear();
  assert.equal(calls.removed,1);
  assert.equal(gateway.isRemote(),false);
});
