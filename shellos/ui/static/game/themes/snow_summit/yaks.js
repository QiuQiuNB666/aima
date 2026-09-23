// 牦牛驮队（docs/珠峰-架构.md §2 ★新）：7 头，instanced，在东绒布冰川（zonesOf 的 glacier）沿路外侧（路右，影子道再往外）迎面下山；
//   化身走到前面 3.2 步以内 → 往外让到 lat −2.9、站住；化身过去 1.5 步后接着往下走。铜铃叮当，按离镜头的距离由远及近。
//   第一头开始让路那一帧 onYield（峰哥说一句）。只读 s，不碰控制。2 次绘制（身子 / 腿）+ 冰川上身子阴影 1 次，约 3k 三角形。?fx=low 整个不建（snow_summit.js 里判）。
import * as THREE from 'three';
import { yakBell } from './audio.js';

const LAT = -1.9, ASIDE = -2.9, SPEED = 0.55;                               // 横向位置（负 = 路右）、下山速度（步 / s）
const HIPS = [[0.46, 0.2, 0], [0.46, -0.2, Math.PI], [-0.46, 0.2, Math.PI], [-0.46, -0.2, 0]];   // 腿：x 前后、z 左右、相位（对角同步）
const Y = new THREE.Vector3(0, 1, 0), Z3 = new THREE.Vector3(0, 0, 1);

// 牦牛（头 = +x，地面 = y 0）：长毛垂到膝盖的黑身子、肩峰、白角、红黄驮包、铜铃
function yakGeo(util) {
  const B = '#35271e', D = '#241a14', ico = () => new THREE.IcosahedronGeometry(1, 1);
  const horn = z => ({ geo: new THREE.ConeGeometry(0.055, 0.38, 5), p: [0.76, 1.0, z], q: new THREE.Quaternion().setFromEuler(new THREE.Euler(z > 0 ? 0.95 : -0.95, 0, -0.3)), color: '#efe8d6' });
  return util.merged([
    { geo: ico(), p: [0, 0.95, 0], s: [0.72, 0.36, 0.33], color: B },                                  // 身子
    { geo: ico(), p: [0.3, 1.08, 0], s: [0.36, 0.3, 0.28], color: B },                                 // 肩峰
    { geo: new THREE.CylinderGeometry(0.5, 0.62, 0.36, 10), p: [0, 0.7, 0], s: [1.25, 1, 0.52], color: D },   // 垂到膝盖的长毛（椭圆裙）
    { geo: ico(), p: [0.78, 0.84, 0], s: [0.22, 0.17, 0.16], color: B },                                // 头
    { geo: new THREE.BoxGeometry(0.14, 0.12, 0.15), p: [0.97, 0.78, 0], color: '#7a6450' },            // 嘴（浅一点）
    horn(0.16), horn(-0.16),
    { geo: new THREE.CylinderGeometry(0.03, 0.06, 0.5, 5), p: [-0.76, 0.8, 0], q: new THREE.Quaternion().setFromAxisAngle(Z3, 0.5), color: D },   // 尾巴
    { geo: new THREE.BoxGeometry(0.46, 0.26, 0.16), p: [0.02, 1.05, 0.36], color: '#c8322a' },          // 驮包
    { geo: new THREE.BoxGeometry(0.46, 0.26, 0.16), p: [0.02, 1.05, -0.36], color: '#e0a93a' },
    { geo: new THREE.BoxGeometry(0.58, 0.07, 0.8), p: [0.02, 1.27, 0], color: '#d9d2c2' },              // 盖布
    { geo: new THREE.ConeGeometry(0.06, 0.1, 6), p: [0.68, 0.6, 0], color: '#c9a64a' },                 // 铃
  ]);
}

export function buildYaks(ctx, { Z, hAt, onYield }) {
  const { route, util, scene } = ctx, R = ctx.rand, gl = Z.glacier;
  if (!gl) return null;
  const n = 7, s0 = gl.start + gl.steps * 0.5;
  const body = new THREE.InstancedMesh(yakGeo(util), new THREE.MeshLambertMaterial({ vertexColors: true }), n);
  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.11, 0.66, 0.12).translate(0, -0.33, 0), new THREE.MeshLambertMaterial({ color: '#241a14' }), n * 4);
  const c = new THREE.Color();
  for (let k = 0; k < n; k++) body.setColorAt(k, c.setScalar(0.85 + 0.3 * R()));
  body.name = 'yaks'; legs.name = 'yakLegs';
  for (const m of [body, legs]) { m.frustumCulled = false; scene.add(m); }
  const herd = () => Array.from({ length: n }, (_, k) => ({ s: s0 + k * 1.6 + R() * 0.4, cl: LAT + 0.25 * Math.sin(k * 2.1), ph: R() * 6, bell: R() * 1.5, pitch: 0.88 + R() * 0.28, sc: 0.8 + R() * 0.14, walk: 0 }));
  let yk = herd(), yielded = false, lastS = 0, bellT = 0;
  const m4 = new THREE.Matrix4(), m5 = new THREE.Matrix4(), q = new THREE.Quaternion(), qs = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), A = {};

  return {
    meshes: [body, legs],
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
        y.walk += ((moving ? 1 : 0) - y.walk) * Math.min(1, dt * 4); y.ph += dt * 6.5 * y.walk;
        // 铃：走着 / 刚让开的时候隔一阵叮当一下；按离镜头的距离定音量（远处听得见一点，走近了清楚）
        if ((y.bell -= dt) <= 0) {
          y.bell = 0.7 + R() * 1.0;
          if (active && bellT <= 0 && cam) { route.at(y.s, y.cl, A); const d = cam.position.distanceTo(A.pos); if (d < 26) { yakBell(Math.pow(1 - d / 26, 1.5) * (0.4 + 0.6 * y.walk), y.pitch); bellT = 0.15; } }
        }
        route.at(y.s, y.cl, A);
        const yaw = -A.heading + Math.PI - Math.sign(dl) * Math.min(0.6, Math.abs(dl) / Math.max(dt, 1e-3) * 0.5);   // 头朝下山；往外挪的时候身子斜过去
        q.setFromAxisAngle(Y, yaw);
        p.copy(A.pos).setY(Math.max(hAt(A.pos.x, A.pos.z), route.heightAt(y.s) - 0.3) + 0.025 * Math.abs(Math.sin(y.ph)) * y.walk);
        body.setMatrixAt(k, m4.compose(p, q, sc.setScalar(y.sc)));
        HIPS.forEach(([hx, hz, ph], j) => {
          m5.compose(p.set(hx, 0.66, hz), qs.setFromAxisAngle(Z3, 0.42 * Math.sin(y.ph + ph) * y.walk), sc.setScalar(1));
          legs.setMatrixAt(k * 4 + j, m5.premultiply(m4));
        });
      });
      body.instanceMatrix.needsUpdate = legs.instanceMatrix.needsUpdate = true;
      body.castShadow = s < gl.start + gl.steps + 14; legs.castShadow = false;                    // 腿太细不投；过了冰川整群不投（省阴影那遍绘制）
    },
  };
}
