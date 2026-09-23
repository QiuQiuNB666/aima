// Q 助理（开源二次元版）预览：VRM 角色 + Mixamo 动作重定向（three-vrm 官方 loadMixamoAnimation 的思路，动作源换成 glb）。
//   模型清单 MODELS 顺序 = ?model=N；许可 / 来源 / 面数见 docs/助理-开源版说明.md 和 models/assistant_q/LICENSE.txt。
//   动作源 /models/assistant_q/mixamo_clips.glb：three.js 仓库 Xbot.glb 去掉网格只留 idle / walk / run 三条 mixamorig 骨骼动画。
//   接入 npc.js 时只要 makeQ() 返回的 { group, update(dt, state), bones }：update 里按 state.speed 切 idle / walk / run。
//   调试：window.__q = { set({cam, anim, bg}), shots() → { front, side, run } dataURL（截总览图用）, vrm, tris }。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { PALETTE } from '../style.js';

export const MODELS = [
  { id: 'AvatarSample_A', name: 'AvatarSample_A', by: 'VRoid（pixiv）', lic: 'VRoid 样例条款：可商用、可免费再分发' },
  { id: 'AvatarSample_B', name: 'AvatarSample_B', by: 'VRoid（pixiv）', lic: 'VRoid 样例条款：可商用、可免费再分发' },
  { id: 'Sendagaya_Shino', name: '千駄ヶ谷 篠', by: 'VRoid（pixiv）', lic: 'CC0' },
  { id: 'Victoria_Rubin', name: 'Victoria Rubin（β AvatarSample_4）', by: 'VRoid（pixiv）', lic: 'CC0' },
  { id: 'Vita', name: 'Vita（β AvatarSample_3）', by: 'VRoid（pixiv）', lic: 'CC0' },
  { id: 'Vivi', name: 'Vivi（β AvatarSample_2）', by: 'VRoid（pixiv）', lic: 'CC0' },
  { id: 'Seed-san', name: 'Seed-san', by: 'VirtualCast, Inc.', lic: 'VRM Public License 1.0：可再分发、须署名' },
  { id: 'VRM1_Constraint_Twist_Sample', name: 'three-vrm 示例（VRM1 Twist Sample）', by: 'pixiv Inc.', lic: 'VRM Public License 1.0：可再分发、免署名' },
];

// Mixamo 骨名 → VRM Humanoid 骨名（three-vrm 官方 mixamoVRMRigMap.js，MIT）。手指略去：Xbot 三条动作的手指几乎不动，少 30 条轨道
const MIXAMO2VRM = {
  mixamorigHips: 'hips', mixamorigSpine: 'spine', mixamorigSpine1: 'chest', mixamorigSpine2: 'upperChest', mixamorigNeck: 'neck', mixamorigHead: 'head',
  mixamorigLeftShoulder: 'leftShoulder', mixamorigLeftArm: 'leftUpperArm', mixamorigLeftForeArm: 'leftLowerArm', mixamorigLeftHand: 'leftHand',
  mixamorigRightShoulder: 'rightShoulder', mixamorigRightArm: 'rightUpperArm', mixamorigRightForeArm: 'rightLowerArm', mixamorigRightHand: 'rightHand',
  mixamorigLeftUpLeg: 'leftUpperLeg', mixamorigLeftLeg: 'leftLowerLeg', mixamorigLeftFoot: 'leftFoot', mixamorigLeftToeBase: 'leftToes',
  mixamorigRightUpLeg: 'rightUpperLeg', mixamorigRightLeg: 'rightLowerLeg', mixamorigRightFoot: 'rightFoot', mixamorigRightToeBase: 'rightToes',
};

