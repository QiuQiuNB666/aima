// 华山的道具：铁链（链环 + 铁桩 + 同心锁 + 红布条）、华山松、玉泉院山门、长空栈道的铁架和保险链、南峰极顶石。
// 全部 instanced / merged：每类 1 次绘制。
import * as THREE from 'three';

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 走到才露面 / 走过就溶掉：片元按屏幕噪声丢弃（uRev 0 → 1），材质保持不透明。
//   另外离镜头 1.6 以内的片元也溶掉：镜头跟在化身后面 8 步，拐进峡缝 / 贴着崖壁时不会整屏都是墙
const DITHER = `uniform float uRev; varying vec3 vWp;
void dither(){ float h = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  if (h >= uRev * smoothstep(0.7, 1.6, distance(vWp, cameraPosition))) discard; }
`;
export function revealable(mat, rev) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uRev = rev;
    sh.vertexShader = 'varying vec3 vWp;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n#ifdef USE_INSTANCING\n  vWp = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\n  vWp = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif');
    sh.fragmentShader = DITHER + sh.fragmentShader.replace('void main() {', 'void main() {\n  dither();');
  };
  mat.customProgramCacheKey = () => 'cliffRev';
  return mat;
}
// 「藏」= 缩成一个点（还在绘制列表里，管线第一帧就建好；不出片元、不投影）
export function show(m, on) {
  if (m.userData.on === on) return;
  if (m.userData.fc === undefined) { m.userData.fc = m.frustumCulled; m.userData.s0 = m.scale.clone(); }   // 记下原来的缩放（有的石头 build 里就缩放过）
  m.userData.on = on; if (on) m.scale.copy(m.userData.s0); else m.scale.setScalar(1e-6); m.frustumCulled = on && m.userData.fc;
}

// 铁链：沿路 ranges=[[s0,s1],…] 两侧（sides）lat 处，每 every 步一根铁桩，桩间链子下垂；链上随机挂同心锁、红布条
export function chains(ctx, ranges, { lat = 1.45, sides = [1, -1], every = 1, h = 0.85, sag = 0.1, locks = 0.5 } = {}) {
  const { route, util } = ctx, R = ctx.rand, posts = [], links = [], lockI = [], ribbons = [];
  const LINK = 0.075;
  for (const [s0, s1] of ranges) for (const side of sides) {
    let prev = null;
    for (let s = s0; s <= s1 + 1e-6; s += every) {
      const a = route.at(s, side * lat), y = route.heightAt(s), p = a.pos.clone().setY(y + h);
      posts.push({ p: a.pos.clone().setY(y + h / 2 - 0.15), ry: -a.heading });
      if (prev) {
        const d = p.clone().sub(prev), len = d.length(), n = Math.max(2, Math.round(len / LINK));
        for (let k = 0; k < n; k++) {
          const f0 = k / n, f1 = (k + 1) / n, sagAt = f => -sag * 4 * f * (1 - f);
          const q0 = prev.clone().lerp(p, f0).addScaledVector(Y, sagAt(f0)), q1 = prev.clone().lerp(p, f1).addScaledVector(Y, sagAt(f1));
          const dir = q1.clone().sub(q0).normalize(), q = new THREE.Quaternion().setFromUnitVectors(X, dir);
          if (k % 2) q.multiply(new THREE.Quaternion().setFromAxisAngle(X, Math.PI / 2));     // 链环一横一竖
          links.push({ p: q0.clone().lerp(q1, 0.5), q });
          if (k % 3 === 1 && R() < locks) {
            const lp = q0.clone().lerp(q1, 0.5).addScaledVector(Y, -0.06);
            if (R() < 0.6) lockI.push({ p: lp, ry: -a.heading + (R() - 0.5), color: R() < 0.55 ? '#d8a93a' : R() < 0.7 ? '#c63127' : '#b8bcc4' });
            else ribbons.push({ p: lp.addScaledVector(Y, 0.02), ry: -a.heading + (R() - 0.5) * 0.8, s: [1, 0.7 + R() * 0.6, 1] });
          }
        }
      }
      prev = p;
    }
  }
  const iron = new THREE.MeshLambertMaterial({ color: '#2d2a28' });
  const out = [
    util.instanced(new THREE.CylinderGeometry(0.03, 0.035, h + 0.3, 6), iron, posts),
    util.instanced(new THREE.TorusGeometry(0.03, 0.008, 4, 8).scale(1.3, 0.8, 1), iron, links),
    util.instanced(new THREE.BoxGeometry(0.06, 0.07, 0.025), new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#221400' }), lockI),
    util.instanced(new THREE.PlaneGeometry(0.06, 0.3).translate(0, -0.15, 0), new THREE.MeshLambertMaterial({ color: '#c8231b', side: THREE.DoubleSide, emissive: '#3a0604' }), ribbons),
  ];
  out.forEach(m => { m.name = 'chains'; });
  return out;
}

// 华山松：斜伸的干 + 几层扁平的针叶团（顶面亮、底下暗）。big = 迎客松那种大伸展。返回合成几何（顶点色）
export function pineGeo(util, R, big = false) {
  const P = [], trunk = '#4a3a2c', S = big ? 1.5 : 1.1;
  let x = 0, y = 0, lean = 0.15 + R() * 0.2;
  const pts = [];
  for (let k = 0; k < 4; k++) {
    lean += 0.12 + R() * 0.15;
    const len = 0.6 * S, r0 = 0.1 * S * (1 - k / 5), r1 = 0.1 * S * (1 - (k + 1) / 5);
    P.push({ geo: new THREE.CylinderGeometry(r1, r0, len, 6).translate(0, len / 2, 0), p: [x, y, 0], q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -lean), color: trunk });
    x += Math.sin(lean) * len; y += Math.cos(lean) * len; pts.push([x, y]);
  }
  const lo = new THREE.Color('#2e4a2c'), hi = new THREE.Color('#8fac5e');
  for (let j = 0; j < (big ? 5 : 4); j++) {                                   // 一层 = 几团错落的针叶（不是一整张饼）
    const [tx, ty] = pts[Math.min(3, 1 + (j >> 1))], w = (0.85 - j * 0.1) * S, bx = tx + (R() - 0.3) * 0.8 * S, bz = (R() - 0.5) * 0.9 * S;
    for (let q = 0; q < 3; q++) {
      const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position, col = [], c = new THREE.Color();
      for (let i = 0; i < p.count; i++) { const yy = p.getY(i); c.copy(lo).lerp(hi, smooth(-0.3, 0.95, yy)); col.push(c.r, c.g, c.b); }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const a = q / 3 * 6.283 + R() * 1.5, rr = q ? w * 0.45 : 0, cw = w * (q ? 0.55 : 0.7) * (0.8 + 0.4 * R());
      P.push({ geo: g, p: [bx + Math.cos(a) * rr, ty + j * 0.12 * S - 0.1 + (R() - 0.4) * 0.12, bz + Math.sin(a) * rr * 0.8], s: [cw, cw * 0.32, cw * 0.85] });
    }
  }
  return util.merged(P);
}

