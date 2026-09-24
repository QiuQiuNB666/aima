import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHandSimulation } from './hands-core.js';

function configured() {
  const simulation = createHandSimulation();
  simulation.dispatch({ type: 'set-release', value: true });
  simulation.dispatch({ type: 'calibrate' });
  simulation.dispatch({ type: 'hold', value: true });
  return simulation;
}
function advance(simulation, seconds = 2) {
  for (let i = 0; i < Math.ceil(seconds / 0.05); i++) simulation.tick(0.05);
  return simulation.snapshot();
}
function ready() {
  const simulation = configured();
  simulation.dispatch({ type: 'raise' });
  advance(simulation);
  assert.equal(simulation.snapshot().stage, 'ready');
  return simulation;
}
function zeroFeedback(value) {
  assert.equal(value.feedbackLeft, 0); assert.equal(value.feedbackRight, 0);
  assert.equal(value.hardwareOutput, false);
}

test('initial state is inert, snapshots are detached, and all methods return the fixed simulation contract', () => {
  const simulation = createHandSimulation();
  const value = simulation.snapshot();
  assert.deepEqual(Object.keys(value).sort(), ['stage', 'released', 'calibrated', 'holding', 'raiseProgress', 'scene', 'damping',
    'left', 'right', 'feedbackLeft', 'feedbackRight', 'shots', 'shotsLeft', 'shotsRight', 'lastShot', 'excavator', 'hardwareOutput'].sort());
  assert.equal(value.stage, 'legs'); assert.equal(value.released, false); zeroFeedback(value);
  value.stage = 'ready'; value.hardwareOutput = true; value.excavator.boom = 100;
  assert.equal(simulation.snapshot().stage, 'legs'); assert.equal(simulation.snapshot().excavator.boom, 0.5);
  assert.equal(simulation.dispatch({ type: 'reset' }).hardwareOutput, false);
  assert.equal(simulation.tick(0.05).hardwareOutput, false);
});

test('release, calibration and grip are all required before a manually requested single lift', () => {
  const simulation = createHandSimulation();
  for (const action of [{ type: 'calibrate' }, { type: 'hold', value: true }, { type: 'raise' }, { type: 'fire' }]) simulation.dispatch(action);
  assert.equal(advance(simulation).stage, 'legs');
  simulation.dispatch({ type: 'set-release', value: true });
  simulation.dispatch({ type: 'hold', value: true }); simulation.dispatch({ type: 'raise' });
  assert.equal(advance(simulation).stage, 'released');
  simulation.dispatch({ type: 'calibrate' }); simulation.dispatch({ type: 'hold', value: false }); simulation.dispatch({ type: 'raise' });
  assert.equal(advance(simulation).raiseProgress, 0);
  simulation.dispatch({ type: 'hold', value: true });
  assert.equal(advance(simulation).raiseProgress, 0, 'Grip does not start a lift.');
  simulation.dispatch({ type: 'raise' }); assert.equal(simulation.snapshot().stage, 'raising');
  const raised = advance(simulation);
  assert.equal(raised.stage, 'ready'); assert.equal(raised.raiseProgress, 1);
  simulation.dispatch({ type: 'raise' });
  assert.equal(advance(simulation, 20).raiseProgress, 1);
  assert.equal(simulation.snapshot().left, 0); assert.equal(simulation.snapshot().right, 0);
  zeroFeedback(simulation.snapshot());
});

test('grip loss freezes an unfinished lift and reacquiring grip requires a new manual raise', () => {
  const simulation = configured(); simulation.dispatch({ type: 'raise' }); simulation.tick(0.05);
  const progress = simulation.snapshot().raiseProgress;
  const paused = simulation.dispatch({ type: 'hold', value: false });
  assert.equal(paused.stage, 'paused'); assert.equal(paused.holding, false); zeroFeedback(paused);
  simulation.dispatch({ type: 'hold', value: true });
  assert.equal(advance(simulation).raiseProgress, progress);
  assert.equal(simulation.snapshot().stage, 'paused');
  simulation.dispatch({ type: 'raise' });
  assert.equal(advance(simulation).stage, 'ready');
});

