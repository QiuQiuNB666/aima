// 富士的场景互动（只看化身位置 st.s / 进度 / 登顶；只动画面和音效）：
//   ① 山小屋：化身走近时檐下提灯从一头到另一头一盏盏点亮，门口两幅暖帘被风掀起来飘几下——2 次绘制（全部小屋合在一起）
//   ② 御来光：进度过 0.93（或登顶那一刻）太阳那边一团暖光猛地涨满天，天光跟着亮一下，一声风铃——1 次绘制
//   ③ 流星：划过时镜头跟着抬一下头看（night.glance → rigFor 抬看点），不改化身
import * as THREE from 'three';

export function buildInteract(scene, ctx, { lamps, noren }) {
  const { kit } = ctx;
  // ---------- ① 提灯 + 暖帘 ----------
  const on = lamps.map(l => new THREE.Color(l.color)), lit = lamps.map(() => 0), tmp = new THREE.Color(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qx = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0), zero = new THREE.Vector3(0, 0, 0), sc = new THREE.Vector3(1, 1.3, 1), one = new THREE.Vector3(1, 1, 1);
  const lm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), Math.max(1, lamps.length));
  lm.count = lamps.length; lm.name = 'hutLanterns'; lm.frustumCulled = false; scene.add(lm);
  lamps.forEach((l, i) => { lm.setColorAt(i, tmp.copy(on[i]).multiplyScalar(0.1)); });
  if (lamps.length) lm.instanceColor.needsUpdate = true;
  const nm = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.38, 0.5).rotateY(Math.PI).translate(0, -0.25, 0), new THREE.MeshBasicMaterial({ color: '#e9e2d0', side: THREE.DoubleSide }), Math.max(1, noren.length));
  nm.count = noren.length; nm.name = 'noren'; nm.frustumCulled = false; scene.add(nm);
  const flap = noren.map(() => 0);
  const hut = (dt, st) => {
    let dirty = false;
    lamps.forEach((l, i) => {
      const vis = l.g.U.value > 0.02, want = vis && st.s > l.s - 3.6 + l.j * 0.18 ? 1 : 0;   // 走近小屋 3.6 步起，从左到右每盏晚 0.18 步
      lm.setMatrixAt(i, m4.compose(l.p, q.identity(), vis ? sc : zero));
      if (Math.abs(want - lit[i]) > 0.002) { lit[i] += (want - lit[i]) * Math.min(1, dt * (want ? 6 : 1.5)); lm.setColorAt(i, tmp.copy(on[i]).multiplyScalar(0.1 + 0.9 * lit[i])); dirty = true; }
    });
    lm.instanceMatrix.needsUpdate = true; if (dirty) lm.instanceColor.needsUpdate = true;
    noren.forEach((n, i) => {
      const vis = n.g.U.value > 0.02, near = Math.abs(st.s - n.s) < 3 ? 1 : 0;
      flap[i] += (near - flap[i]) * Math.min(1, dt * 2.5);
      const a = 0.05 * Math.sin(st.t * 1.7 + i) + flap[i] * 0.45 * Math.max(0, Math.sin(st.t * 6.5 + i * 0.8));   // 走近时被风掀起（只往外翻）
      qx.setFromAxisAngle(X, -a); q.copy(n.q).multiply(qx);
      nm.setMatrixAt(i, m4.compose(n.p, q, vis ? one : zero));
    });
    nm.instanceMatrix.needsUpdate = true;
  };

  // ---------- ② 御来光 ----------
  const tex = new THREE.CanvasTexture((() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,244,214,1)'); gr.addColorStop(0.25, 'rgba(255,200,120,0.7)'); gr.addColorStop(1, 'rgba(255,140,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return cv;
  })());
  const burstMat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const burst = new THREE.Sprite(burstMat); burst.visible = false; burst.renderOrder = -6; burst.name = 'goraiko'; scene.add(burst);
  const dawn = kit.edge();
  let bT = 0;
  const sunrise = (dt, st, p, dir, cen, L) => {
    if (dawn(p > 0.93) && bT <= 0) { bT = 3.4; kit.sfx('chime', 0.8); }
    if (bT <= 0) { burst.visible = false; return 0; }
    bT = Math.max(0, bT - dt);
    const u = 1 - bT / 3.4, grow = Math.min(1, u / 0.3), k = u < 0.3 ? grow : (1 - (u - 0.3) / 0.7) ** 1.5;
    burst.position.set(cen.x + dir.x * 300, Math.max(dir.y, 0.02) * 300, cen.z + dir.z * 300); burst.scale.setScalar(60 + 260 * grow);
    burstMat.opacity = 0.9 * k; burst.visible = true;
    L.hemi.intensity *= 1 + 0.5 * k;                                     // 整片天光跟着亮一下
    return k;
  };
  return { update(dt, st, p, dir, cen, L) { hut(dt, st); sunrise(dt, st, p, dir, cen, L); } };
}
