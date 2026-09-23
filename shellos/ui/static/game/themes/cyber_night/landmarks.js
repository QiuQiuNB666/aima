// 认得出的真地标：涩谷站前的忠犬ハチ公铜像（开场帧左侧人行道、面朝走过来的人）、天桥脚下的蓝色桥名牌、
//   爱宕神社「出世の石段」石柱（大鸟居右柱外）。都不吃光（紫色环境光会把铜像染成塑料紫），明暗按朝向烘进顶点色。
import * as THREE from 'three';

// 顶点色 × 朝向明暗（上亮、朝镜头一侧亮）
function bake(geo, lo = 0.55) {
  const n = geo.attributes.normal, c = geo.attributes.color;
  for (let k = 0; k < c.count; k++) { const f = lo + (1 - lo) * Math.max(0, n.getY(k) * 0.75 + n.getX(k) * -0.35 + n.getZ(k) * 0.25 + 0.2); c.setXYZ(k, c.getX(k) * f, c.getY(k) * f, c.getZ(k) * f); }
  return geo;
}

// 坐着的秋田犬（ハチ公）：局部 −x = 狗脸朝向，y 向上，站在 y=0；高约 0.62
function hachiko(util, y0) {
  const B = (x, y, z) => new THREE.BoxGeometry(x, y, z), BR = '#5e5238', parts = [];
  const put = (geo, x, y, z, rz = 0) => { if (rz) geo.rotateZ(-rz); parts.push({ geo, p: [-x, y0 + y, z], color: BR }); };
  put(B(0.4, 0.24, 0.2), 0.0, 0.2, 0, 0.55);                       // 躯干（坐姿，胸口抬起）
  put(B(0.24, 0.2, 0.25), -0.13, 0.1, 0);                          // 后腿 / 臀
  for (const z of [-0.06, 0.06]) put(B(0.06, 0.27, 0.06), 0.15, 0.135, z);   // 前腿
  put(B(0.13, 0.2, 0.15), 0.19, 0.38, 0, -0.35);                   // 脖子
  put(B(0.19, 0.15, 0.16), 0.24, 0.5, 0);                          // 头
  put(B(0.12, 0.08, 0.1), 0.36, 0.47, 0);                          // 嘴
  for (const z of [-0.05, 0.05]) put(new THREE.ConeGeometry(0.035, 0.09, 4), 0.22, 0.61, z);   // 立耳
  const tail = new THREE.TorusGeometry(0.055, 0.022, 6, 10); tail.rotateY(Math.PI / 2);
  parts.push({ geo: tail, p: [0.21, y0 + 0.27, 0], color: BR });  // 卷尾
  return parts;
}

