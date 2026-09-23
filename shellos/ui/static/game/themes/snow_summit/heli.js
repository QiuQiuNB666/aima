// 直升机（docs/珠峰-架构.md §2 ★新）：AS350 一类比例的低模（heli_model.js：放样曲面机舱、救援涂装、3 片扭角桨），主旋翼 / 尾桨在转。三段脚本，只看 s / summit：
//   ① 开场：第一次迈步（导游讲完、按住 R2 走起来）→ 从镜头后上方掠过，5 s 落到停机坪，贴地时旋翼扬雪；落地那一帧 onTouchdown（峰哥说一句）；
//      落地后旋翼慢慢降速、停在坪上，走远了就不画
//   ② 北山脊·大风口（zonesOf 的 ridge）：远处侧前方悬停，一束探照灯往前面的山脊上扫；出了大风口就飞走
//   ③ 登顶：绕顶飞一圈（半径 26、高 +7，起点在镜头看过去的后方），一圈后飞走
//   旋翼声（kit.sfxLoop('rotor')）按离镜头的距离和转速混音，?sfx=0 关。
//   2 次绘制（整架 / 光束）+ 扬雪粒子 1 次（300 粒，?fx=low 不要）+ 在场时阴影 1 次，约 1.2k 三角形。藏起来 = 缩成点（照样在绘制列表里，第一次出场不卡）
import * as THREE from 'three';
import { buildHeliMesh } from './heli_model.js';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const Y = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
export function buildHeli(ctx, { Z, pad, LOW, onTouchdown }) {
  const { route, util, kit, scene } = ctx, N = route.N;
  const g = new THREE.Group(); g.name = 'heli'; g.rotation.order = 'YZX';
  const M = buildHeliMesh(), body = M.mesh;
  g.add(body); scene.add(g);
  // 探照灯光束：锥（尖 = 灯，底 = 照到的地方），加色、不受雾（风雪里一道光柱）
  const bg = new THREE.ConeGeometry(1, 1, 18, 1, true).translate(0, -0.5, 0), bp = bg.attributes.position, bc = [];
  for (let i = 0; i < bp.count; i++) { const k = Math.pow(1 + bp.getY(i), 1.6); bc.push(1 * k, 0.96 * k, 0.82 * k); }
  bg.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
  const beam = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false }));
  beam.name = 'heliBeam'; beam.renderOrder = 6; scene.add(beam);
  for (const m of [body, beam]) m.frustumCulled = false;
  const spray = LOW ? null : kit.particles(ctx, { color: '#f4f8ff', alpha: 0.75, n: 300, gravity: 0.5, name: 'heliSnow' });
  const snd = kit.sfxLoop('rotor');

  const bcEnd = route.segs[0] ? route.segs[0].start + route.segs[0].steps : 3, ridge = Z.ridge;
  const h0 = route.heightAt(0), P0 = route.at(-16, 2).pos.setY(h0 + 13), C0 = route.at(4, -1.5).pos.setY(h0 + 10), P1 = pad.clone().setY(pad.y + 6);
  const H = { mode: 'none', t: 0, lastS: 0, landed: false, orbitDone: false, rs: 0, em: 0, rot: 0, tr: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0 };
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), nose = M.nose, q = new THREE.Quaternion(), A = {};
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
      body.castShadow = on;                                                                       // 不在场时不投影（省阴影那遍绘制）
      H.rot += dt * 16 * H.rs; H.tr += dt * 38 * H.rs; M.setSpin(H.rot, H.tr);
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
