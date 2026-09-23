// J 线追兵 NPC 的造型和特效。原创致敬角色：「风系、白发、蓝色短外套、风刃、冲刺拖尾」这一类，不照搬任何游戏角色的设计 / 名字 / 台词 / logo。
// 底模 = avatar.js 的 CesiumMan（Khronos glTF 样例，CC-BY 4.0，已在仓库里）换装：分区纯色（深蓝腿、蓝外套、白头）+ 往后吹的白发 + 白色高领。
//   没下 Quaternius：多一个 glb 要多解析一次、骨骼名也不同，pose 接不上 A2 的动作；CesiumMan 换装一张图就够认。
// 面数：CesiumMan ~3.3k 三角 + 头发/领 ~100 + 拖尾 3×2×24 + 风刃 2×32，一个 NPC 一共约 4k、7 次绘制。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { loadAvatar } from './avatar.js';

// ↓↓ 球球改名改这里（屏幕上的名字牌、气泡抬头都读它）；也可以临时用 ?npcname=xxx
export const 角色名 = new URLSearchParams(location.search).get('npcname') || '疾风';
export const LOOK = { leg: '#27344c', body: '#2f7fe0', head: '#f2f6fb', rim: '#bfeeff', rimK: 0.55, self: 0.28, headScale: 0.86, exo: false, pointK: 0.35 };
export const WIND = '#9ff3ff';            // 拖尾 / 风刃颜色

const TRAIL_N = 24;                       // 拖尾历史点数
const STREAKS = [[0.26, 1.18, 0.07], [-0.26, 1.02, 0.06], [0.0, 0.62, 0.09]];   // [横向, 离地, 半宽]：肩两侧 + 腰后三条风线

export async function makeJifeng(scene) {
  const av = await loadAvatar({ look: LOOK });
  av.group.name = 'npc_jifeng';
  dress(av);

  // ---- 冲刺拖尾：世界坐标里的三条带子，顶点每帧按历史位置重写；加色混合 + 顶点色渐隐（黑 = 看不见，不用排序）
  const tg = new THREE.BufferGeometry(), V = STREAKS.length * TRAIL_N * 2;
  const tp = new Float32Array(V * 3), tc = new Float32Array(V * 3), idx = [];
  for (let k = 0; k < STREAKS.length; k++) for (let i = 0; i < TRAIL_N - 1; i++) {
    const a = (k * TRAIL_N + i) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  tg.setAttribute('position', new THREE.BufferAttribute(tp, 3)); tg.setAttribute('color', new THREE.BufferAttribute(tc, 3)); tg.setIndex(idx);
  const add = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false };
  const trail = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, ...add }));
  trail.frustumCulled = false; trail.renderOrder = 3;
  const hist = [];                        // [{p, dir}] 最新在前

  // ---- 风刃：两道月牙绕腰转（冲刺时），登顶「抓到」时一圈冲击环
  const bladeMat = new THREE.MeshBasicMaterial({ color: WIND, opacity: 0, ...add });
  const blades = new THREE.Group(); blades.position.y = 0.85;
  for (let i = 0; i < 2; i++) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.6, 16, 1, 0, 2.0), bladeMat);
    m.rotation.set(-Math.PI / 2 + (i ? 0.35 : -0.35), 0, i * Math.PI); blades.add(m);
  }
  av.group.add(blades);
  const burstMat = new THREE.MeshBasicMaterial({ color: WIND, opacity: 0, ...add });
  const burst = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.0, 32), burstMat);
  burst.rotation.x = -Math.PI / 2; burst.position.y = 0.05; av.group.add(burst);
  let burstT = 9;

  scene.add(av.group, trail);
  const col = new THREE.Color(WIND), side = new THREE.Vector3(), c = new THREE.Vector3();
  let glow = 0;

  return {
    av, group: av.group, pose: av.pose, headWorld: av.headWorld,
    burst() { burstT = 0; },
    // dash 0..1 = 冲刺强度（拖尾亮度、风刃）；pos/dir = 这一帧的世界位置 / 前进方向
    update(dt, pos, dir, dash) {
      glow += (dash - glow) * (1 - Math.exp(-dt * 6));
      if (!hist.length || hist[0].p.distanceToSquared(pos) > 0.0025) { hist.unshift({ p: pos.clone(), d: dir.clone() }); if (hist.length > TRAIL_N) hist.pop(); }
      for (let k = 0; k < STREAKS.length; k++) {
        const [lat, y, hw] = STREAKS[k];
        for (let i = 0; i < TRAIL_N; i++) {
          const h = hist[Math.min(i, hist.length - 1)], o = ((k * TRAIL_N + i) * 2) * 3;
          side.set(h.d.z, 0, -h.d.x);                       // 左手方向（和 route.at 的 left 一样）
          c.copy(h.p).addScaledVector(side, lat); c.y += y + Math.sin(i * 0.5 + k) * 0.03 * i / TRAIL_N;
          const w = hw * (1 - i / TRAIL_N), f = glow * Math.pow(1 - i / TRAIL_N, 1.5) * 0.85;
          tp[o] = c.x; tp[o + 1] = c.y + w; tp[o + 2] = c.z; tp[o + 3] = c.x; tp[o + 4] = c.y - w; tp[o + 5] = c.z;
          for (let j = 0; j < 6; j += 3) { tc[o + j] = col.r * f; tc[o + j + 1] = col.g * f; tc[o + j + 2] = col.b * f; }
        }
      }
      tg.attributes.position.needsUpdate = true; tg.attributes.color.needsUpdate = true;
      trail.visible = glow > 0.02 && av.group.visible;
      blades.rotation.y += dt * 9; bladeMat.opacity = glow * 0.75; blades.visible = glow > 0.02;
      burstT += dt; const u = Math.min(1, burstT / 0.9);
      burst.scale.setScalar(0.3 + u * 2.6); burstMat.opacity = (1 - u) * 0.9; burst.visible = u < 1;
    },
    set visible(v) { av.group.visible = v; if (!v) trail.visible = false; },
    get visible() { return av.group.visible; },
    resetTrail() { hist.length = 0; },
  };
}

