// 珠峰北坡的道具：经幡、帐篷、氧气瓶、冰塔林、冰塔（北坳冰壁）、岩石、固定绳 + 雪锥、铝梯（中国梯）、测量觇标、排队的人影、岩壁。
// 全部 instanced / merged：每类 1 次绘制。几何局部坐标：y 向上；沿路的东西按 route.at() 摆。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hsh = (x, y, z, s = 0) => { const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + s * 11.1) * 43758.5453; return v - Math.floor(v); };   // 按位置抖：重合顶点抖得一样，不裂缝
// 走到才露面：片元按屏幕噪声丢弃（uRev 0 → 1 = 看不见 → 全显），材质保持不透明，不和化身 / 影子抢排序
const DITHER = 'uniform float uRev;\nvoid dither(){ if (uRev < 0.999 && fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453) >= uRev) discard; }\n';
export function revealable(mat, rev) {
  mat.onBeforeCompile = sh => { sh.uniforms.uRev = rev; sh.fragmentShader = DITHER + sh.fragmentShader.replace('void main() {', 'void main() {\n  dither();'); };
  mat.customProgramCacheKey = () => 'snowRev';
  return mat;
}
export const FLAG_COLS = ['#2f6fd6', '#f4f4f0', '#d7342b', '#2f9c55', '#f2c230'];   // 蓝白红绿黄

// 细长件：a→b，单位几何沿 x
function seg(a, b, out, extra = {}) {
  const v = new THREE.Vector3().subVectors(b, a), len = v.length();
  out.push({ p: a.clone().lerp(b, 0.5), q: new THREE.Quaternion().setFromUnitVectors(X, v.normalize()), s: [len, 1, 1], ...extra });
}
// 下垂的绳：a→b 分 n 段，中点下垂 sag
function sagPts(a, b, sag, n) { const out = []; for (let k = 0; k <= n; k++) { const f = k / n; out.push(a.clone().lerp(b, f).addScaledVector(Y, -sag * 4 * f * (1 - f))); } return out; }

