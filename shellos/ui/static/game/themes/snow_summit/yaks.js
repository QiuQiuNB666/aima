// 牦牛驮队（docs/珠峰-架构.md §2 ★新）：7 头，在东绒布冰川（zonesOf 的 glacier）沿路外侧（路右，影子道再往外）迎面下山；
//   化身走到前面 3.2 步以内 → 往外让到 lat −2.9、站住；化身过去 1.5 步后接着往下走。铜铃叮当，按离镜头的距离由远及近。
//   第一头开始让路那一帧 onYield（峰哥说一句）。只读 s，不碰控制。模型见 yak_model.js：整群 1 次绘制（+ 冰川上阴影 1 次），约 7k 三角形。
//   每头大小、胖瘦、毛色、驮包颜色都不一样（实例属性）。?fx=low 整个不建（snow_summit.js 里判）。
import * as THREE from 'three';
import { yakGeo, yakMaterials } from './yak_model.js';

const LAT = -1.9, ASIDE = -2.9, SPEED = 0.55;                               // 横向位置（负 = 路右）、下山速度（步 / s）
const Y = new THREE.Vector3(0, 1, 0);
const FURS = [[1, 1, 1], [0.72, 0.7, 0.72], [1.38, 1.18, 1.02], [1.12, 1.02, 0.95], [0.85, 0.8, 0.8], [1.55, 1.45, 1.35], [1.25, 1.08, 0.98]];   // 黑褐 / 纯黑 / 棕 / 灰白…
const PACKS = ['#c8322a', '#e0a93a', '#3f6fb0', '#2f8f4e', '#e8781c', '#8a5a9a', '#d8d2c2'].map(c => new THREE.Color(c));

export function buildYaks(ctx, { Z, hAt, onYield }) {
  const { route, scene, kit } = ctx, R = ctx.rand, gl = Z.glacier;
  if (!gl) return null;
  const n = 7, s0 = gl.start + gl.steps * 0.5, geo = yakGeo(kit), M = yakMaterials();
  const fur = new Float32Array(n * 3), pack = new Float32Array(n * 3), anim = new Float32Array(n * 4);
  for (let k = 0; k < n; k++) { fur.set(FURS[k % FURS.length], k * 3); const c = PACKS[(k * 3) % PACKS.length]; pack.set([c.r, c.g, c.b], k * 3); }
  geo.setAttribute('aFur', new THREE.InstancedBufferAttribute(fur, 3));
  geo.setAttribute('aPack', new THREE.InstancedBufferAttribute(pack, 3));
  const aAnim = new THREE.InstancedBufferAttribute(anim, 4); geo.setAttribute('aAnim', aAnim);
  const body = new THREE.InstancedMesh(geo, M.mat, n);
  body.customDepthMaterial = M.depth; body.name = 'yaks'; body.frustumCulled = false; scene.add(body);
  const herd = () => Array.from({ length: n }, (_, k) => ({ s: s0 + k * 1.6 + R() * 0.4, cl: LAT + 0.25 * Math.sin(k * 2.1), ph: R() * 6, tp: R() * 6, bell: R() * 1.5, pitch: 0.88 + R() * 0.28,
    sc: 0.74 + R() * 0.18, fat: 0.92 + R() * 0.16, walk: 0 }));
  let yk = herd(), yielded = false, lastS = 0, bellT = 0;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), A = {};

  return {
    meshes: [body],
    update(dt, st) {
      const s = st.s, cam = st.camera;
      if (s < lastS - 5) { yk = herd(); yielded = false; }                          // 新一圈：重新排到冰川上
      lastS = s;
      const active = st.preview || s > gl.start - 0.5;
      bellT -= dt;
      yk.forEach((y, k) => {
        const ahead = y.s - s, aside = ahead < 3.2 && ahead > -1.5;
        if (aside && !yielded) { yielded = true; if (onYield) onYield(); }
        const v = active && !aside ? SPEED : 0, tl = aside ? ASIDE : LAT + 0.25 * Math.sin(k * 2.1);
        y.s -= v * dt;
        const dl = Math.max(-dt * 1.4, Math.min(dt * 1.4, tl - y.cl)); y.cl += dl;
        const moving = v > 0 || Math.abs(dl) > 1e-4;
        y.walk += ((moving ? 1 : 0) - y.walk) * Math.min(1, dt * 4); y.ph += dt * 6.5 * y.walk; y.tp += dt * (1.6 + 1.5 * y.walk);
        // 铃：走着 / 刚让开的时候隔一阵叮当一下；按离镜头的距离定音量（远处听得见一点，走近了清楚）
        if ((y.bell -= dt) <= 0) {
          y.bell = 0.7 + R() * 1.0;
          if (active && bellT <= 0 && cam) { route.at(y.s, y.cl, A); const d = cam.position.distanceTo(A.pos); if (d < 26) { kit.sfx('yakbell', Math.pow(1 - d / 26, 1.5) * (0.4 + 0.6 * y.walk), { pitch: y.pitch }); bellT = 0.15; } }
        }
        route.at(y.s, y.cl, A);
        const yaw = -A.heading + Math.PI - Math.sign(dl) * Math.min(0.6, Math.abs(dl) / Math.max(dt, 1e-3) * 0.5);   // 头朝下山；往外挪的时候身子斜过去
        q.setFromAxisAngle(Y, yaw);
        p.copy(A.pos).setY(Math.max(hAt(A.pos.x, A.pos.z), route.heightAt(y.s) - 0.3) + 0.03 * Math.abs(Math.sin(y.ph)) * y.walk);
        body.setMatrixAt(k, m4.compose(p, q, sc.set(y.sc * y.fat, y.sc, y.sc * y.fat)));
        anim.set([y.ph, y.walk, 0, y.tp], k * 4);
      });
      body.instanceMatrix.needsUpdate = true; aAnim.needsUpdate = true;
      body.castShadow = s < gl.start + gl.steps + 14;                                   // 过了冰川整群不投（省阴影那遍绘制）
    },
  };
}
