// 峰哥头：给 loadAvatar() 出来的化身换上峰哥的脸。独立模块，不改 avatar.js：
//   import { dressFengge } from '/game/fengge.js';  const av = await loadAvatar(...);  await dressFengge(av);
// 在 loadAvatar 之后、第一次 pose() 之前调（按绑定姿态量头的大小）；化身已经放进场景也行，但 group 还没旋转 / 缩放（正面按 +X 算）。
// 脸 = 照片正脸（models/fengge_face.jpg，裁自 github.com/w466747380/talk-to-fengge-live 的 avatar.png，MIT），
//   贴在椭球头正面一片上，边缘羽化进肤色底；后脑勺黑发；顶上深灰毛线帽（照片里就戴着）。
// 原来的头盔（CesiumMan 的圆角方头，比椭球大，角会戳出来）：把主要跟头骨走的顶点塌成一个点（改的是这个化身自己那份几何），
//   面罩 + 亮缝藏掉。头骨本身不缩——主题还会往头骨上挂东西（富士山的头灯）。
// 头的大小按「主要权重在头骨上」的顶点量（按 z 高度切会漏掉下半个头）；shape = 宽 / 深 / 高 相对原头盔的比例。
// 侧面 / 背面没有照片，是纯色——镜头别绕到正侧面。
// 主题往头上挂东西：av.group.userData.fengge.lamp = 帽檐正前方（头骨局部坐标），有它就说明换了峰哥头。
import * as THREE from 'three';

export const FENGGE_LOOK = { skin: '#b98d74', hair: '#17130f', beanie: '#3b3c3f', cuff: '#2f3033',
  shape: [0.8, 1.05, 1.0], faceK: 1.02, faceGlow: 0.35 };

let texP = null;
function faceTexture() {                   // 照片 → 椭圆羽化边（destination-in 径向渐变），只做一次
  return texP || (texP = new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const W = img.width, H = img.height, cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const x = cv.getContext('2d');
      x.drawImage(img, 0, 0);
      x.globalCompositeOperation = 'destination-in';
      x.translate(W / 2, H * 0.5); x.scale(1, H / W);
      const g = x.createRadialGradient(0, 0, W * 0.3, 0, 0, W * 0.5);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(-W, -W, 2 * W, 2 * W);
      const t = new THREE.CanvasTexture(cv);
      t.colorSpace = THREE.SRGBColorSpace;
      res(t);
    };
    img.onerror = rej;
    img.src = '/models/fengge_face.jpg';
  }));
}

export async function dressFengge(av, look = {}) {
  const L = { ...FENGGE_LOOK, ...look };
  const head = av.bones['Skeleton_neck_joint_2'];
  let mesh = null; av.group.traverse(o => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  if (!head || !head.parent || !mesh) return false;
  av.group.updateMatrixWorld(true);
  const hi = mesh.skeleton.bones.indexOf(head), G = mesh.geometry.attributes, v = new THREE.Vector3(), bb = new THREE.Box3(), mine = [];
  for (let i = 0; i < G.position.count; i++) {
    let w = 0; for (let k = 0; k < 4; k++) if (G.skinIndex.getComponent(i, k) === hi) w += G.skinWeight.getComponent(i, k);
    if (w > 0) mine.push(i);                                                // 塌掉：沾一点头骨权重的都算（否则脖子一圈碎片戳出来）
    if (w > 0.5) { mesh.getVertexPosition(i, v); bb.expandByPoint(mesh.localToWorld(v)); }   // 量大小：主要跟头骨走的
  }
  if (bb.isEmpty()) return false;
  const tex = await faceTexture();
  // 世界坐标（group 未旋转时 = group 局部）：+X 正面、+Y 上、Z 宽度。椭球顶和原头顶齐平
  const R = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const rx = R.x * L.shape[1], ry = R.y * L.shape[2], rz = R.z * L.shape[0];
  const c = bb.getCenter(new THREE.Vector3()).setY(bb.max.y - ry);
  const lit = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });
  // 球面片：phi = π 是 +X（正面，同 avatar.js）；theta 从头顶量。u 沿 phi、v 沿 theta，照片不镜像（观众左 = +Z）
  const part = (k, mat, phi0 = 0, phiL = Math.PI * 2, th0 = 0, th1 = Math.PI, seg = 32) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, seg, 16, phi0, phiL, th0, th1 - th0), mat);
    m.position.copy(av.group.worldToLocal(c.clone())); m.scale.set(rx * k, ry * k, rz * k);
    m.name = 'fengge'; m.frustumCulled = false;
    av.group.add(m); head.attach(m);                                        // 世界变换不变地挂到头骨上，之后跟着动
    return m;
  };
  part(1, lit(L.skin, { emissive: L.skin, emissiveIntensity: L.faceGlow }));   // 肤色底：和脸一样带点自发光，夜景里脸外圈不发青
  part(1.03, lit(L.hair), -1.1, 2.2, 0.6, 1.95);                           // 后脑勺头发
  part(L.faceK, new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.85, metalness: 0,
    emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: L.faceGlow }),   // 夜景里脸也看得清
    Math.PI - 0.8, 1.6, 0.85, 2.55);                                          // 横 1.6 / 竖 1.7 弧度 ≈ 照片 272×384 的比例，正面看不拉伸
  part(1.06, lit(L.beanie), 0, Math.PI * 2, 0, 0.88);                       // 毛线帽
  part(1.09, lit(L.cuff), 0, Math.PI * 2, 0.72, 0.95);                     // 帽檐翻边，压住照片顶上那截帽子
  const o = new THREE.Vector3(); for (const i of mine) o.add(v.fromBufferAttribute(G.position, i)); o.divideScalar(mine.length);
  for (const i of mine) {                                                   // 塌到原头盔的质心（在新椭球里面）；权重全给头骨（留一点给手臂的顶点会被甩成长刺）
    G.position.setXYZ(i, o.x, o.y, o.z); G.skinIndex.setXYZW(i, hi, 0, 0, 0); G.skinWeight.setXYZW(i, 1, 0, 0, 0);
  }
  G.position.needsUpdate = G.skinIndex.needsUpdate = G.skinWeight.needsUpdate = true; mesh.geometry.computeBoundingSphere();
  for (const x of head.children) if (x.name === 'exo') x.visible = false;   // 面罩 + 亮缝
  // 给主题挂头灯用（头骨局部坐标）：帽檐正前方。富士山的头灯按旧头盔摆，会落在峰哥嘴上——主题有这个就用这个
  const lamp = head.worldToLocal(new THREE.Vector3(rx * 1.09 * Math.sin(0.83) + 0.02, ry * 1.09 * Math.cos(0.83), 0).add(c));
  av.group.userData.fengge = { lamp };
  av.fengge = true;
  return true;
}