// 经幡：lines = [{ a, b, sag }]；每条绳上一串小方旗（蓝白红绿黄循环），旗面在顶点着色器里按实例号飘。返回 { meshes, U }
export function prayerFlags(ctx, lines, { spacing = 0.26, cap = 600, rev = null } = {}) {
  const { util } = ctx, flags = [], cords = [];
  for (const L of lines) {
    const n = Math.max(2, Math.round(L.a.distanceTo(L.b) / spacing)), pts = sagPts(L.a, L.b, L.sag ?? 0.4, n);
    for (let k = 0; k < n; k++) {
      seg(pts[k], pts[k + 1], cords);
      if (flags.length >= cap) continue;
      const m = pts[k].clone().lerp(pts[k + 1], 0.5), d = pts[k + 1].clone().sub(pts[k]).setY(0);
      flags.push({ p: m, ry: Math.atan2(-d.z, d.x), s: [1, 0.9 + 0.2 * ctx.rand(), 1], color: FLAG_COLS[(k + (L.shift || 0)) % 5] });
    }
  }
  const U = { uT: { value: 0 }, uWind: { value: 1 }, uGust: { value: new THREE.Vector4(0, -1e4, 0, 0) } };   // uGust：xyz 化身、w 一阵猛风（化身走过，近处的旗被抽得乱飞）
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide, emissive: '#303030' });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'uniform float uT, uWind; uniform vec4 uGust;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
       { float hang = -transformed.y / 0.2; float ph = float(gl_InstanceID) * 1.37, wA = min(uWind, 2.2), stream = clamp(uWind - 1.2, 0.0, 1.6);   // 风大了旗被扯平（往下风飘起来）
         transformed.z += (sin(uT * 7.0 + ph) * 0.05 + 0.03) * hang * wA + 0.1 * stream * hang; transformed.x += sin(uT * 5.3 + ph * 0.7) * 0.02 * hang * wA; transformed.y += 0.05 * stream * hang;
         vec3 ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
         float g = uGust.w * smoothstep(4.0, 1.0, distance(ip.xz, uGust.xz));
         transformed.z += g * (sin(uT * 23.0 + ph) * 0.1 + 0.14) * hang; transformed.x += g * sin(uT * 17.0 + ph * 1.3) * 0.08 * hang; transformed.y += g * (0.1 + 0.04 * sin(uT * 19.0 + ph)) * hang; }`);   // 被风掀起来：往外、往上飞
    if (rev) { sh.uniforms.uRev = rev; sh.fragmentShader = DITHER + sh.fragmentShader.replace('void main() {', 'void main() {\n  dither();'); }
  };
  mat.customProgramCacheKey = () => rev ? 'snowFlagsRev' : 'snowFlags';
  const flagGeo = new THREE.PlaneGeometry(0.2, 0.2).translate(0, -0.11, 0);
  const cordGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 3).rotateZ(Math.PI / 2);
  const cordMat = new THREE.MeshLambertMaterial({ color: '#d9d2c2' });
  const meshes = [util.instanced(flagGeo, mat, flags), util.instanced(cordGeo, rev ? revealable(cordMat, rev) : cordMat, cords)];
  meshes.forEach(m => { m.name = 'prayerFlags'; });
  return { meshes, U, count: flags.length };
}

// 氧气瓶：橙色瓶身 + 灰色瓶阀
export function bottleGeo(util) {
  return util.merged([
    { geo: new THREE.CylinderGeometry(0.075, 0.075, 0.5, 10), p: [0, 0.25, 0], color: '#f07a1a' },
    { geo: new THREE.SphereGeometry(0.075, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), p: [0, 0.5, 0], color: '#f07a1a' },
    { geo: new THREE.CylinderGeometry(0.03, 0.03, 0.08, 6), p: [0, 0.6, 0], color: '#8a8f96' },
    { geo: new THREE.CylinderGeometry(0.076, 0.076, 0.05, 10), p: [0, 0.34, 0], color: '#2a2a2a' },
  ]);
}

// 冰塔：扭一点的六棱锥，底部冰蓝、顶上雪白；jag = 顶上歪几刀
export function spireGeo(seed) {
  // 东绒布冰塔林：一簇三根尖冰塔（主塔 + 两根矮的，五棱锥拉成鳍状、各自歪一点、棱线抖开），竖向一道道冰纹，底下一圈脏冰（碛石屑），尖上发白
  const G = [], lo = new THREE.Color('#79aed4'), mid = new THREE.Color('#cfe6f5'), hi = new THREE.Color('#fbfdff'), dirt = new THREE.Color('#8b8a84'), c = new THREE.Color();
  for (const [x, z, h, r, tilt, k] of [[0, 0, 1, 0.5, 0.08, 1], [0.3, 0.14, 0.64, 0.34, 0.3, 2], [-0.28, -0.12, 0.5, 0.3, -0.34, 3]]) {
    const g = new THREE.ConeGeometry(r, h, 5, 4).translate(0, h / 2, 0).toNonIndexed(), p = g.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), py = p.getY(i), pz = p.getZ(i), j = 0.75 + 0.5 * hsh(px, py, pz, seed + k);
      p.setXYZ(i, px * j * 1.45 + tilt * py * py + x, py, pz * (0.62 + 0.3 * hsh(pz, px, py, seed + k)) + z);
    }
    for (let i = 0; i < p.count; i += 3) {                                             // 一面一个色：竖纹（按朝向）× 高度渐变；底一圈脏
      const ym = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3 / h, az = Math.atan2(p.getZ(i) - z, p.getX(i) - x);
      c.copy(lo).lerp(mid, smooth(0.05, 0.5, ym)).lerp(hi, smooth(0.6, 0.95, ym)).multiplyScalar(0.9 + 0.14 * Math.sin(az * 7 + k));
      if (ym < 0.08) c.lerp(dirt, 0.7);
      for (let q = 0; q < 3; q++) col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); G.push(g);
  }
  return mergeGeometries(G);
}

// 冰裂缝：冰川雪面上一道横着的缝（两头尖、中间宽、轻微弯），缝里深蓝近黑、缝沿浅蓝；平躺，实例缩放给长 / 宽
export function crevasseGeo() {
  const g = new THREE.PlaneGeometry(1, 1, 10, 4).rotateX(-Math.PI / 2), p = g.attributes.position, col = [], edge = new THREE.Color('#d6ecf8'), midC = new THREE.Color('#3d6f95'), deep = new THREE.Color('#0b2238'), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), taper = Math.sin(Math.PI * (x + 0.5)) ** 0.7;
    p.setZ(i, z * taper + 0.12 * Math.sin(x * 5.5));
    c.copy(Math.abs(z) > 0.4 ? edge : Math.abs(z) > 0.1 ? midC : deep); col.push(c.r, c.g, c.b);   // 缝沿浅 → 缝壁蓝 → 缝底黑
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  return g;
}

// 冰面光泽：太阳方向一点镜面反光 + 边缘一圈冷色（湿冰那种亮），不是金属材质；mask = 'all' 全上，'blue' 只给偏蓝的（冰台阶，岩台阶不要）
export function iceSheen(mat, amount = 1, mask = 'all') {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = sh => {
    if (prev) prev(sh);
    const m = mask === 'blue' ? 'smoothstep(0.8, 0.95, vColor.b) * smoothstep(0.0, 0.05, vColor.b - vColor.r + 0.02)' : '1.0';
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `#if NUM_DIR_LIGHTS > 0
      { vec3 Vd = normalize(vViewPosition), Hh = normalize(directionalLights[0].direction + Vd);
        float im = ${m} * ${amount.toFixed(2)};
        outgoingLight += im * (pow(max(dot(normal, Hh), 0.0), 36.0) * 0.55 * directionalLights[0].color + pow(1.0 - max(dot(normal, Vd), 0.0), 3.0) * 0.22 * vec3(0.8, 0.9, 1.0)); }
      #endif
      #include <opaque_fragment>`);
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.customProgramCacheKey = () => key + 'ice' + mask;
  return mat;
}

