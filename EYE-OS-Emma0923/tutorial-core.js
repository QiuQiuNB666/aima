// Per-game learning progress. Completion never grants a hardware permission.
export const GAME_TUTORIALS = Object.freeze({
  range: {title:'脉冲靶场',steps:[
    {side:'left',title:'试一次左侧攻击',hint:'前推左操作杆，或按 F / 左枪按钮。右侧先保持中位。'},
    {side:'right',title:'试一次右侧攻击',hint:'左侧回中，再前推右操作杆，或按 H / 右枪按钮。'},
    {side:'pause',title:'练习主动暂停',hint:'按 Esc 或点击「暂停模拟」，确认画面动作停下。'},
  ]},
  excavator: {title:'挖掘机',steps:[
    {side:'left',title:'左杆升降动臂',hint:'只推拉左操作杆（A / D 或滑杆），观察动臂移动；右杆保持中位。'},
    {side:'right',title:'右杆收放铲斗',hint:'左杆回中，只推拉右操作杆（J / L 或滑杆），观察铲斗移动。'},
    {side:'pause',title:'练习主动暂停',hint:'按 Esc 或点击「暂停模拟」，确认挖掘机停下。'},
  ]},
});
export function createGameTutorial(initial='range') {
  let scene, index, phase, base;
  function reset(next=scene, state) {
    if (!Object.hasOwn(GAME_TUTORIALS,next)) throw new Error('Unknown tutorial scene');
    scene=next;index=0;phase='learning';
    base={shotsLeft:state?.shotsLeft ?? 0,shotsRight:state?.shotsRight ?? 0,
      boom:state?.excavator?.boom ?? .5,bucket:state?.excavator?.bucket ?? .5};
  }
  reset(initial);
  function observe(state, operatorPause=false) {
    if (phase !== 'learning' || state.scene !== scene) return;
    let passed=false;
    if (index === 2) passed=operatorPause === true && state.stage === 'paused' && state.left === 0 && state.right === 0;
    else if (state.stage === 'ready' && state.holding) {
      if (scene === 'range') passed=index === 0 ? state.shotsLeft > base.shotsLeft && state.shotsRight === base.shotsRight
        : state.shotsRight > base.shotsRight && Math.abs(state.left) <= .1;
      else passed=index === 0 ? Math.abs(state.excavator.boom-base.boom) >= .03 && Math.abs(state.right) <= .1
        : Math.abs(state.excavator.bucket-base.bucket) >= .03 && Math.abs(state.left) <= .1;
    }
    if (passed) {
      index++;base={shotsLeft:state.shotsLeft,shotsRight:state.shotsRight,boom:state.excavator.boom,bucket:state.excavator.bucket};
      if (index === 3) phase='complete';
    } else if (scene === 'range' && index === 0 && state.shotsRight > base.shotsRight) {
      // A wrong-side or simultaneous first shot must not trap the learner.
      base.shotsLeft=state.shotsLeft; base.shotsRight=state.shotsRight;
    }
  }
  function enter() { if (phase !== 'complete') return false; phase='play';return true; }
  function snapshot() { return {scene,index,phase,...GAME_TUTORIALS[scene],steps:GAME_TUTORIALS[scene].steps.map(step=>({...step})),hardwareOutput:false}; }
  return {reset,observe,enter,snapshot};
}
