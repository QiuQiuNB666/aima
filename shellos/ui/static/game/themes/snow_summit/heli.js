// 直升机（docs/珠峰-架构.md §2 ★新）：基本几何拼的低模（红白机身、黑风挡、尾梁、起落橇），主旋翼 / 尾桨在转。三段脚本，只看 s / summit：
//   ① 开场：第一次迈步（导游讲完、按住 R2 走起来）→ 从镜头后上方掠过，5 s 落到停机坪，贴地时旋翼扬雪；落地那一帧 onTouchdown（峰哥说一句）；
//      落地后旋翼慢慢降速、停在坪上，走远了就不画
//   ② 北山脊·大风口（zonesOf 的 ridge）：远处侧前方悬停，一束探照灯往前面的山脊上扫；出了大风口就飞走
//   ③ 登顶：绕顶飞一圈（半径 26、高 +7，起点在镜头看过去的后方），一圈后飞走
//   旋翼声（audio.rotorLoop）按离镜头的距离和转速混音，?sfx=0 关。
//   4 次绘制（机身 / 主旋翼 / 尾桨 / 光束）+ 扬雪粒子 1 次（300 粒，?fx=low 不要）+ 在场时机身阴影 1 次，约 900 三角形。藏起来 = 缩成点（照样在绘制列表里，第一次出场不卡）
import * as THREE from 'three';
import { rotorLoop } from './audio.js';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const Y = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const RED = '#d8261f', WHITE = '#f1f1ee', DARK = '#2a2c30', GLASS = '#1b232c';

function bar(a, b, r, color) {
  const d = new THREE.Vector3().subVectors(b, a);
  return { geo: new THREE.CylinderGeometry(r, r, 1, 5), p: a.clone().lerp(b, 0.5), q: new THREE.Quaternion().setFromUnitVectors(Y, d.clone().normalize()), s: [1, d.length(), 1], color };
}
// 机身（机头 = +x，左右 = ±z，起落橇底 = y 0）
function bodyGeo(util) {
  const half = (t0, t1) => new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, t0 * Math.PI, (t1 - t0) * Math.PI);   // 机舱上红下白：两个半球接一条平的缝
  const P = [
    { geo: half(0, 0.56), p: [0.15, 0.86, 0], s: [1.3, 0.78, 0.72], color: RED },
    { geo: half(0.56, 1), p: [0.15, 0.86, 0], s: [1.3, 0.78, 0.72], color: WHITE },
    { geo: new THREE.SphereGeometry(1, 10, 8), p: [0.95, 1.02, 0], s: [0.5, 0.42, 0.6], color: GLASS },            // 风挡
    { geo: new THREE.BoxGeometry(0.72, 0.3, 1.48), p: [0.2, 1.08, 0], color: GLASS },                               // 侧窗
    { geo: new THREE.CylinderGeometry(0.09, 0.2, 2.5, 8).rotateZ(Math.PI / 2), p: [-1.9, 1.05, 0], color: RED },    // 尾梁
    { geo: new THREE.BoxGeometry(0.55, 0.8, 0.07), p: [-3.05, 1.42, 0], q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.35), color: RED },
    { geo: new THREE.BoxGeometry(0.3, 0.05, 0.9), p: [-2.75, 1.03, 0], color: WHITE },                              // 水平尾翼
    { geo: new THREE.BoxGeometry(1.0, 0.32, 0.62), p: [-0.05, 1.62, 0], color: WHITE },                             // 发动机罩
    { geo: new THREE.CylinderGeometry(0.06, 0.07, 0.36, 6), p: [0.1, 1.86, 0], color: DARK },                      // 旋翼轴
    { geo: new THREE.CylinderGeometry(0.07, 0.07, 0.14, 8).rotateZ(Math.PI / 2), p: [1.25, 0.45, 0], color: '#fff2c0' },   // 探照灯
  ];
  for (const z of [-0.62, 0.62]) {
    P.push(bar(new THREE.Vector3(-0.95, 0.04, z), new THREE.Vector3(1.15, 0.04, z), 0.035, DARK));                  // 起落橇
    P.push(bar(new THREE.Vector3(1.15, 0.04, z), new THREE.Vector3(1.35, 0.14, z), 0.035, DARK));
    for (const x of [-0.5, 0.6]) P.push(bar(new THREE.Vector3(x, 0.04, z), new THREE.Vector3(x * 0.9, 0.5, z * 0.62), 0.03, DARK));
  }
  return util.merged(P);
}

