// P 线：峰哥的穿搭。outfit = { name, uniforms（颜色）, glsl（片元里的 fit()：按部位 / 位置 / 朝向给颜色）, inflate(reg, t)（衣服蓬度，米）}。
//   body.js 的顶点属性：reg 0 躯干 1 上臂 2 前臂 3 大腿 4 小腿 5 鞋 6 脖子；t = 沿这一段 0..1（躯干从裆到脖子、四肢从近端到远端、鞋从脚跟到脚尖）；
//   h = 离髋关节多高（米，静止姿态）；ang = 朝向（x = 前，y = 往外 / 躯干是往左；鞋是 x = 朝上）；side +1 左 −1 右。
// 换装只看 theme.style（第 2 轮每个主题一套）；engine.js 不传主题，所以 outfitFor() 按引擎同样的规则自己找当前世界（预览看 ?preview=，实机读 /state）。
//   ?outfit=<style 或穿搭名> 临时换（截图用）。
import * as THREE from 'three';

const col = c => ({ value: new THREE.Color(c) });

// 通用小工具（拼进每套穿搭的 GLSL 前面）
const LIB = `
float band(float x, float a, float b) { return step(a, x) * step(x, b); }
`;

// 第 1 轮基础款 = 球球挑的冲锋衣（橙红偏砖 + 炭灰拼色）+ 炭灰冲锋裤 + 登山鞋
const base = {
  name: 'base',
  uniforms: { uMain: col('#b0472c'), uTrim: col('#33363b'), uZip: col('#141517'), uPants: col('#2b2e33'), uKnee: col('#3a3e45'),
    uShoe: col('#4a4038'), uSole: col('#9b948a'), uNeck: col('#1e1f22'), uSpan: { value: 0.45 }, uHip: { value: 0.7 } },
  inflate: (reg, t) => [0.012, 0.009, 0.007, 0.006, 0.005, 0, 0][reg] || 0,
  glsl: LIB + `
vec3 fit(float reg, float t, float h, vec2 ang, float side) {
  vec3 c = uMain;
  if (reg == 0.0) {                                    // 躯干：冲锋衣（下摆盖到髋关节下面一点，外骨骼腰带扣在外面）
    if (h < -0.03) return uPants;
    if (h < 0.01) c = uTrim;                           // 下摆收边
    if (h > uSpan - 0.015 && ang.x < 0.75) c = uTrim;  // 肩背补强
    float lat = 0.16 - 0.3 * clamp((h + 0.03) / (uSpan + 0.1), 0.0, 1.0);   // 前襟斜拉链：领口偏左 → 下摆偏右
    if (ang.x > 0.2 && abs(ang.y - lat) < 0.07 && h > -0.03) c = uTrim;     // 防风门襟
    if (ang.x > 0.2 && abs(ang.y - lat) < 0.022 && h > -0.03) c = uZip;
    if (ang.x > 0.3 && band(h, uSpan - 0.14, uSpan - 0.1) > 0.0 && band(ang.y, 0.3, 0.6) > 0.0 && abs(ang.y - 0.3 - (uSpan - 0.1 - h) * 7.0) < 0.05) c = uZip;   // 胸袋拉链
    return c;
  }
  if (reg == 6.0) return uNeck;
  if (reg == 1.0) { if (t < 0.2 && ang.x < 0.4) c = uTrim; if (t > 0.86 && ang.x < -0.1) c = uTrim; return c; }   // 上臂：肩头 / 肘后补强
  if (reg == 2.0) { if (t < 0.12 && ang.x < -0.1) c = uTrim; if (t > 0.82) c = uTrim; if (t > 0.84 && t < 0.95 && ang.y > 0.5) c = uTrim * 1.6; return c; }   // 前臂：肘后 / 袖口 + 魔术贴
  if (reg == 3.0) { c = uPants; if (t > 0.84 && ang.x > 0.3) c = uKnee; return c; }
  if (reg == 4.0) { c = uPants; if (t < 0.14 && ang.x > 0.3) c = uKnee; if (t > 0.9) c = uPants * 0.8; return c; }
  if (reg == 5.0) { c = uShoe; if (ang.x < -0.55 || h < 0.014 - uHip) c = uSole; return c; }
  return c;
}`,
};

export const OUTFITS = { base };
// theme.style → 穿搭名（第 2 轮一个主题一套；还没做的先穿基础款）
export const BY_STYLE = {};

let styleP = null;
function themeStyle() {                                   // 和 engine.js main() 选世界的规则一样
  return styleP || (styleP = (async () => {
    const q = new URLSearchParams(location.search);
    const worlds = await fetch('/worlds.json').then(r => r.json()).catch(() => []);
    let id = q.get('preview');
    if (!id) {
      const s = await fetch('/state').then(r => r.json()).catch(() => null);
      if (s && s.terrain && !s.terrain.preset && s.terrain.world) return (s.terrain.world.theme || {}).style || 'grid';
      id = s && s.terrain ? s.terrain.preset : 'everest_north';
    }
    const w = worlds.find(x => x.id === id) || worlds.find(x => x.id === 'everest_north') || worlds[0];
    return (w && w.theme && w.theme.style) || 'grid';
  })());
}

export async function outfitFor() {
  const o = new URLSearchParams(location.search).get('outfit');
  if (o && OUTFITS[o]) return OUTFITS[o];
  const style = o || await themeStyle();
  return OUTFITS[BY_STYLE[style]] || base;
}
