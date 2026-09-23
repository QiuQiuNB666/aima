// 攻壳机动队「致敬版」：只借香港街景、单词和概念（電脳 / 義体 / ゴースト / 光学迷彩 / 2029），不出现任何原作角色、机体、徽章、logo。
//   ① 四脚机甲「ヨンソク-04」：自己设计的扁六角身 + 四条蜘蛛腿 + 单眼，趴在天桥右侧检修平台上；化身走近它转头看、离得近就撑起身子抬头
//   ② 港式出挑招牌：临街楼面伸出来的竖招牌（双面字，正面镜头回看也是正字），青绿 + 品红霓虹
//   ③ 楼面空调外机 + 横穿街道的垂线（九龙城寨 / 旺角的密度）
// 全部程序生成，不下载模型。
import * as THREE from 'three';
import { shade } from './lib.js';

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
  const signs = [], ac = [], wp = [];
  near.forEach((b, k) => {
    const t = WORDS[k % WORDS.length], col = COLS[(k * 3) % COLS.length], h = 1.1 + [...t].length * 0.36;
    const y = b.y0 + Math.min(b.h - h / 2 - 0.3, 3.0 + h / 2 + (k % 3) * 0.6);
    const a = route.at(b.sc + (k % 2 ? 0.25 : -0.25) * b.ds, b.side * (b.front - 0.95));
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
  };
  return out;
}
