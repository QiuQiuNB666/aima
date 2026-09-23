// 第三人称跟随：侧后上方；上坡略抬、台阶拉近；登顶环绕一圈。全部指数平滑，帧率无关。
// 参数都在 rig 里（引擎放进 ctx.camRig，每个世界一份）：主题 build 里可以改数值（比如某张图看点再抬高），镜头每帧读。
import * as THREE from 'three';
import { STEP } from './path.js';

export function defaultRig() {
  return {
    follow: {
      back: 4.6, backStairs: 3.7,        // 在化身后面多远（沿路）
      side: 1.4, sideStairs: 1.2,        // 向左偏多少（镜头在化身左后方）
      height: 2.1, upBonus: 0.45, stairsBonus: 0.25,   // 离化身脚下多高；上坡/上台阶、台阶再加
      clear: 1.7,                        // 离镜头脚下那段路面至少这么高：下台阶/下坡走完，身后是高处，不会贴着踏面、被近裁剪切开
      ahead: 1.6, lookY: 0.95, lookUp: 0.25,          // 看化身前方 ahead 处、离地 lookY；上坡再抬 lookUp
      slopeLook: 0.6,                    // 看点高度跟前方路面起伏的比例：上台阶略仰（看得到整段台阶），下台阶略俯
      footMin: -0.72,                    // 化身脚底在屏幕上不低于这个高度（NDC，−1 = 底边）：主题把 lookY 抬高时自动压回来，脚和台阶不出画；null = 不管
    },
    // 登顶环绕：中心 = route.at(N + 1.2)（引擎填 center），半径、离地、看点离地、每秒转多少弧度；
    // face（Vector3，可选）= 环绕开始时镜头正对着看的点（太阳、山门），不给就从化身背后开始；
    // hold = 先定住几秒再开始转（「鸟居框日出」构图）；speed = 0 + face = 登顶定机位（不转）
    summit: { center: null, radius: 5.2, height: 2.3, lookY: 1.1, speed: 1.0, face: null, hold: 0 },
  };
}

export function makeCamera(camera, route, rig = defaultRig()) {
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), want = new THREE.Vector3(), wantLook = new THREE.Vector3();
  let init = false, orbitA = 0, base0 = null, held = 0;
  const lk = new THREE.Vector3(), ndc = new THREE.Vector3(), tanH = () => Math.tan(camera.fov * Math.PI / 360);
  return {
    rig,
    // a = route.at(s) 的结果（pos/dir/left/kind）；s = 化身连续步数；mode = 'follow' | 'summit'
    update(dt, a, mode, snap = false, s = 0) {
      const k = a.kind || 'flat', stairs = k.startsWith('stairs'), up = k === 'up' || k === 'stairs_up';
      if (mode === 'summit') {
        const R = rig.summit;
        if (base0 === null) base0 = R.face ? Math.atan2(a.pos.z - R.face.z, a.pos.x - R.face.x) : Math.atan2(-a.dir.z, -a.dir.x);
        held += dt;
        if (held > (R.hold || 0)) orbitA += dt * R.speed;                              // SUMMIT_HOLD 6 s ≈ 一整圈
        const base = base0 + orbitA;
        want.set(a.pos.x + Math.cos(base) * R.radius, a.pos.y + R.height, a.pos.z + Math.sin(base) * R.radius);
        wantLook.copy(a.pos).setY(a.pos.y + R.lookY);        // 化身在画面中部偏下，登顶卡在下三分之一、延迟弹出
      } else {
        orbitA = 0; base0 = null; held = 0;
        const F = rig.follow, back = stairs ? F.backStairs : F.back, side = stairs ? F.sideStairs : F.side;
        const h = F.height + (up ? F.upBonus : 0) + (stairs ? F.stairsBonus : 0);
        want.copy(a.pos).addScaledVector(a.dir, -back).addScaledVector(a.left, side); want.y += h;
        want.y = Math.max(want.y, route.heightAt(s - back / STEP) + F.clear);
        const rise = route.heightAt(s + F.ahead / STEP) - route.heightAt(s);
        wantLook.copy(a.pos).addScaledVector(a.dir, F.ahead); wantLook.y += F.lookY + (up ? F.lookUp : 0) + rise * F.slopeLook;
      }
      const f = snap || !init ? 1 : 1 - Math.exp(-dt * 2.6), g = snap || !init ? 1 : 1 - Math.exp(-dt * 4);
      pos.lerp(want, f); look.lerp(wantLook, g); init = true;
      camera.position.copy(pos); camera.lookAt(look);
      const fm = rig.follow.footMin;
      if (mode !== 'summit' && fm != null) {             // 脚底出了下限：看点往下压（2 次迭代就够），不改平滑状态 → 不抖
        lk.copy(look);
        for (let k = 0; k < 2; k++) {
          camera.updateMatrixWorld(); ndc.copy(a.pos).project(camera);
          if (ndc.z > 1 || ndc.y >= fm) break;
          lk.y -= (fm - ndc.y) * tanH() * Math.hypot(lk.x - pos.x, lk.z - pos.z);
          camera.lookAt(lk);
        }
      }
    },
  };
}
