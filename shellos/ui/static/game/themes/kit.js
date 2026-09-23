// 主题公用小工具：天空渐变穹顶、雾、沿路线的高度场地面、远山剪影、噪声、网格贴图。
// 主题插件（themes/<style>.js）约定：export function build(scene, ctx)；export function update(dt, st)
//   ctx = { THREE, world, theme, route, meshes(路面/台阶/信号灯/营地/旗), lights{hemi,sun}, camera, renderer, kit, preview, rand }
//   st  = { t, dt, s(化身连续步数), progress(0..1), pos, total, avatar(Vector3), terrain(/state.terrain), pulse(本帧是否脉冲), summit(bool) }
import * as THREE from 'three';
import { nearest, ROAD_W, STEP } from '../path.js';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';

export function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 4) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 天空：竖直渐变穹顶（不受雾影响）。返回 {mesh, set(top, bottom)}，night_to_dawn 之类可以每帧改色
export function sky(scene, top, bottom, { radius = 450, exponent = 0.8 } = {}) {
  const u = { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) }, ex: { value: exponent } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; uniform float ex; varying vec3 vP; void main(){ float h = pow(clamp(vP.y*1.15+0.05,0.0,1.0), ex); gl_FragColor = vec4(mix(bottom, top, h),1.0);\n#include <colorspace_fragment>\n}',
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  mesh.name = 'sky'; mesh.renderOrder = -10; scene.add(mesh);
  return { mesh, uniforms: u, set(t, b) { u.top.value.set(t); u.bottom.value.set(b); } };
}

export function fog(scene, color, near = 12, far = 90) { scene.fog = new THREE.Fog(color, near, far); return scene.fog; }

// 沿路线的高度场：路面下方贴着路，离路越远越按 amp 抬高（左侧）/ 降低（右侧，给远景留视野）
// opts: color, size, seg, amp, drop(右侧下降比例), rough, flatTo(远处回到这个高度；网格训练场用), map, uvScale
export function terrain(ctx, o = {}) {
  const { route } = ctx;
  const size = o.size || 170, seg = o.seg || 150, amp = o.amp ?? 5, drop = o.drop ?? 0.6, rough = o.rough ?? 1.0, seed = o.seed || 0;
  const c = routeCenter(route);
  const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, col = new Float32Array(p.count * 3), base = new THREE.Color(o.color || ctx.theme.ground || '#445');
  const uv = g.attributes.uv, us = o.uvScale || 1;
  // 路沿外至少空出一整格网格再抬高，否则三角形插值会在转弯内侧把地面顶出路面；贴路一格内的顶点压到路面下
  const cell = size / seg, under = ROAD_W / 2 + cell, inner = under + 0.3;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + c.x, z = p.getZ(i) + c.z, n = nearest(route, x, z);
    let y = n.y - (n.d < under ? 0.08 : 0.06);
    if (n.d > inner) {
      const t = smooth(inner, inner + (o.reach || 14), n.d), nz = fbm(x * 0.07 + seed, z * 0.07 - seed);
      if (o.flatTo !== undefined) y = y + (o.flatTo - y) * t - 0.02;
      else y += (n.side > 0 ? amp : -amp * drop) * t * (0.55 + 0.9 * nz) + rough * (nz - 0.5) * t * 2;
    }
    p.setXYZ(i, x, y, z);
    uv.setXY(i, x / us, z / us);
    const k = 0.82 + 0.3 * noise2(x * 0.35, z * 0.35);
    col[i * 3] = base.r * k; col[i * 3 + 1] = base.g * k; col[i * 3 + 2] = base.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: o.map || null });
  const mesh = new THREE.Mesh(g, mat); mesh.name = 'ground';
  ctx.scene.add(mesh);
  return mesh;
}

