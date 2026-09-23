// G 线 · 峰哥导游：进地图后、按住 R2 之前（U 线的「准备」= body.u-ready），峰哥头像放大，逐句出气泡 + 放预生成的峰哥语音，
//   镜头从峰哥正面慢慢拉远、绕着他转，把景区带进画面。一按 R2 / 开始走 / 离开「准备」→ 立刻打断，镜头交还引擎。
// 每次进地图（切世界 = 页面重载）讲一遍；待机（u-idle）之后又回到「准备」= 来了新的人，再讲一遍。急停中不讲。
// 话术固定：GET /guide/<world>.json（shellos/agent/guide.py）；语音：/guide/<world>/<i>.wav（只读缓存，没有就只出气泡）。
// 用到别人的接口：window.__fenggeHud.say（H 线气泡）、#fg .av（H 线头像，放大用本文件的 CSS）、window.__camHold（引擎：跳过它的镜头）。
// 开关：?guide=0 关；?voice=0 只出气泡不出声。调试：window.__guide.play() / stop()。
import * as THREE from 'three';
import { STEP } from './path.js';
import { bus } from './voice_bus.js';     // 峰哥声道仲裁：导游讲解期间占住声道，事件 / 地标台词不插嘴

const Q = new URLSearchParams(location.search);
const GAP_MS = 350, CPS = 4.5, PRELOAD_MS = 6000;   // 句间停顿；没声音时按每秒 4.5 字估时长；预加载最多等 6 s（等不到的播的时候再说）
// 镜头三段（秒）：0–t1 正面对着峰哥慢慢推近（像导游对着你说话）；t1–t2 从头顶摇臂翻到身后（只走路线上方，不擦两边的楼）；
//   t2 以后在身后高处，看前方的山路 / 景点，慢慢升高后退。看点压在脸下面：脸在画面上三分之一，不被正中偏下的「按住 R2」挡住。
const CAM = { t1: 9, t2: 17, front: [3.0, 2.4], fh: 1.5, look: 1.0, back: 3.8, bh: 3.4, peak: 4.8, ahead: 14, side: 0.5, clear: 0.9, drift: [0.06, 0.05] };
const CSS = `body.g-guide #fg .av{width:9.5rem;height:9.5rem}`;

