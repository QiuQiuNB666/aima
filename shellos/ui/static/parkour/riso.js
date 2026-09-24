// 跑酷的「三墨一纸」孔版印刷后期（?look=riso，默认关）。范式：纸 #f0e9da 就是白，三墨 暖 #e8552a / 冷 #3b6f9e / 深 #26252e 叠印（multiply），
//   网点是唯一的灰，套印错位固定，没有渐变 / 模糊 / 投影 / 绿 / #fff / #000，线会沸（一拍二，seed = 7000 + 帧号），纸颗粒 seed 99 静止。
// 接法：main.js 里一行 makeRiso({...})。这里把 renderer.render 换成自己的：主循环照旧 renderer.render(scene, camera)，实际走下面三步——
//   ① 原样画一遍 → 色调（亮度）；② 换成「分墨」材质再画一遍 → 每个像素属于谁（天 / 楼 / 标线 / 峰哥 / 机甲 / 猫 / 月亮）+ 朝上还是朝侧 + 深度；
//   ③ 一道全屏着色器：每支墨按自己的套印偏移去取样、按规则出实色 / 网点 / 排线，深墨轮廓线按类别 / 深度 / 朝向的断层描出来，全部 multiply 到纸上，再压一层纸颗粒。
// 规则：天 = 暖墨实色（色场），月亮 = 留纸；楼顶 = 冷墨网点 + 水平排线，楼墙 = 冷网 + 暗处叠深网，60 m 外换冷浅版推远，亮窗 = 暖网；
//   标线按原色相归暖 / 冷 / 深实色（起跳沿、落地沿这些玩法提示不丢）；峰哥 = 深墨，机甲 = 暖墨，猫 = 深网（猫的灰）。
//   ?fx=low：网点改查 CanvasTexture 小贴图（和范式页 dotTile 同一个画法），不逐像素算距离。
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const PAPER = '#f0e9da', INK = { warm: '#e8552a', cool: '#3b6f9e', dark: '#26252e' };
const OFF = { warm: [2.5, -1.5], cool: [-2, 2], dark: [0, 0] };            // 套印错位（1080 画幅像素，y 向下）
const SCREEN = { dark: [8, 1.8], warm: [7, 2.4], cool: [7, 2.2], pale: [9, 1.4] };   // 网点 gap / r
const C = { SKY: 0, SOLID: 2, WARM: 3, COOL: 4, DARK: 5, FENG: 6, MECH: 7, CAT: 8, MOON: 9, EYE: 10 };   // 分墨类别（写进 R 通道 /16）

const hex3 = h => { const c = new THREE.Color(h); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };   // 线性值（着色器里算完再编码回 sRGB）

// 分墨材质：Lambert（带蒙皮、带法线），最后一行改成输出 (类别, 世界法线 y)
function classMat(code) {
  const m = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>',
      `gl_FragColor = vec4(${(code / 16).toFixed(4)}, (vec4(normal, 0.0) * viewMatrix).y * 0.5 + 0.5, 0.0, 1.0);`);
  };
  m.customProgramCacheKey = () => 'riso-class-' + code;
  return m;
}

// 标线（MeshBasic）按原色相归墨：红橙黄品红 = 暖，绿青蓝 = 冷，很暗 = 深
function accentCode(color) {
  const hsl = {}; color.getHSL(hsl);
  if (hsl.l < 0.12) return C.DARK;
  return hsl.h < 0.14 || hsl.h > 0.8 ? C.WARM : C.COOL;
}

