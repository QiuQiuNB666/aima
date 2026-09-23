// J 线追兵 NPC「捷风」的造型和特效。模型按优先级找，找不到 / 坏了就往下退，页面不报错：
//   ① /models/jett/scene.gltf：带骨骼的模型（将来有就直接换上）。按骨骼名匹配大腿 / 小腿 / 上臂 / 脊柱 / 头，左右按绑定姿态位置分，
//      摆动轴换算到每根骨骼的局部坐标（不依赖骨架命名和轴向）；自带动画在「追上后站定」「登顶抓到」时播。
//      （Sketchfab 那个「Jett (Fighting Stance)」要登录，没采用。）
//   ② /models/jett/jett.stl：Thingiverse thing:4326703「Jett 3D model Valorant」，作者 Frojj123，CC BY 4.0，粉丝原创的 3D 打印手办
//      （archive.org 备份）。没有骨骼、贴图，固定姿势的雕像 → 按高度 / 前后分区上色（头发白、脸肤色、外套蓝、腿深色）+ 轮廓光，
//      动作做成「风系飘行」（前倾、上下浮动、呼吸，见 npc.js）。
//   ③ 原创造型：CesiumMan 换装（深蓝腿、蓝外套、白头 + 往后吹的白发 + 白色高领）。
// 模型文件都在 static/models/jett/（.gitignore 里，不进 git、不上 GitHub，只由 deploy.sh 同步到展位机）；角色 IP 属于 Riot Games——见 docs/提交/素材授权.md。
// 面数：STL 雕像 4.4 万三角（1 次绘制）；原创造型 ~3.4k；特效（拖尾 3×2×24 + 风刃 2×32）都有。
// 调试：?npcmodel=<url> 换 gltf（比如 /models/CesiumMan.glb 测骨骼匹配）、?npcstl=<url> 换 STL、=0 跳过这一档；?npcyaw=<弧度> 修正朝向。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { STLLoader } from 'three/addons/STLLoader.js';
import { mergeGeometries, mergeVertices } from 'three/addons/BufferGeometryUtils.js';
import { loadAvatar, AVATAR_H } from './avatar.js';
import { WHO } from './style.js';   // ART 美术范式：捷风 = 实体钴蓝 + 白发 + 风白拖尾 + 白轮廓光（不用青，青是影子的）
import { simplify } from './lod.js';   // P 线：STL 雕像远档减面

const Q = new URLSearchParams(location.search);
// ↓↓ 角色名改这里（屏幕上的名字牌、气泡抬头都读它）；也可以临时用 ?npcname=xxx
export const 角色名 = Q.get('npcname') || '捷风';
export const LOOK = { leg: '#27344c', body: WHO.jett.coat, head: WHO.jett.hair, rim: WHO.jett.rim, rimK: 0.55, self: 0.28, headScale: 0.86, exo: false, pointK: 0.35 };
export const WIND = WHO.jett.wind;        // 拖尾 / 风刃颜色（风白）
const MODEL = Q.get('npcmodel') || '/models/jett/scene.gltf';
// 9/23 热修：展位 M2 上 STL 雕像渲染成满屏黑块（开发机正常），默认先关；?npcstl=1 打开，?npcstl=<url> 换文件。J 线修好后改回默认开
const STL = !Q.has('npcstl') || Q.get('npcstl') === '0' ? '0' : Q.get('npcstl') === '1' ? '/models/jett/jett.stl' : Q.get('npcstl');
// STL 雕像分区（高度按身高的比例；前后按头部中心沿前进方向 +X 的偏移，单位 = 头宽）。在浏览器里对着截图调的
// （yaw 0 = 这个 STL 本来就面朝 +X；站姿、双臂下垂、没有底座）
export const STATUE = { yaw: 0, hair: WHO.jett.hair, skin: '#f0c5a4', coat: WHO.jett.coat, leg: '#27344c', boot: '#1a2230', gloveC: '#1f2733',
  legTop: 0.54, coatTop: 0.80, faceTop: 0.935, faceFront: 0.15, bootTop: 0.08, glove: [0.36, 0.56, 0.19],   // 手套：高度区间 + 离中线多远
  rim: WHO.jett.rim, rimK: 0.6, self: 0.3 };