// 白发（往后吹的几撮尖）+ 白色高领（外套 = 躯干分区的蓝色；试过下摆筒和腰间亮边，从跟拍镜头看像纱裙 / 呼啦圈，去掉了）：绑定姿态下按骨骼世界坐标摆好、合成一个网格、挂到骨骼上（写法同 avatar.js dressExo）。
// 模型绑定姿态朝 +X，上 = +Y。
function dress(av) {
  const g = av.group; g.updateMatrixWorld(true);
  const J = n => av.bones[n], W = b => b.getWorldPosition(new THREE.Vector3());
  const head = J('Skeleton_neck_joint_2'), neck = J('Skeleton_neck_joint_1') || head;
  const white = new THREE.MeshLambertMaterial({ color: LOOK.head, emissive: '#aebdcc', emissiveIntensity: 0.35 });
  const q = new THREE.Quaternion(), e = new THREE.Euler(), mx = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
  const put = (geo, p, rot, s) => geo.applyMatrix4(mx.compose(p, rot ? q.setFromEuler(e.set(...rot)) : q.identity(), s || one));
  if (head) {                             // 头盔球的中心 ≈ 头骨往上 0.1、往后 0.02（浏览器里对过）
    const c = W(head).add(new THREE.Vector3(-0.02, 0.1, 0)), hair = [];
    // 锥尖原本朝 +Y；绕 Z 转 π/2 → 尖朝 −X（后），俯仰正 = 往上翘，偏航正 = 往 +Z 张开。[后移, 上下, 左右, 俯仰, 偏航, 长]
    for (const [dx, dy, dz, pit, yaw, len] of [[-0.06, 0.07, 0, 0.35, 0, 0.3], [-0.07, 0.02, 0.07, 0.15, 0.45, 0.26], [-0.07, 0.02, -0.07, 0.15, -0.45, 0.26],
      [-0.06, -0.05, 0.05, -0.1, 0.3, 0.22], [-0.06, -0.05, -0.05, -0.1, -0.3, 0.22], [0.02, 0.1, 0, 0.9, 0, 0.18]]) {
      const cg = new THREE.ConeGeometry(0.055, len, 5); cg.translate(0, len / 2, 0);
      hair.push(put(cg, c.clone().add(new THREE.Vector3(dx, dy, dz)), [0, yaw, Math.PI / 2 - pit]));
    }
    const m = new THREE.Mesh(mergeGeometries(hair.map(h => h.toNonIndexed())), white); m.name = 'npcHair'; m.frustumCulled = false;
    head.attach(m);
  }
  if (neck) {                             // 高领：一圈白色短筒
    const m = new THREE.Mesh(put(new THREE.CylinderGeometry(0.1, 0.12, 0.09, 12, 1, true), W(neck).add(new THREE.Vector3(0, -0.02, 0))),
      new THREE.MeshLambertMaterial({ color: '#e8f4ff', emissive: '#8fb7d9', emissiveIntensity: 0.4, side: THREE.DoubleSide }));
    m.frustumCulled = false; neck.attach(m);
  }
}
