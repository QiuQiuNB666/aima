// 泰山拂晓的天：渐变穹顶 + 太阳光晕（随爬升从地平线下升起，登顶最亮）+ 云海（3 层噪声平面缓慢流动）+ 远山层叠剪影。
import * as THREE from 'three';

const NOISE = `
float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h1(i), h1(i + vec2(1., 0.)), f.x), mix(h1(i + vec2(0., 1.)), h1(i + vec2(1., 1.)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int k = 0; k < 5; k++){ s += a * n2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return s; }`;

// C = 调色：zenith 天顶、hz 地平线暖色、below 地平线下、sun 太阳
export function buildSky(scene, ctx, sunXZ, C) {
  const c = ctx.kit.routeCenter(ctx.route);
  const U = {
    top: { value: new THREE.Color(C.zenith) }, hz: { value: new THREE.Color(C.hz) }, below: { value: new THREE.Color(C.below) },
    sunCol: { value: new THREE.Color(C.sun) }, sunDir: { value: new THREE.Vector3() }, halo: { value: 0.3 },
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 48, 24), new THREE.ShaderMaterial({
    uniforms: U, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top, hz, below, sunCol, sunDir; uniform float halo; varying vec3 vP;
      void main(){ vec3 d = normalize(vP); float e = d.y;
        float up = pow(clamp(e * 1.5, 0., 1.), 0.5);
        vec3 c = mix(hz, top, up);
        float s = max(dot(d, sunDir), 0.);
        c = mix(c, sunCol, pow(s, 6.) * (0.35 + 0.35 * halo) * (1. - up * 0.7));
        c += sunCol * (pow(s, 50.) * 0.45 + pow(s, 700.) * 2.5) * halo;
        c = mix(c, below, smoothstep(0.0, -0.06, e));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  sky.name = 'sky'; sky.renderOrder = -10; scene.add(sky);

  // 太阳光晕：加色精灵，放在远山后面（远山写深度，太阳从山/云后面透出来）
  const glowTex = ctx.util.canvasTexture(256, 256, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,250,230,1)'); r.addColorStop(0.07, 'rgba(255,236,190,0.95)'); r.addColorStop(0.2, 'rgba(255,196,120,0.35)');
    r.addColorStop(0.5, 'rgba(255,160,90,0.08)'); r.addColorStop(1, 'rgba(255,140,80,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, toneMapped: false }));
  sun.name = 'sunGlow'; scene.add(sun);

  // 远山：4 层剪影，近的深、远的淡（空气透视），山脚沉在云海里
  const ridges = [
    { radius: 150, height: 24, y0: -14, seed: 4, t: 0.0 },
    { radius: 200, height: 30, y0: -16, seed: 8, t: 0.35 },
    { radius: 260, height: 36, y0: -18, seed: 13, t: 0.6 },
    { radius: 330, height: 46, y0: -20, seed: 17, t: 0.82 },
  ].map(r => ctx.kit.ridge(ctx, { ...r, color: ctx.kit.mixHex(C.ridgeNear, C.ridgeFar, r.t), jag: 0.9 }));

  // 云海：3 层半透明噪声平面，风向 = 太阳那边吹来
  const clouds = [];
  const wind = new THREE.Vector2(-sunXZ.x, -sunXZ.z).multiplyScalar(0.012);
  [[-4.2, 1.0, 0.045], [-3.1, 0.8, 0.07], [-2.1, 0.55, 0.1]].forEach(([y, op, sc], k) => {
    const u = { t: { value: 0 }, op: { value: op }, sc: { value: sc }, wind: { value: wind.clone().multiplyScalar(1 + k * 0.5) },
      lit: { value: new THREE.Color(C.cloudLit) }, shade: { value: new THREE.Color(C.cloudShade) }, haze: { value: new THREE.Color(C.cloudHaze) }, cam: { value: ctx.camera.position } };
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 wp; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); wp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float t, op, sc; uniform vec2 wind; uniform vec3 lit, shade, haze, cam; varying vec3 wp; ${NOISE}
        void main(){ vec2 p = wp.xz * sc + wind * t;
          float d = fbm(p + vec2(fbm(p * 0.5 - wind * t * 0.6)) * 1.3);
          float a = smoothstep(0.38, 0.7, d) * op;
          float dist = length(wp.xz - cam.xz);
          vec3 c = mix(shade, lit, smoothstep(0.45, 0.8, d));
          c = mix(c, haze, smoothstep(120., 440., dist));
          a = mix(a, op, smoothstep(150., 360., dist));
          a *= 1. - smoothstep(440., 500., dist);
          gl_FragColor = vec4(c, a);
          #include <colorspace_fragment>
        }`,
    }));
    m.position.set(c.x, y, c.z); m.name = 'cloudSea'; m.renderOrder = -1; scene.add(m); clouds.push(u);
  });

  const dir = new THREE.Vector3();
  return {
    ridges, sky: U,
    // p = 爬升进度 0..1；summit = 登顶画面
    update(t, p, summit) {
      const k = summit ? 1 : Math.max(0, Math.min(1, (p - 0.15) / 0.85)), e = k * k * (3 - 2 * k);
      const el = -0.02 + 0.085 * e + (summit ? 0.01 : 0);           // 太阳高度角：山脚在地平线下，登顶约 +4°
      dir.set(sunXZ.x * Math.cos(el), Math.sin(el), sunXZ.z * Math.cos(el)).normalize();
      U.sunDir.value.copy(dir); U.halo.value = 0.3 + 0.7 * e + (summit ? 0.35 : 0);
      sun.position.set(c.x + dir.x * 400, dir.y * 400, c.z + dir.z * 400);
      const sz = 70 + 110 * e + (summit ? 60 : 0); sun.scale.set(sz, sz, 1);
      sun.material.opacity = 0.35 + 0.65 * e;
      const tt = t % 3600;
      for (const u of clouds) u.t.value = tt;
    },
  };
}
