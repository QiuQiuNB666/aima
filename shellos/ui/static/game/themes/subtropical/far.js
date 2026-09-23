// 梧桐山的远景：晴空 + 积云、山下城区平原 + 海湾（一张着色平面）、通用高楼天际线剪影、对岸淡山、
// 谷里的薄雾（2 层噪声平面）、林间雾团、穿林光柱、飞鸟。全部自己上色（fog:false），按距离往雾色混 = 空气透视。
import * as THREE from 'three';

const NOISE = `
float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h1(i), h1(i + vec2(1., 0.)), f.x), mix(h1(i + vec2(0., 1.)), h1(i + vec2(1., 1.)), f.x), f.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int k = 0; k < 4; k++){ s += a * n2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= .5; } return s; }`;

export const LAND_Y = -30;             // 山下城区 / 海面高度（地面右侧远处沉到这下面）
const SHORE = 250;                     // 离路线中心多远开始是海

// B = { c, D(前), R(右), sunDir }；C = 调色
export function buildFar(scene, ctx, B, C) {
  const { kit, util } = ctx, R = ctx.rand, { c, D, R: RT } = B;
  const dirAt = th => D.clone().multiplyScalar(Math.cos(th)).addScaledVector(RT, Math.sin(th));   // th = 从正前方往右转的角度

  // 天：kit 渐变穹顶
  kit.sky(scene, C.zenith, C.hz, { exponent: 0.55 });

  // 对岸淡山（一圈，左侧被梧桐山挡住，右侧在海后面）
  //   推到海湾外沿以外（r 560 / 640，高度同比放大）：山顶往右前看，城和对岸山之间留一整条海（pos33 约 70–90 px 高）
  kit.ridge(ctx, { color: kit.mixHex(C.farHill, C.hz, 0.25), radius: 560, height: 52, y0: -22, base: -45, seed: 5, jag: 0.8 });
  kit.ridge(ctx, { color: kit.mixHex(C.farHill, C.hz, 0.55), radius: 640, height: 74, y0: -18, base: -45, seed: 11, jag: 0.6 });

  // 城区平原 + 海湾：一张大平面，离中心 < SHORE 是灰绿城区，外面是海；按离镜头距离混雾色
  const bayU = { t: { value: 0 }, cam: { value: ctx.camera.position }, cen: { value: new THREE.Vector2(c.x, c.z) },
    land: { value: new THREE.Color(C.land) }, sea: { value: new THREE.Color(C.sea) }, haze: { value: new THREE.Color(C.hz) }, glint: { value: new THREE.Color('#fffbe8') },
    sunXZ: { value: new THREE.Vector2(B.sunDir.x, B.sunDir.z).normalize() } };
  const bay = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400, 1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: bayU, fog: false,
    vertexShader: 'varying vec3 wp; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); wp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float t; uniform vec3 cam, land, sea, haze, glint; uniform vec2 cen, sunXZ; varying vec3 wp; ${NOISE}
      void main(){
        vec2 q = wp.xz - cen; float r = length(q);
        float shore = ${SHORE.toFixed(1)} + 14. * (fbm(normalize(q) * 3.0) - 0.5) * 2.;
        float isSea = smoothstep(shore - 2., shore + 2., r);
        float blocks = n2(wp.xz * 0.35) * 0.5 + n2(wp.xz * 1.3) * 0.5;       // 城区：灰绿斑块
        vec3 c = mix(land * (0.85 + 0.3 * blocks), sea * (0.92 + 0.12 * n2(wp.xz * 0.08 + t * 0.02)), isSea);
        float dist = length(wp.xz - cam.xz);
        vec2 v = normalize(wp.xz - cam.xz);
        float g = pow(max(dot(v, sunXZ), 0.), 8.) * n2(wp.xz * 0.6 + vec2(t * 0.3, 0.)) * isSea;   // 朝太阳那边的海面闪光
        c += glint * g * 0.35;
        c = mix(c, haze, smoothstep(60., 330., dist) * mix(0.8, 0.3, isSea));    // 海少混雾：深蓝海湾和天分得开
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  }));
  bay.position.set(c.x, LAND_Y, c.z); bay.name = 'bay'; bay.renderOrder = -4; scene.add(bay);

  // 天际线：通用高楼（方盒 / 退台塔楼 / 板楼），3 个 InstancedMesh。面按朝向预先上明暗（MeshBasic，不吃灯），实例色 = 楼色往雾色混
  const winTex = util.canvasTexture(64, 128, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 6) { g.fillStyle = 'rgba(40,60,80,0.13)'; g.fillRect(0, y, w, 3); }       // 楼层窗带
    for (let x = 0; x < w; x += 8) { g.fillStyle = 'rgba(40,60,80,0.06)'; g.fillRect(x, 0, 2, h); }
  });
  const shade = geo => {                       // 顶面 1、朝太阳侧 0.92、背侧 0.72：远看也有体积
    const n = geo.attributes.normal, col = new Float32Array(n.count * 3);
    for (let i = 0; i < n.count; i++) { const v = n.getY(i) > 0.5 ? 1.0 : n.getX(i) > 0.5 ? 0.95 : n.getX(i) < -0.5 ? 0.7 : n.getZ(i) > 0.5 ? 0.85 : 0.78; col.fill(v, i * 3, i * 3 + 3); }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); return geo;
  };
  const box = (w, h, d, y) => new THREE.BoxGeometry(w, h, d).translate(0, y + h / 2, 0);
  const geoA = shade(box(1, 1, 1, 0));                                    // 单位方盒
  const geoB = shade(util.merged([                                        // 退台塔楼（单位高 1）
    { geo: box(1, 0.62, 1, 0) }, { geo: box(0.8, 0.26, 0.8, 0.62) }, { geo: box(0.56, 0.12, 0.56, 0.88) },
  ]));
  const geoC = shade(box(1, 1, 0.38, 0));                                 // 板楼
  const items = [[], [], []], haze = new THREE.Color(C.hz), col = new THREE.Color();
  const cols = C.towers.map(x => new THREE.Color(x));
  let n = 0;
  while (n < 220) {
        // 路线后半段镜头朝向约 D 往左 13°–25°：城区扇面放在 D 的 -8°–40°（观景台、山脊时在画面右前方）
    const core = R() < 0.75, th = THREE.MathUtils.degToRad(core ? -8 + 48 * R() : 40 + 60 * R());
    const r = 165 + R() * 60, p = c.clone().addScaledVector(dirAt(th), r);
    const mid = Math.exp(-((THREE.MathUtils.radToDeg(th) - 14) ** 2) / 220);   // 14° 那一带是 CBD
    const kind = R() < 0.18 + 0.3 * mid ? 1 : R() < 0.35 ? 2 : 0;
    const h = (kind === 1 ? 12 + 8 * R() : 3 + 8 * R()) * (0.55 + 0.6 * mid) * (core ? 1 : 0.7) + 3;   // 城区平面在山下 30：从山上看楼在脚下，最高的几栋顶到地平线
    const w = kind === 2 ? 8 + 6 * R() : 4 + 4 * R();
    const k = (r - 165) / 60;
    col.copy(cols[(R() * cols.length) | 0]).lerp(haze, 0.08 + 0.2 * k);
    items[kind].push({ p: [p.x, LAND_Y - 1, p.z], ry: Math.atan2(p.x - c.x, p.z - c.z) + (R() - 0.5) * 0.5, s: [w, h + 1, kind === 2 ? w : w * (0.8 + R() * 0.4)], color: col.clone() });
    n++;
  }
  for (let k = 0; k < 7; k++) {          // 福田 CBD 一撮高层（20–28）：通用退台方塔，不做任何可认出的地标细节
    const th = THREE.MathUtils.degToRad(14 + 16 * R()), r = 180 + R() * 22, p = c.clone().addScaledVector(dirAt(th), r), w = 5.5 + R() * 3;
    col.copy(cols[(R() * cols.length) | 0]).lerp(haze, 0.16);
    items[k % 3 === 2 ? 0 : 1].push({ p: [p.x, LAND_Y - 1, p.z], ry: Math.atan2(p.x - c.x, p.z - c.z) + (R() - 0.5) * 0.4, s: [w, 20 + R() * 8, w * (0.85 + R() * 0.3)], color: col.clone() });
  }
  const bMat = new THREE.MeshBasicMaterial({ vertexColors: true, map: winTex, fog: false });
  // 城市焦点：一栋通用超高层（塔身 60 + 尖肋 9，其余楼最高 ~28 → 两倍多），5 级收分 + 顶上 4 根向内收的尖肋；#D5DBE2，雾只混一半。
  //   th 9.5°：pos14 在左上信息卡和中间路段卡之间从山脊线上方冒出来，pos22 在卡片下沿以下，pos33 在中间卡和右上卡之间。
  //   更高（96）在 pos14 / 22 / 33 一定顶进顶部 HUD 面板后面（这三处的顶部空档不在同一个方向上）。不做任何可认出的真实建筑细节
  {
    const th = THREE.MathUtils.degToRad(9.5), p = c.clone().addScaledVector(dirAt(th), 188);
    const tiers = [[9, 24], [7.6, 15], [6.3, 10], [5, 7], [3.8, 4]], parts = [];
    let y = 0;
    for (const [w, h] of tiers) { parts.push({ geo: box(w, h, w, y) }); y += h; }
    const tw = tiers[tiers.length - 1][0] / 2 - 0.3;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {        // 尖肋：从顶层四角往上收到中心上方
      const a = new THREE.Vector3(sx * tw, y, sz * tw), b = new THREE.Vector3(sx * 0.4, y + 9, sz * 0.4), d = b.clone().sub(a), len = d.length();
      parts.push({ geo: new THREE.BoxGeometry(0.55, len, 0.55).translate(0, len / 2, 0), p: a.toArray(), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()) });
    }
    parts.push({ geo: new THREE.CylinderGeometry(0.06, 0.3, 6, 6).translate(0, 3, 0), p: [0, y + 6, 0] });   // 中心天线
    const g = shade(util.merged(parts)), cc = g.attributes.color, tc = new THREE.Color('#d5dbe2').lerp(haze, 0.08);
    for (let i = 0; i < cc.count; i++) cc.setXYZ(i, cc.getX(i) * tc.r, cc.getY(i) * tc.g, cc.getZ(i) * tc.b);
    const m = new THREE.Mesh(g, bMat); m.position.set(p.x, LAND_Y - 1, p.z); m.rotation.y = Math.atan2(p.x - c.x, p.z - c.z) + 0.35;
    m.name = 'supertall'; m.renderOrder = -3; scene.add(m);
  }
  [geoA, geoB, geoC].forEach((g, i) => { if (!items[i].length) return; const m = util.instanced(g, bMat, items[i]); m.name = 'skyline'; m.renderOrder = -3; scene.add(m); });

  // 积云：一张 canvas 云贴图，12 块广告牌（1 次绘制），离得远、不吃雾
  const cloudTex = util.canvasTexture(256, 128, (g, w, h) => {
    const puff = (x, y, r, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(0.6, `rgba(250,252,255,${a * 0.8})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
    const rr = ctx.rand;
    for (let k = 0; k < 16; k++) { const x = 40 + rr() * 176, y = 58 + (rr() - 0.5) * 30 - Math.sin((x - 40) / 176 * Math.PI) * 18, r = 22 + rr() * 26; puff(x, y, r, 0.85); }
    const sh = g.createLinearGradient(0, 60, 0, 120); sh.addColorStop(0, 'rgba(160,180,200,0)'); sh.addColorStop(1, 'rgba(150,170,195,0.55)');
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = sh; g.fillRect(0, 0, w, h);
  });
  const clouds = [];
  for (let k = 0; k < 14; k++) {
    const th = (k / 14) * Math.PI * 2 + R() * 0.4, r = 280 + R() * 60, p = c.clone().addScaledVector(dirAt(th), r), s = 50 + R() * 45;
    clouds.push({ p: [p.x, 22 + R() * 38, p.z], ry: Math.atan2(c.x - p.x, c.z - p.z), s: [s * (R() < 0.5 ? -1 : 1), s * 0.5, 1] });
  }
  const cloudMesh = util.instanced(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide }), clouds);
  cloudMesh.name = 'clouds'; cloudMesh.renderOrder = -6; scene.add(cloudMesh);

  // 谷雾：两层水平噪声平面，在路右侧山谷里（路面以下），离镜头近处淡出
  const mistUs = [];
  [[-8, 0.62, 0.05], [-16, 0.78, 0.035]].forEach(([y, op, sc], k) => {
    const u = { t: { value: 0 }, op: { value: op }, sc: { value: sc }, cam: { value: ctx.camera.position }, col: { value: new THREE.Color(C.mist) }, cen: { value: new THREE.Vector2(c.x, c.z) } };
    const m = new THREE.Mesh(new THREE.PlaneGeometry(260, 260).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: u, transparent: true, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 wp; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); wp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform float t, op, sc; uniform vec3 cam, col; uniform vec2 cen; varying vec3 wp; ${NOISE}
        void main(){ vec2 p = wp.xz * sc + vec2(t * 0.012, t * 0.004);
          float d = fbm(p + fbm(p * 0.6 - t * 0.003));
          float a = smoothstep(0.3, 0.68, d) * op;
          float dist = length(wp.xz - cam.xz);
          a *= smoothstep(8., 26., dist) * (1. - smoothstep(95., 128., length(wp.xz - cen)));
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
    }));
    m.position.set(c.x, y, c.z); m.name = 'valleyMist'; m.renderOrder = 2 + k; scene.add(m); mistUs.push(u);
  });

  // 林间雾团：柔边竖片，朝后（朝镜头来的方向），淡
  const puffTex = util.canvasTexture(128, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.setTransform(1, 0, 0, 0.5, 0, h / 4); g.fillStyle = gr; g.fillRect(0, 0, w, w);
  });
  const puffs = [];
  for (let k = 0; k < 26; k++) {
    const side = R() < 0.55 ? 1 : -1, s = -14 + R() * (ctx.route.N + 28), lat = side * (9 + R() * 22);
    const a = ctx.route.at(s, lat), y = B.hAt(a.pos.x, a.pos.z) + 1.2 + R() * 2.5, w = 10 + R() * 12;
    puffs.push({ p: [a.pos.x, y, a.pos.z], ry: Math.atan2(-D.x, -D.z) + (R() - 0.5) * 0.6, s: [w, w * 0.35, 1] });
  }
  const puffMat = new THREE.MeshBasicMaterial({ map: puffTex, color: C.mist, transparent: true, opacity: 0.42, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const puffMesh = util.instanced(new THREE.PlaneGeometry(1, 1), puffMat, puffs); puffMesh.name = 'forestMist'; puffMesh.renderOrder = 3; scene.add(puffMesh);
  // 谷中云带：观景台、山脊往右看，山谷里横着一条白云（大块柔边片，路面以下几米）
  const band = [], NN = ctx.route.N;
  for (let k = 0; k < 16; k++) {        // 前 8 块沿右侧山谷，后 8 块在山顶和城市之间（观景台 / 山脊往右前看的那片谷）
    const a = k < 8 ? ctx.route.at(12 + k * (NN - 10) / 7 + (R() - 0.5) * 3, -(20 + R() * 24)).pos
      : ctx.route.P[NN].clone().addScaledVector(dirAt(THREE.MathUtils.degToRad(10 + 55 * R())), 30 + R() * 40);
    const y = Math.max(B.hAt(a.x, a.z) + 2.5, ctx.route.hmax - 6 - R() * 4), w = 28 + R() * 18;
    band.push({ p: [a.x, y, a.z], ry: Math.atan2(-D.x, -D.z) + (R() - 0.5) * 0.5, s: [w, w * 0.26, 1] });
  }
  const bandMesh = util.instanced(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: puffTex, color: C.mist, transparent: true, opacity: 0.72, depthWrite: false, fog: false, side: THREE.DoubleSide }), band);
  bandMesh.name = 'valleyCloud'; bandMesh.renderOrder = 3; scene.add(bandMesh);

  // 穿林光柱：细长加色片，长轴 = 阳光方向，片面朝下山方向（镜头看得到）
  const rayTex = util.canvasTexture(64, 256, (g, w, h) => {
    const gx = g.createLinearGradient(0, 0, w, 0); gx.addColorStop(0, 'rgba(255,255,255,0)'); gx.addColorStop(0.5, 'rgba(255,255,255,1)'); gx.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gx; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    const gy = g.createLinearGradient(0, 0, 0, h); gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(0.25, 'rgba(0,0,0,1)'); gy.addColorStop(0.7, 'rgba(0,0,0,0.8)'); gy.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gy; g.fillRect(0, 0, w, h);
  });
  const L = B.sunDir.clone().normalize(), n0 = D.clone().negate(); n0.addScaledVector(L, -n0.dot(L)).normalize();
  const u0 = new THREE.Vector3().crossVectors(L, n0), m4 = new THREE.Matrix4().makeBasis(u0, L, n0), qRay = new THREE.Quaternion().setFromRotationMatrix(m4);
  const rays = [];
  const spots = [[4, 7], [10, 9.5], [16, 8.5], [25, 9], [-4, 8.5], [-2, -7.5], [13, 12], [20, 11], [7, -9], [1, -10]];   // 只放在林子里（右侧 14 步以后是开阔山谷）
  for (const [s, lat] of spots) {
    const a = ctx.route.at(s, lat), y = B.hAt(a.pos.x, a.pos.z), len = 8 + R() * 3;
    const base = a.pos.clone().setY(y).addScaledVector(L, len * 0.5);   // 光柱下端落在地面
    rays.push({ p: base.toArray(), q: qRay, s: [1.4 + R() * 1.4, len, 1], color: new THREE.Color(C.ray).multiplyScalar(0.7 + R() * 0.3) });
  }
  const rayMat = new THREE.MeshBasicMaterial({ map: rayTex, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false });
  const rayMesh = util.instanced(new THREE.PlaneGeometry(1, 1), rayMat, rays); rayMesh.name = 'sunRays'; rayMesh.renderOrder = 4; scene.add(rayMesh);

  // 飞鸟：两群，在右侧山谷上空绕圈；每帧改实例矩阵（14 只，1 次绘制）；翅膀上下扇 = 缩放 y
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.12, -0.55, 0.22, 0.12, 0, 0, 0.1, 0, 0, -0.12, 0, 0, 0.1, 0.55, 0.22, 0.12], 3));
  wing.computeVertexNormals();
  const birds = [], BN = 14;
  for (let k = 0; k < BN; k++) {
    const flock = k < 8 ? 0 : 1;        // 0：山脊前方右上（离镜头 ~15–25 m）；1：好汉坡上段右侧
    const a = flock ? ctx.route.at(31, -15).pos : ctx.route.P[ctx.route.N].clone().addScaledVector(D, 14).addScaledVector(RT, 9), y0 = flock ? ctx.route.heightAt(31) : ctx.route.hmax;
    birds.push({ cx: a.x + (R() - 0.5) * 3, cz: a.z + (R() - 0.5) * 3, y: y0 + 1.2 + R() * 1.6, r: 2 + R() * 2.5, w: (0.35 + R() * 0.12) * (flock ? -1 : 1), ph: R() * 6.28, f: 5 + R() * 2, s: 1.0 + R() * 0.4 });
  }
  const birdMesh = new THREE.InstancedMesh(wing, new THREE.MeshBasicMaterial({ color: C.bird, side: THREE.DoubleSide }), BN);
  birdMesh.name = 'birds'; birdMesh.frustumCulled = false; scene.add(birdMesh);
  const bm = new THREE.Matrix4(), bq = new THREE.Quaternion(), bp = new THREE.Vector3(), bs = new THREE.Vector3(), Yax = new THREE.Vector3(0, 1, 0);

  return {
    update(t) {
      const tt = t % 3600;
      bayU.t.value = tt; for (const u of mistUs) u.t.value = tt;
      rayMat.opacity = 0.44 + 0.08 * Math.sin(tt * 0.35) + 0.04 * Math.sin(tt * 1.3);
      birds.forEach((b, i) => {
        const a = b.ph + tt * b.w;
        bp.set(b.cx + Math.cos(a) * b.r, b.y + Math.sin(tt * 0.5 + b.ph) * 0.6, b.cz + Math.sin(a) * b.r);
        bq.setFromAxisAngle(Yax, -a + (b.w > 0 ? 0 : Math.PI));
        const fl = Math.sin(tt * b.f + b.ph);
        bs.set(b.s, b.s * (0.2 + 1.3 * fl), b.s);
        birdMesh.setMatrixAt(i, bm.compose(bp, bq, bs));
      });
      birdMesh.instanceMatrix.needsUpdate = true;
    },
  };
}
