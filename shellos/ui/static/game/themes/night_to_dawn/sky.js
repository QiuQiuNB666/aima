// 富士山夜登的天：渐变穹顶（夜 → 蓝调 → 日出，颜色由入口按进度给）+ 银河带 + 点精灵繁星（闪烁）
//   + 日出光晕（太阳从云海下升起）+ 云海（2 层噪声平面）+ 远山剪影（南阿尔卑斯露出云海）。
import * as THREE from 'three';

const NOISE = `
float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h1(i), h1(i + vec2(1., 0.)), f.x), mix(h1(i + vec2(0., 1.)), h1(i + vec2(1., 1.)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int k = 0; k < 5; k++){ s += a * n2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return s; }`;

const col = () => ({ value: new THREE.Color() });

// fwd = 大致前进方向（水平单位向量），sunXZ = 太阳方位（水平单位向量）
export function buildSky(scene, ctx, fwd, sunXZ) {
  const c = ctx.kit.routeCenter(ctx.route), R = ctx.rand;
  const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  // 银河：一条斜着的大圆，最高点在右前方 55°、仰角只有 34°——从左边地平线斜斜升到右上，不经过头顶（不像探照灯）
  const hz = fwd.clone().multiplyScalar(Math.cos(0.96)).addScaledVector(right, Math.sin(0.96)).normalize(), EL = 0.6;
  const bx = hz.clone().multiplyScalar(Math.cos(EL)).addScaledVector(up, Math.sin(EL)).normalize();
  const band = hz.clone().multiplyScalar(-Math.sin(EL)).addScaledVector(up, Math.cos(EL)).normalize();
  const by = new THREE.Vector3().crossVectors(band, bx).normalize();

  const U = {
    top: col(), mid: col(), hzCool: col(), hzWarm: col(), below: col(), sunCol: col(),
    sunDir: { value: new THREE.Vector3() }, halo: { value: 0 }, warm: { value: 0 }, milky: { value: 1 },
    band: { value: band }, bx: { value: bx }, by: { value: by },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 48, 24), new THREE.ShaderMaterial({
    uniforms: U, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top, mid, hzCool, hzWarm, below, sunCol, sunDir, band, bx, by; uniform float halo, warm, milky; varying vec3 vP; ${NOISE}
      void main(){ vec3 d = normalize(vP); float e = d.y;
        vec3 sxz = normalize(vec3(sunDir.x, 0., sunDir.z));
        float fw = max(dot(normalize(vec3(d.x, 0., d.z) + 1e-5), sxz), 0.);
        vec3 hz = mix(hzCool, hzWarm, warm * pow(fw, 1.6));
        vec3 c = mix(hz, mid, smoothstep(0.0, 0.22, e));
        c = mix(c, top, smoothstep(0.18, 0.85, e));
        c += hzWarm * warm * pow(fw, 5.) * exp(-max(e, 0.) * 7.) * 0.45;         // 太阳那边的地平线暖带
        float s = max(dot(d, sunDir), 0.);
        c += sunCol * (pow(s, 8.) * 0.22 + pow(s, 60.) * 0.5 + pow(s, 900.) * 3.) * halo;
        // 银河：大圆带 + 两层噪声 + 中间暗尘带
        float b = dot(d, band);
        vec2 q = vec2(dot(d, bx), dot(d, by)) * 4.2 + vec2(b * 9., -b * 7.);
        float n = fbm(q), n2v = fbm(q * 2.7 + 5.3);
        float mw = exp(-b * b * 20.) * (0.12 + 0.8 * n * n) + exp(-b * b * 80.) * 0.45 * n2v * n2v;   // 宽而柔
        mw *= 1. - 0.6 * exp(-pow((b - 0.02) * 22., 2.)) * smoothstep(0.35, 0.65, n2v);
        c += vec3(0.62, 0.68, 0.95) * mw * milky * smoothstep(-0.02, 0.3, e) * 0.13;
        c = mix(c, below, smoothstep(0.0, -0.1, e));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  sky.name = 'sky'; sky.renderOrder = -10; scene.add(sky);

  // 繁星：点精灵，一部分沿银河带加密；大小/颜色/闪烁相位各不同
  const NS = 2600, sp = new Float32Array(NS * 3), ss = new Float32Array(NS), sph = new Float32Array(NS), sc = new Float32Array(NS * 3);
  const v = new THREE.Vector3(), tint = [[1, 1, 1], [0.78, 0.86, 1], [1, 0.9, 0.75], [0.7, 0.8, 1]];
  for (let i = 0; i < NS; i++) {
    if (i < NS * 0.35) {                           // 银河里的星：大圆上随机角 + 小偏离
      const a = R() * Math.PI * 2, off = (R() + R() + R() - 1.5) * 0.15;
      v.copy(bx).multiplyScalar(Math.cos(a)).addScaledVector(by, Math.sin(a)).addScaledVector(band, off).normalize();
    } else {
      const a = R() * Math.PI * 2, y = Math.pow(R(), 0.8);
      v.set(Math.cos(a) * Math.sqrt(1 - y * y), y, Math.sin(a) * Math.sqrt(1 - y * y));
    }
    if (v.y < -0.02) v.y = -v.y;
    sp.set([v.x * 400, v.y * 400, v.z * 400], i * 3);
    const big = R();
    ss[i] = big > 0.985 ? 5.5 : big > 0.93 ? 3.8 : big > 0.7 ? 2.6 : 1.8;
    sph[i] = R() * 6.283;
    sc.set(tint[(R() * 4) | 0], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3)); sg.setAttribute('sz', new THREE.BufferAttribute(ss, 1));
  sg.setAttribute('ph', new THREE.BufferAttribute(sph, 1)); sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  const SU = { t: { value: 0 }, op: { value: 1 } };
  const stars = new THREE.Points(sg, new THREE.ShaderMaterial({
    uniforms: SU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    vertexShader: `attribute float sz; attribute float ph; attribute vec3 color; uniform float t, op; varying float vA; varying vec3 vC;
      void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = sz;
        vA = op * (0.72 + 0.28 * sin(t * (1.3 + fract(ph) * 2.) + ph)) * smoothstep(-0.01, 0.12, normalize(position).y); vC = color; }`,
    fragmentShader: `varying float vA; varying vec3 vC; void main(){ float r = length(gl_PointCoord - 0.5) * 2.; float a = 1. - smoothstep(0.25, 1., r);
      gl_FragColor = vec4(vC, a * vA); }`,
  }));
  stars.position.copy(c); stars.name = 'stars'; stars.renderOrder = -9; stars.frustumCulled = false; scene.add(stars);

  // 太阳光晕：加色精灵
  const glowTex = ctx.util.canvasTexture(256, 256, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,250,228,1)'); r.addColorStop(0.06, 'rgba(255,228,170,0.95)'); r.addColorStop(0.2, 'rgba(255,170,90,0.4)');
    r.addColorStop(0.5, 'rgba(255,120,60,0.1)'); r.addColorStop(1, 'rgba(255,100,50,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, toneMapped: false }));
  sun.name = 'sunGlow'; sun.renderOrder = -4; scene.add(sun);

  // 远山：2 层，山脚沉在云海里
  const ridges = [
    { radius: 210, height: 22, y0: -19, seed: 6 },
    { radius: 300, height: 32, y0: -23, seed: 11 },
  ].map(r => {
    const m = ctx.kit.ridge(ctx, { ...r, color: '#000', jag: 1.1, base: -40 });   // kit.ridge 在 +x 方向有一道接缝（首尾高度不等）：绕路线中心转半圈藏到身后
    m.geometry.translate(-c.x, 0, -c.z); m.position.set(c.x, 0, c.z); m.rotation.y = Math.PI;
    // 山脊边缘光：沿山脊一条加色渐变带（顶亮底 0）：夜里冷蓝月光 #6f86c8，天亮变暖
    const P = m.geometry.attributes.position, bp = [], bc = [], bi = [];
    for (let k = 0; k < P.count / 2; k++) {
      const x = P.getX(k * 2 + 1) * 0.997, y = P.getY(k * 2 + 1), z = P.getZ(k * 2 + 1) * 0.997;
      bp.push(x, y + 0.15, z, x, y - 2.2, z); bc.push(1, 1, 1, 0, 0, 0);
      if (k) { const b = (k - 1) * 2; bi.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); bg.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3)); bg.setIndex(bi);
    const rim = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    rim.renderOrder = -4.5; rim.name = 'ridgeRim'; m.add(rim); m.userData.rim = rim.material;
    return m;
  });

  // 影富士：日出时在云海上投一个三角形暗影，朝太阳反方向（p ≥ 0.9 淡入）
  const top = ctx.route.P[ctx.route.N], ax = new THREE.Vector3(-sunXZ.x, 0, -sunXZ.z), px = new THREE.Vector3(-ax.z, 0, ax.x);
  const kp = [top.x + ax.x * 8 + px.x * 42, top.z + ax.z * 8 + px.z * 42, top.x + ax.x * 8 - px.x * 42, top.z + ax.z * 8 - px.z * 42, top.x + ax.x * 330, top.z + ax.z * 330];
  const kg = new THREE.BufferGeometry();
  kg.setAttribute('position', new THREE.Float32BufferAttribute([kp[0], 0, kp[1], kp[2], 0, kp[3], kp[4], 0, kp[5]], 3));
  kg.setAttribute('color', new THREE.Float32BufferAttribute([0.16, 0.1, 0.2, 0.9, 0.16, 0.1, 0.2, 0.9, 0.2, 0.14, 0.24, 0.25], 4));
  const kage = new THREE.Mesh(kg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide }));
  kage.position.y = -7.85; kage.name = 'kageFuji'; kage.renderOrder = -0.5; kage.visible = false; scene.add(kage);

  // 云海：2 层半透明噪声平面，缓慢流动
  const clouds = [], CU = { lit: col(), shade: col(), haze: col() };
  const wind = new THREE.Vector2(-sunXZ.x, -sunXZ.z).multiplyScalar(0.01);
  [[-9.6, 1.0, 0.04], [-8.0, 0.75, 0.065]].forEach(([y, op, scl], k) => {
    const u = { t: { value: 0 }, op: { value: op }, sc: { value: scl }, wind: { value: wind.clone().multiplyScalar(1 + k * 0.6) }, cam: { value: ctx.camera.position }, ...CU };
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 wp; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); wp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float t, op, sc; uniform vec2 wind; uniform vec3 lit, shade, haze, cam; varying vec3 wp; ${NOISE}
        void main(){ vec2 p = wp.xz * sc + wind * t;
          float d = fbm(p + vec2(fbm(p * 0.5 - wind * t * 0.6)) * 1.3);
          float a = smoothstep(0.36, 0.68, d) * op;
          float dist = length(wp.xz - cam.xz);
          vec3 c = mix(shade, lit, smoothstep(0.45, 0.82, d));
          c = mix(c, haze, smoothstep(110., 420., dist));
          a = mix(a, op, smoothstep(140., 340., dist));
          a *= 1. - smoothstep(440., 500., dist);
          gl_FragColor = vec4(c, a);
          #include <colorspace_fragment>
        }`,
    }));
    m.position.set(c.x, y, c.z); m.name = 'cloudSea'; m.renderOrder = -1; scene.add(m); clouds.push(u);
  });

  const dir = new THREE.Vector3();
  return {
    U, CU, ridges,
    // K = 入口插好的调色（Color / 数）；sunEl = 太阳高度角（弧度）
    update(t, K, sunEl) {
      U.top.value.copy(K.zenith); U.mid.value.copy(K.mid); U.hzCool.value.copy(K.hzCool); U.hzWarm.value.copy(K.hzWarm);
      U.below.value.copy(K.below); U.sunCol.value.copy(K.sunGlow); U.warm.value = K.warm; U.halo.value = K.halo; U.milky.value = K.milky;
      dir.set(sunXZ.x * Math.cos(sunEl), Math.sin(sunEl), sunXZ.z * Math.cos(sunEl)).normalize(); U.sunDir.value.copy(dir);
      sun.position.set(c.x + dir.x * 400, dir.y * 400, c.z + dir.z * 400);
      const sz = 60 + 170 * K.halo; sun.scale.set(sz, sz, 1); sun.material.opacity = Math.min(1, K.halo * 1.1); sun.visible = K.halo > 0.02;
      SU.t.value = t % 3600; SU.op.value = K.stars; stars.visible = K.stars > 0.01;
      CU.lit.value.copy(K.cloudLit); CU.shade.value.copy(K.cloudShade); CU.haze.value.copy(K.cloudHaze);
      for (const u of clouds) u.t.value = t % 3600;
      ridges[0].material.color.copy(K.ridge1); ridges[1].material.color.copy(K.ridge2);
      for (const r of ridges) r.userData.rim.color.copy(K.rim);
      kage.material.opacity = K.kage * 0.55; kage.visible = K.kage > 0.01;
      return dir;
    },
  };
}
