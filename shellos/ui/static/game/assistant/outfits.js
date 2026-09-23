// J 线 · 助理的穿搭。接口同 P 线 fengge/outfits.js：{ name, uniforms, glsl（片元里的 fit(reg, t, h, ang, side)）, inflate(reg, t) }。
//   body.js 的部位：reg 0 躯干 1 上臂 2 前臂 3 大腿 4 小腿 5 鞋 6 脖子；h = 离髋关节多高（米）；ang.x = 朝前，ang.y = 往外（躯干是往左）。
//   全身都穿着（登山服），不露。外骨骼只有峰哥穿，她不穿。
import * as THREE from 'three';

const col = c => ({ value: new THREE.Color(c) });
const LIB = `
float band(float x, float a, float b) { return step(a, x) * step(x, b); }
`;

// 第 1 轮基础款：修身软壳（钴蓝 + 白拼色，三人区分色见 style.js）+ 深色登山裤 + 浅色登山鞋
const base = {
  name: 'asst-base',
  uniforms: { uMain: col('#2f7fe0'), uTrim: col('#eef3f8'), uPants: col('#27344c'), uShoe: col('#e4e8ee'), uSole: col('#8d96a1'),
    uNeck: col('#eef3f8'), uSpan: { value: 0.45 }, uHip: { value: 0.7 } },
  inflate: (reg, t) => [0.008, 0.006, 0.005, 0.004, 0.004, 0, 0][reg] || 0,
  glsl: LIB + `
vec3 fit(float reg, float t, float h, vec2 ang, float side) {
  if (reg == 0.0) {
    if (h < -0.02) return uPants;
    if (h < 0.012) return uTrim;                                 // 腰带
    vec3 c = uMain;
    if (ang.x > 0.3 && abs(ang.y) < 0.03) c = uTrim;             // 前襟拉链
    if (h > uSpan - 0.05 && abs(ang.y) > 0.55) c = uTrim;        // 肩部拼色
    return c;
  }
  if (reg == 6.0) return uNeck;                                  // 立领
  if (reg == 1.0) return uMain;
  if (reg == 2.0) return t > 0.82 ? uTrim : uMain;               // 袖口
  if (reg == 3.0 || reg == 4.0) return uPants;
  if (reg == 5.0) return ang.x < -0.45 ? uSole : uShoe;
  return uMain;
}`,
};

export const OUTFITS = { base };
export function outfitFor() { return OUTFITS.base; }
