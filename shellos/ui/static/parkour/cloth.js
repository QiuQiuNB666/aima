// 次级运动（第 3 轮）：围脖尾巴、电池包两根背带、背后衣角——每条是一串 Verlet 质点（Jakobsen 2001）：
//   根部钉在骨骼上，受重力 + 空气阻力（人跑得快，阻力把它往后拖），段长约束迭代 3 次。跑起来往后飘，急停往前甩，起跳往下拖、落地往上弹，
//   过冲是物理自己出来的，不用手 K。所有条合成 1 个网格（1 次绘制），每帧重写顶点；带子宽度朝着镜头转（侧面、身后都看得见）。
// 颜色：峰哥自己的衣服 / 外骨骼色（fengge.js 的 FENGGE_LOOK、avatar.js 的外骨骼琥珀），不占路段色。
import * as THREE from 'three';
import { FENGGE_LOOK } from '/game/fengge.js';
import { AVATAR_LOOK } from '/game/avatar.js';

const G = new THREE.Vector3(0, -9.8, 0), FWD = new THREE.Vector3(1, 0, 0);
export const CLOTH = { DRAG: 5.5, ITER: 3, SUB: 1 / 120, FLUTTER: 0.9 };   // 阻力（1/s）、约束迭代、子步长、飘动噪声（m/s²）

