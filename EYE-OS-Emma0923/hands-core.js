// Pure, in-memory hand interaction preview. No sensors, motor commands or I/O.
// Every axis, damping value and feedback pulse is unitless visual simulation.
// These animation constants are not physical force, torque or hardware limits.
const MAX_DT = 0.05;
const LIFT_DURATION = 1.2;
const PULSE_DURATION = 0.18;
const FIRE_COOLDOWN = 0.4;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const inRange = (value, low, high) => finite(value) && value >= low && value <= high;
const ACTION_KEYS = {
  'set-release': ['type', 'value'], calibrate: ['type'], hold: ['type', 'value'],
  raise: ['type'], input: ['type', 'left', 'right'], scene: ['type', 'value'],
  damping: ['type', 'value'], fire: ['type', 'side'], reset: ['type'], suspend: ['type'], 'new-round':['type'],
};

export function createHandSimulation() {
  let state;
  let sampledLeft = 0, sampledRight = 0;
  let pulseRemaining, cooldown, triggerArmed;

  function reset() {
    state = {
      stage: 'legs', released: false, calibrated: false, holding: false,
      raiseProgress: 0, scene: 'range', damping: 0.4,
      left: 0, right: 0, feedbackLeft: 0, feedbackRight: 0, shots: 0,
      shotsLeft: 0, shotsRight: 0, lastShot: null,
      excavator: { boom: 0.5, bucket: 0.5 },
    };
    sampledLeft = 0; sampledRight = 0;
    pulseRemaining = { left:0, right:0 }; cooldown = { left:0, right:0 }; triggerArmed = { left:true, right:true };
  }
  reset();

  function snapshot() {
    return { ...state, lastShot:state.lastShot ? { ...state.lastShot, sides:[...state.lastShot.sides] } : null,
      excavator: { ...state.excavator }, hardwareOutput: false };
  }
  function clearFeedback() {
    pulseRemaining.left = pulseRemaining.right = 0;
    state.feedbackLeft = 0; state.feedbackRight = 0;
  }
  function neutralize() {
    clearFeedback();
    state.left = 0; state.right = 0; sampledLeft = 0; sampledRight = 0;
    triggerArmed.left = triggerArmed.right = true;
  }
  function suspend() {
    state.holding = false;
    neutralize();
    state.stage = !state.released ? 'legs' : state.calibrated ? 'paused' : 'released';
    // The visual lift position freezes. Holding again cannot resume a lift;
    // a new explicit raise action is required, even if already fully raised.
  }
  function ready() {
    return state.released && state.calibrated && state.holding && state.stage === 'ready';
  }
  function feedback(velocityLeft, velocityRight) {
    // Oppose only virtual axis velocity. A stationary handle has no damping.
    const leftDamping = clamp(-state.damping * velocityLeft * 0.08, -1, 1);
    const rightDamping = clamp(-state.damping * velocityRight * 0.08, -1, 1);
    // A shot is a separate, short visual cue, not a claim of passive damping.
    const pulse = side => state.scene === 'range' ? -0.35 * (pulseRemaining[side] / PULSE_DURATION) : 0;
    state.feedbackLeft = clamp(leftDamping + pulse('left'), -1, 1) || 0;
    state.feedbackRight = clamp(rightDamping + pulse('right'), -1, 1) || 0;
  }
  function deny() { clearFeedback(); }
  function fire(side) {
    if (!ready() || state.scene !== 'range') return;
    const sides = (side === 'both' ? ['left','right'] : [side]).filter(item => cooldown[item] <= 0);
    if (!sides.length) return;
    for (const item of sides) {
      state[item === 'left' ? 'shotsLeft' : 'shotsRight']++;
      pulseRemaining[item] = PULSE_DURATION; cooldown[item] = FIRE_COOLDOWN;
    }
    state.shots++;
    // Game feedback intent only. A future local hand-device adapter must own
    // validated control limits; these unitless cues are never motor commands.
    state.lastShot = { id:state.shots, role:'hands', sides, kind:'game-pulse',
      strength:0.35, durationMs:PULSE_DURATION*1000, unit:'normalized-preview' };
    feedback(0,0);
  }

  function dispatch(action) {
    try {
      if (!action || typeof action !== 'object' || Array.isArray(action)
        || !Object.hasOwn(ACTION_KEYS, action.type)
        || Object.keys(action).some(key => !ACTION_KEYS[action.type].includes(key))) {
        suspend(); return snapshot();
      }
      switch (action.type) {
        case 'set-release':
          if (typeof action.value !== 'boolean') { suspend(); break; }
          if (action.value === state.released) break;
          if (!action.value) {
            const scene = state.scene, damping = state.damping;
            reset(); state.scene = scene; state.damping = damping;
          } else {
            state.released = true; state.stage = 'released'; neutralize();
          }
          break;
        case 'calibrate':
          if (!state.released) { deny(); break; }
          neutralize(); state.calibrated = true; state.raiseProgress = 0;
          state.stage = 'calibrated';
          break;
        case 'hold':
          if (typeof action.value !== 'boolean') { suspend(); break; }
          if (!action.value) { suspend(); break; }
          if (!state.released) { deny(); break; }
          state.holding = true;
          break;
        case 'raise':
          if (!state.released || !state.calibrated || !state.holding) { deny(); break; }
          if (state.stage === 'raising' || state.stage === 'ready') break;
          neutralize(); state.stage = state.raiseProgress < 1 ? 'raising' : 'ready';
          break;
        case 'input':
          if (!inRange(action.left, -1, 1) || !inRange(action.right, -1, 1)) { suspend(); break; }
          if (!ready()) { neutralize(); break; }
          state.left = action.left; state.right = action.right;
          for (const side of ['left','right']) {
            if (state[side] <= 0.2) triggerArmed[side] = true;
            if (state[side] >= 0.65 && triggerArmed[side] && state.scene === 'range') {
              triggerArmed[side] = false; fire(side);
            }
          }
          feedback(0, 0);
          break;
        case 'scene':
          if (!['range', 'excavator'].includes(action.value)) { suspend(); break; }
          state.scene = action.value; neutralize();
          break;
        case 'damping':
          if (!inRange(action.value, 0, 1)) { suspend(); break; }
          state.damping = action.value;
          clearFeedback();
          break;
        case 'fire':
          if (action.side !== undefined && !['left','right','both'].includes(action.side)) { suspend(); break; }
          fire(action.side || 'both');
          break;
        case 'reset': reset(); break;
        case 'new-round':
          suspend();state.shots=state.shotsLeft=state.shotsRight=0;state.lastShot=null;
          state.excavator={boom:.5,bucket:.5};cooldown.left=cooldown.right=0;
          break;
        case 'suspend': suspend(); break;
      }
    } catch {
      // Malformed objects/getters must not leave a previous active cue running.
      suspend();
    }
    return snapshot();
  }

  function tick(dtSeconds) {
    // A stalled foreground tab must not resume an old held input after waking.
    if (!finite(dtSeconds) || dtSeconds > 0.25) { suspend(); return snapshot(); }
    const dt = clamp(dtSeconds, 0, MAX_DT);
    for (const side of ['left','right']) cooldown[side] = Math.max(0, cooldown[side] - dt);
    if (!state.released || !state.calibrated || !state.holding) {
      neutralize(); return snapshot();
    }
    if (state.stage === 'raising') {
      state.raiseProgress = Math.min(1, state.raiseProgress + dt / LIFT_DURATION);
      if (state.raiseProgress >= 1 - Number.EPSILON * 8) {
        state.raiseProgress = 1; state.stage = 'ready';
      }
      neutralize();
      return snapshot();
    }
    if (!ready()) { neutralize(); return snapshot(); }

    for (const side of ['left','right']) pulseRemaining[side] = Math.max(0, pulseRemaining[side] - dt);
    const velocityLeft = dt > 0 ? (state.left - sampledLeft) / dt : 0;
    const velocityRight = dt > 0 ? (state.right - sampledRight) / dt : 0;
    feedback(velocityLeft, velocityRight);
    if (dt > 0) { sampledLeft = state.left; sampledRight = state.right; }
    if (state.scene === 'excavator') {
      state.excavator.boom = clamp(state.excavator.boom + state.left * dt * 0.45, 0, 1);
      state.excavator.bucket = clamp(state.excavator.bucket + state.right * dt * 0.45, 0, 1);
    }
    return snapshot();
  }

  return { dispatch, tick, snapshot };
}
