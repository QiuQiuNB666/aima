// 主题公用小工具：天空渐变穹顶、雾、沿路线的高度场地面、远山剪影、噪声、网格贴图。
// 主题插件（themes/<style>.js）约定：export function build(scene, ctx)；export function update(dt, st)
//   ctx = { THREE, world, theme, route, meshes(路面/台阶/信号灯/营地/旗), lights{hemi,sun}, camera, renderer, kit, preview, rand }
//   st  = { t, dt, s(化身连续步数), progress(0..1), pos, total, avatar(Vector3), terrain(/state.terrain), pulse(本帧是否脉冲), summit(bool) }
import * as THREE from 'three';
import { nearest, ROAD_W } from '../path.js';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

export function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 天空：竖直渐变穹顶（不受雾影响）。返回 {mesh, set(top, bottom)}，night_to_dawn 之类可以每帧改色
export function sky(scene, top, bottom, { radius = 450, exponent = 0.8 } = {}) {
  const u = { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) }, ex: { value: exponent } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; uniform float ex; varying vec3 vP; void main(){ float h = pow(clamp(vP.y*1.15+0.05,0.0,1.0), ex); gl_FragColor = vec4(mix(bottom, top, h),1.0);\n#include <colorspace_fragment>\n}',
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  mesh.name = 'sky'; mesh.renderOrder = -10; scene.add(mesh);
  return { mesh, uniforms: u, set(t, b) { u.top.value.set(t); u.bottom.value.set(b); } };
}

export function fog(scene, color, near = 12, far = 90) { scene.fog = new THREE.Fog(color, near, far); return scene.fog; }

// 沿路线的高度场：路面下方贴着路，离路越远越按 amp 抬高（左侧）/ 降低（右侧，给远景留视野）
// opts: color, size, seg, amp, drop(右侧下降比例), rough, flatTo(远处回到这个高度；网格训练场用), map, uvScale
export function terrain(ctx, o = {}) {
  const { route } = ctx;
  const size = o.size || 170, seg = o.seg || 150, amp = o.amp ?? 5, drop = o.drop ?? 0.6, rough = o.rough ?? 1.0, seed = o.seed || 0;
  const c = routeCenter(route);
  const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), base = new THREE.Color(o.color || ctx.theme.ground || '#445');
  const uv = g.attributes.uv, us = o.uvScale || 1;
  // 路沿外至少空出一整格网格再抬高，否则三角形插值会在转弯内侧把地面顶出路面；贴路一格内的顶点压到路面下
  const cell = size / seg, under = ROAD_W / 2 + cell, inner = under + 0.3;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + c.x, z = p.getZ(i) + c.z, n = nearest(route, x, z);
    let y = n.y - (n.d < under ? 0.08 : 0.06);
    if (n.d > inner) {
      const t = smooth(inner, inner + (o.reach || 14), n.d), nz = fbm(x * 0.07 + seed, z * 0.07 - seed);
      if (o.flatTo !== undefined) y = y + (o.flatTo - y) * t - 0.02;
      else y += (n.side > 0 ? amp : -amp * drop) * t * (0.55 + 0.9 * nz) + rough * (nz - 0.5) * t * 2;
    }
    p.setXYZ(i, x, y, z);
    uv.setXY(i, x / us, z / us);
    const k = 0.82 + 0.3 * noise2(x * 0.35, z * 0.35);
    col[i * 3] = base.r * k; col[i * 3 + 1] = base.g * k; col[i * 3 + 2] = base.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: o.map || null });
  const mesh = new THREE.Mesh(g, mat); mesh.name = 'ground';
  ctx.scene.add(mesh);
  return mesh;
}

// 远山/远城剪影：一圈锯齿带，不吃雾，颜色自己给（一般取雾色和天空底色之间）
export function ridge(ctx, { color, radius = 140, height = 22, base = -30, jag = 0.6, seg = 256, seed = 1, y0 } = {}) {
  const c = routeCenter(ctx.route), pos = [], idx = [];
  const yb = (y0 ?? 0);
  for (let k = 0; k <= seg; k++) {
    const a = k / seg * Math.PI * 2, x = c.x + Math.cos(a) * radius, z = c.z + Math.sin(a) * radius;
    const h = yb + height * (0.35 + 0.65 * fbm(k * 0.045 * (1 + jag) + seed, seed * 3.1, 5));
    pos.push(x, base, z, x, h, z);
    if (k < seg) { const b = k * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, fog: false, side: THREE.DoubleSide }));
  m.name = 'ridge'; m.renderOrder = -5; ctx.scene.add(m);
  return m;
}

// 网格贴图（训练场）：1 个 uv 单位一格
export function gridTexture(line = '#3a4653', bg = '#1c232d', px = 128, w = 3) {
  const cv = document.createElement('canvas'); cv.width = cv.height = px;
  const g = cv.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, px, px);
  g.fillStyle = line; g.fillRect(0, 0, px, w); g.fillRect(0, 0, w, px);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// 双面字牌：正反两面都是正字（textPlane 是 DoubleSide，从背后看是镜像字 —— 正面镜头 cam=front 回看来路时全是反字）。1 次绘制
export function sign2(util, text, height, o = {}) {
  const m = util.textPlane(text, height, o), back = m.geometry.clone().rotateY(Math.PI);
  m.geometry = mergeGeometries([m.geometry, back]); m.material.side = THREE.FrontSide;
  return m;
}

// 双面招牌图集：textSigns 的每块再加一块转 180° 的背面，材质改单面 —— 两面都是正字，仍是 1 次绘制
export function signs2(util, items, opt) {
  const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const m = util.textSigns(items.flatMap(it => [it, it.q ? { ...it, q: it.q.clone().multiply(flip) } : { ...it, ry: (it.ry || 0) + Math.PI }]), opt);
  m.material.side = THREE.FrontSide;
  return m;
}

// ?fx=low：展位降级。主题少摆远处/重复的东西（雨、远楼、草、星星），光影降级归 lighting.js
export const LOW = new URLSearchParams(location.search).get('fx') === 'low';

export function routeCenter(route) {
  const a = route.P[0], b = route.P[route.N] || a;
  return new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
}

export function mixHex(a, b, t) { return new THREE.Color(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, t))); }
