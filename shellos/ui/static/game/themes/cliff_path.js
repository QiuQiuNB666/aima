// 华山·长空栈道（花岗岩绝壁）：玉泉院山门 → 华山峪（两侧峪壁）→ 回心石 → 千尺幢（窄缝里的陡石阶，两侧铁链）→ 百尺峡（缝顶卡着一块巨石）
//   → 北峰 → 苍龙岭（刀背一样的山脊，两边绝壁直落云海，上端「韩退之投书处」）→ 金锁关（铁链挂满同心锁）→ 南天门·扣安全锁 → 长空栈道（崖壁上铁桩托木板，
//   左边是空的，缝里能看见底下的云）→ 南峰「华山极顶」。晴天，云海压在深谷里，秦岭远山一层层淡下去。
// 地标按路段类型找（不写死步号）：前 60% 的上台阶 = 峡缝、之后的上台阶 = 山脊、最后一个红灯 = 扣安全锁、它后面那段平路 = 栈道、
//   栈道前那段平路 = 金锁关。「一句话造山」生成的 cliff_path 世界也能画（华山专有的刻字只在名字带「华山」时刻，别的山刻自己的路段名）。
// 路线只有 ~28 个单位长：峡缝里的高崖走过就溶掉（登顶回头不会看见比顶峰还高的墙），山上的东西走近了才露面。
// 正面镜头（V / ?cam=front）：栈道和苍龙岭上镜头挪到悬崖那一侧、压低往下看，拍出脚下的深谷。
// 子模块：cliff_path/sky.js（天、云海、秦岭）、rock.js（绝壁、巨石、刻字）、props.js（铁链、松、山门、栈道铁架）。
import * as THREE from 'three';
import { STEP, ROAD_W } from '../path.js';
import { SEG, WHO } from '../style.js';
import { buildSky } from './cliff_path/sky.js';
import { cliffWall, boulderGeo, carving, graniteColor } from './cliff_path/rock.js';
import { chains, pineGeo, gateParts, plankIron, harnessParts, revealable, show, stairNoses } from './cliff_path/props.js';

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const HW = ROAD_W / 2;
const C = { zenith: '#2f6fc0', hz: '#c9dcee', below: '#e4ebf2', sun: '#fff1d6', fog: '#cbd9e8', ridge1: '#7f8f9e', ridge2: '#a3b2c2', ridge3: '#c3cfdc', cloudLit: '#ffffff', cloudShade: '#c7d2de' };
const PLANK = { l: 0.75, r: -1.2, board: 0.16, gap: 0.07 };    // 栈道木板：路面横向保留 lat −1.2（贴崖）…+0.75（化身 +0.35、影子 −0.5 都在板上），左边挖空

let S = null;

function zonesOf(route) {
  const { segs, N } = route, su = segs.filter(g => g.kind === 'stairs_up'), waits = segs.filter(g => g.kind === 'wait');
  const slots = su.filter(g => g.start < N * 0.6), ridges = su.filter(g => g.start >= N * 0.6);
  const slotEnd0 = slots.length ? slots[slots.length - 1].start + slots[slots.length - 1].steps : 0;
  let gate = waits.length ? waits[waits.length - 1] : null;
  if (gate && gate.start < Math.max(slotEnd0, N * 0.6)) gate = null;              // 栈道只放在峡缝之后、后 40% 里（太早的红灯不当栈道口，不然整条路都成了悬崖）
  const gi = gate ? segs.indexOf(gate) : -1;
  const plank = gi >= 0 && segs[gi + 1] && segs[gi + 1].kind === 'flat' ? segs[gi + 1] : null;
  let locks = null;                                                                 // 金锁关：扣安全锁前 3 段以内最近的平路
  for (let j = gi - 1; j >= Math.max(0, gi - 3) && !locks; j--) if (segs[j].kind === 'flat') locks = segs[j];
  const s1 = slots.length ? slots[0] : null, si = s1 ? segs.indexOf(s1) : -1;
  const rockStone = si > 0 && segs[si - 1].kind === 'flat' ? segs[si - 1] : null;          // 回心石：峡缝前那段平路
  const slotEnd = slots.length ? slots[slots.length - 1].start + slots[slots.length - 1].steps : null;
  const peak = slotEnd !== null ? segs.find(g => g.kind === 'flat' && g.start >= slotEnd && (!ridges[0] || g.start < ridges[0].start)) || null : null;   // 北峰
  return { slots, ridges, gate, plank, locks, rockStone, peak, slotEnd, end: g => g.start + g.steps };
}

