import test from 'node:test';
import assert from 'node:assert/strict';
import { ProgressGate, sceneFor } from '../state.mjs';
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
