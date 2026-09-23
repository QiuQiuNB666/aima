// 东京的场景互动（只看化身位置 st.s；只动画面和音效，不碰任何控制接口）：
//   ① 走近自动贩卖机：机身正面一闪，「咚」地滚出一罐饮料（落地弹一下、滚到路边，2.5 s 后收掉）——2 次绘制
//   ② 路口等红灯的三个行人（撑伞）：化身走近时转过来挥手，走到跟前往外让一步——3 次绘制（身子 / 胳膊 / 伞）
//   ③ 神社石阶的奉納提灯：化身走过哪一盏，哪一盏亮起来（没走到的是暗的）；回到山脚（下一圈）重新熄——0 次新增绘制
//   ④ 湿街踩水花：stepFx({ wet: true })，见 cyber_night.js
import * as THREE from 'three';
import { HOUNOU } from './landmarks.js';

export function buildInteract(scene, ctx, E) {
  const { route, util, kit } = ctx, R = ctx.rand, gy = (x, z) => util.nearestRoute(route, x, z).y - 0.06, LOW = kit.LOW;

  // ---------- ① 贩卖机掉罐 ----------
  const vend = (E.vend || []).filter(v => v.s < route.N - 2);
  const flashMat = new THREE.MeshBasicMaterial({ color: '#dff4ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 1.18), flashMat); flash.visible = false; flash.name = 'vendFlash'; scene.add(flash);
  const can = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.22, 12).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#e8283a', toneMapped: false }));
  can.visible = false; can.name = 'vendCan'; scene.add(can);
  const trig = vend.map(() => kit.edge()), cp = new THREE.Vector3(), cv = new THREE.Vector3();
  let fT = 0, cT = 0, cy0 = 0, cols = ['#e8283a', '#2a6cff', '#f2c230', '#2fbf6a'], ci = 0;
  const drop = v => {
    const n = new THREE.Vector3(Math.sin(v.ry), 0, Math.cos(v.ry));            // 机身正面朝路
    flash.position.set(v.a.pos.x + n.x * 0.27, v.y0 + 0.64, v.a.pos.z + n.z * 0.27); flash.rotation.y = v.ry; flash.visible = true; fT = 0.6;
    cp.set(v.a.pos.x + n.x * 0.32, v.y0 + 0.22, v.a.pos.z + n.z * 0.32); cy0 = v.y0 + 0.07;
    cv.copy(n).multiplyScalar(1.3).add(new THREE.Vector3((R() - 0.5) * 0.4, 1.1, (R() - 0.5) * 0.4)); cT = 2.5;
    can.material.color.set(cols[ci++ % cols.length]); can.visible = true; can.rotation.set(0, v.ry + Math.PI / 2, 0);
    kit.sfx('can');
  };

  // ---------- ② 等红灯的行人 ----------
  const wait = route.segs.find(q => q.kind === 'wait');
  const peds = [];
  if (wait && !LOW) {
    const spots = [[wait.start + 0.6, -1.8, '#2b2f3a', '#e8eef5'], [wait.start + 1.7, -2.25, '#5a2c34', '#ff4d6a'], [wait.start + 2.6, -1.75, '#23324a', '#3fb6ff']];
    for (const [s, lat, coat, umb] of spots) { const a = route.at(s, lat); peds.push({ s, lat, a, y: gy(a.pos.x, a.pos.z), coat, umb, off: 0, wave: 0, yaw: -a.heading + Math.PI * 0.5, ph: R() * 6 }); }
  }
  const B = (x, y, z) => new THREE.BoxGeometry(x, y, z);
  const bodyGeo = util.merged([
    { geo: B(0.1, 0.72, 0.12), p: [0, 0.36, 0.08], color: '#1a1c22' }, { geo: B(0.1, 0.72, 0.12), p: [0, 0.36, -0.08], color: '#1a1c22' },   // 腿
    { geo: B(0.26, 0.6, 0.38), p: [0, 1.02, 0], color: '#3c4150' },                                                                   // 外套（深灰；颜色的变化交给伞）
    { geo: new THREE.SphereGeometry(0.13, 12, 8), p: [0, 1.46, 0], color: '#e6c3a2' },                                                  // 头
    { geo: B(0.08, 0.5, 0.08), p: [0, 1.0, -0.23], color: '#3c4150' },                                                                // 撑伞那只胳膊
  ]);
  const armGeo = new THREE.BoxGeometry(0.08, 0.5, 0.08).translate(0, -0.25, 0);   // 挥手的胳膊：原点在肩
  const umbGeo = util.merged([{ geo: new THREE.ConeGeometry(0.62, 0.3, 12, 1, true), p: [0, 2.0, 0], color: '#ffffff' }, { geo: new THREE.CylinderGeometry(0.012, 0.012, 0.95, 5), p: [0, 1.55, 0], color: '#cccccc' }]);
  const n = Math.max(1, peds.length);
  const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#15121c' }), n);
  const arms = new THREE.InstancedMesh(armGeo, new THREE.MeshLambertMaterial({ color: '#3c4150', emissive: '#15121c' }), n);
  const umbs = new THREE.InstancedMesh(umbGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }), n);
  for (const m of [bodies, arms, umbs]) { m.count = peds.length; m.frustumCulled = false; scene.add(m); }
  bodies.name = 'pedBodies'; arms.name = 'pedArms'; umbs.name = 'pedUmbrellas';
  const col = new THREE.Color();
  peds.forEach((p, i) => umbs.setColorAt(i, col.set(p.umb)));   // 身子不上实例色（会把脸也染了），三个人靠伞的颜色分开
  for (const m of [bodies, arms, umbs]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qa = new THREE.Quaternion(), e = new THREE.Euler(), pp = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), sh = new THREE.Vector3();
  const placePeds = (dt, st) => {
    peds.forEach((p, i) => {
      const d = p.s - st.s;                                            // 化身还差几步到他跟前（负 = 走过了）
      const waveOn = d < 3.2 && d > -0.8, stepAside = d < 1.2 && d > -1.5;
      p.wave += ((waveOn ? 1 : 0) - p.wave) * Math.min(1, dt * 4);
      p.off += ((stepAside ? 0.7 : 0) - p.off) * Math.min(1, dt * 3);
      const a = route.at(p.s, p.lat - p.off); pp.set(a.pos.x, p.y, a.pos.z);
      const face = -a.heading + Math.PI * (0.5 + 0.5 * p.wave);       // 平时面朝马路，化身走近时转过来对着化身（朝来路）
      q.setFromEuler(e.set(0, face, 0));
      bodies.setMatrixAt(i, m4.compose(pp, q, one)); umbs.setMatrixAt(i, m4.compose(pp, q, one));
      sh.set(0, 1.28, 0.23).applyQuaternion(q).add(pp);                // 右肩
      const lift = -2.6 * p.wave + 0.45 * p.wave * Math.sin(st.t * 9 + p.ph);   // 抬手过头，左右摆
      qa.setFromEuler(e.set(lift, 0, 0)).premultiply(q);
      arms.setMatrixAt(i, m4.compose(sh, qa, one));
    });
    for (const m of [bodies, arms, umbs]) m.instanceMatrix.needsUpdate = true;
  };

  // ---------- ③ 奉納提灯一盏盏亮 ----------
  const L = HOUNOU, lit = L.s.map(() => 0), dim = new THREE.Color(), on = L.on.map(c => new THREE.Color(c)), tmp = new THREE.Color();
  const lanterns = (dt, st) => {
    if (!L.mesh) return;
    let dirty = false;
    for (let i = 0; i < lit.length; i++) {
      const want = st.s > L.s[i] - 1.2 ? 1 : 0;                       // 化身走到这盏前 1.2 步就点亮
      if (Math.abs(want - lit[i]) < 0.002) continue;
      lit[i] += (want - lit[i]) * Math.min(1, dt * (want ? 5 : 2)); dirty = true;
      tmp.copy(dim.copy(on[i]).multiplyScalar(0.12)).lerp(on[i], lit[i]);
      L.mesh.setColorAt(i, tmp);
    }
    if (dirty) L.mesh.instanceColor.needsUpdate = true;
  };

  return {
    update(dt, st) {
      vend.forEach((v, i) => { if (trig[i](st.s > v.s - 2.2 && st.s < v.s + 0.5 && !st.summit)) drop(v); });
      if (fT > 0) { fT = Math.max(0, fT - dt); flashMat.opacity = (fT / 0.6) ** 1.5; flash.visible = fT > 0; }
      if (cT > 0) {                                                   // 罐子：抛出 → 落地弹一下 → 滚 → 收
        cT = Math.max(0, cT - dt); cv.y -= 9.8 * dt; cp.addScaledVector(cv, dt);
        if (cp.y < cy0) { cp.y = cy0; cv.y = Math.abs(cv.y) * 0.35; cv.x *= 0.7; cv.z *= 0.7; }
        can.position.copy(cp); can.rotation.x += dt * 8 * Math.hypot(cv.x, cv.z); can.visible = cT > 0;
      }
      if (peds.length) placePeds(dt, st);
      lanterns(dt, st);
    },
  };
}
