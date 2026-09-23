// 风雪：一团跟着镜头走的雪粒（点精灵），位置全在着色器里算（累计风程 + 摆动，按镜头周围的盒子取模），CPU 每帧只改几个 uniform。
//   风速随风雪强度变：风程在 CPU 上逐帧累加（不能用 风速 × 时间，风一变粒子就整片瞬移）。
//   强度 k（0..1）决定显示前 k 比例的粒子（按种子丢弃，不改几何）+ 风速；粒子总数有上限（?fx=low 更少）。
//   风大时每粒雪顺着它在屏幕上的运动方向拉成一道（按 1/20 s 的位移算拉多长）。
//   四分之一的粒子是「贴地吹雪」：只在大风口（drift > 0）出来，贴着地面（化身脚下的路面高度往上 0–0.5）三倍风速横着扫过去、拉得更长。
import * as THREE from 'three';

export function buildSnow(scene, { count, windDir }) {
  const R = mulberry(7), pos = new Float32Array(count * 3), seed = new Float32Array(count), low = new Float32Array(count);
  const BOX = [16, 10, 16];
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (R() - 0.5) * BOX[0]; pos[i * 3 + 1] = (R() - 0.5) * BOX[1]; pos[i * 3 + 2] = (R() - 0.5) * BOX[2];
    seed[i] = R(); low[i] = i % 4 === 0 ? 1 : 0;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('seed', new THREE.BufferAttribute(seed, 1)); g.setAttribute('aLow', new THREE.BufferAttribute(low, 1));
  const U = {
    uT: { value: 0 }, uK: { value: 0 }, uDrift: { value: 0 }, uGround: { value: 0 }, uCam: { value: new THREE.Vector3() }, uOff: { value: new THREE.Vector3() }, uOff2: { value: new THREE.Vector3() },
    uVel: { value: new THREE.Vector3() }, uRes: { value: new THREE.Vector2(1920, 1080) },
    uScale: { value: 800 }, uBox: { value: new THREE.Vector3(...BOX) }, uCol: { value: new THREE.Color('#f4f8ff') },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, fog: false,
    vertexShader: `attribute float seed; attribute float aLow; uniform float uT, uK, uDrift, uGround, uScale; uniform vec3 uCam, uOff, uOff2, uBox, uVel; uniform vec2 uRes;
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
        vA = on * smoothstep(0.35, 1.4, d) * (1. - smoothstep(6., 8., d)) * (aLow > 0.5 ? 0.55 : 0.6 + 0.4 * uK);
        float base = on * uScale * (0.022 + 0.034 * fract(seed * 7.3)) / max(d, 0.3);
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
  return {
    pts,
    // k = 风雪强度 0..1；drift = 贴地吹雪 0..1；ground = 化身脚下的路面高度；camera 给镜头位置和视口
    update(t, dt, k, camera, viewH, drift = 0, ground = 0) {
      U.uK.value = k > 0.01 ? k : 0; U.uDrift.value = drift > 0.01 ? drift : 0;
      if (!U.uK.value && !U.uDrift.value) return;                         // 都是 0 = 点大小 0，一个片元都不出（一直在绘制列表里：管线第一帧就建好，起风雪那一刻不卡）
      U.uT.value = t % 1000; U.uGround.value = ground;
      U.uCam.value.copy(camera.position);
      const sp = 1.2 + 5.5 * Math.max(k, drift * 0.8), o = U.uOff.value, o2 = U.uOff2.value;   // 大风：横着刮、略往下
      U.uVel.value.set(wd.x * sp, -0.6 - 0.8 * k, wd.z * sp);
      o.x += wd.x * sp * dt; o.y += (-0.6 - 0.8 * k) * dt; o.z += wd.z * sp * dt;
      o2.x += wd.x * sp * 3 * dt; o2.z += wd.z * sp * 3 * dt;
      if (Math.abs(o.x) + Math.abs(o.y) + Math.abs(o.z) + Math.abs(o2.x) + Math.abs(o2.z) > 5e4) { o.set(0, 0, 0); o2.set(0, 0, 0); }   // 开一整天也不丢精度（归零时跳一帧，看不出来）
      U.uScale.value = viewH / (2 * Math.tan(camera.fov * Math.PI / 360));
      U.uRes.value.set(viewH * camera.aspect, viewH);
    },
  };
}

function mulberry(a) { return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
