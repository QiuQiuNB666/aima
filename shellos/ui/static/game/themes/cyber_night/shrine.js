// 神社段：朱红鸟居（石阶下一座大的、石阶顶一座小的）、石灯笼（夹着石阶，不吃点光的暖灰石）、两侧杉树影、
//   山顶拝殿（鸟居后约 4 单位：切妻铜绿屋顶、三扇透暖光的格子门、赛钱箱、「愛宕」红提灯、注连绳）。登顶定机位正对拝殿。
import * as THREE from 'three';
import { shade } from './lib.js';

const VERM = '#d8401e', BLACK = '#17110f', STONE = '#8a8478';
let toriis = [];

// 鸟居（明神鸟居）：局部 x = 行进方向、z = 路右手；高 H、柱距 2W
function toriiGeo(util, H, W) {
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d), parts = [];
  for (const z of [-W, W]) {
    parts.push({ geo: new THREE.CylinderGeometry(0.12, 0.15, H, 12), p: [0, H / 2, z], color: VERM });
    parts.push({ geo: new THREE.CylinderGeometry(0.19, 0.19, 0.32, 12), p: [0, 0.16, z], color: BLACK });
  }
  parts.push({ geo: B(0.16, 0.2, 2 * W + 0.9), p: [0, H * 0.74, 0], color: VERM });              // 貫
  parts.push({ geo: B(0.24, 0.22, 2 * W + 1.1), p: [0, H + 0.02, 0], color: VERM });             // 島木
  parts.push({ geo: B(0.34, 0.2, 2 * W + 1.2), p: [0, H + 0.23, 0], color: BLACK });            // 笠木
  for (const sg of [-1, 1]) {                                                                     // 笠木两端上翘
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), sg * 0.22);
    parts.push({ geo: B(0.34, 0.2, 0.55), p: [0, H + 0.29, sg * (W + 0.8)], q, color: BLACK });
  }
  parts.push({ geo: B(0.12, H * 0.26 - 0.1, 0.16), p: [0, H * 0.87, 0], color: VERM });           // 額束
  return util.merged(parts);
}

