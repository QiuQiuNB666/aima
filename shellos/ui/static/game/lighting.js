// L 线：全局光影与后期（色调映射 / 近景阴影 / 泛光 / 光束 / 调色 / 化身轮廓光）。主题不用改：按 theme.style 取下面 PRESET。
//   engine.js：建好相机后 makeLighting(renderer, scene, camera, theme)；每帧 lit.render(ctx, A, s, summit) 代替 renderer.render。
//   管线：场景画进自己的 HalfFloat + 4×MSAA 目标 → 清洗拷贝进（不带 MSAA 的）后期缓冲 → 泛光 → 光束（有太阳的主题）→ 输出（sRGB 解码 → 曝光 + ACES → 编码 → 冷暖分离、暗角、抖动）。
//   清洗拷贝（NaN → 0、夹到 0..64）不能省：Apple GPU（ANGLE / Metal）上 MSAA 场景 resolve 出来会带非有限值 / 负数像素，泛光的模糊链
//   把一个坏点抹满整屏 → 整帧发黑；雨、车流让坏点时有时无 → 黑帧和正常帧交替 = 展位上的「一直闪」（9/23 第二轮，MacBook 上二分：
//   ?aa=0 或关泛光都正常，MSAA × 泛光就黑）。Intel 上不出现。
//   场景照旧在着色器里编码成 sRGB 再写进渲染目标（目标标成 isXRRenderTarget，three 才这么做）：半透明的雾团、雨、影子、光晕
//   和直接画到屏幕时一样在 sRGB 空间混合——主题都是照这个调的；换成线性混合，雾和薄云会白成一片。半浮点存得下 >1 的高光。
//   天空等自写 ShaderMaterial 没有 tonemapping_fragment，所以色调映射只在最后一道做：天、雾、远景过同一条曲线，不会接缝。
// 档位 ?fx=high（缺省）| mid | low | off（off = 原来的直出，一点不动）。单项覆盖档位：
//   ?bloom=0|1  ?shadow=0|1024|2048  ?rays=0|1  ?grade=0|1  ?tm=aces|agx|none  ?exp=1.2（乘在主题曝光上）  ?aa=0（关 MSAA）
//   ?auto=1 自动降档（连续 4 s 低于 45 fps 降一级：光束 → 阴影 2048→1024→关 → 泛光）。缺省关：每降一级都要重编译材质、画面跳一下，
//   世界切换 / 加载模型时掉帧也会误触发；展位 MacBook 余量很大（缺省档 160+ fps），不需要
// 调试：window.__lighting.info() / .set('bloom', false) 等。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { rng } from './path.js';

const Q = new URLSearchParams(location.search);
const TIERS = {
  high: { bloom: true, shadow: 2048, rays: true, grade: true },
  mid: { bloom: true, shadow: 1024, rays: false, grade: true },
  low: { bloom: false, shadow: 0, rays: false, grade: true },
};
const tier = Q.get('fx') || 'high';
const flag = (k, d) => Q.has(k) ? Q.get(k) !== '0' : d;
export const FX = tier === 'off' ? { post: false } : (() => {
  const T = TIERS[tier] || TIERS.high;
  return { post: true, tier, bloom: flag('bloom', T.bloom), rays: flag('rays', T.rays), grade: flag('grade', T.grade),
    shadow: Q.has('shadow') ? (+Q.get('shadow') ? Math.max(512, +Q.get('shadow') === 1 ? 2048 : +Q.get('shadow')) : 0) : T.shadow,
    msaa: Q.get('aa') === '0' ? 0 : 4, tm: Q.get('tm') || 'aces', exp: +(Q.get('exp') || 1), auto: Q.get('auto') === '1' };
})();

