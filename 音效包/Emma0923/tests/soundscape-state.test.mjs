import test from 'node:test';
import assert from 'node:assert/strict';
import { ProgressGate, sceneFor, mixFor } from '../state.mjs';
const state = (t,pos=0,laps=0,extra={}) => ({t,gait:{moving:true},terrain:{
  preset:'test-generated-id',pos,laps,total:40,segment:'flat',
  world:{theme:{style:'night_to_dawn'}},...extra}});
test('first packet does not replay; accepted next step plays once',()=>{
  const g=new ProgressGate();
  assert.equal(g.accept(state(10,20),0).step,false);
  assert.equal(g.accept(state(11,21),100).step,true);
  assert.equal(g.accept(state(11,21),120).step,false);
  assert.equal(g.accept(state(10,20),150).step,false);
  assert.equal(g.accept(state(12,22),200).step,true);
});
test('reconnect, jumps, reset and world changes never create catch-up footsteps',()=>{
  const g=new ProgressGate();g.accept(state(1,0),0);
  assert.equal(g.accept(state(2,1),2000).step,false);
  assert.equal(g.accept(state(3,10),2100).step,false);
  assert.equal(g.accept(state(4,0),2200).step,false);
  assert.equal(g.accept(state(5,1,0,{preset:'other'}),2300).step,false);
});
test('lap wrap emits one arrival; no replay at startup',()=>{
  const g=new ProgressGate();g.accept(state(1,39),0);
  const r=g.accept(state(2,0,1),100);assert.equal(r.arrive,true);assert.equal(r.step,true);
  assert.equal(new ProgressGate().accept(state(2,0,1),100).arrive,false);
});
test('red light, stopped gait and malformed packets suppress footsteps',()=>{
  const g=new ProgressGate();g.accept(state(1),0);
  assert.equal(g.accept(state(2,1,0,{segment:'wait'}),100).step,false);
  const s=state(3,2);s.gait.moving=false;assert.equal(g.accept(s,200).step,false);
  assert.equal(g.accept(state(4,NaN),300).valid,false);
  assert.equal(g.accept(state(5,40),400).valid,false);
  assert.equal(g.accept(state(6,3),500).step,false);
});
test('theme style drives generated worlds, unknown styles use silent grid',()=>{
  assert.equal(sceneFor(state(1).terrain),'night_to_dawn');
  assert.equal(sceneFor({world:{theme:{style:'unregistered'}}}),'grid');
  const g=new ProgressGate();g.accept(state(1),0);
  assert.equal(g.accept(state(2,1,0,{segment:'stairs_up'}),100).material,'stone');
});
test('Everest camp, glacier and knife ridge choose distinct loop files',()=>{
  assert.equal(mixFor({label:'珠峰大本营'},'snow_summit').file,'everest_camp.wav');
  assert.equal(mixFor({label:'东绒布冰川'},'snow_summit').file,'everest_glacier.wav');
  assert.equal(mixFor({label:'大风口·刀脊'},'snow_summit').file,'everest_ridge.wav');
  assert.equal(mixFor({label:'顶峰雪坡'},'snow_summit').gain,.55);
});
test('surface overrides generic stairs, wait segments never request steps',()=>{
  for(const [label,kind,want] of [['北坳冰壁','stairs_up','ice'],['第二台阶·中国梯','stairs_up','metal'],
    ['北坳裂缝·横梯','flat','metal'],['北壁横切·贴壁栈道','up','stone']]){
    assert.equal(mixFor({label,segment:kind},'snow_summit').material,want);
  }
  assert.equal(mixFor({label:'长空栈道'},'cliff_path').material,'wood');
  assert.equal(mixFor({label:'鹞子翻身',segment:'stairs_up'},'cliff_path').material,'metal');
  assert.equal(mixFor({label:'第二台阶·排队上梯',segment:'wait'},'snow_summit').stepAllowed,false);
});
test('live progress chooses correct metal step and suppresses queue footsteps',()=>{
  const g=new ProgressGate(),world={theme:{style:'snow_summit'}};
  g.accept(state(1,28,0,{world}),0);
  assert.equal(g.accept(state(2,29,0,{world,label:'北坳裂缝·横梯'}),100).material,'metal');
  assert.equal(g.accept(state(3,30,0,{world,label:'第二台阶·排队上梯',segment:'wait'}),200).step,false);
});
test('committed map equals the runtime resolver for every segment',async()=>{
  const {readFile}=await import('node:fs/promises');
  const map=JSON.parse(await readFile(new URL('../SCENE-MAP.json',import.meta.url),'utf8'));
  for(const w of map.routes) for(const s of w.segments){
    const mix=mixFor({label:s.label,segment:s.kind,pos:s.start,total:w.total},w.theme);
    assert.equal('assets/'+mix.file,s.ambience);
    assert.equal(mix.gain,s.ambienceGain);
    assert.equal(mix.stepAllowed?'assets/step_'+mix.material+'.wav':null,s.footstep);
  }
});
