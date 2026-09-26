import { chooseScreen, screenKey, placementFeatures, normalizeScene, safeInset } from './display-core.js';

const $ = id => document.getElementById(id);
let details = null, preferred = '', target = null, output = null, boundScreen = null;
let stream = null, captureGeneration = 0, capturePending = false, ready = false;
let scene = normalizeScene(), inset = 4, nativeBusy = false, permission = null;
let nativeState = null, viewport = '', lastChoice = 'no-external';
let authorizationGeneration = 0;
let lastNativeCheck = 0;
const outputName = `eye-output-${crypto.randomUUID()}`;
const listeners = new Set();
function status(text) { $('display-status').textContent = text; }
function liveOutput() { return output && !output.closed; }
function send(type, data = {}) {
  if (!liveOutput()) return;
  try { output.postMessage({ protocol: 'eye-display-v1', type, ...data }, location.origin); } catch { /* Receiver is closing. */ }
}
function updateButtons() {
  $('display-share').disabled = !ready || !liveOutput() || capturePending || !navigator.mediaDevices?.getDisplayMedia;
  $('display-stop').disabled = !stream && !capturePending;
  $('display-close').disabled = !liveOutput();
  $('display-open').textContent = liveOutput() ? '查看输出窗口' : target ? '打开眼镜 / 外接屏画面' : '打开本机预览';
  // An ambiguous or removed explicit target requires a deliberate selection.
  $('display-open').disabled = !!details && ['ambiguous', 'selection-lost'].includes(lastChoice);
  $('display-live').textContent = stream ? '正在共享 · 本机传送' : capturePending ? '等待选择游戏窗口' : ready ? (viewport || '输出窗口已就绪') : '尚未打开画面';
}
function stopCapture(message) {
  ++captureGeneration; capturePending = false;
  stream?.getTracks().forEach(track => track.stop()); stream = null;
  // Clear synchronously. A queued postMessage stop could erase a new stream
  // installed later in this same turn (including a capture replacement).
  if (liveOutput()) { try { output.eyeDisplayReceiver?.clearStream(); } catch { /* Tracks are already stopped. */ } }
  if (message) status(message); updateButtons();
}
function closeOutput(message) {
  stopCapture();
  if (liveOutput()) { try { output.close(); } catch { /* Browser controls closing. */ } }
  output = null; ready = false; boundScreen = null; viewport = '';
  if (message) status(message); updateButtons();
}
function label(screen, index) {
  return `${screen.label || `屏幕 ${index + 1}`} · ${screen.width} × ${screen.height}${screen.isInternal === true ? ' · 内置' : screen.isInternal === false ? ' · 外接' : ' · 类型未知'}${screen.isPrimary ? ' · 主屏' : ''}`;
}
function positionOutput() {
  if (!liveOutput() || !boundScreen || !details?.screens.includes(boundScreen)) return;
  // Use browser CSS coordinates only. OS/native pixel dimensions are diagnostic.
  try {
    if (!output.document.fullscreenElement) {
      output.moveTo(boundScreen.availLeft, boundScreen.availTop);
      output.resizeTo(boundScreen.availWidth, boundScreen.availHeight);
    }
  } catch { status('浏览器未允许移动窗口，请手动移至目标屏幕。'); }
}
function renderScreens() {
  const screens = details ? [...details.screens] : [];
  // Any loss of the actual target ends sharing instead of choosing another screen.
  if (boundScreen && !screens.includes(boundScreen)) closeOutput('目标屏幕已断开，画面共享已停止。重新连接后请再次打开。');
  const choice = chooseScreen(screens, preferred); target = choice.target; lastChoice = choice.reason;
  const select = $('display-target'); select.replaceChildren();
  select.add(new Option('自动选择唯一外接屏', ''));
  screens.forEach((screen, index) => select.add(new Option(label(screen, index), screenKey(screen))));
  if (preferred && !screens.some(s => screenKey(s) === preferred)) select.add(new Option('上次选择的屏幕已断开', preferred));
  select.value = preferred; select.disabled = !details;
  if (details) {
    const text = target ? `已选择：${label(target, screens.indexOf(target))}。以通用 2D 模式适配。`
      : choice.reason === 'ambiguous' ? '发现多个外接屏，请选择本次要使用的眼镜或电视。'
      : choice.reason === 'selection-lost' ? '所选屏幕已断开。重新接入或选择新的目标后再打开。'
      : '未发现独立外接屏。镜像模式可能仍在显示同一画面，可使用本机预览。';
    $('display-detection').textContent = text;
    $('display-mode').textContent = target ? '外接屏 · 自动布局' : '本机 / 镜像预览';
  } else {
    const count = nativeState?.available ? nativeState.displays.length : null;
    $('display-detection').textContent = count === null ? '屏幕信息未授权。连接视频线或系统投屏后，可授权自动识别。'
      : `Windows 当前有 ${count} 个桌面显示区域。授权浏览器后才能选择和放置输出窗口。`;
    $('display-mode').textContent = '等待显示授权';
  }
  screens.forEach(screen => { if (!listeners.has(screen)) { screen.addEventListener('change', screenChanged); listeners.add(screen); } });
  for (const screen of listeners) if (!screens.includes(screen)) { screen.removeEventListener('change', screenChanged); listeners.delete(screen); }
  positionOutput(); updateButtons();
}
function screenChanged() { renderScreens(); }
function releaseDetails() {
  details?.removeEventListener('screenschange', screenChanged);
  for (const screen of listeners) screen.removeEventListener('change', screenChanged);
  listeners.clear(); details = null; target = null; preferred = '';
}
async function rememberPermission() {
  if (!navigator.permissions?.query) return null;
  try {
    permission = await navigator.permissions.query({ name: 'window-management' });
    permission.onchange = () => {
      if (permission.state !== 'granted') {
        ++authorizationGeneration;
        closeOutput('显示授权已撤销，画面共享已停止。'); releaseDetails(); renderScreens();
      }
    };
    return permission.state;
  } catch { return null; }
}
async function authorize(silent = false) {
  if (details) { renderScreens(); if (!silent) status('自动识别已开启，屏幕变化会自动更新。'); return; }
  if (typeof window.getScreenDetails !== 'function') {
    status('此浏览器不能自动选择外接屏。可打开预览，再通过系统镜像或手动移动窗口显示。'); return;
  }
  $('display-authorize').disabled = true;
  const generation = ++authorizationGeneration;
  try {
    const next = await window.getScreenDetails();
    const currentPermission = await rememberPermission();
    if (generation !== authorizationGeneration || currentPermission === 'denied') return;
    releaseDetails(); details = next; details.addEventListener('screenschange', screenChanged);
    renderScreens();
    if (!silent) status('自动识别已开启。选择好目标后，点击打开画面。');
  } catch (error) {
    if (generation !== authorizationGeneration) return;
    closeOutput(); releaseDetails(); renderScreens();
    if (!silent) status(error.name === 'NotAllowedError' ? '未获得显示权限。仍可打开本机预览，使用系统镜像。' : '当前无法读取屏幕。可使用本机预览，稍后重新授权。');
  } finally { $('display-authorize').disabled = false; }
}
function openOutput() {
  if (liveOutput()) { output.focus(); return; }
  if (details) renderScreens();
  if ($('display-open').disabled) return;
  // Synchronous with the click; no permission await before creating the popup.
  output = window.open('./display.html', outputName, placementFeatures(target));
  if (!output) { status('输出窗口被浏览器拦截。请允许本站弹出窗口，再点击打开。'); updateButtons(); return; }
  boundScreen = target; ready = false;
  status(target ? '正在打开目标屏幕上的画面。若浏览器限制位置，请手动移至目标屏。' : '已打开本机预览。可将此窗口移到眼镜屏幕，或使用系统镜像。');
  updateButtons();
}
async function attachStream(next) {
  if (!liveOutput() || !ready) throw new Error('请先打开画面窗口。');
  if (!next?.getVideoTracks?.().some(track => track.readyState === 'live')) throw new Error('没有可用的视频轨道。');
  stopCapture(); stream = next;
  stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => { if (stream === next) stopCapture('游戏画面共享已结束。'); }, { once: true }));
  try { await output.eyeDisplayReceiver.setStream(next); }
  catch (error) { if (stream === next) stopCapture('输出窗口暂不可用，共享已停止。'); throw error; }
  if (stream === next) { status('正在将所选画面送到输出窗口；声音继续由系统音频输出。'); updateButtons(); }
}
async function shareGame() {
  if (!ready || !liveOutput() || capturePending || !navigator.mediaDevices?.getDisplayMedia) return;
  const generation = ++captureGeneration; capturePending = true; updateButtons();
  try {
    // User selects an existing game window/tab. No audio loop, recording or upload.
    const next = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 60 } }, audio: false });
    if (generation !== captureGeneration || !ready || !liveOutput()) { next.getTracks().forEach(t => t.stop()); return; }
    await attachStream(next);
  } catch (error) {
    if (generation === captureGeneration) status(error.name === 'NotAllowedError' ? '未开始新的共享。请点击共享并选择游戏窗口。' : '未能共享画面，请检查浏览器支持和窗口状态。');
  } finally {
    if (generation === captureGeneration) { capturePending = false; updateButtons(); }
  }
}
async function checkNative() {
  if (nativeBusy) return; nativeBusy = true; lastNativeCheck = Date.now();
  try {
    const response = await fetch('./api/displays', { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    const value = response.ok ? await response.json() : null;
    nativeState = value?.available && Array.isArray(value.displays) ? value : null;
  } catch { nativeState = null; }
  finally { nativeBusy = false; if (!details) renderScreens(); }
}
window.addEventListener('message', event => {
  if (!liveOutput() || event.source !== output || event.origin !== location.origin || event.data?.protocol !== 'eye-display-v1') return;
  const { type, layout } = event.data;
  if (type === 'ready') {
    ready = true; send('scene', { scene }); send('inset', { value: inset });
    if (stream) stopCapture('输出窗口重新加载，共享已停止，请重新选择游戏。');
    positionOutput(); updateButtons();
  } else if (type === 'viewport' && Number.isFinite(layout?.width) && Number.isFinite(layout?.height)) {
    viewport = `窗口 ${layout.width} × ${layout.height} · 2D`; updateButtons();
  } else if (type === 'stopped') stopCapture('游戏画面共享已停止。');
  else if (type === 'closed') closeOutput('画面窗口已关闭，共享已停止。');
});
$('display-authorize').onclick = () => authorize();
$('display-target').onchange = () => {
  closeOutput(); preferred = $('display-target').value; renderScreens(); status('目标已更新，点击打开画面。');
};
$('display-open').onclick = openOutput; $('display-share').onclick = shareGame;
$('display-stop').onclick = () => stopCapture('已停止共享，输出窗口回到风景预览。');
$('display-close').onclick = () => closeOutput('画面窗口已关闭。');
$('display-inset').oninput = () => { inset = safeInset($('display-inset').value); $('display-inset-value').textContent = `${inset}%`; send('inset', { value: inset }); };
function setScene(value) { scene = normalizeScene(value); send('scene', { scene }); }
window.addEventListener('eye:scene', event => setScene(event.detail));
// Merge surface for the partner's same-origin game/canvas. It never controls motors.
window.EyeDisplay = Object.freeze({
  version: 1, setScene, presentStream: attachStream, stop: () => stopCapture(),
  getState: () => ({ windowReady: ready && !!liveOutput(), sharing: !!stream, displayPermission: !!details, mode: 'mono' }),
});
window.addEventListener('pagehide', () => { ++authorizationGeneration; closeOutput(); releaseDetails(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkNative(); });
setInterval(() => {
  if (output && output.closed) closeOutput('画面窗口已关闭，共享已停止。');
  if (!document.hidden && !details && Date.now() - lastNativeCheck >= 15000) checkNative();
}, 1000);
if (!window.getScreenDetails) $('display-authorize').textContent = '查看浏览器兼容提示';
if (!navigator.mediaDevices?.getDisplayMedia) $('display-capture-note').textContent = '此浏览器不支持游戏窗口共享；仍可显示预览。手机可使用系统镜像或厂商投屏。';
renderScreens(); checkNative();
// Only restore an existing grant automatically; never prompt on page load.
rememberPermission().then(state => { if (state === 'granted') authorize(true); });
