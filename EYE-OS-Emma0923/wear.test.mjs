import test from 'node:test';
import assert from 'node:assert/strict';
import {createWearCheck,wearItems,wearRoles} from './wear-core.js';
import {createWearReader} from './hands-reader.js';
const NOW=1700000000000;
const report=(layout='single-hands',now=NOW)=>({schema:'aima.wear-check.v1',layout,checkedAt:new Date(now).toISOString(),
  devices:wearRoles(layout).map((role,i)=>({role,source:'hardware',port:`COM${i+5}`,roleVerified:true,fresh:true,frameAgeMs:10,sourceTime:now/1000}))});
function checkAll(wear,layout='single-hands'){ for(const id of wearItems(layout)) wear.confirmItem(id,true); }

test('each wearing method requires its own items; no mode is pre-approved',()=>{
  for(const layout of ['single-legs','single-hands','dual']) {
    const wear=createWearCheck(layout),state=wear.snapshot(NOW);
    assert.equal(state.approved,false);assert.equal(state.checked.length,0);
    assert.equal(state.required.length,{'single-legs':5,'single-hands':6,dual:11}[layout]);
    assert.equal(wear.confirm(NOW),false);
    checkAll(wear,layout);assert.equal(wear.confirm(NOW),true);
    assert.equal(wear.canContinue(NOW),true);assert.equal(wear.canContinue(NOW,true),false);
    assert.equal(wear.snapshot(NOW).wearVerified,false);assert.equal(wear.snapshot(NOW).hardwareOutput,false);
  }
});

test('missing, opposite-role, string and unchecked items cannot bypass the manual gate',()=>{
  const wear=createWearCheck();checkAll(wear);
  wear.confirmItem('hand-release',false);wear.confirmItem('leg-left',true);wear.confirmItem('hand-release','true');
  assert.equal(wear.confirm(NOW),false);
  wear.confirmItem('hand-release',true);assert.equal(wear.confirm(NOW),true);
  wear.confirmItem('hand-support',false);assert.equal(wear.canContinue(NOW),false);
  wear.reset('dual');assert.equal(wear.snapshot(NOW).checked.length,0);
});

test('connected angle play requires manual confirmation plus real role-verified recent devices',()=>{
  const wear=createWearCheck();checkAll(wear);
  assert.equal(wear.confirm(NOW,true),false);
  assert.equal(wear.ingest(report(),NOW).ok,true);
  assert.equal(wear.confirm(NOW,true),true);
  assert.equal(wear.canContinue(NOW+1501,true),false);
  wear.ingest(report('single-hands',NOW+1502),NOW+1502);
  assert.equal(wear.canContinue(NOW+1502,true),false,'Fresh data cannot re-approve after expiry');
  assert.equal(wear.confirm(NOW+1502,true),true);
});

test('simulation, replay, wrong roles, stale frames and duplicate dual ports are not device proof',()=>{
  for(const mutate of [r=>r.devices[0].source='simulation',r=>r.devices[0].source='replay',r=>r.devices[0].roleVerified=false,
    r=>r.devices[0].fresh=false,r=>r.devices[0].frameAgeMs=201,r=>r.devices[0].sourceTime-=.3,
    r=>r.devices[0].sourceTime+=1,r=>r.devices[0].frameAgeMs=-1,r=>r.devices[0].port='private raw data']) {
    const wear=createWearCheck();checkAll(wear);const value=report();mutate(value);wear.ingest(value,NOW);
    assert.equal(wear.confirm(NOW,true),false);
  }
  const wear=createWearCheck('dual');checkAll(wear,'dual');const value=report('dual');value.devices[1].port='com5';wear.ingest(value,NOW);
  assert.equal(wear.snapshot(NOW).deviceReady,false);assert.match(wear.snapshot(NOW).reason,/同一实体/);
});

test('wrong layout, malformed envelope and unexpected device count clear prior approval',()=>{
  for(const value of [null,{},report('dual'),{...report(),devices:[]},{...report(),devices:[...report().devices,...report().devices]},
    {...report(),checkedAt:new Date(NOW+10).toISOString()},report('single-hands',NOW-1501)]) {
    const wear=createWearCheck();checkAll(wear);wear.ingest(report(),NOW);wear.confirm(NOW,true);
    wear.ingest(value,NOW+1);assert.equal(wear.canContinue(NOW+1,true),false);
  }
});

test('port change clears wearer confirmations and repeated snapshots do not refresh freshness',()=>{
  const wear=createWearCheck();checkAll(wear);wear.ingest(report(),NOW);wear.confirm(NOW,true);
  assert.equal(wear.ingest(report(),NOW+100).repeated,true);
  const changed=report('single-hands',NOW+200);changed.devices[0].port='COM8';
  assert.equal(wear.ingest(changed,NOW+200).changed,true);
  assert.equal(wear.snapshot(NOW+200).checked.length,0);assert.equal(wear.canContinue(NOW+200,true),false);
});

test('wear result snapshots are detached and cannot manufacture sensor verification',()=>{
  const wear=createWearCheck();checkAll(wear);wear.ingest(report(),NOW);
  const state=wear.snapshot(NOW);state.checked.length=0;state.devices[0].port='COM9';state.wearVerified=true;
  assert.equal(wear.snapshot(NOW).checked.length,6);assert.equal(wear.snapshot(NOW).devices[0].port,'COM5');assert.equal(wear.snapshot(NOW).wearVerified,false);
});

test('wear reader is opt-in GET-only, cancels late replies and does not accept a caller URL',async()=>{
  const calls=[],samples=[],timers=new Map();let id=0;
  const reader=createWearReader({route:'https://ignored.example',onSample:r=>samples.push(r),onError:()=>{},
    fetcher:(url,options)=>new Promise(resolve=>calls.push({url,options,resolve})),schedule:fn=>{timers.set(++id,fn);return id;},cancel:n=>timers.delete(n),clock:()=>0});
  assert.equal(calls.length,0);reader.start();assert.equal(calls[0].url,'/api/wear-check');assert.equal(calls[0].options.method,'GET');
  reader.stop();calls[0].resolve({ok:true,json:async()=>report()});for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(calls[0].options.signal.aborted,true);assert.equal(samples.length,0);assert.equal(timers.size,0);
});
