// 牦牛低模（家牦牛：肩高 ~1.35 m、体长 ~2.1 m，按米建，实例矩阵再缩）：放样的身子 + 肩峰、垂到蹄子边的长毛裙（下沿参差）、
//   低垂的头（浅色嘴、额前一撮毛、耳朵、红缨络头）、先往外再往上弯的角（三段越来越细）、铜铃、尾巴 + 大尾穗；驮包（两侧褡裢 + 红盖布 + 顶上一捆货 + 绳）。
//   整群一个 InstancedMesh = 1 次绘制：腿 / 头 / 尾在顶点着色器里按实例属性动（aAnim = 步相位、走的劲、头偏、尾巴相位；四条腿按走步的顺序
//   后左 → 前左 → 后右 → 前右，各差 1/4 拍）；毛色 / 驮包颜色也是实例属性（aFur / aPack），同一套几何每头看着不一样。约 1k 三角形 / 头。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { loft, colored, tube, at } from './geo.js';

const FUR = '#5e4636', FUR_D = '#44322a', HORN = '#efe6d2', HORN_T = '#6b5a48', MUZ = '#9a8570', HOOF = '#1c1612', RED = '#c8322a', GOLD = '#c9a64a';
const HIP = [0.55, 0.95, 0.19], NECK = [0.86, 1.02, 0], TAILR = [-1.0, 1.04, 0];
const V = (...a) => new THREE.Vector3(...a);

// part：0 身子 / 1–4 腿（前左、前右、后左、后右）/ 5 头 / 6 尾；mask：0 固定色、1 毛（× aFur）、2 驮包（× aPack）
function mark(g, part, mask) {
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  const n = g.attributes.position.count;
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  g.setAttribute('aMask', new THREE.BufferAttribute(new Float32Array(n).fill(mask), 1));
  return g;
}

export function yakGeo(kit) {
  const G = [], add = (g, part = 0, mask = 1) => G.push(mark(g, part, mask));
  const ico = (sx, sy, sz, d = 1) => new THREE.IcosahedronGeometry(1, d).scale(sx, sy, sz);
  // 身子（屁股 → 胸，肩高）+ 肩峰
  add(loft([[-1.08, 0.1, 0.12, 1.02], [-0.92, 0.33, 0.36, 1.0], [-0.45, 0.42, 0.42, 1.0], [0.1, 0.45, 0.45, 1.03], [0.45, 0.43, 0.5, 1.1], [0.72, 0.34, 0.42, 1.08], [0.92, 0.2, 0.26, 1.02]], 12, 2.3, () => FUR));
  add(at(ico(0.46, 0.24, 0.3), 0.38, 1.46, 0, FUR));
  // 长毛裙：椭圆筒从肚子垂到蹄子边，下沿一缕一缕参差
  {
    const g = new THREE.CylinderGeometry(0.46, 0.53, 0.74, 18, 3, true).toNonIndexed(), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), n = kit.noise2(a * 3.1, 1.7);
      const low = y < -0.2 ? 1 : 0, k = 1 + 0.07 * (n - 0.5) * (1 + low);
      p.setXYZ(i, x * k, y - low * (0.02 + 0.13 * Math.max(0, Math.sin(a * 9) * 0.5 + n - 0.4)), z * k);
    }
    g.scale(2.0, 1, 1).translate(0, 0.64, 0); g.computeVertexNormals(); add(colored(g, FUR_D));
  }
  // 腿 ×4（髋 → 蹄）
  [[1, 1, 1], [2, 1, -1], [3, -1, 1], [4, -1, -1]].forEach(([k, fx, sz]) => {
    const x = fx * HIP[0], z = sz * HIP[2];
    add(at(new THREE.CylinderGeometry(0.1, 0.066, 0.88, 7), x, HIP[1] - 0.44 + 0.02, z, FUR_D), k, 1);
    add(at(new THREE.CylinderGeometry(0.07, 0.078, 0.08, 7), x, 0.04, z, HOOF), k, 0);
  });
  // 头（低垂）：脖子、头、浅色嘴、额前一撮毛、耳朵、弯角、红缨、铜铃
  add(at(ico(0.24, 0.26, 0.21), 0.93, 0.98, 0, FUR), 5, 1);
  add(at(ico(0.3, 0.2, 0.19), 1.1, 0.9, 0, FUR), 5, 1);
  add(at(ico(0.13, 0.11, 0.13), 1.34, 0.83, 0, MUZ), 5, 0);
  add(at(ico(0.12, 0.09, 0.15, 0), 1.12, 1.06, 0, FUR_D), 5, 1);
  for (const sd of [1, -1]) {
    add(at(ico(0.08, 0.035, 0.11, 0), 1.02, 0.99, sd * 0.2, FUR), 5, 1);
    const P = [V(1.06, 1.04, sd * 0.12), V(1.04, 1.09, sd * 0.3), V(1.1, 1.25, sd * 0.4), V(1.21, 1.36, sd * 0.32)];
    [[0, 0.048, HORN], [1, 0.036, HORN], [2, 0.022, HORN_T]].forEach(([i, r, c]) => add(tube(P[i], P[i + 1], r, c, 6), 5, 0));
    add(at(new THREE.BoxGeometry(0.05, 0.12, 0.05), 1.08, 0.95, sd * 0.17, RED), 5, 0);
  }
  add(at(ico(0.07, 0.07, 0.07, 0), 1.2, 1.0, 0, RED), 5, 0);
  add(at(new THREE.ConeGeometry(0.065, 0.12, 8), 0.98, 0.7, 0, GOLD), 5, 0);
  add(at(new THREE.BoxGeometry(0.05, 0.05, 0.3), 0.96, 0.8, 0, '#3a3226'), 5, 0);
  // 尾巴 + 尾穗
  add(tube(V(-1.02, 1.02, 0), V(-1.13, 0.64, 0), 0.035, FUR, 5), 6, 1);
  add(at(ico(0.1, 0.24, 0.1), -1.15, 0.5, 0, FUR_D), 6, 1);
  // 驮包：两侧褡裢（白底 × aPack）+ 深色边、红盖布 + 黄边、顶上一捆绿帆布货、绳
  for (const sd of [1, -1]) {
    add(at(new THREE.BoxGeometry(0.6, 0.42, 0.18), 0.02, 1.06, sd * 0.49, '#f2eee6'), 0, 2);
    add(at(new THREE.BoxGeometry(0.62, 0.05, 0.19), 0.02, 1.2, sd * 0.49, '#9a968c'), 0, 2);
  }
  add(at(new THREE.BoxGeometry(0.78, 0.05, 1.08), 0.02, 1.49, 0, RED), 0, 0);
  for (const sd of [1, -1]) add(at(new THREE.BoxGeometry(0.8, 0.06, 0.05), 0.02, 1.49, sd * 0.54, '#e0a93a'), 0, 0);
  add(at(new THREE.CylinderGeometry(0.17, 0.17, 0.82, 10).rotateX(Math.PI / 2), 0.02, 1.66, 0, '#4f6b4a'), 0, 0);
  for (const x of [-0.18, 0.22]) add(at(new THREE.BoxGeometry(0.03, 0.03, 1.12), x, 1.8, 0, '#3a3226'), 0, 0);
  return mergeGeometries(G);
}

