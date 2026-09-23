// 下载的开源模型（static/models/cyber/，来源 / 许可 / 署名见同目录 LICENSE.md）接进东京攻壳致敬版：
//   ① 电子狛犬：MechQuadruped（3Donimus，CC BY 3.0）一对，趴在拝殿前参道两侧的石台上，脸朝来人、略朝里（狛犬的位置，不是原作机体）
//   ② 巡逻无人机：Quaternius「Robot Enemy Flying」（CC0）×2，漆成枪灰、红眼，往下打一道青白探照光，在起点街 / 坂道上空慢慢绕 8 字
//   ③ 霓虹招牌：Quaternius「Cyberpunk Signs」（CC0）拆开，平贴在临街楼面上
//   ④ 楼面空调外机：Quaternius「AC Stacked / AC」（CC0）换掉 gits.js 程序生成的方块（位置不变）；屋顶天线、楼面垂下来的电缆束（同一套件）
// 全部合并成少数几次绘制（狛犬 3 = 机身 / 发光件 / 石台，招牌 2、空调 2、天线 1、电缆 1；无人机是骨骼动画，各自画）。
// 一直可见（整条路才 18 m 多，雾遮不住，按进度开关会当着镜头「蹦」出来）；狛犬约 11.9 万面，不投影。
// 异步加载：全部就绪才整组挂进场景（名字 'cyberModels'），之前 / 失败时程序生成的场景照样完整。?fx=low 不加载。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { shade } from './lib.js';

const DIR = '/models/cyber/';
const faceY = (fx, fz) => Math.atan2(fx, fz);            // 模型正面 = 本地 +z：转到朝 (fx, fz)

// 一个 glTF 场景（或其中一个节点）烤成顶点色几何：pick(material) 决定进哪一组（'solid' / 'glow' / 'tex' …），
// 每组合成 1 个几何，挪到脚底 y = 0、水平居中（center=true）
const I4 = new THREE.Matrix4();
function bake(util, root, pick = () => 'solid', { center = true } = {}) {
  root.updateMatrixWorld(true);
  const groups = {};
  root.traverse(o => {
    if (!o.isMesh) return;
    const k = pick(o.material); if (!k) return;
    (groups[k] ||= []).push({ geo: o.matrixWorld.equals(I4) ? o.geometry : o.geometry.clone().applyMatrix4(o.matrixWorld), color: o.material.color, map: o.material.map });   // util.merged 自己会复制，不改原几何
  });
  const out = {}, box = new THREE.Box3();
  for (const k in groups) { out[k] = util.merged(groups[k].map(({ geo, color }) => ({ geo, color: k === 'tex' ? '#ffffff' : color }))); out[k].userData.map = groups[k][0].map; }
  if (center) {
    for (const k in out) { out[k].computeBoundingBox(); box.union(out[k].boundingBox); }
    const c = box.getCenter(new THREE.Vector3());
    for (const k in out) out[k].translate(-c.x, -box.min.y, -c.z);
    out.w = box.max.x - box.min.x; out.h = box.max.y - box.min.y;
  }
  return out;
}