// 网点小贴图（?fx=low 用）：和范式页 dotTile 一样，格心 + 四角各一个点
function dotTex(gap, r) {
  const cv = document.createElement('canvas'); cv.width = cv.height = gap;
  const g = cv.getContext('2d'); g.fillStyle = '#fff';
  for (const [x, y] of [[gap / 2, gap / 2], [0, 0], [gap, 0], [0, gap], [gap, gap]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}

const FS = `
precision highp float;
uniform sampler2D tCol, tCls, tDep; uniform vec2 uRes; uniform float uK, uSeed, uNear, uFar;
#ifdef LOW
uniform sampler2D tDotDark, tDotWarm, tDotCool, tDotPale;
#endif
varying vec2 vUv;
const vec3 PAPER = ${hex3(PAPER)}, WARM = ${hex3(INK.warm)}, COOL = ${hex3(INK.cool)}, DARK = ${hex3(INK.dark)};
float h21(vec2 p, float s){ return fract(sin(dot(p, vec2(127.1, 311.7)) + s * 17.13) * 43758.5453); }
float vnoise(vec2 p, float s){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i, s), h21(i + vec2(1, 0), s), f.x), mix(h21(i + vec2(0, 1), s), h21(i + vec2(1, 1), s), f.x), f.y); }
// 网点：格心 + 四角（45° 网），gap / r 按 1080 画幅给，uK = 画面高 / 1080
float dots(vec2 px, float gap, float r){
  vec2 c = mod(px, gap * uK) - 0.5 * gap * uK;
  vec2 d = abs(c); float e = min(length(d), length(d - 0.5 * gap * uK));
  return 1.0 - smoothstep(r * uK - 0.6, r * uK + 0.6, e);
}
#ifdef LOW
float tile(sampler2D t, vec2 px, float gap){ return texture2D(t, px / (gap * uK)).r; }
#define DOT_DARK(p) tile(tDotDark, p, 8.0)
#define DOT_WARM(p) tile(tDotWarm, p, 7.0)
#define DOT_COOL(p) tile(tDotCool, p, 7.0)
#define DOT_PALE(p) tile(tDotPale, p, 9.0)
#else
#define DOT_DARK(p) dots(p, 8.0, 1.8)
#define DOT_WARM(p) dots(p, 7.0, 2.4)
#define DOT_COOL(p) dots(p, 7.0, 2.2)
#define DOT_PALE(p) dots(p, 9.0, 1.4)
#endif
float hatchH(vec2 px){ return 1.0 - smoothstep(0.55 * uK, 0.55 * uK + 0.6, abs(mod(px.y, 11.0 * uK) - 5.5 * uK)); }   // 地面：水平排线
float linZ(float d){ return uNear * uFar / (uFar - d * (uFar - uNear)); }
int cls(vec2 uv){ return int(floor(texture2D(tCls, uv).r * 16.0 + 0.5)); }
float tone(vec2 uv){ vec3 c = texture2D(tCol, uv).rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); l = l == l ? l : 0.0; return clamp(pow(max(l, 0.0) * 2.2, 0.45), 0.0, 1.0); }

// 一支墨在像素 px（已经按这支墨的套印偏移挪过）上盖多少：0 = 纸，1 = 实色
vec3 cover(vec2 px){                      // x = 暖, y = 冷, z = 深
  vec2 uv = px / uRes;
  int k = cls(uv); float t = tone(uv), ny = texture2D(tCls, uv).g * 2.0 - 1.0, z = linZ(texture2D(tDep, uv).r);
  if (k == ${C.SKY}) return vec3(1.0, 0.0, 0.0);                                  // 天：暖墨色场
  if (k == ${C.MOON}) return vec3(0.0);                                          // 月亮：留纸
  if (k == ${C.WARM}) return vec3(1.0, 0.0, 0.0);
  if (k == ${C.COOL}) return vec3(0.0, 1.0, 0.0);
  if (k == ${C.DARK} || k == ${C.EYE}) return vec3(0.0, 0.0, 1.0);
  if (k == ${C.FENG}) return vec3(0.0, 0.0, t < 0.35 ? 1.0 : DOT_DARK(px));                      // 峰哥：深墨，暗面实色、亮面深网
  if (k == ${C.MECH}) return vec3(t < 0.4 ? 1.0 : DOT_WARM(px), 0.0, t < 0.12 ? DOT_DARK(px) : 0.0);   // 机甲：暖墨
  if (k == ${C.CAT}) return vec3(0.0, 0.0, DOT_DARK(px));                        // 猫的灰 = 深网 8/1.8
  // 楼 / 障碍（SOLID）
  if (z > 60.0) return vec3(t > 0.55 ? DOT_PALE(px) : 0.0, DOT_PALE(px), 0.0);   // 远景：冷浅版推远，亮窗一点暖
  if (t > 0.55 && ny < 0.5) return vec3(DOT_WARM(px), 0.0, 0.0);                  // 亮窗
  if (ny > 0.7) return t > 0.62 ? vec3(0.0) : vec3(0.0, max(DOT_COOL(px), hatchH(px)), t < 0.22 ? DOT_DARK(px) : 0.0);   // 楼顶：冷网 + 水平排线，暗处叠深网；车道线 / 警示带亮处留纸
  return vec3(0.0, DOT_COOL(px), t < 0.3 ? DOT_DARK(px) : 0.0);                  // 墙 / 障碍侧面：冷网，暗处叠深网
}

// 深墨轮廓：类别 / 深度 / 朝向的断层；取样点按沸腾噪声挪一点（一拍二，seed = 7000 + 帧号）
float outline(vec2 px){
  vec2 j = vec2(vnoise(px * 0.035, uSeed), vnoise(px * 0.035 + 31.7, uSeed)) - 0.5;
  vec2 p = px + j * 3.0 * uK, uv = p / uRes;
  int k0 = cls(uv); float z0 = linZ(texture2D(tDep, uv).r), n0 = texture2D(tCls, uv).g;
  float w = 1.7 * uK, e = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982;
    vec2 q = (p + vec2(cos(a), sin(a)) * w) / uRes;
    int k = cls(q); float z = linZ(texture2D(tDep, q).r), n = texture2D(tCls, q).g;
    bool sky = k0 == ${C.SKY} && k == ${C.SKY};
    if (!sky && (k != k0 || abs(z - z0) > 0.06 * min(z, z0) + 0.05 || abs(n - n0) > 0.25)) e = 1.0;
  }
  if (k0 == ${C.SKY} && e > 0.0 && z0 > 150.0) e = 0.0;
  return e;
}

void main(){
  vec2 px = vUv * uRes;
  float warm = cover(px - vec2(${OFF.warm[0].toFixed(1)}, ${(-OFF.warm[1]).toFixed(1)}) * uK).x;   // 套印：墨版挪了 (dx, dy)，这一点取的是挪之前的位置
  float cool = cover(px - vec2(${OFF.cool[0].toFixed(1)}, ${(-OFF.cool[1]).toFixed(1)}) * uK).y;
  float dark = max(cover(px).z, outline(px));
  vec3 c = PAPER;
  c *= mix(vec3(1.0), WARM, warm);
  c *= mix(vec3(1.0), COOL, cool);
  c *= mix(vec3(1.0), DARK, dark);
  float g = h21(floor(px / max(1.0, uK)), 99.0);                                 // 纸颗粒：seed 99，静止，只会更暗
  c *= 1.0 - 0.05 * step(0.93, g) - 0.02 * step(0.6, g);
  gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}`;

// 猫：坐姿（五个基础姿态之一），深网的灰 + 两点眼睛。几何全是基础体，坐标系 +X = 猫的正前方
function makeCat() {
  const g = new THREE.Group(), body = classMat(C.CAT), eye = classMat(C.EYE);
  const add = (geo, m, p, s = [1, 1, 1], r = [0, 0, 0]) => { const o = new THREE.Mesh(geo, m); o.position.set(...p); o.scale.set(...s); o.rotation.set(...r); g.add(o); o.userData.riso = m === eye ? C.EYE : C.CAT; return o; };
  add(new THREE.SphereGeometry(0.2, 16, 12), body, [0, 0.2, 0], [0.9, 1.25, 0.85]);                // 身子（坐着，上窄下宽）
  add(new THREE.SphereGeometry(0.13, 16, 12), body, [0.06, 0.5, 0]);                             // 头 ≈ 身长 1/3
  for (const s of [-1, 1]) {
    add(new THREE.ConeGeometry(0.05, 0.1, 4), body, [0.06, 0.64, s * 0.075], [1, 1, 1], [s * 0.25, 0, 0]);   // 耳高 < 头径一半
    add(new THREE.SphereGeometry(0.018, 8, 6), eye, [0.18, 0.52, s * 0.045]);                     // 眼睛两点
    add(new THREE.CylinderGeometry(0.035, 0.04, 0.18, 8), body, [0.12, 0.09, s * 0.07]);          // 前腿
  }
  const tail = new THREE.CatmullRomCurve3([[-0.14, 0.04, 0], [-0.3, 0.03, 0.08], [-0.34, 0.16, 0.2], [-0.26, 0.3, 0.24]].map(v => new THREE.Vector3(...v)));
  add(new THREE.TubeGeometry(tail, 16, 0.025, 6), body, [0, 0, 0]);
  g.scale.setScalar(2.2);
  return g;
}

export function makeRiso({ renderer, scene, camera, av, jf, low = false, level, run }) {
  const render = renderer.render.bind(renderer);
  const size = renderer.getSize(new THREE.Vector2());
  const colRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
  const clsRT = new THREE.WebGLRenderTarget(size.x, size.y, { depthTexture: new THREE.DepthTexture(size.x, size.y), minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const U = { tCol: { value: colRT.texture }, tCls: { value: clsRT.texture }, tDep: { value: clsRT.depthTexture }, uRes: { value: size.clone() }, uK: { value: 1 }, uSeed: { value: 7000 }, uNear: { value: camera.near }, uFar: { value: camera.far } };
  if (low) Object.assign(U, { tDotDark: { value: dotTex(...SCREEN.dark) }, tDotWarm: { value: dotTex(...SCREEN.warm) }, tDotCool: { value: dotTex(...SCREEN.cool) }, tDotPale: { value: dotTex(...SCREEN.pale) } });
  const quad = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: U, defines: low ? { LOW: '' } : {}, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: FS, depthTest: false, depthWrite: false }));
  const resize = () => { renderer.getSize(size); colRT.setSize(size.x, size.y); clsRT.setSize(size.x, size.y); U.uRes.value.copy(size); U.uK.value = Math.max(0.6, size.y / 1080); };
  resize(); addEventListener('resize', resize);

  // 猫客串：坐在前方某个屋顶边的护栏上，脸朝来人；人跑过去了就挪到下一个屋顶
  const cat = makeCat(); scene.add(cat);
  let catSeg = null;
  function placeCat() {
    const L = level(), R = run(); if (!L || !R) return;
    if (catSeg && catSeg.x1 > R.x - 3 && L.segs.includes(catSeg)) return;
    catSeg = L.segs.find(s => s.kind === 'roof' && s.x0 > R.x + 22 && s.x1 - s.x0 > 6) || null;
    if (!catSeg) { cat.visible = false; return; }
    cat.visible = true;
    cat.position.set(Math.min(catSeg.x1 - 1.5, catSeg.x0 + 4), catSeg.h0 + 0.5, 3.88);   // 坐在护栏（高 0.5）上
    cat.rotation.y = Math.PI * 0.8;                                             // 斜对着跑过来的人
  }

  const mats = new Map(), saved = [], bg = { v: null };
  const code = o => {
    if (o.userData.riso !== undefined) return o.userData.riso;
    for (let p = o; p; p = p.parent) { if (p === av.group) return C.FENG; if (jf && p === jf.group) return C.MECH; }
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (m.isMeshBasicMaterial) return m.fog === false ? C.MOON : accentCode(m.color);
    return C.SOLID;
  };
  function swap() {
    scene.traverseVisible(o => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && m.transparent) { saved.push([o, o.material, o.visible]); o.visible = false; return; }   // 拖尾、光效：不分墨
      const k = code(o);
      if (!mats.has(k)) mats.set(k, classMat(k));
      saved.push([o, o.material, o.visible]); o.material = mats.get(k);
    });
  }
  const restore = () => { for (const [o, m, v] of saved) { o.material = m; o.visible = v; } saved.length = 0; };

  renderer.render = (s, cam) => {
    if (s !== scene) return render(s, cam);
    placeCat();
    renderer.setRenderTarget(colRT); render(scene, cam);
    swap(); bg.v = scene.background; scene.background = null; const fog = scene.fog; scene.fog = null;
    renderer.setRenderTarget(clsRT); renderer.setClearColor(0x000000, 1); renderer.clear(); render(scene, cam);
    scene.background = bg.v; scene.fog = fog; restore();
    U.uSeed.value = 7000 + Math.floor(performance.now() / 1000 * 12) * 2;       // 线会沸：24 fps 一拍二 → 每 1/12 s 换一张，seed = 7000 + 帧号
    U.uNear.value = cam.near; U.uFar.value = cam.far;
    renderer.setRenderTarget(null); quad.render(renderer);
  };
  window.__riso = { cat, colRT, clsRT, U };
  return { cat };
}