// 把 mixamorig 骨骼上的 clip 转成驱动 VRM normalized 骨骼的 clip（照抄 loadMixamoAnimation.js 的数学：父骨静止世界旋转 × 轨道旋转 × 本骨静止世界旋转⁻¹）
export function retargetMixamo(clip, asset, vrm) {
  const tracks = [], restInv = new THREE.Quaternion(), parentRest = new THREE.Quaternion(), q = new THREE.Quaternion();
  const hipsScale = vrm.humanoid.normalizedRestPose.hips.position[1] / asset.getObjectByName('mixamorigHips').position.y;
  const v0 = vrm.meta?.metaVersion === '0';
  for (const t of clip.tracks) {
    const [rig, prop] = t.name.split('.');
    const node = vrm.humanoid.getNormalizedBoneNode(MIXAMO2VRM[rig]), src = asset.getObjectByName(rig);
    if (!node || !src) continue;
    src.getWorldQuaternion(restInv).invert(); src.parent.getWorldQuaternion(parentRest);
    if (t instanceof THREE.QuaternionKeyframeTrack) {
      const v = t.values.slice();
      for (let i = 0; i < v.length; i += 4) { q.fromArray(v, i).premultiply(parentRest).multiply(restInv); q.toArray(v, i); }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.${prop}`, t.times, v.map((x, i) => (v0 && i % 2 === 0 ? -x : x))));
    } else if (t instanceof THREE.VectorKeyframeTrack && rig === 'mixamorigHips') {
      tracks.push(new THREE.VectorKeyframeTrack(`${node.name}.${prop}`, t.times, t.values.map((x, i) => (v0 && i % 3 !== 1 ? -x : x) * hipsScale)));
    }
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

// 曲线：胸 / 臀骨骼非均匀缩放，子骨反向抵消（assistant_models.md 末尾的骨骼缩放法）。打在 raw 骨上——humanoid.update() 只拷贝旋转 / 髋位移，不动 scale
export function curvify(vrm, { chest = 1.25, chestDepth = 1.3, hips = 1.2, waist = 0.88 } = {}) {
  const b = n => vrm.humanoid.getRawBoneNode(n);
  const set = (n, x, y, z) => { const o = b(n); if (o) o.scale.set(x, y, z); };
  const top = b('upperChest') ? 'upperChest' : 'chest';
  set(top, chest, 1, chestDepth);
  for (const n of ['neck', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm']) if (b(n)?.parent === b(top)) set(n, 1 / chest, 1, 1 / chestDepth);
  set('hips', hips, 1, hips);
  for (const n of ['spine', 'leftUpperLeg', 'rightUpperLeg']) { set(n, 1 / hips, 1, 1 / hips); const o = b(n); if (o && n !== 'spine') o.position.x /= hips; }
  set('spine', waist / hips, 1, waist / hips); set('chest', 1 / waist, 1, 1 / waist);   // 腰细：spine 收、chest 反向
}

// ---------- 通用：加载一个候选 + 三条动作 ----------
const loader = new GLTFLoader();
loader.register(p => new VRMLoaderPlugin(p));
let clipsP = null;
const loadClips = () => (clipsP ||= loader.loadAsync('/models/assistant_q/mixamo_clips.glb'));

const stage = s => { document.body.dataset.stage = s; };
export async function makeQ(id, { curve = false } = {}) {
  stage('load');
  const [g, src] = await Promise.all([loader.loadAsync(`/models/assistant_q/${id}.vrm`, e => stage(`vrm ${e.loaded}/${e.total}`)), loadClips()]);
  stage('loaded');
  const vrm = g.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(g.scene); VRMUtils.combineSkeletons(g.scene);
  VRMUtils.rotateVRM0(vrm);                                        // VRM0 朝 -Z，转成和 VRM1 一样朝 +Z
  vrm.scene.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; } });
  if (curve) curvify(vrm);
  src.scene.updateWorldMatrix(true, true);
  const mixer = new THREE.AnimationMixer(vrm.scene), actions = {};
  for (const c of src.animations) actions[c.name] = mixer.clipAction(retargetMixamo(c, src.scene, vrm));
  let cur = null;
  const play = (name, fade = 0.25) => {
    const a = actions[name] || actions.idle; if (a === cur) return;
    if (!cur || !fade) { mixer.stopAllAction(); a.reset().play(); cur = a; return; }   // fade 0 = 硬切（截图定格用；crossFade 0 秒配合 setTime 会把权重卡在 0）
    a.reset().play(); a.crossFadeFrom(cur, fade, false); cur = a;
  };
  play('idle'); stage('retargeted');
  let tris = 0; vrm.scene.traverse(o => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  return {
    group: vrm.scene, vrm, mixer, actions, play, tris: Math.round(tris),
    // 和 game/fengge/body.js 一样：update(dt, state)；state.speed（m/s）决定动作，state.dir（弧度）决定朝向
    update(dt, state = {}) {
      if (state.speed != null) play(state.speed < 0.05 ? 'idle' : state.speed < 1.6 ? 'walk' : 'run');
      if (state.dir != null) vrm.scene.rotation.y = state.dir;
      mixer.update(dt); vrm.update(dt);
    },
    bones: Object.fromEntries(['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand',
      'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot'].map(n => [n, vrm.humanoid.getRawBoneNode(n)?.name ?? null])),
  };
}

// ---------- 预览页 ----------
if (document.getElementById('hud')) {
  const Q = new URLSearchParams(location.search), err = document.getElementById('errlog');
  const log = m => { err.textContent += m + '\n'; };
  window.addEventListener('error', e => log(e.message)); window.addEventListener('unhandledrejection', e => log(String(e.reason?.stack || e.reason)));
  const mi = MODELS.findIndex(m => m.id === Q.get('model')), M = MODELS[mi >= 0 ? mi : (+Q.get('model') || 0)] || MODELS[0];
  const BG = { white: '#ffffff', sky: PALETTE.snow_summit.sub };
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight); renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.prepend(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(BG[Q.get('bg')] || BG.white);
  scene.add(new THREE.HemisphereLight('#ffffff', '#c8d4e0', 1.2));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.2); sun.position.set(1.5, 3, 2.5); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 0.1, 50);
  const look = new THREE.Vector3(0, 0.82, 0), CAM = { front: 0, 30: Math.PI / 6, side: Math.PI / 2, back: Math.PI };
  const setCam = (name, dist = 3.6) => { const a = CAM[name] ?? 0; camera.position.set(Math.sin(a) * dist, 0.95, Math.cos(a) * dist); camera.lookAt(look); };
  setCam(Q.get('cam') || 'front');
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

  const hud = document.getElementById('hud');
  hud.innerHTML = MODELS.map((m, i) => `<a href="?model=${i}${Q.get('bg') ? '&bg=' + Q.get('bg') : ''}${Q.get('anim') ? '&anim=' + Q.get('anim') : ''}"${m === M ? ' style="font-weight:800"' : ''}>${i} ${m.name}</a>`).join('') + '\n加载中…';
  const clock = new THREE.Clock();
  makeQ(M.id, { curve: Q.get('curve') === '1' }).then(q => {
    scene.add(q.group); q.play(Q.get('anim') || 'idle');
    window.__q = {
      ...q,
      set({ cam, anim, bg } = {}) { if (cam) setCam(cam); if (anim) q.play(anim, 0); if (bg) scene.background.set(BG[bg] || bg); },
      // 总览图：正面待机 / 侧面待机 / 30° 跑步中（定格在迈步 30% 处）/ 正面加曲线（curvify 后，只为回答「能不能改比例」；调用后本页就一直是曲线版）。返回 dataURL，截图脚本存盘
      shots(w = 600, h = 900) {
        renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
        const one = (cam, anim, t) => { q.play(anim, 0); q.mixer.setTime(t); q.vrm.update(0); setCam(cam); renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); };
        const out = { front: one('front', 'idle', 0.5), side: one('side', 'idle', 0.5), run: one('30', 'run', q.actions.run.getClip().duration * 0.3) };
        curvify(q.vrm); out.curve = one('front', 'idle', 0.5);
        renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); q.play(Q.get('anim') || 'idle', 0);
        return out;
      },
    };
    hud.lastChild.textContent = `\n${M.name} · ${M.by} · ${M.lic} · ${q.tris.toLocaleString()} tris · 动作 ${Object.keys(q.actions).join('/')}`;
    stage('render'); renderer.render(scene, camera);
    document.body.dataset.tris = q.tris; document.body.dataset.ready = '1';
    renderer.setAnimationLoop(() => { q.update(Math.min(clock.getDelta(), 0.05)); renderer.render(scene, camera); });
  }).catch(e => log(String(e?.stack || e)));
}