// 远山/远城剪影：一圈锯齿带，不吃雾，颜色自己给（一般取雾色和天空底色之间）
export function ridge(ctx, { color, radius = 140, height = 22, base = -30, jag = 0.6, seg = 256, seed = 1, y0 } = {}) {
  const c = routeCenter(ctx.route), pos = [], idx = [];
  const yb = (y0 ?? 0);
  for (let k = 0; k <= seg; k++) {
    const a = k / seg * Math.PI * 2, x = c.x + Math.cos(a) * radius, z = c.z + Math.sin(a) * radius;
    const h = yb + height * (0.35 + 0.65 * fbm(k * 0.045 * (1 + jag) + seed, seed * 3.1, 5));
    pos.push(x, base, z, x, h, z);
    if (k < seg) { const b = k * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, fog: false, side: THREE.DoubleSide }));
  m.name = 'ridge'; m.renderOrder = -5; ctx.scene.add(m);
  return m;
}

// 网格贴图（训练场）：1 个 uv 单位一格
export function gridTexture(line = '#3a4653', bg = '#1c232d', px = 128, w = 3) {
  const cv = document.createElement('canvas'); cv.width = cv.height = px;
  const g = cv.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, px, px);
  g.fillStyle = line; g.fillRect(0, 0, px, w); g.fillRect(0, 0, w, px);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// 双面字牌：正反两面都是正字（textPlane 是 DoubleSide，从背后看是镜像字 —— 正面镜头 cam=front 回看来路时全是反字）。1 次绘制
export function sign2(util, text, height, o = {}) {
  const m = util.textPlane(text, height, o), back = m.geometry.clone().rotateY(Math.PI);
  m.geometry = mergeGeometries([m.geometry, back]); m.material.side = THREE.FrontSide;
  return m;
}

// 双面招牌图集：textSigns 的每块再加一块转 180° 的背面，材质改单面 —— 两面都是正字，仍是 1 次绘制
export function signs2(util, items, opt) {
  const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const m = util.textSigns(items.flatMap(it => [it, it.q ? { ...it, q: it.q.clone().multiply(flip) } : { ...it, ry: (it.ry || 0) + Math.PI }]), opt);
  m.material.side = THREE.FrontSide;
  return m;
}

// ?fx=low：展位降级。主题少摆远处/重复的东西（雨、远楼、草、星星），光影降级归 lighting.js
export const LOW = new URLSearchParams(location.search).get('fx') === 'low';

