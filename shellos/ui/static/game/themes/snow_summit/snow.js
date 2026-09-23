// 风雪：一团跟着镜头走的雪粒（点精灵），位置全在着色器里算（累计风程 + 摆动，按镜头周围的盒子取模），CPU 每帧只改几个 uniform。
//   风速随风雪强度变：风程在 CPU 上逐帧累加（不能用 风速 × 时间，风一变粒子就整片瞬移）。
//   强度 k（0..1）决定显示前 k 比例的粒子（按种子丢弃，不改几何）+ 风速；粒子总数有上限（?fx=low 更少）。
//   风大时每粒雪顺着它在屏幕上的运动方向拉成一道（按 1/20 s 的位移算拉多长）。
//   四分之一的粒子是「贴地吹雪」：只在大风口（drift > 0）出来，贴着地面（化身脚下的路面高度往上 0–0.5）三倍风速横着扫过去、拉得更长。
//   近处大片远处细：30% 的空中雪粒是大片（近了才看得出）。
//   阵风（W 线）：确定性的慢噪声（不用 Math.random），5–9 s 一阵，风速 ±35%、雪量 ±15%；白毛风（sky.js 的 WX.squall）叠在 k 和 drift 上、风速再快一倍。
//   雪面闪点（W 线 buildSparkle，?fx=low 不要）：低角度阳光下雪粒的镜面反光——600 个点贴在地表（地面网格的高度烤成一张贴图，顶点着色器里查），
//   绕镜头取模跟着走；每个点一个随机朝向的小晶面，只有晶面把太阳反到镜头里才亮（视线一动闪点就换地方），再按时间哈希一闪一闪。风雪里没有。
import * as THREE from 'three';
import { WX } from './sky.js';

const LOW = typeof location !== 'undefined' && new URLSearchParams(location.search).get('fx') === 'low';

