// 直升机（docs/珠峰-架构.md §2 ★新）：AS350 一类比例的低模（heli_model.js：放样曲面机舱、救援涂装、3 片扭角桨），主旋翼 / 尾桨在转。三段脚本，只看 s / summit：
//   ① 开场：第一次迈步（导游讲完、按住 R2 走起来）→ 从镜头后上方掠过，5 s 落到停机坪，贴地时旋翼扬雪；落地那一帧 onTouchdown（峰哥说一句）；
//      落地后旋翼慢慢降速、停在坪上，走远了就不画
//   ② 北山脊·大风口（zonesOf 的 ridge）：远处侧前方悬停，一束探照灯往前面的山脊上扫；出了大风口就飞走
//   ③ 登顶：绕顶飞一圈（半径 26、高 +7，起点在镜头看过去的后方），一圈后飞走
//   旋翼声（kit.sfxLoop('rotor')）按离镜头的距离和转速混音，?sfx=0 关。
//   3 次绘制（整架 / 旋翼模糊盘 / 光束）+ 扬雪粒子 1 次（300 粒，?fx=low 不要）+ 在场时阴影 1 次，约 1.2k 三角形。藏起来 = 缩成点（照样在绘制列表里，第一次出场不卡）
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
  // 开场降落：一条三次曲线（镜头后上方 → 镜头上空 → 停机坪前上方 → 坪面），时间按「先快后慢」走，到坪上速度正好为 0（软着陆）
  const h0 = route.heightAt(0), P0 = route.at(-16, 2).pos.setY(h0 + 14), C1 = route.at(2, -1).pos.setY(h0 + 12);
  const apr = new THREE.Vector3().subVectors(pad, C1).setY(0).normalize(), C2 = pad.clone().addScaledVector(apr, -4.5).setY(pad.y + 5), T_LAND = 6;
  const H = { mode: 'none', t: 0, lastS: 0, landed: false, orbitDone: false, rs: 0, em: 0, rot: 0, tr: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0,
    prev: null, v: new THREE.Vector3(), a: new THREE.Vector3(), pitch: 0, roll: 0 };
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), nose = M.nose, q = new THREE.Quaternion(), A = {}, pv = new THREE.Vector3(), da = new THREE.Vector3();
  const start = (m) => { H.mode = m; H.t = 0; H.prev = null; if (m === 'leave') H.vel.set(Math.cos(H.yaw), 0.3, -Math.sin(H.yaw)).normalize(); };   // 飞走：沿机头方向爬升
  const faceTo = (d, k) => { const y = Math.atan2(-d.z, d.x); let dy = y - H.yaw; dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI; H.yaw += dy * Math.min(1, k); };
  const cubic = (u, out) => { const w = 1 - u; return out.copy(P0).multiplyScalar(w * w * w).addScaledVector(C1, 3 * w * w * u).addScaledVector(C2, 3 * w * u * u).addScaledVector(pad, u * u * u); };
  // 旋翼模糊盘：转得快时一层半透明的盘（桨尖一圈黄），慢下来就淡掉只剩桨叶
  const discTex = util.canvasTexture(256, 256, (c, w) => {
    const r = c.createRadialGradient(w / 2, w / 2, w * 0.05, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(40,42,46,0)'); r.addColorStop(0.35, 'rgba(40,42,46,0.10)'); r.addColorStop(0.86, 'rgba(40,42,46,0.22)');
    r.addColorStop(0.92, 'rgba(240,194,58,0.38)'); r.addColorStop(0.97, 'rgba(40,42,46,0.16)'); r.addColorStop(1, 'rgba(40,42,46,0)');
    c.fillStyle = r; c.fillRect(0, 0, w, w);
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(M.rotorR, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: discTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  disc.position.set(0, M.hubY + 0.04, 0); disc.name = 'rotorDisc'; disc.frustumCulled = false; disc.renderOrder = 5; g.add(disc);

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
      else if (H.mode === 'land' && st.preview && s > bcEnd + 12) H.mode = 'none';           // 预览直接跳到山上：别让开场那架还悬在大本营
      H.t += dt;
      let beamOn = false, ground = null, wob = 0;
      // ---- 各段怎么飞（只定位置和机头朝向；俯仰 / 侧倾统一按加速度算，见下面） ----
      if (H.mode === 'land') {
        const t = st.preview ? 4.4 : H.t, u = 1 - Math.pow(1 - Math.min(1, t / T_LAND), 2.2);      // 预览停在离坪 1 左右（扬雪最猛）
        cubic(u, H.pos); cubic(Math.min(1, u + 0.01), tmp); tmp.sub(H.pos).setY(0);
        if (tmp.lengthSq() > 1e-6) faceTo(tmp, Math.min(1, dt * 3));
        if (t >= T_LAND && !st.preview) { H.mode = 'parked'; H.t = 0; H.landed = true; if (onTouchdown) onTouchdown(); }
        H.rs = 1; ground = pad.y;
      } else if (H.mode === 'parked') {
        H.pos.copy(pad); H.rs = Math.max(0.2, 1 - H.t / 8); ground = H.t < 1.5 ? pad.y : null;
      } else if (H.mode === 'hover') {
        // 悬停：跟着化身往前挪的锚点 + 慢慢漂（几个不同周期的正弦叠起来）+ 机身轻轻晃
        const sa = Math.min(s + 30, ridge.start + ridge.steps + 16), a = route.at(sa, -8, A), T = H.t;
        tmp.copy(a.pos).setY(route.heightAt(s) + 4.2).add(tmp2.set(0.5 * Math.sin(T * 0.31) + 0.25 * Math.sin(T * 0.83 + 1), 0.3 * Math.sin(T * 0.57 + 2), 0.5 * Math.cos(T * 0.27) + 0.2 * Math.sin(T * 0.71)));
        H.pos.lerp(tmp, Math.min(1, dt * 0.8));
        if (st.avatar) faceTo(tmp2.subVectors(st.avatar, H.pos).setY(0), dt * 1.2);
        H.rs = 1; beamOn = true; wob = 1;
      } else if (H.mode === 'orbit') {
        // 相对登顶环绕镜头算角度：从镜头看过去顶峰的后方偏一侧进画面，横穿过去，再绕到镜头背后转回来，一圈 16 s（预览停在刚过正中那一下）
        const tt = st.preview ? 2.6 : H.t, c = route.at(N + 1.2).pos, ca = cam ? Math.atan2(cam.position.z - c.z, cam.position.x - c.x) : 0, th = ca + Math.PI - 0.7 + 0.39 * tt;
        H.pos.set(c.x + Math.cos(th) * 26, route.heightAt(N) + 7 + 1.2 * Math.sin(tt * 0.7), c.z + Math.sin(th) * 26);
        faceTo(tmp.set(-Math.sin(th), 0, Math.cos(th)), 1);
        H.rs = 1;
        if (H.t > 2 * Math.PI / 0.39) { start('leave'); H.orbitDone = true; }
      } else if (H.mode === 'leave') {
        H.pos.addScaledVector(H.vel, dt * (4 + 6 * H.t)); H.rs = 1; if (H.t > 6) H.mode = 'none';
      } else H.rs = 0;
      // ---- 姿态：机头俯仰跟前后加速度（加速低头、减速抬头）、前飞略低头；侧倾跟横向加速度（转弯往里压）；悬停再加一点晃 ----
      if (H.prev && dt > 1e-4 && !st.preview) {
        pv.subVectors(H.pos, H.prev).divideScalar(dt); if (pv.length() > 40) pv.setLength(40);
        da.subVectors(pv, H.v).divideScalar(dt); if (da.length() > 30) da.setLength(30);
        H.a.lerp(da, Math.min(1, dt * 3)); H.v.copy(pv);
      } else if (!H.prev) { H.v.set(0, 0, 0); H.a.set(0, 0, 0); }
      H.prev = (H.prev || new THREE.Vector3()).copy(H.pos);
      const fx = Math.cos(H.yaw), fz = -Math.sin(H.yaw), aF = H.a.x * fx + H.a.z * fz, aL = H.a.x * -fz + H.a.z * fx, vF = H.v.x * fx + H.v.z * fz;
      const pT = H.mode === 'parked' ? 0 : Math.max(-0.32, Math.min(0.25, -0.045 * aF - 0.018 * vF)) + wob * 0.035 * Math.sin(H.t * 0.7);
      const rT = H.mode === 'parked' ? 0 : Math.max(-0.4, Math.min(0.4, 0.05 * aL)) + wob * 0.045 * Math.sin(H.t * 0.9 + 1);
      H.pitch += (pT - H.pitch) * Math.min(1, dt * 3); H.roll += (rT - H.roll) * Math.min(1, dt * 3);
      g.rotation.z = H.pitch; g.rotation.x = H.roll;
      disc.material.opacity = smooth(0.55, 1, H.rs) * 0.9;
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
      // 扬雪：离坪 5 以下越低越猛，贴地往外散（粒子的初速度方向 = 离开中心的方向）
      if (spray) {
        const hgt = ground === null ? 99 : H.pos.y - ground, I = smooth(5, 0.3, hgt) * H.rs;
        H.em += dt * 260 * I;
        const n = Math.floor(H.em);
        if (n > 0) { H.em -= n; spray.burst(H.pos.x, ground, H.pos.z, 2.2 + 3.2 * I, n, { up: 0.3, life: 1.5, size: 3.2, spread: 1.6, floor: true }); }   // 下洗气流：从桨下贴地往外吹
        spray.update(dt, cam);
      }
      const d = cam ? cam.position.distanceTo(H.pos) : 99;
      snd.set(on ? H.rs * Math.pow(Math.max(0, 1 - d / 60), 1.3) : 0, H.rs);
    },
  };
}