export function buildModels(scene, ctx, E, G) {
  const { route, util, kit } = ctx, out = { update() {}, komainu: [] };
  if (kit.LOW) return out;
  const gy = (x, z) => util.nearestRoute(route, x, z).y - 0.06;
  const loader = new GLTFLoader(), buf = n => fetch(DIR + n + '.glb').then(r => { if (!r.ok) throw new Error(n + ' ' + r.status); return r.arrayBuffer(); });
  const parse = b => new Promise((res, rej) => loader.parse(b.slice(0), DIR, res, rej));
  const drones = [];

  Promise.all(['mech_quadruped', 'drone', 'signs', 'ac_stacked', 'ac', 'antenna', 'cable_long'].map(buf)).then(async ([mechB, droneB, signB, acsB, acB, antB, cabB]) => {
    const grp = new THREE.Group(); grp.name = 'cyberModels';
    const lam = (extra = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, ...extra });

    // ---------- ① 电子狛犬 ----------
    const shrine = route.segs.filter(q => q.kind === 'stairs_up').pop();
    if (shrine && E.haiden) {
      // 橙色件 / 半透明护目镜 = 发光；其余吃光，另加一点冷色自发光（神社夜里不糊成一团黑）
      const M = bake(util, (await parse(mechB)).scene, m => (m.name === 'mat13' || m.transparent || m.opacity < 1) ? 'glow' : 'solid');
      // 位置（1 步 = 0.5 m）：上鸟居（s1 + 0.7）和拝殿前柱（s1 + 8.9）之间的空地，s1 + 1.8 … s1 + 7.0；横向 2.15 … 3.15，
      // 让开最后一对石灯笼（s1 + 4.5，横向 1.72 ± 0.3）和两侧杉树（≥ 3.3）
      const s = shrine.start + shrine.steps + 4.4, items = [], ped = [];
      for (const side of [1, -1]) {
        const a = route.at(s, side * 2.65), y = gy(a.pos.x, a.pos.z) + 0.02;
        const fx = -a.dir.x * 0.9 - side * a.left.x * 0.42, fz = -a.dir.z * 0.9 - side * a.left.z * 0.42;   // 脸朝来路、略朝参道中间
        items.push({ p: [a.pos.x, y + 0.95, a.pos.z], ry: Math.atan2(-fz, fx), s: 1.25 });                      // 机头 = 本地 +x；放大 1.25（身长 2.5、高 0.74）
        ped.push({ geo: new THREE.BoxGeometry(2.6, 0.95, 1.0), p: [a.pos.x, y + 0.47, a.pos.z], ry: -a.heading, color: '#6e6a62' });   // 石台（本地 x = 沿路）
        ped.push({ geo: new THREE.BoxGeometry(2.75, 0.1, 1.12), p: [a.pos.x, y + 0.9, a.pos.z], ry: -a.heading, color: '#5a5750' });
      }
      const body = util.instanced(M.solid, lam({ emissive: '#0d1a22' }), items); body.name = 'komainu'; grp.add(body); out.komainu.push(body);
      if (M.glow) { const gl = util.instanced(M.glow, shade(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), { mask: true, neon: true }), items); gl.name = 'komainuGlow'; grp.add(gl); out.komainu.push(gl); }
      const base = new THREE.Mesh(util.merged(ped), new THREE.MeshBasicMaterial({ vertexColors: true })); base.name = 'komainuBase'; grp.add(base);   // 石头和神社石灯笼一样不吃光
    }

    // ---------- ② 巡逻无人机（每架单独解析一次 = 各有一副骨骼）----------
    for (const [k, sc] of [[0, 3.5], [1, 25.5]]) {
      const g = await parse(droneB), root = g.scene;
      root.traverse(o => {
        if (!o.isMesh) return;
        o.frustumCulled = false; o.castShadow = false;
        const m = o.material.clone(); o.material = m;
        if (m.name === 'Material') { m.emissive = new THREE.Color('#ff1830'); m.emissiveIntensity = 2.5; m.toneMapped = false; }   // 眼睛
        else if (m.name === 'Main' || m.name === 'Material.001') m.color.set('#2b323d');                                          // 橙色壳 → 枪灰
        else if (m.name === 'Material.002' || m.name === 'Main2') m.color.set('#4a5260');
      });
      const beam = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.6, 20, 1, true).translate(0, -1.8, 0),
        new THREE.MeshBasicMaterial({ color: '#bff6ff', transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.y = 0.2;
      const d = new THREE.Group(); d.add(root, beam); d.scale.setScalar(0.9); d.name = 'drone' + k;
      const mixer = new THREE.AnimationMixer(root), clip = g.animations.find(c => /Idle/.test(c.name)) || g.animations[0];
      if (clip) mixer.clipAction(clip).play();
      grp.add(d); drones.push({ d, mixer, sc, ph: k * 2.1, prev: new THREE.Vector3() });
    }

    // ---------- ③ 招牌 + ④ 空调 / 天线 / 电缆：摆在 gits.js 的那批临街楼上 ----------
    const near = (G && G.near) || [];
    const signRoot = (await parse(signB)).scene, pieces = [];
    signRoot.traverse(o => { if (/^Sign_(\d|Small_\d)$/.test(o.name)) pieces.push(bake(util, o, m => m.map ? 'tex' : 'solid')); });
    const tex = [], frame = [], ant = [], cab = [];
    // 楼面上已经占掉的：city.js / gits.js 的竖招牌（E.facade：中心 p、宽 w、高 h）+ 空调外机（按 0.8 × 0.7 算）
    const busy = [...(E.facade || []), ...((G && G.ac) || []).map(it => ({ p: new THREE.Vector3(...it.p), w: 0.8, h: 0.7 }))];
    const clear = (c, w, y0, y1) => busy.every(f => Math.hypot(f.p.x - c.x, f.p.z - c.z) > w / 2 + f.w / 2 + 0.1 || f.p.y + f.h / 2 < y0 - 0.1 || f.p.y - f.h / 2 > y1 + 0.1);
    near.forEach((b, k) => {
      const a0 = route.at(b.sc, b.side * b.front), fx = -b.side * a0.left.x, fz = -b.side * a0.left.z;
      if (pieces.length && b.h > 3.6) {                 // 贴墙招牌：楼面上几处候选（两头 / 中间 × 三个高度）挑第一个不撞的，顶不超过屋檐下 0.25
        const P = pieces[(k * 5) % pieces.length], S = 1.25, w = P.w * S, h = P.h * S;
        let hit = null;
        for (const da of [k % 2 ? -0.25 : 0.25, 0, k % 2 ? 0.25 : -0.25]) for (const dy of [2.5, 3.2, 3.9]) {
          if (hit || dy + h > b.h - 0.25) continue;
          const c = route.at(b.sc + da * b.ds, b.side * (b.front - 0.1)).pos;
          if (clear(c, w, b.y0 + dy, b.y0 + dy + h)) hit = { p: [c.x, b.y0 + dy, c.z], ry: faceY(fx, fz), s: S };
        }
        if (hit) { if (P.tex) tex.push({ ...hit, geo: P.tex }); if (P.solid) frame.push({ ...hit, geo: P.solid }); busy.push({ p: new THREE.Vector3(hit.p[0], hit.p[1] + h / 2, hit.p[2]), w, h }); }
      }
      const r = route.at(b.sc + (k % 2 ? 0.2 : -0.2) * b.ds, b.side * (b.front + 0.9));
      ant.push({ p: [r.pos.x, b.y0 + b.h, r.pos.z], ry: faceY(fx, fz) + k, s: 1.3 + (k % 3) * 0.25, color: '#8a909c' });
      if (k % 2) { const c = route.at(b.sc + 0.35 * b.ds, b.side * (b.front - 0.08)); cab.push({ p: [c.pos.x, b.y0 + b.h - 0.25, c.pos.z], ry: faceY(fx, fz), s: [1, 1.1 + (k % 3) * 0.2, 1], color: '#0b0b10' }); }
    });
    if (tex.length) {
      const map = pieces.find(P => P.tex).tex.userData.map;
      const m = new THREE.Mesh(util.merged(tex), shade(new THREE.MeshBasicMaterial({ map, toneMapped: false }), { mask: true, neon: true })); m.name = 'kitSigns'; grp.add(m);
    }
    if (frame.length) { const m = new THREE.Mesh(util.merged(frame), lam({ emissive: '#08080c' })); m.name = 'kitSignFrames'; grp.add(m); }
    const one = (b, pick) => bake(util, b, pick).solid;
    if (ant.length) { const m = util.instanced(one((await parse(antB)).scene), new THREE.MeshLambertMaterial({ color: '#ffffff' }), ant); m.name = 'kitAntennas'; grp.add(m); }
    if (cab.length) {
      const g = one((await parse(cabB)).scene); g.computeBoundingBox(); g.translate(0, -g.boundingBox.max.y, 0);   // 挂点在顶上
      const m = util.instanced(g, new THREE.MeshLambertMaterial({ color: '#ffffff' }), cab); m.name = 'kitCables'; grp.add(m);
    }
    if (G && G.ac && G.ac.length) {                     // 空调：两台一叠（AC Stacked）为主，每 3 台换一台并排的（AC）
      const st = [], wide = [];
      G.ac.forEach((it, k) => {
        const p = { p: it.p, ry: faceY(it.f[0], it.f[1]), color: it.color };
        if (k % 3 === 2) wide.push({ ...p, s: 0.44 }); else st.push({ ...p, s: 0.6 });
      });
      for (const [items, b, name] of [[st, acsB, 'kitAcStacked'], [wide, acB, 'kitAc']]) {
        if (!items.length) continue;
        const g = one((await parse(b)).scene); g.computeBoundingBox(); g.translate(0, -(g.boundingBox.max.y) / 2, 0);   // 以中心为挂点（和原来的方块一样）
        const m = util.instanced(g, lam({ emissive: '#060608' }), items); m.name = name; grp.add(m);
      }
      if (G.acMesh) G.acMesh.visible = false;
    }
    scene.add(grp);
  }).catch(e => console.warn('cyber models 没加载上，用程序生成的场景', e));

  // ---------- 每帧：无人机绕 8 字、朝前飞、上下浮 ----------
  const v = new THREE.Vector3();
  out.update = (dt, st) => {
    for (const m of out.komainu) m.castShadow = false;   // 狛犬不投影：lighting.js 第一帧才建投影名单，模型先到就会被加进去，这里每帧摘掉
    for (const D of drones) {
      const u = (st.t || 0) * 0.16 + D.ph, a = route.at(D.sc + 3.2 * Math.sin(u), 1.7 * Math.sin(2 * u));
      v.copy(a.pos); v.y = gy(a.pos.x, a.pos.z) + 3.4 + 0.2 * Math.sin((st.t || 0) * 1.7 + D.ph);
      const dx = v.x - D.prev.x, dz = v.z - D.prev.z;
      if (dx * dx + dz * dz > 1e-8) D.d.rotation.y = faceY(dx, dz);
      D.prev.copy(v); D.d.position.copy(v); D.mixer.update(dt);
    }
  };
  return out;
}