// 冰塔（北坳冰壁旁的冰崖块）：和岩块同一个多面体生成器，冰蓝侧面 + 雪白顶面
export const seracGeo = seed => rockGeo('#a9d0ea', seed, 1.35);

// 固定绳：沿路 lat 处，每 every 步一根雪锥（铝杆）+ 绳子下垂；绳子颜色按段交替（红 / 蓝，常见的登山绳）
// 路绳随风晃：sway = { uT, uWind（0–3）, uWD（下风方向）}；每段绳在两根雪锥之间按跨中最大往下风荡、上下轻弹（雪锥不动）
// ranges = [[s0, s1, { lat, h }?], …]：每段可以单独给横向位置 / 高度（刀脊上绳子贴着脊、横切时拉在岩壁那侧）
export function fixedRope(ctx, ranges, { lat: lat0 = 1.0, every = 2, h: h0 = 0.85, sway = null } = {}) {
  const { route, util } = ctx, stakes = [], rope = [];
  for (const [s0, s1, o = {}] of ranges) {
    let prev = null, k = 0;
    const lat = o.lat ?? lat0, h = o.h ?? h0;
    for (let s = s0; s <= s1 + 1e-6; s += every) {
      const a = route.at(s, lat), top = a.pos.clone().setY(route.heightAt(s) + h);
      stakes.push({ p: a.pos.clone().setY(route.heightAt(s) + h / 2 - 0.1), ry: -a.heading, s: [1, (h + 0.2) / (h0 + 0.2), 1] });
      if (prev) { const pts = sagPts(prev, top, 0.12, 6); const col = (k++ % 3) ? '#d7342b' : '#2f6fd6'; for (let j = 0; j < 6; j++) seg(pts[j], pts[j + 1], rope, { color: col, f: (j + 0.5) / 6 }); }
      prev = top;
    }
  }
  const rm = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#1a1a1a' });
  if (sway) {
    rm.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, sway);
      sh.vertexShader = 'attribute float aSpan; uniform float uT, uWind; uniform vec3 uWD;\n' + sh.vertexShader.replace('#include <project_vertex>', `
        vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
        float sp = sin(3.14159 * aSpan), ph = uT * (1.6 + 0.5 * uWind) + wp.x * 0.7 + wp.z * 0.5;
        wp.xyz += uWD * sp * (0.03 + 0.05 * uWind) * (0.65 + 0.35 * sin(ph));
        wp.y += sp * 0.02 * uWind * cos(ph * 1.7);
        vec4 mvPosition = viewMatrix * wp; gl_Position = projectionMatrix * mvPosition;`);
    };
    rm.customProgramCacheKey = () => 'ropeSway';
  }
  const rp = util.instanced(new THREE.CylinderGeometry(0.018, 0.018, 1, 4).rotateZ(Math.PI / 2), rm, rope);
  if (sway) rp.geometry.setAttribute('aSpan', new THREE.InstancedBufferAttribute(Float32Array.from({ length: Math.max(1, rope.length) }, (_, i) => rope[i] ? rope[i].f : 0), 1));
  const out = [util.instanced(new THREE.BoxGeometry(0.035, h0 + 0.2, 0.035), new THREE.MeshLambertMaterial({ color: '#c8ced6', emissive: '#222831' }), stakes), rp];
  out.forEach(m => { m.name = 'fixedRope'; });
  return out;
}


