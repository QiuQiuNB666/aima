// P 线：远档减面（给 J 的捷风雕像用；峰哥头的远档是直接按低分辨率造的，不走这里）。
// simplify(geo, cell)：顶点聚类——按 cell（米）的格子把顶点并成一个（位置 / 顶点色取格内平均），去掉塌成线的和重复的三角形，法线重算。
//   粗，但几米外看不出来；O(n)，4.4 万三角的雕像几十毫秒。只认 position（+ color），有没有 index 都行。
//   不 import three：新几何用传进来那个的构造函数造（node 里也能跑，tests/test_game_lod.py）。
// 用法（J）：const lo = new THREE.Mesh(simplify(geo, 0.02), mesh.material);
//   const lod = new THREE.LOD(); lod.addLevel(mesh, 0); lod.addLevel(lo, 4, 0.1);   // 离镜头 4 m 外换远档，10% 回差防来回跳
export function simplify(geo, cell) {
  const P = geo.attributes.position, C = geo.attributes.color, n = P.count;
  const ids = new Map(), rep = new Int32Array(n), sum = [], cnt = [];
  for (let i = 0; i < n; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), key = `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    let id = ids.get(key);
    if (id === undefined) { id = cnt.length; ids.set(key, id); cnt.push(0); sum.push(0, 0, 0, 0, 0, 0); }
    rep[i] = id; cnt[id]++;
    const s = id * 6; sum[s] += x; sum[s + 1] += y; sum[s + 2] += z;
    if (C) { sum[s + 3] += C.getX(i); sum[s + 4] += C.getY(i); sum[s + 5] += C.getZ(i); }
  }
  const m = cnt.length, pos = new Float32Array(m * 3), col = C ? new Float32Array(m * 3) : null;
  for (let id = 0; id < m; id++) for (let k = 0; k < 3; k++) {
    pos[id * 3 + k] = sum[id * 6 + k] / cnt[id];
    if (col) col[id * 3 + k] = sum[id * 6 + 3 + k] / cnt[id];
  }
  const src = geo.index ? geo.index.array : null, tris = [], seen = new Set();
  for (let t = 0, T = src ? src.length : n; t < T; t += 3) {
    const a = rep[src ? src[t] : t], b = rep[src ? src[t + 1] : t + 1], c = rep[src ? src[t + 2] : t + 2];
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((u, v) => u - v).join(',');
    if (seen.has(key)) continue;
    seen.add(key); tris.push(a, b, c);
  }
  const out = new geo.constructor();
  out.setAttribute('position', new P.constructor(pos, 3));
  if (col) out.setAttribute('color', new C.constructor(col, 3));
  out.setIndex(tris); out.computeVertexNormals(); out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}
