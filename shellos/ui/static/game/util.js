// 主题用的引擎帮手（ctx.util）：Canvas 贴图 / 文字、文字招牌图集（多块招牌 1 次绘制）、InstancedMesh、合并几何、
// 沿路摆放、离路判断、地面取高、预算统计。接口说明见 docs/游戏主题接口.md。只用本地资源，不连外网。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { nearest, rng, ROAD_W, APRON, STEP } from './path.js';

export const FONT = '-apple-system,"PingFang SC","Hiragino Sans GB","Hiragino Kaku Gothic ProN","Noto Sans CJK SC",sans-serif';
const v3 = p => p == null ? new THREE.Vector3() : p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2]);
const s3 = s => s == null ? new THREE.Vector3(1, 1, 1) : typeof s === 'number' ? new THREE.Vector3(s, s, s) : v3(s);
const Y = new THREE.Vector3(0, 1, 0);
function matOf(it, m = new THREE.Matrix4()) {   // it = { p:[x,y,z]|Vector3, ry(弧度)|q(Quaternion), s:数|[x,y,z] }
  const q = it.q || new THREE.Quaternion().setFromAxisAngle(Y, it.ry || 0);
  return m.compose(v3(it.p), q, s3(it.s));
}

// 任意 Canvas 画的贴图：draw(g, w, h)。repeat=true 可平铺（设 t.repeat）
export function canvasTexture(w, h, draw, { repeat = false } = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// 文字画进一块 canvas：返回 {canvas, w, h}。o: size(px) weight font color bg border glow(0..1 霓虹光晕) pad(×size) vertical(竖排，日文招牌)
function drawText(text, o = {}) {
  const size = o.size || 96, pad = (o.pad ?? 0.3) * size, font = `${o.weight || 800} ${size}px ${o.font || FONT}`;
  const m = document.createElement('canvas').getContext('2d'); m.font = font;
  const lines = String(text).split('\n'), chars = [...String(text).replace(/\n/g, '')];
  const w = Math.ceil(o.vertical ? size * 1.15 + pad * 2 : Math.max(...lines.map(l => m.measureText(l).width)) + pad * 2);
  const h = Math.ceil(o.vertical ? chars.length * size * 1.08 + pad * 2 : lines.length * size * 1.2 + pad * 2);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, w, h); }
  if (o.border) { g.strokeStyle = o.border; g.lineWidth = size * 0.07; g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth); }
  g.font = font; g.fillStyle = o.color || '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (o.glow) { g.shadowColor = o.color || '#fff'; g.shadowBlur = size * 0.35 * o.glow; }
  const put = (s, x, y) => { g.fillText(s, x, y); if (o.glow) g.fillText(s, x, y); };   // 画两遍：光晕更亮
  if (o.vertical) chars.forEach((c, i) => put(c, w / 2, pad + size * 1.08 * (i + 0.5)));
  else lines.forEach((l, i) => put(l, w / 2, pad + size * 1.2 * (i + 0.5)));
  return { canvas: cv, w, h };
}

// 单块文字贴图：t.userData.aspect = 宽/高
export function textTexture(text, o = {}) {
  const { canvas, w, h } = drawText(text, o);
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.userData.aspect = w / h;
  return t;
}

// 单块文字板：高 height（世界单位），宽按比例。少量用；多块招牌用 textSigns（一次绘制）
export function textPlane(text, height = 1, o = {}) {
  const t = textTexture(text, o), a = t.userData.aspect;
  const mat = new THREE.MeshBasicMaterial({ map: t, transparent: !o.bg, depthWrite: !!o.bg, side: THREE.DoubleSide, fog: o.fog ?? true, toneMapped: false });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(height * a, height), mat); m.name = 'text';
  return m;
}

// 很多块文字招牌合成 1 张图集 + 1 个网格 = 1 次绘制。
// items: [{ text, p, ry, h(世界高度), ...drawText 的选项 }]；opt: { fog, size(图集字号缺省 96), width(图集宽，缺省 2048) }
// 返回 Mesh；mesh.userData.rects[i] = 第 i 块在图集里的 uv 矩形
export function textSigns(items, opt = {}) {
  const W = opt.width || 2048, gap = 4, cells = items.map(it => drawText(it.text, { size: opt.size || 96, ...it }));
  let x = 0, y = 0, rowH = 0; const at = [];
  for (const c of cells) {                       // 货架装箱：一行放不下就换行
    const cw = Math.min(c.w, W);
    if (x + cw > W) { x = 0; y += rowH + gap; rowH = 0; }
    at.push([x, y, cw, c.h]); x += cw + gap; rowH = Math.max(rowH, c.h);
  }
  const H = THREE.MathUtils.ceilPowerOfTwo(Math.max(1, y + rowH));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  cells.forEach((c, i) => g.drawImage(c.canvas, at[i][0], at[i][1], at[i][2], at[i][3]));
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const geos = [], rects = [], m4 = new THREE.Matrix4();
  items.forEach((it, i) => {
    const [ax, ay, aw, ah] = at[i], h = it.h || 1, gq = new THREE.PlaneGeometry(h * aw / ah, h);
    const u0 = ax / W, u1 = (ax + aw) / W, v0 = 1 - (ay + ah) / H, v1 = 1 - ay / H, uv = gq.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) ? u1 : u0, uv.getY(k) ? v1 : v0);
    gq.applyMatrix4(matOf(it, m4)); geos.push(gq); rects.push([u0, v0, u1, v1]);
  });
  const mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: opt.fog ?? true, toneMapped: false }));
  mesh.name = 'textSigns'; mesh.userData.rects = rects;
  return mesh;
}