// 铝梯（中国梯）：铺在台阶段上、化身脚下（lat）。边梁顺着台阶前沿连线（每级前沿正好压一根横档，中间再加一根），
//   顶端边梁往上翘出 0.9（真梯子顶上要伸出落脚处，好抓），梯脚压进雪里。返回 merged() 用的 parts
export function ladderParts(ctx, sg, { lat = 0.35, width = 0.6 } = {}) {
  const { route } = ctx, P = [], i0 = sg.start, n = sg.steps, h0 = route.steps[i0].h0, rise = route.steps[i0].h1 - h0;
  const y = s => h0 + rise * (s - i0) + rise + 0.03;                        // s 处横档高度：压在台阶前沿上
  const at = (s, sd) => { const a = route.at(s, lat); return a.pos.clone().addScaledVector(a.left, sd * width / 2).setY(y(s)); };
  const sA = i0 - 0.35, sB = i0 + n;
  for (const sd of [1, -1]) {
    const a = at(sA, sd), b = at(sB, sd), d = b.clone().sub(a).normalize();
    P.push(bar(a, b, 0.055, false));
    const c = b.clone().addScaledVector(d, 0.08).setY(b.y + 0.4);           // 顶端翘出
    P.push(bar(b, c, 0.055, false));
  }
  for (let k = 0; k <= n * 2; k++) { const s = i0 + k / 2; P.push(bar(at(s, 1), at(s, -1), 0.034, true)); }
  for (let k = 1; k <= 1; k++) {                                           // 翘出段的横档
    const f = 0.8, l = at(sB, 1), r = at(sB, -1), d = at(sB, 1).sub(at(sA, 1)).normalize();
    for (const q of [l, r]) q.addScaledVector(d, 0.08 * f).setY(q.y + 0.4 * f);
    P.push(bar(l, r, 0.034, true));
  }
  return P;
}
function bar(a, b, t, round) {
  const v = b.clone().sub(a), len = v.length();
  const geo = round ? new THREE.CylinderGeometry(t / 2, t / 2, 1, 6).rotateZ(Math.PI / 2) : new THREE.BoxGeometry(1, t * 1.7, t);
  return { geo, p: a.clone().lerp(b, 0.5).toArray(), q: new THREE.Quaternion().setFromUnitVectors(X, v.normalize()), s: [len, 1, 1], color: '#e4eaf1' };
}