// 粒子池：n 粒尘 / 水花 / 火星，burst(x, y, z, k, cnt, { up, life, size, spread }) 往外喷一团；update(dt, camera) 每帧走一步。
//   一个 Points = 1 次绘制；CPU 更新（每帧改 3 个小缓冲，不 new 对象）。颜色一池一种（color），add = 加色（夜景）
export function particles(ctx, { color = '#d8cbb4', add = false, alpha = 0.6, n = 64, gravity = 1.6, name = 'particles' } = {}) {
  const P = new Float32Array(n * 3), V = new Float32Array(n * 3), A = new Float32Array(n), S = new Float32Array(n), L = new Float32Array(n), L0 = new Float32Array(n), Y0 = new Float32Array(n), G = new Float32Array(n);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('aA', new THREE.BufferAttribute(A, 1)); g.setAttribute('aS', new THREE.BufferAttribute(S, 1));
  const U = { uColor: { value: new THREE.Color(color) }, uScale: { value: 600 } };
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: 'attribute float aA; attribute float aS; uniform float uScale; varying float vA; void main(){ vA = aA; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aS * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uColor; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = vA * smoothstep(0.5, 0.1, d); if (a < 0.01) discard; gl_FragColor = vec4(uColor, a);\n#include <colorspace_fragment>\n}',
  }));
  pts.name = name; pts.frustumCulled = false; pts.renderOrder = 3; ctx.scene.add(pts);
  const R = ctx.rand;
  let head = 0, live = 0;
  return {
    points: pts,
    burst(x, y, z, k = 1, cnt = 10, { up = 1, life = 1, size = 1, spread = 0.12, floor = true } = {}) {
      for (let j = 0; j < cnt; j++) {
        const i = head; head = (head + 1) % n;
        const a = R() * Math.PI * 2, sp = (0.35 + R() * 0.7) * k;
        P[i * 3] = x + Math.cos(a) * spread; P[i * 3 + 1] = y + 0.03; P[i * 3 + 2] = z + Math.sin(a) * spread; Y0[i] = floor ? y + 0.03 : -1e9;
        V[i * 3] = Math.cos(a) * sp; V[i * 3 + 1] = (0.25 + R() * 0.55) * k * up; V[i * 3 + 2] = Math.sin(a) * sp;
        L[i] = L0[i] = (0.55 + R() * 0.35) * life; S[i] = (0.14 + R() * 0.1) * size; G[i] = gravity;
      }
      live = 2;
    },
    update(dt, camera) {
      if (!live) return;                                // 全灭了就不再动缓冲
      U.uScale.value = (innerHeight || 1080) / (2 * Math.tan((camera ? camera.fov : 52) * Math.PI / 360));
      let any = 0;
      for (let i = 0; i < n; i++) {
        if (L[i] <= 0) { if (A[i]) A[i] = 0; continue; }
        any = 1; L[i] -= dt; const u = Math.max(0, L[i] / L0[i]);
        V[i * 3 + 1] -= G[i] * dt; const drag = Math.exp(-dt * 2.5);
        V[i * 3] *= drag; V[i * 3 + 2] *= drag;
        P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] = Math.max(Y0[i], P[i * 3 + 1] + V[i * 3 + 1] * dt); P[i * 3 + 2] += V[i * 3 + 2] * dt;   // y 落回地面就停
        A[i] = alpha * u * Math.min(1, (1 - u) * 8); S[i] += dt * 0.35;
      }
      if (!any) live--;
      g.attributes.position.needsUpdate = g.attributes.aA.needsUpdate = g.attributes.aS.needsUpdate = true;
    },
  };
}

