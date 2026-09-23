// 高海拔的天：渐变穹顶（低处藏蓝 → 风雪灰白 → 登顶蓝黑）+ 太阳 + 喜马拉雅群峰剪影（雪线以上白、随爬升沉到地平线下）
//   + 远处的珠峰北壁和旗云（只在低处看得到，风雪一来就隐进天里）+ 云海（中段往上才有，登顶铺满脚下）。
import * as THREE from 'three';

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
  };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(460, 48, 24), new THREE.ShaderMaterial({
    uniforms: U, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top, hz, below, sunCol, sunDir; uniform float halo, band; varying vec3 vP;
      void main(){ vec3 d = normalize(vP); float e = d.y;
        vec3 c = mix(hz, top, pow(clamp(e * 1.6, 0., 1.), 0.45));
        c = mix(c, hz * 1.08, band * exp(-abs(e) * 28.));                        // 地平线一条亮霾
        float s = max(dot(d, sunDir), 0.);
        c += sunCol * (pow(s, 8.) * 0.22 + pow(s, 90.) * 0.5 + pow(s, 1400.) * 3.) * halo;
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
  U.sunDir.value.copy(sunDir); sun.position.set(c.x + sunDir.x * 420, sunDir.y * 420, c.z + sunDir.z * 420); sun.scale.set(60, 60, 1);

  // 云海：低频噪声平面，压在 y = -9；p 过北坳才露面，登顶整片铺满
  const clouds = [];
  const wind = new THREE.Vector2(side.x, side.z).multiplyScalar(0.012);
  [[-9.5, 1.0, 0.02], [-7.8, 0.65, 0.032]].forEach(([y, op, sc], k) => {
    const u = { t: { value: 0 }, op: { value: 0 }, op0: { value: op }, sc: { value: sc }, wind: { value: wind.clone().multiplyScalar(1 + k * 0.7) },
      lit: { value: new THREE.Color('#ffffff') }, shade: { value: new THREE.Color('#b8c6da') }, haze: { value: new THREE.Color('#dbe6f3') }, cam: { value: ctx.camera.position } };
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 wp; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); wp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float t, op, sc; uniform vec2 wind; uniform vec3 lit, shade, haze, cam; varying vec3 wp; ${NOISE}
        void main(){ vec2 p = wp.xz * sc + wind * t; float d = fbm(p);
          float a = smoothstep(0.28, 0.6, d) * op;
          float dist = length(wp.xz - cam.xz);
          vec3 c = mix(shade, lit, smoothstep(0.38, 0.75, d));
          c = mix(c, haze, smoothstep(160., 440., dist));
          a = mix(a, op, smoothstep(80., 280., dist)); a *= 1. - smoothstep(440., 500., dist);
          gl_FragColor = vec4(c, a);
          #include <colorspace_fragment>
        }`,
    }));
    m.position.set(c.x, y, c.z); m.name = 'cloudSea'; m.renderOrder = -1; m.frustumCulled = false; scene.add(m); clouds.push({ m, u });
  });

  return {
    U, layers, clouds, ev, banner, sun,
    // k = 调色结果（入口算好）：sky/hz/below/haze/sink/cloud/everest…
    apply(k, t) {
      U.top.value.copy(k.top); U.hz.value.copy(k.hz); U.below.value.copy(k.below); U.band.value = k.band; U.halo.value = k.halo;
      layers.forEach((L, i) => { L.U.haze.value = Math.min(1, k.haze * (0.55 + 0.25 * i)); L.U.hazeC.value.copy(k.hz); L.U.lift.value = -k.sink * (0.5 + 0.24 * i); });
      ev.u.op.value = k.everest; ev.u.hazeC.value.copy(k.hz); ev.m.visible = k.everest > 0.01;
      banner.material.opacity = k.everest * 0.9; banner.visible = ev.m.visible;
      sun.material.opacity = k.sun;
      for (const cl of clouds) { cl.u.op.value = cl.u.op0.value * k.cloud; cl.u.t.value = t % 3600; cl.m.scale.setScalar(k.cloud > 0.01 ? 1 : 1e-6); cl.u.haze.value.copy(k.hz).lerp(cl.u.lit.value, 0.4); }   // 用不着时缩成点：不画片元，但管线第一帧就建好
    },
  };
}