// 测量觇标：红色三脚架 + 中间立杆 + 顶上红白觇牌 + 天线盘；脚下一圈经幡另给。高约 2.3（≈ 2.8 m）
export function beaconParts() {
  const P = [], RED = '#d8261f', WHITE = '#f4f4f0', H = 2.3;
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * Math.PI * 2 + 0.3, foot = new THREE.Vector3(Math.cos(a) * 0.62, -0.05, Math.sin(a) * 0.62), top = new THREE.Vector3(0, H * 0.72, 0);
    P.push(bar2(foot, top, 0.07, RED));
    P.push({ geo: new THREE.CylinderGeometry(0.02, 0.02, 1, 5), p: foot.clone().lerp(top, 0.35).toArray(), s: [1, 0.01, 1], color: RED });
  }
  P.push({ geo: new THREE.CylinderGeometry(0.045, 0.05, H, 8), p: [0, H / 2, 0], color: RED });
  for (let k = 0; k < 4; k++) P.push({ geo: new THREE.CylinderGeometry(0.052, 0.052, 0.12, 8), p: [0, H * 0.35 + k * 0.28, 0], color: WHITE });   // 立杆红白环
  P.push({ geo: new THREE.BoxGeometry(0.46, 0.3, 0.04), p: [0, H - 0.22, 0], color: RED });                    // 觇牌
  P.push({ geo: new THREE.BoxGeometry(0.2, 0.3, 0.045), p: [0, H - 0.22, 0], color: WHITE });
  P.push({ geo: new THREE.CylinderGeometry(0.14, 0.14, 0.05, 14), p: [0, H + 0.04, 0], color: WHITE });          // 天线盘
  P.push({ geo: new THREE.SphereGeometry(0.06, 8, 5), p: [0, H + 0.1, 0], color: '#333333' });
  return P;
}
function bar2(a, b, t, color) {
  const v = b.clone().sub(a), len = v.length();
  return { geo: new THREE.CylinderGeometry(t / 2, t / 2, 1, 6), p: a.clone().lerp(b, 0.5).toArray(), q: new THREE.Quaternion().setFromUnitVectors(Y, v.normalize()), s: [1, len, 1], color };
}

// 排队的人影：羽绒服（instanceColor 上色）+ 深色件（背包、氧气面罩、腿、冰镐）两个网格同一套矩阵。身高约 1.4，微微前倾

