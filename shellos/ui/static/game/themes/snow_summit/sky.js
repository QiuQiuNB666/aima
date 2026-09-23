// 高海拔的天：渐变穹顶（低处藏蓝 → 风雪灰白 → 登顶蓝黑）+ 太阳 + 喜马拉雅群峰剪影（雪线以上白、随爬升沉到地平线下）
//   + 远处的珠峰北壁和旗云（只在低处看得到，风雪一来就隐进天里）+ 云海（中段往上才有，登顶铺满脚下）。
import * as THREE from 'three';

const LOW = typeof location !== 'undefined' && new URLSearchParams(location.search).get('fx') === 'low';

// 风雪总线（snow.js 读）：squall = 白毛风强度 0..1；sun = 太阳可见度（闪点用）；sunDir = 日照方向（固定）
export const WX = { squall: 0, sun: 1, sunDir: new THREE.Vector3(0, 1, 0) };
if (typeof window !== 'undefined') window.__wx = WX;   // 调试：__wx.squall = 1 手动起白毛风
// 天气事件：北山脊上突然一阵白毛风——2 s 内能见度掉到约 6 m，刮 24 s，4 s 放晴；登顶前一定是晴的（p > 0.88 不起、起了也收）。
//   触发只看进度：p 走进 [0.64, 0.86) 起一次（回山脚重来会再起）。要 snow_summit.js 在 apply 的 k 里带 p / dt 才会动。
const SQ = { p0: 0.64, p1: 0.86, len: 30, t0: -1, armed: true };
function squallTarget(p, t) {
  if (p < SQ.p0 - 0.1) SQ.armed = true;
  if (SQ.t0 < 0 && SQ.armed && p >= SQ.p0 && p < SQ.p1) { SQ.t0 = t; SQ.armed = false; }
  if (SQ.t0 < 0) return 0;
  const a = t - SQ.t0;
  if (a > SQ.len) { SQ.t0 = -1; return 0; }
  return p > 0.88 ? 0 : smooth(0, 2, a) * (1 - smooth(SQ.len - 4, SQ.len, a));
}
const STORM_C = { top: new THREE.Color('#c9d0da'), hz: new THREE.Color('#e3e7ec'), below: new THREE.Color('#e6e9ee'), fog: new THREE.Color('#e0e4ea') };

const NOISE = `
float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h1(i), h1(i + vec2(1., 0.)), f.x), mix(h1(i + vec2(0., 1.)), h1(i + vec2(1., 1.)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int k = 0; k < 4; k++){ s += a * n2(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(1.7, 9.2); a *= .45; } return s / .9; }`;

