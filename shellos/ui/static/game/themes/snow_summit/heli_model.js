// 直升机低模（AS350「松鼠」一类的比例，按米建再整体缩 S）：放样出来的曲面机舱（大气泡风挡 + 门窗）、上红下白涂装 + 「应急」字、
//   发动机罩、锥形尾梁、带端板的水平尾翼、上下垂尾、撬式起落架（弓形横管）、3 片带扭角的主桨（桨尖黄）、左侧 2 片尾桨。
//   整架一个 mesh = 1 次绘制：主桨 / 尾桨的顶点带 aSpin（1 / 2），在顶点着色器里绕桨毂 / 尾桨轴转（setSpin），阴影也跟着转。
//   LOD 三级（THREE.LOD，离镜头 22 / 55 切）：约 1.5k / 800 / 350 三角形，共用同一个材质和转速。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { loft, colored, tube, at } from './geo.js';

export const S = 0.62;                                              // 米 → 场景单位（化身 1.7 高；真机高 3.1 m → 1.9，比人高一点）
const RED = '#d8261f', WHITE = '#f1f1ee', DARK = '#2a2c30', GLASS = '#2e4257', SKYGLASS = '#6f8fae', COWL = '#dcdcd6', TIP = '#f0c23a';
const HUB = new THREE.Vector3(0, 3.12, 0), TAIL = new THREE.Vector3(-7.35, 2.2, 0.27);

// 「应急」贴字：白底红字（机身下半是白的，贴上去接得上）；整架的其它顶点 uv 都指到左下角的白像素
function decalTexture() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96;
  const g = cv.getContext('2d'); g.fillStyle = WHITE; g.fillRect(0, 0, 256, 96); g.fillStyle = '#ffffff'; g.fillRect(0, 78, 18, 18);   // 左下角纯白：机身别的顶点都采这里（乘上去不变色）
  g.fillStyle = RED; g.font = '900 70px "PingFang SC","Hiragino Sans GB","Noto Sans CJK SC",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('应急', 140, 50);
  g.fillRect(14, 30, 36, 40); g.fillStyle = WHITE; g.fillRect(27, 34, 10, 32); g.fillRect(18, 45, 28, 10);   // 小红十字
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; return t;
}