// 落阶反馈：化身跨过一级台阶的边（st.s 过整数步）时，脚下那级踏面亮一下 + 扬一小团尘。
//   下台阶（落阶冲击）强：踏面 0.75、尘 20 粒 + 一圈冲击环；上台阶（阻力）弱：0.3、5 粒。每个主题 build 里 fx = stepFx(ctx, {...})，update 里 fx.update(dt, st)。
//   dust = 尘的颜色（东京是溅起的水、富士是红褐火山砂）；flash = 踏面亮的颜色；add = 加色混合（夜景用，白天用普通混合才看得见）
//   wet = 平地 / 坡上每一步也溅一小圈水花（东京湿街：踩到水坑）
export function stepFx(ctx, { dust = '#d8cbb4', flash = '#fff2c8', add = false, dustA = 0.6, n = 64, wet = false } = {}) {
  const { route, scene } = ctx, steps = route.steps, N = route.N;
  const blend = add ? THREE.AdditiveBlending : THREE.NormalBlending;
  // 踏面：整级一块，前后沿亮、中间淡（灰度贴图乘颜色）
  const tex = new THREE.CanvasTexture((() => {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 8; const g = cv.getContext('2d'), gr = g.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.12, '#999'); gr.addColorStop(0.5, '#666'); gr.addColorStop(0.88, '#999'); gr.addColorStop(1, '#fff');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 8); return cv;
  })());
  const fm = new THREE.MeshBasicMaterial({ color: flash, map: tex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, blending: blend,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const tread = new THREE.Mesh(new THREE.PlaneGeometry(STEP * 0.98, ROAD_W * 0.98).rotateX(-Math.PI / 2), fm);
  tread.name = 'stepFlash'; tread.visible = false; tread.renderOrder = 2; scene.add(tread);
  // 冲击环：脚下一圈环往外扩（亮踏面上光靠变亮看不出来，环的形状看得出来）。下台阶大环；wet 时平地每步一个小水圈
  const rm = fm.clone(); rm.map = null;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2), rm);
  ring.name = 'stepRing'; ring.visible = false; ring.renderOrder = 2; scene.add(ring);
  const dustP = particles(ctx, { color: dust, add, alpha: dustA, n, name: 'stepDust' });
  const at = {};
  let last = null, fT = 0, fD = 1, fK = 0, rT = 0, rMax = 0.78;
  const land = (k, down) => {
    const top = k < N ? (steps[k].kind.startsWith('stairs') ? Math.max(steps[k].h0, steps[k].h1) : route.heightAt(k + 0.5)) : route.heightAt(k + 0.5);
    route.at(k + 0.5, 0, at); tread.position.set(at.pos.x, top + 0.012, at.pos.z); tread.rotation.y = -at.heading; tread.visible = true;
    fT = fD = down ? 0.45 : 0.3; fK = down ? 0.75 : 0.3;
    route.at(k + 0.15, 0.35, at);
    dustP.burst(at.pos.x, top, at.pos.z, down ? 1 : 0.6, down ? 20 : 5, { size: down ? 1.3 : 1 });
    if (down) { ring.position.set(at.pos.x, top + 0.016, at.pos.z); ring.visible = true; rT = 0.42; rMax = 0.78; }
  };
  const splash = k => {                                   // 湿街：脚落处一个小水圈 + 6 滴水
    route.at(k + 0.15, 0.35, at); const y = route.heightAt(k + 0.15);
    dustP.burst(at.pos.x, y, at.pos.z, 0.55, LOW ? 3 : 6, { up: 1.4, life: 0.7, size: 0.7, spread: 0.08 });
    if (rT <= 0) { ring.position.set(at.pos.x, y + 0.016, at.pos.z); ring.visible = true; rT = 0.42; rMax = 0.32; }
  };
  return {
    particles: dustP,
    update(dt, st) {
      const s = st.s;
      if (last === null || st.summit || Math.abs(s - last) > 3) last = s;
      for (let k = Math.floor(last) + 1; k <= Math.floor(s) && k <= N; k++) {
        const prev = steps[k - 1], next = steps[k];
        if (prev && prev.kind === 'stairs_down') land(k, true);
        else if (next && next.kind === 'stairs_up') land(k, false);
        else if (wet && prev && !prev.kind.startsWith('stairs')) splash(k);
      }
      last = s;
      if (fT > 0) { fT = Math.max(0, fT - dt); fm.opacity = fK * (fT / fD) ** 1.5; if (fT === 0) tread.visible = false; }
      if (rT > 0) { rT = Math.max(0, rT - dt); const u = 1 - rT / 0.42; ring.scale.setScalar((0.18 + 0.6 * Math.sqrt(u)) * rMax / 0.78); rm.opacity = 0.95 * (1 - u) ** 1.3; if (rT === 0) ring.visible = false; }
      dustP.update(dt, st.camera);
    },
  };
}

// 一次性触发：edge(on) 在 on 从假变真的那一帧返回 true（同一圈只响一次；on 变回假再变真才再响）
export function edge() { let was = false; return on => { const r = on && !was; was = !!on; return r; }; }

