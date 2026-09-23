// 攻壳机动队「致敬版」：只借香港街景、单词和概念（電脳 / 義体 / ゴースト / 光学迷彩 / 2029），不出现任何原作角色、机体、徽章、logo。
//   ① 四脚机甲「ヨンソク-04」：自己设计的扁六角身 + 四条蜘蛛腿 + 单眼，趴在天桥右侧检修平台上；化身走近它转头看、离得近就撑起身子抬头
//   ② 港式出挑招牌：临街楼面伸出来的竖招牌（双面字，正面镜头回看也是正字），青绿 + 品红霓虹
//   ③ 楼面空调外机 + 横穿街道的垂线（九龙城寨 / 旺角的密度）
// 彩蛋（只看进度 / 站定 / 靠近触发）：
//   ④ 站定 3 s → 峰哥光学迷彩（半透明 + 青色轮廓光），一动 0.15 s「啪」地恢复。P 线 fengge.js 有 setCamo(k) 就交给它，没有就这里临时改材质参数
//   ⑤ 走过坂道上那块「ゴースト」出挑招牌 → 故障字幕 0.6 s（U 线 hud 有 window.__hud.glitch(text) 就交给它，没有就镜头前 3D 字）；
//      只错位跳一次（≤ 2 Hz，不频闪），3 s 冷却
//   ⑥ 登顶 → 拝殿前浮现「2029」（全息字，压在画面最上层）+ 两记合成太鼓（心跳）
// 全部程序生成，不下载模型。
import * as THREE from 'three';
import { shade } from './lib.js';
import * as FG from '../../fengge.js';

const B = (x, y, z) => new THREE.BoxGeometry(x, y, z);
const seg = (parts, a, b, t, color) => {                         // a→b 一根方棒
  const d = new THREE.Vector3().subVectors(b, a), len = d.length();
  parts.push({ geo: B(len, t, t), p: a.clone().add(b).multiplyScalar(0.5).toArray(), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize()), color });
};

