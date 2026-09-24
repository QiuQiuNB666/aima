import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameTutorial} from './tutorial-core.js';
import {createHandSimulation} from './hands-core.js';
const state=(scene='range')=>({scene,stage:'ready',holding:true,left:0,right:0,shotsLeft:0,shotsRight:0,excavator:{boom:.5,bucket:.5}});

test('range teaches independent left, right and an explicit operator pause in sequence',()=>{
  const tutorial=createGameTutorial(),s=state();assert.equal(tutorial.enter(),false);
  s.shotsRight++;tutorial.observe(s);assert.equal(tutorial.snapshot().index,0);
  s.shotsLeft++;tutorial.observe(s);assert.equal(tutorial.snapshot().index,1);
  tutorial.observe(s);assert.equal(tutorial.snapshot().index,1);
  s.shotsRight++;tutorial.observe(s);assert.equal(tutorial.snapshot().index,2);
  s.stage='paused';s.holding=false;tutorial.observe(s);assert.equal(tutorial.snapshot().index,2,'Blur or safety pause is not the operator exercise');
  tutorial.observe(s,true);assert.equal(tutorial.snapshot().phase,'complete');
  assert.equal(tutorial.enter(),true);assert.equal(tutorial.snapshot().phase,'play');assert.equal(tutorial.snapshot().hardwareOutput,false);
});

test('excavator requires boom then bucket with opposite rod neutral, not gun events',()=>{
  const tutorial=createGameTutorial('excavator'),s=state('excavator');
  s.shotsLeft=10;tutorial.observe(s);assert.equal(tutorial.snapshot().index,0);
  s.excavator.boom=.54;s.right=.5;tutorial.observe(s);assert.equal(tutorial.snapshot().index,0);
  s.right=0;tutorial.observe(s);assert.equal(tutorial.snapshot().index,1);
  s.excavator.bucket=.54;s.left=.5;tutorial.observe(s);assert.equal(tutorial.snapshot().index,1);
  s.left=0;tutorial.observe(s);assert.equal(tutorial.snapshot().index,2);
  s.stage='paused';s.holding=false;tutorial.observe(s,true);assert.equal(tutorial.enter(),true);
});

test('tutorial reset and scene mismatch never reuse another game’s completion',()=>{
  const tutorial=createGameTutorial(),s=state('excavator');s.shotsLeft=10;tutorial.observe(s);assert.equal(tutorial.snapshot().index,0);
  tutorial.reset('excavator',s);assert.equal(tutorial.snapshot().phase,'learning');assert.equal(tutorial.snapshot().index,0);
  const copy=tutorial.snapshot();copy.steps[0].title='changed';assert.notEqual(tutorial.snapshot().steps[0].title,'changed');
  assert.throws(()=>tutorial.reset('unknown'));
});

test('new round clears teaching scores and motion, keeps calibration, and requires explicit re-positioning',()=>{
  const sim=createHandSimulation();
  for(const action of [{type:'set-release',value:true},{type:'calibrate'},{type:'hold',value:true},{type:'raise'}])sim.dispatch(action);
  for(let i=0;i<26;i++)sim.tick(.05);
  sim.dispatch({type:'fire',side:'left'});sim.dispatch({type:'scene',value:'excavator'});sim.dispatch({type:'input',left:1,right:1});sim.tick(.05);
  assert.equal(sim.snapshot().shotsLeft,1);assert.ok(sim.snapshot().excavator.boom>.5);
  const clean=sim.dispatch({type:'new-round'});
  assert.equal(clean.stage,'paused');assert.equal(clean.holding,false);assert.equal(clean.left,0);
  assert.equal(clean.calibrated,true);assert.equal(clean.shotsLeft,0);assert.equal(clean.excavator.boom,.5);assert.equal(clean.hardwareOutput,false);
});
