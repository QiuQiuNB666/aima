// 「山的记忆」游戏引擎：只读 /state（10 Hz），60 fps 插值；动作只发 /sim、/demo/reset、/ctl、/terrain。
// 离线预览：/game?preview=<world_id>&pos=<n>&ghost=<n>[&who=名字][&summit=1][&still=秒（红灯站定计时）][&aa=0] —— 不轮询，用 /worlds.json 摆静态画面（截图/精加工地图用）。
// 主题插件：themes/<theme.style>.js，export build(scene, ctx)、update(dt, st)、可选 pathMaterials(ctx)——接口见 docs/游戏主题接口.md。
// 截图/自检：出错写进 <pre id="errlog">（game.html），第一帧画完 <body data-ready="1" data-calls data-tris data-scene-tris>；scripts/dom.sh 读。
import * as THREE from 'three';
import { makeRoute, buildPathMeshes, updateSignals, hashStr, rng, APRON, STEP, ROAD_W } from './path.js';
import { loadAvatar, flexFromFrame, preloadAvatar } from './avatar.js';
import { dressFengge } from './fengge.js';   // H 线：峰哥头（只给玩家化身，影子不换）；?fengge=0 关
import { initFenggeHud } from './fengge_hud.js';   // H 线：峰哥画中画头像 + 解说气泡；?fengge=0 关
import { makeStepper, makeGhost } from './ghost.js';
import { makeCamera, defaultRig } from './camera.js';
import { makeHud } from './hud.js';
import { makeFx } from './fx.js';
import { bindInput } from './input.js';
import * as kit from './themes/kit.js';
import * as util from './util.js';

const Q = new URLSearchParams(location.search);
const PREVIEW = Q.get('preview');
const POLL_MS = 100, LAG = 0.13;             // 髋角插值：落后最新样本 130 ms，两帧之间线性插
const AV_LAT = 0.35, GH_LAT = -0.5;          // 化身靠左（离镜头近），影子靠右；主题可设 theme.ghostLat（夹在路沿内 0.4）
const SUMMIT_HOLD = 6.0;
const SUMMIT_BREAK = 3;                      // 登顶卡期间 pos 到这一步或碰到红灯 → 提前收起（第 2 圈起东京 4 步就是红灯）
const GH_FADE = [1.5, 2.5];                  // 影子落后化身 1.5 步开始变淡、2.5 步全隐藏：再往后它就在镜头和化身之间，贴脸一个大头（按镜头距离分不开：台阶上并排的影子离镜头也才 ~4）
const post = (p, b) => fetch(p, { method: 'POST', body: JSON.stringify(b || {}) }).then(r => r.json()).catch(() => null);
const getState = () => fetch('/state', { cache: 'no-store' }).then(r => r.json());
const err = (m, e) => { console.error(m, e); if (window.__err) window.__err(`${m}${e ? '：' + (e.stack || e) : ''}`); };

// ---------- 世界数据 ----------
function routeFromStatus(T) {             // /worlds.json 里找不到时，用 /state 的 segments + profile 拼路线
  let i = 0;
  return T.segments.map(([kind, steps]) => { const label = (T.profile[i] || {}).label || kind; i += steps; return { kind, steps, label }; });
}
function statusFor(world, pos, ghost, who) {   // 预览用：按 terrain.status() 同样的规则算
  const R = world.route, total = R.reduce((a, s) => a + s.steps, 0);
  pos = Math.max(0, Math.min(total - 1, pos | 0));
  const RISE = { flat: 0, up: .08, down: -.08, stairs_up: .12, stairs_down: -.12, wait: 0 };
  const hs = []; let h = 0; R.forEach(s => { for (let k = 0; k < s.steps; k++) { hs.push(h); h += RISE[s.kind]; } });
  let i = 0, off = pos; while (off >= R[i].steps) { off -= R[i].steps; i++; }
  let next = null;
  for (let j = i + 1; j < R.length; j++) if (R[j].kind !== R[i].kind) { next = { label: R[j].label, kind: R[j].kind, in: R.slice(i, j).reduce((a, s) => a + s.steps, 0) - off }; break; }
  const hmax = Math.max(...hs) || 1, [a0, a1] = world.alt || [0, 0];
  return {
    preset: world.id, world, pos, total, laps: 0, segment: R[i].kind, label: R[i].label, next,
    wait_still: R[i].kind === 'wait' && Q.has('still') ? +Q.get('still') : null, wait_need: 1.5,
    altitude: Math.round(a0 + (a1 - a0) * (hs[pos] / hmax)), force: null, segments: R.map(s => [s.kind, s.steps]),
    elapsed: +(pos * 0.62).toFixed(1), best: null, last_lap: null,
    ghost_pos: ghost == null ? null : Math.max(0, Math.min(total, ghost | 0)), ghost_who: who,
  };
}

