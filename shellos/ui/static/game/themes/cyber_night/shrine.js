// 神社段：朱红鸟居（石阶下一座大的、石阶顶一座小的）、石灯笼（夹着石阶）、两侧杉树影、山顶拝殿。
import * as THREE from 'three';

const VERM = '#d8401e', BLACK = '#17110f', STONE = '#7a776f';
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
  const lam = [], lit = [], haloPts = [], haloCol = [];

  // ---- 鸟居 ----
  for (const [s, H, W] of [[s0 - 0.7, 2.95, 1.72], [s1 + 0.7, 2.5, 1.6]]) {
    // transparent 常开（opacity 平时 = 1，照样写深度）：镜头从后面贴近时要淡出
    const tmat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#3a0c04', transparent: true });
    const a = route.at(s), m = new THREE.Mesh(toriiGeo(util, H, W), tmat);
    m.position.copy(a.pos); m.position.y = gy(a.pos.x, a.pos.z) + 0.02; m.rotation.y = -a.heading; m.name = 'torii';
    scene.add(m); toriis.push({ m, a, W, H });
    const plaque = util.textPlane('愛宕神社', H * 0.2, { vertical: true, color: '#ffd98a', bg: '#1b0f0b', border: '#c9a24a', glow: 0.5, weight: 900 });   // 神额：挂在鸟居上，跟着一起淡出
    plaque.material.transparent = true; plaque.position.set(-0.1, H * 0.87, 0); plaque.rotation.y = -Math.PI / 2; m.add(plaque); m.userData.plaque = plaque;
  }

  // ---- 石灯笼：石阶两侧，每 2 步一对；山顶参道再两对 ----
  const lantern = (x, z, y) => {
    const P = (h, geo, color = STONE, extra = {}) => lam.push({ geo, p: [x, y + h, z], color, ...extra });
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
    if (s > s1 + 12 && Math.abs(lat) < 4) continue;                              // 拝殿前让开
    const a = route.at(s, lat), y = gy(a.pos.x, a.pos.z), h = 2.2 + rand() * 2.4, r = 0.6 + rand() * 0.5;
    const col = dark.clone().offsetHSL((rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.05);
    trunks.push({ p: [a.pos.x, y + 0.6, a.pos.z], s: [0.14, 1.2, 0.14], color: '#1a1210' });
    cones.push({ p: [a.pos.x, y + 1.0 + h * 0.4, a.pos.z], s: [r, h * 0.8, r], ry: rand() * 3, color: col });
    cones.push({ p: [a.pos.x, y + 1.0 + h * 0.78, a.pos.z], s: [r * 0.7, h * 0.55, r * 0.7], ry: rand() * 3, color: col });
  }
  const coneM = util.instanced(new THREE.ConeGeometry(1, 1, 7), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#050a08' }), cones);
  const trunkM = util.instanced(new THREE.CylinderGeometry(1, 1, 1, 6), new THREE.MeshLambertMaterial({ color: '#ffffff' }), trunks);
  coneM.name = 'cedars'; trunkM.name = 'trunks'; scene.add(coneM, trunkM);

  // ---- 拝殿（山顶平台尽头，朝来的人）----
  {
    const a = route.at(N + 11), y = gy(a.pos.x, a.pos.z), ry = -a.heading;
    const at = (dx, dz) => [a.pos.x + a.dir.x * dx - a.left.x * dz, a.pos.z + a.dir.z * dx - a.left.z * dz];
    const put = (dx, dy, dz, geo, color, extra = {}) => { const [x, z] = at(dx, dz); lam.push({ geo, p: [x, y + dy, z], ry, color, ...extra }); };
    put(0, 0.15, 0, new THREE.BoxGeometry(3.0, 0.3, 4.6), '#55524c');
    put(0.2, 0.95, 0, new THREE.BoxGeometry(2.0, 1.3, 3.6), '#3a1d14');
    for (const dz of [-1.7, -0.6, 0.6, 1.7]) put(-0.95, 0.95, dz, new THREE.CylinderGeometry(0.08, 0.08, 1.3, 8), VERM);
    const roof = new THREE.CylinderGeometry(1, 1, 1, 3); roof.rotateX(-Math.PI / 2);
    put(0.2, 2.05, 0, roof, '#2d3f3a', { s: [3.0 / 1.73, 0.9 / 1.5, 4.6] });
    put(-0.98, 1.52, 0, new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6).rotateX(Math.PI / 2), '#d8c89a');   // 注連縄
    for (const dz of [-1.15, 1.15]) {                                                                         // 白提灯
      const [x, z] = at(-1.05, dz);
      lit.push({ geo: new THREE.SphereGeometry(0.16, 10, 8), p: [x, y + 1.2, z], s: [1, 1.4, 1], color: '#fff2d8' });
      haloPts.push(x, y + 1.2, z); haloCol.push(1, 0.9, 0.7);
    }
  }

  const lamMesh = new THREE.Mesh(util.merged(lam), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#0c0a0a' })); lamMesh.name = 'shrineProps';
  const litMesh = new THREE.Mesh(util.merged(lit), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })); litMesh.name = 'shrineLit';
  const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(haloPts, 3)); hg.setAttribute('color', new THREE.Float32BufferAttribute(haloCol, 3));
  const halo = new THREE.Points(hg, new THREE.PointsMaterial({ size: 1.1, map: E.radial, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  halo.name = 'shrineHalos';
  scene.add(lamMesh, litMesh, halo);
}

// 镜头从后面贴近鸟居（石阶上镜头正好在下面那座鸟居后 1–2 单位，横梁糊满画面）：离鸟居平面 3.4 → 1.6 淡出，穿过前后藏起来
const d = new THREE.Vector3();
export function updateShrine(dt, st) {
  if (!st.camera) return;
  for (const t of toriis) {
    d.subVectors(st.camera.position, t.m.position);
    const along = d.x * t.a.dir.x + d.z * t.a.dir.z, lat = d.x * t.a.left.x + d.z * t.a.left.z;
    let k = 1;
    if (Math.abs(lat) < t.W + 1.5 && along > -3.4 && along < 1.1) k = along < -1.6 ? (-1.6 - along) / 1.8 : 0;
    t.m.material.opacity = t.m.userData.plaque.material.opacity = k; t.m.visible = k > 0.02;
  }
}
