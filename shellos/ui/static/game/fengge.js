// 峰哥头：给 loadAvatar() 出来的化身换上峰哥的脸。独立模块，不改 avatar.js：
//   import { dressFengge } from '/game/fengge.js';  const av = await loadAvatar(...);  await dressFengge(av);
// 在 loadAvatar 之后、第一次 pose() 之前调（按绑定姿态量头的大小）；化身已经放进场景也行，但别缩放 group。
// 脸 = 照片正脸（models/fengge_face.jpg，裁自 github.com/w466747380/talk-to-fengge-live 的 avatar.png，MIT），
//   贴在头部正面一片球面上，边缘羽化进肤色底；后脑勺黑发；顶上深灰毛线帽（照片里就戴着）。原来的面罩 + 亮缝藏起来。
// 侧面 / 背面没有照片，是纯色——镜头别绕到正侧面。
import * as THREE from 'three';

export const FENGGE_LOOK = { skin: '#b98d74', hair: '#17130f', beanie: '#3b3c3f', cuff: '#2f3033', faceK: 1.075 };
const HEAD_Z = 1.30;                       // 和 avatar.js 一致：绑定姿态 z > 脖子 的顶点算头

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
  if (!head || !mesh) return false;
  av.group.updateMatrixWorld(true);
  const P = mesh.geometry.attributes.position, v = new THREE.Vector3(), bb = new THREE.Box3();
  for (let i = 0; i < P.count; i++) if (P.getZ(i) > HEAD_Z) { mesh.getVertexPosition(i, v); bb.expandByPoint(mesh.localToWorld(v)); }
  if (bb.isEmpty()) return false;
  const rx = (bb.max.x - bb.min.x) / 2, rz = (bb.max.z - bb.min.z) / 2;
  const c = new THREE.Vector3((bb.max.x + bb.min.x) / 2, bb.max.y - rx, (bb.max.z + bb.min.z) / 2);
  for (const o of head.children) if (o.name === 'exo') o.visible = false;      // 面罩 + 亮缝

  const tex = await faceTexture();
  const lit = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });
  // 球面片：phi = π 是 +X（正面，同 avatar.js）；theta 从头顶量。u 沿 phi、v 沿 theta，照片不镜像（观众左 = +Z）
  const part = (k, mat, phi0 = 0, phiL = Math.PI * 2, th0 = 0, th1 = Math.PI, seg = 32) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, seg, 16, phi0, phiL, th0, th1 - th0), mat);
    m.position.copy(av.group.worldToLocal(c.clone())); m.scale.set(rx * k, rx * k, rz * k);
    m.name = 'fengge'; m.frustumCulled = false;
    av.group.add(m); head.attach(m);                                        // 世界变换不变地挂到头骨上，之后跟着动
    return m;
  };
  part(1.04, lit(L.skin));                                                  // 肤色底，盖住原来的头盔球
  part(1.07, lit(L.hair), -0.95, 1.9, 0.75, 2.2);                           // 后脑勺头发
  part(L.faceK, new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.85, metalness: 0,
    emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.35 }),       // 夜景里脸也看得清
    Math.PI - 0.95, 1.9, 0.72, 2.5);
  part(1.12, lit(L.beanie), 0, Math.PI * 2, 0, 1.02);                       // 毛线帽
  part(1.15, lit(L.cuff), 0, Math.PI * 2, 0.9, 1.12);                       // 帽檐翻边
  av.fengge = true;
  return true;
}