function parts(lod = 0) {
  const body = [], rotor = [], tail = [], decal = [], L1 = lod >= 1, L2 = lod >= 2, sg = n => L2 ? Math.max(4, n >> 1) : L1 ? Math.max(4, Math.round(n * 0.7)) : n;
  // 机舱：9 段放样。i ≤ 2 机头：除了正下方全是风挡（大气泡）；i = 3–4 上半两侧是门窗；上半红、下半白
  const cab = [[3.02, 0.06, 0.1, 1.3], [2.85, 0.46, 0.56, 1.29], [2.45, 0.78, 0.8, 1.33], [1.9, 0.92, 0.93, 1.39], [1.1, 0.95, 0.96, 1.43],
    [0.2, 0.94, 0.96, 1.46], [-0.7, 0.86, 0.86, 1.51], [-1.5, 0.62, 0.63, 1.63], [-2.1, 0.37, 0.4, 1.75], [-2.45, 0.26, 0.27, 1.82]];
  const CM = L2 ? 8 : L1 ? 12 : 16;
  body.push(loft(cab, CM, 2.6, (i, j0) => {
    const j = Math.floor(j0 * 16 / CM);                                         // 低细节时截面格子少：按 16 格的分法映射回去（窗 / 涂装位置不变）
    if (i <= 2 && j !== 11 && j !== 12) return j >= 3 && j <= 5 ? SKYGLASS : GLASS;                          // 风挡顶上映着天
    if ((i === 3 || i === 4) && (j <= 1 || j === 6 || j === 7)) return j === 1 || j === 6 ? SKYGLASS : GLASS;
    return j < 8 ? RED : WHITE;
  }));
  // 发动机罩：机舱顶上一条圆角的盒子
  body.push(loft([[0.55, 0.08, 0.06, 2.55], [0.4, 0.5, 0.28, 2.55], [-0.4, 0.56, 0.32, 2.56], [-1.4, 0.5, 0.28, 2.5], [-1.95, 0.25, 0.14, 2.35]], sg(12), 3, () => COWL));
  if (!L2) body.push(at(new THREE.CylinderGeometry(0.09, 0.09, 0.3, sg(8)).rotateZ(Math.PI / 2), -2.05, 2.42, -0.28, '#55585e'));    // 排气管
  body.push(at(new THREE.CylinderGeometry(0.09, 0.11, 0.42, sg(8)), 0, 2.88, 0, DARK));                                     // 旋翼轴
  // 尾梁（锥形）、水平尾翼 + 端板、上下垂尾（后掠）、尾撬
  body.push(at(new THREE.CylinderGeometry(0.13, 0.26, 4.9, sg(10)).rotateZ(Math.PI / 2), -4.8, 1.9, 0, RED));
  body.push(at(new THREE.BoxGeometry(0.46, 0.06, 2.1), -6.05, 1.95, 0, RED));
  if (!L2) for (const z of [-1.05, 1.05]) body.push(at(new THREE.BoxGeometry(0.44, 0.5, 0.05), -6.1, 1.97, z, RED));
  const fin = (h, y0, sweep, color) => { const g = new THREE.BoxGeometry(0.85, h, 0.07, 1, 1, 1), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) - sweep * (y + h / 2)); } g.computeVertexNormals(); return at(g, -7.3, y0, 0, color); };
  body.push(fin(1.25, 2.55, 0.45, RED)); body.push(fin(0.55, 1.62, -0.35, RED));
  if (!L1) body.push(tube(new THREE.Vector3(-7.45, 1.35, 0), new THREE.Vector3(-7.75, 1.2, 0), 0.03, DARK, 5));
  // 撬式起落架：两根滑橇（前头上翘）+ 两根弓形横管
  for (const z of [-1.15, 1.15]) {
    body.push(tube(new THREE.Vector3(-1.95, 0.05, z), new THREE.Vector3(1.65, 0.05, z), 0.055, DARK, sg(6)));
    if (!L2) body.push(tube(new THREE.Vector3(1.65, 0.05, z), new THREE.Vector3(2.05, 0.32, z), 0.055, DARK, sg(6)));
    for (const x of [0.95, -1.05]) {
      body.push(tube(new THREE.Vector3(x, 0.05, z), new THREE.Vector3(x, 0.45, z * 0.86), 0.05, DARK, sg(6)));
      if (!L2) body.push(tube(new THREE.Vector3(x, 0.45, z * 0.86), new THREE.Vector3(x, 0.62, z * 0.55), 0.05, DARK, sg(6)));
    }
  }
  if (!L2) for (const x of [0.95, -1.05]) body.push(tube(new THREE.Vector3(x, 0.62, -0.64), new THREE.Vector3(x, 0.62, 0.64), 0.05, DARK, sg(6)));
  if (!L1) body.push(at(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 10).rotateZ(Math.PI / 2), 1.85, 0.62, 0, '#fff2c0'));        // 探照灯（机腹前）
  // 主旋翼：桨毂（星形）+ 3 片桨，每片从根到尖扭 8° → 1°、桨尖一段黄
  rotor.push(at(new THREE.CylinderGeometry(0.26, 0.26, 0.14, sg(12)), HUB.x, HUB.y, HUB.z, '#55585e'));
  for (let k = 0; k < 3; k++) {
    const L = 5.1, g = new THREE.BoxGeometry(L, 0.045, 0.34, L2 ? 1 : L1 ? 3 : 8, 1, 1).toNonIndexed(), p = g.attributes.position, cols = [], cr = new THREE.Color(DARK), ct = new THREE.Color(TIP);
    for (let i = 0; i < p.count; i++) {
      const r = p.getX(i) + L / 2, tw = 0.14 - 0.12 * r / L, y = p.getY(i), z = p.getZ(i);
      p.setXYZ(i, r + 0.24, y * Math.cos(tw) - z * Math.sin(tw), y * Math.sin(tw) + z * Math.cos(tw));
    }
    for (let i = 0; i < p.count; i += 3) { const c = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3 > L - 0.25 ? ct : cr; for (let q = 0; q < 3; q++) cols.push(c.r, c.g, c.b); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); g.computeVertexNormals();
    rotor.push(g.rotateY(k * Math.PI * 2 / 3).translate(HUB.x, HUB.y + 0.02, HUB.z));
    if (!L2) rotor.push(at(new THREE.BoxGeometry(0.34, 0.08, 0.16).rotateY(k * Math.PI * 2 / 3), HUB.x + 0.2 * Math.cos(-k * Math.PI * 2 / 3), HUB.y, HUB.z + 0.2 * Math.sin(-k * Math.PI * 2 / 3), DARK));
  }
  // 尾桨：机身左侧，2 片，绕横轴（z）转
  tail.push(at(new THREE.BoxGeometry(0.15, 1.86, 0.035), TAIL.x, TAIL.y, TAIL.z, DARK));
  if (!L2) tail.push(at(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 8).rotateX(Math.PI / 2), TAIL.x, TAIL.y, TAIL.z - 0.03, '#55585e'));
  // 「应急」：机舱后段下半（白）两侧
  //   贴片按机舱截面弯过去（跟着曲面走，不翘边）
  const hull = (x, y) => {
    let k = 0; while (k < cab.length - 2 && cab[k + 1][0] > x) k++;
    const [x0, w0, h0, c0] = cab[k], [x1, w1, h1, c1] = cab[k + 1], f = (x0 - x) / (x0 - x1), hw = w0 + (w1 - w0) * f, hh = h0 + (h1 - h0) * f, cy = c0 + (c1 - c0) * f;
    const sn = Math.min(1, (Math.abs(y - cy) / hh) ** 1.3); return hw * Math.sqrt(1 - sn * sn) ** (2 / 2.6);
  };
  if (!L2) for (const sd of [1, -1]) {
    const g = new THREE.PlaneGeometry(0.95, 0.36, L1 ? 4 : 8, L1 ? 1 : 2); if (sd < 0) g.rotateY(Math.PI);
    g.translate(-0.2, 1.2, 0); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, sd * (hull(p.getX(i), p.getY(i)) + 0.012));
    g.computeVertexNormals(); decal.push(colored(g, '#ffffff'));
  }
  return { body, rotor, tail, decal };
}

