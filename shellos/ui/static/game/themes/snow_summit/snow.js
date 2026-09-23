// 风雪：一团跟着镜头走的雪粒（点精灵），位置全在着色器里算（风 × 时间 + 摆动，按镜头周围的盒子取模），CPU 每帧只改 4 个 uniform。
//   强度 k（0..1）决定显示前 k 比例的粒子（按种子丢弃，不改几何）+ 风速；粒子总数有上限（?fx=low 更少）。
import * as THREE from 'three';

export function buildSnow(scene, { count, windDir }) {
  const R = mulberry(7), pos = new Float32Array(count * 3), seed = new Float32Array(count);
  const BOX = [16, 10, 16];
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (R() - 0.5) * BOX[0]; pos[i * 3 + 1] = (R() - 0.5) * BOX[1]; pos[i * 3 + 2] = (R() - 0.5) * BOX[2];
    seed[i] = R();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const U = {
    uT: { value: 0 }, uK: { value: 0 }, uCam: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector3() },
    uScale: { value: 800 }, uBox: { value: new THREE.Vector3(...BOX) }, uCol: { value: new THREE.Color('#f4f8ff') },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, fog: false,
    vertexShader: `attribute float seed; uniform float uT, uK, uScale; uniform vec3 uCam, uWind, uBox; varying float vA;
      void main(){
        vec3 w = uWind * (0.7 + 0.6 * seed);
        vec3 p = position + w * uT + vec3(sin(uT * 1.3 + seed * 40.) * 0.25, sin(uT * 0.9 + seed * 17.) * 0.15, cos(uT * 1.1 + seed * 29.) * 0.25);
        p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;           // 绕镜头取模：粒子永远在身边
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        float on = step(seed, uK);                                        // 强度 = 显示多少比例
        vA = on * smoothstep(0.35, 1.4, d) * (1. - smoothstep(6., 8., d)) * (0.6 + 0.4 * uK);
        gl_PointSize = on * uScale * (0.022 + 0.034 * fract(seed * 7.3)) / max(d, 0.3);
      }`,
    fragmentShader: `uniform vec3 uCol; varying float vA;
      void main(){ vec2 q = gl_PointCoord - 0.5; float r = dot(q, q) * 4.; float a = vA * (1. - smoothstep(0.35, 1., r));
        if (a < 0.01) discard; gl_FragColor = vec4(uCol, a);
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false; pts.name = 'snow'; pts.renderOrder = 4; scene.add(pts);
  const wd = windDir.clone().normalize();
  return {
    pts,
    // k = 风雪强度 0..1；camera 给镜头位置和视口高度
    update(t, k, camera, viewH) {
      pts.visible = k > 0.01;
      if (!pts.visible) return;
      U.uT.value = t % 1000; U.uK.value = k;
      U.uCam.value.copy(camera.position);
      const sp = 1.2 + 5.5 * k;                                           // 大风：横着刮、略往下
      U.uWind.value.set(wd.x * sp, -0.6 - 0.8 * k, wd.z * sp);
      U.uScale.value = viewH / (2 * Math.tan(camera.fov * Math.PI / 360));
    },
  };
}

function mulberry(a) { return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