test('calibration neutralizes inputs and requires a new explicit lift', () => {
  const simulation = ready(); simulation.dispatch({ type: 'input', left: 0.6, right: -0.6 }); simulation.dispatch({ type: 'fire' });
  const value = simulation.dispatch({ type: 'calibrate' });
  assert.equal(value.stage, 'calibrated'); assert.equal(value.raiseProgress, 0);
  assert.equal(value.left, 0); assert.equal(value.right, 0); zeroFeedback(value);
  assert.equal(advance(simulation).raiseProgress, 0);
});

test('damping opposes virtual handle velocity on both sides and vanishes when stationary', () => {
  const simulation = ready(); simulation.dispatch({ type: 'damping', value: 0.7 });
  simulation.dispatch({ type: 'scene', value: 'excavator' });
  simulation.dispatch({ type: 'input', left: 0.2, right: -0.3 });
  let value = simulation.tick(0.05);
  assert.ok(value.feedbackLeft < 0); assert.ok(value.feedbackRight > 0);
  zeroFeedback(simulation.tick(0.05));
  simulation.dispatch({ type: 'input', left: -0.2, right: 0.3 });
  value = simulation.tick(0.05);
  assert.ok(value.feedbackLeft > 0); assert.ok(value.feedbackRight < 0);
  simulation.dispatch({ type: 'damping', value: 0 });
  simulation.dispatch({ type: 'input', left: 1, right: -1 });
  zeroFeedback(simulation.tick(0.05));
  simulation.dispatch({ type: 'damping', value: 1 });
  simulation.dispatch({ type: 'input', left: -1, right: 1 });
  value = simulation.tick(0.00001);
  assert.equal(value.feedbackLeft, 1); assert.equal(value.feedbackRight, -1);
  zeroFeedback(simulation.tick(0.05));
});

test('shots require ready grip and range scene, have cooldown, and return to zero without repeating', () => {
  const simulation = configured(); simulation.dispatch({ type: 'fire' });
  assert.equal(simulation.snapshot().shots, 0);
  simulation.dispatch({ type: 'raise' }); advance(simulation);
  let value = simulation.dispatch({ type: 'fire' });
  assert.equal(value.shots, 1); assert.ok(value.feedbackLeft < 0); assert.ok(value.feedbackRight < 0);
  simulation.dispatch({ type: 'fire' }); assert.equal(simulation.snapshot().shots, 1);
  advance(simulation, 0.25); zeroFeedback(simulation.snapshot());
  simulation.dispatch({ type: 'fire' }); assert.equal(simulation.snapshot().shots, 1);
  advance(simulation, 0.2); simulation.dispatch({ type: 'fire' }); assert.equal(simulation.snapshot().shots, 2);
  advance(simulation, 2); zeroFeedback(simulation.snapshot()); assert.equal(simulation.snapshot().shots, 2);
  simulation.dispatch({ type: 'scene', value: 'excavator' }); simulation.dispatch({ type: 'fire' });
  assert.equal(simulation.snapshot().shots, 2); zeroFeedback(simulation.snapshot());
});

test('each gun has an independent pulse and cooldown with detached game-only feedback metadata', () => {
  const simulation = ready();
  let value = simulation.dispatch({type:'fire',side:'left'});
  assert.equal(value.shotsLeft,1); assert.equal(value.shotsRight,0);
  assert.ok(value.feedbackLeft<0); assert.equal(value.feedbackRight,0);
  assert.deepEqual(value.lastShot.sides,['left']); assert.equal(value.lastShot.role,'hands');
  assert.equal(value.lastShot.unit,'normalized-preview');
  value.lastShot.sides.push('legs'); value.lastShot.strength=100;
  assert.deepEqual(simulation.snapshot().lastShot.sides,['left']);
  assert.equal(simulation.snapshot().lastShot.strength,.35);
  value=simulation.dispatch({type:'fire',side:'right'});
  assert.equal(value.shotsLeft,1); assert.equal(value.shotsRight,1);
  assert.ok(value.feedbackLeft<0); assert.ok(value.feedbackRight<0);
  simulation.dispatch({type:'fire',side:'left'}); assert.equal(simulation.snapshot().shotsLeft,1);
  advance(simulation,.5); zeroFeedback(simulation.snapshot());
  value=simulation.dispatch({type:'fire',side:'right'});
  assert.equal(value.feedbackLeft,0); assert.ok(value.feedbackRight<0);
  value=simulation.dispatch({type:'fire',side:'legs'}); assert.equal(value.stage,'paused'); zeroFeedback(value);
});

