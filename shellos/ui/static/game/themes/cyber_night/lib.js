// cyber_night 子模块共用：四边形批量合并（光晕 / 倒影 / 地面标线 = 1 次绘制）、发光贴图、朝向换算。
import * as THREE from 'three';

// 很多个四边形合成 1 个网格。add(c 中心, ax 半宽向量, ay 半高向量, color)：uv (0,0) 在 c-ax-ay，v 沿 ay 增大
export function quads() {
  const P = [], U = [], C = [], I = [], col = new THREE.Color();
  return {
    add(c, ax, ay, color) {
      const b = P.length / 3; col.set(color);
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        P.push(c.x + ax.x * sx + ay.x * sy, c.y + ax.y * sx + ay.y * sy, c.z + ax.z * sx + ay.z * sy);
        U.push((sx + 1) / 2, (sy + 1) / 2); C.push(col.r, col.g, col.b);
      }
      I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    },
    get n() { return I.length / 6; },
    mesh(mat, name) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I); g.computeVertexNormals(); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat); m.name = name || 'quads'; return m;
    },
  };
}

// 加色发光材质（光晕、倒影、车灯拖尾）：不写深度；雾 = 按雾浓度变暗（不是混成雾色，否则加色面会变成一块块紫色方块）
export function glowMat(map, o = {}) {
  return shade(new THREE.MeshBasicMaterial({ map, vertexColors: o.vertexColors ?? true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    toneMapped: false, side: THREE.DoubleSide, opacity: o.opacity ?? 1, polygonOffset: !!o.ground, polygonOffsetFactor: o.ground ? -4 : 0, polygonOffsetUnits: o.ground ? -4 : 0 }),
    { addFog: true, mask: o.mask ?? true, neon: o.neon ?? true });
}

