// 排队的登山者（第二台阶）：鼓鼓的连体羽绒服（一道道充绒格）、安全带、冰爪靴；帽兜 + 毛领、雪镜、氧气面罩 + 管子通到背包、
//   小背包（橙色氧气瓶头露出包顶）。整队一个 InstancedMesh = 1 次绘制；腿 / 胳膊 / 头在顶点着色器里按实例属性动：
//   aAnim = (相位, 走, 搓手, 抬头)：走起来腿和胳膊交替摆；站着等的时候跺脚（左右脚轮流抬）、搓手（两手收到胸前来回搓）、抬头看梯子。
//   羽绒服 / 背包颜色是实例属性（aSuit / aPack）。LOD 三级：0 ≈ 700 / 1 ≈ 300 / 2 ≈ 120 三角形 / 人（climberGeo(lod)）。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { colored, tube, at } from './geo.js';

const V = (...a) => new THREE.Vector3(...a);
// part：0 身子 / 1 左腿 / 2 右腿 / 3 左臂 / 4 右臂 / 5 头；mask：0 固定色、1 × aSuit、2 × aPack
function mark(g, part, mask) {
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  g.setAttribute('aMask', new THREE.BufferAttribute(new Float32Array(n).fill(mask), 1));
  return g;
}
// 充绒格：按高度一道亮一道暗
function baffles(g, step, lo = 0.8) {
  g = g.index ? g.toNonIndexed() : g; const p = g.attributes.position, c = [];
  for (let i = 0; i < p.count; i++) { const v = Math.floor(p.getY(i) / step + 100) % 2 ? lo : 1; c.push(v, v, v); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); g.computeVertexNormals(); return g;
}

export function climberGeo(lod = 0) {
  const G = [], add = (g, part = 0, mask = 0) => G.push(mark(g, part, mask)), L1 = lod >= 1, L2 = lod >= 2, rs = n => L2 ? Math.max(4, n >> 1) : L1 ? Math.max(4, Math.round(n * 0.7)) : n;
  // 腿（连体羽绒服下半，比上身暗一点）+ 靴 + 冰爪
  for (const [k, z] of [[1, 0.11], [2, -0.11]]) {
    add(baffles(new THREE.CylinderGeometry(0.095, 0.078, 0.8, rs(8), L2 ? 1 : 4).translate(0, 0.52, z), 0.1, 0.78), k, 1);
    add(at(new THREE.BoxGeometry(0.28, 0.13, 0.13), 0.04, 0.075, z, '#1b1d22'), k, 0);
    if (!L1) add(at(new THREE.BoxGeometry(0.29, 0.02, 0.12), 0.04, 0.005, z, '#8a8f96'), k, 0);
  }
  // 身子：鼓鼓的羽绒服（充绒格）、安全带 + 锁扣
  add(baffles(new THREE.CapsuleGeometry(0.205, 0.42, L2 ? 2 : 4, rs(12)).scale(1, 1, 0.86).translate(0, 1.2, 0), 0.1), 0, 1);
  if (!L2) add(at(new THREE.CylinderGeometry(0.2, 0.2, 0.05, rs(12), 1, true).scale(1, 1, 0.86), 0, 0.95, 0, '#2b2b2b'), 0, 0);
  if (!L1) add(at(new THREE.TorusGeometry(0.03, 0.009, 4, 8), 0.19, 0.93, 0, '#c9ccd2'), 0, 0);
  // 胳膊（肩 → 手套）
  for (const [k, sd] of [[3, 1], [4, -1]]) {
    add(baffles(new THREE.CapsuleGeometry(0.07, 0.36, L2 ? 1 : 2, rs(7)).translate(0.04, 1.18, sd * 0.27), 0.09, 0.84), k, 1);
    add(at(new THREE.SphereGeometry(0.068, rs(8), L2 ? 3 : 6).scale(1.1, 1, 0.9), 0.08, 0.95, sd * 0.27, '#15171a'), k, 0);
  }
  // 头：帽兜（羽绒服色）+ 毛领、雪镜（橙色镜片 + 黑带）、氧气面罩 + 调节阀、管子
  add(at(new THREE.SphereGeometry(0.15, rs(12), L2 ? 4 : 8), 0.0, 1.63, 0, '#c8c8c8'), 5, 1);
  if (!L2) add(at(new THREE.TorusGeometry(0.11, 0.035, L1 ? 3 : 5, rs(12)).rotateY(Math.PI / 2), 0.1, 1.62, 0, '#d8d0c0'), 5, 0);
  add(at(new THREE.BoxGeometry(0.045, 0.065, 0.2), 0.145, 1.67, 0, '#e08a2a'), 5, 0);
  add(at(new THREE.BoxGeometry(0.03, 0.03, 0.29), 0.1, 1.67, 0, '#1b1d22'), 5, 0);
  add(at(new THREE.BoxGeometry(0.09, 0.1, 0.11), 0.165, 1.565, 0, '#2a2c30'), 5, 0);
  if (!L1) add(at(new THREE.CylinderGeometry(0.025, 0.025, 0.05, 6).rotateZ(Math.PI / 2), 0.22, 1.55, 0, '#9a9a9a'), 5, 0);
  if (!L1) { add(tube(V(0.17, 1.52, -0.03), V(0.02, 1.4, -0.2), 0.016, '#3a3c40', 5), 5, 0); add(tube(V(0.02, 1.4, -0.2), V(-0.24, 1.44, -0.14), 0.016, '#3a3c40', 5), 5, 0); }
  // 背包（白底 × aPack）+ 顶盖、防潮垫卷、橙色氧气瓶 + 阀
  add(at(new THREE.BoxGeometry(0.2, 0.34, 0.26), -0.25, 1.22, 0, '#f0f0f0'), 0, 2);                        // 小背包（评审 r1 #2：20–30 L）
  if (!L2) add(at(new THREE.BoxGeometry(0.21, 0.07, 0.27), -0.25, 1.4, 0, '#a0a0a0'), 0, 2);
  add(at(new THREE.CylinderGeometry(0.058, 0.058, 0.42, rs(8)), -0.28, 1.36, -0.08, '#e8781c'), 0, 0);     // 橙色氧气瓶，瓶头露出包顶
  if (!L1) add(at(new THREE.CylinderGeometry(0.028, 0.028, 0.06, 6), -0.28, 1.6, -0.08, '#9a9a9a'), 0, 0);
  return mergeGeometries(G);
}

