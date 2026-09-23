// 直升机（docs/珠峰-架构.md §2 ★新）：AS350 一类比例的低模（heli_model.js：放样曲面机舱、「应急」涂装、3 片扭角桨），主旋翼 / 尾桨在转。只看 s：
//   开场第一次迈步（导游讲完、按住 R2 走起来）→ 从镜头后上方掠过，5 s 落到大本营的临时起降点，贴地时旋翼扬雪；落地那一帧 onTouchdown
//   （峰哥「亡命小飞机」）；落地后旋翼慢慢降速、停在坪上，走远了就不画。
//   评审 r1 折中（考据 §8：北坡禁飞）：大风口悬停 + 探照灯、登顶绕飞都删了，只留这一次降落。
//   旋翼声（kit.sfxLoop('rotor')）按离镜头的距离和转速混音，?sfx=0 关。
//   2 次绘制（整架 / 旋翼模糊盘）+ 扬雪粒子 1 次（300 粒，?fx=low 不要）+ 在场时阴影 1 次，约 1.2k 三角形。
//   藏起来：前两帧缩成点（照样画一遍，管线先建好），之后直接 visible = false（不占绘制）
import * as THREE from 'three';
import { buildHeliMesh } from './heli_model.js';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function buildHeli(ctx, { pad, LOW, onTouchdown }) {
  const { route, util, kit, scene } = ctx;
  const g = new THREE.Group(); g.name = 'heli'; g.rotation.order = 'YZX';
  const M = buildHeliMesh(), body = M.mesh;
  g.add(body); scene.add(g);
  const spray = LOW ? null : kit.particles(ctx, { color: '#f4f8ff', alpha: 0.75, n: 300, gravity: 0.5, name: 'heliSnow' });
  const snd = kit.sfxLoop('rotor');

  const bcEnd = route.segs[0] ? route.segs[0].start + route.segs[0].steps : 3;
  // 开场降落：一条三次曲线（镜头后上方 → 镜头上空 → 停机坪前上方 → 坪面），时间按「先快后慢」走，到坪上速度正好为 0（软着陆）
  const h0 = route.heightAt(0), P0 = route.at(-16, 2).pos.setY(h0 + 14), C1 = route.at(2, -1).pos.setY(h0 + 12);
  const apr = new THREE.Vector3().subVectors(pad, C1).setY(0).normalize(), C2 = pad.clone().addScaledVector(apr, -4.5).setY(pad.y + 5), T_LAND = 6;
  const H = { mode: 'none', t: 0, lastS: 0, landed: false, frames: 0, rs: 0, em: 0, rot: 0, tr: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0,
    prev: null, v: new THREE.Vector3(), a: new THREE.Vector3(), pitch: 0, roll: 0 };
  const tmp = new THREE.Vector3(), pv = new THREE.Vector3(), da = new THREE.Vector3();
  const start = (m) => { H.mode = m; H.t = 0; H.prev = null; };
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
      // ---- 选脚本：开场降落 → 停在坪上 → 走远了不画 ----
      if (st.summit) H.mode = 'none';
      else if (H.mode === 'none' && !H.landed && s < bcEnd + 10 && (s > 0.05 || st.preview)) start('land');
      else if (H.mode === 'parked' && s > bcEnd + 24) H.mode = 'none';
      else if (H.mode === 'land' && st.preview && s > bcEnd + 12) H.mode = 'none';           // 预览直接跳到山上：别让开场那架还悬在大本营
      H.t += dt;
      let ground = null;
      // ---- 各段怎么飞（只定位置和机头朝向；俯仰 / 侧倾统一按加速度算，见下面） ----
      if (H.mode === 'land') {
        const t = st.preview ? 4.4 : H.t, u = 1 - Math.pow(1 - Math.min(1, t / T_LAND), 2.2);      // 预览停在离坪 1 左右（扬雪最猛）
        cubic(u, H.pos); cubic(Math.min(1, u + 0.01), tmp); tmp.sub(H.pos).setY(0);
        if (tmp.lengthSq() > 1e-6) faceTo(tmp, Math.min(1, dt * 3));
        if (t >= T_LAND && !st.preview) { H.mode = 'parked'; H.t = 0; H.landed = true; if (onTouchdown) onTouchdown(); }
        H.rs = 1; ground = pad.y;
      } else if (H.mode === 'parked') {
        H.pos.copy(pad); H.rs = Math.max(0.2, 1 - H.t / 8); ground = H.t < 1.5 ? pad.y : null;
      } else H.rs = 0;
      // ---- 姿态：机头俯仰跟前后加速度（加速低头、减速抬头）、前飞略低头；侧倾跟横向加速度（转弯往里压） ----
      if (H.prev && dt > 1e-4 && !st.preview) {
        pv.subVectors(H.pos, H.prev).divideScalar(dt); if (pv.length() > 40) pv.setLength(40);
        da.subVectors(pv, H.v).divideScalar(dt); if (da.length() > 30) da.setLength(30);
        H.a.lerp(da, Math.min(1, dt * 3)); H.v.copy(pv);
      } else if (!H.prev) { H.v.set(0, 0, 0); H.a.set(0, 0, 0); }
      H.prev = (H.prev || new THREE.Vector3()).copy(H.pos);
      const fx = Math.cos(H.yaw), fz = -Math.sin(H.yaw), aF = H.a.x * fx + H.a.z * fz, aL = H.a.x * -fz + H.a.z * fx, vF = H.v.x * fx + H.v.z * fz;
      const pT = H.mode === 'parked' ? 0 : Math.max(-0.32, Math.min(0.25, -0.045 * aF - 0.018 * vF));
      const rT = H.mode === 'parked' ? 0 : Math.max(-0.4, Math.min(0.4, 0.05 * aL));
      H.pitch += (pT - H.pitch) * Math.min(1, dt * 3); H.roll += (rT - H.roll) * Math.min(1, dt * 3);
      g.rotation.z = H.pitch; g.rotation.x = H.roll;
      disc.material.opacity = smooth(0.55, 1, H.rs) * 0.9;
      // ---- 画 ----
      const on = H.mode !== 'none', warm = ++H.frames > 2;
      g.scale.setScalar(on || warm ? 1 : 1e-6); g.visible = on || !warm; g.position.copy(H.pos); g.rotation.y = H.yaw;
      for (const m of M.meshes) m.castShadow = on;                                               // 不在场时不投影（省阴影那遍绘制）
      H.rot += dt * 16 * H.rs; H.tr += dt * 38 * H.rs; M.setSpin(H.rot, H.tr);
      // 扬雪：离坪 5 以下越低越猛，贴地往外散（粒子的初速度方向 = 离开中心的方向）
      if (spray) {
        const hgt = ground === null ? 99 : H.pos.y - ground, I = smooth(5, 0.3, hgt) * H.rs;
        H.em += dt * 260 * I;
        const n = Math.floor(H.em);
        if (n > 0) { H.em -= n; spray.burst(H.pos.x, ground, H.pos.z, 2.2 + 3.2 * I, n, { up: 0.3, life: 1.5, size: 3.2, spread: 1.6, floor: true }); }   // 下洗气流：从桨下贴地往外吹
        spray.update(dt, cam); spray.points.visible = on || !warm;                                 // 走远了连扬雪那次绘制也省掉
      }
      const d = cam ? cam.position.distanceTo(H.pos) : 99;
      snd.set(on ? H.rs * Math.pow(Math.max(0, 1 - d / 60), 1.3) : 0, H.rs);
    },
  };
}
