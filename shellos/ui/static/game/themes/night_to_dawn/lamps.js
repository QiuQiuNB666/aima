// 头灯光带：山坡上的 Z 字折返小路（Chaikin 圆角，拐弯圆顺）+ 一串串头灯光点沿小路慢慢往上爬。
//   光点 = 1 个 Points（1 次绘制，加色发光，不吃雾）；小路 = 1 条浅色碎石带（1 次绘制，天亮后看得出 Z 字）。
//   另有静态暖光点（山小屋窗、石灯笼），同一个着色器，天亮时一起变淡。
import * as THREE from 'three';

// 折线 → 圆角折线（Chaikin 切角，n 次）；首尾点保留
export function chaikin(pts, n = 4) {
  for (let k = 0; k < n; k++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(pts[pts.length - 1]); pts = out;
  }
  return pts;
}

// Z 字：u ∈ [u0, u1] 来回，v 从 v0 走到 v1，legs 条腿；整体绕中心转 rot（弧度，腿斜过镜头视线，屏幕上才看得出 Z）
// 返回 (u, v) 圆角折线（从 v0 端开始 = 爬坡起点）
export function zigzag(u0, u1, v0, v1, legs, rot = 0) {
  const P = [], cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, c = Math.cos(rot), s = Math.sin(rot);
  for (let k = 0; k <= legs; k++) {
    const u = (k % 2 ? u1 : u0) - cu, v = v0 + (v1 - v0) * k / legs - cv;
    P.push([cu + u * c - v * s, cv + u * s + v * c]);
  }
  return chaikin(P, 5);
}

// nf = 1 的光点走近化身 3–5.5 单位内渐隐（走在本路上的人给化身让路，不和化身/影子叠）
const VS = `attribute vec3 color; attribute float sz; attribute float nf; attribute float vis; uniform float op; uniform vec3 av; varying vec3 vC;
  void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(sz * 560. / -mv.z, 4., sz * 22.);
    vC = color * op * vis * mix(1., smoothstep(3., 5.5, distance(position, av)), nf); }`;
const FS = `varying vec3 vC; void main(){ float r = length(gl_PointCoord - 0.5) * 2.;
    float core = 1. - smoothstep(0.0, 0.32, r), glow = 1. - smoothstep(0.15, 1.0, r);
    gl_FragColor = vec4(vC * (core * 1.3 + glow * glow * 0.75), 1.0); }`;
const glowMat = U => new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });

