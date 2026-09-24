import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandAngleInput, parseHandSample } from './hands-input.js';
import { createHandReader } from './hands-reader.js';

const WALL = 1790200000000;
function report(time, left=10, right=-20, mode='hardware') {
  return { available:true, checkedAt:new Date(WALL+time).toISOString(),
    shellos:{reachable:true, valid:true, mode}, telemetry:{fresh:true, sourceTime:(WALL+time)/1000,
      frameAgeMs:10, port:mode==='hardware'?'COM5':null, angles:{left,right}, angularVelocity:{left:0,right:0}} };
}
function fixture() {
  let now=0; const input=createHandAngleInput();
  function feed(left=10,right=-20,mode='hardware') { now+=100; return input.ingest(report(now,left,right,mode),WALL+now,now); }
  function pose(name,left,right,mode='hardware') { for(let n=0;n<8;n++)feed(left,right,mode); return input.capture(name,now); }
  function calibrate() { pose('center',10,-20); pose('back',-10,0); pose('forward',40,-60); }
  return {input,feed,pose,calibrate,get now(){return now;}};
}
test('three stable poses map asymmetric and mirrored axes without double-flipping the right side',()=>{
  const f=fixture(); f.calibrate(); assert.equal(f.input.status(f.now).calibrated,true);
  for(const [l,r,expected] of [[10,-20,[0,0]],[40,-60,[1,1]],[-10,0,[-1,-1]],[900,-900,[1,1]]]) {
    f.feed(l,r); let value; for(let n=0;n<40;n++)value=f.input.axes(f.now,.05);
    assert.ok(Math.abs(value.left-expected[0])<1e-8); assert.ok(Math.abs(value.right-expected[1])<1e-8);
  }
});
test('deadzone rejects small neutral noise; stale data clears filtered input',()=>{
  const f=fixture();f.calibrate();f.feed(11,-21);
  assert.deepEqual(f.input.axes(f.now,.05),{left:0,right:0});assert.equal(f.input.status(f.now).centered,true);
  f.feed(40,-60);assert.ok(f.input.axes(f.now,.05).left>0);
  assert.equal(f.input.axes(f.now+191,.05),null);assert.equal(f.input.status(f.now+191).live,false);
  f.feed(10,-20);assert.deepEqual(f.input.axes(f.now,.05),{left:0,right:0});
});
test('calibration refuses duplicate snapshots, moving handles and insufficient sampling time',()=>{
  const input=createHandAngleInput(), value=report(100);
  for(let i=0;i<20;i++)input.ingest(value,WALL+100,100+i);
  assert.equal(input.capture('center',120).ok,false);
  const f=fixture(); for(let i=0;i<6;i++){f.feed(i*10,-20);}
  assert.equal(f.input.capture('center',f.now).ok,false);
  const moving=createHandAngleInput();
  for(let t=100;t<=700;t+=100){const v=report(t);v.telemetry.angularVelocity.left=6;moving.ingest(v,WALL+t,t);}
  assert.equal(moving.capture('center',700).ok,false);
});
test('inverted or tiny spans do not produce a usable calibration and can be recaptured',()=>{
  const f=fixture();f.pose('center',10,-20);f.pose('back',9,-19);f.pose('forward',40,-60);
  assert.equal(f.input.status(f.now).calibrated,false);assert.equal(f.input.exportCalibration(f.now),null);
  f.pose('back',-10,0);assert.equal(f.input.status(f.now).calibrated,true);
  f.pose('center',50,-80);assert.equal(f.input.status(f.now).calibrated,false);
});
test('ports, modes and backwards source time invalidate old observations',()=>{
  for(const mutate of [v=>v.shellos.mode='simulation',v=>v.telemetry.port='COM7',v=>v.telemetry.sourceTime-=.1]){
    const f=fixture();f.calibrate();const v=report(f.now+10);mutate(v);
    const result=f.input.ingest(v,WALL+f.now+10,f.now+10);
    assert.equal(result.changed,true);assert.equal(f.input.status(f.now+10).calibrated,false);
  }
});
test('invalid, stale, missing and future measurements cannot drive or calibrate the game',()=>{
  const mutations=[v=>v.telemetry.angles.left=NaN,v=>v.telemetry.angularVelocity.right=null,
    v=>v.telemetry.fresh=false,v=>v.shellos.mode='unknown',v=>v.telemetry.frameAgeMs=-1,
    v=>v.checkedAt=new Date(WALL+2000).toISOString(),v=>v.telemetry.sourceTime+=10,
    v=>delete v.telemetry.port,v=>v.telemetry.frameAgeMs=201];
  for(const mutate of mutations){const v=report(100);mutate(v);assert.throws(()=>parseHandSample(v,WALL+100,100));}
  assert.throws(()=>parseHandSample(report(100),WALL+301,301));
  const f=fixture();f.calibrate();assert.equal(f.input.ingest({},WALL+f.now,f.now).ok,false);
  assert.equal(f.input.status(f.now).calibrated,false);assert.equal(f.input.axes(f.now,.05),null);
});
test('exports are detached observations with explicit no-output/no-motor-limit markers',()=>{
  const f=fixture();f.calibrate();const record=f.input.exportCalibration(f.now);
  assert.equal(record.hardwareOutput,false);assert.equal(record.motorLimits,false);assert.equal(record.source.mode,'hardware');
  record.poses.center.left=900;assert.equal(f.input.exportCalibration(f.now).poses.center.left,10);
  const preview=fixture();preview.pose('center',10,-20,'simulation');preview.pose('back',-10,0,'simulation');preview.pose('forward',40,-60,'simulation');
  assert.equal(preview.input.exportCalibration(preview.now).source.mode,'simulation');
});
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function readerFixture(){
  const calls=[],samples=[],errors=[],timers=new Map();let id=0,now=0;
  const reader=createHandReader({fetcher:(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject})),
    onSample:v=>samples.push(v),onError:v=>errors.push(v),clock:()=>now,
    schedule:(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;},cancel:key=>timers.delete(key)});
  async function advance(ms){now+=ms;for(const [key,timer]of [...timers])if(timer.at<=now){timers.delete(key);timer.fn();}await flush();}
  async function reply(value,call=calls.at(-1)){call.resolve({ok:true,json:async()=>value});await flush();}
  return {reader,calls,samples,errors,timers,advance,reply};
}
test('reader is opt-in, fixed GET-only, sequential and aborts all work on stop',async()=>{
  const f=readerFixture();assert.equal(f.calls.length,0);f.reader.start();
  assert.equal(f.calls[0].url,'/api/hands-telemetry');assert.equal(f.calls[0].options.method,'GET');
  await f.advance(300);assert.equal(f.calls.length,1);await f.reply({one:1});await f.advance(100);
  assert.equal(f.calls.length,2);f.reader.stop();assert.equal(f.calls[1].options.signal.aborted,true);assert.equal(f.timers.size,0);
  await f.reply({late:1});assert.deepEqual(f.samples,[{one:1}]);
});
test('cancelled and timed-out replies cannot replace a restarted session',async()=>{
  const f=readerFixture();f.reader.start();const old=f.calls[0];f.reader.start();const current=f.calls[1];
  await f.reply({old:true},old);assert.equal(f.samples.length,0);await f.reply({current:true},current);
  await f.advance(100);const hung=f.calls[2];await f.advance(1800);
  assert.equal(f.reader.running,false);assert.equal(hung.options.signal.aborted,true);assert.equal(f.errors.length,1);
  await f.reply({late:true},hung);assert.deepEqual(f.samples,[{current:true}]);assert.equal(f.timers.size,0);
});
