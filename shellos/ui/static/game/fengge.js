// 峰哥：给 loadAvatar() 出来的化身换上峰哥的头和户外穿搭。独立模块，avatar.js 不用改：
//   import { dressFengge } from '/game/fengge.js';  const av = await loadAvatar(...);  await dressFengge(av);
// 在 loadAvatar 之后、第一次 pose()/animate() 之前调（按绑定姿态摆）；group 还没旋转 / 缩放（正面 = +X）。
// 骨骼名、层级、静止朝向都是 CesiumMan 原样（fengge/shape.js 只挪关节位置改比例）→ A2 的动作照常用；头 / 帽 / 头发挂在 Skeleton_neck_joint_2，
//   围脖挂在 Skeleton_neck_joint_1，A2 转头时跟着走。
// 第 4 轮（9/23 夜，身体）：CesiumMan 网格藏掉，换成 fengge/body.js 按骨骼现摆的低多边形身体（偏瘦、窄肩、头身比约 1:6.5），
//   穿搭见 fengge/outfits.js（按当前世界的 theme.style 选，?outfit= 临时换），手见 fengge/hand.js（有指骨，能握拳 / 竖大拇指 / 伸手扣锁）。
// 头 v2（P 线）：几何头型 = 放样（每层一个左右宽 W、前后深 Zf/Zb 的截面，从下巴到头顶 40 层）+ 脸部起伏（鼻梁 / 鼻翼 / 眼窝 / 眉弓 /
//   颧骨 / 嘴唇 / 下巴带胡子），单位 = 参考照片的像素（原图 675×1200，两眼中点 = 原点，y 向上，z 朝前），最后整体缩到 headH 米。
//   照片（models/fengge_face_hd.jpg，裁自 github.com/w466747380/talk-to-fengge-live 的 avatar.png，MIT）按正前方正投影贴上去：
//   几何的五官位置就是照片里的五官位置，所以不用对齐；侧面（转开 60° 以上）照片淡出成肤色 / 胡茬，不会被拉成条。
//   针织帽 = 翻边 + 帽身，罗纹针脚是 canvas 画的（贴图 + 凹凸）；头发 = 帽子下面两侧和后脑往外蓬的一圈发片（照片里就是这样）。
// v3 = 候选 C（球球 9/23 晚挑的）：同一套几何 + 照片，改哑光、整张脸去饱和压色阶，见 STYLES。
// 黑色抓绒围脖（照片里就有）盖住脖口。
// 开销：头 / 帽 / 头发两档 LOD（lodDist 3.6 m）：近档（正面镜头）头 5.8k、帽 3k、头发 1.9k 三角，远档（跟拍、登顶环绕）共约 1.8k；围脖 0.6k；
//   身体约 2.3k、两只手 516；贴图 = 400×540 照片 + 两张 128² canvas。登顶动作见 ⑤ summitGesture。
// 主题往头上挂东西：av.group.userData.fengge.lamp = 帽檐正前方（头骨局部坐标），有它就说明换了峰哥头。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { reshape } from './fengge/shape.js';
import { buildBody } from './fengge/body.js';
import { outfitFor } from './fengge/outfits.js';
import { makeHands } from './fengge/hand.js';

let HANDS = null;
// 伸手扣锁（E 线华山南天门用）：target = 世界坐标 THREE.Vector3（会拷一份）；null = 松手收回。grip = 手到位（< 3 cm）后自动攥住。
//   手臂两节骨 IK（hand.js），权重 0.4 s 渐入 / 渐出；reachStatus(side) → { k, gripped, dist }，gripped = 扣上了；reachGrip(side) = 手心抓握点（Object3D，锁扣可以 attach 上去）
export function reach(target, { side = 'R', grip = true } = {}) { if (HANDS) HANDS.setReach(side, target, { grip }); }
export const reachStatus = (side = 'R') => (HANDS ? HANDS.status(side) : null);
export const reachGrip = (side = 'R') => (HANDS ? HANDS.grip[side] : null);