// trails: [{ pts: [Vector3 …]（世界坐标，已贴地）, lift = 0.3（光点离地高）, fade = 0（1 = 靠近化身渐隐）, gap = 1（队间空当倍数） }]
// 返回 { mesh, uni, update(dt, avatar) }
export function headlamps(ctx, trails) {
  const R = ctx.rand, T = trails.map(({ pts, lift = 0.3, fade = 0, gap = 1 }) => {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    return { pts, cum, len: cum[cum.length - 1], lift, fade, gap };
  });
  const dots = [];                                   // 一队一队：队内间距 0.5–0.9，队间空 1.5–7
  const tints = ['#fff0c4', '#fff0c4', '#ffe2a0', '#e4eeff', '#ffd27a'];
  T.forEach((tr, ti) => {
    let u = R() * 3;
    while (u < tr.len) {
      const n = 2 + (R() * 9 | 0), sp = 0.16 + R() * 0.14;
      for (let k = 0; k < n && u < tr.len; k++) { dots.push({ ti, u, sp, c: R() < 0.1 ? '#ff5a40' : tints[(R() * tints.length) | 0], sz: 0.8 + R() * 0.45 }); u += 0.35 + R() * 0.35; }
      u += (1.0 + R() * 3.0) * tr.gap;
    }
  });
  const n = dots.length, pos = new Float32Array(n * 3), colA = new Float32Array(n * 3), szA = new Float32Array(n), nfA = new Float32Array(n);
  const U = { u: new Float32Array(n), seg: new Int32Array(n) }, c = new THREE.Color();
  dots.forEach((d, i) => { U.u[i] = d.u; c.set(d.c); colA.set([c.r, c.g, c.b], i * 3); szA[i] = d.sz; nfA[i] = T[d.ti].fade; });
  const g = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
  const visA = new Float32Array(n).fill(1), va = new THREE.BufferAttribute(visA, 1); va.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pa); g.setAttribute('color', new THREE.BufferAttribute(colA, 3)); g.setAttribute('sz', new THREE.BufferAttribute(szA, 1)); g.setAttribute('nf', new THREE.BufferAttribute(nfA, 1)); g.setAttribute('vis', va);
  const uni = { op: { value: 1 }, av: { value: new THREE.Vector3(0, -1e4, 0) } };
  const mesh = new THREE.Points(g, glowMat(uni)); mesh.name = 'headlamps'; mesh.frustumCulled = false;

  function place(dt) {
    for (let i = 0; i < n; i++) {
      const d = dots[i], tr = T[d.ti];
      let u = U.u[i] + d.sp * dt, k = U.seg[i];
      if (u >= tr.len) { u -= tr.len; k = 0; }
      while (k < tr.cum.length - 2 && tr.cum[k + 1] < u) k++;
      U.u[i] = u; U.seg[i] = k;
      const a = tr.pts[k], b = tr.pts[k + 1], f = (u - tr.cum[k]) / Math.max(1e-6, tr.cum[k + 1] - tr.cum[k]);
      pos[i * 3] = a.x + (b.x - a.x) * f; pos[i * 3 + 1] = a.y + (b.y - a.y) * f + tr.lift; pos[i * 3 + 2] = a.z + (b.z - a.z) * f;
    }
    pa.needsUpdate = true;
  }
  // 剪影剔除：从镜头穿过光点再往后 8 单位都碰不到地面 = 光点背后是天（悬在山脊剪影之上，像 UFO）→ 渐隐。
  //   只查镜头视平线以上的点（往下看的点背后一定是坡或云海）。k = 本帧渐变比例（预览 1 = 直接到位）
  const dv = new THREE.Vector3();
  function cull(cam, hAt, k) {
    const C = cam.position;
    for (let i = 0; i < n; i++) {
      dv.set(pos[i * 3] - C.x, pos[i * 3 + 1] - C.y, pos[i * 3 + 2] - C.z);
      const L = dv.length(); dv.divideScalar(L);
      let want = 1;
      if (dv.y > -0.06) {
        want = 0;
        for (let t = L + 0.6; t < L + 8; t += 0.8) if (hAt(C.x + dv.x * t, C.z + dv.z * t) >= C.y + dv.y * t) { want = 1; break; }
      }
      visA[i] += (want - visA[i]) * Math.min(1, k * 3);
    }
    va.needsUpdate = true;
  }
  place(0);
  return { mesh, uni, count: n, update: place, cull };
}

// 静态暖光点：items [{ p: Vector3, c, sz }]
export function glows(items) {
  const n = items.length, pos = new Float32Array(n * 3), colA = new Float32Array(n * 3), szA = new Float32Array(n), c = new THREE.Color();
  items.forEach((it, i) => { pos.set([it.p.x, it.p.y, it.p.z], i * 3); c.set(it.c || '#ffc46a'); colA.set([c.r, c.g, c.b], i * 3); szA[i] = it.sz || 2; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(colA, 3)); g.setAttribute('sz', new THREE.BufferAttribute(szA, 1));
  g.setAttribute('nf', new THREE.BufferAttribute(new Float32Array(n), 1)); g.setAttribute('vis', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
  const uni = { op: { value: 1 }, av: { value: new THREE.Vector3() } };
  const mesh = new THREE.Points(g, glowMat(uni)); mesh.name = 'glows';
  return { mesh, uni };
}

// 小路：沿 trail 的浅色碎石带（宽 w，贴地 + polygonOffset）
export function trailRibbon(trails, w, mat) {
  const pos = [], idx = [], L = new THREE.Vector3(), d = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  for (const pts of trails) {
    const b0 = pos.length / 3;
    pts.forEach((p, i) => {
      d.subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).setY(0).normalize();
      L.crossVectors(Y, d).multiplyScalar(w / 2);
      pos.push(p.x + L.x, p.y + 0.05, p.z + L.z, p.x - L.x, p.y + 0.05, p.z - L.z);
      if (i) { const b = b0 + (i - 1) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    });
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.name = 'trails';
  return m;
}
