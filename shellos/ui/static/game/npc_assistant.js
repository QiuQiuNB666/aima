// J 线 · 峰哥的助理（9/23 夜起，替换追兵「捷风」；旧版用 ?npc=jifeng，在 npc_jifeng.js，没删）。
// 造型：CesiumMan 骨架（和峰哥同一套）→ P 线的放样身体 + 这里的曲线（assistant/body.js）+ 穿搭（assistant/outfits.js）；
//   A2 的动作（anim.js）照用，所以是真的在跑。风格对齐峰哥：平面着色、哑光低多边形。CesiumMan 原网格藏掉，外骨骼不给她穿。
// 接口和 npc_jifeng.js 的 makeJifeng 一样（npc.js 两个都认）。
import * as THREE from 'three';
import { loadAvatar } from './avatar.js';
import { buildAssistantBody } from './assistant/body.js';
import { outfitFor } from './assistant/outfits.js';

const Q = new URLSearchParams(location.search);
// ↓↓ 名字占位，球球 / anni 定了改这里；也可以临时 ?npcname=xxx
export const 名字 = Q.get('npcname') || '助理';
export const SCALE = 0.96;                 // 比峰哥矮一点

// 身体材质：平面着色的 Lambert（body.js 给的）+ 自发光打底 + 白色轮廓光，夜景里看得清
function tune(m, more) {
  m.onBeforeCompile = sh => {
    more(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      float frA = clamp(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
      totalEmissiveRadiance += diffuseColor.rgb * 0.22 + vec3(0.95, 0.96, 1.0) * pow(frA, 2.4) * 0.4;`);
  };
}

export async function makeAssistant(scene) {
  const av = await loadAvatar({ look: { exo: false, headScale: 1 } });
  av.group.name = 'npc_assistant';
  let cm = null; av.group.traverse(o => { if (o.isSkinnedMesh && !cm) cm = o; });
  const body = buildAssistantBody(av, outfitFor(), tune);
  if (cm) cm.visible = false;                                  // CesiumMan 原网格（方块小人 + 头盔）藏掉
  placeholderHead(av);
  av.group.scale.setScalar(SCALE);
  scene.add(av.group);
  const tmp = new THREE.Vector3();
  return {
    av, group: av.group, name: 名字, body, pose: av.pose, animate: av.animate, statue: false, model: false,
    headWorld: (out = tmp) => av.headWorld(out),
    stance: () => false, update() {}, burst() {}, resetTrail() {},
    set visible(v) { av.group.visible = v; }, get visible() { return av.group.visible; },
  };
}

// 第 1 轮先放一个占位头（肤色椭球 + 深色发帽），第 2 轮换成手绘低多边形脸 + 高马尾
function placeholderHead(av) {
  const head = av.bones['Skeleton_neck_joint_2']; if (!head) return;
  av.group.updateMatrixWorld(true);
  const c = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.01, 0.1, 0));
  const skin = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), new THREE.MeshLambertMaterial({ color: '#f0cdb6', flatShading: true, emissive: '#f0cdb6', emissiveIntensity: 0.2 }));
  skin.scale.set(0.95, 1.12, 0.88); skin.position.copy(c);
  const hair = new THREE.Mesh(new THREE.IcosahedronGeometry(0.106, 1), new THREE.MeshLambertMaterial({ color: '#2a2220', flatShading: true }));
  hair.scale.set(0.98, 1.1, 0.95); hair.position.copy(c).add(new THREE.Vector3(-0.018, 0.02, 0));
  for (const m of [skin, hair]) { m.frustumCulled = false; head.attach(m); }
}
