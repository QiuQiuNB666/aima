// 华山的天：晴天渐变穹顶 + 太阳 + 秦岭远山（3 层，青灰，越远越淡）+ 云海（压在 y = -4：峪里看不见，上了苍龙岭 / 栈道往下看，深谷里全是云）。
import * as THREE from 'three';

const NOISE = `
float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h1(i), h1(i + vec2(1., 0.)), f.x), mix(h1(i + vec2(0., 1.)), h1(i + vec2(1., 1.)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int k = 0; k < 4; k++){ s += a * n2(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(1.7, 9.2); a *= .45; } return s / .9; }`;

export function buildSky(scene, ctx, { sunDir, C }) {
  const c = ctx.kit.routeCenter(ctx.route), kit = ctx.kit;
  const U = { top: { value: new THREE.Color(C.zenith) }, hz: { value: new THREE.Color(C.hz) }, below: { value: new THREE.Color(C.below) },
    sunCol: { value: new THREE.Color(C.sun) }, sunDir: { value: sunDir.clone() } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(460, 48, 24), new THREE.ShaderMaterial({
    uniforms: U, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top, hz, below, sunCol, sunDir; varying vec3 vP;
      void main(){ vec3 d = normalize(vP); float e = d.y;
        vec3 c = mix(hz, top, pow(clamp(e * 1.4, 0., 1.), 0.5));
        float s = max(dot(d, sunDir), 0.);
        c += sunCol * (pow(s, 6.) * 0.18 + pow(s, 80.) * 0.4 + pow(s, 1200.) * 2.5);
        c = mix(c, below, smoothstep(0.0, -0.08, e));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  sky.name = 'sky'; sky.renderOrder = -10; scene.add(sky);

  const glowTex = ctx.util.canvasTexture(256, 256, (g, w) => {
    const r = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,253,244,1)'); r.addColorStop(0.06, 'rgba(255,246,222,0.9)'); r.addColorStop(0.2, 'rgba(255,230,190,0.25)'); r.addColorStop(1, 'rgba(255,220,180,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, w);
  });
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, toneMapped: false }));
  sun.name = 'sunGlow'; sun.position.set(c.x + sunDir.x * 420, sunDir.y * 420, c.z + sunDir.z * 420); sun.scale.set(70, 70, 1); scene.add(sun);

  // 秦岭远山：3 层锯齿剪影，底部沉进云海；近的青灰、远的发蓝发白（空气透视）
  [[150, 18, 3, C.ridge1], [215, 26, 9, C.ridge2], [300, 34, 17, C.ridge3]].forEach(([radius, height, seed, color]) => {
    const m = kit.ridge(ctx, { color, radius, height, seed, jag: 1.4, base: -40, y0: -8 });
    m.name = 'qinling';
  });

  // 云海：两层低频噪声平面，远处整片不透明；风慢慢推着走。churn（苍龙岭起风）：流得快、扭起来、上层往上涌（?fx=low 不扭）
  const clouds = [];
  [[-4.2, 1.0, 0.022], [-2.9, 0.6, 0.034]].forEach(([y, op, sc], k) => {
    const u = { t: { value: 0 }, churn: { value: 0 }, op: { value: op }, sc: { value: sc }, wind: { value: new THREE.Vector2(0.012, 0.004).multiplyScalar(1 + k * 0.6) },
      lit: { value: new THREE.Color(C.cloudLit) }, shade: { value: new THREE.Color(C.cloudShade) }, haze: { value: new THREE.Color(C.hz) }, cam: { value: ctx.camera.position } };
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, fog: false, defines: kit.LOW ? { LOWFX: 1 } : {},
      vertexShader: 'varying vec3 wp; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); wp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float t, churn, op, sc; uniform vec2 wind; uniform vec3 lit, shade, haze, cam; varying vec3 wp; ${NOISE}
        void main(){ vec2 q = wp.xz * sc + wind * t;
          #ifndef LOWFX
          if (churn > 0.001) q += churn * 2.2 * (vec2(fbm(q * 0.8 + t * 0.03), fbm(q * 0.8 + vec2(5.2, 1.3) - t * 0.025)) - 0.5);
          #endif
          float d = fbm(q);
          float a = smoothstep(0.26 - 0.1 * churn, 0.58, d) * op, dist = length(wp.xz - cam.xz);
          vec3 c = mix(shade, lit, smoothstep(0.36 - 0.08 * churn, 0.72, d));
          c = mix(c, haze, smoothstep(150., 440., dist));
          a = mix(a, op, smoothstep(60., 260., dist)); a *= 1. - smoothstep(440., 500., dist);
          gl_FragColor = vec4(c, a);
          #include <colorspace_fragment>
        }`,
    }));
    m.position.set(c.x, y, c.z); m.name = 'cloudSea'; m.renderOrder = -1; m.frustumCulled = false; scene.add(m); clouds.push({ u, m, y });
  });
  let flow = 0, last = null;
  return {
    update(t, churn = 0) {                                              // flow 按帧累加（起风时流速 ×3.5，不会因为倍率变了一下跳好远）
      flow = (flow + Math.max(0, Math.min(0.1, last === null ? 0 : t - last)) * (1 + 2.5 * churn)) % 3600; last = t;
      clouds.forEach(({ u, m, y }, k) => { u.t.value = flow; u.churn.value = churn; m.position.y = y + (k ? 1.3 : 0.5) * churn * (0.8 + 0.2 * Math.sin(t * 0.6 + k)); });
    },
  };
}
