import { Soundscape } from './audio.mjs';
import { profiles, ProgressGate, mixFor } from './state.mjs';

const $ = id => document.getElementById(id);
const manifest = window.AIMA_INLINE?.manifest || await (await fetch('manifest.json')).json();
const sound = new Soundscape(window.AIMA_INLINE ? name => window.AIMA_INLINE.assets[name] : undefined);
const gate = new ProgressGate();
const routes = [...manifest.worlds, ...(manifest.interfaces || [])];
let style = 'dawn_mountain', walking = false, live = false, liveTimer = null, walkTimer = null;
let latest = null, liveStarted = 0, lastGood = 0, lastProbe = null, pulseFrame = null;
const log = [];
function record(type, detail) { log.push({ time: new Date().toISOString(), type, detail }); if (log.length > 100) log.shift(); }
function status(text) { $('status').textContent = text; }
function fail(e) { status('播放未完成：'+e.message); record('error', e.message); }
sound.onError = fail;
sound.onChange = text => { status(text); $('enable').textContent = sound.enabled ? '重新启用声音' : '启用声音'; record('audio', text); };
function bind(id, fn) { $(id).onclick = () => Promise.resolve().then(fn).catch(fail); }
function stopWalk() { walking = false; clearInterval(walkTimer); $('walk').textContent = '模拟行走'; sound.stopSteps(); }
function disconnect() { live = false; clearTimeout(liveTimer); gate.reset(); $('live').textContent = '连接游戏状态'; $('liveStatus').textContent = '未连接'; }
function route() { return routes.find(w => w.id === $('route').value); }
function segment() { return route()?.route[Number($('segment').value)] || { kind: 'flat', label: '' }; }
function updateRegion() {
  const world = route(); if (!world) return;
  const i = Number($('segment').value), pos = world.route.slice(0,i).reduce((n,s) => n+s.steps,0);
  const T = { pos, total: world.route.reduce((n,s)=>n+s.steps,0), label: segment().label, segment: segment().kind };
  sound.setRegion(T);
  const mix = mixFor(T, style);
  $('matched').textContent = '当前底音：'+mix.file+' · '+(mix.stepAllowed ? '脚步：step_'+mix.material+'.wav' : '等待路段：不播放脚步');
}
function fillSegments() {
  $('segment').replaceChildren(...(route()?.route || []).map((s,i) => new Option(s.label+' · '+s.kind, i)));
  updateRegion();
}
async function choose(key, fromLive=false) {
  if (!fromLive) disconnect();
  $('assetPlayer').pause();
  stopWalk(); style = key;
  document.documentElement.style.setProperty('--accent', profiles[key].color);
  for (const b of $('scenes').children) b.setAttribute('aria-pressed', String(b.dataset.style === key));
  $('sceneTitle').textContent = profiles[key].name; $('sceneDetail').textContent = profiles[key].detail;
  $('route').replaceChildren(...routes.filter(w => w.theme.style === key).map(w => new Option(w.name,w.id)));
  await sound.switchScene(key); if (style !== key) return;
  fillSegments(); record('scene', key);
  $('live').disabled = key === 'parkour_rooftop';
  $('liveStatus').textContent = key === 'parkour_rooftop' ? '跑酷事件保存在游戏前端；本试听台支持手动试听，不能从 /state 跟随跑酷。' : '未连接';
  if (style === key) status(profiles[key].name+' · '+(!sound.enabled ? '点击启用声音开始试听' :
    key === 'grid' && !sound.trainingAudio ? '训练场默认静音' : '环境音播放中'));
}
for (const [key,p] of Object.entries(profiles)) {
  const b = document.createElement('button'); b.className = 'card'; b.dataset.style = key;
  const title = document.createElement('b'), detail = document.createElement('span');
  title.textContent = p.name; detail.textContent = p.detail; b.append(title,detail);
  b.onclick = () => choose(key).catch(fail); $('scenes').append(b);
}
function demoStep() {
  if (!sound.enabled) throw Error('请先点击“启用声音”');
  const s = segment();
  if (s.kind === 'wait') { status('红灯路段：保持环境音，脚步暂停'); return; }
  sound.step(mixFor({label:s.label,segment:s.kind},style).material);
}
bind('enable', () => { $('assetPlayer').pause(); return sound.start(); });
bind('stop', () => { $('assetPlayer').pause(); disconnect(); stopWalk(); cancelAnimationFrame(pulseFrame); $('flash').classList.remove('on'); sound.stop(); });
bind('single', () => { disconnect(); demoStep(); });
bind('walk', () => {
  disconnect(); if (walking) { stopWalk(); return; }
  demoStep(); walking = true; $('walk').textContent = '停止脚步';
  walkTimer = setInterval(() => { if (sound.enabled) demoStep(); else stopWalk(); }, 650);
});
bind('arrive', () => sound.cue());
$('route').onchange = () => { disconnect(); stopWalk(); fillSegments(); };
$('segment').onchange = () => { disconnect(); sound.stopSteps(); updateRegion(); };
$('volume').oninput = () => { sound.setVolume($('volume').value/100); $('volumeText').textContent = $('volume').value+'%'; };
$('training').onchange = () => sound.setTrainingAudio($('training').checked);
$('duck').onchange = () => sound.setNarrationActive($('duck').checked);
for (const [id,pan] of [['left',-1],['center',0],['right',1]]) bind(id, () => {
  stopWalk(); sound.testTone(pan); record('channel-probe',id); status('已发送'+{left:'左',center:'居中',right:'右'}[id]+'声道测试音 · 请佩戴者确认');
});
bind('pulse', () => {
  stopWalk(); cancelAnimationFrame(pulseFrame); $('flash').classList.remove('on');
  const when = sound.testTone(0, sound.ctx?.currentTime+0.45);
  lastProbe = new Date().toISOString();
  function paint() {
    const elapsed = sound.ctx.currentTime-when;
    $('flash').classList.toggle('on', elapsed >= 0 && elapsed < 0.2);
    if (elapsed < 0.25 && sound.enabled) pulseFrame = requestAnimationFrame(paint);
    else $('flash').classList.remove('on');
  }
  paint(); record('av-probe','仅主观比较，不是测量');
});
async function poll() {
  if (!live) return;
  let retry = 100;
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(),1200);
  try {
    const response = await fetch('/api/state',{cache:'no-store',signal:controller.signal});
    if (!response.ok) throw Error('状态服务返回 '+response.status+'，请用 --source 配置本机游戏地址');
    const state = await response.json();
    if (!live) return;
    const now = performance.now(), result = gate.accept(state,now);
    if (result.valid) {
      lastGood = now; latest = { t:state.t, terrain:state.terrain, moving:state.gait?.moving };
      if (result.style !== style) await choose(result.style,true);
      if (!live || style !== result.style) return;
      sound.setRegion(result.terrain);
      const mix = mixFor(result.terrain,result.style);
      $('matched').textContent = '当前底音：'+mix.file+' · 脚步：step_'+mix.material+'.wav';
      if (!result.moving) sound.stopSteps();
      if (result.step) sound.step(result.material);
      if (result.arrive) void sound.cue().catch(fail);
      $('liveStatus').textContent = '只读跟随：'+result.terrain.preset+' / '+result.terrain.label+' / 第 '+result.terrain.pos+' 步';
    }
    if (now-Math.max(lastGood,liveStarted) > 1600) throw Error('状态已过期或没有有效地形，声音已停；恢复后请重新启用');
  } catch(e) {
    if (!live) return;
    retry = 1000;
    $('liveStatus').textContent = e.message; gate.reset();
    if (sound.enabled) sound.stop('游戏状态不可用，声音已停止');
  } finally { clearTimeout(timeout); if (live) liveTimer=setTimeout(poll,retry); }
}
bind('live', () => {
  if (style === 'parkour_rooftop') throw Error('跑酷需接入游戏前端事件，/state 不包含跳跃和落地');
  if (live) { disconnect(); sound.stopSteps(); return; }
  if (location.protocol === 'file:') throw Error('当前是离线试听文件；实时跟随请用随包 Python 服务器打开');
  stopWalk(); live = true; liveStarted=performance.now(); lastGood=0; gate.reset();
  $('live').textContent='断开游戏状态'; void poll();
});
// A single native audio player auditions every delivered file, separately from scene mixing.
$('asset').replaceChildren(...manifest.assets.map(a => new Option(
  a.file.split('/').pop()+' · '+a.seconds+'s · '+(a.loop?'循环':'单次'),a.file)));
