// 峰哥屋顶跑酷（R 线）：/parkour。只读 /state（10 Hz）；唯一会写的控制接口是 POST /terrain/force（改腿上力的「形状」，大小仍归 Guard + R2），
//   模拟模式下另外发 /sim（空格走路）。页面失焦 / 隐藏 / 关掉 / 一局结束 → force 设回 null。
// 操作：步频 = 跑速；高抬腿（一条腿屈髋 > 45° 且还在抬）= 跳；双腿下蹲 = 滑铲；← → 换道。键盘备份：↑/W 跳、↓/S 滑、←→/AD 换道、回车再来一局。
//   模拟：按住空格走，1/2/3/4 = 步频 80/105/130/140。
// URL：?fx=low 降画质；?auto=0.8 自动驾驶（每个障碍 80% 概率躲过去，模拟模式下自己按空格；截图 / 展位待机用）；?seed=；?fengge=0；?voice=0；
//   ?jump= ?slide= ?vjump= 现场调高抬腿 / 下蹲阈值。
import * as THREE from 'three';
import { loadAvatar, preloadAvatar } from '/game/avatar.js';
import { dressFengge } from '/game/fengge.js';
import { makeJifeng } from '/game/npc_jifeng.js';
import { LANE, TUNE, makeLevel, makeRun, makeLegs, speedFor, forceKind, nextThreat } from './logic.js';
import { makeCity } from './city.js';

const Q = new URLSearchParams(location.search);
const LOW = Q.get('fx') === 'low', AUTO = Q.has('auto') ? +(Q.get('auto') || 0.85) : 0, MUTE = Q.get('voice') === '0';
for (const [k, q] of [['JUMP_FLEX', 'jump'], ['SLIDE_FLEX', 'slide'], ['JUMP_VEL', 'vjump']]) if (Q.has(q)) TUNE[k] = +Q.get(q);
const LEG_READY_S = 5;          // 走满 5 s（anim.js 学完零点）才认高抬腿 / 下蹲：零点没学出来时穿戴偏屈 15–20°，正常走路会被当成高抬腿
const $ = id => document.getElementById(id);
const post = (p, b) => fetch(p, { method: 'POST', body: JSON.stringify(b || {}) }).then(r => r.json()).catch(() => null);
const err = (m, e) => { console.error(m, e); if (window.__err) window.__err(`${m}${e ? '：' + (e.stack || e) : ''}`); };
const best = { get: () => { try { return +localStorage.getItem('pk_best') || 0; } catch { return 0; } }, set: v => { try { localStorage.setItem('pk_best', v); } catch {} } };
const JF = { start: '가자！你先跑三秒。', dash: '就这？빨리빨리！', caught: '逮到了，慢死了。', lost: '哟，跑挺快嘛。' };   // 都在 voice.py NPC_LINES 白名单里

// ---------- 腿上的力 ----------
let forceSent, forceAt = 0;
function setForce(kind, now) {
  if (kind === forceSent || now - forceAt < 0.15) return;
  forceSent = kind; forceAt = now;
  post('/terrain/force', { kind });
}
const forceOff = () => { forceSent = null; navigator.sendBeacon('/terrain/force', JSON.stringify({ kind: null })); };
addEventListener('pagehide', forceOff);
addEventListener('beforeunload', forceOff);
// 失焦 = 操作员去点别的窗口了：游戏照跑，只是不再改腿上的力，回来再接着发
addEventListener('blur', () => { forceOff(); away = true; });
addEventListener('focus', () => { away = false; forceSent = undefined; });
document.addEventListener('visibilitychange', () => { if (document.hidden) { forceOff(); away = true; } else { away = !document.hasFocus(); forceSent = undefined; } });
let away = !document.hasFocus();

