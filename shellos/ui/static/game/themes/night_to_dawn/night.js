// 夜空两样会动的：月亮（挂在来路方向的天上 —— 正面镜头回看时就在峰哥身后）、流星（前半程每 2.5–5 s 划过一颗）。
//   天亮后（进度 0.45 → 0.8）一起淡掉。都不吃雾、不吃光，加色混合；每帧只改几个数，不 new 对象。
import * as THREE from 'three';

export function nightSky(ctx, back) {          // back = 来路方向（水平单位向量）
  const { scene, route } = ctx, c = ctx.kit.routeCenter(route), R = ctx.rand;
  const glowTex = (inner, outer) => new THREE.CanvasTexture((() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, inner); gr.addColorStop(0.22, inner); gr.addColorStop(0.26, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return cv;
  })());
  // 月亮：来路方向偏左 25°、仰角 22°、300 远，盘面约 5°（比真的大，3 米外认得出）
  const az = Math.atan2(back.z, back.x) + 0.26, el = 0.2, D = 300;   // 正面镜头几乎平视：仰角 11° 才在画里
  const moonPos = new THREE.Vector3(c.x + Math.cos(az) * Math.cos(el) * D, Math.sin(el) * D, c.z + Math.sin(az) * Math.cos(el) * D);
  const moonMat = new THREE.SpriteMaterial({ map: glowTex('rgba(255,248,226,1)', 'rgba(190,210,255,0.35)'), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const moon = new THREE.Sprite(moonMat); moon.position.copy(moonPos); moon.scale.setScalar(110); moon.renderOrder = -8; moon.name = 'moon'; scene.add(moon);
  // 流星：一条 34 × 0.5 的加色细条，头亮尾淡；朝向每帧按相机现算（条面对着镜头）
  const tex = new THREE.CanvasTexture((() => {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 16; const g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 256, 0);
    gr.addColorStop(0, 'rgba(160,200,255,0)'); gr.addColorStop(0.85, 'rgba(210,230,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr; g.fillRect(0, 4, 256, 8); return cv;
  })());
  const mm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
  const met = new THREE.Mesh(new THREE.PlaneGeometry(34, 0.55), mm); met.visible = false; met.frustumCulled = false; met.renderOrder = -7; met.name = 'meteor'; scene.add(met);
  const P0 = new THREE.Vector3(), Q = new THREE.Vector3(), V = new THREE.Vector3(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), M = new THREE.Matrix4();
  let wait = 0.2, life = 0, T = 0.7;
  const fw = new THREE.Vector3();
  const spawn = cam => {                       // 在镜头朝向 ±35° 以内、180 远的天上挑个起点，斜着往下划（划在画面里才有用）
    const camPos = cam.position; cam.getWorldDirection(fw);
    const a = Math.atan2(fw.z, fw.x) + (R() - 0.5) * 1.2, e = 0.07 + R() * 0.12, r = 180;   // 跟拍镜头朝下看，天只露地平线上 ~10°
    P0.set(camPos.x + Math.cos(a) * Math.cos(e) * r, camPos.y + Math.sin(e) * r, camPos.z + Math.sin(a) * Math.cos(e) * r);
    const b = a + (R() < 0.5 ? 1.2 : -1.2);
    V.set(Math.cos(b) * 90, -18, Math.sin(b) * 90);
    life = T = 0.55 + R() * 0.35;
  };
  return {
    update(dt, st, night) {                    // night = 1 夜 → 0 天亮
      moonMat.opacity = night; moon.visible = night > 0.01;
      if (!st.camera || night < 0.05) { met.visible = false; return; }
      if (life > 0) {
        life -= dt;
        const u = 1 - life / T;
        X.copy(V).normalize(); const pos = Q.copy(P0).addScaledVector(V, u * T);
        Z.subVectors(st.camera.position, pos); Z.addScaledVector(X, -Z.dot(X)).normalize(); Y.crossVectors(Z, X);
        M.makeBasis(X, Y, Z); met.quaternion.setFromRotationMatrix(M); met.position.copy(pos).addScaledVector(X, -17);
        mm.opacity = night * Math.sin(Math.PI * u); met.visible = life > 0;
      } else if ((wait -= dt) <= 0) { spawn(st.camera); wait = 2.5 + R() * 2.5; }
    },
  };
}