// ---------- 贴图 ----------
function slabTexture(util, kit) {
  const t = util.canvasTexture(256, 128, (g, w, h) => {
    const im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = x / w, yy = y % 64, r = y < 64 ? 0 : 1, cut = [[0.3, 0.68], [0.17, 0.5, 0.82]];
      let v = 0.93 + 0.08 * kit.noise2(x * 0.08 + r * 5, y * 0.08) + 0.08 * (kit.hash2(x, y) - 0.5);
      if (yy < 2 || yy > 61 || cut[r].some(c => Math.abs(u - c) < 0.006)) v *= 0.6;
      const i = (y * w + x) * 4, c = Math.max(0, Math.min(255, v * 255));
      im.data[i] = c; im.data[i + 1] = c * 0.985; im.data[i + 2] = c * 0.965; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }, { repeat: true });
  t.repeat.set(1 / ROAD_W, 1); t.offset.set(0.5, 0);
  return t;
}
function stepTexture(util, kit) {
  return util.canvasTexture(128, 128, (g, w, h) => {
    const im = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const n = 0.94 + 0.07 * kit.noise2(x * 0.09, y * 0.09) + 0.1 * (kit.hash2(x, y) - 0.5), e = (x < 3 || y < 3 || x > w - 4 || y > h - 4) ? 0.8 : 1;
      const v = Math.max(0, Math.min(255, n * e * 255)), i = (y * w + x) * 4;
      im.data[i] = v; im.data[i + 1] = v * 0.985; im.data[i + 2] = v * 0.96; im.data[i + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  });
}

export function pathMaterials(ctx) {
  const { util, kit, route } = ctx, Z = zonesOf(route);
  ctx.theme.stairsRiser = 0.52;
  const road = new THREE.MeshLambertMaterial({ color: '#b1aa9f', map: slabTexture(util, kit) });
  // 栈道：这一段路面换成横铺的木板，板外和板缝挖空（alphaTest 式 discard，不透明、不和化身抢排序）
  const U = { uP0: { value: Z.plank ? Z.plank.start * STEP - 0.05 : -1e9 }, uP1: { value: Z.plank ? Z.end(Z.plank) * STEP + 0.05 : -1e9 } };
  road.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec2 vRd;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRd = uv;');
    sh.fragmentShader = `varying vec2 vRd; uniform float uP0, uP1;\n` + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      if (vRd.y > uP0 && vRd.y < uP1) {
        if (vRd.x > ${PLANK.l.toFixed(2)} || vRd.x < ${PLANK.r.toFixed(2)}) discard;
        float bi = floor(vRd.y / ${PLANK.board.toFixed(2)}), bf = fract(vRd.y / ${PLANK.board.toFixed(2)});
        if (bf < ${(PLANK.gap / PLANK.board).toFixed(3)}) discard;                       // 板缝：往下看得见深谷
        float h = fract(sin(bi * 12.9898) * 43758.5453), grain = 0.5 + 0.5 * sin(vRd.x * 38.0 + h * 20.0 + sin(vRd.x * 7.0) * 2.0);
        diffuseColor.rgb = mix(vec3(0.36, 0.25, 0.16), vec3(0.52, 0.38, 0.25), 0.35 + 0.4 * h) * (0.88 + 0.14 * grain) * (bf > 0.93 ? 0.75 : 1.0);
      }`);
  };
  road.customProgramCacheKey = () => 'cliffRoad';
  return { road, stairs: new THREE.MeshLambertMaterial({ color: '#ffffff', map: stepTexture(util, kit) }) };
}

export function build(scene, ctx) {
  const { route, kit, util, lights, meshes: M, world } = ctx, N = route.N, R = ctx.rand, Z = zonesOf(route), LOW = kit.LOW;
  const c = kit.routeCenter(route), aN = route.at(N);
  const HS = /华山/.test(world.name || ''), short = t => t && t.length <= 4 ? t : '';   // 华山的真名刻字只刻在华山；生成的 cliff_path 世界刻自己的路段名
  const sunDir = new THREE.Vector3(aN.dir.x * 0.5 - aN.left.x * 0.6, 0.62, aN.dir.z * 0.5 - aN.left.z * 0.6).normalize();   // 太阳在右前上方
  const sky = buildSky(scene, ctx, { sunDir, C });
  kit.fog(scene, C.fog, 40, 320);
  scene.background = new THREE.Color(C.below);
  lights.hemi.color.set('#eef3fa'); lights.hemi.groundColor.set('#8d8578'); lights.hemi.intensity = 1.05;
  lights.sun.color.set('#fff0d8'); lights.sun.intensity = 1.7;
  lights.sun.position.set(c.x + sunDir.x * 40, sunDir.y * 40, c.z + sunDir.z * 40);

  // ---------- 地面：峪（玉泉院 → 回心石，两侧缓缓抬起）→ 山体（右侧落下去）→ 苍龙岭（两侧贴着路沿就往下掉）→ 栈道（左侧连路底下一起掉空，右侧是崖）→ 南峰 ----------
  const zw = (a, b) => s => smooth(a - 1.5, a + 0.5, s) * (1 - smooth(b - 0.5, b + 1.5, s));   // s 在 [a, b] 段里 ≈ 1
  const valleyEnd = Z.rockStone ? Z.end(Z.rockStone) : Z.slots.length ? Z.slots[0].start : N * 0.35;
  const ridgeW = Z.ridges.length ? zw(Z.ridges[0].start, Z.end(Z.ridges[Z.ridges.length - 1])) : () => 0;
  const plankW = Z.plank ? zw(Z.plank.start - 0.3, Z.end(Z.plank) + 0.3) : () => 0;
  const voidW = Z.plank ? zw(Z.plank.start - 5, N + 9) : () => 0;                         // 左侧（镜头那侧）悬崖从南天门前几步一直到峰顶：镜头跟在后面 8 步也悬在空处；到顶也不再抬回来（不然在峰顶背后立一堵土墙）
  const topW = s => smooth(N - 4, N + 1, s);                                               // 南峰：四面往下掉
  const ground = kit.terrain(ctx, { amp: 0, drop: 0, rough: 0, size: 210, seg: LOW ? 130 : 170, seed: 11 });
  {
    const g = ground.geometry, p = g.attributes.position, col = g.attributes.color, cell = 210 / (LOW ? 130 : 170), inner = HW + cell + 0.35;
    const P0 = route.P[0], PN = route.P[N], ax = PN.x - P0.x, az = PN.z - P0.z, L2 = ax * ax + az * az || 1, meta = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), nr = util.nearestRoute(route, x, z), d = nr.d, s = nr.s, y0 = nr.y;
      const u = ((x - P0.x) * ax + (z - P0.z) * az) / L2 * N, zs = mix(u, s, 1 - smooth(4, 12, d));   // 远处按总方向的平滑坐标分区，不会因为最近点跳段起一堵墙
      const n1 = kit.fbm(x * 0.05 + 7, z * 0.05, 4), n2 = kit.fbm(x * 0.22, z * 0.22 + 3, 3), near = smooth(inner, inner + 1.2, d);
      const valley = 1 - smooth(valleyEnd - 2, valleyEnd + 6, zs);
      const V = (nr.side > 0 ? 3.0 : 2.4) * smooth(4, 14, d) * (1 - smooth(24, 50, d)) * (0.5 + n1) - 5 * smooth(28, 70, d);   // 峪：两侧起一道梁再落下去（比顶峰低）
      const Mh = nr.side > 0 ? 1.2 * smooth(3, 9, d) * (1 - smooth(10, 20, d)) - 16 * smooth(12, 50, d) : -(3 * smooth(2.6, 9, d) + 22 * smooth(9, 50, d));   // 山体：左侧先起一点再落，右侧一路落
      let y = p.getY(i) + near * mix(Mh * (0.75 + 0.5 * n1), V, valley) + 0.9 * (n2 - 0.5) * smooth(2.6, 8, d);
      const rw = ridgeW(s) * (1 - smooth(6, 14, d)), pw = plankW(s) * (1 - smooth(8, 16, d)), vw = voidW(s) * (1 - smooth(10, 18, d));
      if (rw > 0 && d > 1.25) y = mix(y, y0 - 9 * smooth(1.25, 3.5, d) - 8 * smooth(3.5, 12, d), rw);      // 苍龙岭：路沿一过就是绝壁
      if (vw > 0 && nr.side > 0 && d > 1.25) y = mix(y, y0 - 14, vw);                                      // 栈道一带：左侧路沿外就是深谷
      if (pw > 0 && d < 1.4) y = mix(y, y0 - 14, pw);                                                      // 栈道：路底下全空
      if (pw > 0 && nr.side < 0 && d >= 1.4) y = mix(y, y0 - 14, pw);                                      // 右侧也空：崖是单独一面岩（溶掉以后峰顶背后不留土台）
      const tw = topW(zs) * (1 - voidW(s));
      if (tw > 0 && d > 1.6) y = mix(y, y0 - 6 * smooth(1.6, 5, d) - 16 * smooth(5, 26, d), tw);         // 南峰：四面往下掉
      p.setY(i, y);
      meta[i * 2] = zs; meta[i * 2 + 1] = d;
    }
    g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox();
    const nrm = g.attributes.normal, cc = new THREE.Color(), green = [new THREE.Color('#5d6b3e'), new THREE.Color('#77794a'), new THREE.Color('#4a5a36')], soil = new THREE.Color('#8f846f');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = nrm.getY(i), n = kit.fbm(x * 0.12, z * 0.12, 3), n2 = kit.noise2(x * 0.45, z * 0.45);
      cc.copy(green[0]).lerp(green[1], smooth(0.45, 0.62, n)).lerp(green[2], smooth(0.6, 0.75, n2)).lerp(soil, smooth(0.66, 0.8, n + 0.2 * n2) * 0.6);
      const rock = graniteColor(kit, new THREE.Color(), x, y, z, 0.3 + 0.5 * ny);
      cc.lerp(rock, Math.min(1, smooth(0.85, 0.6, ny) + smooth(0.55, 0.75, n2 + 0.25 * (1 - ny)) * 0.6));   // 陡处 / 岩头：花岗岩，缓处：灌丛草坡
      col.setXYZ(i, cc.r, cc.g, cc.b);
    }
    col.needsUpdate = true;
  }
  const hAt = util.gridHeight(ground);

  // ---------- 台阶配色 / 去掉调试线 / 红灯换成我们自己的 ----------
  if (M.stairs && M.stairIndex.length) {
    const tc = new THREE.Color('#c5bdb1'), tmp = new THREE.Color();
    M.stairIndex.forEach((i, n) => M.stairs.setColorAt(n, tmp.copy(tc).multiplyScalar(n % 2 ? 1 : 0.92)));
    M.stairs.instanceColor.needsUpdate = true;
  }
  const nose = stairNoses(ctx, SEG.stairs_up); if (nose) scene.add(nose);
  const sfx = kit.stepFx(ctx, { dust: '#d9ccb6', flash: '#fff0c8' });   // 落阶反馈：花岗岩石阶扬浅灰尘
  for (const k of ['lines', 'edges', 'startLine', 'camp', 'flag']) if (M[k]) M[k].visible = false;
  for (const sg of M.signals) { sg.group.visible = false; sg.stop.visible = false; }

  const vc = new THREE.MeshLambertMaterial({ vertexColors: true });
  const rockMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const texts = [], textsUp = [], textsPlank = [];                          // 刻字跟着各自的溶解组走（不然崖溶掉了字还悬在半空）
  const faceAt = (s, side) => route.at(s).left.clone().multiplyScalar(-side);          // 路 side 侧的崖面朝路
  // 溶解组：slot = 峡缝高崖（走过就溶掉）、stone = 惊心石（化身一钻过去就溶：镜头还在缝里、石头正挡在中间）、up = 山上（走近才露面）、plank = 栈道高崖（走过就溶掉）
  const rev = { slot: { value: 1 }, stone: { value: 1 }, up: { value: 0 }, plank: { value: 0 } }, groups = { slot: [], stone: [], up: [], plank: [] };
  let stoneS = null;
  const add = (m, grp) => { scene.add(m); if (grp) groups[grp].push(m); return m; };
  const rmat = grp => revealable(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), rev[grp]);

  // ---------- 玉泉院山门（跨路） ----------
  {
    const a = route.at(1.2), { parts, plaqueY } = gateParts(2.4, 3.1);
    const m = new THREE.Mesh(util.merged(parts), revealable(new THREE.MeshLambertMaterial({ vertexColors: true }), rev.slot)); m.position.copy(a.pos); m.rotation.y = -a.heading + Math.PI / 2; m.name = 'gate'; add(m, 'slot');
    texts.push({ text: world.route[0].label || '山门', p: a.pos.clone().setY(a.pos.y + plaqueY).addScaledVector(a.dir, -0.15), ry: -a.heading - Math.PI / 2, h: 0.5, color: '#f2d27a', weight: 900, pad: 0.2 });
  }

  // ---------- 峪壁（华山峪两侧的花岗岩壁，走过就溶掉） ----------
  for (const side of [1, -1]) {
    const g = cliffWall(ctx, { side, s0: -8, s1: valleyEnd + 3, lat: s => (side > 0 ? 5.2 : 4.4) + 1.2 * Math.sin(s * 0.37 + side), top: s => 3.6 + 1.6 * kit.noise2(s * 0.2, side * 3), base: -1.2, seed: 3 + side, rows: 18 });
    add(new THREE.Mesh(g, rmat('slot')), 'slot').name = 'gorgeWall';
  }
  // 回心石：峡缝口路右的一块巨石 + 红字
  if (Z.rockStone) {
    const s = Z.rockStone.start + 0.8, a = route.at(s, -2.3), y = route.heightAt(s);
    const m = new THREE.Mesh(boulderGeo(kit, 5), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    m.position.copy(a.pos).setY(y + 0.7); m.scale.set(1.2, 1.3, 1.0); m.rotation.y = R() * 6; m.name = 'huixinshi'; scene.add(m);
    const f = faceAt(s, -1).addScaledVector(a.dir, -0.8).normalize();
    const w = short(Z.rockStone.label) || (HS ? '回心石' : '');
    if (w) texts.push(carving(w, a.pos.clone().setY(y + 1.05).addScaledVector(f, 1.05), f, { h: 1.0 }));
  }

  // ---------- 峡缝（千尺幢 / 百尺峡）：两侧直上直下的窄缝，崖脚 1.7；缝顶卡一块惊心石；走过就溶掉 ----------
  Z.slots.forEach((sg, j) => {
    const s0 = sg.start - 1.2, s1 = Z.end(sg) + 1.2;
    for (const side of [1, -1]) {
      const g = cliffWall(ctx, { side, s0, s1, lat: 1.72, top: s => 5.2 + 1.2 * Math.sin(s * 0.9 + side), base: -1.2, lean: 0.35, seed: 11 + j * 3 + side, ribs: 0.9 });
      add(new THREE.Mesh(g, rmat('slot')), 'slot').name = 'slot';
    }
    const mid = sg.start + sg.steps * 0.5, a = route.at(mid);
    const word = j === 0 && HS ? '太华咽喉' : short(sg.label);
    if (word) texts.push(carving(word, a.pos.clone().addScaledVector(a.left, 1.6).setY(route.heightAt(mid) + 2.2), a.left.clone().negate(), { h: j === 0 ? 1.9 : 1.4 }));
    if (j === 1 || Z.slots.length === 1) {                                   // 惊心石：卡在缝顶的巨石
      stoneS = sg.start + sg.steps * 0.6;
      const b = route.at(stoneS), y = route.heightAt(stoneS);
      const m = new THREE.Mesh(boulderGeo(kit, 9), rmat('stone')); m.material.flatShading = true;
      m.position.copy(b.pos).setY(y + 2.5); m.scale.set(1.0, 0.75, 1.95); m.rotation.y = -b.heading; m.name = 'jingxinshi'; add(m, 'stone');   // z 横跨缝口，两头压进崖里
    }
  });

  // ---------- 苍龙岭：两侧贴着路沿往下插的绝壁（顶面略高过路面 0.2） ----------
  for (const sg of Z.ridges) for (const side of [1, -1]) {
    const g = cliffWall(ctx, { side, s0: sg.start - 1, s1: Z.end(sg) + 1, lat: 1.45, top: 0.16, base: -9, seed: 21 + side, rows: 20, ribs: 0.8, taper: 1 });
    add(new THREE.Mesh(g, rockMat), null).name = 'ridgeFace';
  }
  if (Z.ridges.length) {                                                     // 岭上端「韩退之投书处」：路右一块矮石（< 1.2）
    const sg = Z.ridges[Z.ridges.length - 1], e = Z.end(sg) - 0.4, a = route.at(e, -1.75), y = route.heightAt(e);
    const m = new THREE.Mesh(boulderGeo(kit, 17), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    m.position.copy(a.pos).setY(y + 0.25); m.scale.set(0.55, 0.9, 0.35); m.rotation.y = -a.heading; m.name = 'hanyu'; add(m, 'up');
    const f = route.at(e).dir.clone().negate().addScaledVector(a.left, 0.5).normalize();
    const w = HS ? '韩退之投书处' : short(sg.label);
    if (w) textsUp.push(carving(w, a.pos.clone().setY(y + 0.55).addScaledVector(f, 0.36), f, { h: 1.15 }));
  }

  // ---------- 栈道：右侧高崖（上高 7、下插 14，略前倾）、铁架托板、崖上保险链；尽头崖上「全真崖」；扣安全锁处挂安全带 ----------
  if (Z.plank) {
    const s0 = Z.plank.start - 1.5, s1 = Z.end(Z.plank) + 1.2;
    const wall = cliffWall(ctx, { side: -1, s0, s1, lat: 1.3, top: 5, base: -14, lean: 0.5, seed: 31, rows: 34, taper: 1 });
    add(new THREE.Mesh(wall, rmat('plank')), 'plank').name = 'plankCliff';
    for (const m of plankIron(ctx, Z.plank.start, Z.end(Z.plank), { wallLat: -1.3 })) add(m, 'up');
    const edge = cliffWall(ctx, { side: 1, s0: Z.plank.start - 5.5, s1: Z.plank.start + 0.4, lat: 1.3, top: 0.05, base: -13, seed: 37, rows: 20, taper: 1 });   // 南天门外：路左沿下面就是直落的崖面
    add(new THREE.Mesh(edge, rockMat), null).name = 'voidEdge';
    const e = Z.end(Z.plank) - 0.6, a = route.at(e);
    if (HS) textsPlank.push(carving('全真崖', a.pos.clone().addScaledVector(a.left, -1.2).setY(route.heightAt(e) + 2.4), a.left.clone(), { h: 1.1 }));
    if (Z.gate) {
      const b = route.at(Z.gate.start + 0.2, -1.2), hm = new THREE.Mesh(util.merged(harnessParts()), vc);
      hm.position.copy(b.pos).setY(route.heightAt(Z.gate.start) + 1.05); hm.rotation.y = -b.heading; hm.name = 'harness'; add(hm, 'up');
    }
  }

  // ---------- 铁链：所有上台阶两侧；金锁关那段挂满同心锁 ----------
  {
    for (const m of chains(ctx, Z.slots.map(g => [g.start - 0.5, Z.end(g) + 0.5]), { lat: 1.45, locks: 0.25 })) add(m, 'slot');   // 峡缝的链跟峡缝一起：进缝就有，走过才溶
    for (const m of chains(ctx, Z.ridges.map(g => [g.start - 0.5, Z.end(g) + 0.5]), { lat: 1.3, locks: 0.35 })) add(m, 'up');   // 苍龙岭：链桩立在两侧崖面顶上
    if (Z.locks) for (const m of chains(ctx, [[Z.locks.start - 0.5, Z.end(Z.locks) + 0.5]], { lat: 1.45, locks: 1, sag: 0.14 })) add(m, 'up');
  }

  // ---------- 华山松：崖头、北峰、苍龙岭两侧低处、南峰顶；按树冠大小留距离：树冠不进路右 1.4（影子那条道）、路左 3（镜头那侧）以内 ----------
  {
    const sets = [[], [], []];
    const put = (s, lat, sc, y, big) => { const a = route.at(s, lat); sets[big ? 0 : 1 + (R() * 2 | 0)].push({ p: [a.pos.x, (y ?? hAt(a.pos.x, a.pos.z)) - 0.1, a.pos.z], ry: -a.heading + (lat > 0 ? Math.PI : 0) + (R() - 0.5) * 0.8, s: sc }); };
    for (let k = 0, tries = 0; k < (LOW ? 40 : 80) && tries < 1500; tries++) {
      const s = -6 + R() * (N + 12), side = R() < 0.5 ? 1 : -1, lat = side * ((side > 0 ? 3.2 : 2.2) + Math.pow(R(), 1.5) * 14), a = route.at(s, lat);
      const big = R() < 0.25, sc = 0.7 + 0.6 * R(), reach = 1.5 * (big ? 1.5 : 1.1) * sc;   // 树冠往外伸 ≈ 1.5 × 树形 × 缩放
      if (!util.offRoad(route, a.pos.x, a.pos.z, (side > 0 ? 1.9 : 0.3) + reach) || plankW(s) > 0.3 || voidW(s) > 0.3 && lat > 0 || ridgeW(s) > 0.2 && Math.abs(lat) < 9 || s > N - 3) continue;
      put(s, lat, sc, undefined, big); k++;
    }
    if (Z.peak) put(Z.peak.start + 1, -3.8, 1.3, undefined, false);
    put(N + 5, -5.5, 1.3, route.heightAt(N) - 0.8, R() < 0.25);                                  // 峰顶只留一棵，放在登顶环绕镜头圈外
    const geos = [pineGeo(util, R, true), pineGeo(util, R), pineGeo(util, R)];
    geos.forEach((g, k) => { if (sets[k].length) { const m = util.instanced(g, vc, sets[k]); m.name = 'pines'; scene.add(m); } });
  }

  // ---------- 南峰：「华山极顶」石（路右），顶上平台 ----------
  {
    const s = N + 2.3, a = route.at(s, -1.7), y = route.heightAt(N);
    const f = a.left.clone().multiplyScalar(0.8).addScaledVector(route.at(s).dir, 0.6).normalize();   // 字面朝左前方：登顶镜头从化身左前方起，正对着它
    // 极顶石：一块立着的花岗岩（正面平、四周粗），红字刻在正面
    const slab = new THREE.BoxGeometry(0.9, 1.9, 0.4, 3, 6, 1).toNonIndexed(), sp = slab.attributes.position, sc = [], cc = new THREE.Color();
    for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), yy = sp.getY(i), z = sp.getZ(i); if (Math.abs(z) < 0.19 || Math.abs(x) > 0.44) sp.setX(i, x * (0.92 + 0.12 * kit.noise2(yy * 3, z * 5))); }
    slab.computeVertexNormals();
    for (let i = 0; i < sp.count; i++) { graniteColor(kit, cc, sp.getX(i) * 4, sp.getY(i) * 4, sp.getZ(i) * 4, 0.55); sc.push(cc.r, cc.g, cc.b); }
    slab.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
    const m = new THREE.Mesh(slab, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    m.position.copy(a.pos).setY(y + 0.8); m.rotation.y = Math.atan2(f.x, f.z); m.name = 'jiding'; add(m, 'up');
    const w = HS ? '华山极顶' : short(world.summit && world.summit.name);
    if (w) textsUp.push(carving(w, a.pos.clone().setY(y + 0.95).addScaledVector(f, 0.22), f, { h: 1.35 }));
  }

  for (const [list, grp] of [[texts, 'slot'], [textsUp, 'up'], [textsPlank, 'plank']]) {        // 山门匾额 / 回心石 / 峡缝刻字跟峡缝一起溶
    if (!list.length) continue;
    const m = kit.signs2(util, list, { size: 96 }); m.name = 'carvings'; revealable(m.material, rev[grp]); add(m, grp);
  }

  // ---------- 影子：白天浅色花岗岩上用美术范式的深青（不用蓝：撞捷风、撞下坡） ----------
  ctx.theme.ghost = ctx.theme.ghost || WHO.ghost.bright;
  ctx.theme.ghostOpacity = ctx.theme.ghostOpacity || 0.55;
  if (ctx.theme.ghostRim === undefined) ctx.theme.ghostRim = '#063f3a';

  // ---------- 镜头 ----------
  Object.assign(ctx.camRig.summit, { radius: 4.3, height: 1.7, lookY: 1.25, speed: 0.2, hold: 1.2, face: route.at(N - 3.6, -2.2).pos.setY(route.heightAt(N) + 1.2) });

  S = { ctx, sky, route, Z, rev, groups, anchors: camAnchors(Z, N), valleyEnd, slotEnd: Z.slotEnd ?? valleyEnd, stoneS, sfx };
  rigFor(0, ctx.camRig, false);
  update(0, { t: 0, s: 0, summit: false, preview: ctx.preview, camera: ctx.camera, terrain: null });
}

// ---------- 镜头：按地标插值（跟拍 follow + 正面 front 一起调） ----------
const CAM = {
  open:  { back: 6.2, side: 1.0, height: 1.8, lookY: 3.4, clear: 1.7, fDist: 2.4, fSide: 0.45, fHeight: 1.45, fLook: 1.2, fClear: 1.2 },   // 山门
  walk:  { back: 4.8, side: 1.3, height: 2.0, lookY: 1.5, clear: 1.7, fDist: 2.4, fSide: 0.45, fHeight: 1.45, fLook: 1.2, fClear: 1.2 },
  slot:  { back: 3.9, side: 0.3, height: 0.75, lookY: 2.5, clear: 1.0, fDist: 2.2, fSide: 0.15, fHeight: 1.5, fLook: 1.15, fClear: 1.2 },  // 峡缝：缝里低机位仰拍
  peak:  { back: 5.0, side: 1.4, height: 2.4, lookY: 1.2, clear: 1.7, fDist: 2.5, fSide: 0.6, fHeight: 1.5, fLook: 1.1, fClear: 1.2 },
  ridge: { back: 4.0, side: 1.5, height: 2.3, lookY: 0.9, clear: 1.8, fDist: 2.4, fSide: 0.45, fHeight: 1.75, fLook: 0.8, fClear: 1.2 },  // 苍龙岭：看两边绝壁；正面镜头站在岭上往回看，身后岭脊一路往下、两边直落
  locks: { back: 4.2, side: 1.2, height: 1.8, lookY: 1.3, clear: 1.6, fDist: 2.4, fSide: 0.5, fHeight: 1.45, fLook: 1.2, fClear: 1.2 },
  plank: { back: 3.3, side: 2.0, height: 1.5, lookY: 1.0, clear: 1.2, fDist: 2.6, fSide: 2.4, fHeight: 0.35, fLook: 0.95, fClear: 0.1 },  // 栈道：镜头悬在空的那一侧；正面镜头和木板齐平，峰哥全身、身后崖面上下都看得见
};
// 相邻的同类地标并成一段（千尺幢 + 百尺峡 + 老君犁沟 = 一条缝），按路线顺序排锚点；
//   后一段的「进场」锚点要是落进前一段里面就不要（不然镜头在两段之间一上一下地颠）
function spans(list) {
  const out = [];
  for (const g of list) { const e = g.start + g.steps, last = out[out.length - 1]; if (last && g.start <= last.e + 0.5) last.e = Math.max(last.e, e); else out.push({ s: g.start, e }); }
  return out;
}
function camAnchors(Z, N) {
  const zones = [
    ...spans(Z.slots).map(z => ({ at: z.s, a: [[z.s - 1.6, CAM.walk, 1], [z.s - 0.2, CAM.slot], [z.e - 0.2, CAM.slot], [z.e + 1.4, CAM.peak]] })),
    ...spans(Z.ridges).map(z => ({ at: z.s, a: [[z.s - 1.6, CAM.peak, 1], [z.s + 0.4, CAM.ridge], [z.e, CAM.ridge]] })),
    ...(Z.locks ? [{ at: Z.locks.start, a: [[Z.locks.start - 0.2, CAM.locks, 1], [Z.end(Z.locks), CAM.locks]] }] : []),
    ...(Z.plank ? [{ at: Z.plank.start, a: [[Z.plank.start - 1.2, CAM.plank, 1], [Z.end(Z.plank) + 0.4, CAM.plank], [Z.end(Z.plank) + 2.2, CAM.peak]] }] : []),
  ].sort((x, y) => x.at - y.at);
  const A = [[-1e9, CAM.open], [2, CAM.open], [4.5, CAM.walk]];
  for (const z of zones) for (const [s, p, approach] of z.a) {
    const last = A[A.length - 1][0];
    if (s > last + 0.05) A.push([s, p]);
    else if (!approach) A.push([last + 0.3, p]);                                    // 核心锚点被挤到前一段后面一点
  }
  A.push([1e9, A[A.length - 1][1]]);
  return A;
}
export function rigFor(s, r, summit) {
  if (summit || !r || !S) return;
  const A = S.anchors, F = r.follow, Fr = r.front;
  let i = 0; while (i < A.length - 2 && s > A[i + 1][0]) i++;
  const [sa, pa] = A[i], [sb, pb] = A[i + 1], t = smooth(sa, sb, s), m = k => mix(pa[k], pb[k], t);
  for (const k of ['back', 'side', 'height', 'lookY', 'clear']) F[k] = m(k);
  F.backStairs = F.back; F.sideStairs = F.side; F.upBonus = 0; F.stairsBonus = 0; F.lookUp = 0; F.footMin = -0.82;
  if (Fr) { Fr.dist = m('fDist'); Fr.side = m('fSide'); Fr.height = m('fHeight'); Fr.lookY = m('fLook'); Fr.clear = m('fClear'); }
}

// ---------- 每帧 ----------
export function update(dt, st) {
  if (!S) return;
  const { rev, groups, Z, route } = S, N = route.N, s = st.s;
  S.sky.update(st.t || 0);
  S.sfx.update(dt, st);
  rev.slot.value = st.summit ? 0 : 1 - smooth(S.slotEnd - 0.5, S.slotEnd + 1.5, s);        // 峡缝 / 峪壁：一出缝就溶（镜头落后 8 步还在缝里，不溶会挡住化身）
  rev.stone.value = S.stoneS === null ? 0 : rev.slot.value * (1 - smooth(S.stoneS + 1.5, S.stoneS + 3.5, s));
  rev.up.value = st.summit ? 1 : smooth(S.slotEnd - 6, S.slotEnd - 1, s);                  // 山上的东西：出了峡缝才露面
  rev.plank.value = st.summit ? 0 : Z.plank ? smooth(Z.plank.start - 9, Z.plank.start - 5, s) * (1 - smooth(Z.end(Z.plank) + 1.5, Z.end(Z.plank) + 3, s)) : 0;
  for (const k in groups) for (const m of groups[k]) {
    show(m, rev[k].value > 0.001);
    if (m.castShadow || m.userData.cs) { m.userData.cs = true; m.castShadow = rev[k].value > 0.99; }   // 光影线第一帧给开的投影：溶到一半不投（深度图不认 dither）
  }
}