function heliGeo(lod) {
  const P = parts(lod), groups = [];
  const pack = (list, spin, keepUv) => {
    const gs = list.map(g => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      const n = g.attributes.position.count;
      if (!keepUv || !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2).fill(0.01), 2));
      g.setAttribute('aSpin', new THREE.BufferAttribute(new Float32Array(n).fill(spin), 1));
      return g; });
    groups.push(...gs);
  };
  pack(P.body, 0, false); pack(P.rotor, 1, false); pack(P.tail, 2, false); pack(P.decal, 0, true);
  return mergeGeometries(groups).scale(S, S, S);
}

export function buildHeliMesh() {
  const U = { uRot: { value: 0 }, uTail: { value: 0 }, uHub: { value: HUB.clone().multiplyScalar(S) }, uTailP: { value: TAIL.clone().multiplyScalar(S) } };
  const spin = m => {
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, U);
      const rot = v => `if (aSpin > 0.5 && aSpin < 1.5) { vec2 q = ${v}.xz - (${v === 'transformed' ? 'uHub.xz' : 'vec2(0.0)'}); ${v}.xz = (${v === 'transformed' ? 'uHub.xz' : 'vec2(0.0)'}) + vec2(cos(uRot) * q.x - sin(uRot) * q.y, sin(uRot) * q.x + cos(uRot) * q.y); }
        else if (aSpin > 1.5) { vec2 q = ${v}.xy - (${v === 'transformed' ? 'uTailP.xy' : 'vec2(0.0)'}); ${v}.xy = (${v === 'transformed' ? 'uTailP.xy' : 'vec2(0.0)'}) + vec2(cos(uTail) * q.x - sin(uTail) * q.y, sin(uTail) * q.x + cos(uTail) * q.y); }`;
      sh.vertexShader = 'attribute float aSpin; uniform float uRot, uTail; uniform vec3 uHub, uTailP;\n' + sh.vertexShader
        .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>\n${rot('objectNormal')}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${rot('transformed')}`);
    };
    m.customProgramCacheKey = () => 'heliSpin';
    return m;
  };
  const mat = spin(new THREE.MeshLambertMaterial({ vertexColors: true, map: decalTexture() })), depth = spin(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
  const lodObj = new THREE.LOD(), meshes = [0, 1, 2].map(l => { const m = new THREE.Mesh(heliGeo(l), mat); m.customDepthMaterial = depth; m.name = 'heliBody'; return m; });
  lodObj.addLevel(meshes[0], 0); lodObj.addLevel(meshes[1], 22); lodObj.addLevel(meshes[2], 55); lodObj.name = 'heliLOD';
  return { mesh: lodObj, meshes, setSpin(rot, tail) { U.uRot.value = rot % (Math.PI * 2); U.uTail.value = tail % (Math.PI * 2); }, nose: new THREE.Vector3(1.85, 0.55, 0).multiplyScalar(S), rotorR: 5.34 * S, hubY: HUB.y * S };
}