// 一圈山脊：profile(a) 给每个方位角的山高；雪线以上白、以下蓝灰岩，haze 往天色里褪（空气透视 + 风雪）
function ridgeRing(ctx, { radius, base = -60, seg = 360, profile, rock, snow, snowLine = 0.45 }) {
  const c = ctx.kit.routeCenter(ctx.route), pos = [], idx = [];
  for (let k = 0; k <= seg; k++) {
    const a = k / seg * Math.PI * 2, x = c.x + Math.cos(a) * radius, z = c.z + Math.sin(a) * radius, h = profile(a, k);
    pos.push(x, base, z, x, h, z);
    if (k < seg) { const b = k * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const U = { rock: { value: new THREE.Color(rock) }, snow: { value: new THREE.Color(snow) }, hazeC: { value: new THREE.Color('#aac4e4') }, haze: { value: 0 },
    lift: { value: 0 }, line: { value: snowLine } };
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: U, side: THREE.DoubleSide, fog: false,
    vertexShader: `uniform float lift; varying float vY; varying vec2 vXZ;
      void main(){ vec3 p = position; p.y += lift; vY = position.y; vXZ = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: `uniform vec3 rock, snow, hazeC; uniform float haze, line; varying float vY; varying vec2 vXZ; ${NOISE}
      void main(){
        float n = fbm(vXZ * 0.05 + vY * 0.02);
        float streak = fbm(vec2(atan(vXZ.y, vXZ.x) * 60., vY * 0.12));          // 竖向雪沟
        float sl = line + 0.12 * (n - 0.5) - 0.18 * (streak - 0.5);
        float hy = clamp((vY + 60.) / 120., 0., 1.);
        vec3 c = mix(rock, snow, smoothstep(sl - 0.02, sl + 0.02, hy + 0.1 * streak));
        c *= 0.86 + 0.24 * n;
        gl_FragColor = vec4(mix(c, hazeC, haze), 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  m.name = 'himalaya'; m.renderOrder = -5; ctx.scene.add(m);
  return { mesh: m, U };
}

// 尖峰叠加：a0 方位角、h 高、w 半宽（弧度）
const peak = (a, a0, h, w) => { const d = Math.atan2(Math.sin(a - a0), Math.cos(a - a0)); return h * Math.max(0, 1 - Math.abs(d) / w) ** 1.6; };

export function buildSky(scene, ctx, { fwdA, sunXZ }) {
  const c = ctx.kit.routeCenter(ctx.route), kit = ctx.kit;
  const U = {
    top: { value: new THREE.Color('#123b86') }, hz: { value: new THREE.Color('#9fc2e8') }, below: { value: new THREE.Color('#dfe7f0') },
    sunCol: { value: new THREE.Color('#fff3dc') }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, halo: { value: 1 }, band: { value: 0.3 },
    alt: { value: 0 },   // 海拔 0..1（5200 → 8849 m）：越高空气越薄——天顶越黑、地平线霾带越窄、太阳晕越小越硬
  };
  // 高原天分层（按海拔）：地平线一圈亮蓝 → 中天湛蓝 → 天顶近黑（8000 m 以上）。低处霾带宽、暖；高处只剩地平线贴着的一线白。
  //   太阳：晕随海拔收小（稀薄空气散射少），朝太阳那半边地平线略亮（前向散射）。
  const sky = new THREE.Mesh(new THREE.SphereGeometry(460, 48, 24), new THREE.ShaderMaterial({
    uniforms: U, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top, hz, below, sunCol, sunDir; uniform float halo, band, alt; varying vec3 vP;
      void main(){ vec3 d = normalize(vP); float e = d.y;
        float z = pow(clamp(e * mix(1.6, 2.6, alt), 0., 1.), mix(0.45, 0.5, alt));   // 高处：一抬头就到深色
        vec3 c = mix(hz, top, z);
        c *= 1. - 0.5 * alt * smoothstep(0.12, 0.7, e);                            // 高处天顶再压黑一档（8000 m 以上近黑）
        c = mix(c, hz * 1.08, band * exp(-abs(e) * mix(16., 46., alt)));             // 地平线亮霾：低处宽，高处窄
        vec3 dh = normalize(vec3(d.x, 0., d.z)), sh = normalize(vec3(sunDir.x, 0., sunDir.z));
        c += hz * 0.14 * pow(max(dot(dh, sh), 0.), 3.) * exp(-max(e, 0.) * 6.) * halo;   // 朝太阳那边地平线亮一点
        float s = max(dot(d, sunDir), 0.);
        float hp = mix(1., 2.2, alt);                                                // 晕的指数：高处收小
        c += sunCol * (pow(s, 8. * hp) * 0.22 + pow(s, 90. * hp) * 0.5 + pow(s, 1400.) * 3.) * halo;
        c = mix(c, below, smoothstep(0.0, -0.08, e));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  sky.name = 'sky'; sky.renderOrder = -10; scene.add(sky);

  // 喜马拉雅群峰：3 层，层层变淡。前进方向（大本营往上 ≈ 往南）：身后章子峰、左前马卡鲁、右前格重康、右手卓奥友、左边远处干城章嘉——
  //   只是方位对得上的风格化剪影，不标名字。登顶时整圈沉到地平线下、山脚埋进云海（lift）
  const seedN = (k, s) => kit.fbm(k * 0.035 + s, s * 1.7, 5);
  const layers = [
    { radius: 170, top: 14, line: 0.5, rock: '#56647c', snow: '#f4f7fb', seed: 3, peaks: [[fwdA + Math.PI, 13, 0.2], [fwdA - 0.35, 9, 0.16]] },
    { radius: 240, top: 22, line: 0.46, rock: '#6c7c96', snow: '#eef3f9', seed: 9, peaks: [[fwdA - 0.95, 20, 0.12], [fwdA + 0.8, 16, 0.14]] },
    { radius: 320, top: 30, line: 0.42, rock: '#8596b0', snow: '#e8eef6', seed: 17, peaks: [[fwdA + 1.55, 24, 0.15], [fwdA - 1.5, 18, 0.12]] },
  ].map(L => ({ ...L, ...ridgeRing(ctx, { radius: L.radius, rock: L.rock, snow: L.snow, snowLine: L.line,
    profile: (a, k) => L.top * (0.22 + 0.5 * seedN(k, L.seed) + 0.28 * Math.abs(Math.sin(k * 0.21 + L.seed))) + L.peaks.reduce((s, p) => s + peak(a, ...p), 0) }) }));

  // 远处的珠峰北壁：大本营看出去正前方最高的那座，金字塔 + 东侧飘一条旗云；p 过前进营地后隐进天色
  const fwd = new THREE.Vector3(Math.cos(fwdA), 0, Math.sin(fwdA)), side = new THREE.Vector3(fwd.z, 0, -fwd.x);
  const E = { dist: 250, h: 66, w: 70 };
  const ev = (() => {
    const pos = [], idx = [], n = 64;
    for (let k = 0; k <= n; k++) {
      const u = k / n * 2 - 1, ridge = Math.max(0, 1 - Math.abs(u)) ** 1.25 * E.h * (0.92 + 0.08 * Math.sin(k * 1.7)) + (Math.abs(u) > 0.55 ? 6 * kit.noise2(k * 0.4, 3) : 0);
      const p = c.clone().addScaledVector(fwd, E.dist + Math.abs(u) * 14).addScaledVector(side, u * E.w);
      pos.push(p.x, -60, p.z, p.x, ridge + 4, p.z);
      if (k < n) { const b = k * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const u = { op: { value: 1 }, rock: { value: new THREE.Color('#3b4660') }, snow: { value: new THREE.Color('#f2f6fb') }, hazeC: { value: new THREE.Color('#9fc2e8') }, haze: { value: 0.12 } };
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
      vertexShader: 'varying vec3 vW; void main(){ vW = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float op, haze; uniform vec3 rock, snow, hazeC; varying vec3 vW; ${NOISE}
        void main(){ float n = fbm(vW.xz * 0.06 + vW.y * 0.05), st = fbm(vec2(vW.x * 0.3 + vW.z * 0.3, vW.y * 0.08));
          float hy = clamp((vW.y + 10.) / 80., 0., 1.);
          vec3 c = mix(rock, snow, smoothstep(0.62, 0.8, hy * 0.45 + 0.55 * st + 0.2 * n));   // 北壁：黑岩上一道道雪槽
          c = mix(c, hazeC, haze + 0.25 * (1. - hy));
          gl_FragColor = vec4(c, op);
          #include <colorspace_fragment>
        }`,
    }));
    m.name = 'everestFar'; m.renderOrder = -6; scene.add(m);
    return { m, u };
  })();
  // 旗云：峰顶往下风侧（东 = 前进方向左侧）拖一条白纱
  const bannerTex = ctx.util.canvasTexture(256, 64, (g, w, h) => {
    for (let x = 0; x < w; x++) {
      const t = x / w, a = Math.pow(1 - t, 1.3) * Math.min(1, t * 12), thick = 0.25 + 0.55 * t;
      const gr = g.createLinearGradient(0, h * (0.5 - thick / 2), 0, h * (0.5 + thick / 2));
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, `rgba(255,255,255,${0.85 * a})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x, 0, 1, h);
    }
  });
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(90, 16), new THREE.MeshBasicMaterial({ map: bannerTex, transparent: true, depthWrite: false, fog: false }));
  const tip = c.clone().addScaledVector(fwd, E.dist + 2);
  banner.position.copy(tip).addScaledVector(side, 44).setY(E.h - 2); banner.lookAt(c.x, E.h - 2, c.z);
  banner.name = 'bannerCloud'; banner.renderOrder = -5; scene.add(banner);

  // 太阳：高原的白太阳（小、亮），加色精灵
  const glowTex = ctx.util.canvasTexture(256, 256, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,250,1)'); r.addColorStop(0.05, 'rgba(255,252,240,0.95)'); r.addColorStop(0.16, 'rgba(255,240,210,0.3)'); r.addColorStop(1, 'rgba(255,230,200,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, toneMapped: false }));
  sun.name = 'sunGlow'; scene.add(sun);
  const sunDir = new THREE.Vector3(sunXZ.x * 0.62, 0.78, sunXZ.z * 0.62).normalize();   // 高原正午前后：太阳高挂
  U.sunDir.value.copy(sunDir); WX.sunDir.copy(sunDir); sun.position.set(c.x + sunDir.x * 420, sunDir.y * 420, c.z + sunDir.z * 420); sun.scale.set(60, 60, 1);
  // 逆光：镜头转到朝着太阳（登顶环绕镜头总会转到这一边）时，整片天糊上一层暖白的大光斑，人和觇标只剩剪影 + 轮廓；风雪里没有
  const glareTex = ctx.util.canvasTexture(128, 128, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,246,228,0.5)'); r.addColorStop(0.3, 'rgba(255,240,215,0.2)'); r.addColorStop(1, 'rgba(255,235,205,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  const glare = new THREE.Sprite(new THREE.SpriteMaterial({ map: glareTex, depthWrite: false, depthTest: false, fog: false, transparent: true, opacity: 0 }));   // 正常混合：是蒙一层纱，不是加亮（加色会把整屏烧白）
  glare.name = 'sunGlare'; glare.renderOrder = 6; glare.position.copy(sun.position); glare.scale.set(300, 300, 1); scene.add(glare);
  const _cd = new THREE.Vector3();

  // 云海：低多边形。一张 56×56 网格（?fx=low 32×32）压在 y = -9，顶点在着色器里按噪声起伏、随风慢慢挪、整片缓缓翻涌；
  //   片元用 dFdx/dFdy 取面法线 → 平面着色的云丘（不用渐变贴图）。上面再浮一层零散的云片（二十面体压扁，实例化，fx=low 不要）。
  //   考据：云顶 6000–7000 m，前进营地以上才看得见，登顶时整片在脚下。p 过北坳才露面（k.cloud），登顶铺满。
  const clouds = [];
  const wind = new THREE.Vector2(side.x, side.z).multiplyScalar(0.7);      // 世界单位 / 秒（东风向 = 下风侧）
  const CLOUD_Y = -9, CS = LOW ? 32 : 56;
  const cu = { t: { value: 0 }, op: { value: 0 }, wind: { value: wind }, amp: { value: 3.6 }, sun: { value: sunDir },
    lit: { value: new THREE.Color('#ffffff') }, shade: { value: new THREE.Color('#b8c6da') }, haze: { value: new THREE.Color('#dbe6f3') }, cam: { value: ctx.camera.position } };
  const CLOUD_FRAG = `uniform float op; uniform vec3 lit, shade, haze, cam, sun; varying vec3 wp; varying float vFade;
    void main(){ vec3 n = normalize(cross(dFdx(wp), dFdy(wp)));
      float dif = max(dot(n, sun), 0.), sky = 0.5 + 0.5 * n.y;
      vec3 c = mix(shade, lit, 0.25 * sky + 0.75 * dif);
      float dist = length(wp.xz - cam.xz);
      c = mix(c, haze, smoothstep(140., 460., dist));
      float a = op * vFade * (1. - smoothstep(440., 500., dist));
      if (a < 0.01) discard;
      gl_FragColor = vec4(c, a);
      #include <colorspace_fragment>
    }`;
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000, CS, CS).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: cu, transparent: true, depthWrite: false, fog: false,
    vertexShader: `uniform float t, amp; uniform vec2 wind; varying vec3 wp; varying float vFade; ${NOISE}
      void main(){ vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
        vec2 w = wind * t;
        float h = fbm(p.xz * 0.011 - w * 0.011) - 0.5;                                    // 大起伏（随风飘）
        float h2 = n2(p.xz * 0.045 - w * 0.03 + 7.) - 0.5;                                // 小丘
        p.y += amp * (h * 1.7 + h2 * 0.55) + 0.7 * sin(t * 0.22 + p.x * 0.03 + p.z * 0.021);  // 翻涌：整片缓缓一起一伏
        wp = p; vFade = 1.; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
    fragmentShader: CLOUD_FRAG,
  }));
  sea.position.set(c.x, CLOUD_Y, c.z); sea.name = 'cloudSea'; sea.renderOrder = -1; sea.frustumCulled = false; scene.add(sea); clouds.push(sea);
  if (!LOW) {                                                                            // 浮在云海上的云片：48 片，各自慢慢升降、顺风挪，出了 600 盒子从另一边回来
    const NP = 48, ig = new THREE.InstancedBufferGeometry().copy(new THREE.IcosahedronGeometry(1, 0)), inst = new Float32Array(NP * 4), R = mulberry(11);
    for (let i = 0; i < NP; i++) { inst[i * 4] = (R() - 0.5) * 600; inst[i * 4 + 1] = (R() - 0.5) * 600; inst[i * 4 + 2] = 5 + 9 * R(); inst[i * 4 + 3] = R(); }
    ig.setAttribute('inst', new THREE.InstancedBufferAttribute(inst, 4)); ig.instanceCount = NP;
    const puffs = new THREE.Mesh(ig, new THREE.ShaderMaterial({
      uniforms: cu, transparent: true, depthWrite: false, fog: false,
      vertexShader: `attribute vec4 inst; uniform float t; uniform vec2 wind; varying vec3 wp; varying float vFade;
        void main(){ float s = inst.z, k = inst.w;
          vec3 p = position * vec3(1.9, 0.55 + 0.25 * k, 1.3) * s;
          vec2 xz = inst.xy + wind * t * (0.8 + 0.5 * k);
          xz = mod(xz + 300., 600.) - 300.;
          p.xz += xz; p.y += 2.5 + 0.35 * s + 1.4 * sin(t * (0.18 + 0.1 * k) + k * 6.283);
          p = (modelMatrix * vec4(p, 1.0)).xyz;
          float edge = min(300. - abs(xz.x), 300. - abs(xz.y));                          // 盒子边上淡出，回来时不跳
          wp = p; vFade = smoothstep(0., 40., edge); gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
      fragmentShader: CLOUD_FRAG,
    }));
    puffs.position.copy(sea.position); puffs.name = 'cloudPuffs'; puffs.renderOrder = -1; puffs.frustumCulled = false; scene.add(puffs); clouds.push(puffs);
  }
  // 峰顶旗云：珠峰的标志——从顶峰往下风侧（东 = 前进方向左侧）拖出一条云带。16 片压扁的二十面体串成一串（实例化，1 次绘制，
  //   fx=low 也要），离峰顶越远越大越淡、略往上翘；整条带子随时间起伏，每片自己慢慢转、一涨一缩（全按片序号哈希，确定性）。
  //   吃场景雾：风雪里看不见，登顶放晴后就在头顶从峰顶拖出去。
  const flag = (() => {
    const N = ctx.route.N, top = ctx.route.at(N).pos.clone(), NB = 16, R = mulberry(5);
    const ig = new THREE.InstancedBufferGeometry().copy(new THREE.IcosahedronGeometry(1, 0)), inst = new Float32Array(NB * 2);
    for (let i = 0; i < NB; i++) { inst[i * 2] = (i + 0.5) / NB; inst[i * 2 + 1] = R(); }
    ig.setAttribute('inst', new THREE.InstancedBufferAttribute(inst, 2)); ig.instanceCount = NB;
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), t: { value: 0 }, op: { value: 1 }, top: { value: top }, down: { value: side }, across: { value: fwd }, sun: { value: sunDir },
        lit: { value: new THREE.Color('#ffffff') }, shade: { value: new THREE.Color('#b8c6da') } },
      transparent: true, depthWrite: false, fog: true,
      vertexShader: `attribute vec2 inst; uniform float t; uniform vec3 top, down, across; varying vec3 wp; varying float vFade;
        #include <fog_pars_vertex>
        void main(){ float u = inst.x, k = inst.y;
          float ang = k * 6.283 + t * (0.04 + 0.03 * k), cs = cos(ang), sn = sin(ang);
          float s = (0.9 + 3.2 * u) * (0.85 + 0.2 * sin(t * 0.3 + k * 9.));
          vec3 p = position * vec3(1.8, 0.55, 1.15) * s; p = vec3(p.x * cs - p.z * sn, p.y, p.x * sn + p.z * cs);
          vec3 base = top + down * (9. + 34. * u) + across * (1.2 * sin(t * 0.21 + k * 6.28 + u * 3.) + 3. * (k - 0.5) * u)
            + vec3(0., 3.5 + 8. * u + 1.3 * sin(t * 0.35 - u * 4.5 + k), 0.);   // 起点离峰顶 9、抬 3.5：登顶环绕镜头（半径 4.2、高 1.8）钻不进去
          p += base; wp = p; vFade = 1. - 0.7 * u * u;
          vec4 mvPosition = viewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform float op; uniform vec3 lit, shade, sun; varying vec3 wp; varying float vFade;
        #include <fog_pars_fragment>
        void main(){ vec3 n = normalize(cross(dFdx(wp), dFdy(wp)));
          float dif = max(dot(n, sun), 0.), sky = 0.5 + 0.5 * n.y;
          vec3 c = mix(shade, lit, 0.25 * sky + 0.75 * dif);
          float a = op * vFade; if (a < 0.01) discard;
          gl_FragColor = vec4(c, a);
          #include <fog_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const m = new THREE.Mesh(ig, mat); m.name = 'summitBanner'; m.renderOrder = 0; m.frustumCulled = false; scene.add(m);
    return { m, u: mat.uniforms };
  })();

  return {
    U, layers, clouds, ev, banner, sun, glare, flag,
    // k = 调色结果（入口算好）：sky/hz/below/haze/sink/cloud/everest…；可选 k.alt = 海拔 0..1（不给就按 sink 估）
    apply(k, t) {
      const alt = k.alt ?? Math.min(1, k.sink / 48), dt = k.dt ?? 0;
      if (k.p !== undefined && dt > 0) WX.squall = squallTarget(k.p, t);   // 包络本身按墙钟 t 算（掉帧也按时来、按时走）；dt = 0 是 build 里那次空跑，不算
      const sq = WX.squall, clear = 1 - sq;
      U.top.value.copy(k.top).lerp(STORM_C.top, sq); U.hz.value.copy(k.hz).lerp(STORM_C.hz, sq); U.below.value.copy(k.below).lerp(STORM_C.below, sq);
      U.band.value = k.band * clear; U.halo.value = k.halo * clear; U.alt.value = alt;
      if (sq > 0.001) {                                                     // 白毛风：雾收到身边、背景发白（入口每帧先写 fog，这里再压一层）
        const f = scene.fog; if (f) { f.near += (2.5 - f.near) * sq; f.far += (7 - f.far) * sq; f.color.lerp(STORM_C.fog, sq); }
        if (scene.background && scene.background.isColor) scene.background.lerp(STORM_C.fog, sq);
      }
      ctx.camera.getWorldDirection(_cd);
      glare.material.opacity = 0.6 * smooth(0.6, 0.95, _cd.dot(sunDir)) * k.halo * k.sun * (0.5 + 0.5 * alt) * clear;   // 逆光：越高空气越薄，光越硬；最多 0.6 × 贴图 0.5
      layers.forEach((L, i) => { L.U.haze.value = Math.max(sq, Math.min(1, k.haze * (0.55 + 0.25 * i))); L.U.hazeC.value.copy(U.hz.value); L.U.lift.value = -k.sink * (0.5 + 0.24 * i); });
      ev.u.op.value = k.everest * clear; ev.u.hazeC.value.copy(k.hz); ev.m.visible = ev.u.op.value > 0.01;
      banner.material.opacity = ev.u.op.value * 0.9; banner.visible = ev.m.visible;
      sun.material.opacity = k.sun * clear; WX.sun = k.sun * k.halo * clear;
      flag.u.t.value = t % 3600; flag.u.op.value = 0.92 * (1 - 0.6 * sq);
      cu.op.value = k.cloud * clear; cu.t.value = t % 3600; cu.haze.value.copy(k.hz).lerp(cu.lit.value, 0.4);
      for (const m of clouds) m.position.y = CLOUD_Y + 3 * smooth(0.75, 1, alt);   // 快登顶时云海涨上来（-9 → -6），在峰顶四周十几个单位外的坡上翻涌（浪尖最高 -2，不盖过顶峰）
      for (const m of clouds) m.scale.setScalar(cu.op.value > 0.01 ? 1 : 1e-6);   // 用不着时缩成点：不画片元，但管线第一帧就建好
    },
  };
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function mulberry(a) { return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
