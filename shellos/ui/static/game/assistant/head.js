// J 线 · 助理的头：低多边形头型（平面着色、哑光，和峰哥一个画风）+ canvas 手绘的脸（不用照片）+ 深棕低多边形头发 + 高马尾。
//   脸按正前方正投影贴在前半球（后半球 uv 指到纹理角落 = 肤色）；头发是几片平面着色的壳和发片；马尾是一串枢轴（ponytail.pivots），
//   第 4 轮用 Verlet 甩动。全部按绑定姿态摆好挂到头骨（Skeleton_neck_joint_2）上，A2 转头时跟着走。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

export const HEAD = { r: [0.094, 0.117, 0.087], skin: '#f2cdb4', hair: '#2b211d', band: '#2f7fe0' };   // 前后 / 上下 / 左右半径（米）

// 脸：干练的职业妆——杏仁眼（深棕虹膜 + 高光）、上眼线带一点小翘、双眼皮褶线、柔和的眉、小鼻、浅笑的唇、很淡的腮红。
//   纹理 u 从观众左到右（= 她的右到左），v 从下到上。
export function faceTexture(size = 256) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d'); g.scale(size / 256, size / 256);
  g.fillStyle = HEAD.skin; g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(235,140,140,0.22)';                                  // 腮红
  for (const x of [80, 176]) { g.beginPath(); g.ellipse(x, 172, 20, 11, 0, 0, Math.PI * 2); g.fill(); }
  const eye = (cx, dir) => {
    g.save(); g.translate(cx, 138);
    g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(0, 0, 19, 11.5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#5a3a28'; g.beginPath(); g.arc(0, 1, 10.5, 0, Math.PI * 2); g.fill();          // 虹膜
    g.fillStyle = '#24160f'; g.beginPath(); g.arc(0, 1.5, 5, 0, Math.PI * 2); g.fill();           // 瞳孔
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(-3.5 * dir, -3, 3, 0, Math.PI * 2); g.fill();  // 高光
    g.fillStyle = HEAD.skin; g.beginPath(); g.moveTo(-24, -20); g.lineTo(24, -20); g.lineTo(22, -9); g.quadraticCurveTo(0, -15, -22, -9); g.closePath(); g.fill();
    g.strokeStyle = '#231a17'; g.lineCap = 'round'; g.lineWidth = 4.5;                             // 上眼线 + 外眼角小翘
    g.beginPath(); g.moveTo(-20 * dir, -3); g.quadraticCurveTo(0, -14, 19 * dir, -7); g.lineTo(25 * dir, -11); g.stroke();
    g.lineWidth = 1.4; g.beginPath(); g.moveTo(-15 * dir, -12); g.quadraticCurveTo(0, -21, 16 * dir, -14); g.stroke();   // 双眼皮褶线
    g.strokeStyle = '#6b4a3c'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(-14 * dir, 10); g.quadraticCurveTo(0, 14, 15 * dir, 8); g.stroke();   // 下眼线
    g.restore();
  };
  eye(90, -1); eye(166, 1);
  g.strokeStyle = '#3b2b24'; g.lineWidth = 4; g.lineCap = 'round';                         // 眉：柔和的弧
  g.beginPath(); g.moveTo(108, 111); g.quadraticCurveTo(88, 101, 68, 109); g.stroke();
  g.beginPath(); g.moveTo(148, 111); g.quadraticCurveTo(168, 101, 188, 109); g.stroke();
  g.strokeStyle = '#d6a08c'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(126, 160); g.quadraticCurveTo(124, 170, 130, 172); g.stroke();   // 鼻
  g.fillStyle = '#c9606a'; g.beginPath(); g.moveTo(114, 192); g.quadraticCurveTo(128, 186, 142, 192); g.quadraticCurveTo(128, 202, 114, 192); g.fill();   // 唇
  g.strokeStyle = '#a24a54'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(113, 191); g.quadraticCurveTo(128, 196, 143, 190); g.stroke();   // 浅笑的唇线
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

const mat = (color, o = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, emissive: color, emissiveIntensity: 0.22, ...o });