// 音效：WebAudio 现合成（不下载文件）。sfx('can' | 'bell' | 'splash' | 'chime' | 'flutter')。?sfx=0 静音。
//   浏览器不让没交互过的页面出声：上下文挂起时等第一次按键 / 点击再恢复（空格走路就算）。音量都压低，峰哥说话时不抢
const SFX_ON = new URLSearchParams(location.search).get('sfx') !== '0';
let AC = null;
function audio() {
  if (!SFX_ON) return null;
  if (!AC) {
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
    const wake = () => AC.state === 'suspended' && AC.resume();
    for (const e of ['keydown', 'pointerdown']) addEventListener(e, wake);
  }
  return AC.state === 'running' ? AC : (AC.resume(), null);
}
export function sfx(name, vol = 1) {
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime, out = ac.createGain(); out.gain.value = 0.22 * vol; out.connect(ac.destination);
  const tone = (f, dur, g = 1, type = 'sine', t0 = 0) => {
    const o = ac.createOscillator(), e = ac.createGain(); o.type = type; o.frequency.value = f;
    e.gain.setValueAtTime(0, t + t0); e.gain.linearRampToValueAtTime(g, t + t0 + 0.005); e.gain.exponentialRampToValueAtTime(0.0001, t + t0 + dur);
    o.connect(e); e.connect(out); o.start(t + t0); o.stop(t + t0 + dur + 0.05); return o;
  };
  const noise = (dur, f, q, g = 1, t0 = 0) => {
    const b = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
    const src = ac.createBufferSource(), bp = ac.createBiquadFilter(), e = ac.createGain(); src.buffer = b; bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; e.gain.value = g;
    src.connect(bp); bp.connect(e); e.connect(out); src.start(t + t0);
  };
  if (name === 'can') { const o = tone(150, 0.22, 1, 'sine'); o.frequency.exponentialRampToValueAtTime(70, t + 0.2); noise(0.08, 2400, 3, 0.5); tone(1900, 0.18, 0.12, 'triangle', 0.03); }   // 咚 + 罐子碰一下
  else if (name === 'bell') for (let k = 0; k < 3; k++) for (const [f, g, d] of [[196, 1, 4], [196 * 2.76, 0.5, 2.5], [196 * 5.4, 0.25, 1.2], [196 * 1.5, 0.3, 3]]) tone(f, d, g * (1 - k * 0.2), 'sine', k * 1.6);   // 寺钟：三声，非谐和泛音
  else if (name === 'splash') { noise(0.35, 1400, 0.8, 1); noise(0.2, 3200, 1.5, 0.5, 0.05); }
  else if (name === 'chime') [880, 1175, 1480, 1760].forEach((f, k) => tone(f, 1.6, 0.35, 'sine', k * 0.09));
  else if (name === 'flutter') for (let k = 0; k < 6; k++) noise(0.05, 2600 + k * 200, 2, 0.35, k * 0.045);
}

// 惊起的鸟：fire(pos, away) 从 pos 一下飞出 count 只（往 away 方向 ±60° 散开、往上爬），扇着翅 3 s 飞远就没了。1 次绘制
export function birdBurst(ctx, { count = 12, size = 0.6, color = '#2a2622', name = 'birdBurst', climb = 1 } = {}) {   // climb：往上爬的劲（跟拍镜头朝下看，爬太快一出手就出画）
  const w = size / 2, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0.14 * size, 0, 0, -0.1 * size, 0, 0, 0.02 * size, 0, w, -0.1 * size, 0, 0, -0.14 * size, 0, 0.7 * w, 0.02 * size, 0, w], 3));
  g.computeVertexNormals();
  const m = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }), count * 2);
  m.name = name; m.frustumCulled = false; m.visible = false; ctx.scene.add(m);
  const R = ctx.rand, B = Array.from({ length: count }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), f: R() * 6 }));
  const m4 = new THREE.Matrix4(), qy = new THREE.Quaternion(), qr = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
  let t = 99;
  return {
    fire(pos, away) {
      const a0 = Math.atan2(away.z, away.x);
      for (const b of B) { const a = a0 + (R() - 0.5) * 2.1, sp = 2.5 + R() * 2.5; b.p.copy(pos).add(new THREE.Vector3((R() - 0.5) * 0.8, R() * 0.5, (R() - 0.5) * 0.8)); b.v.set(Math.cos(a) * sp, (1.2 + R() * 1.6) * climb, Math.sin(a) * sp); }
      t = 0; m.visible = true;
    },
    update(dt) {
      if (t > 3.2) { m.visible = false; return; }
      t += dt;
      B.forEach((b, i) => {
        b.p.addScaledVector(b.v, dt); b.v.y += 0.4 * climb * dt;
        const fl = 0.7 * Math.sin(t * 14 + b.f), yaw = Math.atan2(-b.v.z, b.v.x);
        qy.setFromAxisAngle(Y, yaw);
        for (const sd of [1, -1]) { qr.setFromAxisAngle(X, -sd * fl).premultiply(qy); m.setMatrixAt(i * 2 + (sd > 0 ? 0 : 1), m4.compose(b.p, qr, sc.set(1, 1, sd))); }
      });
      m.instanceMatrix.needsUpdate = true;
    },
  };
}