export function buildLandmarks(scene, ctx) {
  const { route, util } = ctx, gy = (x, z) => util.nearestRoute(route, x, z).y - 0.06;
  const place = (obj, s, lat, face = 0) => {          // 局部 +x = 行进方向，face 再绕 y 转
    const a = route.at(s, lat); obj.position.set(a.pos.x, gy(a.pos.x, a.pos.z), a.pos.z); obj.rotation.y = -a.heading + face; scene.add(obj); return obj;
  };
  const stoneMat = new THREE.MeshBasicMaterial({ vertexColors: true });

  // ---- ハチ公：花岗岩底座 0.8 × 0.55 + 铜像，底座朝来路那面嵌铭牌 ----
  {
    const g = new THREE.Group(); g.name = 'hachiko';
    const parts = [{ geo: new THREE.BoxGeometry(0.8, 0.55, 0.46), p: [0, 0.275, 0], color: '#6e6b66' },
      { geo: new THREE.BoxGeometry(0.88, 0.08, 0.54), p: [0, 0.04, 0], color: '#575550' }, ...hachiko(util, 0.55)];
    g.add(new THREE.Mesh(bake(util.merged(parts)), stoneMat));
    const plate = util.textPlane('忠犬ハチ公', 0.13, { color: '#f3e6c4', bg: '#3a3226', border: '#b89a5a', weight: 900 });
    plate.position.set(-0.405, 0.33, 0); plate.rotation.y = -Math.PI / 2; g.add(plate);
    place(g, 3.2, 3.5);                      // 离路 3.5：镜头（路左 1.75）走过时不从头顶擦过
  }

  // ---- 歩道橋の橋名板：天桥脚下右侧，蓝底白字（日本歩道橋的标准样式），正对走过来的人 ----
  const bridge = route.segs.find(q => q.kind === 'stairs_up');
  if (bridge) {
    const g = new THREE.Group(); g.name = 'bridgePlate';
    g.add(new THREE.Mesh(bake(util.merged([{ geo: new THREE.CylinderGeometry(0.035, 0.04, 2.1, 6), p: [0, 1.05, 0], color: '#9aa0ac' }])), stoneMat));
    const plate = ctx.kit.sign2(util, '渋谷駅前歩道橋', 0.3, { color: '#ffffff', bg: '#1f55b0', border: '#ffffff', weight: 800 });
    plate.position.set(-0.05, 1.85, 0); plate.rotation.y = -Math.PI / 2; g.add(plate);
    place(g, bridge.start - 0.6, -1.75);
  }

  // ---- 出世の石段：大鸟居右柱外的花岗岩石柱（高 1.7），竖刻黑字，正对走过来的人 ----
  const shrine = route.segs.filter(q => q.kind === 'stairs_up').pop();
  if (shrine && shrine !== bridge) {
    const g = new THREE.Group(); g.name = 'shusseStone';
    g.add(new THREE.Mesh(bake(util.merged([{ geo: new THREE.BoxGeometry(0.34, 1.7, 0.34), p: [0, 0.85, 0], color: '#a7a399' },
      { geo: new THREE.BoxGeometry(0.5, 0.12, 0.5), p: [0, 0.06, 0], color: '#77736b' }]), 0.6), stoneMat));
    const t = util.textPlane('出世の石段', 1.25, { vertical: true, color: '#1d1a17', bg: '#b9b5aa', weight: 900 });
    t.position.set(-0.175, 0.95, 0); t.rotation.y = -Math.PI / 2; g.add(t);
    place(g, shrine.start - 1.2, -1.45);     // 鸟居右柱前、路沿外：再往外会被右侧商铺挡住
  }
}

// ---------- 第 2 批 ----------
// ① 起点背后的街口大屏（涩谷十字路口那种整面楼的广告屏）：正对来路，正面镜头（cam=front）回看时它就是背景；内容横向滚动
// ② 神社石阶两侧的奉納提灯（绳上一串红白纸灯笼，自己发光）：从鸟居一路亮到拝殿，石阶段 3 米外一眼看得出
// ③ 路口小物：カーブミラー、止まれ、共享单车（东京塔试过：跟拍镜头朝下看，远处高塔不是出画就是埋在楼后面，放弃）
import { shade } from './lib.js';
let screenTex = null;
export const HOUNOU = { mesh: null, s: [], on: [] };   // 奉納提灯：每盏在路线上的步数 + 点亮后的颜色（interact.js 按化身位置一盏盏点亮）