const DECL = `attribute float aPart; attribute float aMask; attribute vec3 aSuit; attribute vec3 aPack; attribute vec4 aAnim;
vec3 cRotZ(vec3 p, vec3 c, float a) { p -= c; float cs = cos(a), sn = sin(a); return c + vec3(cs * p.x - sn * p.y, sn * p.x + cs * p.y, p.z); }
vec3 cRotX(vec3 p, vec3 c, float a) { p -= c; float cs = cos(a), sn = sin(a); return c + vec3(p.x, cs * p.y - sn * p.z, sn * p.y + cs * p.z); }
vec3 climbDeform(vec3 p, float piv) {
  float ph = aAnim.x, w = aAnim.y, rub = aAnim.z, look = aAnim.w, st = max(0.0, 1.0 - rub - look) * (1.0 - w), k = floor(aPart + 0.5);
  if (k == 1.0 || k == 2.0) {                                                  // 腿：走 = 前后交替摆；站着 = 跺脚（左右轮流往前上抬）
    float o = k == 1.0 ? 0.0 : 3.1416;
    p = cRotZ(p, vec3(0.0, 0.92, (k == 1.0 ? 0.11 : -0.11)) * piv, 0.45 * sin(ph + o) * w + 0.42 * max(0.0, sin(ph * 0.5 + o)) * st);
  } else if (k == 3.0 || k == 4.0) {                                           // 胳膊：走 = 和腿反着摆；搓手 = 往里收、往前抬到胸前来回搓
    float sd = k == 3.0 ? 1.0 : -1.0;
    vec3 sh = vec3(0.0, 1.4, 0.24 * sd) * piv;
    p = cRotX(p, sh, rub * 0.42 * sd);
    p = cRotZ(p, sh, -0.35 * sin(ph + (k == 3.0 ? 3.1416 : 0.0)) * w + rub * (1.05 + 0.1 * sin(ph * 5.0 + sd)));
  } else if (k == 5.0) {                                                       // 头：抬头看梯子 + 一点点晃
    p = cRotZ(p, vec3(0.0, 1.52, 0.0) * piv, look * 0.6 + 0.05 * sin(ph * 0.7));
  }
  return p;
}
`;
// 在 revealable（走近才露面的抖动溶解）基础上加顶点动画和实例配色；阴影深度材质同样变形
export function climberMaterials(revealable, rev) {
  const patch = (m, key, color, base) => {
    m.onBeforeCompile = sh => {
      if (base) base(sh);
      sh.vertexShader = DECL + sh.vertexShader
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  objectNormal = climbDeform(objectNormal, 0.0);')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = climbDeform(transformed, 1.0);');
      if (color) sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n  vColor.rgb *= aMask < 0.5 ? vec3(1.0) : aMask < 1.5 ? aSuit : aPack;');
    };
    m.customProgramCacheKey = () => key;
    return m;
  };
  const mat = revealable(new THREE.MeshLambertMaterial({ vertexColors: true }), rev);
  return { mat: patch(mat, 'climbC', true, mat.onBeforeCompile), depth: patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), 'climbD', false, null) };
}