async function waitForTerrain(hud) {
  for (;;) {
    let S = null;
    try { S = await getState(); } catch (e) { hud.banner('连不上 ShellOS（/state）——确认 python -m shellos.main 在跑'); }
    if (S && (S.terrain || isPuppet(S))) { hud.banner(''); return S; }   // puppet：共驾画面，不是报错
    if (S) {
      hud.banner(`当前控制律是 <b>${S.ctl ? S.ctl.name : '?'}</b>，不是地形。<br><button id="toTerrain">切到地形（terrain）</button> <a href="/worlds" style="color:#fff">或先选一座山</a>`);
      const b = document.getElementById('toTerrain'); if (b) b.onclick = () => post('/ctl', { name: 'terrain' });
    }
    await new Promise(r => setTimeout(r, 1000));
  }
}

const isPuppet = S => !!(S && !S.terrain && S.ctl && S.ctl.name === 'puppet');

async function main() {
  preloadAvatar();                           // glb 和 worlds.json / 主题并行下载
  const worlds = await fetch('/worlds.json').then(r => r.json()).catch(() => []);
  const bannerOnly = { banner: h => { const b = document.getElementById('banner'); b.style.display = h ? 'block' : 'none'; b.innerHTML = h; } };
  let S, world;
  if (PREVIEW) {
    world = worlds.find(w => w.id === PREVIEW) || worlds[0];
    if (!world) { bannerOnly.banner('没有世界数据（/worlds.json）'); return; }
    const T = statusFor(world, +(Q.get('pos') || 0), Q.has('ghost') ? +Q.get('ghost') : null, Q.get('who') || '球球');
    S = { terrain: T, safety: { state: 'PREVIEW', sent: [0, 0], cap: 3, reason: '' }, sim: { on: false }, wearer: Q.get('wearer') || '—',
          gait: { moving: false }, frame: { l: -26, r: 12 }, memory: null };
  } else {
    S = await waitForTerrain(bannerOnly);
    world = S.terrain ? worlds.find(w => w.id === S.terrain.preset) : (worlds.find(w => w.id === 'tokyo_night') || worlds[0]);
    if (!world && S.terrain) world = { ...S.terrain.world, alt: [0, 0], route: routeFromStatus(S.terrain) };
    if (!world) { bannerOnly.banner('没有世界数据（/worlds.json）'); return; }
    if (!S.terrain) S = { ...S, terrain: null, _T: statusFor(world, 0, null, '') };   // 共驾开场：先摆默认世界，切回 terrain 时同一个世界接着走
  }
  const theme = world.theme || {};
  const hud = makeHud(world);
  initFenggeHud();

  // ---------- 渲染器 / 场景 ----------
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.get('aa') !== '0', powerPreference: 'high-performance' });   // ?aa=0 = 降画质（关抗锯齿）
  renderer.setPixelRatio(1);                  // 规格：pixelRatio=1、不开阴影
  renderer.shadowMap.enabled = false;
  renderer.setSize(innerWidth, innerHeight, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.fog || '#000');
  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 1200);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 1.2);
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(-20, 30, 12); scene.add(hemi, sun, sun.target);
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

  const seed = hashStr(world.id);
  const route = makeRoute(world.route, seed);
  const c = kit.routeCenter(route); sun.target.position.copy(c); sun.position.set(c.x - 20, 30, c.z + 12);
  const camRig = defaultRig(); camRig.summit.center = route.at(route.N + 1.2).pos.clone();
  const ctx = { THREE, scene, world, theme, route, steps: route.steps, meshes: null, lights: { hemi, sun }, camera, camRig, renderer, kit, util, preview: !!PREVIEW, rand: rng(seed) };
  let themeMod;
  try { themeMod = await import(`./themes/${theme.style || 'grid'}.js`); } catch (e) { err(`主题 ${theme.style} 加载失败，改用 grid`, e); themeMod = await import('./themes/grid.js'); }
  let mats = {};
  if (themeMod.pathMaterials) try { mats = themeMod.pathMaterials(ctx) || {}; } catch (e) { err('pathMaterials 出错', e); }
  const meshes = ctx.meshes = buildPathMeshes(scene, route, theme, mats);
  try { themeMod.build(scene, ctx); } catch (e) { err(`主题 ${theme.style} build 出错（场景可能缺东西）`, e); }
  let themeErr = false;

  const ghOp = theme.ghostOpacity || 0.4;
  const ghLat = -Math.min(ROAD_W / 2 - 0.4, Math.abs(theme.ghostLat ?? GH_LAT));   // build 之后读：主题可以在 build 里改 ctx.theme
  const [av, gh] = await Promise.all([loadAvatar({ look: theme.avatar }),
    loadAvatar({ ghost: true, color: theme.ghost || '#bff3ff', opacity: ghOp, rim: theme.ghostRim, halo: !!theme.ghostHalo })]);
  if (Q.get('fengge') !== '0') try { await dressFengge(av); } catch (e) { err('峰哥头加载失败，用原头盔', e); }
  const tagLift = theme.ghostTagLift ?? 0.6;   // 影子标签底边 = 脖子关节上方 0.6（头顶上方约 0.3）
  document.body.classList.toggle('sc-left', theme.summitCard === 'left');
  if (PREVIEW) document.body.classList.add('preview');   // 预览：登顶卡不做 2 s 延迟淡入，截图时刻稳定
  scene.add(av.group, gh.group);
  const ghost = makeGhost(gh, hud);
  const cam = makeCamera(camera, route, camRig);
  const fx = makeFx(scene, route, meshes);
  const me = makeStepper();

  // ---------- 状态 ----------
  let T = S.terrain || S._T, lastLaps = T.laps, lastPos = T.pos, summitUntil = 0, flashUntil = [0, 0], prevSent = [0, 0];
  const hip = [];                            // [{t, fl, fr}] 髋角样本
  const now0 = () => performance.now() / 1000;
  me.set(T.pos, now0(), true);
  if (PREVIEW) me.jump(T.segment === 'wait' ? T.pos : T.pos + 0.4);
  ghost.onState(T, now0());
  if (PREVIEW && T.ghost_pos != null) ghost.stepper.jump(T.ghost_pos + 0.4);
  updateSignals(meshes, T.pos);
  hud.update(S, false, false);
  if (PREVIEW && Q.has('summit')) {          // &summit=1：登顶画面（环绕镜头 + 登顶卡片），给截图/精加工山顶用
    summitUntil = 1e12; me.jump(route.N + 1.2);
    hud.summit(true, { ...T, laps: 1, last_lap: T.total * 0.62, best: null }, null);
    hud.update(S, false, false, true);
  }

  hud.puppet(isPuppet(S));
  function onState(ns) {
    const t = now0();
    S = ns;
    const nt = ns.terrain;
    const [fl, fr] = flexFromFrame(ns.frame); hip.push({ t, fl, fr }); while (hip.length > 8) hip.shift();
    const sent = (ns.safety && ns.safety.sent) || [0, 0];
    for (let k = 0; k < 2; k++) {            // 脉冲：|T| 上升沿过 0.25 Nm
      const a = Math.abs(sent[k]);
      if (a > 0.25 && Math.abs(prevSent[k]) <= 0.25) { flashUntil[k] = t + 0.3; fx.pulse(av.group.position, Math.min(route.N - 1, Math.floor(me.s)), a / 1.5); }
      prevSent[k] = sent[k];
    }
    if (!nt) {                               // puppet = 共驾画面（力矩条 + 化身照常动）；其它控制律才是调试横幅
      const pup = isPuppet(ns);
      hud.puppet(pup); hud.banner(pup ? '' : '控制律已切走（不是 terrain）——游戏暂停');
      ghost.onState(null, t);
      hud.update(ns, t < flashUntil[0], t < flashUntil[1], false);
      return;
    }
    hud.puppet(false); hud.banner('');
    if (nt.preset !== T.preset) { location.reload(); return; }
    if (nt.laps > lastLaps) {                // 登顶：化身留在山顶，镜头环绕，彩带
      summitUntil = t + SUMMIT_HOLD;
      fx.summit(route.at(route.N + 1.2).pos);
      hud.summit(true, nt, T.best);
    } else if (t < summitUntil && (nt.pos >= SUMMIT_BREAK || nt.segment === 'wait')) summitUntil = t;   // 接着走了：收起登顶，frame() 里把化身放回当前步
    else if (nt.pos < lastPos && t > summitUntil) me.set(nt.pos, t, true);   // 复位（R / 换人）
    lastLaps = nt.laps; lastPos = nt.pos; T = nt;
    if (t > summitUntil) me.set(nt.pos, t);
    ghost.onState(nt, t);
    updateSignals(meshes, nt.pos);
    hud.update(ns, t < flashUntil[0], t < flashUntil[1], t < summitUntil);
  }
  async function poll() {
    const t0 = performance.now();
    try { onState(await getState()); } catch (e) { hud.banner('和 ShellOS 断开了，重连中…'); }
    setTimeout(poll, Math.max(0, POLL_MS - (performance.now() - t0)));
  }
  if (!PREVIEW) {
    bindInput(post, () => !!(S.sim && S.sim.on));
    setTimeout(poll, POLL_MS);
  }

  // ---------- 每帧 ----------
  const A = {}, G = {}, head = new THREE.Vector3();
  let last = performance.now(), frames = 0, fpsT = last, yaw = null, gyaw = null;
  const lerpAng = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
  function hipAt(t) {
    if (!hip.length) return flexFromFrame(S.frame);
    const rt = t - LAG;
    for (let k = hip.length - 1; k > 0; k--) {
      const a = hip[k - 1], b = hip[k];
      if (rt >= a.t) { const u = Math.min(1, (rt - a.t) / Math.max(1e-3, b.t - a.t)); return [a.fl + (b.fl - a.fl) * u, a.fr + (b.fr - a.fr) * u]; }
    }
    return [hip[0].fl, hip[0].fr];
  }
  function frame() {
    requestAnimationFrame(frame);
    const nowMs = performance.now(), dt = Math.min(0.1, (nowMs - last) / 1000), t = nowMs / 1000; last = nowMs;
    const summit = t < summitUntil;
    let cut = false;                           // 登顶收起：化身从山顶回到当前步（登顶期间可能已走了几步）——硬切 + 淡入，镜头/朝向一起跳，不从山顶飞下来
    if (!summit && summitUntil) { summitUntil = 0; hud.summit(false); me.set(T.pos, t, true); cut = true; yaw = null; hud.cut(); }
    const moving = !!(S.gait && S.gait.moving) && !!S.terrain && T.segment !== 'wait';
    const s = summit ? Math.min(route.N + 1.2, me.s + dt * 2) : (PREVIEW ? me.s : me.frame(dt, t, moving));
    if (summit) me.jump(s);
    route.at(s, AV_LAT, A);
    av.group.position.copy(A.pos);
    yaw = yaw === null ? -A.heading : lerpAng(yaw, -A.heading, 1 - Math.exp(-dt * 6));
    av.group.rotation.y = yaw;
    const [fl, fr] = PREVIEW ? flexFromFrame(S.frame) : hipAt(t);
    av.pose(fl, fr);

    const g = PREVIEW ? (ghost.visible ? { s: ghost.stepper.s, rel: '' } : null) : ghost.frame(dt, t, route.N);
    if (PREVIEW && ghost.visible) gh.pose(-8, 22);
    if (g) {
      route.at(g.s, ghLat, G);
      gh.group.position.copy(G.pos);
      gyaw = gyaw === null ? -G.heading : lerpAng(gyaw, -G.heading, 1 - Math.exp(-dt * 6));
      gh.group.rotation.y = gyaw;
    }
    if (themeMod.rigFor && !themeErr) try { themeMod.rigFor(s, camRig, summit); } catch (e) { themeErr = true; err(`主题 ${theme.style} rigFor 出错`, e); }
    if (!window.__camHold) cam.update(dt, A, summit ? 'summit' : (window.__camMode || 'follow'), PREVIEW || cut, s);   // __camHold：调试时手动摆镜头
    fx.update(dt, t);
    if (themeMod.update && !themeErr) try { themeMod.update(dt, { t, dt, s, progress: Math.max(0, Math.min(1, s / route.N)), pos: T.pos, total: T.total, avatar: A.pos, heading: A.heading, kind: A.kind, ghost: g ? G.pos : null, terrain: T, summit, preview: !!PREVIEW, camera }); }
      catch (e) { themeErr = true; err(`主题 ${theme.style} update 出错（之后不再调用）`, e); }
    renderer.render(scene, camera);
    if (!document.body.dataset.ready) {        // 第一帧画完：给 dom.sh / 截图脚本读就绪与预算
      const r = util.stats(renderer), a = util.sceneStats(scene), b = document.body.dataset;
      if (av.group.getObjectByName('exoStrip')) for (const m of av.exo.bars) m.visible = false;   // 主题自己做了腿侧亮条（富士山）：引擎的连杆/腰带让位
      b.calls = r.calls; b.tris = r.triangles; b.sceneTris = a.triangles; b.sceneObjs = a.objects; b.ready = '1';
    }

    if (g) {                                   // 影子头顶标签：投影到屏幕；出画/贴镜头时钉在下缘
      gh.headWorld(head);
      const fade = summit ? 1 : Math.max(0, Math.min(1, (GH_FADE[1] - (s - g.s)) / (GH_FADE[1] - GH_FADE[0])));   // 登顶环绕镜头不在影子正后方：别淡掉
      for (const m of gh.mats) m.opacity = ghOp * fade;
      gh.group.visible = fade > 0;
      head.y += tagLift; head.project(camera);
      const vis = fade >= 1 && head.z < 1 && Math.abs(head.x) < 1.1 && Math.abs(head.y) < 1.1;
      const rel = PREVIEW ? relText(T) : g.rel;
      hud.ghostTag((head.x + 1) / 2 * innerWidth, (1 - head.y) / 2 * innerHeight, true, T.ghost_who || '无名', rel, !vis);
    } else hud.ghostTag(0, 0, false);
    frames++;
    if (nowMs - fpsT > 1000) { window.__fps = frames * 1000 / (nowMs - fpsT); if (!PREVIEW) hud.fps(window.__fps, S.loop_ms != null ? ` · loop ${S.loop_ms} ms` : ''); frames = 0; fpsT = nowMs; }
    window.__ready = true;
  }
  hud.ready();
  frame();
  window.__game = { route, scene, camera, camRig, renderer, S: () => S, me, ghost, av, gh, stats: () => ({ ...util.stats(renderer), scene: util.sceneStats(scene) }) };   // 调试
}
function relText(T) { const d = T.ghost_pos - T.pos; return d > 0 ? `领先 ${d} 步` : d < 0 ? `落后 ${-d} 步` : '并排'; }

main().catch(e => { err('游戏启动失败', e); const b = document.getElementById('banner'); b.style.display = 'block'; b.textContent = '游戏启动失败：' + e.message; });