// av = loadAvatar 出来的化身（绑定姿态、group 还没动）。返回 { ponytail: { root, pivots, lens } }
export function buildHead(av) {
  const head = av.bones['Skeleton_neck_joint_2']; if (!head) return null;
  av.group.updateMatrixWorld(true);
  const [rx, ry, rz] = HEAD.r, c = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.006, ry * 0.7, 0));
  // ① 头型：二十面体细分 2 次（320 面），下半截收成尖一点的下巴；前半球给脸的 uv
  const hg = new THREE.IcosahedronGeometry(1, 2), P = hg.attributes.position;
  const uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    let x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    if (y < 0) { z *= 1 - 0.34 * -y; x *= 1 - 0.1 * -y; }
    P.setXYZ(i, x * rx, y * ry, z * rz);
    if (x > 0.05) { uv[2 * i] = 0.5 - z * 0.54; uv[2 * i + 1] = 0.5 + y * 0.51; } else { uv[2 * i] = 0.02; uv[2 * i + 1] = 0.02; }   // 模型朝 +X、左 = −Z
  }
  hg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); hg.translate(c.x, c.y, c.z); hg.computeVertexNormals();
  const face = new THREE.Mesh(hg, mat('#ffffff', { map: faceTexture(), emissive: '#000000', emissiveIntensity: 0 }));
  face.material.onBeforeCompile = sh => {                     // 脸也要自发光打底（emissive 不能乘贴图，这里在片元里补）
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.24;');
  };
  face.material.customProgramCacheKey = () => 'asst-face';
  face.name = 'assistantHead';
  // ② 头发：发帽（前面到发际线，后面 / 两侧盖到耳下）+ 斜刘海三片 + 两侧鬓发
  const hair = [], put = (geo, p, rot, s) => { geo.applyMatrix4(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0]))), s || new THREE.Vector3(1, 1, 1))); return geo; };
  const cap = (t0, t1, p0, p1) => put(new THREE.SphereGeometry(1, 12, 5, p0, p1, t0, t1 - t0), c, null, new THREE.Vector3(rx * 1.08, ry * 1.06, rz * 1.12));
  hair.push(cap(0, 1.12, 0, Math.PI * 2));
  hair.push(cap(1.12, 2.1, -Math.PI / 2 - 0.55, Math.PI + 1.1));        // phi 0 = 后脑
  for (let k = 0; k < 3; k++) {                                          // 斜刘海：从她的右边梳向左边，三片扁楔
    const a = -0.5 + k * 0.42, len = 0.07 - k * 0.012;
    const w = new THREE.ConeGeometry(0.032, len, 3); w.rotateX(Math.PI); w.translate(0, -len / 2, 0);
    hair.push(put(w, c.clone().add(new THREE.Vector3(Math.cos(a) * rx * 1.0, ry * 0.5, -Math.sin(a) * rz * 1.05)), [0.5, 0, -0.45], new THREE.Vector3(1.2, 1, 0.5)));
  }
  for (const sd of [-1, 1]) {                                            // 鬓发
    const w = new THREE.ConeGeometry(0.018, 0.12, 3); w.rotateX(Math.PI); w.translate(0, -0.06, 0);
    hair.push(put(w, c.clone().add(new THREE.Vector3(rx * 0.5, ry * 0.2, sd * rz * 1.03)), [sd * 0.12, 0, -0.1], new THREE.Vector3(1, 1, 0.55)));
  }
  const hairM = mat(HEAD.hair, { emissiveIntensity: 0.12 });
  const hairMesh = new THREE.Mesh(mergeGeometries(hair.map(x => x.index ? x.toNonIndexed() : x)), hairM); hairMesh.name = 'assistantHair';
  // ③ 高马尾：头顶偏后扎起（钴蓝发圈），一串枢轴：每节挂在上一节的末端，网格朝 −Y 垂下；静止时从扎的地方往后一点再垂下来（跑起来靠第 4 轮的 Verlet 往后甩）
  const root = new THREE.Object3D(); root.position.copy(c).add(new THREE.Vector3(-rx * 0.82, ry * 0.72, 0)); root.name = 'ponytail';
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.009, 5, 10), mat(HEAD.band)); band.rotation.z = 0.9; root.add(band);
  const lens = [0.05, 0.08, 0.09, 0.08], radii = [0.044, 0.042, 0.034, 0.022, 0.006], rest = [-1.6, 0.9, 0.5, 0.3], pivots = [];
  let parent = root;
  for (let k = 0; k < lens.length; k++) {
    const pv = new THREE.Object3D(); pv.rotation.z = rest[k];
    if (k) pv.position.set(0, -lens[k - 1], 0);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radii[k], radii[k + 1], lens[k], 5).translate(0, -lens[k] / 2, 0), hairM);
    pv.add(m); parent.add(pv); pivots.push(pv); parent = pv;
  }
  for (const m of [face, hairMesh, root]) { m.traverse(o => { o.frustumCulled = false; }); head.attach(m); }
  return { ponytail: { root, pivots, lens, rest } };
}