// 每个主题的光：exp 曝光；bloom [强度, 半径, 阈值（最亮通道，sRGB 编码值，可 >1）]；grade 冷暖分离 lo（暗部乘）/ hi（亮部乘）、sat 饱和度、vig 暗角；
//   white ACES 白点（0 = 原样 ACES：输入 1.0 只到 0.88）。白天主题的天、云、太阳都是按 ≤1 画的（太阳靠 >1 截白才有日轮），
//   白点给 1.0–1.2：保留 ACES 的暗部和对比，亮部照旧到白，云不和薄雾糊成一片灰、日轮不化成一大团光；
//   rays 光束强度（跟 sunGlow 精灵的可见度走）、raysThr 多亮才算光源（sRGB 值）；rim 化身轮廓光 [颜色, 强度]（null = 用主题自己的）；
//   stairShade 不吃光的台阶在阴影里乘多少；dapple 林荫光斑（叶隙里漏下的太阳，暗处留多少）；
//   shadeFloor 影子里还剩多少太阳（湿润晴天天光亮，影子不该黑成一块；缺省 0 = three 原样）
const PRESET = {
  cyber_night: { exp: 1.2, bloom: [0.8, 0.5, 0.9], grade: { lo: [0.88, 0.96, 1.14], hi: [1.1, 0.98, 0.94], sat: 1.1, vig: 0.4 }, rim: ['#ffd9a8', 1.25], wet: true },
  dawn_mountain: { exp: 0.75, white: 1.0, raysThr: 0.9, bloom: [0.3, 0.4, 2.2], grade: { lo: [0.93, 0.95, 1.08], hi: [1.08, 1.0, 0.9], sat: 1.06, vig: 0.32 }, rays: 1.2, rim: ['#ffc680', 1.3] },
  night_to_dawn: { exp: 1.25, white: 8, bloom: [0.6, 0.45, 0.9], grade: { lo: [0.88, 0.95, 1.14], hi: [1.04, 1.0, 1.02], sat: 1.08, vig: 0.4 }, rays: 1.0, raysThr: 0.9, rim: ['#9fdcff', 1.1],
    dawn: { exp: 0.8, white: 1.0, bloom: [0.3, 0.35, 2.4], lo: [0.94, 0.94, 1.08], hi: [1.1, 1.0, 0.88], rim: '#ffc890' } },
  subtropical: { exp: 0.88, white: 1.15, bloom: [0.25, 0.5, 1.0], grade: { lo: [1.06, 1.1, 1.14], hi: [1.06, 1.02, 0.94], sat: 1.08, vig: 0.28 }, rim: ['#fff2d0', 1.1],
    stairShade: 0.6, dapple: 0.55, shadeFloor: 0.5 },   // 石阶是不吃光的定色材质，单独补上接影（护栏影子、林荫光斑）
  snow_summit: { exp: 0.95, white: 1.1, bloom: [0.2, 0.4, 1.6], grade: { lo: [0.96, 0.98, 1.06], hi: [1.03, 1.0, 0.97], sat: 1.05, vig: 0 }, rim: null },   // E 线给的：雪地整片近白，泛光阈值高；vig 0 = 主题自己有缺氧暗角（DOM 层）
  grid: { exp: 1.05, white: 1.3, bloom: [0.25, 0.3, 1.0], grade: { lo: [1.2, 1.22, 1.28], hi: [1.0, 1.0, 1.0], sat: 1.0, vig: 0.22 }, rim: null },   // 暗部提一点：ACES 脚趾会把地面细网格压没
};