// 玉泉院山门：两根红柱 + 额枋 + 灰瓦顶（跨路，柱在 ±2.4 外）；匾额字另给（返回 plaque 位置）
export function gateParts(W = 2.4, H = 3.7) {
  const P = [], box = (p, s, color) => P.push({ geo: new THREE.BoxGeometry(1, 1, 1), p, s, color });
  for (const x of [-W, W]) {
    P.push({ geo: new THREE.CylinderGeometry(0.2, 0.23, H, 12), p: [x, H / 2, 0], color: '#a8352a' });
    box([x, 0.2, 0], [0.75, 0.4, 0.75], '#8e8a82');
  }
  box([0, H + 0.12, 0], [2 * W + 0.8, 0.28, 0.45], '#6e2a20');
  box([0, H + 0.62, 0], [2 * W - 0.6, 0.72, 0.26], '#2f4f5a');              // 匾额底板
  box([0, H + 1.06, 0], [2 * W + 1.0, 0.16, 0.6], '#5a241c');
  P.push({ geo: new THREE.CylinderGeometry(0.25, 1, 1, 4, 1).rotateY(Math.PI / 4), p: [0, H + 1.5, 0], s: [(2 * W + 2.4) / Math.SQRT2, 0.75, 1.9 / Math.SQRT2], color: '#4a4c52' });   // 灰瓦庑殿顶
  box([0, H + 1.9, 0], [2 * W * 0.5, 0.14, 0.14], '#3a3b40');
  return { parts: P, plaqueY: H + 0.62 };
}

// 长空栈道的铁架：每 0.5 单位一根从崖壁（lat 右侧 wallLat）横伸出来托木板的铁杆 + 斜撑；崖壁上一条保险铁链（游客扣安全锁的那根）
export function plankIron(ctx, s0, s1, { wallLat = -1.3, reach = 0.8, chainH = 1.05 } = {}) {
  const { route, util } = ctx, bars = [], braces = [];
  const seg = (a, b, out, t = 1) => { const v = b.clone().sub(a); out.push({ p: a.clone().lerp(b, 0.5), q: new THREE.Quaternion().setFromUnitVectors(X, v.clone().normalize()), s: [v.length(), t, t] }); };
  for (let s = s0; s <= s1 + 1e-6; s += 1) {
    const y = route.heightAt(s) - 0.07, a = route.at(s, wallLat), b = route.at(s, reach);
    seg(a.pos.clone().setY(y), b.pos.clone().setY(y), bars);
    seg(route.at(s, wallLat).pos.setY(y - 0.9), route.at(s, reach * 0.5).pos.setY(y - 0.02), braces);
  }
  const iron = new THREE.MeshLambertMaterial({ color: '#2b2826' });
  const out = [
    util.instanced(new THREE.BoxGeometry(1, 0.05, 0.05), iron, bars),
    util.instanced(new THREE.BoxGeometry(1, 0.035, 0.035), iron, braces),
    ...chains(ctx, [[s0 - 0.5, s1 + 0.5]], { lat: -wallLat + 0.05, sides: [-1], every: 1, h: chainH, sag: 0.06, locks: 0.2 }),
  ];
  out.forEach(m => { m.name = 'plankIron'; });
  return out;
}

// 安全带：挂在保险链上的橙色扁带环（扣安全锁那一步的提示）
export function harnessParts() {
  const P = [];
  for (let k = 0; k < 3; k++) {
    P.push({ geo: new THREE.TorusGeometry(0.1, 0.018, 4, 12), p: [k * 0.28, -0.18, 0], s: [1, 1.4, 1], color: '#f07a1a' });
    P.push({ geo: new THREE.TorusGeometry(0.035, 0.01, 4, 8), p: [k * 0.28, -0.02, 0], color: '#c9ccd2' });    // 锁扣
  }
  return P;
}