export const FENGGE_LOOK = {
  skin: '#d29a84', beard: '#4a3a32', hair: '#2e2622', beanie: '#5a5c61', gaiter: '#1e1f22',   // 肤色 / 胡茬 / 帽子按参考照片取样
  fleece: '#34373d', pants: '#25282d', teal: '#1d7d88', glove: '#c48c76', shoe: '#4a4038', sole: '#9b948a',   // glove = 手：峰哥没戴手套（登顶竖大拇指要看得见）
  faceGlow: 0.32, rimK: 0.35,           // rimK = 头部件轮廓光占化身轮廓光的比例（深色帽子 / 头发整片被照亮就不像头发了）
  lodDist: 3.6,            // 头离镜头超过这么远（米）换远档：正面镜头约 2.4 m、跟拍约 5 m
  style: 'C',              // 造型，见 STYLES；?fgstyle=v2 看旧的
};
// 第 3 轮（9/23 晚）：球球说 v2「还是太丑」，做了 A 平涂卡通 / B 低多边形雕塑 / C v2 改良三个候选（截图 docs/提交/截图/fengge_v3_*.png，
//   A、B 的代码见 git e1f2d23），**球球选了 C**。relief = 五官起伏倍数；mat = std（v2 的 PBR）/ lam（哑光，和身体一样）；
//   post = 照片和肤色混好之后整张脸去饱和 + 压色阶（不那么「照片」，脸和两侧肤色也接得上）；headH = 头高（米）。
//   头 0.25 m 起 = 身高 1/5.8，比真人大：正面镜头 2.4 m 外脸才认得出。look.headH 可以覆盖。
//   试过三阶卡通光（MeshToonMaterial）：背光面不变暗，泰山拂晓的暖光下整张脸成了发光的橙色面具，不用
const STYLES = {
  v2: { relief: 1, headH: 0.25, mat: 'std' },
  C: { relief: 0.8, headH: 0.23, mat: 'lam', post: true, flat: true },   // 第 4 轮起：头 0.23 m（身高约 1/6.5）、平面着色，和低多边形身体一个质感
};
let RK = 1;                                                // 当前造型的 relief（headAt 用）

// —— 头型：照片像素单位 ——
const EYE = [313, 505], CROP = [113, 300, 400, 540];     // 原图里两眼中点；贴图 = 原图 (113,300) 起 400×540
const ZC = -95;                                            // 截面中心（前后），头最宽处在这里（耳朵上方）
// y, 半宽 W, 前 Zf, 后 Zb（照片里量的脸宽：颧骨 ±165，胡子下沿 -305，帽檐 +120；前后深按真人比例）
const ROWS = [[-315, 0, 70, -40], [-305, 60, 86, -70], [-280, 98, 96, -115], [-240, 126, 106, -168], [-180, 154, 116, -228],
  [-120, 169, 122, -272], [-60, 177, 124, -306], [0, 181, 122, -326], [50, 183, 126, -331], [120, 176, 115, -311],
  [176, 152, 87, -282], [212, 101, 25, -219], [228, 45, -41, -151], [232, 0, -95, -95]];   // 帽檐以上按椭圆收顶
const Y0 = ROWS[0][0], Y1 = ROWS[ROWS.length - 1][0];
function prof(y) {
  let i = 1; while (i < ROWS.length - 1 && ROWS[i][0] < y) i++;
  const a = ROWS[i - 1], b = ROWS[i], t = (y - a[0]) / (b[0] - a[0]), s = t * t * (3 - 2 * t) * 0.35 + t * 0.65;   // 分段，稍微圆一点
  return [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s, a[3] + (b[3] - a[3]) * s];
}
const G2 = (x, y, cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2) - ((y - cy) / sy) ** 2);
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function relief(x, y) {                                    // 脸部起伏（z 方向加多少像素）
  const ay = Math.abs(x);
  const tip = ss(15, -85, y), nh = y > 15 ? 12 * G2(0, y, 0, 15, 1, 22) : y > -85 ? 12 + 50 * tip : 62 * G2(0, y, 0, -85, 1, 15);
  let z = nh * G2(x, 0, 0, 0, 15 + 12 * tip, 1);                                          // 鼻梁 → 鼻尖
  z += 20 * (G2(x, y, -36, -96, 15, 13) + G2(x, y, 36, -96, 15, 13));                  // 鼻翼
  z -= 20 * (G2(x, y, -86, 2, 40, 22) + G2(x, y, 88, 2, 40, 22));                       // 眼窝
  z += 11 * G2(0, y, 0, 40, 1, 18) * Math.exp(-((ay / 115) ** 4));                       // 眉弓
  z += 9 * (G2(x, y, -112, -60, 40, 40) + G2(x, y, 114, -60, 40, 40));                  // 颧骨
  z += 9 * G2(x, y, 0, -150, 60, 14) + 16 * G2(x, y, 0, -186, 52, 20);                  // 小胡子 + 嘴唇
  z -= 8 * (G2(x, y, -64, -190, 14, 14) + G2(x, y, 66, -190, 14, 14));                  // 嘴角
  z += 24 * G2(x, y, 4, -262, 58, 36);                                                     // 下巴 + 山羊胡
  return z;
}
// 头表面：φ = 0 正前（+z）、往 +x（看脸时的右边）转；x = W·sinφ，前半 z = ZC + (Zf−ZC)·cos^0.6（脸比椭圆平），后半椭圆
function headAt(y, phi, out, k = 1, face = true) {
  const [W, Zf, Zb] = prof(y), c = Math.cos(phi);
  const x = W * Math.sin(phi);
  let z = c >= 0 ? ZC + (Zf - ZC) * Math.pow(c, 0.6) : ZC - (ZC - Zb) * Math.pow(-c, 0.9);
  if (face && c > 0) z += relief(x, y) * RK * ss(0, 0.45, c);
  return out.set(x * k, y, ZC + (z - ZC) * k);
}