const RaysShader = {         // 在 sRGB 编码的 HDR 上做：太阳附近的亮像素朝太阳方向径向模糊，挡在前面的暗物体（门、山、人）就切出光束
  uniforms: { tDiffuse: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uAsp: { value: 1 }, uK: { value: 0 }, uThr: { value: 0.35 }, uTint: { value: new THREE.Color('#ffd6a0') } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 uSun; uniform float uAsp, uK, uThr; uniform vec3 uTint; varying vec2 vUv;
    void main(){
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec2 d = (vUv - uSun) * (0.85 / 32.0), uv = vUv; float w = 1.0; vec3 acc = vec3(0.0);
      for (int i = 0; i < 32; i++) {
        uv -= d;
        vec3 s = texture2D(tDiffuse, uv).rgb;
        float near = 1.0 - smoothstep(0.03, 0.14, length((uv - uSun) * vec2(uAsp, 1.0)));   // 光源只取日轮附近：取大了整片亮天都在发光，日轮反而化成一团
        acc += max(s - uThr, 0.0) * near * w; w *= 0.965;
      }
      gl_FragColor = vec4(base + acc * uTint * (uK / 32.0) * (1.0 - clamp(base, 0.0, 1.0)), 1.0);   // 滤色：只提亮暗处（门、人、山的剪影边上出光束），本来就白的天不再加亮
    }`,
};
const CleanShader = {        // 场景 → 后期缓冲，顺手洗掉 NaN / Inf / 负数：一个坏像素进了泛光的模糊链，会把整屏糊成黑（见文件头）
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = mix(c, vec3(0.0), vec3(isnan(c)));
      gl_FragColor = vec4(clamp(c, 0.0, 64.0), 1.0);
    }`,
};
const OutShader = {          // 最后一道：sRGB → 线性 → 曝光 + ACES（three 自带的同一条曲线）→ sRGB；再在显示空间调色：冷暖分离 + 饱和度 + 暗角 + 抖动（去天空色带）
  uniforms: { tDiffuse: { value: null }, toneMappingExposure: { value: 1 }, uWhite: { value: 0 }, uLo: { value: new THREE.Vector3(1, 1, 1) }, uHi: { value: new THREE.Vector3(1, 1, 1) }, uSat: { value: 1 }, uVig: { value: 0 } },
  vertexShader: RaysShader.vertexShader,
  fragmentShader: `#include <tonemapping_pars_fragment>
    uniform sampler2D tDiffuse; uniform vec3 uLo, uHi; uniform float uWhite, uSat, uVig; varying vec2 vUv;
    void main(){
      vec3 c = max(texture2D(tDiffuse, vUv).rgb, 0.0);
      c = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
      #if defined(TM_ACES)
        c = ACESFilmicToneMapping(c);
        if (uWhite > 0.0) c = clamp(c / ACESFilmicToneMapping(vec3(uWhite)), 0.0, 1.0);   // 白点：这么亮的输入映射成纯白
      #elif defined(TM_AGX)
        c = AgXToneMapping(c);
      #else
        c = clamp(c * toneMappingExposure, 0.0, 1.0);
      #endif
      c = sRGBTransferOETF(vec4(c, 1.0)).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c *= mix(mix(uLo, uHi, smoothstep(0.05, 0.6, l)), vec3(1.0), smoothstep(0.8, 1.0, l));   // 纯白不染色（日轮、灯芯还是白的）
      c = mix(vec3(l), c, uSat);
      vec2 q = vUv - 0.5; c *= 1.0 - uVig * pow(clamp(length(q) * 1.414, 0.0, 1.0), 2.4);
      c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export function makeLighting(renderer, scene, camera, theme) {
  if (!FX.post) {
    const off = { render: () => renderer.render(scene, camera), info: () => ({ tier: 'off' }) };
    window.__lighting = off;
    return off;
  }
  const P = PRESET[theme.style] || PRESET.grid;
  if (P.dapple || P.shadeFloor) shadeChunks(P.dapple || 0, P.shadeFloor || 0);
  renderer.info.autoReset = false;            // 一帧里有好几次 render（阴影 + 后期）：engine 的 calls / tris 统计按整帧算
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const size = renderer.getSize(new THREE.Vector2());
  const sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: FX.msaa });
  sceneRT.isXRRenderTarget = true; sceneRT.texture.colorSpace = THREE.SRGBColorSpace;   // 见文件头：场景照旧编码成 sRGB 写进来
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType }));   // 后期缓冲：不带 MSAA
  const scenePass = new Pass(); scenePass.needsSwap = false;
  scenePass.render = r => { r.setRenderTarget(sceneRT); r.render(scene, camera); };
  composer.addPass(scenePass);
  const copy = new ShaderPass(CleanShader, 'tScene');   // textureID 故意不叫 tDiffuse：composer 不会把读缓冲塞进来，读的永远是 sceneRT（已 resolve 的纹理）
  copy.uniforms.tDiffuse.value = sceneRT.texture; copy.material.blending = THREE.NoBlending;
  composer.addPass(copy);
  const bloom = new UnrealBloomPass(size.clone(), ...(P.bloom));
  // 阈值按最亮通道（不按亮度）：品红霓虹亮度才 0.25，按亮度切会先把白衣化身、浅青影子糊成一团光；按最亮通道，满格霓虹 / 灯 / 太阳过线，白衣服（漫反射 < 0.9）不过
  bloom.materialHighPassFilter.fragmentShader = bloom.materialHighPassFilter.fragmentShader.replace('float v = dot( texel.xyz, luma );', 'float v = max( max( texel.r, texel.g ), texel.b );');
  bloom.highPassUniforms.smoothWidth.value = 0.12;
  bloom.enabled = FX.bloom; composer.addPass(bloom);
  const rays = new ShaderPass(RaysShader); rays.enabled = false; composer.addPass(rays);
  const out = new ShaderPass(OutShader); composer.addPass(out);
  out.material.defines = FX.tm === 'agx' ? { TM_AGX: '' } : FX.tm === 'none' ? {} : { TM_ACES: '' };
  const G = P.grade, gu = out.uniforms, grade = { enabled: FX.grade };   // 调色关掉 = 系数全 1（色调映射照做）
  gu.toneMappingExposure.value = P.exp * FX.exp; gu.uWhite.value = P.white || 0;
  if (grade.enabled) { gu.uLo.value.fromArray(G.lo); gu.uHi.value.fromArray(G.hi); gu.uSat.value = G.sat; gu.uVig.value = G.vig; }
  addEventListener('resize', () => { composer.setSize(innerWidth, innerHeight); sceneRT.setSize(innerWidth, innerHeight); });

  let ready = false, sun = null, T0 = null, sunGlow = null, rimU = [], nd = null;
  const dir = new THREE.Vector3(), lastPos = new THREE.Vector3(NaN, 0, 0), F = new THREE.Vector3(), lx = new THREE.Vector3(), ly = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const sp = new THREE.Vector3(), cA = new THREE.Color(), cB = new THREE.Color(), bg0 = new THREE.Color(), fog0 = new THREE.Color(), tmp = {};
  const enc = (c, save) => { save.copy(c); c.getRGB(tmp, THREE.SRGBColorSpace); c.setRGB(tmp.r, tmp.g, tmp.b, THREE.LinearSRGBColorSpace); };
  const R = 13;                                // 阴影盒半边长：化身前方 4 为中心，盖住镜头前 ~17 单位的路；再远没阴影（雾里也看不出）

  function setShadow(n) {
    FX.shadow = n;
    sun.castShadow = n > 0;
    if (!n) return;
    sun.shadow.mapSize.set(n, n);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  function setup(ctx) {                        // 第一帧：主题、化身都建好了，才知道谁投影、谁接影
    ready = true;
    sun = ctx.lights.sun; T0 = sun.target.position.clone();
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -R; cam.right = cam.top = R; cam.near = 1; cam.far = 90; cam.updateProjectionMatrix();
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    setShadow(FX.shadow);
    let casters = 0;
    scene.traverse(o => {
      if (!o.isMesh || o.isSprite) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m) return;
      if (m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshStandardMaterial) o.receiveShadow = true;
      // 投影：近景实心物体（不透明、吃雾 = 不是天/远景剪影）；大网格（地面、整条路、合并的整片城）不投，省一遍阴影绘制
      if (m.transparent || m.fog === false || o.name === 'ground' || o.name === 'sky') return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const r = o.geometry.boundingSphere.radius * o.getWorldScale(sp).x;
      if (o.isInstancedMesh || o.isSkinnedMesh || r < 30) { o.castShadow = true; casters++; }
    });
    const av = scene.getObjectByName('avatar');
    if (av) av.traverse(o => {
      if (!o.isMesh) return;
      if (!o.material.transparent) o.castShadow = true;
      const U = o.material.userData && o.material.userData.look;
      if (U && P.rim) { U.uRim.value.set(P.rim[0]); U.uRimK.value = P.rim[1]; rimU.push(U); }
    });
    sunGlow = scene.getObjectByName('sunGlow');
    rays.enabled = FX.rays && !!P.rays && !!sunGlow;
    rays.uniforms.uThr.value = P.raysThr ?? 0.5;
    if (P.wet) wetStreet(ctx);
    if (P.stairShade && ctx.meshes.stairs) stairShadow(ctx.meshes.stairs.material, P.stairShade, !!P.dapple);
    if (ctx.meshes.road) ctx.meshes.road.castShadow = false;   // 路面只接影：自己投自己会出条纹
    if (P.dawn) nd = P.dawn;
    L.casters = casters;
  }

  function followSun(A) {                      // 阴影盒跟着化身走；方向沿用主题摆的太阳（富士山每帧改，这里每帧重算）
    if (!sun.position.equals(lastPos)) dir.subVectors(sun.position, T0).normalize();
    F.copy(A.pos).addScaledVector(A.dir, 4);
    lx.crossVectors(Y, dir); if (lx.lengthSq() < 1e-6) lx.set(1, 0, 0); lx.normalize(); ly.crossVectors(dir, lx);
    const tx = 2 * R / Math.max(512, FX.shadow || 1024), a = F.dot(lx), b = F.dot(ly);   // 按阴影贴图像素对齐，走动时影子边不闪
    F.addScaledVector(lx, Math.round(a / tx) * tx - a).addScaledVector(ly, Math.round(b / tx) * tx - b);
    sun.target.position.copy(F); sun.target.updateMatrixWorld();
    sun.position.copy(F).addScaledVector(dir, 45); lastPos.copy(sun.position);
  }

  function dawnMix(p) {                        // 富士山：星空 → 日出，曝光 / 泛光 / 调色 / 轮廓光跟着爬升进度走
    const k = Math.max(0, Math.min(1, (p - 0.55) / 0.5)), e = k * k * (3 - 2 * k), G0 = P.grade, B0 = P.bloom, B1 = nd.bloom;
    gu.toneMappingExposure.value = (P.exp + (nd.exp - P.exp) * e) * FX.exp; gu.uWhite.value = P.white + (nd.white - P.white) * e;
    bloom.strength = B0[0] + (B1[0] - B0[0]) * e; bloom.radius = B0[1] + (B1[1] - B0[1]) * e; bloom.threshold = B0[2] + (B1[2] - B0[2]) * e;
    if (grade.enabled) for (let i = 0; i < 3; i++) { gu.uLo.value.setComponent(i, G0.lo[i] + (nd.lo[i] - G0.lo[i]) * e); gu.uHi.value.setComponent(i, G0.hi[i] + (nd.hi[i] - G0.hi[i]) * e); }
    cA.set(P.rim[0]).lerp(cB.set(nd.rim), e);
    for (const U of rimU) U.uRim.value.copy(cA);
  }

  function aimRays() {
    const on = sunGlow.visible ? (sunGlow.material.opacity ?? 1) : 0;
    sp.copy(sunGlow.position).project(camera);
    const inView = sp.z < 1 ? 1 - Math.min(1, Math.max(0, Math.max(Math.abs(sp.x), Math.abs(sp.y)) - 1.1) / 0.6) : 0;   // 出画 1.1 → 1.7 渐隐
    rays.uniforms.uK.value = P.rays * on * inView;
    rays.uniforms.uSun.value.set((sp.x + 1) / 2, (sp.y + 1) / 2);
    rays.uniforms.uAsp.value = camera.aspect;
  }

  // 自动降档（?auto=1 才开）：连续 4 s 低于 45 fps（页面在前台）→ 光束 → 阴影 2048 → 1024 → 关 → 泛光
  let frames = 0, t0 = performance.now(), slow = 0, warm = t0 + 8000;
  function autoFx() {
    frames++;
    const now = performance.now();
    if (now - t0 < 1000) return;
    L.fps = frames * 1000 / (now - t0); frames = 0; t0 = now;
    if (!FX.auto || now < warm || document.hidden) return;
    slow = L.fps < 45 ? slow + 1 : 0;
    if (slow < 4) return;
    slow = 0; warm = now + 3000;
    const step = rays.enabled ? (rays.enabled = FX.rays = false, 'rays') : FX.shadow > 1024 ? (setShadow(1024), 'shadow1024') : FX.shadow ? (setShadow(0), 'shadow0')
      : bloom.enabled ? (bloom.enabled = FX.bloom = false, 'bloom') : null;
    if (step) { L.downgrades.push(step); console.info('[lighting] 帧率低，降档：', step, L.fps.toFixed(1)); }
  }

  const L = {
    fps: 0, casters: 0, downgrades: [],
    render(ctx, A, s, summit) {
      if (!ready) setup(ctx);
      renderer.info.reset();
      if (sun.castShadow) followSun(A);
      if (nd) dawnMix(summit ? 1.12 : s / ctx.route.N);
      if (rays.enabled) aimRays();
      const bg = scene.background && scene.background.isColor ? scene.background : null, fog = scene.fog;
      if (bg) enc(bg, bg0); if (fog) enc(fog.color, fog0);   // 清屏色和雾色 three 往渲染目标里按线性给，这里先换成 sRGB 编码值，画完还原
      composer.render();
      if (bg) bg.copy(bg0); if (fog) fog.color.copy(fog0);
      autoFx();
    },
    info: () => ({ tier: FX.tier, bloom: bloom.enabled, shadow: sun && sun.castShadow ? FX.shadow : 0, rays: rays.enabled, grade: grade.enabled, msaa: FX.msaa,
      tm: FX.tm, exp: +gu.toneMappingExposure.value.toFixed(3), fps: +L.fps.toFixed(1), casters: L.casters, downgrades: L.downgrades }),
    set(k, v) {                                // 调试：__lighting.set('shadow', 1024) / ('bloom', false) / ('exp', 1.2)
      if (k === 'shadow') setShadow(+v); else if (k === 'exp') gu.toneMappingExposure.value = +v;
      else if (k === 'rays') rays.enabled = !!v && !!sunGlow; else bloom.enabled = !!v;
    },
    passes: { bloom, rays, out, sceneRT },   // sceneRT：调试时读回场景像素查 NaN（__lighting.passes.sceneRT）
  };
  window.__lighting = L;
  return L;
}

// 东京：湿路面倒映霓虹——路面、地面（都是 Phong）挂一张霓虹街景环境图，水洼（specularMap 亮处）反得多。
//   环境图是画出来的等距柱状图（地平线上一圈竖条霓虹），不再渲一遍场景：0 次额外绘制
function wetStreet(ctx) {
  const rand = rng(7);                        // 自己的随机数：不动主题的 ctx.rand
  const env = ctx.util.canvasTexture(512, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#05030c'); gr.addColorStop(0.42, '#1a0f33'); gr.addColorStop(0.5, '#2a1640'); gr.addColorStop(1, '#0a0614');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const cols = ['#ff2e88', '#29e7ff', '#ff8a3a', '#b04dff', '#ffd23a', '#ff2e88', '#29e7ff'];
    for (let k = 0; k < 70; k++) {          // 竖条霓虹：地平线（h/2）往上 0–35°，倒影在湿地上拉成竖长条
      const x = rand() * w, bw = 2 + rand() * 7, top = h / 2 - (8 + rand() * 42), bh = 6 + rand() * 30;
      g.globalAlpha = 0.5 + rand() * 0.5; g.fillStyle = cols[k % cols.length]; g.fillRect(x, top, bw, bh);
    }
    g.globalAlpha = 1;
  });
  env.mapping = THREE.EquirectangularReflectionMapping; env.colorSpace = THREE.SRGBColorSpace;
  const mats = [ctx.meshes && ctx.meshes.road && ctx.meshes.road.material, (ctx.scene.getObjectByName('ground') || {}).material];
  for (const m of mats) if (m && m.isMeshPhongMaterial) { m.envMap = env; m.combine = THREE.AddOperation; m.reflectivity = 0.55; m.needsUpdate = true; }
}

// 主题里「定色、不吃光」的台阶（梧桐山：outgoingLight = base）也要接树影：在它自己的 onBeforeCompile 之后再乘阴影遮罩
function stairShadow(m, k, dap) {
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey();
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>')
      .replace('outgoingLight = base;', `outgoingLight = base * mix(${k.toFixed(2)}, 1.0, getShadowMask()${dap ? ' * dapple(-vViewPosition)' : ''});`);
  };
  m.customProgramCacheKey = () => key + '-shade';
  m.needsUpdate = true;
}

// 梧桐山：① 林荫光斑：太阳（唯一投影的平行光）在接影的表面上再乘一层叶隙图案（世界 xz 上的两级噪声：大块 = 有没有树冠，小块 = 叶隙），
//   不画树也不多一次绘制；② 影子里留一点太阳（floor）。改的是全局 ShaderChunk，只在这个主题的页面里、第一次编译材质之前改
function shadeChunks(k, floor) {
  const C = THREE.ShaderChunk;
  C.lights_pars_begin += `
float dapN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453), b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5453), d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float dapple(vec3 vp){                                  // vp = 视空间位置
  vec3 w = cameraPosition + transpose(mat3(viewMatrix)) * vp;
  float canopy = smoothstep(0.38, 0.62, dapN(w.xz * 0.07 + 3.1));
  float n = 0.55 * dapN(w.xz * 1.1) + 0.3 * dapN(w.xz * 2.6 + 17.0) + 0.15 * dapN(w.xz * 6.0 + 5.0);
  return ${k ? `mix(1.0, mix(${k.toFixed(2)}, 1.0, smoothstep(0.5, 0.62, n)), canopy)` : '1.0'}; }
`;
  C.lights_fragment_begin = C.lights_fragment_begin.replace(
    'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;',
    `directLight.color *= ( directLight.visible && receiveShadow ) ? mix( ${floor.toFixed(2)}, 1.0, getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) ) * dapple( geometryPosition ) : 1.0;`);
}
