// 跑酷的画面：夜里的城市屋顶。楼 / 斜板 / 障碍按 logic.js 的关卡现做现扔；远景天际线 1 个合并网格，按 240 m 一块跟着人平移。
// 窗户、屋顶车道线都在着色器里按坐标画（不用贴图，楼多长都不拉伸）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { rng, LANE, atLeg, yawOf } from './logic.js';
import { SEG, PALETTE } from '/game/style.js';

export const ROOF_W = 8;                     // 屋顶宽（z），三条道在中间 ±2.4
// 颜色按 ART 范式（game/style.js）：路段色只标腿上有力的地方——起跳前沿 = 台阶黄（起跳前给 lift）、斜板 = 上坡绿、落地沿 = 下坡蓝；
//   其余用跑酷色板（品红 + 月光），不用青（撞下坡蓝）、不用琥珀（峰哥专用）、不用黄（台阶专用）
const [MAGENTA, MOON] = PALETTE.parkour.accent;
const lin = hex => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)})`; };

// 楼：一个材质一次绘制。竖墙 = 窗户（按 (横向坐标, y) 分格，hash 决定亮不亮 / 暖还是冷）；roof = 顶面画成屋顶（混凝土方砖 + 三条道的发光分隔线 + 两边警示带）。
// local = 用几何自己的坐标（天际线整体平移时窗户不跳）
function winMat(base, local, roof) {
  const m = new THREE.MeshLambertMaterial({ color: base });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vP; varying vec3 vN; varying vec3 vL;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvL = position;\nvN = ${local ? 'normal' : 'normalize(mat3(modelMatrix) * normal)'};\nvP = ${local ? 'position' : '(modelMatrix * vec4(position, 1.0)).xyz'};`);   // 第 6 轮：楼会转 90°，窗户按世界法线分面
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vP; varying vec3 vN; varying vec3 vL;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (abs(vN.y) < 0.5) {
          float u = abs(vN.x) > 0.5 ? vP.z : vP.x;
          vec2 c = vec2(floor(u / 1.6), floor(vP.y / 2.2)), f = vec2(fract(u / 1.6), fract(vP.y / 2.2));
          float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.8);
          float r = h21(c + floor(vP.x / 400.0)), lit = step(0.62, r);
          vec3 wc = mix(vec3(1.0, 0.78, 0.45), vec3(0.55, 0.85, 1.0), step(0.85, r));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.04, 0.07), win);
          totalEmissiveRadiance += win * lit * wc * 0.9;
        }${roof ? ` else if (vN.y > 0.5) {
          diffuseColor.rgb = vec3(0.29, 0.31, 0.36);
          vec2 g = abs(fract(vL.xz / 2.0) - 0.5);                      // 屋顶花纹按楼自己的坐标（x = 沿路，z = 横向）：转弯以后车道线还在路中间
          diffuseColor.rgb *= 0.85 + 0.15 * step(0.03, min(g.x, g.y));
          float z = abs(vL.z);
          float lane = 1.0 - smoothstep(0.03, 0.07, abs(z - ${(LANE / 2).toFixed(2)}));
          totalEmissiveRadiance += lane * step(0.45, fract(vL.x / 3.0)) * ${lin(MOON)} * 0.6 * step(abs(vL.z), ${(ROOF_W / 2).toFixed(1)});
          float edge = step(${(LANE * 1.5 + 0.1).toFixed(2)}, z) * step(z, ${(LANE * 1.5 + 0.45).toFixed(2)});
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.62, 0.64, 0.68), vec3(0.08), step(0.5, fract((vL.x + z) / 1.2))), edge);
        }` : ''}`);
  };
  m.customProgramCacheKey = () => 'win' + (local ? 'L' : 'W') + (roof ? 'R' : '');
  return m;
}

export function makeCity(scene, { low = false } = {}) {
  const M = {
    win: winMat('#1d2333', false, true),
    parapet: new THREE.MeshLambertMaterial({ color: '#2a2f3a' }),
    side: new THREE.MeshBasicMaterial({ color: MAGENTA }),
    jump: new THREE.MeshBasicMaterial({ color: SEG.stairs_up }), up: new THREE.MeshBasicMaterial({ color: SEG.up }), land: new THREE.MeshBasicMaterial({ color: SEG.down }),
    ramp: new THREE.MeshLambertMaterial({ color: '#8a6a3a', emissive: '#2a1a08' }),
    ac: new THREE.MeshLambertMaterial({ color: '#d7dde4' }), fan: new THREE.MeshBasicMaterial({ color: '#15181e' }),
    warn: new THREE.MeshBasicMaterial({ color: SEG.stairs_up }),   // 要跳的障碍前沿 = 台阶黄
    pole: new THREE.MeshLambertMaterial({ color: '#8d96a3' }), cloth: new THREE.MeshLambertMaterial({ color: '#ff2e88', emissive: '#6a0d36', side: THREE.DoubleSide }),
    tank: new THREE.MeshLambertMaterial({ color: '#6d7b86' }), tankBand: new THREE.MeshBasicMaterial({ color: MOON }),
  };

  // ---- 天空 + 远景 ----
  const sky = document.createElement('canvas'); sky.width = 4; sky.height = 256;
  const sg = sky.getContext('2d'), gr = sg.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#05060f'); gr.addColorStop(0.55, '#1a1238'); gr.addColorStop(0.8, '#4a1f4f'); gr.addColorStop(1, '#6b2a4a');
  sg.fillStyle = gr; sg.fillRect(0, 0, 4, 256);
  const skyT = new THREE.CanvasTexture(sky); skyT.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyT;
  scene.fog = new THREE.Fog('#3a1a44', 60, low ? 170 : 230);

  // 远景：第 6 轮起路会往四个方向拐，天际线改成围着人的一圈（跟着人整体平移，1 次绘制）；近处的视差交给每栋屋顶两边的矮楼（segMesh）
  const R = rng(11), parts = [], skyMat = winMat('#161a28', true);
  for (let i = 0; i < (low ? 60 : 130); i++) {
    const far = R(), a = R() * Math.PI * 2, rr = 70 + far * 140, top = -6 + far * far * 60 + R() * 14;
    const w = 10 + R() * 14, d = 10 + R() * 14, h = top + 60;
    parts.push(new THREE.BoxGeometry(w, h, d).rotateY(a).translate(Math.cos(a) * rr, top - h / 2, Math.sin(a) * rr));
  }
  const skyline = new THREE.Mesh(mergeGeometries(parts), skyMat); skyline.frustumCulled = false;
  scene.add(skyline);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: '#ffe9c4', fog: false }));
  moon.position.set(300, 90, -120); moon.lookAt(0, 0, 0); scene.add(moon);
  const W = {};

  // ---- 关卡物件 ----
  const live = new Map();                                  // 关卡里的 seg / obs 对象 → 网格
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  // 楼 / 斜板都在自己那条腿的坐标里建（x = 沿路，z = 右），最后按腿的起点和朝向摆到世界里
  const place = (g, leg, sMid, y) => { atLeg(leg, sMid, 0, W); g.position.set(W.x, y, W.z); g.rotation.y = yawOf(leg.dir); return g; };
  function segMesh(s, prev, next) {
    const g = new THREE.Group();
    if (s.kind === 'roof') {
      // 路口（第 6 轮）：转出去的这栋（turnIn）往回多盖 ROOF_W/2，把路口那块方地盖住；转进来的那栋（turnOut）少盖 ROOF_W/2，免得两块叠在一起闪
      const a0 = s.x0 - (s.turnIn ? ROOF_W / 2 : 0), a1 = s.x1 - (s.turnOut ? ROOF_W / 2 : 0), L = a1 - a0, c = (a0 + a1) / 2;
      const R2 = rng(Math.floor(Math.abs(s.x0) * 7) + 3), boxes = [box(L, 80, ROOF_W).translate(0, -40, 0)];
      for (const side of [-1, 1]) for (let x = -L / 2; x < L / 2 - 4;) {   // 两边的矮楼：楼顶比跑道低 2–11 m，近处的视差靠它们
        const w = Math.min(L / 2 - x, 8 + R2() * 8), d = 6 + R2() * 8, top = -2 - R2() * 9, off = ROOF_W / 2 + 1.5 + R2() * 5 + d / 2;
        boxes.push(box(w - 1, 80 + top, d).translate(x + w / 2, top - (80 + top) / 2, side * off)); x += w;
      }
      g.add(new THREE.Mesh(mergeGeometries(boxes), M.win));
      // 两边矮墙 + 楼沿霓虹；路口那栋在进来的一侧开口（前 ROOF_W 米），对面立一堵封墙（不转弯就撞它）
      const entry = s.turnIn ? s.turnIn : 0, pars = [], neon = [];
      for (const side of [-1, 1]) {
        const open = entry && side === entry ? ROOF_W : 0, l = L - open, x = open / 2;
        pars.push(box(l, 0.5, 0.25).translate(x, 0.25, side * (ROOF_W / 2 - 0.12)));
        neon.push(box(l, 0.08, 0.1).translate(x, -0.3, side * (ROOF_W / 2 + 0.05)));
      }
      g.add(new THREE.Mesh(mergeGeometries(pars), M.parapet), new THREE.Mesh(mergeGeometries(neon), M.side));
      if (entry) {                                                    // 封墙：在路口那块方地的外侧（右转 = 新腿的左边），2.4 m 高，顶上一道品红
        const z = -entry * (ROOF_W / 2 + 0.2), x = -L / 2 + ROOF_W / 2;
        g.add(new THREE.Mesh(box(ROOF_W + 0.4, 2.4, 0.3).translate(x, 1.2, z), M.parapet), new THREE.Mesh(box(ROOF_W + 0.4, 0.12, 0.34).translate(x, 2.4, z), M.side));
      }
      // 楼头楼尾的亮沿：前面是楼缝 = 起跳（台阶黄），前面是斜板 = 上坡绿；后面是楼缝 = 落地（下坡蓝）。楼缝在哪一眼看清
      if (next && next.kind !== 'roof') g.add(new THREE.Mesh(box(0.14, 0.1, ROOF_W).translate(L / 2 - 0.07, 0.02, 0), next.kind === 'ramp' ? M.up : M.jump));
      if (prev && prev.kind === 'gap') g.add(new THREE.Mesh(box(0.14, 0.1, ROOF_W).translate(-L / 2 + 0.07, 0.02, 0), M.land));
      return place(g, s.leg, c, s.h0);
    } else if (s.kind === 'ramp') {
      const L = s.x1 - s.x0, dy = s.h1 - s.h0, len = Math.hypot(L, dy);
      const p = new THREE.Mesh(box(len, 0.25, ROOF_W - 1.5), M.ramp);
      p.rotation.z = Math.atan2(dy, L); p.position.y = -0.12;
      const e = (ROOF_W - 1.5) / 2;                     // 斜板上给的是 up：扶手 + 两侧板沿都用上坡绿
      const rails = new THREE.Mesh(mergeGeometries([box(len, 0.06, 0.06).translate(0, 0.9, ROOF_W / 2 - 0.8), box(len, 0.06, 0.06).translate(0, 0.9, -ROOF_W / 2 + 0.8),
        box(len, 0.08, 0.12).translate(0, 0.02, e - 0.06), box(len, 0.08, 0.12).translate(0, 0.02, -e + 0.06)]), M.up);
      rails.rotation.z = p.rotation.z;
      g.add(p, rails);
      return place(g, s.leg, (s.x0 + s.x1) / 2, (s.h0 + s.h1) / 2);
    }
    return null;
  }
  function obsMesh(o, groundY) {
    const g = new THREE.Group(), zs = o.lanes.map(l => (l - 1) * LANE);
    if (o.type === 'low') {
      if (o.lanes.length === 3) {                         // 整排矮墙：黄黑警示
        g.add(new THREE.Mesh(box(0.5, 0.8, LANE * 3), M.parapet).translateY(0.4), new THREE.Mesh(box(0.52, 0.12, LANE * 3 + 0.02), M.warn).translateY(0.7));
      } else for (const z of zs) {                        // 空调外机：正面对着人，风扇 + 一道橙条
        const a = new THREE.Group(); a.position.z = z;
        a.add(new THREE.Mesh(box(0.9, 0.8, 1.3), M.ac).translateY(0.4));
        const fan = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20), M.fan); fan.rotation.y = -Math.PI / 2; fan.position.set(-0.46, 0.42, 0.15); a.add(fan);
        a.add(new THREE.Mesh(box(0.92, 0.07, 1.32), M.warn).translateY(0.83));
        g.add(a);
      }
    } else if (o.type === 'high') {                        // 晾衣杆：两根立柱 + 横杆 + 挂着的布（下沿 1.0，滑铲钻过去）
      const zmin = Math.min(...zs) - LANE / 2, zmax = Math.max(...zs) + LANE / 2, w = zmax - zmin, zc = (zmin + zmax) / 2;
      for (const z of [zmin, zmax]) g.add(new THREE.Mesh(box(0.1, 2.0, 0.1).translate(0, 1.0, z), M.pole));
      g.add(new THREE.Mesh(box(0.08, 0.08, w).translate(0, 1.95, zc), M.pole));
      g.add(new THREE.Mesh(new THREE.PlaneGeometry(w - 0.2, 0.6).rotateY(Math.PI / 2).translate(0, 1.45, zc), M.cloth));
    } else {                                               // 水箱：一条道一个，高 2.6，只能换道
      for (const z of zs) {
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.2, 16).translate(0, 1.5, z), M.tank));
        g.add(new THREE.Mesh(box(1.2, 0.4, 1.2).translate(0, 0.2, z), M.parapet));
        g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.1, 16).translate(0, 2.2, z), M.tankBand));
      }
    }
    return place(g, o.leg, o.x, groundY);
  }
  const kill = m => { scene.remove(m); m.traverse(c => { if (c.isMesh) c.geometry.dispose(); }); };
  return {
    // 每帧：把关卡里新出现的物件建出来、没了的扔掉；天际线跟着人挪
    sync(level, pw) {                                   // pw = 玩家世界位置 {x, z}
      const want = new Set();
      level.segs.forEach((s, i) => { want.add(s); if (!live.has(s)) { const m = segMesh(s, level.segs[i - 1], level.segs[i + 1]); live.set(s, m); if (m) scene.add(m); } });
      for (const o of level.obs) { want.add(o); if (!live.has(o)) { const m = obsMesh(o, level.ground(o.x) ?? 0); live.set(o, m); scene.add(m); } }
      for (const [k, m] of live) if (!want.has(k)) { if (m) kill(m); live.delete(k); }
      skyline.position.set(pw.x, 0, pw.z);
      moon.position.set(pw.x + 300, 90, pw.z - 120);
    },
    meshOf: k => live.get(k),
    clear() { for (const m of live.values()) if (m) kill(m); live.clear(); },
  };
}