export function buildSnow(scene, { count, windDir, ground }) {
  const R = mulberry(7), pos = new Float32Array(count * 3), seed = new Float32Array(count), low = new Float32Array(count);
  const BOX = [16, 10, 16];
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (R() - 0.5) * BOX[0]; pos[i * 3 + 1] = (R() - 0.5) * BOX[1]; pos[i * 3 + 2] = (R() - 0.5) * BOX[2];
    seed[i] = R(); low[i] = i % 4 === 0 ? 1 : 0;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1)); g.setAttribute('aLow', new THREE.BufferAttribute(low, 1));
  const U = {
    uT: { value: 0 }, uK: { value: 0 }, uDrift: { value: 0 }, uGround: { value: 0 }, uGust: { value: 1 }, uCam: { value: new THREE.Vector3() }, uOff: { value: new THREE.Vector3() }, uOff2: { value: new THREE.Vector3() },
    uVel: { value: new THREE.Vector3() }, uRes: { value: new THREE.Vector2(1920, 1080) },
    uScale: { value: 800 }, uBox: { value: new THREE.Vector3(...BOX) }, uCol: { value: new THREE.Color('#f4f8ff') },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, fog: false,
    vertexShader: `attribute float seed; attribute float aLow; uniform float uT, uK, uDrift, uGround, uGust, uScale; uniform vec3 uCam, uOff, uOff2, uBox, uVel; uniform vec2 uRes;
      varying float vA; varying vec2 vDir; varying float vStr;
      void main(){
        vec3 p;
        if (aLow > 0.5) {                                                  // 贴地吹雪：只在 xz 上绕镜头取模，高度贴着路面
          p = position + uOff2 * (0.8 + 0.4 * seed);
          p.xz = mod(p.xz - uCam.xz + uBox.xz * 0.5, uBox.xz) - uBox.xz * 0.5 + uCam.xz;
          p.y = uGround + 0.04 + 0.5 * fract(seed * 13.7) * fract(seed * 5.3) + 0.06 * sin(uT * 3.0 + seed * 20.);
        } else {
          p = position + uOff * (0.7 + 0.6 * seed) + vec3(sin(uT * 1.3 + seed * 40.) * 0.25, sin(uT * 0.9 + seed * 17.) * 0.15, cos(uT * 1.1 + seed * 29.) * 0.25);
          p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;       // 绕镜头取模：粒子永远在身边
        }
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        float on = aLow > 0.5 ? step(fract(seed * 3.1), uDrift) : step(seed, uK);   // 强度 = 显示多少比例
        vA = on * smoothstep(0.35, 1.4, d) * (1. - smoothstep(6., 8., d)) * (aLow > 0.5 ? 0.55 : 0.6 + 0.4 * uK) * uGust;
        float big = aLow > 0.5 ? 0. : step(0.7, fract(seed * 11.3));      // 30% 大片：近处看得出片，远处一样细
        float base = on * uScale * (0.022 + 0.034 * fract(seed * 7.3)) * (1. + 0.8 * big) / max(d, 0.3);
        // 拉成一道：这粒雪 1/20 s 在屏幕上走多远（像素），按基础大小的倍数拉长
        vec4 c1 = projectionMatrix * (viewMatrix * vec4(p + uVel * (aLow > 0.5 ? 3.0 : 1.0) * 0.05, 1.0));
        vec2 sp = (c1.xy / c1.w - gl_Position.xy / gl_Position.w) * uRes * 0.5;
        float len = length(sp);
        vDir = len > 1e-3 ? vec2(sp.x, -sp.y) / len : vec2(1.0, 0.0);
        vStr = clamp(len / max(base, 1.0), 0.0, aLow > 0.5 ? 5.0 : 3.0);
        gl_PointSize = base * (1.0 + vStr);
      }`,
    fragmentShader: `uniform vec3 uCol; varying float vA; varying vec2 vDir; varying float vStr;
      void main(){ vec2 q = gl_PointCoord - 0.5; float al = dot(q, vDir), ac = dot(q, vec2(-vDir.y, vDir.x)) * (1.0 + vStr);
        float r = (al * al + ac * ac) * 4.; float a = vA * (1. - smoothstep(0.35, 1., r));
        if (a < 0.01) discard; gl_FragColor = vec4(uCol, a);
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.name = 'snow'; pts.renderOrder = 4; scene.add(pts);
  const wd = windDir.clone().normalize();
  const spark = LOW ? null : buildSparkle(scene, ground || scene.getObjectByName('ground'));
  let gustPh = 0;
  return {
    pts, spark,
    // k = 风雪强度 0..1；drift = 贴地吹雪 0..1；ground = 化身脚下的路面高度；camera 给镜头位置和视口
    update(t, dt, k, camera, viewH, drift = 0, ground = 0) {
      if (spark) spark.update(t, camera);
      const sq = WX.squall; k = Math.min(1, Math.max(k, sq)); drift = Math.min(1, Math.max(drift, sq));   // 白毛风叠上来
      U.uK.value = k > 0.01 ? k : 0; U.uDrift.value = drift > 0.01 ? drift : 0;
      if (!U.uK.value && !U.uDrift.value) return;                         // 都是 0 = 点大小 0，一个片元都不出（一直在绘制列表里：管线第一帧就建好，起风雪那一刻不卡）
      U.uT.value = t % 1000; U.uGround.value = ground;
      U.uCam.value.copy(camera.position);
      gustPh += dt * 0.14;                                                // 阵风：两个不同周期的正弦叠 → 5–9 s 一阵，不重复
      const gust = 1 + 0.35 * Math.sin(gustPh * 6.283) * Math.sin(gustPh * 4.1 + 1.3);   // 0.65..1.35
      U.uGust.value = 0.85 + 0.15 * gust;
      const sp = (1.2 + 5.5 * Math.max(k, drift * 0.8) + 6 * sq) * (1 + (gust - 1) * k), o = U.uOff.value, o2 = U.uOff2.value;   // 大风：横着刮、略往下；白毛风再快一倍
      U.uVel.value.set(wd.x * sp, -0.6 - 0.8 * k, wd.z * sp);
      o.x += wd.x * sp * dt; o.y += (-0.6 - 0.8 * k) * dt; o.z += wd.z * sp * dt;
      o2.x += wd.x * sp * 3 * dt; o2.z += wd.z * sp * 3 * dt;
      if (Math.abs(o.x) + Math.abs(o.y) + Math.abs(o.z) + Math.abs(o2.x) + Math.abs(o2.z) > 5e4) { o.set(0, 0, 0); o2.set(0, 0, 0); }   // 开一整天也不丢精度（归零时跳一帧，看不出来）
      U.uScale.value = viewH / (2 * Math.tan(camera.fov * Math.PI / 360));
      U.uRes.value.set(viewH * camera.aspect, viewH);
    },
  };
}

// 雪面闪点：ground = kit.terrain 的网格（顶点按行排，(seg+1)² 个）；没有就不做
function buildSparkle(scene, ground, count = 600) {
  const g0 = ground && ground.geometry, P = g0 && g0.attributes.position;
  if (!P) return null;
  const w = Math.round(Math.sqrt(P.count)); if (w * w !== P.count) return null;
  const h = new Float32Array(P.count); for (let i = 0; i < P.count; i++) h[i] = P.getY(i);
  const x0 = P.getX(0), z0 = P.getZ(0), cell = (P.getX(w - 1) - x0) / (w - 1);
  const tex = new THREE.DataTexture(h, w, w, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.needsUpdate = true;
  const R = mulberry(23), pos = new Float32Array(count * 3), seed = new Float32Array(count), BOX = 14;
  for (let i = 0; i < count; i++) { pos[i * 3] = (R() - 0.5) * BOX; pos[i * 3 + 2] = (R() - 0.5) * BOX; seed[i] = R(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const U = { uT: { value: 0 }, uCam: { value: new THREE.Vector3() }, uSun: { value: 0 }, uSunDir: { value: WX.sunDir }, uH: { value: tex },
    uHb: { value: new THREE.Vector4(x0, z0, cell, w) }, uBox: { value: BOX }, uCol: { value: new THREE.Color('#fff6e0') } };
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...U }, transparent: true, depthWrite: false, fog: true, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float seed; uniform float uT, uSun, uBox; uniform vec3 uCam, uSunDir; uniform sampler2D uH; uniform vec4 uHb; varying float vA;
      #include <fog_pars_vertex>
      float hAt(vec2 xz){ vec2 gq = (xz - uHb.xy) / uHb.z; vec2 f = fract(gq); ivec2 i = clamp(ivec2(floor(gq)), ivec2(0), ivec2(int(uHb.w) - 2));
        float a = texelFetch(uH, i, 0).r, b = texelFetch(uH, i + ivec2(1, 0), 0).r, c = texelFetch(uH, i + ivec2(0, 1), 0).r, d = texelFetch(uH, i + ivec2(1, 1), 0).r;
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
      float hs(float x){ return fract(sin(x) * 43758.5453); }
      void main(){
        vec2 xz = mod(position.xz - uCam.xz + uBox * 0.5, uBox) - uBox * 0.5 + uCam.xz;   // 绕镜头取模
        vec3 p = vec3(xz.x, hAt(xz) + 0.03, xz.y);
        float e = uHb.z * 0.5;
        vec3 n = normalize(vec3(hAt(xz - vec2(e, 0.)) - hAt(xz + vec2(e, 0.)), 2. * e, hAt(xz - vec2(0., e)) - hAt(xz + vec2(0., e))));
        n = normalize(n + 0.5 * (vec3(hs(seed * 7.1), hs(seed * 3.3), hs(seed * 9.7)) - 0.5));      // 每个点一个歪一点的小晶面
        vec3 V = normalize(uCam - p), H = normalize(uSunDir + V);
        float spec = pow(max(dot(n, H), 0.), 70.);
        float tw = 0.35 + 0.65 * step(0.55, hs(floor(uT * (2. + 3. * hs(seed * 5.5)) + seed * 40.)));   // 一闪一闪（按时间哈希，不是每帧随机）
        vec4 mvPosition = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        float d = -mvPosition.z;
        vA = spec * tw * uSun * smoothstep(0.6, 1.5, d) * (1. - smoothstep(6., 7.5, d));
        gl_PointSize = (2.2 + 3.5 * spec) * step(0.02, vA);
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform vec3 uCol; varying float vA;
      #include <fog_pars_fragment>
      void main(){ vec2 q = gl_PointCoord - 0.5; float a = vA * (1. - smoothstep(0.1, 0.5, length(q)));
        if (a < 0.02) discard; gl_FragColor = vec4(uCol * a, a);
        #include <fog_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, mat), u = mat.uniforms;
  pts.frustumCulled = false; pts.name = 'sparkle'; pts.renderOrder = 3; scene.add(pts);
  return { pts, update(t, camera) { u.uT.value = t % 1000; u.uCam.value.copy(camera.position); u.uSun.value = WX.sun; pts.visible = WX.sun > 0.02; } };
}

function mulberry(a) { return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