export function buildHeli(ctx, { Z, pad, LOW, onTouchdown }) {
  const { route, util, kit, scene } = ctx, N = route.N;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const g = new THREE.Group(); g.name = 'heli'; g.rotation.order = 'YZX';
  const body = new THREE.Mesh(bodyGeo(util), mat);
  const rotor = new THREE.Mesh(util.merged([{ geo: new THREE.BoxGeometry(3.8, 0.035, 0.2), color: DARK }, { geo: new THREE.BoxGeometry(0.2, 0.035, 3.8), color: DARK }, { geo: new THREE.CylinderGeometry(0.13, 0.13, 0.1, 8), color: '#555a60' }]), mat);
  const tail = new THREE.Mesh(util.merged([{ geo: new THREE.BoxGeometry(0.1, 0.95, 0.03), color: DARK }, { geo: new THREE.BoxGeometry(0.95, 0.1, 0.03), color: DARK }]), mat);
  rotor.position.set(0.1, 2.05, 0); tail.position.set(-3.2, 1.42, 0.09);
  g.add(body, rotor, tail); scene.add(g);
  // 探照灯光束：锥（尖 = 灯，底 = 照到的地方），加色、不受雾（风雪里一道光柱）
  const bg = new THREE.ConeGeometry(1, 1, 18, 1, true).translate(0, -0.5, 0), bp = bg.attributes.position, bc = [];
  for (let i = 0; i < bp.count; i++) { const k = Math.pow(1 + bp.getY(i), 1.6); bc.push(1 * k, 0.96 * k, 0.82 * k); }
  bg.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
  const beam = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false }));
  beam.name = 'heliBeam'; beam.renderOrder = 6; scene.add(beam);
  for (const m of [body, rotor, tail, beam]) m.frustumCulled = false;
  const spray = LOW ? null : kit.particles(ctx, { color: '#f4f8ff', alpha: 0.75, n: 300, gravity: 0.5, name: 'heliSnow' });
  const snd = rotorLoop();

  const bcEnd = route.segs[0] ? route.segs[0].start + route.segs[0].steps : 3, ridge = Z.ridge;
  const h0 = route.heightAt(0), P0 = route.at(-16, 2).pos.setY(h0 + 13), C0 = route.at(4, -1.5).pos.setY(h0 + 10), P1 = pad.clone().setY(pad.y + 6);
  const H = { mode: 'none', t: 0, lastS: 0, landed: false, orbitDone: false, rs: 0, em: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), nose = new THREE.Vector3(1.25, 0.4, 0), q = new THREE.Quaternion(), A = {};
  const start = (m) => { H.mode = m; H.t = 0; if (m === 'leave') H.vel.set(Math.cos(H.yaw), 0.25, -Math.sin(H.yaw)).normalize(); };   // 飞走：沿机头方向爬升
  const faceTo = (d, k) => { const y = Math.atan2(-d.z, d.x); let dy = y - H.yaw; dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI; H.yaw += dy * Math.min(1, k); };
  const bez = (u, out) => out.copy(P0).multiplyScalar((1 - u) * (1 - u)).addScaledVector(C0, 2 * u * (1 - u)).addScaledVector(P1, u * u);

  return {
    update(dt, st) {
      const s = st.s, cam = st.camera;
      if (s < H.lastS - 5) { H.landed = false; if (H.mode === 'parked') H.mode = 'none'; }         // 新一圈：开场再落一次
      H.lastS = s;
      if (!st.summit) H.orbitDone = false;
      // ---- 选脚本 ----
      if (st.summit) { if (H.mode !== 'orbit' && H.mode !== 'leave' && !H.orbitDone) start('orbit'); }
      else if (ridge && s > ridge.start - 1 && s < ridge.start + ridge.steps + 1.5) { if (H.mode !== 'hover') { start('hover'); const a = route.at(s + 30, -8); H.pos.copy(a.pos).setY(route.heightAt(s + 30) + 12).addScaledVector(a.left, -22); } }
      else if (H.mode === 'hover' || H.mode === 'orbit') start('leave');
      else if (H.mode === 'none' && !H.landed && s < bcEnd + 10 && (s > 0.05 || st.preview)) start('land');
      else if (H.mode === 'parked' && s > bcEnd + 24) H.mode = 'none';
      H.t += dt;
      let beamOn = false, ground = null;
      // ---- 各段怎么飞 ----
      if (H.mode === 'land') {
        const t = st.preview ? 3.9 : H.t;                                                            // 预览停在离坪 1.3 的那一刻（扬雪最大）
        if (t < 2.8) {
          const u = smooth(0, 2.8, t) * 0.7 + 0.3 * (t / 2.8); bez(u, H.pos); bez(Math.min(1, u + 0.02), tmp);
          H.vel.subVectors(tmp, H.pos); faceTo(H.vel, 1);
          g.rotation.z = -0.22 * Math.sin(Math.PI * Math.min(1, u * 1.15)); g.rotation.x = 0.08 * Math.sin(u * 5);
        } else {
          const v = Math.min(1, (t - 2.8) / 2.2);
          H.pos.copy(pad).setY(pad.y + 6 * (1 - v) * (1 - v));
          faceTo(tmp.copy(pad).sub(P0).setY(0), dt * 1.2);
          g.rotation.z = 0.1 * (1 - v); g.rotation.x = 0;                                           // 抬头减速，落稳放平
          if (v >= 1 && !st.preview) { H.mode = 'parked'; H.t = 0; H.landed = true; if (onTouchdown) onTouchdown(); }
        }
        H.rs = 1; ground = pad.y;
      } else if (H.mode === 'parked') {
        H.pos.copy(pad); g.rotation.z = 0; g.rotation.x = 0; H.rs = Math.max(0.2, 1 - H.t / 8); ground = H.t < 1.5 ? pad.y : null;
      } else if (H.mode === 'hover') {
        const sa = Math.min(s + 30, ridge.start + ridge.steps + 16), a = route.at(sa, -8, A);          // 前方 15 个单位、偏右 8、高 3.8：跟拍镜头的视野里（风雪里只剩剪影 + 光柱）
        tmp.copy(a.pos).setY(route.heightAt(s) + 4.2 + 0.3 * Math.sin(H.t * 1.3));                  // 高度跟着化身（山脊一路往上，按前面的路算会跑出画面上沿）
        H.pos.lerp(tmp, Math.min(1, dt * 0.8));
        if (st.avatar) faceTo(tmp2.subVectors(st.avatar, H.pos).setY(0), dt * 1.5);
        g.rotation.z = -0.05; g.rotation.x = 0.05 * Math.sin(H.t * 0.7);
        H.rs = 1; beamOn = true;
      } else if (H.mode === 'orbit') {
        // 相对登顶环绕镜头算角度：从镜头看过去顶峰的后方偏一侧进画面，横穿过去，再绕到镜头背后转回来，一圈 16 s（预览停在刚过正中那一下）
        const tt = st.preview ? 2.6 : H.t, c = route.at(N + 1.2).pos, ca = cam ? Math.atan2(cam.position.z - c.z, cam.position.x - c.x) : 0, th = ca + Math.PI - 0.7 + 0.39 * tt;
        H.pos.set(c.x + Math.cos(th) * 26, route.heightAt(N) + 7 + 1.2 * Math.sin(tt * 0.7), c.z + Math.sin(th) * 26);
        faceTo(tmp.set(-Math.sin(th), 0, Math.cos(th)), 1);
        g.rotation.z = -0.12; g.rotation.x = 0.28;                                                  // 往圆心那边压一点坡度
        H.rs = 1;
        if (H.t > 2 * Math.PI / 0.39) { start('leave'); H.orbitDone = true; }
      } else if (H.mode === 'leave') {
        H.pos.addScaledVector(H.vel, dt * (4 + 6 * H.t)); g.rotation.z = -0.2; g.rotation.x = 0;
        H.rs = 1; if (H.t > 6) H.mode = 'none';
      } else H.rs = 0;
      // ---- 画 ----
      const on = H.mode !== 'none';
      g.scale.setScalar(on ? 1 : 1e-6); g.position.copy(H.pos); g.rotation.y = H.yaw;
      body.castShadow = on; rotor.castShadow = tail.castShadow = false;                            // 光影线第一帧给小物件都开了投影：旋翼太细不投，不在场时机身也不投（省阴影那遍绘制）
      rotor.rotation.y += dt * 16 * H.rs; tail.rotation.z += dt * 38 * H.rs;
      if (beamOn) {
        g.updateMatrixWorld(); tmp.copy(nose).applyMatrix4(g.matrixWorld);                         // 灯在机头下
        route.at(s + 5 + 3 * Math.sin(H.t * 0.5), 1.8 * Math.sin(H.t * 0.8), A); tmp2.copy(A.pos).setY(route.heightAt(s + 5));
        const L = tmp.distanceTo(tmp2); tmp2.sub(tmp).normalize();
        beam.position.copy(tmp); beam.quaternion.copy(q.setFromUnitVectors(DOWN, tmp2)); beam.scale.set(L * 0.09, L, L * 0.09);
      } else beam.scale.setScalar(1e-6);
      // 扬雪：离坪 4.5 以下越低越猛，从机身下往外喷
      if (spray) {
        const hgt = ground === null ? 99 : H.pos.y - ground, I = smooth(4.5, 0.3, hgt) * H.rs;
        H.em += dt * 260 * I;
        const n = Math.floor(H.em);
        if (n > 0) { H.em -= n; spray.burst(H.pos.x, ground, H.pos.z, 1.2 + 2.2 * I, n, { up: 0.55, life: 1.3, size: 2.4, spread: 1.3, floor: true }); }
        spray.update(dt, cam);
      }
      const d = cam ? cam.position.distanceTo(H.pos) : 99;
      snd.set(on ? H.rs * Math.pow(Math.max(0, 1 - d / 60), 1.3) : 0, H.rs);
    },
  };
}