const TRAIL_N = 24;                       // 拖尾历史点数
const STREAKS = [[0.26, 1.18, 0.07], [-0.26, 1.02, 0.06], [0.0, 0.62, 0.09]];   // [横向, 离地, 半宽]：肩两侧 + 腰后三条风线

export async function makeJifeng(scene) {
  let av = null;
  if (MODEL !== '0') try { av = await loadModel(MODEL); } catch (e) { console.warn('捷风 gltf 加载失败，往下退', e); }
  if (!av && STL !== '0') try { av = await loadStatue(STL); } catch (e) { console.warn('捷风 STL 加载失败，用原创造型', e); }
  if (!av) {
    av = await loadAvatar({ look: LOOK });
    av.group.name = 'npc_jifeng';
    dress(av);
    av.stance = () => false; av.tick = () => {};
  }

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
    av, group: av.group, pose: av.pose, headWorld: av.headWorld, model: !!av.model, statue: !!av.statue,
    stance: on => av.stance(on),            // true = 播自带的格斗站姿（有的话），返回是否在播
    burst() { burstT = 0; },
    // dash 0..1 = 冲刺强度（拖尾亮度、风刃）；pos/dir = 这一帧的世界位置 / 前进方向
    update(dt, pos, dir, dash) {
      av.tick(dt);
      glow += (dash - glow) * (1 - Math.exp(-dt * 6));
      const gap = 0.05 + 0.1 * glow;                    // 冲刺越猛，历史点隔得越开 → 拖尾越长（最长约 3.6）
      if (!hist.length || hist[0].p.distanceToSquared(pos) > gap * gap) { hist.unshift({ p: pos.clone(), d: dir.clone() }); if (hist.length > TRAIL_N) hist.pop(); }
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

// ---- 外部模型（捷风）：GLTFLoader 读 scene.gltf，缩放到化身身高、脚底落地、正面转到局部 +X，程序化摆腿 / 摆臂 / 前倾 ----
async function loadModel(url) {
  const g = await new Promise(res => new GLTFLoader().load(url, res, undefined, () => res(null)));   // 没下载模型（404）/ 坏文件：静默退回原创造型
  if (!g) return null;
  const model = g.scene, outer = new THREE.Group(); outer.name = 'npc_jifeng';
  model.rotation.y = Math.PI / 2 + (+Q.get('npcyaw') || 0);   // glTF 约定正面 +Z → 局部 +X（同 avatar.js 的 MODEL_YAW）
  outer.add(model); outer.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(model, true);     // precise：蒙皮后的顶点
  if (bb.isEmpty()) return null;
  const c = bb.getCenter(new THREE.Vector3()), k = AVATAR_H / Math.max(1e-3, bb.max.y - bb.min.y);
  model.scale.multiplyScalar(k); model.position.set(-c.x * k, -bb.min.y * k, -c.z * k);
  outer.updateMatrixWorld(true);
  let tris = 0;
  model.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    for (const m of [].concat(o.material)) if (m.map && m.emissive) { m.emissiveMap = m.map; m.emissive.setScalar(0.35); }   // 夜景里别黑成一团：贴图当自发光打底
  });

  // 骨骼：名字匹配 + 绑定姿态位置分左右（人物朝 +X，左 = −Z）；同名多根取层级最高的
  const bones = []; model.traverse(o => { if (o.isBone) bones.push(o); });
  const W = b => b.getWorldPosition(new THREE.Vector3()), depth = b => { let d = 0; for (let p = b.parent; p; p = p.parent) d++; return d; };
  const side = b => { const z = W(b).z; return z < -0.02 ? 'L' : z > 0.02 ? 'R' : 'C'; };
  const pick = (re, sd, not) => bones.filter(b => re.test(b.name) && !(not && not.test(b.name)) && (!sd || side(b) === sd)).sort((a, b) => depth(a) - depth(b))[0] || null;
  const child = b => b && b.children.find(o => o.isBone) || null;
  const NOT_LEG = /low|calf|shin|knee|foot|toe|ankle|twist|end|nub/i, NOT_ARM = /fore|low|hand|twist|clav|shoulder|finger|end|nub/i;
  const J = {};
  for (const sd of ['L', 'R']) {
    J['thigh' + sd] = pick(/thigh|up_?leg|upper_?leg|femur/i, sd) || pick(/leg/i, sd, NOT_LEG);
    J['knee' + sd] = pick(/calf|shin|knee|low(er)?_?leg|leg.*2/i, sd) || child(J['thigh' + sd]);
    J['arm' + sd] = pick(/upper_?arm|up_?arm/i, sd) || pick(/arm/i, sd, NOT_ARM);
  }
  J.spine = pick(/spine|chest|torso/i);
  J.head = pick(/head/i, null, /end|top|nub/i);
  if (!J.thighL || !J.thighR) { console.warn('捷风模型没找到腿骨，用原创造型', bones.map(b => b.name)); return null; }
  // 每根骨骼：绑定姿态四元数 + 世界轴换算到骨骼局部（X = 前，Z = 左右）
  const rest = new Map(), axis = new Map(), qw = new THREE.Quaternion();
  const local = (b, a) => a.clone().applyQuaternion(b.getWorldQuaternion(qw).invert());
  for (const b of Object.values(J)) if (b) { rest.set(b, b.quaternion.clone()); axis.set(b, { z: local(b, new THREE.Vector3(0, 0, 1)), x: local(b, new THREE.Vector3(1, 0, 0)) }); }
  const armDown = {};                     // T 字姿势（上臂水平）→ 放下 70°；本来就垂着就不动
  for (const sd of ['L', 'R']) {
    const a = J['arm' + sd], e = child(a);
    armDown[sd] = a && e && Math.abs(W(e).sub(W(a)).normalize().y) < 0.5 ? (sd === 'L' ? -1 : 1) * 70 : 0;
  }
  const d2r = Math.PI / 180, qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const rot = (b, ax, deg, ax2, deg2) => {
    if (!b) return;
    b.quaternion.copy(rest.get(b));
    if (ax2 && deg2) b.quaternion.multiply(qb.setFromAxisAngle(axis.get(b)[ax2], deg2 * d2r));
    b.quaternion.multiply(qa.setFromAxisAngle(axis.get(b)[ax], deg * d2r));
  };
  // 自带动画（格斗站姿）
  const mixer = g.animations.length ? new THREE.AnimationMixer(model) : null;
  const act = mixer ? mixer.clipAction(g.animations[0]) : null;
  let playing = false;
  const head = J.head, tmp = new THREE.Vector3();
  console.info(`捷风模型：${Math.round(tris)} 三角，动画 ${g.animations.length} 段，骨骼`, Object.fromEntries(Object.entries(J).map(([n, b]) => [n, b && b.name])));
  return {
    group: outer, bones: J, model: true, mats: [],
    // 和 avatar.js 的 pose 同一个约定：flex 度，正 = 前抬；lean 由 npc.js 转整个 group
    pose(fl, fr) {
      if (playing) return;
      fl = Math.max(-35, Math.min(70, fl)); fr = Math.max(-35, Math.min(70, fr));
      rot(J.thighL, 'z', fl); rot(J.thighR, 'z', fr);
      rot(J.kneeL, 'z', -(Math.max(0, fl) * 0.9 + 8)); rot(J.kneeR, 'z', -(Math.max(0, fr) * 0.9 + 8));
      const sw = (fr - fl) / 2 * 0.7;
      rot(J.armL, 'z', sw, 'x', armDown.L); rot(J.armR, 'z', -sw, 'x', armDown.R);
    },
    stance(on) {
      if (!act || on === playing) return playing;
      playing = on;
      if (on) act.reset().play(); else act.stop();       // stop 后 mixer 会把骨骼还原成绑定姿态，下一帧 pose() 接着摆
      return playing;
    },
    tick(dt) { if (playing) mixer.update(dt); },
    headWorld(out = tmp) { if (head) head.getWorldPosition(out); else outer.getWorldPosition(out).setY(outer.position.y + 1.4); return out; },
  };
}