// 岩块（第一 / 第二台阶两侧、山脊上的岩头）：平直着色的多面体，朝上的面积雪（顶点色），侧面 = base 岩色；instanceColor 只给明暗
export function rockGeo(base, seed, tall = 1) {
  const g = new THREE.DodecahedronGeometry(1, 1).toNonIndexed(), p = g.attributes.position, col = [], c = new THREE.Color(), rc = new THREE.Color(base), sn = new THREE.Color('#f3f7fb');
  for (let i = 0; i < p.count; i++) {                                          // 按位置抖：棱角分明的石头（tall > 1 = 竖着拉长、顶上削平一点，像冰塔）
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.78 + 0.4 * hsh(Math.round(x * 50), Math.round(y * 50), Math.round(z * 50), seed);
    p.setXYZ(i, x * k, Math.min(y * k * tall, 0.85 * tall), z * k);
  }
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i += 3) {                                       // 每个三角形一个颜色（平直）
    const ny = (n.getY(i) + n.getY(i + 1) + n.getY(i + 2)) / 3, cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    c.copy(rc).multiplyScalar(0.8 + 0.35 * hsh(i, cy, 3, seed));
    if (ny > 0.55 && cy > -0.2) c.lerp(sn, smooth(0.55, 0.8, ny));
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// 觇标上的红旗：卷着（贴着立杆一条红）→ 登顶那一下展开、被风吹得一浪一浪。setUnfurl(0..1)、update(t)
export function beaconFlag() {
  const U = { uU: { value: 0 }, uT: { value: 0 } };
  const mat = new THREE.MeshLambertMaterial({ color: '#d8261f', emissive: '#3a0604', side: THREE.DoubleSide });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'uniform float uU, uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      { float xf = transformed.x / 0.78;
        transformed.x *= mix(0.07, 1.0, uU);
        transformed.z += (sin(xf * 8.0 - uT * 9.0) * 0.08 + 0.03) * xf * uU;
        transformed.y += sin(xf * 5.0 - uT * 7.0) * 0.025 * xf * uU - 0.05 * xf * xf * uU; }`);
  };
  mat.customProgramCacheKey = () => 'beaconFlag';
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.44, 16, 4).translate(0.39, 0, 0), mat);
  m.name = 'beaconFlag';
  return { mesh: m, set(u, t) { U.uU.value = u; U.uT.value = t % 1000; } };
}

// 登顶的「风吹雪烟」（评审 r1 #8：替掉满天彩纸；考据 §7「风吹雪烟」）：顶峰雪脊上被西风一缕缕扯出去的雪烟。
//   一个 Points（1 次绘制），位置全在着色器里按时间算（出生点沿雪脊 ±1.8、顺风飘、往上翻、边飘边散开变淡），CPU 只改几个 uniform。
//   start(origin, crestDir, windDir) 开始；update(t, k, camera, viewH)：k = 0..1 整体浓淡（登顶淡入 / 收起淡出）
export function spindrift(scene, { n = 150 } = {}) {
  const pos = new Float32Array(n * 3), seed = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { const h = k => hsh(i, k, i * 0.37, 5); seed.set([h(1) * 2 - 1, h(2) * 3.5, 1.1 + h(3) * 1.6, 0.8 + h(4) * 0.9], i * 4); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aS', new THREE.BufferAttribute(seed, 4));
  const U = { uT: { value: 0 }, uK: { value: 0 }, uO: { value: new THREE.Vector3() }, uC: { value: new THREE.Vector3(1, 0, 0) }, uW: { value: new THREE.Vector3(0, 0, 1) }, uScale: { value: 600 } };
  const m = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, fog: false,
    vertexShader: `attribute vec4 aS; uniform float uT, uK, uScale; uniform vec3 uO, uC, uW; varying float vA;
      void main(){
        float life = 2.4 + aS.w, age = mod(uT + aS.y, life), u = age / life;               // 一缕接一缕：循环出生
        vec3 side = normalize(cross(uW, vec3(0.0, 1.0, 0.0)));
        vec3 p = uO + uC * (aS.x * 1.8) + uW * (aS.z * age) + vec3(0.0, 0.18 + 0.45 * age - 0.05 * age * age, 0.0) + side * sin(age * 2.6 + aS.x * 6.0) * 0.12 * age;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        vA = uK * smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.45, 1.0, u)) * 0.5;
        gl_PointSize = (0.25 + 0.9 * u) * aS.w * uScale / max(0.3, -mv.z);
      }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = vA * smoothstep(0.5, 0.08, d); if (a < 0.01) discard; gl_FragColor = vec4(0.95, 0.97, 1.0, a);
      #include <colorspace_fragment>
      }`,
  }));
  m.name = 'spindrift'; m.frustumCulled = false; m.renderOrder = 4; scene.add(m);
  return {
    mesh: m,
    start(origin, crest, wind) { U.uO.value.copy(origin); U.uC.value.copy(crest).setY(0).normalize(); U.uW.value.copy(wind).setY(0).normalize(); },
    update(t, k, camera, viewH) {
      U.uT.value = t % 1000; U.uK.value = k;
      if (camera) U.uScale.value = viewH / (2 * Math.tan(camera.fov * Math.PI / 360));
    },
  };
}
