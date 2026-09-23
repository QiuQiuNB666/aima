// 峰哥：给 loadAvatar() 出来的化身换上峰哥的头和户外穿搭。独立模块，avatar.js 不用改：
//   import { dressFengge } from '/game/fengge.js';  const av = await loadAvatar(...);  await dressFengge(av);
// 在 loadAvatar 之后、第一次 pose()/animate() 之前调（按绑定姿态摆）；group 还没旋转 / 缩放（正面 = +X）。
// 骨骼一根没加没改（名字、层级、绑定姿态都是 CesiumMan 原样）→ A2 的动作照常用；头 / 帽 / 头发挂在 Skeleton_neck_joint_2，
//   围脖挂在 Skeleton_neck_joint_1，A2 转头时跟着走。
// 头 v2（P 线）：几何头型 = 放样（每层一个左右宽 W、前后深 Zf/Zb 的截面，从下巴到头顶 40 层）+ 脸部起伏（鼻梁 / 鼻翼 / 眼窝 / 眉弓 /
//   颧骨 / 嘴唇 / 下巴带胡子），单位 = 参考照片的像素（原图 675×1200，两眼中点 = 原点，y 向上，z 朝前），最后整体缩到 headH 米。
//   照片（models/fengge_face_hd.jpg，裁自 github.com/w466747380/talk-to-fengge-live 的 avatar.png，MIT）按正前方正投影贴上去：
//   几何的五官位置就是照片里的五官位置，所以不用对齐；侧面（转开 60° 以上）照片淡出成肤色 / 胡茬，不会被拉成条。
//   针织帽 = 翻边 + 帽身，罗纹针脚是 canvas 画的（贴图 + 凹凸）；头发 = 帽子下面两侧和后脑往外蓬的一圈发片（照片里就是这样）。
// 衣服：化身原材质（avatar.js 的分区材质）外面再包一层：深灰速干衣 + 胸前 / 背后青色竖条纹拼色（参考照片的户外打底衫，不带 logo）、
//   袖口青色一圈、手套、深色长裤、登山鞋；身材沿法线鼓 0.4–1.2 cm（CesiumMan 太瘦）；黑色抓绒围脖（照片里就有）盖住脖口。
// 开销（东京 pos 18）：+2 次绘制、+1.1 万三角形（头 5.8k、帽 3k、头发 1.9k、围脖 0.6k），贴图 = 400×540 照片 + 两张 128² canvas。
// 主题往头上挂东西：av.group.userData.fengge.lamp = 帽檐正前方（头骨局部坐标），有它就说明换了峰哥头。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

export const FENGGE_LOOK = {
  skin: '#d29a84', beard: '#4a3a32', hair: '#2e2622', beanie: '#5a5c61', gaiter: '#1e1f22',   // 肤色 / 胡茬 / 帽子按参考照片取样
  fleece: '#34373d', pants: '#25282d', teal: '#27a9b8', glove: '#1d1f23', shoe: '#4a4038', sole: '#9b948a',
  headH: 0.25,             // 下巴到头顶（米，不算帽子）；身高 1.46 的约 1/5.8，比真人大一点：正面镜头 2.4 m 外脸才认得出
  faceGlow: 0.32, rimK: 0.35,           // rimK = 头部件轮廓光占化身轮廓光的比例（深色帽子 / 头发整片被照亮就不像头发了）
};

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
  if (face && c > 0) z += relief(x, y) * ss(0, 0.45, c);
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

