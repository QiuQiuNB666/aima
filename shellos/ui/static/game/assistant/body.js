// J 线 · 峰哥的助理：身体。不另起一套——用 P 线的管线（fengge/shape.js 挪骨骼比例 → fengge/body.js 沿骨头放样出低多边形身体、蒙到同一套
//   骨骼，A2 的动作照用），P 线的文件一个没改：放样出来以后，这里按每个顶点自带的属性（aReg 部位、aT 沿段、aH 离髋关节高度、
//   aAng 朝向）把躯干和大腿推成沙漏曲线——髋宽、腰细、胸前和臀后各鼓一块。游戏角色那种夸张比例，但全身衣服，不露。
// 数值都在 SHAPE_F / CURVE 里，?curve=hipW:1.3,chestF:0.03 逐项覆盖（截图对比用）。
import * as THREE from 'three';
import { reshape } from '../fengge/shape.js';
import { buildBody } from '../fengge/body.js';

// 骨骼比例（shape.js 的同一套键）：腿长、肩窄一点、脖子略短；身高整体再由 npc_assistant.js 缩到 0.96
export const SHAPE_F = { leg: 1.27, shin: 1.14, spine: 0.94, chest: 0.94, neck: 0.92, shoulderW: 1.5, shoulderUp: -0.012, arm: 1.02, forearm: 1.0 };
// 曲线（u = 离髋关节高度 / 髋到肩的距离：0 髋，1 肩）：hipW 髋宽倍数、waistW / waistD 腰的宽 / 厚倍数、chestF 胸前鼓出（米）、gluteB 臀后鼓出（米）、
//   thigh 大腿根加粗倍数
export const CURVE = { hipW: 1.32, waistW: 0.72, waistD: 0.84, chestF: 0.05, gluteB: 0.045, thigh: 1.16 };

function current() {
  const C = { ...CURVE }, q = new URLSearchParams(location.search).get('curve');
  if (q) for (const kv of q.split(',')) { const [k, v] = kv.split(':'); if (k in C && isFinite(+v)) C[k] = +v; }
  return C;
}
const gauss = (x, m, s) => Math.exp(-(((x - m) / s) ** 2));

// 在化身还没摆姿势、group 还没移动的时候调。outfit 的接口同 fengge/outfits.js；tune(mat, more) 同 buildBody
export function buildAssistantBody(av, outfit, tune) {
  reshape(av, SHAPE_F);
  const body = buildBody(av, outfit, { tune });
  body.mesh.name = 'assistantBody';
  curve(body.mesh.geometry, body.shY - body.hipY, current());
  if (outfit.uniforms.uSpan) { outfit.uniforms.uSpan.value = body.shY - body.hipY; outfit.uniforms.uHip.value = body.hipY; }
  return body;
}

// 放样的每一圈（同部位、同侧、同 aT）先求圈心，再按高度缩放「顶点 − 圈心」，最后加前后的鼓包
function curve(g, span, C) {
  const P = g.attributes.position, R = g.attributes.aReg, T = g.attributes.aT, H = g.attributes.aH, A = g.attributes.aAng, S = g.attributes.aSide;
  const key = i => `${R.getX(i)}|${S.getX(i)}|${T.getX(i).toFixed(4)}`, ctr = new Map();
  for (let i = 0; i < P.count; i++) {
    const k = key(i), c = ctr.get(k) || { x: 0, z: 0, n: 0 };
    c.x += P.getX(i); c.z += P.getZ(i); c.n++; ctr.set(k, c);
  }
  for (let i = 0; i < P.count; i++) {
    const reg = R.getX(i), c = ctr.get(key(i)); if (!c || c.n < 3) continue;   // 封口的中心点不动
    const cx = c.x / c.n, cz = c.z / c.n, dx = P.getX(i) - cx, dz = P.getZ(i) - cz, ca = A.getX(i);
    if (reg === 0) {                                          // 躯干
      const u = H.getX(i) / span;
      const w = 1 + (C.hipW - 1) * gauss(u, -0.04, 0.22) - (1 - C.waistW) * gauss(u, 0.42, 0.16);
      const d = 1 - (1 - C.waistD) * gauss(u, 0.42, 0.16);
      let x = cx + dx * d, z = cz + dz * w;
      x += C.chestF * gauss(u, 0.72, 0.11) * Math.max(0, ca) ** 2;     // 胸前
      x -= C.gluteB * gauss(u, -0.08, 0.14) * Math.max(0, -ca) ** 2;  // 臀后
      P.setXYZ(i, x, P.getY(i), z);
    } else if (reg === 3) {                                   // 大腿：根部粗、往膝盖收
      const t = T.getX(i), f = 1 + (C.thigh - 1) * (1 - Math.min(1, t)) ** 1.5;
      P.setXYZ(i, cx + dx * f, P.getY(i), cz + dz * f);
    }
  }
  P.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
}