test('pushing a rod fires its own gun once, requires returning below the rearm threshold, and supports both rods', () => {
  const simulation=ready();
  simulation.dispatch({type:'input',left:.64,right:0}); assert.equal(simulation.snapshot().shots,0);
  simulation.dispatch({type:'input',left:.7,right:0});
  for(let i=0;i<30;i++){ simulation.tick(.05); simulation.dispatch({type:'input',left:.9,right:0}); }
  assert.equal(simulation.snapshot().shotsLeft,1); assert.equal(simulation.snapshot().shotsRight,0);
  simulation.dispatch({type:'input',left:.3,right:0}); simulation.dispatch({type:'input',left:.9,right:0});
  assert.equal(simulation.snapshot().shotsLeft,1);
  simulation.dispatch({type:'input',left:0,right:0}); simulation.dispatch({type:'input',left:1,right:1});
  assert.equal(simulation.snapshot().shotsLeft,2); assert.equal(simulation.snapshot().shotsRight,1);
  simulation.dispatch({type:'scene',value:'excavator'}); advance(simulation,.5);
  simulation.dispatch({type:'input',left:1,right:1}); assert.equal(simulation.snapshot().shotsRight,1);
});

test('grip loss and suspend instantly clear axes, damping and pulses without automatic recovery', () => {
  for (const action of [{ type: 'hold', value: false }, { type: 'suspend' }]) {
    const simulation = ready(); simulation.dispatch({ type: 'input', left: 0.8, right: -0.7 });
    simulation.tick(0.05); simulation.dispatch({ type: 'fire' });
    const paused = simulation.dispatch(action);
    assert.equal(paused.stage, 'paused'); assert.equal(paused.holding, false);
    assert.equal(paused.left, 0); assert.equal(paused.right, 0); zeroFeedback(paused);
    simulation.dispatch({ type: 'input', left: 1, right: 1 }); simulation.dispatch({ type: 'fire' });
    simulation.dispatch({ type: 'hold', value: true });
    assert.equal(advance(simulation).stage, 'paused'); zeroFeedback(simulation.snapshot());
    simulation.dispatch({ type: 'raise' }); assert.equal(simulation.snapshot().stage, 'ready');
    zeroFeedback(simulation.snapshot());
  }
});

test('scene changes discard feedback and axis residuals while excavator controls remain independent and bounded', () => {
  const simulation = ready(); simulation.dispatch({ type: 'fire' });
  let value = simulation.dispatch({ type: 'scene', value: 'excavator' }); zeroFeedback(value);
  simulation.dispatch({ type: 'input', left: 1, right: 0 }); advance(simulation, 4);
  assert.equal(simulation.snapshot().excavator.boom, 1); assert.equal(simulation.snapshot().excavator.bucket, 0.5);
  simulation.dispatch({ type: 'input', left: 0, right: -1 }); advance(simulation, 4);
  assert.equal(simulation.snapshot().excavator.boom, 1); assert.equal(simulation.snapshot().excavator.bucket, 0);
  simulation.dispatch({ type: 'input', left: -1, right: 1 }); advance(simulation, 8);
  assert.deepEqual(simulation.snapshot().excavator, { boom: 0, bucket: 1 });
  value = simulation.dispatch({ type: 'scene', value: 'range' });
  assert.equal(value.left, 0); assert.equal(value.right, 0); zeroFeedback(value);
  assert.deepEqual(advance(simulation).excavator, { boom: 0, bucket: 1 });
});

test('suspension freezes excavator motion until manual rearming and a new input', () => {
  const simulation = ready(); simulation.dispatch({ type: 'scene', value: 'excavator' });
  simulation.dispatch({ type: 'input', left: 1, right: -1 }); simulation.tick(0.05);
  const position = simulation.snapshot().excavator;
  simulation.dispatch({ type: 'suspend' });
  assert.deepEqual(advance(simulation, 4).excavator, position);
  simulation.dispatch({ type: 'hold', value: true });
  assert.deepEqual(advance(simulation).excavator, position);
  simulation.dispatch({ type: 'raise' });
  assert.deepEqual(advance(simulation).excavator, position, 'Old handle input cannot resume motion.');
  simulation.dispatch({ type: 'input', left: -1, right: 1 });
  const resumed = simulation.tick(0.05);
  assert.ok(resumed.excavator.boom < position.boom); assert.ok(resumed.excavator.bucket > position.bucket);
});