async function main() {
  preloadAvatar();
  post('/terrain/force', { kind: null }); forceSent = null;   // 上次页面没收尾也先清掉
  const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: !LOW, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);                  // 不降分辨率：0.75 放大回来反而更慢（AMD 555 实测）
  renderer.setSize(innerWidth, innerHeight, false);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 400);
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
  scene.add(new THREE.HemisphereLight('#b9c6ff', '#402040', 1.3));
  const moonL = new THREE.DirectionalLight('#ffe2c0', 1.1); scene.add(moonL, moonL.target);
  const city = makeCity(scene, { low: LOW });

  const av = await loadAvatar();
  if (Q.get('fengge') !== '0') try { await dressFengge(av); } catch (e) { err('峰哥头加载失败，用原头盔', e); }
  scene.add(av.group);
  const jf = await makeJifeng(scene);

  // ---------- 一局 ----------
  let level, run, legs = makeLegs(), shake = 0, flash = 0, overAt = 0, jfSaid = '', bubbleUntil = 0, autoWalk = false;
  const seed0 = +(Q.get('seed') || Date.now() % 100000);
  let seed = seed0;
  function newRun() {
    city.clear(); level = makeLevel(seed++); run = makeRun(level);
    overAt = 0; jfSaid = ''; document.body.classList.remove('over'); document.body.classList.add('title');
  }
  newRun();
  let pend = { jump: false, slide: false, lane: 0, slideHold: false };

  // ---------- /state ----------
  let S = null, lastT = null, legWalk = 0, audio = null;
  async function poll() {
    const t0 = performance.now();
    try {
      S = await fetch('/state', { cache: 'no-store' }).then(r => r.json());
      $('banner').style.display = 'none';
      const f = S.frame;
      if (f && S.t !== lastT) {
        lastT = S.t;
        if (legWalk >= LEG_READY_S) {
          const off = av.body.off, r = legs.push(-f.l - off, -f.r - off, -(f.ldps || 0), -(f.rdps || 0));
          if (r.jump) pend.jump = true;
          pend.slideHold = r.slide; if (r.slide) pend.slide = true;
        }
      }
    } catch (e) { $('banner').style.display = 'block'; $('banner').textContent = '连不上 ShellOS（/state）——确认 python -m shellos.main 在跑'; }
    setTimeout(poll, Math.max(0, 100 - (performance.now() - t0)));
  }
  poll();
  const say = key => {
    jfSaid = key; $('jfSay').textContent = JF[key]; bubbleUntil = performance.now() / 1000 + 2.5;
    if (MUTE || AUTO) return;
    if (audio) audio.pause();
    audio = new Audio('/voice/npc.wav?t=' + encodeURIComponent(JF[key])); audio.play().catch(() => {});
  };

  // ---------- 键盘 ----------
  const isSim = () => !!(S && S.sim && S.sim.on);
  const CAD = { Digit1: 80, Digit2: 105, Digit3: 130, Digit4: 140 };
  let walking = false;
  const walk = on => { if (on === walking || !isSim()) return; walking = on; post('/sim', { walk: on }); };
  addEventListener('keydown', e => {
    const c = e.code;
    if (c === 'Space') { e.preventDefault(); walk(true); }
    else if (e.repeat) return;
    else if (c === 'ArrowUp' || c === 'KeyW') pend.jump = true;
    else if (c === 'ArrowDown' || c === 'KeyS') pend.slide = true;
    else if (c === 'ArrowLeft' || c === 'KeyA') pend.lane = -1;
    else if (c === 'ArrowRight' || c === 'KeyD') pend.lane = 1;
    else if (c === 'Enter' && run.over) newRun();
    else if (CAD[c] && isSim()) post('/sim', { cadence: CAD[c] });
    if (c.startsWith('Arrow')) e.preventDefault();
  });
  addEventListener('keyup', e => { if (e.code === 'Space') walk(false); });
  addEventListener('blur', () => walk(false));

  // ---------- 自动驾驶（?auto=p）：每个障碍按概率 p 决定躲不躲 ----------
  function autopilot() {
    if (isSim() && !autoWalk) { autoWalk = true; post('/sim', { walk: true, cadence: 130 }); }
    if (run.over) { if (performance.now() / 1000 - overAt > 8) newRun(); return; }
    const th = nextThreat(run, level, 6);
    if (!th) return;
    if (th.o.ap === undefined) th.o.ap = Math.random() < AUTO;
    if (!th.o.ap) return;
    if (th.what === 'jump' && th.dx < 1.5 + run.speed * 0.12) pend.jump = true;
    if (th.what === 'slide' && th.dx < 2.2) pend.slide = true;
    if (th.what === 'lane') { const free = [0, 1, 2].filter(l => !th.o.lanes.includes(l)).sort((a, b) => Math.abs(a - run.lane) - Math.abs(b - run.lane)); pend.lane = Math.sign(free[0] - run.lane); }
  }

  // ---------- 每帧 ----------
  const P = new THREE.Vector3(), camP = new THREE.Vector3(), look = new THREE.Vector3(), dir = new THREE.Vector3(1, 0, 0), jfP = new THREE.Vector3();
  let last = performance.now(), frames = 0, fpsT = last, camY = run.y, jfPhase = 0, tilt = 0;
  const HINT = { jump: '高抬腿 · 跳！', slide: '下蹲 · 滑铲！', lane: '← → 换道！' };
  function frame() {
    requestAnimationFrame(frame);
    const nowMs = performance.now(), dtR = Math.min(0.1, (nowMs - last) / 1000), t = nowMs / 1000; last = nowMs;
    const g = S && S.gait;
    const moving = !!(g && g.moving);
    if (moving) legWalk += dtR;
    if (AUTO) autopilot();
    const vT = speedFor(g ? g.cadence : 0, moving);
    {
      const inp = { v: vT, jump: pend.jump, slide: pend.slide || pend.slideHold, lane: pend.lane };
      pend.jump = pend.slide = false; pend.lane = 0;
      const n = Math.ceil(dtR / (1 / 120));
      for (let i = 0; i < n; i++) { run.step(dtR / n, i ? { v: vT } : inp); }
    }
    if (run.over && t - overAt > 3 && pend.jump) newRun();   // 穿着外骨骼按不了回车：高抬腿再来一局
    for (const ev of run.events.splice(0)) {
      if (ev === 'start') { document.body.classList.remove('title'); say('start'); }
      if (['low', 'high', 'block', 'fall', 'wall', 'caught'].includes(ev)) { shake = 0.5; flash = 1; $('hitWhy').textContent = { low: '撞上空调外机', high: '被晾衣杆拦住', block: '撞上水箱', fall: '掉下楼缝', wall: '撞上楼沿', caught: '被疾风追上' }[ev]; if (ev === 'caught') { say('caught'); jf.burst(); } }
      if (ev === 'over') { overAt = t; $('goT').textContent = $('hitWhy').textContent === '被疾风追上' ? '被疾风抓住了' : '峰哥倒下了'; const b = best.get(), d = Math.floor(run.dist); if (d > b) best.set(d); $('goDist').textContent = d; $('goBest').textContent = Math.max(b, d); $('goNew').style.display = d > b ? 'block' : 'none'; document.body.classList.add('over'); }
    }
    if (run.jfGap > 14 && jfSaid !== 'lost' && run.started) say('lost');
    else if (run.jfGap < 4 && jfSaid !== 'dash' && jfSaid !== 'caught' && run.started && !run.over) say('dash');
    if (jfSaid === 'lost' && run.jfGap < 9) jfSaid = '';
    if (jfSaid === 'caught' && run.jfGap > 6) jfSaid = '';

    // 腿上的力
    if (!away) setForce(forceKind(run, level), t);
    else if (forceSent !== null) forceOff();

    // 场景
    city.sync(level, run.x);
    const seg = level.seg(run.x), gy = level.ground(run.x);
    P.set(run.x, run.y, run.z);
    av.group.position.copy(P);
    const slide = run.slideT > 0;
    tilt += ((slide ? 1.05 : run.air ? -0.12 : 0) - tilt) * (1 - Math.exp(-dtR * 14));
    av.group.rotation.set(0, 0, tilt);
    if (slide) av.group.position.y += 0.1;
    av.group.visible = !(run.invuln > 0 && Math.floor(t * 12) % 2);
    av.animate(dtR, t, { state: S && S.frame ? S : null, fl: 5, fr: 5, kind: run.air ? 'stairs_up' : seg && seg.kind === 'ramp' ? 'up' : 'flat', summit: false });

    // 疾风：在身后 jfGap 米；近了才进镜头
    const jx = run.x - run.jfGap, jy = level.ground(jx) ?? run.y;
    jfP.set(jx, jy, run.jfV > 0 ? -LANE * 0.9 : run.z - 0.9);
    jf.group.position.copy(jfP); jf.group.rotation.set(0, 0, run.jfV > 0 ? -0.25 : 0);
    jfPhase += dtR * Math.PI * Math.max(1.5, (run.jfV || 6) / 2.2);
    if (run.jfV > 0 || !run.started) { const amp = run.jfV > 0 ? 38 : 0; jf.pose(amp * Math.sin(jfPhase), amp * Math.sin(jfPhase + Math.PI)); } else jf.pose(-4, 6);
    jf.visible = run.jfGap < 3.2;                  // 再远就贴到镜头上了（镜头在身后 4.3），只留右上角的距离条
    jf.update(dtR, jfP, dir, run.jfGap < 5 ? 1 : 0.3);

    // 镜头：身后偏上；跳的时候不跟满，落地有顿挫；撞了抖
    camY += ((gy ?? run.y) - camY) * (1 - Math.exp(-dtR * 4));
    const fov = 60 + Math.min(10, run.speed * 0.6);
    if (Math.abs(camera.fov - fov) > 0.2) { camera.fov += (fov - camera.fov) * 0.1; camera.updateProjectionMatrix(); }
    shake = Math.max(0, shake - dtR); flash = Math.max(0, flash - dtR * 2.5);
    const sh = shake * 0.4;
    camP.set(run.x - 4.3, Math.max(camY, run.y - 1) + 2.0 + (Math.random() - 0.5) * sh, run.z * 0.55 + (Math.random() - 0.5) * sh);
    camera.position.lerp(camP, 1 - Math.exp(-dtR * 10));
    look.set(run.x + 7, Math.max(camY, run.y - 0.5) + 1.0, run.z * 0.3);
    camera.lookAt(look);
    moonL.position.set(run.x - 30, 60, -40); moonL.target.position.set(run.x, 0, 0);
    renderer.render(scene, camera);

    // HUD
    if (!document.body.dataset.ready) document.body.dataset.ready = '1';
    $('dist').textContent = Math.floor(run.dist);
    $('lives').innerHTML = [0, 1, 2].map(i => `<i class="${i < run.lives ? 'on' : ''}"></i>`).join('');
    $('spd').textContent = (run.speed * 3.6).toFixed(0);
    $('cad').textContent = moving ? Math.round(g.cadence || 0) : '—';
    const gp = Math.max(0, Math.min(1, run.jfGap / TUNE.JF_GAPMAX));
    $('jfBar').style.width = `${(1 - gp) * 100}%`; $('jfM').textContent = `${run.jfGap.toFixed(1)} m`;
    document.body.classList.toggle('danger', run.started && run.jfGap < 4);
    $('flash').style.opacity = flash * 0.55;
    document.body.classList.toggle('talk', t < bubbleUntil);
    const th = run.started && !run.over ? nextThreat(run, level, run.speed * 1.4 + 3) : null;
    $('hint').textContent = th ? HINT[th.what] : ''; $('hint').className = 'hud ' + (th ? th.what : '');
    if (S) {
      const sent = (S.safety && S.safety.sent) || [0, 0];
      for (const [k, i] of [['L', 0], ['R', 1]]) { const v = Math.max(-1, Math.min(1, sent[i] / ((S.safety && S.safety.cap) || 3))); const b = $('bar' + k); b.style.left = v < 0 ? `${50 + v * 50}%` : '50%'; b.style.width = `${Math.abs(v) * 50}%`; }
      const terrainOn = S.ctl && S.ctl.name === 'terrain';
      const held = S.safety && S.safety.deadman > 0.05;
      $('force').textContent = !terrainOn ? '腿上的力：关（控制律不是 terrain）' : away ? '腿上的力：暂停（页面没焦点，点一下画面）'
        : `腿上的力：${{ up: '上坡 · 后面推', down: '落地 · 制动', stairs_up: '准备起跳 · 帮抬腿' }[forceSent] || '平地'}`;
      $('r2').textContent = isSim() ? '模拟模式' : held ? 'R2 按住 · 有力' : '按住 R2 才有力';
      $('r2').className = held || isSim() ? 'ok' : '';
      $('legs').textContent = legWalk >= LEG_READY_S ? '腿：高抬腿 = 跳 · 下蹲 = 滑铲' : `腿：校准中，先走 ${Math.ceil(LEG_READY_S - legWalk)} s`;
      $('simHint').style.display = isSim() ? 'inline' : 'none';
    }
    frames++;
    if (nowMs - fpsT > 1000) { window.__fps = frames * 1000 / (nowMs - fpsT); $('fps').textContent = `${window.__fps.toFixed(0)} fps${LOW ? ' · low' : ''}`; frames = 0; fpsT = nowMs; }
  }
  frame();
  window.__pk = { get run() { return run; }, get level() { return level; }, get S() { return S; }, press: (k) => { pend[k] = k === 'lane' ? 1 : true; }, renderer, scene, newRun };
}

main().catch(e => { err('跑酷启动失败', e); $('banner').style.display = 'block'; $('banner').textContent = '跑酷启动失败：' + e.message; });
