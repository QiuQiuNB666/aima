// 跑酷的画面：夜里的城市屋顶。楼 / 斜板 / 障碍按 logic.js 的关卡现做现扔；远景天际线 1 个合并网格，按 240 m 一块跟着人平移。
// 窗户、屋顶车道线都在着色器里按坐标画（不用贴图，楼多长都不拉伸）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { rng, LANE } from './logic.js';

export const ROOF_W = 8;                     // 屋顶宽（z），三条道在中间 ±2.4
const NEON = ['#29e7ff', '#ff2e88', '#ffd54f', '#7c5cff'];

// 楼：一个材质一次绘制。竖墙 = 窗户（按 (横向坐标, y) 分格，hash 决定亮不亮 / 暖还是冷）；roof = 顶面画成屋顶（混凝土方砖 + 三条道的发光分隔线 + 两边警示带）。
// local = 用几何自己的坐标（天际线整体平移时窗户不跳）
function winMat(base, local, roof) {
  const m = new THREE.MeshLambertMaterial({ color: base });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vP; varying vec3 vN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvN = normal;\nvP = ${local ? 'position' : '(modelMatrix * vec4(position, 1.0)).xyz'};`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vP; varying vec3 vN;
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
          vec2 g = abs(fract(vP.xz / 2.0) - 0.5);
          diffuseColor.rgb *= 0.85 + 0.15 * step(0.03, min(g.x, g.y));
          float z = abs(vP.z);
          float lane = 1.0 - smoothstep(0.03, 0.07, abs(z - ${(LANE / 2).toFixed(2)}));
          totalEmissiveRadiance += lane * step(0.45, fract(vP.x / 3.0)) * vec3(0.16, 0.9, 1.0) * 0.8;
          float edge = step(${(LANE * 1.5 + 0.1).toFixed(2)}, z) * step(z, ${(LANE * 1.5 + 0.45).toFixed(2)});
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(1.0, 0.75, 0.1), vec3(0.08), step(0.5, fract((vP.x + z) / 1.2))), edge);
        }` : ''}`);
  };
  m.customProgramCacheKey = () => 'win' + (local ? 'L' : 'W') + (roof ? 'R' : '');
  return m;
}

export function makeCity(scene, { low = false } = {}) {
  const M = {
    win: winMat('#1d2333', false, true),
    parapet: new THREE.MeshLambertMaterial({ color: '#2a2f3a' }),
    neon: NEON.map(c => new THREE.MeshBasicMaterial({ color: c })),
    ramp: new THREE.MeshLambertMaterial({ color: '#8a6a3a', emissive: '#2a1a08' }),
    ac: new THREE.MeshLambertMaterial({ color: '#d7dde4' }), fan: new THREE.MeshBasicMaterial({ color: '#15181e' }),
    warn: new THREE.MeshBasicMaterial({ color: '#ffb03a' }),
    pole: new THREE.MeshLambertMaterial({ color: '#8d96a3' }), cloth: new THREE.MeshLambertMaterial({ color: '#ff2e88', emissive: '#6a0d36', side: THREE.DoubleSide }),
    tank: new THREE.MeshLambertMaterial({ color: '#6d7b86' }), tankBand: new THREE.MeshBasicMaterial({ color: '#29e7ff' }),
  };

  // ---- 天空 + 远景 ----
  const sky = document.createElement('canvas'); sky.width = 4; sky.height = 256;
  const sg = sky.getContext('2d'), gr = sg.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#05060f'); gr.addColorStop(0.55, '#1a1238'); gr.addColorStop(0.8, '#4a1f4f'); gr.addColorStop(1, '#6b2a4a');
  sg.fillStyle = gr; sg.fillRect(0, 0, 4, 256);
  const skyT = new THREE.CanvasTexture(sky); skyT.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyT;
  scene.fog = new THREE.Fog('#3a1a44', 60, low ? 170 : 230);

  const T = 240, R = rng(11), parts = [], skyMat = winMat('#161a28', true);
  for (let i = 0; i < (low ? 45 : 100); i++) {           // 两侧的楼：近的矮（楼顶比跑道低，才像在屋顶上跑），远的才有高塔
    const far = R(), z = (R() < 0.5 ? -1 : 1) * (14 + far * 130), top = -14 + far * far * 60 + R() * 12;
    const w = 8 + R() * 12, d = 8 + R() * 12, h = top + 60, x = R() * T;
    for (const k of [-1, 0, 1]) parts.push(new THREE.BoxGeometry(w, h, d).translate(x + k * T, top - h / 2, z));
  }
  const skyline = new THREE.Mesh(mergeGeometries(parts), skyMat); skyline.frustumCulled = false;
  scene.add(skyline);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(9, 32), new THREE.MeshBasicMaterial({ color: '#ffe9c4', fog: false }));
  moon.position.set(300, 90, -120); moon.lookAt(0, 0, 0); scene.add(moon);

  // ---- 关卡物件 ----
  const live = new Map();                                  // 关卡里的 seg / obs 对象 → 网格
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  function segMesh(s) {
    const L = s.x1 - s.x0, g = new THREE.Group();
    if (s.kind === 'roof') {
      const b = new THREE.Mesh(box(L, 80, ROOF_W).translate(0, -40, 0), M.win);
      const par = new THREE.Mesh(mergeGeometries([box(L, 0.5, 0.25).translate(0, 0.25, ROOF_W / 2 - 0.12), box(L, 0.5, 0.25).translate(0, 0.25, -ROOF_W / 2 + 0.12)]), M.parapet);
      const neon = new THREE.Mesh(mergeGeometries([box(L, 0.08, 0.1).translate(0, -0.3, ROOF_W / 2 + 0.05), box(L, 0.08, 0.1).translate(0, -0.3, -ROOF_W / 2 - 0.05), box(0.1, 0.08, ROOF_W).translate(L / 2 + 0.05, -0.3, 0)]),
        M.neon[Math.floor(s.x0 / 7) % NEON.length]);   // 楼沿一圈霓虹：楼缝在哪一眼看清
      g.add(b, par, neon);
      g.position.set((s.x0 + s.x1) / 2, s.h0, 0);
    } else if (s.kind === 'ramp') {
      const dy = s.h1 - s.h0, len = Math.hypot(L, dy);
      const p = new THREE.Mesh(box(len, 0.25, ROOF_W - 1.5), M.ramp);
      p.rotation.z = Math.atan2(dy, L); p.position.y = -0.12;
      const rails = new THREE.Mesh(mergeGeometries([box(len, 0.06, 0.06).translate(0, 0.9, ROOF_W / 2 - 0.8), box(len, 0.06, 0.06).translate(0, 0.9, -ROOF_W / 2 + 0.8)]), M.neon[0]);
      rails.rotation.z = p.rotation.z;
      g.add(p, rails);
      g.position.set((s.x0 + s.x1) / 2, (s.h0 + s.h1) / 2, 0);
    } else return null;
    return g;
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
    g.position.set(o.x, groundY, 0);
    return g;
  }
  const kill = m => { scene.remove(m); m.traverse(c => { if (c.isMesh) c.geometry.dispose(); }); };
  return {
    // 每帧：把关卡里新出现的物件建出来、没了的扔掉；天际线跟着人挪
    sync(level, px) {
      const want = new Set();
      for (const s of level.segs) { want.add(s); if (!live.has(s)) { const m = segMesh(s); live.set(s, m); if (m) scene.add(m); } }
      for (const o of level.obs) { want.add(o); if (!live.has(o)) { const m = obsMesh(o, level.ground(o.x) ?? 0); live.set(o, m); scene.add(m); } }
      for (const [k, m] of live) if (!want.has(k)) { if (m) kill(m); live.delete(k); }
      skyline.position.x = Math.floor(px / T) * T;
      moon.position.x = px + 300;
    },
    meshOf: k => live.get(k),
    clear() { for (const m of live.values()) if (m) kill(m); live.clear(); },
  };
}
