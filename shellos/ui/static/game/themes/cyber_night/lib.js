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

// 加色发光材质（光晕、倒影、车灯拖尾）：不写深度、不吃雾（雾会把加色面染成一块块紫色方块）
export function glowMat(map, o = {}) {
  return new THREE.MeshBasicMaterial({ map, vertexColors: o.vertexColors ?? true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    fog: false, toneMapped: false, side: THREE.DoubleSide, opacity: o.opacity ?? 1, polygonOffset: !!o.ground, polygonOffsetFactor: o.ground ? -4 : 0, polygonOffsetUnits: o.ground ? -4 : 0 });
}

// 径向光晕（中心白 → 透明）
export function radialTex(util, px = 128) {
  return util.canvasTexture(px, px, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
}

// 湿地面倒影：v=0（画布底）最亮、往 v=1 渐隐；横向两边软；夹几道水波纹
export function streakTex(util) {
  return util.canvasTexture(64, 256, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = 1 - y / h, u = Math.abs(x / (w - 1) * 2 - 1);
      const a = Math.pow(1 - v, 1.6) * Math.pow(1 - u * u, 1.5) * (0.7 + 0.3 * Math.sin(y * 0.9 + Math.sin(y * 0.13) * 3));
      const k = (y * w + x) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = Math.max(0, Math.min(255, a * 255));
    }
    g.putImageData(img, 0, 0);
  });
}

// ry（rotation.y）→ 物体局部 +X / +Z 的世界方向
export const axisX = (ry, out = new THREE.Vector3()) => out.set(Math.cos(ry), 0, -Math.sin(ry));
export const axisZ = (ry, out = new THREE.Vector3()) => out.set(Math.sin(ry), 0, Math.cos(ry));
export const UP = new THREE.Vector3(0, 1, 0);
