// 牦牛驮队（docs/珠峰-架构.md §2 ★新）：7 头，在东绒布冰川（zonesOf 的 glacier）沿路外侧（路右，影子道再往外）迎面下山；
//   走步：相位按地面速度 / 步幅走（蹄子不打滑），身子左右轻晃，头随步点两下，尾巴甩、偶尔猛甩一下。
//   让路：化身到前面 3.2 步以内 → 先停下转头看外侧（0.6 s）→ 身子斜过去侧步让到 lat −2.9 → 站住，头跟着化身转；化身过去 1.5 步后头转回来、身子摆正、接着下山。
//   铜铃叮当，按离镜头的距离由远及近。
//   第一头开始让路那一帧 onYield（峰哥说一句）。只读 s，不碰控制。模型见 yak_model.js：整群 1 次绘制（+ 冰川上阴影 1 次），约 7k 三角形。
//   每头大小、胖瘦、毛色、驮包颜色都不一样（实例属性）。?fx=low 整个不建（snow_summit.js 里判）。
import * as THREE from 'three';
import { yakGeo, yakMaterials, FUR } from './yak_model.js';

const LAT = -1.9, ASIDE = -2.9, SPEED = 0.4, SIDE_V = 0.6, STRIDE = 0.7, TURN = 0.55;   // 评审 r1：0.55 / 0.85 看着像小跑   // 横向位置（负 = 路右）、下山速度（步 / s）、侧步速度（单位 / s）、步幅、转头角
const Y = new THREE.Vector3(0, 1, 0);
// 毛色（评审 r1 #4、考据 §2 §9-9：以黑为主）：4 黑、1 棕、1 深灰、1 灰白。实例属性是乘在 FUR 上的系数，按线性色算（目标色 / FUR）
const FURS = ['#231c18', '#1b1613', '#6a4a34', '#2a221d', '#55504c', '#1f1915', '#c9c4bb'].map(h => { const c = new THREE.Color(h), b = new THREE.Color(FUR); return [c.r / b.r, c.g / b.g, c.b / b.b]; });
const PACKS = ['#c8322a', '#e0a93a', '#3f6fb0', '#2f8f4e', '#e8781c', '#8a5a9a', '#d8d2c2'].map(c => new THREE.Color(c));

