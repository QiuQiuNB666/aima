import { normalizeScene, safeInset, viewportLayout } from './display-core.js';

const $ = id => document.getElementById(id);
const stage = $('stage'), video = $('game-video');
const parent = window.opener;
let source = null, hideTimer;
function tell(type, detail = {}) {
  try { parent?.postMessage({ protocol: 'eye-display-v1', type, ...detail }, location.origin); } catch { /* Controller closed. */ }
}
function setScene(value) {
  const scene = normalizeScene(value);
  $('scene-title').textContent = scene.title; $('scene-subtitle').textContent = scene.subtitle;
  $('region').textContent = scene.region; stage.dataset.theme = scene.theme;
}
function clearStream() {
  source = null; video.pause(); video.srcObject = null; video.hidden = true;
  stage.classList.remove('is-live'); $('stop-sharing').hidden = true;
}
function stopStream() {
  source?.getTracks().forEach(track => track.stop()); clearStream(); tell('stopped');
}
// Same-origin local MediaStream handoff: no encoding server, network upload or recording.
async function setStream(stream) {
  if (!stream || typeof stream.getVideoTracks !== 'function' || !stream.getVideoTracks().some(t => t.readyState === 'live')) throw new Error('需要可用的视频流。');
  clearStream(); source = stream; video.srcObject = stream; video.hidden = false;
  stage.classList.add('is-live'); $('stop-sharing').hidden = false;
  try { await video.play(); }
  catch (error) {
    if (source === stream) { clearStream(); $('display-message').textContent = '浏览器未能播放画面，请回到控制台重新共享。'; }
    throw error;
  }
}
window.eyeDisplayReceiver = Object.freeze({ setStream, clearStream });
window.addEventListener('message', event => {
  if (event.origin !== location.origin || event.source !== parent || event.data?.protocol !== 'eye-display-v1') return;
  if (event.data.type === 'scene') setScene(event.data.scene);
  if (event.data.type === 'inset') document.documentElement.style.setProperty('--inset', `${safeInset(event.data.value)}%`);
  if (event.data.type === 'stop') clearStream();
});
function measure() {
  const layout = viewportLayout(innerWidth, innerHeight, devicePixelRatio);
  $('viewport-info').textContent = `${layout.width} × ${layout.height} · 2D 自动适配`;
  tell('viewport', { layout });
}
$('fullscreen').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    if (source) await video.play();
  } catch { $('display-message').textContent = '当前环境不支持全屏，可使用系统最大化或投屏。'; }
};
document.addEventListener('fullscreenchange', () => { $('fullscreen').textContent = document.fullscreenElement ? '退出全屏' : '全屏'; measure(); });
$('stop-sharing').onclick = stopStream;
$('close-display').onclick = () => { stopStream(); window.close(); };
function showControls() {
  document.body.classList.remove('toolbar-quiet'); clearTimeout(hideTimer);
  if (document.fullscreenElement) hideTimer = setTimeout(() => document.body.classList.add('toolbar-quiet'), 3500);
}
for (const event of ['pointermove', 'pointerdown', 'keydown', 'fullscreenchange']) document.addEventListener(event, showControls);
window.addEventListener('resize', measure);
window.addEventListener('pagehide', () => { source?.getTracks().forEach(track => track.stop()); tell('closed'); });
// Stop displaying a stale stream if the controller disappears unexpectedly.
setInterval(() => { if (parent?.closed) { stopStream(); $('display-message').textContent = '控制台已关闭，共享已结束。'; } }, 1000);
setScene(); measure(); tell('ready');
