// 峰哥屋顶跑酷（R 线）：/parkour。只读 /state（10 Hz）；唯一会写的控制接口是 POST /terrain/force（改腿上力的「形状」，大小仍归 Guard + R2；非 null 带 ttl 1 s 每 300 ms 续），
//   模拟模式下另外发 /sim（空格走路）。页面失焦 / 隐藏 / 关掉 / 一局结束 → force 设回 null。
// 操作：步频 = 跑速；高抬腿（一条腿屈髋 > 45° 且还在抬）= 跳；双腿下蹲 = 滑铲；← → 换道。键盘备份：↑/W 跳、↓/S 滑、←→/AD 换道、回车再来一局。
//   模拟：按住空格走，1/2/3/4 = 步频 80/105/130/140。
// URL：?fx=low 降画质；?auto=0.8 自动驾驶（每个障碍 80% 概率躲过去，模拟模式下自己按空格；截图 / 展位待机用）；?seed=；?fengge=0；?voice=0；
//   ?jump= ?slide= ?vjump= 现场调高抬腿 / 下蹲阈值。
// 动作预览（调动作 / 截图用，确定性）：?demo=1 不连 ShellOS、不发任何请求，髋角用 A2 的 synthHip 合成（10 Hz 喂，和真机一样），自动驾驶用固定种子；
//   &manual=1 时钟由脚本推进：window.__pk.tick(帧数, dt)；&cad=150 步频；&cam=side 侧面镜头；&hud=0 藏 HUD；&runner=0 关掉跑步层（对比改之前）。
import * as THREE from 'three';
import { loadAvatar, preloadAvatar } from '/game/avatar.js';
import { dressFengge } from '/game/fengge.js';
import { makeJifeng } from '/game/npc_jifeng.js';
import { PALETTE, UI, applyCssVars } from '/game/style.js';
import { synthHip } from '/game/anim.js';
import { makeRunner, damp } from './runner.js';
import { makeCloth } from './cloth.js';
import { TUNE, TIERS, tierAt, jumpLen, rng, H4, atLeg, yawOf, makeLevel, makeRun, makeLegs, speedFor, forceKind, nextThreat } from './logic.js';
import { makeCity } from './city.js';
import { makeRiso } from './riso.js';

applyCssVars(); document.documentElement.style.setProperty('--acc0', PALETTE.parkour.accent[0]);   // 颜色按 ART 范式，不另写一套
const Q = new URLSearchParams(location.search);
const DEMO = Q.has('demo'), MANUAL = DEMO && Q.has('manual'), CAM = Q.get('cam'), CAD_DEMO = +(Q.get('cad') || 150);
const LOW = Q.get('fx') === 'low', AUTO = Q.has('auto') ? +(Q.get('auto') || 0.85) : DEMO ? 1 : 0, MUTE = Q.get('voice') === '0' || DEMO;
for (const [k, q] of [['JUMP_FLEX', 'jump'], ['SLIDE_FLEX', 'slide'], ['JUMP_VEL', 'vjump']]) if (Q.has(q)) TUNE[k] = +Q.get(q);
const LEG_READY_S = 5;          // 走满 5 s（anim.js 学完零点）才认高抬腿 / 下蹲：零点没学出来时穿戴偏屈 15–20°，正常走路会被当成高抬腿
const $ = id => document.getElementById(id);
const post = (p, b) => DEMO ? Promise.resolve(null) : fetch(p, { method: 'POST', body: JSON.stringify(b || {}) }).then(r => r.json()).catch(() => null);   // 预览一个请求都不发
const err = (m, e) => { console.error(m, e); if (window.__err) window.__err(`${m}${e ? '：' + (e.stack || e) : ''}`); };
const best = { get: () => { try { return +localStorage.getItem('pk_best') || 0; } catch { return 0; } }, set: v => { try { localStorage.setItem('pk_best', v); } catch {} } };
const JF = { start: '가자！你先跑三秒。', dash: '就这？빨리빨리！', caught: '逮到了，慢死了。', lost: '哟，跑挺快嘛。' };   // 都在 voice.py NPC_LINES 白名单里

