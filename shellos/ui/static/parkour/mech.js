// 跑酷追兵（9/24 起）：四脚机甲，照 M2 攻壳版 themes/cyber_night/gits.js 里「ヨンソク-04」的样子自己拼（程序生成、不涉及 IP）——
//   扁六角身 + 橙色警示条 + 背后电池舱 + 天线 + 单眼；那边的腿和身子合成了一个固定趴姿的网格，跑不起来，所以这里每条腿拆成 髋 → 大腿 → 膝 → 小腿 能动。
//   奔跑 = 对角小跑（左前 + 右后一组、右前 + 左后一组），步频跟它自己的速度走；单眼红光；逼近时只有红色轮廓光（外壳往外撑一圈、只画背面），不说话。
//   本地 +x = 机头朝向，脚底 y = 0。绘制：身子 1 + 轮廓 1 + 头 1 + 眼 1 + 4 条腿 × 2 = 12 次
import * as THREE from 'three';
import { merged } from '/game/util.js';

const B = (x, y, z) => new THREE.BoxGeometry(x, y, z);
export const MECH = { SCALE: 1.25, HIP_H: 1.0, THIGH: 0.62, SHIN: 0.72, SPLAY: 0.42, STRIDE: 0.5, KNEE0: 0.75, KNEE_LIFT: 0.55, EYE: '#ff2a2a' };

export function makeMech(scene) {
  const G = '#2c3440', G2 = '#3e4a5a', OR = '#ff8a1a', M = MECH;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#0c1016' });
  const hex = new THREE.CylinderGeometry(0.62, 0.7, 0.26, 6); hex.rotateY(Math.PI / 6); hex.scale(1.3, 1, 1);
  const top = new THREE.CylinderGeometry(0.5, 0.6, 0.1, 6); top.rotateY(Math.PI / 6); top.scale(1.3, 1, 1);
  const bodyParts = [{ geo: hex, p: [0, 0, 0], color: G }, { geo: top, p: [0, 0.17, 0], color: G2 },
    { geo: B(0.9, 0.03, 0.06), p: [-0.05, 0.225, 0.36], color: OR }, { geo: B(0.9, 0.03, 0.06), p: [-0.05, 0.225, -0.36], color: OR },   // 橙色警示条
    { geo: B(0.42, 0.2, 0.46), p: [-0.62, 0.12, 0], color: '#232a33' },                                                                // 背后电池舱
    { geo: new THREE.CylinderGeometry(0.012, 0.012, 0.55, 4), p: [-0.72, 0.45, 0.16], color: '#8a929c' }];                            // 天线
  const g = new THREE.Group(); g.name = 'mech';
  const root = new THREE.Group(); root.scale.setScalar(M.SCALE); g.add(root);
  const body = new THREE.Group(); body.position.y = M.HIP_H; root.add(body);
  const bodyGeo = merged(bodyParts);
  body.add(new THREE.Mesh(bodyGeo, mat));
  // 轮廓光：同一个身子往外撑 8%，只画背面，红色，逼近时亮
  const rimMat = new THREE.MeshBasicMaterial({ color: M.EYE, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false });
  const rim = new THREE.Mesh(bodyGeo, rimMat); rim.scale.setScalar(1.08); body.add(rim);
  // 头 + 单眼（红）
  const head = new THREE.Group(); head.position.set(0.82, 0.08, 0); body.add(head);
  head.add(new THREE.Mesh(merged([
    { geo: B(0.38, 0.22, 0.34), p: [0.14, 0, 0], color: G2 },
    { geo: B(0.12, 0.08, 0.4), p: [-0.02, 0.13, 0], color: G },
    { geo: new THREE.TorusGeometry(0.105, 0.025, 6, 16).rotateY(Math.PI / 2), p: [0.33, 0, 0], color: OR },
  ]), mat));
  const eyeMat = new THREE.MeshBasicMaterial({ color: M.EYE, toneMapped: false });
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), eyeMat); eye.position.set(0.32, 0, 0); head.add(eye);
  // 四条腿：髋在机身四角；髋组绕 z 前后摆、绕 x 往外撇；膝组绕 z 弯
  const thighGeo = merged([{ geo: new THREE.SphereGeometry(0.1, 8, 6), p: [0, 0, 0], color: G2 }, { geo: B(0.1, M.THIGH, 0.1), p: [0, -M.THIGH / 2, 0], color: G },
    { geo: new THREE.SphereGeometry(0.08, 8, 6), p: [0, -M.THIGH, 0], color: OR }]);
  const shinGeo = merged([{ geo: B(0.075, M.SHIN, 0.075), p: [0, -M.SHIN / 2, 0], color: G2 }, { geo: new THREE.CylinderGeometry(0.09, 0.11, 0.05, 10), p: [0, -M.SHIN, 0], color: '#1a1f26' }]);
  const legs = [];
  for (const [x, z, ph] of [[0.5, 0.42, 0], [0.5, -0.42, Math.PI], [-0.5, 0.42, Math.PI], [-0.5, -0.42, 0]]) {   // 对角一组：左前 + 右后同相
    const hip = new THREE.Group(); hip.position.set(x * 1.1, -0.02, z); hip.rotation.order = 'XZY'; hip.rotation.x = -Math.sign(z) * M.SPLAY;   // 往外撇（+z 腿往 +z 撇）
    const thigh = new THREE.Mesh(thighGeo, mat); hip.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -M.THIGH; hip.add(knee);
    knee.add(new THREE.Mesh(shinGeo, mat));
    body.add(hip);
    legs.push({ hip, knee, ph, front: x > 0 });
  }
  scene.add(g);
  let phase = 0, glow = 0, flashT = 9, bob = 0;
  return {
    group: g,
    set visible(v) { g.visible = v; }, get visible() { return g.visible; },
    burst() { flashT = 0; },                                  // 追上：轮廓光闪一下
    // speed = 它自己的速度（m/s，0 = 站着）；near = 0..1 离人多近（轮廓光）
    update(dt, speed, near) {
      const run = Math.min(1, speed / 6);
      phase += dt * (2 + speed * 0.9);                        // 步频跟速度走
      for (const L of legs) {
        const s = Math.sin(phase + L.ph), c = Math.cos(phase + L.ph);
        L.hip.rotation.z = (L.front ? 0.12 : -0.1) + run * M.STRIDE * s;              // 前后摆（+ = 往前）
        L.knee.rotation.z = -(M.KNEE0 + run * M.KNEE_LIFT * Math.max(0, c)) * (L.front ? 1 : -1);   // 前腿膝往后弯、后腿往前弯；往前摆时抬高
      }
      bob += ((run * 0.06 * Math.abs(Math.sin(phase)) - 0.04 * (1 - run)) - bob) * (1 - Math.exp(-dt * 12));
      body.position.y = M.HIP_H + bob;
      body.rotation.z = -0.08 * run + 0.03 * run * Math.sin(phase * 2);                // 跑起来机头压低
      head.rotation.y = 0.12 * Math.sin(phase * 0.5) * (1 - run);                      // 站着时慢慢扫视
      glow += (near - glow) * (1 - Math.exp(-dt * 5)); flashT += dt;
      const fl = Math.max(0, 1 - flashT / 0.6);
      rimMat.opacity = Math.min(0.9, glow * 0.6 + fl * 0.9); rim.visible = rimMat.opacity > 0.02;
      eyeMat.color.set(M.EYE).multiplyScalar(0.8 + 0.4 * glow + 0.6 * fl);
    },
  };
}