export function makeCloth(scene, av) {
  const B = av.bones, outer = av.group;
  outer.updateMatrixWorld(true);
  const W = n => B[n] ? B[n].getWorldPosition(new THREE.Vector3()) : null;
  const hl = W('leg_joint_L_1'), hr = W('leg_joint_R_1'), neck = W('Skeleton_neck_joint_1');
  const c = hl && hr ? hl.clone().add(hr).multiplyScalar(0.5) : new THREE.Vector3(0, 0.8, 0);
  // [骨骼, 绑定姿态世界坐标（模型朝 +X，身后 = −X）, 节数, 段长, 半宽, 根部颜色, 梢部颜色]
  const specs = [
    ['Skeleton_neck_joint_1', neck ? neck.clone().add(new THREE.Vector3(-0.07, -0.02, 0.03)) : c.clone().setY(1.3), 6, 0.075, 0.045, FENGGE_LOOK.gaiter, FENGGE_LOOK.teal],   // 围脖尾巴
    ['Skeleton_torso_joint_1', new THREE.Vector3(c.x - 0.215, c.y + 0.1, c.z + 0.07), 4, 0.07, 0.014, AVATAR_LOOK.exoDark, AVATAR_LOOK.exo],   // 电池包背带 ×2
    ['Skeleton_torso_joint_1', new THREE.Vector3(c.x - 0.215, c.y + 0.1, c.z - 0.07), 4, 0.07, 0.014, AVATAR_LOOK.exoDark, AVATAR_LOOK.exo],
    ['Skeleton_torso_joint_1', new THREE.Vector3(c.x - 0.16, c.y - 0.02, c.z), 3, 0.07, 0.07, FENGGE_LOOK.fleece, FENGGE_LOOK.fleece],   // 背后衣角
  ].filter(s => B[s[0]]);
  const strands = specs.map(([bone, wp, n, seg, hw, c0, c1]) => ({
    bone: B[bone], local: B[bone].worldToLocal(wp.clone()), n, seg, hw, c0: new THREE.Color(c0), c1: new THREE.Color(c1),
    p: Array.from({ length: n }, () => new THREE.Vector3()), q: Array.from({ length: n }, () => new THREE.Vector3()), init: false,
  }));
  const V = strands.reduce((a, s) => a + s.n * 2, 0);
  const pos = new Float32Array(V * 3), col = new Float32Array(V * 3), idx = [];
  let o = 0;
  for (const s of strands) {
    s.o = o;
    for (let i = 0; i < s.n; i++) {
      const k = i / (s.n - 1), cc = s.c0.clone().lerp(s.c1, Math.min(1, k * 1.3));   // 梢部颜色占后一半：夜里深色带子看得见
      for (let j = 0; j < 2; j++) col.set([cc.r, cc.g, cc.b], (o + i * 2 + j) * 3);
      if (i < s.n - 1) { const a = o + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    o += s.n * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: '#222' }));
  mesh.frustumCulled = false; mesh.name = 'cloth';
  scene.add(mesh);
  const A = new THREE.Vector3(), d = new THREE.Vector3(), side = new THREE.Vector3(), toCam = new THREE.Vector3(), tmp = new THREE.Vector3();
  let t = 0;
  return {
    mesh,
    // 每帧：骨骼摆好、group 位置设好之后调。cam = 镜头位置（带子宽度朝它转）
    update(dt, cam, visible = true, fwd = FWD) {             // fwd = 人朝向（第 6 轮起会转弯）
      mesh.visible = visible && outer.visible;
      outer.updateMatrixWorld(true);
      dt = Math.min(dt, 0.1);
      for (const s of strands) {
        A.copy(s.local); s.bone.localToWorld(A);
        if (!s.init || A.distanceTo(s.p[0]) > 3) {                 // 第一次 / 瞬移（掉楼缝复位）：直接挂直
          for (let i = 0; i < s.n; i++) { s.p[i].copy(A).addScaledVector(G, s.seg * i / 9.8); s.q[i].copy(s.p[i]); }
          s.init = true;
        }
        const bx = A.x, bz = A.z;                                  // 不许甩到身体前面去：沿朝向的投影 ≤ 挂点 + 0.02
        for (let n = Math.ceil(dt / CLOTH.SUB), h = dt / n, k = 0; k < n; k++) {
          t += h;
          for (let i = 1; i < s.n; i++) {                          // Verlet：x' = x + (x − x_prev)·(1 − drag·h) + a·h²
            const p = s.p[i], q = s.q[i];
            tmp.copy(p).sub(q).multiplyScalar(1 - CLOTH.DRAG * h);
            q.copy(p);
            p.add(tmp).addScaledVector(G, h * h);
            p.z += Math.sin(t * 11 + i * 1.7 + s.o) * CLOTH.FLUTTER * h * h * i;   // 一点点飘动
          }
          s.p[0].copy(A); s.q[0].copy(A);
          for (let it = 0; it < CLOTH.ITER; it++) for (let i = 1; i < s.n; i++) {
            d.copy(s.p[i]).sub(s.p[i - 1]); const L = d.length() || 1e-6;
            s.p[i].addScaledVector(d, (s.seg - L) / L * (i === 1 ? 1 : 0.5));
            if (i > 1) s.p[i - 1].addScaledVector(d, -(s.seg - L) / L * 0.5);
            const ahead = (s.p[i].x - bx) * fwd.x + (s.p[i].z - bz) * fwd.z - 0.02;
            if (ahead > 0) { s.p[i].x -= fwd.x * ahead; s.p[i].z -= fwd.z * ahead; }
          }
        }
        // 写顶点：每个点左右各一个，宽度方向 = 带子方向 × 看向镜头的方向
        for (let i = 0; i < s.n; i++) {
          d.copy(s.p[Math.min(i + 1, s.n - 1)]).sub(s.p[Math.max(i - 1, 0)]).normalize();
          toCam.copy(cam).sub(s.p[i]).normalize();
          side.crossVectors(d, toCam).normalize().multiplyScalar(s.hw * (1 - 0.35 * i / (s.n - 1)));
          const v = (s.o + i * 2) * 3;
          pos[v] = s.p[i].x - side.x; pos[v + 1] = s.p[i].y - side.y; pos[v + 2] = s.p[i].z - side.z;
          pos[v + 3] = s.p[i].x + side.x; pos[v + 4] = s.p[i].y + side.y; pos[v + 5] = s.p[i].z + side.z;
        }
      }
      geo.attributes.position.needsUpdate = true;
      geo.computeBoundingSphere();
    },
  };
}