// ---- STL 雕像（捷风手办）：Z 朝上 → Y 朝上，缩放到化身身高、脚底落地、正面转到 +X，合并顶点后算平滑法线，按区域烘顶点色 ----
async function loadStatue(url) {
  const g0 = await new Promise(res => new STLLoader().load(url, res, undefined, () => res(null)));   // 404 / 坏文件：往下退
  if (!g0 || !g0.attributes.position.count) return null;
  const S = STATUE, yaw = Q.has('npcyaw') ? +Q.get('npcyaw') : S.yaw;
  g0.deleteAttribute('normal');
  const geo = mergeVertices(g0); g0.dispose();                // STL 每个三角形各存 3 个点：合并后法线才能平滑
  geo.rotateX(-Math.PI / 2).rotateY(yaw);                    // Z 朝上 → Y 朝上；yaw 把正面转到 +X
  geo.computeBoundingBox();
  let bb = geo.boundingBox, k = AVATAR_H / (bb.max.y - bb.min.y);
  const c = bb.getCenter(new THREE.Vector3());
  geo.translate(-c.x, -bb.min.y, -c.z).scale(k, k, k);
  geo.computeVertexNormals(); geo.computeBoundingBox();
  // 头部中心：身高 88% 以上顶点的均值（前后 = x）
  const P = geo.attributes.position, H = AVATAR_H;
  let hx = 0, hz = 0, hn = 0, hw = 0;
  for (let i = 0; i < P.count; i++) if (P.getY(i) > H * 0.88) { hx += P.getX(i); hz += P.getZ(i); hn++; }
  hx /= hn || 1; hz /= hn || 1;
  for (let i = 0; i < P.count; i++) if (P.getY(i) > H * 0.88) hw = Math.max(hw, Math.abs(P.getZ(i) - hz));
  const col = new Float32Array(P.count * 3), C = n => new THREE.Color(S[n]);
  const cHair = C('hair'), cSkin = C('skin'), cCoat = C('coat'), cLeg = C('leg'), cBoot = C('boot'), cGlove = C('gloveC');
  const [g0y, g1y, gz] = S.glove;
  for (let i = 0; i < P.count; i++) {
    const t = P.getY(i) / H, front = (P.getX(i) - hx) / (hw || 0.1);
    const z = t < S.bootTop ? cBoot : t > g0y && t < g1y && Math.abs(P.getZ(i) - hz) > gz ? cGlove : t < S.legTop ? cLeg : t < S.coatTop ? cCoat
      : t < S.faceTop && front > S.faceFront ? cSkin : cHair;
    z.toArray(col, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, statueMaterial(S)); mesh.name = 'jettStatue';
  // 远档（P 线 lod.js）：1.2 cm 聚类 4.4 万 → ~1.5 万三角，离镜头 6 m 外换；远档必须双面（薄衣片正反面并到一起会翻面，单面看是洞）
  const lo = new THREE.Mesh(simplify(geo, 0.012), mesh.material.clone()); lo.material.side = THREE.DoubleSide;
  const lod = new THREE.LOD(); lod.addLevel(mesh, 0); lod.addLevel(lo, 6, 0.1);
  const outer = new THREE.Group(); outer.name = 'npc_jifeng'; outer.add(lod);
  const headLocal = new THREE.Vector3(hx, H * 0.95, hz), tmp = new THREE.Vector3();
  console.info(`捷风 STL 雕像：${geo.index ? geo.index.count / 3 : P.count / 3} 三角，${P.count} 顶点`);
  return {
    group: outer, mesh, statue: true, model: true, mats: [mesh.material],
    pose() {}, stance: () => false, tick() {},
    headWorld(out = tmp) { return mesh.localToWorld(out.copy(headLocal)); },
  };
}

// 顶点色 × 场景光 + 自发光打底 + 菲涅尔轮廓光（同 avatar.js 的 zonedMaterial 思路），夜景里看得清
function statueMaterial(S) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  const U = { uRim: { value: new THREE.Color(S.rim) }, uRimK: { value: S.rimK }, uSelf: { value: S.self } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uRim;\nuniform float uRimK, uSelf;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // clamp：正对镜头时 |dot| 会因为舍入略大于 1，pow(负数, …) 在 GLSL 里没有定义（Metal 给 NaN）。防御性写法；
        //   9/23 在 M2 无头 Chrome 上验证过：它不是展位黑块的原因（黑块根因还没查清，见指挥板 J 行）
        float fr = clamp(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
        totalEmissiveRadiance += diffuseColor.rgb * uSelf + uRim * pow(fr, 2.2) * uRimK;`);
  };
  m.customProgramCacheKey = () => 'jett-statue';
  return m;
}