// ---- 片元着色器补丁（onBeforeCompile）----
// mask：HUD 面板（DOM，1920 宽下的像素框，随 1.04vw 缩放）后面的亮东西压到 40%，边缘 140 px 羽化 —— 兜底用，看着是自然变暗、不是切掉
// addFog：加色材质的雾 = 乘 (1 - fogFactor)；fogK：雾浓度倍率（远景天际线用小倍率，越远越淡但不会整片消失；鸟居也用小倍率，开场帧看得见）
// neon：霓虹下限 —— 25 单位以内雾最多吃掉 35%（亮度 ≥ 65%），25→40 单位渐变回正常雾
export const HUD_RES = { value: new THREE.Vector2(1920, 1080) };
const MASK = `uniform vec2 uHudRes;
float hudBox(vec2 q, vec2 a, vec2 b) { vec2 d = max(a - q, q - b); return max(d.x, d.y); }
float hudMask() {
  float k = uHudRes.x / 1920.0, H = uHudRes.y / k; vec2 q = vec2(gl_FragCoord.x, uHudRes.y - gl_FragCoord.y) / k;
  float o = min(min(hudBox(q, vec2(0.0), vec2(395.0, 205.0)), hudBox(q, vec2(690.0, 0.0), vec2(1230.0, 170.0))),
            min(hudBox(q, vec2(1575.0, 0.0), vec2(1920.0, 200.0)), min(hudBox(q, vec2(0.0, H - 195.0), vec2(500.0, H)), hudBox(q, vec2(1565.0, H - 255.0), vec2(1920.0, H)))));
  return mix(0.4, 1.0, smoothstep(0.0, 140.0, o));
}
`;
export function shade(mat, { mask = false, addFog = false, fogK = 1, neon = false } = {}) {
  if (addFog || neon) mat.fog = true;
  mat.onBeforeCompile = sh => {
    let f = sh.fragmentShader;
    let fog = THREE.ShaderChunk.fog_fragment;
    if (fogK !== 1) fog = fog.replace('fogDensity * fogDensity', `fogDensity * fogDensity * ${fogK.toFixed(3)}`);
    if (neon) fog = fog.replace('gl_FragColor.rgb = mix', 'fogFactor = min(fogFactor, mix(0.35, 1.0, smoothstep(25.0, 40.0, vFogDepth)));\n  gl_FragColor.rgb = mix');
    if (addFog) fog = fog.replace(/gl_FragColor\.rgb = mix\([^;]*;/, 'gl_FragColor.rgb *= 1.0 - fogFactor;');
    f = f.replace('#include <fog_fragment>', fog);
    if (mask) { sh.uniforms.uHudRes = HUD_RES; f = MASK + f.replace('#include <premultiplied_alpha_fragment>', 'gl_FragColor.rgb *= hudMask();\n#include <premultiplied_alpha_fragment>'); }
    sh.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => `cn-${+mask}${+addFog}${+neon}${fogK}`;
  return mat;
}

// 径向光晕（中心白 → 透明）
export function radialTex(util, px = 128) {
  return util.canvasTexture(px, px, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
}

// 湿地面倒影：v=0（画布底）= 灯脚下，亮度在 v≈0.5 处最高（镜面反射点比灯脚更靠近看的人），往 v=1 拖出长尾；横向两边软；夹几道水波纹
export function streakTex(util) {
  return util.canvasTexture(64, 256, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = 1 - y / h, u = Math.abs(x / (w - 1) * 2 - 1);
      const a = (0.35 + 0.65 * Math.min(1, v / 0.5)) * Math.pow(1 - Math.max(0, v - 0.5) / 0.5, 1.2) * Math.pow(1 - u * u, 1.5) * (0.65 + 0.35 * Math.sin(y * 0.9 + Math.sin(y * 0.13) * 3));
      const k = (y * w + x) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = Math.max(0, Math.min(255, a * 255));
    }
    g.putImageData(img, 0, 0);
  });
}

// ry（rotation.y）→ 物体局部 +X / +Z 的世界方向
export const axisX = (ry, out = new THREE.Vector3()) => out.set(Math.cos(ry), 0, -Math.sin(ry));
export const axisZ = (ry, out = new THREE.Vector3()) => out.set(Math.sin(ry), 0, Math.cos(ry));
export const UP = new THREE.Vector3(0, 1, 0);

// 关键帧 HUD 避让：按引擎 follow 镜头的公式（game/camera.js）摆出 pos 处的相机，看一块招牌（中心 c、半宽向量 ax、半高 hh）
//   投到 1920×1080 上（裁到屏幕内）有没有三成以上压进 HUD 面板（HUD_BOXES 同 hudMask）。ponytail: 只算静态关键帧，不跟实时镜头；引擎镜头公式改了要同步
const HUD_BOXES = [[0, 0, 395, 205], [690, 0, 1230, 170], [1575, 0, 1920, 200], [0, 885, 500, 1080], [1565, 825, 1920, 1080]];
export function hudProbe(route, rig, poses) {
  const F = rig.follow, cams = poses.map(p => {
    const s = p + 0.4, a = route.at(s, 0.35), k = a.kind || 'flat', stairs = k.startsWith('stairs'), up = k === 'up' || k === 'stairs_up';
    const back = stairs ? F.backStairs : F.back, cam = new THREE.PerspectiveCamera(52, 16 / 9, 0.1, 1200);
    cam.position.copy(a.pos).addScaledVector(a.dir, -back).addScaledVector(a.left, stairs ? F.sideStairs : F.side);
    cam.position.y += F.height + (up ? F.upBonus : 0) + (stairs ? F.stairsBonus : 0);
    cam.position.y = Math.max(cam.position.y, route.heightAt(s - back / 0.5) + F.clear);
    const look = a.pos.clone().addScaledVector(a.dir, F.ahead);
    look.y += F.lookY + (up ? F.lookUp : 0) + (route.heightAt(s + F.ahead / 0.5) - route.heightAt(s)) * F.slopeLook;
    cam.lookAt(look); cam.updateMatrixWorld(); return cam;
  });
  const v = new THREE.Vector3();
  return (c, ax, hh) => cams.some(cam => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, behind = false;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      v.copy(c).addScaledVector(ax, sx); v.y += sy * hh; v.project(cam);
      if (v.z > 1) behind = true;
      const x = (v.x + 1) * 960, y = (1 - v.y) * 540; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    if (behind) return false;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(1920, x1); y1 = Math.min(1080, y1);
    const area = (x1 - x0) * (y1 - y0);
    if (area <= 0) return false;
    const inHud = HUD_BOXES.reduce((t, b) => t + Math.max(0, Math.min(x1, b[2]) - Math.max(x0, b[0])) * Math.max(0, Math.min(y1, b[3]) - Math.max(y0, b[1])), 0);
    return inHud / area > 0.3;                                   // 三成以上压在面板后面才算（擦个边交给 hudMask 的羽化）
  });
}
