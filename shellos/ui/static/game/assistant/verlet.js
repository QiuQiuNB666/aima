// J 线 · 助理的甩动：Verlet 点链（马尾、衣角共用）。第 0 点钉在锚点上（每帧从骨骼读世界坐标），其余点受重力、阻尼，
//   段长约束迭代几遍，再推出几个碰撞球（头、后背）。跑起来锚点往前走，后面的点落后 → 马尾自然往后甩；停下来慢慢垂回去。
// 纯数学、只用 three 的 Vector3；dt 夹到 1/30 s 以内，掉帧也不炸。
import * as THREE from 'three';

export function makeChain(n, lens, { gravity = 9.8, damp = 0.93, iters = 4 } = {}) {
  const p = Array.from({ length: n }, () => new THREE.Vector3()), q = p.map(v => v.clone());   // 当前 / 上一帧
  let init = false;
  const d = new THREE.Vector3();
  return {
    points: p,
    // anchor = 第 0 点的世界坐标；rest(i, out) = 刚开始时第 i 点放哪（世界坐标）；spheres = [{c, r}]
    step(dt, anchor, rest, spheres = []) {
      dt = Math.min(dt, 1 / 30);
      if (!init) { for (let i = 0; i < n; i++) { rest(i, p[i]); q[i].copy(p[i]); } init = true; }
      p[0].copy(anchor); q[0].copy(anchor);
      for (let i = 1; i < n; i++) {                                     // 积分：速度 = 这一帧 − 上一帧，带阻尼
        d.copy(p[i]).sub(q[i]).multiplyScalar(damp);
        q[i].copy(p[i]);
        p[i].add(d); p[i].y -= gravity * dt * dt;
      }
      for (let k = 0; k < iters; k++) {
        for (let i = 1; i < n; i++) {                                   // 段长：第 0 点不动，其余两边各让一半
          d.copy(p[i]).sub(p[i - 1]); const L = d.length() || 1e-6, e = (L - lens[i - 1]) / L;
          if (i === 1) p[i].addScaledVector(d, -e);
          else { p[i].addScaledVector(d, -e * 0.5); p[i - 1].addScaledVector(d, e * 0.5); }
        }
        for (const s of spheres) for (let i = 1; i < n; i++) {           // 碰撞：推出球外
          d.copy(p[i]).sub(s.c); const L = d.length();
          if (L < s.r) p[i].addScaledVector(d, (s.r - L) / (L || 1e-6));
        }
      }
    },
    reset() { init = false; },
  };
}

// 把链的方向写回一串枢轴（每个枢轴的网格朝自己的 −Y 垂下）：第 k 节的 −Y 指向 点 k → 点 k+1
const DOWN = new THREE.Vector3(0, -1, 0), qW = new THREE.Quaternion(), qP = new THREE.Quaternion(), dir = new THREE.Vector3();
export function applyChain(pivots, points) {
  for (let k = 0; k < pivots.length; k++) {
    const pv = pivots[k];
    pv.parent.updateWorldMatrix(true, false);
    dir.copy(points[k + 1]).sub(points[k]).normalize();
    qW.setFromUnitVectors(DOWN, dir);                                   // 这一节要的世界朝向
    pv.parent.getWorldQuaternion(qP).invert();
    pv.quaternion.copy(qP.multiply(qW));
  }
}