export function buildShrine(scene, ctx, E) {
  const { route, util, rand, theme } = ctx, N = route.N;
  const segs = route.segs, shrine = segs.filter(s => s.kind === 'stairs_up').pop();
  if (!shrine) return;
  const s0 = shrine.start, s1 = shrine.start + shrine.steps;
  const gy = (x, z) => util.nearestRoute(route, x, z).y - 0.06;
  const lam = [], lit = [], stone = [], haloPts = [], haloCol = [];

  // ---- 鸟居 ----
  for (const [s, H, W] of [[s0 - 0.7, 3.6, 1.95], [s1 + 0.7, 2.5, 1.6]]) {   // 下面那座高 3.6、柱距 3.9：石阶上镜头压低（rigFor）从貫下面穿过去，不再糊一片半透明横梁
    const tmat = shade(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#3a0c04' }), { fogK: 0.25 });   // 雾只吃 1/4：开场帧远远就是朱红的
    const a = route.at(s), m = new THREE.Mesh(toriiGeo(util, H, W), tmat);
    m.position.copy(a.pos); m.position.y = gy(a.pos.x, a.pos.z) + 0.02; m.rotation.y = -a.heading; m.name = 'torii';
    scene.add(m); toriis.push({ m, a, W, H });
    const plaque = util.textPlane('愛宕神社', H * 0.2, { vertical: true, color: '#ffd98a', bg: '#1b0f0b', border: '#c9a24a', glow: 0.5, weight: 900 });   // 神额：挂在鸟居上，跟着一起淡出
    shade(plaque.material, { fogK: 0.25 }); plaque.position.set(-0.1, H * 0.87, 0); plaque.rotation.y = -Math.PI / 2; m.add(plaque); m.userData.plaque = plaque;
  }

  // ---- 石灯笼：石阶两侧，每 2 步一对；山顶参道再两对 ----
  const lantern = (x, z, y) => {
    const P = (h, geo, color = STONE, extra = {}) => stone.push({ geo, p: [x, y + h, z], color, ...extra });
    P(0.06, new THREE.BoxGeometry(0.38, 0.12, 0.38));
    P(0.34, new THREE.CylinderGeometry(0.065, 0.08, 0.44, 8));
    P(0.59, new THREE.BoxGeometry(0.32, 0.07, 0.32));
    P(0.93, new THREE.ConeGeometry(0.3, 0.2, 4), STONE, { ry: Math.PI / 4 });
    P(1.06, new THREE.SphereGeometry(0.05, 8, 6));
    lit.push({ geo: new THREE.BoxGeometry(0.22, 0.2, 0.22), p: [x, y + 0.73, z], color: '#ffb458' });
    haloPts.push(x, y + 0.74, z); haloCol.push(1, 0.62, 0.28);
  };
  for (let s = s0 + 0.5; s <= s1 + 5; s += 2) for (const sg of [1, -1]) {
    if (toriis.some(t => Math.abs(route.at(s).pos.distanceTo(t.a.pos)) < 0.5)) continue;   // 别和鸟居柱子撞
    const a = route.at(s, sg * 1.72);
    lantern(a.pos.x, a.pos.z, gy(a.pos.x, a.pos.z));
  }

  // ---- 杉树影：石阶两侧、山顶四周（左侧离路 ≥ 3.3）----
  const cones = [], trunks = [], dark = new THREE.Color('#0d1f1a');
  for (let k = 0; k < 90; k++) {
    const side = k % 2 ? 1 : -1, s = s0 - 6 + rand() * (N + 18 - s0 + 6), lat = side * (3.3 + Math.pow(rand(), 0.8) * 7);
    if (s < s0 - 0.8) continue;                                                  // 杉树只长在神社山上
    if (s > s1 + 7 && Math.abs(lat) < 4.6) continue;                            // 拝殿四周让开
    const a = route.at(s, lat), y = gy(a.pos.x, a.pos.z), h = 2.2 + rand() * 2.4, r = 0.6 + rand() * 0.5;
    const col = dark.clone().offsetHSL((rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.05);
    trunks.push({ p: [a.pos.x, y + 0.6, a.pos.z], s: [0.14, 1.2, 0.14], color: '#1a1210' });
    cones.push({ p: [a.pos.x, y + 1.0 + h * 0.4, a.pos.z], s: [r, h * 0.8, r], ry: rand() * 3, color: col });
    cones.push({ p: [a.pos.x, y + 1.0 + h * 0.78, a.pos.z], s: [r * 0.7, h * 0.55, r * 0.7], ry: rand() * 3, color: col });
  }
  const coneM = util.instanced(new THREE.ConeGeometry(1, 1, 7), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#050a08' }), cones);
  const trunkM = util.instanced(new THREE.CylinderGeometry(1, 1, 1, 6), new THREE.MeshLambertMaterial({ color: '#ffffff' }), trunks);
  coneM.name = 'cedars'; trunkM.name = 'trunks'; scene.add(coneM, trunkM);

  // ---- 拝殿：上面那座鸟居后约 4 单位，宽 5（横向）、深 3、墙高 2.6，切妻屋顶铜绿、屋脊比檐口高 1.2 ----
  let doorMesh = null, lanterns = null;
  {
    const a = route.at(s1 + 0.7 + 11), y = gy(a.pos.x, a.pos.z) + 0.02, ry = -a.heading;   // 中心在鸟居后 5.5（正面在 4）
    const at = (dx, dz) => [a.pos.x + a.dir.x * dx - a.left.x * dz, a.pos.z + a.dir.z * dx - a.left.z * dz];
    const put = (dx, dy, dz, geo, color, extra = {}, to = lam) => { const [x, z] = at(dx, dz); to.push({ geo, p: [x, y + dy, z], ry, color, ...extra }); };
    put(0, 0.15, 0, new THREE.BoxGeometry(3.8, 0.3, 5.8), '#5a5750', {}, stone);                       // 基壇
    put(-2.15, 0.08, 0, new THREE.BoxGeometry(0.5, 0.16, 2.2), '#5a5750', {}, stone);                  // 正面踏石
    put(0.1, 1.6, 0, new THREE.BoxGeometry(2.8, 2.6, 4.8), '#3a1d14');                                  // 身舎（深色木）
    for (const dz of [-2.45, -0.82, 0.82, 2.45]) put(-1.4, 1.6, dz, new THREE.CylinderGeometry(0.09, 0.1, 2.6, 8), VERM);   // 正面四柱 → 三间
    put(-1.4, 2.82, 0, new THREE.BoxGeometry(0.16, 0.16, 5.1), VERM);                                   // 头贯
    const roof = new THREE.CylinderGeometry(1, 1, 1, 3); roof.rotateX(-Math.PI / 2);
    put(0.1, 2.9 + 0.4, 0, roof, '#2f5a4f', { s: [3.9 / 1.732, 1.2 / 1.5, 5.9] });                     // 切妻：三棱柱，檐口 2.9、屋脊 4.1
    put(0.1, 4.12, 0, new THREE.BoxGeometry(0.2, 0.12, 6.0), '#1d3a33');                                // 屋脊
    put(-2.0, 0.58, 0, new THREE.BoxGeometry(0.55, 0.56, 1.3), '#5a3a22');                              // 赛钱箱
    for (const k of [-0.45, -0.15, 0.15, 0.45]) put(-2.0, 0.87, k * 2.2, new THREE.BoxGeometry(0.5, 0.03, 0.06), '#2a1a10');   // 箱顶格条
    for (const dz of [-1.1, 0, 1.1]) put(-1.62, 2.62 - (dz ? 0 : 0.12), dz, new THREE.CylinderGeometry(dz ? 0.07 : 0.11, dz ? 0.07 : 0.11, 1.2, 8).rotateX(Math.PI / 2), '#e8dcc0');   // 注连绳（中间粗）
    for (const dz of [-1.5, -0.5, 0.5, 1.5]) put(-1.62, 2.38, dz, new THREE.BoxGeometry(0.02, 0.32, 0.12), '#f4f0e6');     // 纸垂
    // 三扇格子门：一块板画三间，暖光 #ffb347 × 0.8
    const doorTex = util.canvasTexture(384, 144, (g, w, h) => {
      g.fillStyle = '#ffb347'; g.fillRect(0, 0, w, h);
      const glow = g.createRadialGradient(w / 2, h * 0.6, 10, w / 2, h * 0.6, w * 0.6); glow.addColorStop(0, 'rgba(255,240,200,.55)'); glow.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = glow; g.fillRect(0, 0, w, h);
      g.fillStyle = '#3a1d14';
      for (let x = 0; x < w; x += 12) g.fillRect(x, 0, 3, h);                                         // 格子
      for (let y = 0; y < h; y += 12) g.fillRect(0, y, w, 3);
      for (const x of [0, 128, 256, 384]) g.fillRect(x - 7, 0, 14, h);                                 // 三间之间的框
      g.fillRect(0, 0, w, 9); g.fillRect(0, h * 0.52, w, 6); g.fillRect(0, h - 12, w, 12);              // 上框 / 中桟 / 下框
    });
    const [dx0, dz0] = at(-1.52, 0);
    doorMesh = new THREE.Mesh(new THREE.PlaneGeometry(4.9, 1.85), new THREE.MeshBasicMaterial({ map: doorTex, color: new THREE.Color('#ffffff').multiplyScalar(0.8), toneMapped: false }));
    doorMesh.position.set(dx0, y + 1.25, dz0); doorMesh.rotation.y = ry - Math.PI / 2; doorMesh.name = 'haidenDoors';
    for (const dz of [-1.6, 0, 1.6]) { const [x, z] = at(-1.8, dz); haloPts.push(x, y + 1.3, z); haloCol.push(1, 0.62, 0.25); }
    // 两盏「愛宕」红提灯（直径 0.5），挂在檐下两侧
    const lanTex = util.canvasTexture(256, 128, (g, w, h) => {
      g.fillStyle = '#d8322a'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,.18)'; for (let yy = 14; yy < h - 10; yy += 9) g.fillRect(0, yy, w, 2);   // 竹骨
      g.fillStyle = '#1a0d0a'; g.fillRect(0, 0, w, 12); g.fillRect(0, h - 12, w, 12);
      g.font = `900 44px ${util.FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const u of [0.25, 0.75]) { g.fillText('愛', w * u, h * 0.33); g.fillText('宕', w * u, h * 0.68); }
    });
    const lg = new THREE.CylinderGeometry(0.25, 0.25, 0.62, 16, 1, false);
    lanterns = util.instanced(lg, new THREE.MeshBasicMaterial({ map: lanTex, toneMapped: false }), [-1.9, 1.9].map(dz => { const [x, z] = at(-1.75, dz); haloPts.push(x, y + 2.25, z); haloCol.push(1, 0.3, 0.18); return { p: [x, y + 2.25, z], ry: ry + Math.PI / 2 + 0.3 }; }));
    lanterns.name = 'haidenLanterns';
    scene.add(doorMesh, lanterns);
    // 登顶定机位：镜头在化身背后、正对拝殿（环绕会从拝殿里穿过去）；鸟居框住化身，拝殿在后面亮着
    const [hx, hz] = at(0, 0);
    ctx.camRig.summit.face = new THREE.Vector3(hx, y + 1.5, hz); ctx.camRig.summit.speed = 0;
    { const [fx, fz] = at(-2.7, 0); E.haiden = { x: fx, y, z: fz }; }         // 拝殿正面前方（gits.js 登顶「2029」浮在这里）
  }

  const lamMesh = new THREE.Mesh(util.merged(lam), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#0c0a0a' })); lamMesh.name = 'shrineProps';
  const litMesh = new THREE.Mesh(util.merged(lit), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })); litMesh.name = 'shrineLit';
  // 石灯笼 + 基壇：不吃光（跟随化身的青/品红点光不会把石头染成塑料色），明暗按朝向烘进顶点色
  const sg = util.merged(stone), sn = sg.attributes.normal, sc = sg.attributes.color;
  for (let k = 0; k < sc.count; k++) { const f = 0.62 + 0.38 * Math.max(0, sn.getY(k) * 0.8 + sn.getX(k) * 0.25 - sn.getZ(k) * 0.3); sc.setXYZ(k, sc.getX(k) * f, sc.getY(k) * f, sc.getZ(k) * f); }
  const stoneMesh = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true })); stoneMesh.name = 'stoneLanterns';
  const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(haloPts, 3)); hg.setAttribute('color', new THREE.Float32BufferAttribute(haloCol, 3));
  const halo = new THREE.Points(hg, shade(new THREE.PointsMaterial({ size: 1.1, map: E.radial, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), { addFog: true, mask: true, neon: true }));
  halo.name = 'shrineHalos';
  scene.add(lamMesh, litMesh, stoneMesh, halo);
}

// 保险：镜头真要从横梁高度穿过鸟居（离鸟居平面 < 0.8、高度在貫以上）才藏起来；平时不透明（以前 3.4 → 1.6 淡出，半透明横梁糊满画面）
const d = new THREE.Vector3();
export function updateShrine(dt, st) {
  if (!st.camera) return;
  for (const t of toriis) {
    d.subVectors(st.camera.position, t.m.position);
    const along = d.x * t.a.dir.x + d.z * t.a.dir.z, lat = d.x * t.a.left.x + d.z * t.a.left.z;
    t.m.visible = !(Math.abs(lat) < t.W + 1.2 && Math.abs(along) < 0.8 && d.y > t.H * 0.74 - 0.35);
  }
}