// 同一几何 + 材质摆很多份 = 1 次绘制。items: [{ p, ry|q, s, color }]；带 color 就开 instanceColor
export function instanced(geo, mat, items) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length)), m4 = new THREE.Matrix4(), c = new THREE.Color();
  im.count = items.length;
  items.forEach((it, i) => { im.setMatrixAt(i, matOf(it, m4)); if (it.color != null) im.setColorAt(i, c.set(it.color)); });
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.computeBoundingSphere();                    // 视锥裁剪按全部实例的范围
  return im;
}

// 不同形状合成 1 个几何（配 vertexColors 材质 = 1 次绘制）。parts: [{ geo, p, ry|q, s, color }]
// 返回 BufferGeometry（非索引，含 position/normal/color，全部带 uv 时保留 uv）。
// 不给 color 且 geo 自带 color 属性 → 保留它的顶点色；都没有 → 白
export function merged(parts) {
  const m4 = new THREE.Matrix4(), c = new THREE.Color(), allUv = parts.every(pt => pt.geo.attributes.uv);
  const geos = parts.map(pt => {
    let g = pt.geo.index ? pt.geo.toNonIndexed() : pt.geo.clone();
    const own = pt.color == null && g.attributes.color && g.attributes.color.itemSize === 3;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', ...(own ? ['color'] : [])].includes(k) || (k === 'uv' && !allUv)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(matOf(pt, m4));
    if (own) return g;
    c.set(pt.color ?? '#ffffff'); const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  return mergeGeometries(geos);
}

// 沿路摆放点：每 every 步一个，side = 1 左 / -1 右 / 0 两侧，offset = 离路中心的横向距离。
// 返回 [{ p(Vector3，路面高度), ry(= -heading，直接给 rotation.y), heading, dir, left, s, i, kind, side }]
export function alongRoute(route, { every = 2, side = 0, offset = ROAD_W / 2 + 1, from = -APRON / STEP, to = route.N + APRON / STEP, jitter = 0, rand = rng(7) } = {}) {   // jitter 时建议传 rand: ctx.rand
  const out = [];
  for (let s = from; s <= to; s += every) for (const sg of side ? [side] : [1, -1]) {
    const ss = s + (jitter ? (rand() - 0.5) * jitter : 0), a = route.at(ss, sg * offset);
    out.push({ p: a.pos.clone(), ry: -a.heading, heading: a.heading, dir: a.dir.clone(), left: a.left.clone(), s: ss, i: a.i, kind: a.kind, side: sg });
  }
  return out;
}

// (x,z) 离路沿至少 margin 才返回 true —— 摆道具前过一下，别把东西放到路上挡化身
export function offRoad(route, x, z, margin = 0.3) { return nearest(route, x, z).d > ROAD_W / 2 + margin; }
// 最近路线点 {d, side, y, s}（同 path.nearest）
export function nearestRoute(route, x, z) { return nearest(route, x, z); }

// 地面取高：从上往下打射线到 mesh（kit.terrain 返回的地面）。没打中返回 fallback
const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), o3 = new THREE.Vector3();
export function groundAt(mesh, x, z, fallback = 0) {
  ray.set(o3.set(x, 1e3, z), down); const hit = ray.intersectObject(mesh, false)[0];
  return hit ? hit.point.y : fallback;
}

// 高度场快速取高：kit.terrain() 返回的地面（PlaneGeometry 网格，顶点已是世界坐标、mesh 没有变换）→ (x, z) => y，
//   按网格双线性插值，比 groundAt 的射线快两个数量级（撒几百棵树用这个）。读的是当前顶点，主题改过地面高度后再取也对；网格外取边缘
export function gridHeight(mesh) {
  const g = mesh.geometry, n = g.parameters.widthSegments, p = g.attributes.position;
  const x0 = p.getX(0), z0 = p.getZ(0), cell = (p.getX(n) - x0) / n;
  return (x, z) => {
    const fx = Math.max(0, Math.min(n - 1e-6, (x - x0) / cell)), fz = Math.max(0, Math.min(n - 1e-6, (z - z0) / cell));
    const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz, Y = (a, b) => p.getY(b * (n + 1) + a);
    return (Y(ix, iz) * (1 - u) + Y(ix + 1, iz) * u) * (1 - v) + (Y(ix, iz + 1) * (1 - u) + Y(ix + 1, iz + 1) * u) * v;
  };
}

// 预算：最近一帧的绘制次数 / 三角形（renderer.info，当前视角，视锥外的不算）
export function stats(renderer) { const r = renderer.info.render; return { calls: r.calls, triangles: r.triangles }; }
// 预算（与视角无关）：整个场景的三角形总数（实例 × 份数）和可见网格/线/点对象数（≈ 最坏绘制次数，多材质网格按组数算）
function instCount(g) {        // instanceCount 缺省 Infinity = 按实例属性的长度画（three 的规则）
  if (Number.isFinite(g.instanceCount)) return g.instanceCount;
  const ns = Object.values(g.attributes).filter(a => a.isInstancedBufferAttribute || a.isInstancedInterleavedBuffer).map(a => a.count * (a.meshPerAttribute || 1));
  return ns.length ? Math.min(...ns) : 1;
}
export function sceneStats(scene) {
  let triangles = 0, objects = 0;
  scene.traverseVisible(o => {
    if (!(o.isMesh || o.isLine || o.isPoints)) return;
    const g = o.geometry, n = g.index ? g.index.count : g.attributes.position ? g.attributes.position.count : 0;
    objects += Array.isArray(o.material) ? g.groups.length || 1 : 1;
    const copies = o.isInstancedMesh ? o.count : g.isInstancedBufferGeometry ? instCount(g) : 1;   // 普通 Mesh + 实例化几何（雨）也乘份数
    if (o.isMesh) triangles += Math.floor(n / 3) * copies;
  });
  return { objects, triangles };
}