// 衣服：包一层化身的分区材质（avatar.js 里 `diffuseColor.rgb *= zc;` 之前把 zc 换成衣服颜色）。坐标 = 绑定姿态：x 前、y 左、z 上（米）
function dressClothes(mat, L) {
  const ob = mat.onBeforeCompile, U = mat.userData.look;
  if (!ob || !U) return;
  U.uBody.value.set(L.fleece); U.uLeg.value.set(L.pants);
  const C = { uTeal: { value: new THREE.Color(L.teal) }, uGlove: { value: new THREE.Color(L.glove) }, uShoe: { value: new THREE.Color(L.shoe) },
    uSole: { value: new THREE.Color(L.sole) }, uGaiter: { value: new THREE.Color(L.gaiter) } };
  mat.onBeforeCompile = (sh, r) => {
    ob.call(mat, sh, r);
    Object.assign(sh.uniforms, C);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBP, vBN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBP = position; vBN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('pow(fr, 2.2) * uRimK', 'pow(fr, 2.6) * uRimK * 0.45')   // 深色衣服上轮廓光显得太亮，压一点
      .replace('#include <common>', '#include <common>\nvarying vec3 vBP, vBN;\nuniform vec3 uTeal, uGlove, uShoe, uSole, uGaiter;')
      .replace('diffuseColor.rgb *= zc;', `{
        vec3 bn = normalize(vBN); float ay = abs(vBP.y), z = vBP.z;
        float torso = step(ay, 0.2) * step(0.8, z);
        // 胸前 / 背后的青色竖条纹拼色：领口往下，下沿是 V 字（中间低、两边高）
        float yoke = torso * smoothstep(0.15, 0.4, abs(bn.x)) * step(ay, 0.17) * smoothstep(-0.006, 0.006, z - 0.925 - 0.5 * ay);
        float rib = 0.62 + 0.38 * smoothstep(-0.4, 0.4, sin(vBP.y * 520.0));
        zc = mix(zc, uTeal * rib, yoke);
        zc = mix(zc, uGaiter, torso * smoothstep(1.085, 1.1, z));                           // 领口（围脖盖住的地方）
        float arm = step(0.21, ay) * step(0.7, z);
        zc = mix(zc, uTeal, arm * step(0.93, dot(bn, normalize(vec3(0.0, sign(vBP.y) * 0.55, 0.85)))) * step(ay, 0.46));   // 袖子外侧一道青线
        zc = mix(zc, uTeal, arm * step(0.462, ay) * step(ay, 0.485));                       // 袖口
        zc = mix(zc, uGlove, arm * step(0.485, ay));                                        // 手套
        zc = mix(zc, uShoe, step(z, 0.095)); zc = mix(zc, uSole, step(z, 0.022));            // 登山鞋
      }
      diffuseColor.rgb *= zc;`);
  };
  mat.customProgramCacheKey = () => 'fengge-clothes';
  mat.needsUpdate = true;
}