// 鸟群：count 只鸟绕 center 盘旋（各自半径 / 高度 / 相位不同），左右翅分别绕身体前后轴上下扇。
//   一个 InstancedMesh、2×count 个实例（左翅 = 右翅镜像）= 1 次绘制。泰山：山谷上空的鹰；梧桐：山谷里的白鹭。size = 翼展
export function flock(ctx, { count = 10, center, radius = 12, spread = 5, height = 6, size = 0.9, color = '#2a2622', speed = 0.25, flap = 2.2, name = 'flock' } = {}) {
  const w = size / 2, g = new THREE.BufferGeometry();          // 一片翅：翼根在原点，翼尖在 +z，前缘朝 +x
  g.setAttribute('position', new THREE.Float32BufferAttribute([0.14 * size, 0, 0, -0.1 * size, 0, 0, 0.02 * size, 0, w, -0.1 * size, 0, 0, -0.14 * size, 0, 0.7 * w, 0.02 * size, 0, w], 3));
  g.computeVertexNormals();
  const m = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }), count * 2);
  m.name = name; m.frustumCulled = false; ctx.scene.add(m);
  const R = ctx.rand, B = Array.from({ length: count }, () => ({ r: radius + (R() - 0.5) * spread * 2, h: height + (R() - 0.5) * spread * 0.6, a: R() * Math.PI * 2, v: speed * (0.8 + R() * 0.4), f: R() * 6 }));
  const m4 = new THREE.Matrix4(), qy = new THREE.Quaternion(), qr = new THREE.Quaternion(), X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
  let t = 0;
  const F = { agitate: 0 };                               // 0..1：被惊起（半径 ×2.5、高 +1.5、转得快 3 倍、扇得急）；主题按距离设，这里平滑跟过去
  let ag = 0;
  const upd = dt => {
    t += dt; ag += (F.agitate - ag) * Math.min(1, dt * 3);
    B.forEach((b, i) => {
      b.a += dt * b.v * 2 * ag;
      const a = b.a + t * b.v, fl = 0.55 * Math.sin(t * flap * (1 + ag) * 6.28 + b.f), r = b.r * (1 + 1.5 * ag);
      p.set(center.x + Math.cos(a) * r, center.y + b.h + 1.5 * ag + Math.sin(t * 0.7 + b.f) * 0.6, center.z + Math.sin(a) * r);
      qy.setFromAxisAngle(Y, -a - Math.PI / 2 + (b.v < 0 ? Math.PI : 0));   // 机头 = 圆的切线方向（speed 为负 = 反着绕）
      for (const sd of [1, -1]) {
        qr.setFromAxisAngle(X, -sd * fl).premultiply(qy);
        m.setMatrixAt(i * 2 + (sd > 0 ? 0 : 1), m4.compose(p, qr, sc.set(1, 1, sd)));
      }
    });
    m.instanceMatrix.needsUpdate = true;
  };
  upd(0);
  return Object.assign(F, { mesh: m, update: upd, center });
}

export function routeCenter(route) {
  const a = route.P[0], b = route.P[route.N] || a;
  return new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
}

export function mixHex(a, b, t) { return new THREE.Color(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, t))); }