// ---------- 腿上的力 ----------
// 非 null 的力带 ttl 发、每 300 ms 续一次：页面崩了 / 卡死（续不上）服务端 1 s 内自己回 null。设回 null 不带 ttl
const FORCE_TTL = 1.0, FORCE_RENEW = 0.3;
let forceSent, forceAt = 0;
function setForce(kind, now) {
  if (kind === forceSent ? !kind || now - forceAt < FORCE_RENEW : now - forceAt < 0.15) return;
  forceSent = kind; forceAt = now;
  post('/terrain/force', kind ? { kind, ttl: FORCE_TTL } : { kind: null });
}
const forceOff = () => { forceSent = null; if (!DEMO) navigator.sendBeacon('/terrain/force', JSON.stringify({ kind: null })); };
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
  const runner = Q.get('runner') === '0' ? null : makeRunner(av);
  const cloth = runner ? makeCloth(scene, av) : null;             // 在第一次摆姿势之前建：按绑定姿态找挂点
  const avLook = av.mats[0] && av.mats[0].userData.look, rim0 = avLook && avLook.uRim.value.clone(), rimK0 = avLook && avLook.uRimK.value, DANGER = new THREE.Color(UI.danger), TS = { t: 0, yaw: 0 };   // 峰哥衣服 / 头共用这组 uniform
  const jf = await makeJifeng(scene);
  if (Q.get('hud') === '0') document.body.classList.add('clean');
  if (Q.get('look') === 'riso') makeRiso({ renderer, scene, camera, av, jf, low: LOW, level: () => level, run: () => run });   // L 线：三墨一纸孔版后期（接管 renderer.render）

  // ---------- 一局 ----------
  let level, run, legs = makeLegs(), shake = 0, flash = 0, overAt = 0, jfSaid = '', bubbleUntil = 0, autoWalk = false;
  const seed0 = +(Q.get('seed') || (DEMO ? 5 : Date.now() % 100000));
  const rand = DEMO ? rng(7) : Math.random;
  let seed = seed0;
  let tierShown = -1, tierUpAt = -9;
  const lookS = new THREE.Vector3(0, -999, 0);                         // 跟拍镜头平滑后的注视点
  function newRun() {
    city.clear(); level = makeLevel(seed++); run = makeRun(level);
    lookS.y = -999;                                                       // 新一局：镜头看的点直接跳到位，不从上一局扫过来
    overAt = 0; jfSaid = ''; document.body.classList.remove('over'); document.body.classList.add('title');
  }
  newRun();
  let pend = { jump: false, slide: false, lane: 0, turn: 0, slideHold: false };

  // ---------- /state ----------
  let S = null, sAt = 0, lastT = null, legWalk = 0, audio = null;
  async function poll() {
    const t0 = performance.now();
    try {
      S = await fetch('/state', { cache: 'no-store' }).then(r => r.json()); sAt = performance.now() / 1000;
      $('banner').style.display = 'none';
      const f = S.frame;
      if (f && S.t !== lastT) {
        lastT = S.t;
        if (legWalk >= LEG_READY_S && !runner) {      // 关了跑步层（?runner=0）才走老路：直接用 10 Hz 原始样本
          const off = av.body.off, r = legs.push(-f.l - off, -f.r - off, -(f.ldps || 0), -(f.rdps || 0));
          if (r.jump) pend.jump = true;
          pend.slideHold = r.slide; if (r.slide) pend.slide = true;
        }
      }
    } catch (e) { $('banner').style.display = 'block'; $('banner').textContent = '连不上 ShellOS（/state）——确认 python -m shellos.main 在跑'; }
    setTimeout(poll, Math.max(0, 100 - (performance.now() - t0)));
  }
  if (!DEMO) poll();
  // 预览：合成髋角（人走路 / 跑步的髋角曲线），按 10 Hz 更新 S——和真机轮询一样，A2 的外推 + 滤波照常起作用
  let demoPh = 0, demoAt = -1;
  let G_MIN = 0; { let m = 1e9; for (let g = 0; g < 1; g += 1e-3) { const v = synthHip(g)[0]; if (v < m) { m = v; G_MIN = g; } } }
  function demoState(dt) {
    const f = CAD_DEMO / 120; demoPh = (demoPh + dt * f) % 1;
    if (clock - demoAt < 0.1) return;
    demoAt = clock;
    const [a, va] = synthHip(demoPh), [b, vb] = synthHip((demoPh + 0.5) % 1), on = clock > 0.6;
    const pl = ((demoPh - G_MIN) % 1 + 1) % 1;                     // 估计器相位 0 = 髋最伸（屈曲最小），和 shellos/gait 一样
    S = { t: clock, frame: { l: -a, r: -b, ldps: -va * f, rdps: -vb * f }, gait: { moving: on, cadence: on ? CAD_DEMO : 0, phase_l: pl, phase_r: (pl + 0.5) % 1 }, sim: { on: false }, terrain: { hs_phase: 0.5 } };
  }
  const say = key => {
    jfSaid = key; $('jfSay').textContent = JF[key]; bubbleUntil = clock + 2.5;
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
    else if (c === 'KeyA' || c === 'KeyQ') pend.turn = -1;                // 第 6 轮：A / D 转弯，← → 换道（路口转弯区里 ← → 也算转弯）
    else if (c === 'KeyD' || c === 'KeyE') pend.turn = 1;
    else if (c === 'ArrowLeft') laneOrTurn(-1);
    else if (c === 'ArrowRight') laneOrTurn(1);
    else if (c === 'Enter' && run.over) newRun();
    else if (CAD[c] && isSim()) post('/sim', { cadence: CAD[c] });
    if (c.startsWith('Arrow')) e.preventDefault();
  });
  addEventListener('keyup', e => { if (e.code === 'Space') walk(false); });
  // 路口转弯区里按 ← → 且方向对 = 转弯，否则换道
  function laneOrTurn(d) { const tn = level.turns.find(q => !q.done), dx = tn ? tn.s - run.x : 99; if (tn && tn.d === d && dx < TUNE.TURN_ZONE && dx > -TUNE.WALL_D) pend.turn = d; else pend.lane = d; }
  // 手柄（浏览器 Gamepad API，只读；R2 死人开关仍归 ShellOS）：L1 / R1 转弯，十字键 / 左摇杆换道，× 跳，○ 滑。按一下触发一次
  const padPrev = {};
  function pollPad() {
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find(p => p && p.connected) : null;
    if (!gp) return;
    const b = i => !!(gp.buttons[i] && gp.buttons[i].pressed), ax = gp.axes[0] || 0;
    const now = { L1: b(4), R1: b(5), left: b(14) || ax < -0.5, right: b(15) || ax > 0.5, x: b(0), o: b(1) };
    const edge = k => now[k] && !padPrev[k];
    if (edge('L1')) pend.turn = -1; if (edge('R1')) pend.turn = 1;
    if (edge('left')) laneOrTurn(-1); if (edge('right')) laneOrTurn(1);
    if (edge('x')) pend.jump = true; if (edge('o')) pend.slide = true;
    Object.assign(padPrev, now);
  }
  addEventListener('blur', () => walk(false));

  // ---------- 自动驾驶（?auto=p）：每个障碍按概率 p 决定躲不躲 ----------
  // 离下一次 lift 出力还有几秒（两条腿取近的）：/state 的步态相位按步频外推到现在
  const CAD_NOW = () => (S && S.gait && S.gait.cadence) || 0;           // 现在的步频（没有 = 0，jumpLen 按 150 算）
  const liftIn = () => {
    const g = S && S.gait; if (!g || !(g.cadence > 0) || g.phase_l == null) return 9;
    const f = g.cadence / 120, lp = (((S.terrain && S.terrain.hs_phase) ?? 0.5) + TUNE.LIFT_LIT) % 1, age = DEMO ? clock - S.t : performance.now() / 1000 - sAt + 0.01;   // 样本多旧（真机：收到时刻 + 服务端 ~10 ms）
    return Math.min(...[g.phase_l, g.phase_r].map(p => (((lp - p - age * f) % 1) + 1) % 1 / f));
  };
  let dtNow = 1 / 60, liPrev = 9;
  function autopilot() {
    if (isSim() && !autoWalk) { autoWalk = true; post('/sim', { walk: true, cadence: 130 }); }
    if (run.over) { if (clock - overAt > 8) newRun(); return; }
    const th = nextThreat(run, level, 6);
    if (!th) return;
    if (th.o.ap === undefined) th.o.ap = rand() < AUTO;
    if (!th.o.ap) return;
    // 第 5 轮：跳对到 lift 那一拍。lift 由 ShellOS 的步态估计相位触发（terrain.py：文献相位 68% = 估计器相位 (hs_phase + 0.68) % 1），
    //   /state 里就有这两个数：把 gait.phase_l / phase_r 按步频外推到现在，哪条腿这一帧跨过 lift 相位就起跳——和腿上出力用的是同一个钟。只在安全窗口里等：
    //   最早 = 还跳得过（楼缝：落点过对面楼沿 0.6 m；矮障碍：够高的那段滞空盖住它），最晚 = 原来的起跳距离（不会比以前更晚）
    if (th.what === 'jump') {
      // 安全窗口按弧线算（第 8 轮：跳按路程参数化）：矮障碍 = 脚在 LOW_H 以上的那段 r ∈ [r1, 1 − r1] 盖住它（盒子 ±0.75 再留 0.3）；
      //   楼缝 = 楼沿前 0.35 m 以内起跳、落点过对面 0.6 m；最晚再留两帧的路
      const v = Math.max(run.speed, 1), Lj = jumpLen(run.speed, CAD_NOW(), TUNE), gap = th.o.kind === 'gap', r1 = Math.asin(Math.min(1, TUNE.LOW_H / TUNE.JUMP_H)) / Math.PI;
      const late = (gap ? 0.35 : r1 * Lj + 0.6) + v * 2 / 60, early = gap ? Lj - (th.o.x1 - th.o.x0) - 0.6 : (1 - r1) * Lj - 1.5;
      const li = liftIn(), beat = li < dtNow / 2 || li > liPrev + dtNow / 2;   // 这一帧最接近 lift 出力（刚要到 / 刚过去）
      liPrev = li;
      if (th.dx < late || (th.dx < early && beat)) pend.jump = true;
    } else liPrev = 9;
    if (th.what === 'slide' && th.dx < 2.2) pend.slide = true;
    if (th.what === 'turn' && th.dx < TUNE.TURN_ZONE * 0.6) pend.turn = th.o.d;
    if (th.what === 'lane') { const free = [0, 1, 2].filter(l => !th.o.lanes.includes(l)).sort((a, b) => Math.abs(a - run.lane) - Math.abs(b - run.lane)); pend.lane = Math.sign(free[0] - run.lane); }
  }

  // ---------- 每帧 ----------
  const P = new THREE.Vector3(), camP = new THREE.Vector3(), look = new THREE.Vector3(), dir = new THREE.Vector3(1, 0, 0), jfP = new THREE.Vector3(), fwd = new THREE.Vector3();
  const PW = {}, CW = {}, LW = {};
  av.group.rotation.order = jf.group.rotation.order = 'YXZ';          // 先转朝向（路口 90°），再侧倾 / 前后倾——转弯以后侧倾还是绕身体自己的轴
  const legFor = s => s >= run.leg.s0 ? run.leg : level.legAt(s);   // 镜头在身后：还没过路口的那段用老腿
  let last = performance.now(), frames = 0, fpsT = last, camY = run.y, jfPhase = 0, tilt = 0, jfZ = 1.8, sideY = run.y, lastG = run.y, lastZ = 0, clock = DEMO ? 0 : last / 1000;
  const HINT = { jump: '高抬腿 · 跳！', slide: '下蹲 · 滑铲！', lane: '← → 换道！', turnL: '← 左转（A / L1）', turnR: '右转 →（D / R1）' };
  function frame(dtFix) {
    if (!MANUAL) requestAnimationFrame(() => frame());
    const nowMs = performance.now(), dtR = dtFix || Math.min(0.1, (nowMs - last) / 1000); last = nowMs;
    clock += dtR; const t = clock;
    if (DEMO) demoState(dtR);
    const g = S && S.gait;
    const moving = !!(g && g.moving);
    if (moving) legWalk += dtR;
    dtNow = dtR;
    pollPad();
    if (AUTO) autopilot();
    const vT = speedFor(g ? g.cadence : 0, moving);
    {
      const inp = { v: vT, cad: g ? g.cadence : 0, jump: pend.jump, slide: pend.slide || pend.slideHold, lane: pend.lane, turn: pend.turn };
      pend.jump = pend.slide = false; pend.lane = 0; pend.turn = 0;
      const n = Math.ceil(dtR / (1 / 120));
      for (let i = 0; i < n; i++) { run.step(dtR / n, i ? { v: vT } : inp); }
    }
    if (run.over && t - overAt > 3 && pend.jump) newRun();   // 穿着外骨骼按不了回车：高抬腿再来一局
    for (const ev of run.events.splice(0)) {
      if (ev === 'start') { document.body.classList.remove('title'); say('start'); }
      if (ev === 'turn' || ev === 'turnMiss') lastZ = run.z;               // 转弯时横向坐标换了一套，别当成横向速度
      if (['low', 'high', 'block', 'fall', 'wall', 'caught', 'corner'].includes(ev)) { shake = 0.5; flash = 1; $('hitWhy').textContent = { low: '撞上空调外机', high: '被晾衣杆拦住', block: '撞上水箱', fall: '掉下楼缝', wall: '撞上楼沿', caught: '被捷风追上', corner: '没转弯，撞上路口的墙' }[ev]; if (ev === 'caught') { say('caught'); jf.burst(); } }
      if (ev === 'over') { overAt = t; $('goT').textContent = $('hitWhy').textContent === '被捷风追上' ? '被捷风抓住了' : '峰哥倒下了'; const b = best.get(), d = Math.floor(run.dist); if (d > b) best.set(d); $('goDist').textContent = d; $('goBest').textContent = Math.max(b, d); $('goNew').style.display = d > b ? 'block' : 'none'; document.body.classList.add('over'); }
    }
    if (run.jfGap > 14 && jfSaid !== 'lost' && run.started) say('lost');
    else if (run.jfGap < 4 && jfSaid !== 'dash' && jfSaid !== 'caught' && run.started && !run.over) say('dash');
    if (jfSaid === 'lost' && run.jfGap < 9) jfSaid = '';
    if (jfSaid === 'caught' && run.jfGap > 6) jfSaid = '';

    // 腿上的力
    if (!away) setForce(forceKind(run, level), t);
    else if (forceSent !== null) forceOff();

    // 场景
    atLeg(run.leg, run.x, run.z, PW);
    city.sync(level, PW);
    const seg = level.seg(run.x), gy = level.ground(run.x);
    P.set(PW.x, run.y, PW.z);
    av.group.position.copy(P);
    const slide = run.slideT > 0;
    // 根节点：滑铲后仰 0.6 rad（绕脚转，再把人往下放 0.3，屁股贴着地；腿怎么摆在 runner.js），腾空微前倾
    tilt = damp(TS, 't', slide ? 0.6 : run.air ? -0.12 : 0, dtR, 22);
    // 朝向：路口转 90°，用弹簧追（0.3 s 转过去）；先展开角度差，免得绕远路
    { let yT = yawOf(run.leg.dir); while (yT - TS.yaw > Math.PI) yT -= 2 * Math.PI; while (yT - TS.yaw < -Math.PI) yT += 2 * Math.PI; damp(TS, 'yaw', yT, dtR, 16); }
    av.group.rotation.set(runner ? runner.roll : 0, TS.yaw + (runner ? runner.yaw : 0), tilt);
    av.group.position.y -= 0.5 * Math.max(0, tilt);
    // 撞了之后的无敌时间：不再 6 Hz 整个人一闪一闪（硬切，也超过 ART 的 2 Hz 上限），改成轮廓光 2 Hz 平滑泛红
    if (avLook) { const k = run.invuln > 0 ? (0.5 - 0.5 * Math.cos(clock * 4 * Math.PI)) * Math.min(1, run.invuln / 0.3) : 0;
      avLook.uRim.value.copy(rim0).lerp(DANGER, k); avLook.uRimK.value = rimK0 + 1.6 * k; }
    if (runner) {                                   // 前方马上要跳（楼缝 / 矮障碍）：0.35 s 内开始预判下沉，到边上蹲到 1
      if (gy !== null && !run.air) lastG = gy;       // 离地高度按起跳那栋楼算（空中飞过楼缝时脚下没地）
      const th = run.started && !run.air ? nextThreat(run, level, 8) : null;
      const ttc = th && th.what === 'jump' ? th.dx / Math.max(run.speed, 1) : 9;
      const vz = (run.z - lastZ) / Math.max(dtR, 1e-3); lastZ = run.z;
      runner.set({ v: run.speed, lat: run.laneZ(run.lane) - run.z, vz, air: run.air, vy: run.vy, h: run.y - lastG, pre: Math.max(0, Math.min(1, (0.35 - ttc) / 0.3)), slide });
      av.group.position.y += runner.rootDy;
    }
    // 第 5 轮：高抬腿 / 下蹲识别用 A2 跟踪后的髋角（按设备角速度外推到现在 + one-euro，60 fps），再往前看 JUMP_LEAD 秒。
    //   原来等 10 Hz 样本（平均晚 ~50 ms，外加跨阈值要等下一拍），起跳帧离 lift 出力那一拍更远
    if (runner && !DEMO && legWalk >= LEG_READY_S && S && S.frame) {
      const h = runner.hip, off = av.body.off, L = TUNE.JUMP_LEAD, r = legs.push(h.fl - off + h.wl * L, h.fr - off + h.wr * L, h.wl, h.wr);
      if (r.jump) pend.jump = true;
      pend.slideHold = r.slide; if (r.slide) pend.slide = true;
    }
    av.animate(dtR, t, { state: S && S.frame ? S : null, fl: 5, fr: 5, kind: run.air ? 'stairs_up' : seg && seg.kind === 'ramp' ? 'up' : 'flat', summit: false });

    // 捷风：在身后 jfGap 米。构图（ART §8）：离镜头横向固定 1.8（站到峰哥另一侧，不在左下前景被切一半、不压左下腿力面板），
    //   jfGap ≤ 1.8（离镜头 ≥ 2.5）才现身；再远只留右上角距离条。STL 雕像四肢不能动：和登山游戏一样风系飘行（npc.js）
    const jx = run.x - run.jfGap, jy = level.ground(jx) ?? run.y, camZ = run.z * 0.55, chasing = run.jfV > 0, jleg = legFor(jx);
    jfZ += ((camZ <= 0 ? camZ + 1.8 : camZ - 1.8) - jfZ) * (1 - Math.exp(-dtR * 4));
    atLeg(jleg, jx, jfZ, LW); jfP.set(LW.x, jy, LW.z); dir.set(H4[jleg.dir][0], 0, H4[jleg.dir][1]);
    jf.group.position.copy(jfP);
    jfPhase += dtR * Math.PI * Math.max(1.5, (run.jfV || 6) / 2.2);
    const jfLean = jf.statue ? (chasing ? 0.13 + (run.jfGap < 5 ? 0.32 : 0) : 0.03) : chasing ? 0.25 : 0;
    jf.group.rotation.set(0, yawOf(jleg.dir), -jfLean);
    if (jf.statue) { jf.group.position.y += chasing ? 0.1 + 0.05 * Math.sin(jfPhase * 2) : 0.07 + 0.03 * Math.sin(t * 2.2); jf.group.scale.y = 1 + 0.012 * Math.sin(t * 1.8); }
    if (chasing) jf.pose(38 * Math.sin(jfPhase), 38 * Math.sin(jfPhase + Math.PI)); else jf.pose(-4, 6);
    jf.visible = run.jfGap <= 1.8;
    jf.update(dtR, jfP, dir, run.jfGap < 5 ? 1 : 0.3);

    // 镜头：身后偏上；跳的时候不跟满，落地有顿挫；撞了抖
    camY += ((gy ?? run.y) - camY) * (1 - Math.exp(-dtR * 4));
    const dip = runner ? runner.comp * runner.RUN.CAM_DIP : 0;   // 落地那一下镜头跟着沉
    const fov = 60 + Math.min(10, run.speed * 0.6);
    if (CAM !== 'side' && CAM !== 'top' && Math.abs(camera.fov - fov) > 0.2) { camera.fov += (fov - camera.fov) * 0.1; camera.updateProjectionMatrix(); }
    shake = Math.max(0, shake - dtR); flash = Math.max(0, flash - dtR * 2.5);
    const sh = shake * 0.4;
    if (CAM === 'side') {                        // 侧面（调动作用）：站在跑道右边平视，跟着人平移
      sideY += (run.y - sideY) * (1 - Math.exp(-dtR * 12));
      atLeg(run.leg, run.x + 0.2, run.z + 3.0, CW); camera.position.set(CW.x, sideY + 0.95, CW.z); look.set(PW.x, sideY + 0.8, PW.z);
      if (camera.fov !== 38) { camera.fov = 38; camera.updateProjectionMatrix(); }
    } else if (CAM === 'top') {                  // 俯视（看路线 / 转弯用）
      camera.position.set(PW.x, run.y + 110, PW.z + 0.01); look.set(PW.x, run.y, PW.z);
      if (camera.fov !== 55) { camera.fov = 55; camera.updateProjectionMatrix(); }
    } else {
      const cs = run.x - 4.3; atLeg(legFor(cs), cs, run.z * 0.55, CW);   // 过路口时镜头先在老腿上，跟着甩过去（lerp 平滑）
      camP.set(CW.x + (rand() - 0.5) * sh, Math.max(camY, run.y - 1) + 2.0 + dip + (rand() - 0.5) * sh, CW.z);
      camera.position.lerp(camP, 1 - Math.exp(-dtR * 10));
      atLeg(run.leg, run.x + 7, run.z * 0.3, LW); look.set(LW.x, Math.max(camY, run.y - 0.5) + 1.0 + dip, LW.z);
      // 看的点也平滑追（过路口时朝向 90° 一下子换了；只平滑水平面，高度照旧跟手，落地下沉不打折）
      if (lookS.y === -999) lookS.copy(look); else { const k = 1 - Math.exp(-dtR * 7); lookS.x += (look.x - lookS.x) * k; lookS.z += (look.z - lookS.z) * k; }
      lookS.y = look.y; look.copy(lookS);
    }
    camera.lookAt(look);
    if (cloth) cloth.update(dtR, camera.position, true, fwd.set(Math.cos(TS.yaw), 0, -Math.sin(TS.yaw)));
    moonL.position.set(PW.x - 30, 60, PW.z - 40); moonL.target.position.set(PW.x, 0, PW.z);
    renderer.render(scene, camera);

    // HUD
    if (!document.body.dataset.ready) document.body.dataset.ready = '1';
    $('dist').textContent = Math.floor(run.dist);
    { const tr = tierAt(run.x), i = TIERS.indexOf(tr); if (i !== tierShown) { if (tierShown >= 0) { $('tier').classList.add('up'); tierUpAt = clock; } tierShown = i; $('tier').textContent = `第 ${i + 1} 级 · ${tr.name}`; }   // 第 7 轮：难度只随距离升
      if (clock - tierUpAt > 2.5) $('tier').classList.remove('up'); }
    $('lives').innerHTML = [0, 1, 2].map(i => `<i class="${i < run.lives ? 'on' : ''}"></i>`).join('');
    $('spd').textContent = (run.speed * 3.6).toFixed(0);
    $('cad').textContent = moving ? Math.round(g.cadence || 0) : '—';
    const gp = Math.max(0, Math.min(1, run.jfGap / TUNE.JF_GAPMAX));
    $('jfBar').style.width = `${(1 - gp) * 100}%`; $('jfM').textContent = `${run.jfGap.toFixed(1)} m`;
    document.body.classList.toggle('danger', run.started && run.jfGap < 4);
    $('flash').style.opacity = flash * 0.55;
    document.body.classList.toggle('talk', t < bubbleUntil);
    const th = run.started && !run.over ? nextThreat(run, level, run.speed * 1.4 + 3) : null;
    const hk = th ? (th.what === 'turn' ? (th.o.d < 0 ? 'turnL' : 'turnR') : th.what) : '';
    $('hint').textContent = hk ? HINT[hk] : ''; $('hint').className = 'hud ' + (th ? th.what : '');
    if (S) {
      const sent = (S.safety && S.safety.sent) || [0, 0];
      for (const [k, i] of [['L', 0], ['R', 1]]) { const v = Math.max(-1, Math.min(1, sent[i] / ((S.safety && S.safety.cap) || 3))); const b = $('bar' + k); b.style.left = v < 0 ? `${50 + v * 50}%` : '50%'; b.style.width = `${Math.abs(v) * 50}%`; }
      const terrainOn = S.ctl && S.ctl.name === 'terrain';
      const held = S.safety && S.safety.deadman > 0.05;
      $('force').textContent = !terrainOn ? '腿上的力：关（控制律不是 terrain）' : away ? '腿上的力：暂停（页面没焦点，点一下画面）'
        : `腿上的力：${{ up: '上坡 · 后面推', down: '落地 · 制动', lift: '准备起跳 · 帮抬腿' }[forceSent] || '平地'}`;
      $('r2').textContent = isSim() ? '模拟模式' : held ? 'R2 按住 · 有力' : '按住 R2 才有力';
      $('r2').className = held || isSim() ? 'ok' : '';
      $('legs').textContent = legWalk >= LEG_READY_S ? '腿：高抬腿 = 跳 · 下蹲 = 滑铲' : `腿：校准中，先走 ${Math.ceil(LEG_READY_S - legWalk)} s`;
      $('simHint').style.display = isSim() ? 'inline' : 'none';
    }
    frames++;
    if (nowMs - fpsT > 1000) { window.__fps = frames * 1000 / (nowMs - fpsT); $('fps').textContent = `${window.__fps.toFixed(0)} fps${LOW ? ' · low' : ''}`; frames = 0; fpsT = nowMs; }
  }
  frame(MANUAL ? 1 / 60 : 0);
  window.__pk = { get run() { return run; }, get level() { return level; }, get S() { return S; }, press: (k) => { pend[k] = k === 'lane' ? 1 : true; }, renderer, scene, newRun, av, runner,
    get clock() { return clock; },
    tick(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) frame(dt); return { t: clock, x: run.x, y: run.y, air: run.air, vy: run.vy, slide: run.slideT > 0, lane: run.lane, z: run.z, speed: run.speed, over: run.over, lives: run.lives, dir: run.leg.dir }; } };
}

main().catch(e => { err('跑酷启动失败', e); $('banner').style.display = 'block'; $('banner').textContent = '跑酷启动失败：' + e.message; });