export function buildYaks(ctx, { Z, hAt, onYield }) {
  const { route, scene, kit } = ctx, R = ctx.rand, gl = Z.glacier;
  if (!gl) return null;
  const n = 7, s0 = gl.start + gl.steps * 0.3,   // 间距拉到 2.4 后整队 17 步长：起点往下挪，最后一头也在前进营地以下（考据 §9-9：牦牛只到 ABC）
    geos = [0, 1, 2].map(l => yakGeo(kit, l)), geo = geos[0], M = yakMaterials();   // LOD 三级：离镜头最近那头 < 14 全细节、< 30 中、再远粗
  const fur = new Float32Array(n * 3), pack = new Float32Array(n * 3), anim = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) { fur.set(FURS[k % FURS.length], k * 3); const c = PACKS[(k * 3) % PACKS.length]; pack.set([c.r, c.g, c.b], k * 3); }
  const aFur = new THREE.InstancedBufferAttribute(fur, 3), aPack = new THREE.InstancedBufferAttribute(pack, 3), aAnim = new THREE.InstancedBufferAttribute(anim, 4);
  for (const gg of geos) { gg.setAttribute('aFur', aFur); gg.setAttribute('aPack', aPack); gg.setAttribute('aAnim', aAnim); }
  let lod = 0;
  const body = new THREE.InstancedMesh(geo, M.mat, n);
  body.customDepthMaterial = M.depth; body.name = 'yaks'; body.frustumCulled = false; scene.add(body);
  const herd = () => Array.from({ length: n }, (_, k) => ({ s: s0 + k * 2.4 + R() * 0.4,   // 间距 2.4 步（测试报告：1.6 迎面挤成一团）
    base: LAT + 0.25 * Math.sin(k * 2.1), cl: LAT + 0.25 * Math.sin(k * 2.1), ph: R() * 6, tp: R() * 6, flick: 0, bell: R() * 1.5, pitch: 0.88 + R() * 0.28,
    sc: 0.74 + R() * 0.18, fat: 0.92 + R() * 0.16, walk: 0, st: 'walk', t: 0, byaw: 0, hyaw: 0, aside: ASIDE - 0.22 * (k % 3) }));   // 让开的位置错开（别站成一堵墙）
  let yk = herd(), yielded = false, lastS = 0, bellT = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3(), A = {};

  return {
    meshes: [body],
    update(dt, st) {
      const s = st.s, cam = st.camera;
      if (s < lastS - 5) { yk = herd(); yielded = false; }                          // 新一圈：重新排到冰川上
      lastS = s;
      const active = st.preview || s > gl.start - 0.5;
      bellT -= dt;
      yk.forEach((y, k) => {
        route.at(y.s, y.cl, A);
        const base = -A.heading + Math.PI, so = Math.sign(Math.sin(base) * A.left.x + Math.cos(base) * A.left.z) || 1;   // so：往路外侧转是正还是负（跟着牦牛自己的朝向算）
        const ahead = y.s - s, near = ahead < 3.2 && ahead > -1.5;
        // ---- 让路的几拍 ----
        if (near && y.st === 'walk') { y.st = 'look'; y.t = 0; if (!yielded) { yielded = true; if (onYield) onYield(); } }
        else if (ahead <= -1.5 && (y.st === 'look' || y.st === 'step' || y.st === 'stand')) { y.st = 'resume'; y.t = 0; }
        y.t += dt;
        if (y.st === 'look' && y.t > 0.6) { y.st = 'step'; y.t = 0; }
        else if (y.st === 'step' && Math.abs(y.aside - y.cl) < 0.02) { y.st = 'stand'; y.t = 0; }
        else if (y.st === 'resume' && Math.abs(y.base - y.cl) < 0.02 && y.t > 0.8) y.st = 'walk';
        let v = 0, tl = y.base, bodyT = 0, headT = 0.05 * Math.sin(y.ph) * y.walk;
        if (y.st === 'walk') v = active ? SPEED : 0;
        else if (y.st === 'look') headT = TURN * so;
        else if (y.st === 'step') { tl = y.aside; bodyT = 0.6 * so; headT = TURN * so; }
        else if (y.st === 'stand') {                                                 // 站住，头跟着化身转
          tl = y.aside; bodyT = 0.25 * so;
          if (st.avatar) { const yw = base + y.byaw, dx = st.avatar.x - A.pos.x, dz = st.avatar.z - A.pos.z; headT = Math.max(-0.9, Math.min(0.9, Math.atan2(-dx * Math.sin(yw) - dz * Math.cos(yw), dx * Math.cos(yw) - dz * Math.sin(yw)))); }
        } else if (y.st === 'resume') { bodyT = -0.35 * so; v = active ? SPEED * 0.6 : 0; }
        y.s -= v * dt;
        const dl = Math.max(-dt * SIDE_V, Math.min(dt * SIDE_V, tl - y.cl)); y.cl += dl;
        const gs = v * 0.5 + Math.abs(dl) / Math.max(dt, 1e-3);                     // 地面速度（单位 / s）
        y.walk += ((gs > 0.02 ? 1 : 0) - y.walk) * Math.min(1, dt * 5);
        y.ph += dt * Math.PI * 2 * gs / (STRIDE * y.sc);                            // 步相位跟着真走的距离走：蹄子不打滑
        y.byaw += (bodyT - y.byaw) * Math.min(1, dt * 3); y.hyaw += (headT - y.hyaw) * Math.min(1, dt * 4);
        if ((y.flick -= dt) < -2 - k * 0.37) y.flick = 0.5;                          // 隔一阵猛甩一下尾巴
        y.tp += dt * (2 + 1.2 * y.walk + (y.flick > 0 ? 9 : 0));
        // 铃：走着 / 刚让开的时候隔一阵叮当一下；按离镜头的距离定音量（远处听得见一点，走近了清楚）
        if ((y.bell -= dt) <= 0) {
          y.bell = 0.7 + R() * 1.0;
          if (active && bellT <= 0 && cam) { const d = cam.position.distanceTo(A.pos); if (d < 26) { kit.sfx('yakbell', Math.pow(1 - d / 26, 1.5) * (0.4 + 0.6 * y.walk), { pitch: y.pitch }); bellT = 0.15; } }
        }
        route.at(y.s, y.cl, A);
        e.set(0.035 * Math.sin(y.ph) * y.walk, base + y.byaw, 0, 'YXZ'); q.setFromEuler(e);      // 走起来身子左右轻晃
        p.copy(A.pos).setY(Math.max(hAt(A.pos.x, A.pos.z), route.heightAt(y.s) - 0.3) + 0.03 * Math.abs(Math.sin(y.ph)) * y.walk);
        body.setMatrixAt(k, m4.compose(p, q, sc.set(y.sc * y.fat, y.sc, y.sc * y.fat)));
        anim.set([y.ph, y.walk, y.hyaw, y.tp], k * 4);
      });
      body.instanceMatrix.needsUpdate = true; aAnim.needsUpdate = true;
      if (cam) {                                                                    // LOD：按离镜头最近那头算，带回差（不在边界上来回跳）
        let dmin = 1e9; for (const y of yk) { route.at(y.s, y.cl, A); dmin = Math.min(dmin, cam.position.distanceTo(A.pos)); }
        const want = dmin < (lod === 0 ? 15 : 13) ? 0 : dmin < (lod === 1 ? 32 : 28) ? 1 : 2;
        if (want !== lod) { lod = want; body.geometry = geos[lod]; }
      }
      body.castShadow = s < gl.start + gl.steps + 14;                                   // 过了冰川整群不投（省阴影那遍绘制）
    },
  };
}
