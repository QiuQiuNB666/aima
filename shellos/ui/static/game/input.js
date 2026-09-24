// 键盘：模拟模式按住空格走、1/2/3 慢/中/快；R = 回山脚（演示复位，真机也可用）；V = 换视角（跟拍 → 正面看脸 → 侧面）；M = 回选山页。
// 操作方式（/state 的 input.mode，hud.js 每拍写进 window.__inputMode；?input=keyboard|pad 进页面时 POST /input 切过去）：
//   exo      外骨骼：什么都不改，走路靠腿（模拟模式才用空格 /sim）
//   keyboard 按住 ↑ / W / 空格 = 120 步/分匀速（每 0.5 s POST /drive 1 步），单按一下 = 1 步
//   pad      浏览器 Gamepad：左摇杆向前 = 匀速，十字键上 = 单步（ShellOS 自己读的手柄不经过这里）
const CAMS = ['follow', 'front', 'side'];
const Q = new URLSearchParams(location.search);
window.__camMode = CAMS.includes(Q.get('cam')) ? Q.get('cam') : 'follow';
export const CADENCE = { Digit1: 80, Digit2: 105, Digit3: 130 };
export const MODES = { exo: '外骨骼', keyboard: '键盘', pad: '手柄' };
const STEP_MS = 500;                                   // 120 步/分
const GO = ['Space', 'ArrowUp', 'KeyW'];
export function bindInput(post, isSim) {
  const mode = () => window.__inputMode || 'exo';
  if (MODES[Q.get('input')]) { window.__inputMode = Q.get('input'); post('/input', { mode: Q.get('input') }); }
  let walking = false, holdT = null;
  const walk = on => { if (on === walking || !isSim()) return; walking = on; post('/sim', { walk: on }); };
  const drive = () => post('/drive', { steps: 1 });
  const hold = on => {                                 // 按下先走 1 步，按住每 0.5 s 再走 1 步；松开停
    if (on && !holdT) { drive(); holdT = setInterval(drive, STEP_MS); }
    else if (!on && holdT) { clearInterval(holdT); holdT = null; }
  };
  addEventListener('keydown', e => {
    if (GO.includes(e.code) && mode() === 'keyboard') { e.preventDefault(); if (!e.repeat) hold(true); }
    else if (e.code === 'Space') { e.preventDefault(); walk(true); }
    else if (CADENCE[e.code] && isSim() && !e.repeat) post('/sim', { cadence: CADENCE[e.code] });
    else if (e.code === 'KeyR' && !e.repeat && !e.metaKey && !e.ctrlKey) post('/demo/reset', {});
    else if (e.code === 'KeyM' && !e.repeat && !e.metaKey && !e.ctrlKey) location.href = '/worlds';   // M = 换一座山
    else if (e.code === 'KeyV' && !e.repeat && !e.metaKey && !e.ctrlKey) window.__camMode = CAMS[(CAMS.indexOf(window.__camMode) + 1) % CAMS.length];
  });
  addEventListener('keyup', e => { if (GO.includes(e.code)) hold(false); if (e.code === 'Space') walk(false); });
  addEventListener('blur', () => { walk(false); hold(false); });
  let padUp = false;
  setInterval(() => {                                  // 手柄模式：50 ms 轮询（照抄 parkour/main.js 的只读用法）
    if (mode() !== 'pad') return;
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(p => p && p.connected) : null;
    if (!gp) { hold(false); return; }
    const b = i => !!(gp.buttons[i] && gp.buttons[i].pressed), up = b(12);
    hold((gp.axes[1] || 0) < -0.5);   // 不用 ×：ShellOS 自己读的手柄里 × 是急停
    if (up && !padUp) drive();
    padUp = up;
  }, 50);
}
