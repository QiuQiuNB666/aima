// 键盘：模拟模式按住空格走、1/2/3 慢/中/快；R = 回山脚（演示复位，真机也可用）；V = 换视角（跟拍 → 正面看脸 → 侧面）；M = 回选山页。只发 /sim 和 /demo/reset。
const CAMS = ['follow', 'front', 'side'];
window.__camMode = CAMS.includes(new URLSearchParams(location.search).get('cam')) ? new URLSearchParams(location.search).get('cam') : 'follow';
export const CADENCE = { Digit1: 80, Digit2: 105, Digit3: 130 };
export function bindInput(post, isSim) {
  let walking = false;
  const walk = on => { if (on === walking || !isSim()) return; walking = on; post('/sim', { walk: on }); };
  addEventListener('keydown', e => {
    if (e.code === 'Space') { e.preventDefault(); walk(true); }
    else if (CADENCE[e.code] && isSim() && !e.repeat) post('/sim', { cadence: CADENCE[e.code] });
    else if (e.code === 'KeyR' && !e.repeat && !e.metaKey && !e.ctrlKey) post('/demo/reset', {});
    else if (e.code === 'KeyM' && !e.repeat && !e.metaKey && !e.ctrlKey) location.href = '/worlds';   // M = 换一座山
    else if (e.code === 'KeyV' && !e.repeat && !e.metaKey && !e.ctrlKey) window.__camMode = CAMS[(CAMS.indexOf(window.__camMode) + 1) % CAMS.length];
  });
  addEventListener('keyup', e => { if (e.code === 'Space') walk(false); });
  addEventListener('blur', () => walk(false));
}
