// 二维码：本地生成，不连任何外部服务。字节模式、纠错 M、版本 1–10 自动选（≤ 213 字节），8 种掩码按罚分挑最好的。
// 按 ISO/IEC 18004 写的，结构照 Nayuki 的 QR 参考实现（MIT）精简。qrSvg(文字) → <svg> 字符串（白底 + 4 格静区）。
const ECC = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];   // 纠错级 M：每块纠错码字数，下标 = 版本
const BLK = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];              // 块数
const MASK = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
  (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];

function mul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; }
function rsDiv(n) {
  const r = Array(n).fill(0); r[n - 1] = 1; let root = 1;
  for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) { r[j] = mul(r[j], root); if (j + 1 < n) r[j] ^= r[j + 1]; } root = mul(root, 2); }
  return r;
}
function rsRem(data, div) { const r = div.map(() => 0); for (const b of data) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mul(c, f); }); } return r; }
const rawBits = v => { let r = (16 * v + 128) * v + 64; if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; } return r; };
const alignPos = v => {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2, step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2, r = [6];
  for (let p = v * 4 + 10; r.length < n; p -= step) r.splice(1, 0, p);
  return r;
};
function penalty(M) {
  const n = M.length; let p = 0, dark = 0;
  for (let k = 0; k < n; k++) for (const line of [M[k], M.map(r => r[k])]) {
    let run = 1;
    for (let x = 1; x <= n; x++) { if (x < n && line[x] === line[x - 1]) run++; else { if (run >= 5) p += run - 2; run = 1; } }
    const s = line.map(b => b ? 1 : 0).join('');
    for (const pat of ['10111010000', '00001011101']) for (let i = s.indexOf(pat); i >= 0; i = s.indexOf(pat, i + 1)) p += 40;
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (M[y][x]) dark++;
    if (x < n - 1 && y < n - 1 && M[y][x] === M[y][x + 1] && M[y][x] === M[y + 1][x] && M[y][x] === M[y + 1][x + 1]) p += 3;
  }
  return p + (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10;
}

export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let v = 1, cap = 0;
  for (; v <= 10; v++) { cap = Math.floor(rawBits(v) / 8) - ECC[v] * BLK[v]; if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= cap * 8) break; }
  if (v > 10) throw new Error('二维码内容太长（> 版本 10）');
  const bits = [], put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16); for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap * 8 - bits.length)); while (bits.length % 8) bits.push(0);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let p = 0xec; data.length < cap; p ^= 0xec ^ 0x11) data.push(p);
  // 分块 + 纠错 + 交织
  const nb = BLK[v], ne = ECC[v], raw = Math.floor(rawBits(v) / 8), nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDiv(ne), blocks = [];
  for (let i = 0, k = 0; i < nb; i++) { const d = data.slice(k, k += shortLen - ne + (i < nShort ? 0 : 1)), e = rsRem(d, div); if (i < nShort) d.push(0); blocks.push(d.concat(e)); }
  const cw = []; for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - ne || j >= nShort) cw.push(b[i]); });
  // 功能图形
  const n = v * 4 + 17, M = [...Array(n)].map(() => Array(n).fill(false)), F = [...Array(n)].map(() => Array(n).fill(false));
  const set = (x, y, d) => { M[y][x] = d; F[y][x] = true; };
  for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
    if (x >= 0 && x < n && y >= 0 && y < n) set(x, y, d !== 2 && d !== 4);
  }
  const ap = alignPos(v), na = ap.length;
  for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  const fmt = mask => {                        // 格式信息：纠错级 M = 00
    let r = mask; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((mask << 10) | r) ^ 0x5412, g = i => ((b >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, g(i));
    set(8, 7, g(6)); set(8, 8, g(7)); set(7, 8, g(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, g(i));
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, g(i));
    for (let i = 8; i < 15; i++) set(8, n - 15 + i, g(i));
    set(8, n - 8, true);
  };
  fmt(0);
  if (v >= 7) {
    let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) { const d = ((b >>> i) & 1) === 1, a = n - 11 + i % 3, c = Math.floor(i / 3); set(a, c, d); set(c, a, d); }
  }
  // 数据：从右下角两列一组之字形往上 / 往下
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? n - 1 - vert : vert;
      if (!F[y][x] && i < cw.length * 8) { M[y][x] = ((cw[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }
  const apply = m => { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (!F[y][x] && MASK[m](x, y)) M[y][x] = !M[y][x]; };
  let best = 0, bestP = Infinity;
  for (let m = 0; m < 8; m++) { apply(m); fmt(m); const p = penalty(M); if (p < bestP) { bestP = p; best = m; } apply(m); }
  apply(best); fmt(best);
  return M;
}

export function qrSvg(text) {
  const M = qrMatrix(text), n = M.length;
  let d = ''; M.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x} ${y}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-4 -4 ${n + 8} ${n + 8}" shape-rendering="crispEdges"><rect x="-4" y="-4" width="${n + 8}" height="${n + 8}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