// 四脚机甲：本地 +x = 机头朝向，趴姿（机身离地 0.42）。身子 + 腿 1 次、头 1 次、眼 1 次绘制
export function yonsoku(util) {
  const G = '#2c3440', G2 = '#3e4a5a', OR = '#ff8a1a', V = (x, y, z) => new THREE.Vector3(x, y, z), body = [], legs = [];
  const hex = new THREE.CylinderGeometry(0.62, 0.7, 0.26, 6); hex.rotateY(Math.PI / 6); hex.scale(1.3, 1, 1);
  body.push({ geo: hex, p: [0, 0, 0], color: G });
  const top = new THREE.CylinderGeometry(0.5, 0.6, 0.1, 6); top.rotateY(Math.PI / 6); top.scale(1.3, 1, 1);
  body.push({ geo: top, p: [0, 0.17, 0], color: G2 });
  for (const z of [-0.36, 0.36]) body.push({ geo: B(0.9, 0.03, 0.06), p: [-0.05, 0.225, z], color: OR });   // 橙色警示条
  body.push({ geo: B(0.42, 0.2, 0.46), p: [-0.62, 0.12, 0], color: '#232a33' });                              // 背后电池舱
  body.push({ geo: new THREE.CylinderGeometry(0.012, 0.012, 0.55, 4), p: [-0.72, 0.45, 0.16], color: '#8a929c' });   // 天线
  // 四条腿：髋在机身四角，膝高高拱起（蜘蛛），脚掌撑在外面
  for (const [x, z] of [[0.45, 0.42], [0.45, -0.42], [-0.45, 0.42], [-0.45, -0.42]]) {
    const sx = Math.sign(x), sz = Math.sign(z), hip = V(x * 1.1, -0.02, z), knee = V(x * 1.35 + sx * 0.15, 0.42, z * 1.9), foot = V(x * 1.5 + sx * 0.3, -0.42, z * 2.5);
    legs.push({ geo: new THREE.SphereGeometry(0.1, 8, 6), p: hip.toArray(), color: G2 });
    seg(legs, hip, knee, 0.1, G); seg(legs, knee, foot, 0.075, G2);
    legs.push({ geo: new THREE.SphereGeometry(0.08, 8, 6), p: knee.toArray(), color: OR });
    legs.push({ geo: new THREE.CylinderGeometry(0.09, 0.11, 0.05, 10), p: foot.toArray(), color: '#1a1f26' });
  }
  const bodyM = new THREE.Mesh(util.merged([...body, ...legs]), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#0c1016' }));
  const head = new THREE.Group();
  head.add(new THREE.Mesh(util.merged([
    { geo: B(0.38, 0.22, 0.34), p: [0.14, 0, 0], color: G2 },
    { geo: B(0.12, 0.08, 0.4), p: [-0.02, 0.13, 0], color: G },                                                // 头顶护板
    { geo: new THREE.TorusGeometry(0.105, 0.025, 6, 16).rotateY(Math.PI / 2), p: [0.33, 0, 0], color: OR },     // 眼眶
  ]), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#0c1016' })));
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#29e7ff', toneMapped: false });
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), eyeMat); eye.position.set(0.32, 0, 0); head.add(eye);
  head.position.set(0.82, 0.08, 0);
  const g = new THREE.Group(); g.add(bodyM, head); g.name = 'yonsoku';
  return { g, body: bodyM, head, eyeMat };
}

export function buildGits(scene, ctx, E) {
  const { route, util, kit, rand } = ctx, N = route.N, gy = (x, z) => util.nearestRoute(route, x, z).y - 0.06, LOW = kit.LOW;
  const out = { mech: null };

  // ---------- ① 天桥检修平台 + 四脚机甲 ----------
  const bridge = route.segs.find(q => q.kind === 'stairs_up');
  if (bridge) {
    const apex = bridge.start + bridge.steps, top = route.heightAt(apex - 0.01);
    const at = (s, lat) => route.at(s, lat).pos;
    const deck = [], c = at(apex, -2.25);
    const a0 = route.at(apex), ry = -a0.heading;
    deck.push({ geo: B(1.9, 0.08, 2.3), p: [c.x, top - 0.04, c.z], ry, color: '#3a3f4c' });                   // 检修平台（贴着天桥右侧栏杆外）
    deck.push({ geo: B(0.14, 2.2, 0.14), p: [c.x, top - 1.15, c.z], color: '#2a2e38' });                     // 立柱下到桥下大街
    for (const [ds, dl] of [[-0.9, -1.1], [0.9, -1.1], [0, -1.1]]) { const q = at(apex + ds / 0.5 * 0.5, -2.25 + dl); deck.push({ geo: B(0.04, 0.5, 0.04), p: [q.x, top + 0.25, q.z], color: '#8a90a6' }); }
    const dm = new THREE.Mesh(util.merged(deck), new THREE.MeshLambertMaterial({ vertexColors: true })); dm.name = 'mechDeck'; scene.add(dm);
    const M = yonsoku(util);
    M.g.position.set(c.x, top + 0.42 * 1.25, c.z); M.g.rotation.y = -a0.heading + Math.PI; M.g.scale.setScalar(1.25);   // 机头朝来路（化身从那边上来）；放大 1.25（3 米外认得出是只机甲）
    scene.add(M.g);
    out.mech = { ...M, base: M.g.position.clone(), yaw0: M.g.rotation.y, up: 0, yaw: 0, pitch: 0 };
  }

  // ---------- ② 港式出挑竖招牌 + ③ 空调外机 / 垂线 ----------
  // 起点街的临街楼（正面镜头回看时满墙招牌）+ 坂道两侧的杂居楼（跟拍镜头朝前看得到）
  const near = [...(E.near || []), ...(E.rear || []).filter(b => b.sc > 17 && b.sc < 30)].filter(b => b.h > 3.4);
  const WORDS = ['義体整備', '電脳診療', '光学迷彩', 'ゴースト', '大押', '酒家', '麻雀', '藥行', '冰室', '情報屋', '電脳カフェ', '義肢修理', '夜市', '九龍'];
  const COLS = ['#29e7ff', '#ff2e88', '#00ffc6', '#ff4fd8', '#e8f6ff'];
  const signs = [], ac = [], wp = [], trig = [];
  near.forEach((b, k) => {
    const want = b.sc > 5 && !trig.length;                                   // 坂道上第一块出挑牌 =「ゴースト」，彩蛋触发牌
    const t = want ? 'ゴースト' : WORDS[k % WORDS.length], col = COLS[(k * 3) % COLS.length], h = 1.1 + [...t].length * 0.36;
    const y = b.y0 + Math.min(b.h - h / 2 - 0.3, 3.0 + h / 2 + (k % 3) * 0.6);
    const a = route.at(b.sc + (k % 2 ? 0.25 : -0.25) * b.ds, b.side * (b.front - 0.95));
    if (y - h / 2 > b.y0 + 2.4 && want) trig.push({ s: b.sc, text: t });
    if (y - h / 2 > b.y0 + 2.4) signs.push({ text: t, p: a.pos.clone().setY(y), ry: -a.heading + Math.PI / 2, h, color: col, bg: '#07040c', border: col, glow: 1, vertical: true, weight: 900 });
    for (let j = 0, n = LOW ? 1 : 2 + (k % 3); j < n; j++) {                   // 空调外机：挂在楼面上，离地 1.4 往上
      const q = route.at(b.sc + (rand() - 0.5) * b.ds * 0.7, b.side * (b.front - 0.18));
      ac.push({ p: [q.pos.x, b.y0 + 1.4 + rand() * (b.h - 2), q.pos.z], ry: -q.heading, s: [0.55, 0.38, 0.3], color: new THREE.Color('#9aa0ac').multiplyScalar(0.55 + rand() * 0.25) });
    }
  });
  if (signs.length) { const m = kit.signs2(util, signs, { size: 96 }); shade(m.material, { mask: true, neon: true }); m.name = 'hkSigns'; scene.add(m); }
  if (ac.length) { const m = util.instanced(B(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#08080c' }), ac); m.name = 'acUnits'; scene.add(m); }
  // 横穿起点街的垂线：左右楼面之间，4–6.5 高，中间下垂
  const L = near.filter(b => b.side > 0), Rr = near.filter(b => b.side < 0);
  for (let k = 0; k < Math.min(L.length, Rr.length, LOW ? 3 : 7); k++) {
    const a = route.at(L[k].sc, L[k].front - 0.05).pos, b = route.at(Rr[k].sc, -(Rr[k].front - 0.05)).pos;
    a.y = L[k].y0 + 4 + (k % 3) * 0.8; b.y = Rr[k].y0 + 4.4 + (k % 2) * 0.9;
    for (let i = 0; i < 12; i++) { for (const u of [i / 12, (i + 1) / 12]) wp.push(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u - 0.7 * 4 * u * (1 - u), a.z + (b.z - a.z) * u); }
  }
  if (wp.length) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#05040a' })); m.name = 'streetCables'; scene.add(m); }

  // ---------- 彩蛋用的故障字：品红 / 青两层左右错开（加色）+ 白字；组的朝向跟镜头，本地 x = 屏幕右 ----------
  const DX = [-0.035, 0.035, 0];
  const glitchText = (text, h, top) => {
    const tex = util.textTexture(text, { size: 160, weight: 900, color: '#ffffff' }), g = new THREE.Group();
    ['#ff2e88', '#29e7ff', '#ffffff'].forEach((c, i) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: c, transparent: true, depthWrite: false, depthTest: !top, fog: false, toneMapped: false, blending: i < 2 ? THREE.AdditiveBlending : THREE.NormalBlending }));
      sp.scale.set(h * tex.userData.aspect, h, 1); sp.renderOrder = top ? 999 : 5; g.add(sp);
    });
    g.set = (op, jx = 0) => { g.children.forEach((sp, i) => { sp.material.opacity = op * (i < 2 ? 0.8 : 1); sp.position.x = (DX[i] * (1 + 6 * Math.abs(jx)) + (i === 2 ? jx : 0)) * h; }); g.visible = op > 0.01; };
    g.set(0); g.name = 'glitch:' + text; scene.add(g);
    return g;
  };

  // ④ 光学迷彩：材质原值存一份，k = 0 时原样放回
  let av = null, camoMats = null, rimU = null, rim0 = null, rimK0 = 0, camoK = 0, stillT = 0, lastS = null;
  const CAMO = new THREE.Color('#7ff6ff');
  const setCamo = k => {
    if (FG.setCamo) return FG.setCamo(k);
    if (!camoMats) {
      camoMats = new Map(); av.traverse(o => { if (o.isMesh && !camoMats.has(o.material)) { camoMats.set(o.material, { t: o.material.transparent, o: o.material.opacity, d: o.material.depthWrite }); if (o.material.userData.look) rimU = o.material.userData.look; } });
      if (rimU) { rim0 = rimU.uRim.value.clone(); rimK0 = rimU.uRimK.value; }
    }
    for (const [m, o] of camoMats) {
      const on = k > 0.001;
      if (m.transparent !== (on || o.t)) { m.transparent = on || o.t; m.needsUpdate = true; }
      m.opacity = o.o * (1 - 0.84 * k); m.depthWrite = on ? k < 0.5 : o.d;
    }
    if (rimU) { rimU.uRim.value.copy(rim0).lerp(CAMO, k); rimU.uRimK.value = rimK0 + 2.6 * k; }
  };
  const camo = (dt, st) => {
    av ||= scene.getObjectByName('avatar'); if (!av) return;
    stillT = lastS !== null && Math.abs(st.s - lastS) < 0.002 && !st.summit && !st.preview && st.s > 0.5 ? stillT + dt : 0;
    const want = stillT > 3 ? 1 : 0, was = camoK;
    camoK = want ? Math.min(1, camoK + dt / 0.8) : Math.max(0, camoK - dt / 0.15);
    if (was === 0 && camoK > 0) kit.sfx('camo', 0.55);
    else if (was === 1 && camoK < 1) kit.sfx('click', 0.5, { pitch: 1.4 });
    if (camoK !== was) setCamo(camoK);
  };

  // ⑤ 故障字幕
  const HUDG = {}; for (const q of trig) HUDG[q.text] ||= glitchText(q.text, 0.24, true);
  let gl = null, glT = 0, glCd = 0;
  const fwd = new THREE.Vector3(), up = new THREE.Vector3();
  const glitch = (dt, st) => {
    glCd -= dt;
    if (lastS !== null && glCd <= 0) for (const q of trig) if (lastS < q.s - 1.5 && st.s >= q.s - 1.5) {
      glCd = 3; kit.sfx('glitch', 0.5);
      if (window.__hud && window.__hud.glitch) window.__hud.glitch(q.text); else { if (gl) gl.set(0); gl = HUDG[q.text]; glT = 0.6; }
      break;
    }
    if (!gl) return;
    glT -= dt; if (glT <= 0 || !st.camera) { gl.set(0); gl = null; return; }
    const u = 1 - glT / 0.6, cam = st.camera;
    cam.getWorldDirection(fwd); up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    gl.position.copy(cam.position).addScaledVector(fwd, 1.6).addScaledVector(up, 0.4); gl.quaternion.copy(cam.quaternion);
    gl.set(u < 0.1 ? u / 0.1 : u > 0.75 ? (1 - u) / 0.25 : 1, u > 0.35 && u < 0.5 ? 0.09 : 0);   // 只错位跳一次
  };

  // ⑥ 登顶「2029」+ 太鼓
  const Y29 = E.haiden ? glitchText('2029', 1.0, true) : null, top = kit.edge();
  let t29 = -1;
  const y2029 = (dt, st) => {
    if (top(!!st.summit)) { t29 = 0; kit.sfx('taiko', 1); setTimeout(() => kit.sfx('taiko', 0.6, { pitch: 0.92 }), 340); }
    if (!Y29 || t29 < 0) return;
    t29 = st.summit ? t29 + dt : -1;
    const e = Math.min(1, t29 / 1.4), ease = 1 - (1 - e) ** 3;
    Y29.position.set(E.haiden.x, E.haiden.y + 3.1 + 0.5 * ease, E.haiden.z); if (st.camera) Y29.quaternion.copy(st.camera.quaternion);
    Y29.set(t29 < 0 ? 0 : ease, t29 > 0.9 && t29 < 1.05 ? 0.06 : 0);
  };

  // ---------- 每帧 ----------
  const tmp = new THREE.Vector3();
  out.update = (dt, st) => {
    const M = out.mech;
    if (M && st.avatar) {
      tmp.subVectors(st.avatar, M.base); const d = Math.hypot(tmp.x, tmp.z);
      const watch = d < 9 ? 1 : 0, rise = d < 4.5 ? 1 : 0;                    // 9 单位内转头盯着，4.5 以内撑起身子抬头
      M.up += (rise - M.up) * Math.min(1, dt * 2.2);
      const yawW = Math.atan2(-tmp.z, tmp.x) - M.yaw0, yaw = Math.atan2(Math.sin(yawW), Math.cos(yawW));
      M.yaw += ((watch ? Math.max(-1.2, Math.min(1.2, yaw)) : 0.25 * Math.sin(st.t * 0.4)) - M.yaw) * Math.min(1, dt * 3);
      const pitch = watch ? Math.atan2(st.avatar.y + 1.2 - (M.base.y + 0.35 * M.up), d) : -0.15;
      M.pitch += (Math.max(-0.5, Math.min(0.7, pitch + 0.25 * M.up)) - M.pitch) * Math.min(1, dt * 3);
      M.g.position.y = M.base.y + 0.35 * M.up; M.head.rotation.set(0, M.yaw, M.pitch);
      M.eyeMat.color.setRGB(0.16 + 0.6 * watch, 0.9, 1).multiplyScalar(0.75 + 0.25 * Math.sin(st.t * (watch ? 6 : 1.5)));
    }
    if (st.s != null) { camo(dt, st); glitch(dt, st); lastS = st.s; }
    y2029(dt, st);
  };
  return out;
}
