// 雨丝：一个 InstancedBufferGeometry（每滴一个细长四边形），顶点着色器里按时间下落、围着镜头取模回卷 = 1 次绘制，每帧只改 uniform。
import * as THREE from 'three';

let U = null;
export function buildRain(scene, ctx, { n = 2600, box = [26, 12, 26] } = {}) {
  const quad = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
  g.index = quad.index; g.setAttribute('position', quad.attributes.position);
  const off = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) off.set([ctx.rand(), ctx.rand(), ctx.rand(), 0.75 + ctx.rand() * 0.5], i * 4);
  g.setAttribute('seed', new THREE.InstancedBufferAttribute(off, 4)); g.instanceCount = n;
  U = { uT: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...box) }, uColor: { value: new THREE.Color('#b8c8ff') } };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec4 seed; uniform float uT; uniform vec3 uCam, uBox; varying float vA, vX;
      void main(){
        vec3 lo = uCam - uBox * 0.5, b = seed.xyz * uBox;
        vec3 p = lo + mod(b - lo - vec3(uT * 1.2, uT * 11.0 * seed.w, uT * 0.4), uBox);   // 世界坐标固定、围着镜头回卷；略斜
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vec3 dv = normalize((viewMatrix * vec4(0.11, -1.0, 0.04, 0.0)).xyz), sd = normalize(cross(dv, vec3(0.0, 0.0, 1.0)));
        float d = -mv.z;
        mv.xyz += dv * position.y * 0.5 * seed.w + sd * position.x * (0.006 + d * 0.0012);
        vA = (0.5 - position.y) * smoothstep(0.6, 2.0, d) * (1.0 - smoothstep(9.0, 13.0, length(p - uCam)));
        vX = position.x * 2.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uColor; varying float vA, vX;
      void main(){ gl_FragColor = vec4(uColor * vA * (1.0 - vX * vX) * 0.45, 1.0); }`,
  });
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 4; m.name = 'rain';
  scene.add(m);
}
export function updateRain(dt, st) { if (!U) return; U.uT.value += dt; if (st.camera) U.uCam.value.copy(st.camera.position); }