function grid(nu, nv, f, closed) {                        // f(u, v) → [x, y, z, 贴图u, 贴图v, ...额外]；closed = 首尾列法线合并（接缝不显）
  const P = [], UV = [], I = [], X = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { const r = f(i / nu, j / nv); P.push(r[0], r[1], r[2]); UV.push(r[3], r[4]); if (r.length > 5) X.push(...r.slice(5)); }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, c = a + nu + 1; I.push(a, a + 1, c, a + 1, c + 1, c); }
  const g = new THREE.BufferGeometry();
  g.setIndex(I); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.computeVertexNormals();
  if (closed) { const N = g.attributes.normal, n = new THREE.Vector3(), m = new THREE.Vector3();
    for (let j = 0; j <= nv; j++) { const a = j * (nu + 1), b = a + nu; n.fromBufferAttribute(N, a).add(m.fromBufferAttribute(N, b)).normalize(); N.setXYZ(a, n.x, n.y, n.z); N.setXYZ(b, n.x, n.y, n.z); } }
  return { g, X };
}

// —— 贴图（canvas，只做一次）——
let texP = null;
function faceTexture() {                                   // 照片 + 脸的遮罩（帽檐以下、脸轮廓以内，边缘 14 px 羽化）写进 alpha
  return texP || (texP = new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const [ox, oy, W, H] = CROP, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0, W, H);
      const d = g.getImageData(0, 0, W, H), p = d.data;
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const x = i + ox - EYE[0], y = EYE[1] - (j + oy);
        const top = 128 - 0.0055 * x * x - y;
        const hw = y > -150 ? 157 : 157 * Math.sqrt(Math.max(0, 1 - ((y + 150) / 158) ** 2));
        p[(j * W + i) * 4 + 3] = 255 * Math.min(1, Math.max(0, Math.min(top, hw - Math.abs(x - 6)) / 14));
      }
      g.putImageData(d, 0, 0);
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      res(t);
    };
    img.onerror = rej;
    img.src = '/models/fengge_face_hd.jpg';
  }));
}
let knitT = null;
function knitTexture() {                                   // 罗纹针织：每列一串 V 字针脚，列间一道凹缝，加点麻灰杂色（照片里的帽子是麻灰的）
  if (knitT) return knitT;
  const N = 128, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d'); g.fillStyle = '#444'; g.fillRect(0, 0, N, N);
  const CW = 16, RH = 8;
  for (let cx = 0; cx < N; cx += CW) for (let cy = -RH; cy < N + RH; cy += RH) for (const s of [-1, 1]) {
    const gr = g.createLinearGradient(0, cy, 0, cy + RH + 2); gr.addColorStop(0, '#c4c4c4'); gr.addColorStop(1, '#6a6a6a');
    g.fillStyle = gr; g.save(); g.translate(cx + CW / 2 + s * 3.4, cy + RH / 2 + 1); g.rotate(s * 0.55);
    g.beginPath(); g.ellipse(0, 0, 2.9, 5.6, 0, 0, Math.PI * 2); g.fill(); g.restore();
  }
  const d = g.getImageData(0, 0, N, N);
  for (let i = 0; i < d.data.length; i += 4) { const r = Math.random(), k = r > 0.985 ? 1.5 : r < 0.03 ? 0.6 : 0.9 + Math.random() * 0.2;
    for (let c = 0; c < 3; c++) d.data[i + c] = Math.min(255, d.data[i + c] * k); }
  g.putImageData(d, 0, 0);
  knitT = new THREE.CanvasTexture(cv); knitT.wrapS = knitT.wrapT = THREE.RepeatWrapping; knitT.colorSpace = THREE.SRGBColorSpace; knitT.anisotropy = 4;
  return knitT;
}
let hairT = null;
function hairTexture() {                                   // 发丝：竖向深浅细线；底边长短不齐（alpha），发尾是散的
  if (hairT) return hairT;
  const W = 128, H = 128, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#3c3c3c'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 320; i++) {
    const x = Math.random() * W, l = Math.random() * 0.35 + 0.65, v = 30 + Math.random() * (Math.random() < 0.15 ? 200 : 110) | 0;   // 少数亮发丝 = 反光
    g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 0.6 + Math.random() * 1.4;
    g.beginPath(); g.moveTo(x, 0); g.quadraticCurveTo(x + (Math.random() - 0.5) * 10, H * 0.5, x + (Math.random() - 0.5) * 14, H * l); g.stroke();
  }
  const d = g.getImageData(0, 0, W, H);
  for (let x0 = 0; x0 < W;) {                             // 一绺一绺：每绺宽 6–16 px、长短不一，发梢收成尖
    const w = 6 + Math.random() * 10 | 0, len = H * (0.7 + Math.random() * 0.3);
    for (let i = x0; i < Math.min(W, x0 + w); i++) {
      const end = len - Math.abs(i - x0 - w / 2) * (1.5 + Math.random()) * 2;
      for (let j = 0; j < H; j++) d.data[(j * W + i) * 4 + 3] = j < end ? 255 : 0;
    }
    x0 += w;
  }
  g.putImageData(d, 0, 0);
  hairT = new THREE.CanvasTexture(cv); hairT.wrapS = THREE.RepeatWrapping; hairT.colorSpace = THREE.SRGBColorSpace; hairT.flipY = false;
  return hairT;
}