export async function dressFengge(av, look = {}) {
  const L = { ...FENGGE_LOOK, ...look };
  const head = av.bones['Skeleton_neck_joint_2'], neck = av.bones['Skeleton_neck_joint_1'];
  let mesh = null; av.group.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  if (!head || !neck || !mesh) return false;
  const photo = await faceTexture();
  av.group.updateMatrixWorld(true);
  const U = mesh.material.userData.look || {};
  dressClothes(mesh.material, L);

  // 原来的头盔：沾一点头骨权重的顶点都塌到「脖口」中心（和它们相连的躯干顶点的中心），权重全给脖子骨 → 脖口封成一个平盖，
  //   藏在围脖里。塌到头中心的话，肩膀到头中心会拉出一个锥（v2 第一版就是这样）。面罩 + 亮缝藏掉
  const hi = mesh.skeleton.bones.indexOf(head), ni = mesh.skeleton.bones.indexOf(neck), GA = mesh.geometry.attributes, v = new THREE.Vector3();
  const hw = new Float32Array(GA.position.count), IX = mesh.geometry.index.array, ring = new Set();
  for (let i = 0; i < hw.length; i++) for (let k = 0; k < 4; k++) if (GA.skinIndex.getComponent(i, k) === hi) hw[i] += GA.skinWeight.getComponent(i, k);
  for (let t = 0; t < IX.length; t += 3) { const a = [IX[t], IX[t + 1], IX[t + 2]]; if (a.some(i => hw[i] > 0)) for (const i of a) if (!hw[i]) ring.add(i); }
  const o = new THREE.Vector3(); for (const i of ring) o.add(v.fromBufferAttribute(GA.position, i)); o.divideScalar(ring.size || 1);
  for (let i = 0; i < hw.length; i++) if (hw[i] > 0) { GA.position.setXYZ(i, o.x, o.y, o.z); GA.skinIndex.setXYZW(i, ni, 0, 0, 0); GA.skinWeight.setXYZW(i, 1, 0, 0, 0); }
    else {                                                 // 身材：CesiumMan 太瘦，衣服往外鼓一点（抓绒上衣 1.2 cm、袖子 0.8 cm、裤子 0.4 cm，沿法线）
      const z = GA.position.getZ(i), d = Math.abs(GA.position.getY(i)) > 0.21 ? 0.008 : 0.004 + 0.008 * ss(0.78, 0.84, z);
      v.fromBufferAttribute(GA.normal, i); GA.position.setXYZ(i, GA.position.getX(i) + v.x * d, GA.position.getY(i) + v.y * d, z + v.z * d);
    }
  GA.position.needsUpdate = GA.skinIndex.needsUpdate = GA.skinWeight.needsUpdate = true; mesh.geometry.computeBoundingSphere();
  for (const x of head.children) if (x.name === 'exo') x.visible = false;

  // 头组：像素单位 → 米（S），照片坐标（x 右、z 前）转到化身（+X 前、−Z 右）= 绕 Y 转 +90°；下巴底在头骨关节下方 1 cm（CesiumMan 脖子长，按原位置放像长颈鹿）
  const S = L.headH / (Y1 - Y0), N = av.group.worldToLocal(head.getWorldPosition(new THREE.Vector3()));
  const H = new THREE.Group(); H.name = 'fengge';
  H.scale.setScalar(S); H.rotation.y = Math.PI / 2; H.position.set(N.x - ZC * S, N.y - 0.01 - Y0 * S, N.z);
  const add = (geo, mat, name) => { const m = new THREE.Mesh(geo, mat); m.name = name; m.frustumCulled = false; H.add(m); return m; };

  // ① 头：40 层 × 72 列；每个顶点带 照片权重（正面才贴）、胡茬权重
  const skin = new THREE.Color(L.skin), beard = new THREE.Color(L.beard), hairC = new THREE.Color(L.hair).multiplyScalar(0.6), col = new THREE.Color(), p = new THREE.Vector3();
  const { g: hg, X: hx } = grid(72, 40, (u, t) => {
    const y = Y0 + (Y1 - Y0) * t, phi = (u - 0.5) * 2 * Math.PI; headAt(y, phi, p);
    const b = ss(-140, -205, y) * ss(-0.35, 0.25, Math.cos(phi)), nape = ss(-0.1, -0.4, Math.cos(phi)) * ss(-60, -120, y);   // 后脑下半 = 头发色（发片底下露出来的地方）
    return [p.x, p.y, p.z, (p.x + EYE[0] - CROP[0]) / CROP[2], 1 - (EYE[1] - p.y - CROP[1]) / CROP[3], b, ss(0.2, 0.5, Math.cos(phi)), nape];
  }, true);                                                // 照片权重按「没加起伏的头」的朝向算：鼻子侧面照样贴照片
  const nrm = hg.attributes.normal, cnt = nrm.count, aPhoto = new Float32Array(cnt), aBeard = new Float32Array(cnt), cols = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) {
    aPhoto[i] = hx[3 * i + 1]; aBeard[i] = hx[3 * i];
    col.copy(skin).lerp(beard, 0.8 * hx[3 * i]).lerp(hairC, hx[3 * i + 2]); cols.set([col.r, col.g, col.b], i * 3);
  }
  hg.setAttribute('aPhoto', new THREE.BufferAttribute(aPhoto, 1)); hg.setAttribute('aBeard', new THREE.BufferAttribute(aBeard, 1));
  hg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  add(hg, tune(new THREE.MeshStandardMaterial({ map: photo, vertexColors: true, roughness: 0.72, metalness: 0 }), U, 'head', L.rimK * 0.3, L.faceGlow, sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aPhoto, aBeard;\nvarying float vPhoto, vBeard;\nvarying vec3 vHP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPhoto = aPhoto; vBeard = aBeard; vHP = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vPhoto, vBeard;\nvarying vec3 vHP;')
      .replace('#include <map_fragment>', `vec4 ph = texture2D(map, vMapUv);
        diffuseColor.rgb = mix(diffuseColor.rgb, ph.rgb, ph.a * vPhoto);
        float gn = fract(sin(dot(floor(vHP * 0.5), vec3(12.9898, 78.233, 37.719))) * 43758.5453);   // 胡茬颗粒（约 1 mm）
        diffuseColor.rgb *= 1.0 - vBeard * (1.0 - ph.a * vPhoto) * 0.45 * gn;`);
  }), 'fenggeHead');

  // ② 针织帽：帽檐线 = 前额 +120（照片里的帽檐）、两侧压到耳朵上方 −35、后脑 −20；翻边 64 px + 帽身，顶上略鼓、往后塌一点
  const edge = phi => { const c = Math.cos(phi); return -35 + 155 * Math.pow(Math.max(0, c), 1.6) + 15 * Math.max(0, -c); };
  const knit = knitTexture();                               // 翻边和帽身合成一个网格（针脚密度写进 uv）：少一次绘制
  const cuffP = [[-6, 1.0], [-3, 1.1], [8, 1.135], [56, 1.13], [64, 1.1], [66, 1.075]];   // 翻边截面：[帽檐线上方多少 px, 往外放多少]
  const { g: cg } = grid(72, cuffP.length - 1, (u, t) => {
    const phi = (u - 0.5) * 2 * Math.PI, [dy, k] = cuffP[Math.round(t * (cuffP.length - 1))];
    headAt(Math.min(Y1 - 30, edge(phi) + dy), phi, p, k, false);
    return [p.x, p.y, p.z, u * 15, dy / 64];
  }, true);
  const { g: bg } = grid(72, 16, (u, t) => {
    const phi = (u - 0.5) * 2 * Math.PI, y0 = edge(phi) + 60, y = y0 + (Y1 - y0) * t, back = Math.max(0, -Math.cos(phi));
    headAt(Math.min(y, Y1), phi, p, 1.075 + 0.03 * Math.sin(Math.PI * t), false);
    p.y += 26 * t * t; p.z -= 22 * t * t * back;
    return [p.x, p.y, p.z, u * 13, t * 1.8];
  }, true);
  add(mergeGeometries([cg, bg]), tune(new THREE.MeshStandardMaterial({ color: L.beanie, map: knit, bumpMap: knit, bumpScale: 2.2, roughness: 1, metalness: 0 }), U, 'beanie', L.rimK, 0.12), 'fenggeBeanie');

  // ③ 头发：帽子底下两侧 + 后脑，从脸侧（φ = ±62°）绕到后面；越往下越往外蓬（照片里两边头发撑出脸外约 70 px），发尾长短不齐
  const hairMat = tune(new THREE.MeshStandardMaterial({ color: L.hair, map: hairTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0 }), U, 'hair', L.rimK * 0.3, 0.06);
  const P0 = 62 * Math.PI / 180;
  const hairLayer = (len, k0, flare, du) => grid(48, 10, (u, t) => {  // 两层：里层长、外层短一点更蓬，发尾错开才有厚度
    const phi = P0 + (2 * Math.PI - 2 * P0) * u, side = Math.abs(Math.sin(phi)), front = ss(P0 + 0.5, P0, Math.min(phi, 2 * Math.PI - phi));
    const y = 45 - (300 - 12 * side) * len * t, k = k0 + (0.34 * side + 0.16) * flare * t * t * (1 - 0.5 * front);
    headAt(Math.max(y, Y0 + 60), phi, p, k, false); if (y < Y0 + 60) p.y = y;
    return [p.x, p.y, p.z, u * 7 + du, t];
  }).g;
  add(mergeGeometries([hairLayer(1, 1.035, 1, 0), hairLayer(0.82, 1.06, 1.25, 0.37)]), hairMat, 'fenggeHair');

  av.group.add(H); head.attach(H);                         // 世界变换不变地挂到头骨上

  // ④ 围脖（照片里的黑色抓绒围脖）：脖子一圈，下面埋进衣领，上沿到胡子下面；挂在脖子骨上，转头不带着它转
  const nk = av.group.worldToLocal(neck.getWorldPosition(new THREE.Vector3()));
  const gaiter = tune(new THREE.MeshStandardMaterial({ color: L.gaiter, map: knit, roughness: 1, metalness: 0 }), U, 'gaiter', L.rimK, 0.1);
  // [高度（相对脖子骨）, 半径, 前后中心]：底下堆在肩上、盖住 CesiumMan 的脖口（直径约 17 cm、中心偏后 4 cm），往上收到脖子粗细，上沿翻一圈
  const gP = [[-0.1, 0.108, -0.036], [-0.065, 0.1, -0.03], [-0.035, 0.08, -0.012], [0, 0.066, 0.004], [0.025, 0.064, 0.01], [0.044, 0.069, 0.012], [0.054, 0.065, 0.012], [0.06, 0.05, 0.01]];
  const { g: gg } = grid(40, gP.length - 1, (u, t) => {
    const j = Math.round(t * (gP.length - 1)), [h, r0, cx] = gP[j], a = u * 2 * Math.PI, fr = Math.cos(a);
    const r = r0 * (1 + (j > 0 && j < gP.length - 1 ? 0.035 * Math.sin(7 * a + j * 1.9) : 0));   // 堆起来的褶
    return [nk.x + cx + fr * r, nk.y + h - (h > 0.04 ? 0.02 * Math.max(0, fr) : 0), nk.z + Math.sin(a) * r, u * 14, t * 3];
  }, true);
  const gm = new THREE.Mesh(gg, gaiter); gm.name = 'fenggeGaiter'; gm.frustumCulled = false;
  av.group.add(gm); neck.attach(gm);

  // 给主题挂头灯用（头骨局部坐标）：帽檐翻边正前方
  const lamp = head.worldToLocal(H.localToWorld(headAt(edge(0) + 34, 0, new THREE.Vector3(), 1.16, false)));
  av.group.userData.fengge = { lamp };
  av.fengge = true;
  return true;
}