function selectAsset() {
  const a=manifest.assets.find(a=>a.file===$('asset').value);
  $('assetPlayer').pause(); $('assetPlayer').src=a.file; $('assetPlayer').volume=.25;
  $('assetDescription').textContent=a.description;
  $('assetDownload').href=a.file; $('assetDownload').download=a.file.split('/').pop();
}
$('asset').onchange=selectAsset;
$('assetPlayer').onplay=()=>{disconnect();stopWalk();sound.stop('单项素材试听中 · 场景混音已停止');};
document.addEventListener('visibilitychange',()=>{if(document.hidden)$('assetPlayer').pause();});
selectAsset();
bind('report', () => {
  const data={schema:1, createdAt:new Date().toISOString(), headset:'E06s / wearer to confirm',
    wearerConfirmed: {channels:$('channels').value, sync:$('delay').value, notes:$('notes').value},
    browser:sound.diagnostics(), lastProbe, state:latest, sourceCommit:manifest.sourceCommit, log};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='aima-glasses-test.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
});
if(window.AIMA_INLINE) {
  const link=$('creditsLink'); link.href=URL.createObjectURL(new Blob([window.AIMA_INLINE.credits],{type:'text/plain;charset=utf-8'})); link.download='素材授权.txt';
}
await choose(style);
setInterval(() => {
  const d = sound.diagnostics();
  $('diagnostics').textContent = '数字输出：'+d.audioContext+' · '+d.digitalRmsDbFS+' dBFS · 环境音源 '+d.activeLoops+'（不代表眼镜实测）';
}, 250);
// Diagnostics expose no Bluetooth IDs, microphone access, or actuator actions.
window.aimaSoundLab = { sound, gate, manifest, diagnostics:()=>sound.diagnostics() };