export function buildLandmarks2(scene, ctx) {
  const { route, util, rand } = ctx, gy = (x, z) => util.nearestRoute(route, x, z).y - 0.06, N = route.N;

  // ① 大屏：s = −13、横跨街口，屏 8.4 × 4.7，底边离地 1.1（正面镜头竖直视野在这个距离只有约 7 高）；后面一栋深色楼托着
  {
    const W = 2048, H = 512;
    screenTex = util.canvasTexture(W, H, (g) => {
      const seg = (x0, w, bg0, bg1, draw) => { const gr = g.createLinearGradient(x0, 0, x0 + w, H); gr.addColorStop(0, bg0); gr.addColorStop(1, bg1); g.fillStyle = gr; g.fillRect(x0, 0, w, H); draw(x0, w); };
      const txt = (t, x, y, px, col, glow) => { g.font = `900 ${px}px ${util.FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.shadowColor = glow; g.shadowBlur = 30; g.fillStyle = col; g.fillText(t, x, y); g.shadowBlur = 0; };
      seg(0, 700, '#ff2e88', '#6a1bd8', (x, w) => { txt('峰哥亡命天涯', x + w / 2, H * 0.42, 118, '#ffffff', '#ffd0f0'); txt('EXO · CLIMB · 3776', x + w / 2, H * 0.72, 54, '#ffe45c', '#ff9a00'); });
      seg(700, 660, '#08131f', '#0b3a5c', (x, w) => { for (let k = 0; k < 16; k++) { g.fillStyle = `hsl(${180 + k * 9},90%,${45 + (k % 3) * 8}%)`; g.fillRect(x + 20 + k * 40, H * (0.85 - 0.04 * ((k * 7) % 11)), 26, H); } txt('渋谷', x + w / 2, H * 0.4, 190, '#ffffff', '#3ff0ff'); });
      seg(1360, 688, '#ffd23f', '#ff6a1a', (x, w) => { txt('SHIBUYA', x + w / 2, H * 0.36, 150, '#1a0b2e', '#ffffff'); txt('スクランブル交差点', x + w / 2, H * 0.72, 70, '#1a0b2e', '#ffffff'); });
    }, { repeat: true });
    screenTex.repeat.set(0.5, 1);
    const a = route.at(-13), y0 = gy(a.pos.x, a.pos.z);
    const bld = new THREE.Mesh(new THREE.BoxGeometry(3, 11, 14), new THREE.MeshLambertMaterial({ color: '#1c1830' }));
    bld.position.set(a.pos.x - a.dir.x * 1.6, y0 + 5.5, a.pos.z - a.dir.z * 1.6); bld.rotation.y = -a.heading; bld.name = 'screenBuilding';
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 4.7), shade(new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }), { neon: true }));
    scr.position.set(a.pos.x - a.dir.x * 0.08, y0 + 1.1 + 2.35, a.pos.z - a.dir.z * 0.08); scr.rotation.y = Math.PI / 2 - a.heading;   // 平面法线 +z 转到 +dir：正面朝走过来的人
    scr.name = 'bigScreen';
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.2, 5.0, 8.7), new THREE.MeshBasicMaterial({ color: '#0a0a12' }));
    frame.position.set(a.pos.x - a.dir.x * 0.2, y0 + 3.45, a.pos.z - a.dir.z * 0.2); frame.rotation.y = -a.heading;
    scene.add(bld, frame, scr);
  }

  // ② 奉納提灯：石阶段两侧各一根绳（右 2.3、左 3.5：左边是镜头那侧，再近会从镜头边上擦过），绳高 2.2（灯在镜头视线下面，衬着石阶不衬天），红白各半
  const shrine = route.segs.filter(q => q.kind === 'stairs_up').pop();
  if (shrine) {
    const s0 = shrine.start - 0.4, s1 = shrine.start + shrine.steps + 0.6, lam = [], posts = [], rope = [];
    for (const lat of [-2.3, 3.5]) {
      let prev = null;
      for (let s = s0; s <= s1 + 1e-6; s += 1.1) {
        const a = route.at(s, lat), y = Math.max(route.heightAt(Math.min(s, N - 0.01)), gy(a.pos.x, a.pos.z)) , top = y + 2.2;
        posts.push({ p: [a.pos.x, y + 1.12, a.pos.z], s: [0.06, 2.25, 0.06] });
        const p = new THREE.Vector3(a.pos.x, top, a.pos.z);
        if (prev) {
          for (let k = 0; k < 2; k++) {                          // 两盏挂在绳的 1/3、2/3 处
            const u = (k + 1) / 3, q = prev.clone().lerp(p, u); q.y -= 0.12 * Math.sin(Math.PI * u) + 0.32;
            HOUNOU.on.push(lam.length % 2 ? '#e8402a' : '#e8c9a0'); HOUNOU.s.push(s - 1.1 * (1 - u));
            lam.push({ p: q.toArray(), s: [1, 1.25, 1], color: HOUNOU.on[HOUNOU.on.length - 1] });
          }
          rope.push(prev.x, prev.y, prev.z, (prev.x + p.x) / 2, (prev.y + p.y) / 2 - 0.12, (prev.z + p.z) / 2, (prev.x + p.x) / 2, (prev.y + p.y) / 2 - 0.12, (prev.z + p.z) / 2, p.x, p.y, p.z);
        }
        prev = p;
      }
    }
    const lm = util.instanced(new THREE.SphereGeometry(0.12, 12, 8),   // 提灯：椭圆（s.y 1.25）
      new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), lam); lm.name = 'hounouLanterns'; HOUNOU.mesh = lm;
    const pm = util.instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#2a1a14' }), posts); pm.name = 'lanternPosts';
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rope, 3));
    const rl = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#0d0806' })); rl.name = 'lanternRope';
    scene.add(lm, pm, rl);
  }

  // ③ 日本街头的小物（一眼日本）：橙色カーブミラー（路口凸面镜）两根、倒三角「止まれ」牌、路边一排共享单车
  {
    const parts = [], B = (x, y, z) => new THREE.BoxGeometry(x, y, z), OR = '#ff7a1a';
    const put = (s, lat, list, face = 0) => { const a = route.at(s, lat), y = gy(a.pos.x, a.pos.z), ry = -a.heading + face;
      const c = Math.cos(ry), sn = Math.sin(ry); for (const q of list) parts.push({ ...q, p: [a.pos.x + q.p[0] * c + q.p[2] * sn, y + q.p[1], a.pos.z - q.p[0] * sn + q.p[2] * c], ry: (q.ry || 0) + ry }); };
    const mirror = [{ geo: new THREE.CylinderGeometry(0.04, 0.05, 2.6, 8), p: [0, 1.3, 0], color: OR },
      { geo: new THREE.CylinderGeometry(0.34, 0.34, 0.06, 20).rotateZ(Math.PI / 2), p: [-0.05, 2.6, 0], color: OR },
      { geo: new THREE.CylinderGeometry(0.29, 0.29, 0.02, 20).rotateZ(Math.PI / 2), p: [-0.09, 2.6, 0], color: '#9fc3e8' }];   // 镜面朝来路
    put(3.4, -2.5, mirror, 0.5); put(26.3, -2.1, mirror, 0.35);
    const tri = new THREE.CylinderGeometry(0.42, 0.42, 0.04, 3).rotateZ(Math.PI / 2).rotateX(Math.PI / 2);   // 倒三角（尖朝下）
    put(6.2, -1.75, [{ geo: new THREE.CylinderGeometry(0.035, 0.035, 2.1, 6), p: [0, 1.05, 0], color: '#c8ccd4' }, { geo: tri, p: [-0.05, 2.15, 0], color: '#d81e2a' }], 0.3);
    for (let k = 0; k < 4; k++) {                                        // 共享单车：车架 + 两个轮（扁圆柱），红色一排
      const bike = [{ geo: new THREE.CylinderGeometry(0.2, 0.2, 0.04, 14).rotateX(Math.PI / 2), p: [-0.33, 0.2, 0], color: '#16181e' },
        { geo: new THREE.CylinderGeometry(0.2, 0.2, 0.04, 14).rotateX(Math.PI / 2), p: [0.33, 0.2, 0], color: '#16181e' },
        { geo: B(0.66, 0.05, 0.05), p: [0, 0.42, 0], color: '#e8282e' }, { geo: B(0.05, 0.4, 0.05), p: [-0.12, 0.35, 0], color: '#e8282e' },
        { geo: B(0.2, 0.18, 0.18), p: [0.36, 0.5, 0], color: '#e8282e' }];
      put(-1.5 - k * 0.45, -2.7, bike, Math.PI / 2 - 0.25);
    }
    const m = new THREE.Mesh(util.merged(parts), new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#140c10' })); m.name = 'streetBits'; scene.add(m);
  }
}

export function updateLandmarks(dt, st) {
  if (screenTex) screenTex.offset.x = (screenTex.offset.x + dt * 0.035) % 1;
}