test('re-attaching legs and reset clear calibration, grip, axes, pulses and all accumulated motion', () => {
  for (const action of [{ type: 'set-release', value: false }, { type: 'reset' }]) {
    const simulation = ready(); simulation.dispatch({ type: 'fire' }); simulation.dispatch({ type: 'scene', value: 'excavator' });
    simulation.dispatch({ type: 'input', left: 1, right: 1 }); advance(simulation);
    const value = simulation.dispatch(action);
    assert.equal(value.stage, 'legs'); assert.equal(value.released, false); assert.equal(value.calibrated, false); assert.equal(value.holding, false);
    assert.equal(value.raiseProgress, 0); assert.equal(value.left, 0); assert.equal(value.right, 0); assert.equal(value.shots, 0);
    assert.deepEqual(value.excavator, { boom: 0.5, bucket: 0.5 }); zeroFeedback(value);
    assert.equal(advance(simulation).stage, 'legs');
  }
  const simulation = ready(); simulation.dispatch({ type: 'damping', value: 1 }); simulation.dispatch({ type: 'scene', value: 'excavator' });
  assert.deepEqual(simulation.dispatch({ type: 'reset' }), createHandSimulation().snapshot());
});

test('short frames clip to 50ms, while a stalled page pauses instead of resuming old input', () => {
  const simulation = configured(); simulation.dispatch({ type: 'raise' });
  const initial = simulation.snapshot(); assert.deepEqual(simulation.tick(-5), initial);
  const moved = simulation.tick(0.1); assert.ok(moved.raiseProgress > 0 && moved.raiseProgress < 0.05);
  const comparison = configured(); comparison.dispatch({ type: 'raise' });
  assert.deepEqual(moved, comparison.tick(0.05));
  const excavator = ready(); excavator.dispatch({ type: 'scene', value: 'excavator' }); excavator.dispatch({ type: 'input', left: 1, right: 1 });
  const frozen = excavator.snapshot().excavator;
  assert.equal(excavator.tick(3600).stage, 'paused');
  assert.deepEqual(excavator.snapshot().excavator, frozen);
  assert.equal(excavator.snapshot().holding, false); zeroFeedback(excavator.snapshot());
  const lifting = configured(); lifting.dispatch({type:'raise'});
  assert.equal(lifting.tick(0.251).stage, 'paused');
  assert.equal(lifting.snapshot().raiseProgress, 0);
  for (const invalid of [NaN, Infinity, -Infinity, '0.05', undefined, null]) {
    const active = ready(); active.dispatch({ type: 'fire' });
    const stopped = active.tick(invalid); assert.equal(stopped.stage, 'paused'); assert.equal(stopped.holding, false); zeroFeedback(stopped);
  }
});

test('invalid actions, nonfinite measurements and out-of-range values fail closed', () => {
  const invalidActions = [null, [], 'fire', {}, { type: 'unknown' }, { type: 'input', left: NaN, right: 0 },
    { type: 'input', left: 0, right: Infinity }, { type: 'input', left: 1.01, right: 0 }, { type: 'input', left: -1.01, right: 0 },
    { type: 'input', left: '1', right: 0 }, { type: 'input', left: 0 }, { type: 'damping', value: NaN },
    { type: 'damping', value: -0.1 }, { type: 'damping', value: 1.1 }, { type: 'scene', value: 'hardware' },
    { type: 'hold', value: 1 }, { type: 'set-release', value: 'true' }, { type: 'fire', hardwareOutput: true },
    Object.defineProperty({}, 'type', { get() { throw new Error('bad getter'); } }),
  ];
  for (const action of invalidActions) {
    const simulation = ready(); simulation.dispatch({ type: 'fire' });
    const value = simulation.dispatch(action);
    assert.equal(value.stage, 'paused'); assert.equal(value.holding, false);
    assert.equal(value.left, 0); assert.equal(value.right, 0); zeroFeedback(value);
    assert.equal(advance(simulation).stage, 'paused');
  }
});

test('simulation source contains no imports, network, serial or command output path', async () => {
  const source = await readFile(new URL('./hands-core.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:import|fetch|XMLHttpRequest|WebSocket|SerialPort|navigator|child_process|execFile|require)\b/);
  assert.doesNotMatch(source, /https?:\/\/|\/api\/|\/state|N·m|\bNm\b/);
  assert.match(source, /hardwareOutput: false/);
});