// 顶点动画：腿绕髋前后摆、头随步点头 + 转、尾巴甩；法线跟着转（绕原点）
const DECL = `attribute float aPart; attribute float aMask; attribute vec3 aFur; attribute vec3 aPack; attribute vec4 aAnim;
vec3 yRotZ(vec3 p, vec3 c, float a) { p -= c; float cs = cos(a), sn = sin(a); return c + vec3(cs * p.x - sn * p.y, sn * p.x + cs * p.y, p.z); }
vec3 yRotY(vec3 p, vec3 c, float a) { p -= c; float cs = cos(a), sn = sin(a); return c + vec3(cs * p.x + sn * p.z, p.y, -sn * p.x + cs * p.z); }
vec3 yakDeform(vec3 p, float piv) {
  float ph = aAnim.x, w = aAnim.y, k = floor(aPart + 0.5);
  if (k >= 1.0 && k <= 4.0) {
    float off = k == 3.0 ? 0.0 : k == 1.0 ? 1.5708 : k == 4.0 ? 3.1416 : 4.7124;
    vec3 hip = vec3((k < 2.5 ? 1.0 : -1.0) * ${HIP[0]}, ${HIP[1]}, (k == 1.0 || k == 3.0 ? 1.0 : -1.0) * ${HIP[2]}) * piv;
    p = yRotZ(p, hip, 0.36 * sin(ph + off) * w);
  } else if (k == 5.0) {
    vec3 nk = vec3(${NECK.map(v => v.toFixed(3)).join(', ')}) * piv;
    p = yRotZ(p, nk, -0.06 + 0.07 * sin(ph * 2.0 + 0.6) * w);
    p = yRotY(p, nk, aAnim.z);
  } else if (k == 6.0) {
    p = yRotY(p, vec3(${TAILR.map(v => v.toFixed(3)).join(', ')}) * piv, 0.4 * sin(aAnim.w));
  }
  return p;
}
`;
export function yakMaterials() {
  const patch = (m, key, color) => {
    m.onBeforeCompile = sh => {
      sh.vertexShader = DECL + sh.vertexShader
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  objectNormal = yakDeform(objectNormal, 0.0);')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = yakDeform(transformed, 1.0);');
      if (color) sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n  vColor.rgb *= aMask < 0.5 ? vec3(1.0) : aMask < 1.5 ? aFur : aPack;');
    };
    m.customProgramCacheKey = () => key;
    return m;
  };
  return { mat: patch(new THREE.MeshLambertMaterial({ vertexColors: true }), 'yakC', true), depth: patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), 'yakD', false) };
}
