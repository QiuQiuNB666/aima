// 第三人称跟随：侧后上方；上坡略抬、台阶拉近；登顶环绕一圈。全部指数平滑，帧率无关。
import * as THREE from 'three';

export function makeCamera(camera) {
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), want = new THREE.Vector3(), wantLook = new THREE.Vector3();
  let init = false, orbitA = 0;
  return {
    // a = route.at(s) 的结果（pos/dir/left/kind）；mode = 'follow' | 'summit'
    update(dt, a, mode, snap = false) {
      const k = a.kind || 'flat', stairs = k.startsWith('stairs'), up = k === 'up' || k === 'stairs_up';
      if (mode === 'summit') {
        orbitA += dt * 1.0;                                  // SUMMIT_HOLD 6 s ≈ 一整圈
        const r = 5.2, base = Math.atan2(-a.dir.z, -a.dir.x) + orbitA;
        want.set(a.pos.x + Math.cos(base) * r, a.pos.y + 2.3, a.pos.z + Math.sin(base) * r);
        wantLook.copy(a.pos).setY(a.pos.y + 1.9);            // 看点抬高 → 化身落在画面下半，登顶卡片在上面不挡人
      } else {
        orbitA = 0;
        const back = stairs ? 3.7 : 4.6, side = stairs ? 1.2 : 1.4, h = 2.1 + (up ? 0.45 : 0) + (stairs ? 0.25 : 0);
        want.copy(a.pos).addScaledVector(a.dir, -back).addScaledVector(a.left, side); want.y += h;
        wantLook.copy(a.pos).addScaledVector(a.dir, 1.6); wantLook.y += 0.95 + (up ? 0.25 : 0);
      }
      const f = snap || !init ? 1 : 1 - Math.exp(-dt * 2.6), g = snap || !init ? 1 : 1 - Math.exp(-dt * 4);
      pos.lerp(want, f); look.lerp(wantLook, g); init = true;
      camera.position.copy(pos); camera.lookAt(look);
    },
  };
}