export async function initGuide({ world, route, camera, me, getS }) {
  if (Q.get('guide') === '0') return null;
  const lines = ((await fetch(`/guide/${world.id}.json`).then(r => r.json()).catch(() => null)) || {}).lines || [];
  if (!lines.length) return null;             // 现场造的山（gen_*）没有导游词
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  const body = document.body, mute = Q.get('voice') === '0';
  const clips = mute ? [] : lines.map((_, i) => Object.assign(new Audio(`/guide/${world.id}/${i}.wav`), { preload: 'auto' }));   // 先下好，句与句之间不卡
  bus.bless(clips);                          // Safari / 严格自动播放策略：第一次按键时把这几段预热一遍，之后不靠手势也能播
  // 预加载：每段 ok（能从头放到尾）/ miss（404 或解不了：这句只出气泡，不等）/ slow（6 s 还没下完：照样开讲，播的时候兜底）；全部有结果才开讲
  const have = clips.map(() => null);
  let preloaded = mute;
  Promise.all(clips.map((a, i) => new Promise(r => {
    const done = v => { if (have[i] == null) { have[i] = v; r(); } };
    a.addEventListener('canplaythrough', () => done('ok'), { once: true });
    a.addEventListener('error', () => done('miss'), { once: true });
    if (a.readyState >= 4) done('ok');
    setTimeout(() => done('slow'), PRELOAD_MS);
  }))).then(() => { preloaded = true; note('preload', have.join(',')); });
  let run = 0, armed = true, audio = null, cur = '', t0 = 0, tl = 0, raf = 0, cancel = null;
  const log = [], note = (...a) => { log.push([Math.round(performance.now()), ...a]); if (log.length > 60) log.shift(); };   // 调试：window.__guide.log
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), want = new THREE.Vector3(), wantLook = new THREE.Vector3(), rel = new THREE.Vector3();

  const speak = (i) => new Promise(done => {   // 一句：气泡 + 声音，放完（或估的时长到了）才 resolve
    const text = lines[i], est = text.length / CPS * 1000 + 600;
    let fin = false; const end = (why) => { if (!fin) { fin = true; note(i, why); done(); } };
    cancel = () => { fin = true; done(); };     // 被打断：这句的计时器之后再到点也不记、不动
    note(i, 'say');
    cur = text; window.__fenggeHud?.say('guide', text, 0);
    if (mute) return setTimeout(end, est, 'est');
    if (have[i] === 'miss') return setTimeout(end, est, 'nowav');   // 没这句的 wav：只出气泡，按字数估时长，不等
    audio = clips[i]; audio.currentTime = 0;
    audio.onended = () => end('ended'); audio.onerror = () => setTimeout(end, est, 'nowav');
    audio.play().then(() => note(i, 'play'), e => setTimeout(end, est, e.name));   // 浏览器不让自动出声 / 放不了：照样按时长出气泡
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 + 1500 : est + 4000;
    setTimeout(end, dur, 'stuck');                      // 兜底：声音卡住也不停在这一句（知道时长就按时长 + 1.5 s）
  });

  const ease = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const A = {}, B = {};
  function cam() {
    raf = requestAnimationFrame(cam);
    const n = performance.now(), t = (n - t0) / 1000, dt = Math.min(0.1, (n - tl) / 1000); tl = n;
    const a = route.at(me.s, 0.35, A), b = route.at(me.s + CAM.ahead, 0, B);   // 0.35 = 引擎里化身的横向位置（AV_LAT）
    const u = ease((t - CAM.t1) / (CAM.t2 - CAM.t1)), late = Math.max(0, t - CAM.t2);
    const df = CAM.front[0] + (CAM.front[1] - CAM.front[0]) * ease(t / CAM.t1);
    const along = df + (-CAM.back - df) * u - late * CAM.drift[0];
    const h = CAM.fh + (CAM.bh - CAM.fh) * u + (CAM.peak - CAM.bh) * Math.sin(Math.PI * u) + late * CAM.drift[1];
    want.copy(a.pos).addScaledVector(a.dir, along).addScaledVector(a.left, CAM.side); want.y = a.pos.y + h;
    want.y = Math.max(want.y, route.heightAt(Math.max(0, Math.min(route.N, me.s + along / STEP))) + CAM.clear);   // 别钻进台阶 / 坡里
    wantLook.copy(a.pos); wantLook.y += CAM.look;
    rel.copy(b.pos); rel.y += 1.2; wantLook.lerp(rel, u);
    const f = 1 - Math.exp(-dt * 2);          // 从引擎当时的机位平滑过来
    pos.lerp(want, f); look.lerp(wantLook, f);
    camera.position.copy(pos); camera.lookAt(look);
  }

  async function play() {
    stop(); armed = false;
    const my = ++run;
    body.classList.add('g-guide'); bus.hold('guide');
    pos.copy(camera.position); camera.getWorldDirection(look).multiplyScalar(5).add(camera.position);
    t0 = tl = performance.now(); window.__camHold = true; cam();
    for (let i = 0; i < lines.length && my === run; i++) {
      await speak(i);
      if (my === run) await new Promise(r => setTimeout(r, GAP_MS));
    }
    if (my === run) stop();
  }
  function stop() {
    if (!body.classList.contains('g-guide')) return;
    note('stop'); run++; cancelAnimationFrame(raf); if (cancel) { cancel(); cancel = null; } window.__camHold = false;
    if (audio) { audio.pause(); audio.onended = audio.onerror = null; audio = null; }
    window.__fenggeHud?.say('guide', cur, 1);   // 同一句、1 ms 后收起（淡出）
    body.classList.remove('g-guide'); bus.release('guide');
  }

  setInterval(() => {                          // 5 Hz：该不该开讲 / 该不该打断
    const S = getS() || {}, T = S.terrain || {};
    const ready = body.classList.contains('u-ready') && (S.safety || {}).state !== 'DISARMED';
    const go = (S.gait && S.gait.moving) || (S.pad && S.pad.r2 > 0.05) || (S.sim && S.sim.walk);
    if (body.classList.contains('u-idle')) armed = true;
    const atStart = T.pos != null && T.pos < 1;   // 只在山脚开讲：半路停下来（u-play 回到 u-ready）不能突然开始导游
    if (body.classList.contains('g-guide')) { if (!ready || go) stop(); }
    else if (armed && ready && go) armed = false;  // 没听就走了（按住 R2 关掉标题屏）：这一位跳过，别等他半山腰歇脚时再讲
    else if (armed && ready && !go && atStart && preloaded) { if (mute || bus.unlocked()) play(); else bus.ask(); }   // 声音还没解锁：先别讲（讲了也是哑的），提示按任意键
  }, 200);
  window.__guide = { play, stop, lines, log };
  return window.__guide;
}