// 化身同款：点光按 uPointK 折减（别被跟随灯染色）+ 菲涅尔轮廓光（夜里深色帽子 / 头发不会糊进天空）+ 一点自发光（夜景里看得清）。
//   uniform 和身体共用（主题改轮廓光颜色时一起变）；more = 额外的片元代码挂点
function tune(mat, U, key, rimK, glow, more) {
  const lights = THREE.ShaderChunk.lights_fragment_begin.replace('getPointLightInfo( pointLight, geometryPosition, directLight );', '$&\n\t\tdirectLight.color *= uPointK;');
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uPointK: U.uPointK || { value: 0.35 }, uRim: U.uRim || { value: new THREE.Color('#ffe2b8') }, uRimK: U.uRimK || { value: 0.9 } });
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nuniform float uRimK, uPointK;')
      .replace('#include <lights_fragment_begin>', lights)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * ${glow.toFixed(3)} + uRim * pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0) * uRimK * ${rimK.toFixed(3)};`);
    if (more) more(sh);
  };
  mat.customProgramCacheKey = () => 'fengge-' + key;
  return mat;
}

export async function dressFengge(av, look = {}) {
  const L = { ...FENGGE_LOOK, ...look };
  const head = av.bones['Skeleton_neck_joint_2'], neck = av.bones['Skeleton_neck_joint_1'];
  let mesh = null; av.group.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  if (!head || !neck || !mesh) return false;
  const ST = STYLES[new URLSearchParams(location.search).get('fgstyle')] || STYLES[L.style] || STYLES.v2;
  RK = ST.relief;
  const photo = await faceTexture();
  av.group.updateMatrixWorld(true);
  const U = mesh.material.userData.look || {};
  // 身体（第 4 轮）：先按峰哥的比例挪骨骼（shape.js），再按新骨骼现摆一副低多边形身体（body.js，穿搭见 outfits.js），CesiumMan 网格藏掉
  reshape(av);
  const outfit = await outfitFor();
  const body = buildBody(av, outfit, { tune: (m, more) => tune(m, U, 'body', L.rimK, 0.18, more) });
  if (outfit.uniforms.uSpan) { outfit.uniforms.uSpan.value = body.shY - body.hipY; outfit.uniforms.uHip.value = body.hipY; }
  mesh.visible = false;
  av.group.userData.fenggeBody = body;
  for (const x of head.children) if (x.name === 'exo') x.visible = false;
  for (const n of ['Skeleton_arm_joint_L__2_', 'Skeleton_arm_joint_R__3_']) for (const x of av.bones[n]?.children || []) if (x.name === 'exo') x.visible = false;   // 手腕上的深色小球（外骨骼没有手套）藏掉，露出手

  // 头组：像素单位 → 米（S），照片坐标（x 右、z 前）转到化身（+X 前、−Z 右）= 绕 Y 转 +90°；下巴底在头骨关节下方 1 cm（CesiumMan 脖子长，按原位置放像长颈鹿）
  const S = (look.headH || ST.headH) / (Y1 - Y0), N = av.group.worldToLocal(head.getWorldPosition(new THREE.Vector3()));
  const H = new THREE.Group(); H.name = 'fengge';
  H.scale.setScalar(S); H.rotation.y = Math.PI / 2; H.position.set(N.x - ZC * S, N.y - 0.01 - Y0 * S, N.z);
  // 材质两档共用；几何按分辨率各造一份（LOD：近 = 全精度，远 = 约 1/6 面数）
  const SMILE = { value: 0 };                                // 登顶时嘴角上扬（0..1），见 ⑤
  const mk = (o, rough = 1) => ST.mat === 'std' ? new THREE.MeshStandardMaterial({ ...o, roughness: rough, metalness: 0 })
    : new THREE.MeshLambertMaterial({ ...o, flatShading: !!ST.flat });
  const key = k => k + '-' + ST.mat + (ST.post ? 'P' : '');
  const headMat = tune(mk({ map: photo, vertexColors: true }, 0.72), U, key('head'), L.rimK * 0.3, L.faceGlow, sh => {
    sh.uniforms.uSmile = SMILE;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aPhoto, aBeard;\nvarying float vPhoto, vBeard;\nvarying vec3 vHP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPhoto = aPhoto; vBeard = aBeard; vHP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSmile;\nvarying float vPhoto, vBeard;\nvarying vec3 vHP;')
      .replace('#include <map_fragment>', `vec2 suv = vMapUv;                     // 嘴角（照片里 (±64, −190) px）附近往下取样 = 嘴角往上挪约 7 px
        vec2 dl = (suv - vec2(0.34, 0.269)) / vec2(0.06, 0.045), dr = (suv - vec2(0.66, 0.269)) / vec2(0.06, 0.045);
        suv.y -= uSmile * 0.013 * (exp(-dot(dl, dl)) + exp(-dot(dr, dr)));
        vec4 ph = texture2D(map, suv);
        diffuseColor.rgb = mix(diffuseColor.rgb, ph.rgb, ph.a * vPhoto);
        float gn = fract(sin(dot(floor(vHP * 0.5), vec3(12.9898, 78.233, 37.719))) * 43758.5453);   // 胡茬颗粒（约 1 mm）
        diffuseColor.rgb *= 1.0 - vBeard * (1.0 - ph.a * vPhoto) * 0.45 * gn;${ST.post ? `
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11))), 0.35);   // C：去饱和 35%、压成色阶
        diffuseColor.rgb = mix(diffuseColor.rgb, floor(diffuseColor.rgb * 6.0 + 0.5) / 6.0, 0.4);` : ''}`);
  });
  const knit = knitTexture();
  const beanieMat = tune(mk({ color: L.beanie, map: knit, bumpMap: knit, bumpScale: 2.2 }), U, key('beanie'), L.rimK, 0.12);
  const hairMat = tune(mk({ color: L.hair, map: hairTexture(), alphaTest: 0.5, side: THREE.DoubleSide }, 0.6), U, key('hair'), L.rimK * 0.3, 0.06);
  const skin = new THREE.Color(L.skin), beard = new THREE.Color(L.beard), hairC = new THREE.Color(L.hair).multiplyScalar(0.6), col = new THREE.Color(), p = new THREE.Vector3();
  const edge = phi => { const c = Math.cos(phi); return -35 + 155 * Math.pow(Math.max(0, c), 1.6) + 15 * Math.max(0, -c); };
  const P0 = 62 * Math.PI / 180;
  const build = ([hc, hr, bc, br, xc, xr]) => {              // [头 列/层, 帽 列/层, 头发 列/层]
    const G = new THREE.Group();
    const add = (geo, mat, name) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.frustumCulled = false; G.add(m); };
    // ① 头：每个顶点带 照片权重（正面才贴）、胡茬权重、后脑发色
    const { g: hg, X: hx } = grid(hc, hr, (u, t) => {
      const y = Y0 + (Y1 - Y0) * t, phi = (u - 0.5) * 2 * Math.PI; headAt(y, phi, p);
      const b = ss(-140, -205, y) * ss(-0.35, 0.25, Math.cos(phi)), nape = ss(-0.1, -0.4, Math.cos(phi)) * ss(-60, -120, y);   // 后脑下半 = 头发色（发片底下露出来的地方）
      return [p.x, p.y, p.z, (p.x + EYE[0] - CROP[0]) / CROP[2], 1 - (EYE[1] - p.y - CROP[1]) / CROP[3], b, ss(0.2, 0.5, Math.cos(phi)), nape];
    }, true);                                                // 照片权重按「没加起伏的头」的朝向算：鼻子侧面照样贴照片
    const cnt = hg.attributes.position.count, aPhoto = new Float32Array(cnt), aBeard = new Float32Array(cnt), cols = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) {
      aPhoto[i] = hx[3 * i + 1]; aBeard[i] = hx[3 * i];
      col.copy(skin).lerp(beard, 0.8 * hx[3 * i]).lerp(hairC, hx[3 * i + 2]); cols.set([col.r, col.g, col.b], i * 3);
    }
    hg.setAttribute('aPhoto', new THREE.BufferAttribute(aPhoto, 1)); hg.setAttribute('aBeard', new THREE.BufferAttribute(aBeard, 1));
    hg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    add(hg, headMat, 'fenggeHead');
    // ② 针织帽：帽檐线 = 前额 +120（照片里的帽檐）、两侧压到耳朵上方 −35、后脑 −20；翻边 64 px + 帽身，顶上略鼓、往后塌一点。
    //   翻边和帽身合成一个网格（针脚密度写进 uv）：少一次绘制
    const cuffP = [[-6, 1.0], [-3, 1.1], [8, 1.135], [56, 1.13], [64, 1.1], [66, 1.075]];   // 翻边截面：[帽檐线上方多少 px, 往外放多少]
    const { g: cg } = grid(bc, cuffP.length - 1, (u, t) => {
      const phi = (u - 0.5) * 2 * Math.PI, [dy, k] = cuffP[Math.round(t * (cuffP.length - 1))];
      headAt(Math.min(Y1 - 30, edge(phi) + dy), phi, p, k, false);
      return [p.x, p.y, p.z, u * 15, dy / 64];
    }, true);
    const { g: bg } = grid(bc, br, (u, t) => {
      const phi = (u - 0.5) * 2 * Math.PI, y0 = edge(phi) + 60, y = y0 + (Y1 - y0) * t, back = Math.max(0, -Math.cos(phi));
      headAt(Math.min(y, Y1), phi, p, 1.075 + 0.03 * Math.sin(Math.PI * t), false);
      p.y += 26 * t * t; p.z -= 22 * t * t * back;
      return [p.x, p.y, p.z, u * 13, t * 1.8];
    }, true);
    if (outfit.beanie !== false) add(mergeGeometries([cg, bg]), beanieMat, 'fenggeBeanie');   // 有的穿搭换帽子（泰山遮阳帽）
    // ③ 头发：帽子底下两侧 + 后脑，从脸侧（φ = ±62°）绕到后面；越往下越往外蓬（照片里两边头发撑出脸外约 70 px），发尾长短不齐
    const hairLayer = (len, k0, flare, du) => grid(xc, xr, (u, t) => {  // 两层：里层长、外层短一点更蓬，发尾错开才有厚度
      const phi = P0 + (2 * Math.PI - 2 * P0) * u, side = Math.abs(Math.sin(phi)), front = ss(P0 + 0.5, P0, Math.min(phi, 2 * Math.PI - phi));
      const y = 45 - (300 - 12 * side) * len * t, k = k0 + (0.34 * side + 0.16) * flare * t * t * (1 - 0.5 * front);
      headAt(Math.max(y, Y0 + 60), phi, p, k, false); if (y < Y0 + 60) p.y = y;
      return [p.x, p.y, p.z, u * 7 + du, t];
    }).g;
    add(mergeGeometries([hairLayer(1, 1.035, 1, 0), hairLayer(0.82, 1.06, 1.25, 0.37)]), hairMat, 'fenggeHair');
    return G;
  };
  // LOD：跟拍镜头（约 5 m）/ 登顶环绕用远档，正面镜头（约 2.4 m）用近档。?fglod=0 / 1 = 固定用近 / 远档（截图对比用）
  const lod = new THREE.LOD(); lod.name = 'fenggeLOD';
  lod.addLevel(build([72, 40, 72, 16, 48, 10]), 0); lod.addLevel(build([28, 16, 28, 6, 16, 4]), L.lodDist, 0.1);
  const force = new URLSearchParams(location.search).get('fglod');
  if (force === '0' || force === '1') { lod.autoUpdate = false; lod.levels.forEach((l, i) => { l.object.visible = i === +force; }); }
  H.add(lod);

  av.group.add(H); head.attach(H);                         // 世界变换不变地挂到头骨上

  // ④ 围脖（照片里的黑色抓绒围脖）：脖子一圈，下面埋进衣领，上沿到胡子下面；挂在脖子骨上，转头不带着它转
  const nk = av.group.worldToLocal(neck.getWorldPosition(new THREE.Vector3()));
  if (outfit.gaiter !== false) {                                // 短袖 / T 恤的穿搭不戴围脖，脖子露肤色（body 的脖子段）
    const gaiter = tune(mk({ color: L.gaiter, map: knit }), U, key('gaiter'), L.rimK, 0.1);
    // [高度（相对脖子骨）, 半径, 前后中心]：底下堆在肩上、盖住 CesiumMan 的脖口（直径约 17 cm、中心偏后 4 cm），往上收到脖子粗细，上沿翻一圈
    const gP = [[-0.1, 0.108, -0.036], [-0.065, 0.1, -0.03], [-0.035, 0.08, -0.012], [0, 0.066, 0.004], [0.025, 0.064, 0.01], [0.044, 0.069, 0.012], [0.054, 0.065, 0.012], [0.06, 0.05, 0.01]];
    const { g: gg } = grid(40, gP.length - 1, (u, t) => {
      const j = Math.round(t * (gP.length - 1)), [h, r0, cx] = gP[j], a = u * 2 * Math.PI, fr = Math.cos(a);
      const r = r0 * (1 + (j > 0 && j < gP.length - 1 ? 0.035 * Math.sin(7 * a + j * 1.9) : 0));   // 堆起来的褶
      return [nk.x + cx + fr * r, nk.y + h - (h > 0.04 ? 0.02 * Math.max(0, fr) : 0), nk.z + Math.sin(a) * r, u * 14, t * 3];
    }, true);
    const gm = new THREE.Mesh(gg, gaiter); gm.name = 'fenggeGaiter'; gm.frustumCulled = false;
    av.group.add(gm); neck.attach(gm);
  }

  // 给主题挂头灯用（头骨局部坐标）：帽檐翻边正前方
  const lamp = head.worldToLocal(H.localToWorld(headAt(edge(0) + 34, 0, new THREE.Vector3(), 1.16, false)));
  av.group.userData.fengge = { lamp };
  av.fengge = true;
  // 穿搭的配件（护目镜 / 氧气面罩 / 冰爪 / 安全带 / 背包 / 遮阳帽 / 头灯 …）：静止姿态下按骨骼摆好再挂上去
  if (outfit.extras) outfit.extras({ THREE, av, outer: av.group, B: av.bones, J: body.J, body, H, headAt, edge, L, nk,
    tune: (m, key, rimK = L.rimK, glow = 0.15) => tune(m, U, key, rimK, glow),
    attach: (o, bone) => { av.group.add(o); (av.bones[bone] || av.group).attach(o); return o; } });
  // 手（hand.js）：自己的指骨，挂腕骨；身体的袖口收在腕骨上，手根往外 1 cm。登顶动作要用手，所以先建手、再包登顶、最后每帧收尾 apply
  HANDS = makeHands(av, { skin: L.glove, shift: 0.01, tune: m => tune(m, U, 'hand', L.rimK, 0.18) });
  armClearance(av);                                          // 手别插进髋部外骨骼（A2 的动作之后、登顶 / 伸手之前）
  summitGesture(av, head, SMILE, HANDS);
  const a2 = av.animate;
  if (a2) av.animate = function (dt, t, d) { a2.call(this, dt, t, d); HANDS.apply(Math.min(dt, 0.1)); };
  return true;
}

// 手别插进髋部外骨骼（9/23 夜球球看第 1 轮提的）：A2 的摆臂平面正好穿过髋侧电机（离中线 0.15–0.22 m）。
//   ① 两条上臂在 A2 的姿态上再往外张 ABD（绕化身前后轴）；② 兜底：每帧量手心（腕往前 7 cm），落进髋部模块的前后 / 上下范围、离中线又不到 ZMIN，
//   就把上臂再往外转到刚好出来（按手心到肩的竖直距离换成角度）。?clear=0 关掉（截图对比用）。登顶 / 伸手的 IK 在这之后，会覆盖右臂。
const ABD = 11, ZMIN = 0.245, MOD = { x: 0.14, y: 0.13 };   // 外张角（°）；手心离中线至少多远（米）；髋部模块前后 / 上下半径（含手厚）
function armClearance(av) {
  if (!av.animate || new URLSearchParams(location.search).get('clear') === '0') return;
  const B = av.bones, outer = av.group, V = () => new THREE.Vector3(), qP = new THREE.Quaternion(), qR = new THREE.Quaternion(), X = V().set(1, 0, 0);
  const S = [['R', +1, 'Skeleton_arm_joint_R', 'Skeleton_arm_joint_R__2_', 'Skeleton_arm_joint_R__3_', 'leg_joint_R_1'],
    ['L', -1, 'Skeleton_arm_joint_L__4_', 'Skeleton_arm_joint_L__3_', 'Skeleton_arm_joint_L__2_', 'leg_joint_L_1']].filter(r => B[r[2]] && B[r[3]] && B[r[4]] && B[r[5]]);
  const loc = (b, o) => outer.worldToLocal(b.getWorldPosition(o));
  const out = (bone, deg) => {                              // 绕化身前后轴往外转（右 = +Z 侧 → 负角）
    qP.identity(); for (let p = bone.parent; p && p !== outer; p = p.parent) qP.premultiply(p.quaternion);
    bone.quaternion.premultiply(qR.copy(qP).invert().multiply(new THREE.Quaternion().setFromAxisAngle(X, deg * Math.PI / 180)).multiply(qP));
    bone.updateMatrixWorld(true);
  };
  const sh = V(), el = V(), wr = V(), hand = V(), hip = V();
  const orig = av.animate;
  av.animate = function (dt, t, d) {
    orig.call(this, dt, t, d);
    outer.updateMatrixWorld(true);
    for (const [, sg, an, en, wn, hn] of S) {
      out(B[an], -sg * ABD);
      loc(B[an], sh); loc(B[en], el); loc(B[wn], wr); loc(B[hn], hip);
      hand.copy(wr).addScaledVector(wr.clone().sub(el).normalize(), 0.07);
      const zo = hand.z * sg;                                // 手心离中线（往外为正）
      if (Math.abs(hand.x - hip.x) < MOD.x && Math.abs(hand.y - hip.y - 0.02) < MOD.y && zo < ZMIN) {
        const dy = Math.max(0.1, sh.y - hand.y), need = Math.atan2(ZMIN - zo, dy) * 180 / Math.PI;
        out(B[an], -sg * Math.min(25, need));
      }
    }
  };
}

// ⑤ 登顶「这是个好事儿啊」：包一层 A2 的 animate（先原样跑，再按登顶程度 k 叠加），只管三样：
//   头 = 先点两下头（1.6 s），再在 A2 的抬头上多仰 6°、往一侧歪 8°（得意）；右手 = 用 hand.js 的 IK 把拳头举到头侧（小臂竖起、掌心朝里），
//   手势 thumbsUp → 大拇指朝天（登顶镜头多从背后拍，举在胸前从背后看不见）；脸 = 照片嘴角往上挪（SMILE）。
//   左臂和其余关节都是 A2 的（V 字挥手照旧）。k = A2 的登顶程度 av.body.P.cheer（和他的举臂、抬头同一时刻起落；A2 9/23 同意由 P 维护这层）。
//   A2 每帧从 rest 重算这几根骨，所以这里改完不会逐帧累积；右臂 IK 按 k 和 A2 的姿态 slerp。
function summitGesture(av, head, SMILE, HANDS) {
  const outer = av.group;
  if (!av.animate) return;
  const qP = new THREE.Quaternion(), qR = new THREE.Quaternion(), eu = new THREE.Euler(), d2r = Math.PI / 180, tgt = new THREE.Vector3();
  const inBody = (bone, q) => { qP.identity(); for (let p = bone.parent; p && p !== outer; p = p.parent) qP.premultiply(p.quaternion); bone.quaternion.premultiply(qR.copy(qP).invert().multiply(q).multiply(qP)); };
  const orig = av.animate;
  let k = 0, tS = 0;
  av.animate = function (dt, t, d) {
    orig.call(this, dt, t, d);
    k = this.body ? this.body.P.cheer : k + ((d.summit ? 1 : 0) - k) * (1 - Math.exp(-Math.min(dt, 0.1) / 0.35));
    tS = d.summit ? tS + dt : 0;
    SMILE.value = k;
    HANDS.pose('R', 'thumbsUp', Math.min(1, k * 1.5));
    if (k < 0.002) return;
    const nod = tS < 1.6 ? 16 * Math.sin(Math.PI * tS / 0.8) ** 2 : 0, smug = ss(1.2, 2.0, tS);
    inBody(head, qR.setFromEuler(eu.set(8 * smug * k * d2r, 0, (6 * smug - nod) * k * d2r, 'YZX')).clone());
    outer.updateMatrixWorld(true);
    // 右手：拳头举到头侧（化身坐标：比头骨前 0.12、高 0.2、往右 0.26）→ 肘朝外下、小臂竖起来，掌心朝里 → 大拇指朝天；一下一下往上顶
    head.getWorldPosition(tgt); outer.worldToLocal(tgt).add(new THREE.Vector3(0.12, 0.2 + 0.03 * Math.sin(tS * 7) * k, 0.26));
    HANDS.reach('R', outer.localToWorld(tgt), k, [0, 0, -1]);
  };
}
