// P 线：峰哥的比例。loadAvatar 之后改 CesiumMan 骨骼的静止位置（avatar.js 不动）：只挪位置，不转、不缩放，骨骼名 / 层级 / 静止朝向都不变，
//   A2 的动作（每帧从静止朝向转骨头）照用。CesiumMan 的网格由 body.js 换掉，所以不用重算它的蒙皮；外骨骼件是挂在骨头上的，
//   关节挪了它们跟着走，只有大腿 / 小腿的连杆要沿骨头方向拉长。
// 每项 = 这一节骨头（父关节 → 本关节）长度的倍数；shoulderW = 上臂根离中线的倍数；shoulderUp = 上臂根抬高（米）；骨盆自动抬（脚踝留在原高度）。
//   峰哥本人：偏瘦、肩窄、头身比约 1:6.5（头 0.23 m），腿比 CesiumMan 长（髋关节 42% → 约 47% 身高），脖子短一点。
//   ?shape=leg:1.2,neck:0.8 逐项覆盖（截图对比用）
import * as THREE from 'three';

export const SHAPE = { leg: 1.24, shin: 1.12, spine: 1, chest: 1, neck: 0.8, shoulderW: 1.7, shoulderUp: -0.005, arm: 1.1, forearm: 1.06 };   // shoulderW 1.7 = 上臂根离中线约 0.153 m（肩关节，不是肩宽）：再窄手臂就埋进躯干

export function currentShape() {
  const S = { ...SHAPE }, q = new URLSearchParams(location.search).get('shape');
  if (q) for (const kv of q.split(',')) { const [k, v] = kv.split(':'); if (k in S && isFinite(+v)) S[k] = +v; }
  return S;
}

// 在化身还没摆姿势、group 还没移动 / 旋转的时候调（dressFengge 开头）
export function reshape(av, S = currentShape()) {
  const B = av.bones, outer = av.group, V = () => new THREE.Vector3(), m = new THREE.Matrix4(), a = V(), b = V();
  const wp = n => B[n].getWorldPosition(V());
  const len = (n, k) => { if (B[n] && k !== 1) B[n].position.multiplyScalar(k); };
  const lift = (n, dy) => { const o = B[n]; if (!o || !dy) return; m.copy(o.parent.matrixWorld).invert(); o.position.add(b.set(0, dy, 0).applyMatrix4(m).sub(a.set(0, 0, 0).applyMatrix4(m))); };
  outer.updateMatrixWorld(true);
  const ank0 = wp('leg_joint_L_3').y;
  // 外骨骼连杆：挂在髋骨（大腿杆）/ 膝骨（小腿杆）上的 exo 网格，沿骨头方向（骨头原点 → 子关节）拉长同样的倍数
  const stretch = (bone, child, k) => {
    if (!bone || !child || k === 1) return;
    const ax = child.position.clone().normalize();                          // 骨头局部坐标里的骨头方向
    for (const o of bone.children) if (o.isMesh && o.name === 'exo') {
      const P = o.geometry.attributes.position, mi = o.matrix.clone().invert(), p = V();
      for (let i = 0; i < P.count; i++) {
        p.fromBufferAttribute(P, i).applyMatrix4(o.matrix);                 // → 骨头局部
        p.addScaledVector(ax, p.dot(ax) * (k - 1)).applyMatrix4(mi);
        P.setXYZ(i, p.x, p.y, p.z);
      }
      P.needsUpdate = true; o.geometry.computeBoundingSphere();
    }
  };
  for (const s of ['L', 'R']) {
    stretch(B[`leg_joint_${s}_1`], B[`leg_joint_${s}_2`], S.leg); stretch(B[`leg_joint_${s}_2`], B[`leg_joint_${s}_3`], S.shin);
    len(`leg_joint_${s}_2`, S.leg); len(`leg_joint_${s}_3`, S.shin);
  }
  len('Skeleton_torso_joint_2', S.spine); len('torso_joint_3', S.chest); len('Skeleton_neck_joint_1', S.neck); len('Skeleton_neck_joint_2', S.neck);
  for (const n of ['Skeleton_arm_joint_L__4_', 'Skeleton_arm_joint_R']) { len(n, S.shoulderW); lift(n, S.shoulderUp); }
  len('Skeleton_arm_joint_L__3_', S.arm); len('Skeleton_arm_joint_R__2_', S.arm); len('Skeleton_arm_joint_L__2_', S.forearm); len('Skeleton_arm_joint_R__3_', S.forearm);
  outer.updateMatrixWorld(true);
  lift('Skeleton_torso_joint_1', ank0 - wp('leg_joint_L_3').y);           // 腿变长了：骨盆抬高，脚踝回到原高度
  outer.updateMatrixWorld(true);
  return S;
}
