// 事件动效：脉冲 → 脚下波纹 + 当前那一步路面发亮；登顶 → 彩带粒子 + 旗子飘。
import * as THREE from 'three';
import { STEP, ROAD_W } from './path.js';

export function makeFx(scene, route, meshes) {
  const acc = meshes.acc;
  // 波纹：6 个环轮流用
  const rings = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 40), new THREE.MeshBasicMaterial({ color: acc[1], transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 3; scene.add(m); rings.push({ m, t: 9 });
  }
  let ri = 0;
  // 当前一步的发光板
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(STEP, ROAD_W), new THREE.MeshBasicMaterial({ color: acc[0], transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  glow.rotation.x = -Math.PI / 2; glow.renderOrder = 3;
  const glowG = new THREE.Group(); glowG.rotation.order = 'YXZ'; glowG.add(glow); scene.add(glowG);
  let glowT = 9;
  // 彩带
  const NC = 360, cp = new Float32Array(NC * 3), cv = new Float32Array(NC * 3), cc = new Float32Array(NC * 3);
  const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(cp, 3)); cg.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  const confetti = new THREE.Points(cg, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, depthWrite: false }));
  confetti.visible = false; confetti.frustumCulled = false; scene.add(confetti);
  let confT = 99;
  const tmp = new THREE.Vector3();

  return {
    pulse(footPos, stepI, strength = 1) {
      const r = rings[ri++ % rings.length]; r.t = 0; r.k = 0.8 + strength * 0.6; r.m.position.copy(footPos).setY(footPos.y + 0.03); r.m.visible = true;
      if (stepI >= 0 && stepI < route.N) {
        const st = route.steps[stepI], y = st.kind.startsWith('stairs') ? Math.max(st.h0, st.h1) : (st.h0 + st.h1) / 2;
        tmp.lerpVectors(route.P[stepI], route.P[stepI + 1], 0.5);
        glowG.position.set(tmp.x, y + 0.02, tmp.z);
        glowG.rotation.set(0, -route.H[stepI], Math.atan2(st.kind.startsWith('stairs') ? 0 : st.h1 - st.h0, STEP));
        glowT = 0;
      }
    },
    summit(at) {
      confT = 0; confetti.visible = true;
      for (let i = 0; i < NC; i++) {
        cp.set([at.x, at.y + 1.8, at.z], i * 3);
        const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3.5;
        cv.set([Math.cos(a) * s * 0.6, 3 + Math.random() * 4, Math.sin(a) * s * 0.6], i * 3);
        const c = acc[i % acc.length]; cc.set([c.r, c.g, c.b], i * 3);
      }
      cg.attributes.color.needsUpdate = true;
    },
    update(dt, t) {
      for (const r of rings) {
        if (!r.m.visible) continue;
        r.t += dt; const u = r.t / 0.9;
        if (u >= 1) { r.m.visible = false; continue; }
        const s = 1 + u * 3.2 * r.k; r.m.scale.set(s, s, s); r.m.material.opacity = 0.9 * (1 - u);
      }
      glowT += dt; glow.material.opacity = glowT < 0.6 ? 0.45 * (1 - glowT / 0.6) : 0;
      if (confetti.visible) {
        confT += dt;
        for (let i = 0; i < NC; i++) {
          cv[i * 3 + 1] -= 6 * dt;
          for (let k = 0; k < 3; k++) cp[i * 3 + k] += cv[i * 3 + k] * dt * (k === 1 ? 1 : 1 - Math.min(0.9, confT * 0.2));
        }
        cg.attributes.position.needsUpdate = true;
        confetti.material.opacity = Math.max(0, 1 - confT / 5);
        if (confT > 5) confetti.visible = false;
      }
      if (meshes.cloth) {                               // 旗子飘：按顶点 x 摆 z
        const p = meshes.cloth.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) { const x = p.getX(i) + 0.45; p.setZ(i, Math.sin(t * 4 + x * 5) * 0.08 * x); }
        p.needsUpdate = true;
      }
    },
  };
}
