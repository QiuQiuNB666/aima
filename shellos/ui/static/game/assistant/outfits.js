// J 线 · 助理的穿搭。接口同 P 线 fengge/outfits.js：{ name, uniforms, glsl（片元里的 fit(reg, t, h, ang, side)）, inflate(reg, t) }。
//   body.js 的部位：reg 0 躯干 1 上臂 2 前臂 3 大腿 4 小腿 5 鞋 6 脖子；h = 离髋关节多高（米）；ang.x = 朝前，ang.y = 往外（躯干是往左）。
// 全身都穿着（长袖长裤的登山服），不露。外骨骼只有峰哥穿。主色一律钴蓝 + 白（style.js 里「第三个人」的识别色，和峰哥的暖色 / 琥珀、
//   影子的冰青一眼分开），按 theme.style 换款式和辅色：珠峰连体羽绒服（横向绗缝、蓬、腰上攀登安全带、雪套）、东京机能风、泰山 / 华山轻徒步、
//   富士夜登保暖、梧桐山速干、训练场基础款。?outfit=<style 或款名> 临时换（截图用）。
import * as THREE from 'three';
import { WHO } from '../style.js';   // 第三个人的识别色：钴蓝 + 白（ART 的 WHO.jett；捷风换成助理后沿用这一格，已留言 ART 改名）
const CO = WHO.jett.coat, WH = WHO.jett.hair;

const col = c => ({ value: new THREE.Color(c) });

// 所有款共用一段 GLSL，差别全在颜色和几个开关（uQuilt 绗缝、uOne 连体）上
const GLSL = `
vec3 fit(float reg, float t, float h, vec2 ang, float side) {
  if (reg == 5.0) return ang.x < -0.45 ? uSole : uShoe;                    // 鞋：底 / 帮
  if (reg == 6.0) return uNeck;                                            // 领子
  vec3 c;
  if (reg == 0.0) {
    if (h < -0.02) c = uOne > 0.5 ? uMain : uPants;                        // 裆以下：连体就是一整件
    else if (h < 0.014) c = uBelt;                                         // 腰带 / 安全带
    else {
      c = uMain;
      if (ang.x > 0.3 && abs(ang.y) < 0.028) c = uTrim;                    // 前襟拉链
      if (h > uSpan - 0.06 && abs(ang.y) > 0.5) c = uTrim;                 // 肩部拼色
      if (abs(ang.y) > 0.92) c = uSide;                                    // 侧片
    }
    if (uQuilt > 0.5 && fract((h + 1.0) / 0.075) < 0.13) c *= 0.78;        // 羽绒服横向绗缝
    return c;
  }
  if (reg == 1.0 || reg == 2.0) {
    c = (reg == 2.0 && t > 0.84) ? uTrim : uMain;                          // 袖口
    if (reg == 1.0 && t < 0.3) c = mix(c, uTrim, step(0.0, h - uSpan + 0.06));
    if (uQuilt > 0.5 && fract(t * 5.0) < 0.13) c *= 0.78;
    return c;
  }
  c = uOne > 0.5 ? uMain : uPants;                                         // 腿
  if (uQuilt > 0.5 && fract(t * 5.0) < 0.13) c *= 0.78;
  if (reg == 4.0 && t > 0.72) c = uCuff;                                   // 雪套 / 裤脚收口
  if (reg == 3.0 && ang.y > 0.85 && t > 0.3 && t < 0.62) c = uSide;        // 大腿外侧口袋
  return c;
}`;

function suit(name, c, inflate, { quilt = 0, one = 0 } = {}) {
  return {
    name, glsl: GLSL, inflate: (reg, t) => inflate[reg] || 0,
    uniforms: { uMain: col(c.main), uTrim: col(c.trim), uSide: col(c.side || c.main), uPants: col(c.pants), uBelt: col(c.belt || c.trim),
      uCuff: col(c.cuff || c.pants), uShoe: col(c.shoe), uSole: col(c.sole), uNeck: col(c.neck || c.trim),
      uQuilt: { value: quilt }, uOne: { value: one }, uSpan: { value: 0.45 }, uHip: { value: 0.7 } },
  };
}
//                                              躯干   上臂   前臂   大腿   小腿   鞋     脖子
const FIT = [0.008, 0.006, 0.005, 0.004, 0.004, 0, 0.006];
export const OUTFITS = {
  base: suit('asst-base', { main: CO, trim: WH, pants: '#27344c', shoe: '#e4e8ee', sole: '#8d96a1' }, FIT),
  down: suit('asst-down', { main: CO, trim: WH, side: '#1d4f9a', belt: '#30343a', cuff: '#1c2230', shoe: '#e9edf2', sole: '#40454d', neck: WH, pants: CO },
    [0.03, 0.022, 0.018, 0.022, 0.02, 0.012, 0.024], { quilt: 1, one: 1 }),                          // 珠峰：连体羽绒服
  tech: suit('asst-tech', { main: '#1f2530', trim: CO, side: CO, pants: '#181c24', belt: CO, shoe: '#2a303a', sole: WH, neck: CO }, FIT),   // 东京：黑色机能风 + 钴蓝亮边
  hike: suit('asst-hike', { main: CO, trim: WH, pants: '#7a7466', cuff: '#5f5a50', shoe: '#6b5a4a', sole: '#3a342e' }, FIT),   // 泰山：轻徒步
  cliff: suit('asst-cliff', { main: WH, trim: CO, side: CO, pants: '#4a5058', shoe: '#3a3f46', sole: '#1e2126', neck: CO }, FIT),   // 华山：白色风衣 + 钴蓝
  warm: suit('asst-warm', { main: CO, trim: WH, side: '#1d4f9a', pants: '#252b36', shoe: '#e4e8ee', sole: '#5a616b' }, [0.018, 0.014, 0.011, 0.008, 0.007, 0.006, 0.014], { quilt: 1 }),   // 富士夜登：短款羽绒服
  quick: suit('asst-quick', { main: WH, trim: CO, side: CO, pants: CO, cuff: '#1d4f9a', shoe: WH, sole: CO, neck: WH }, [0.004, 0.003, 0.003, 0.003, 0.003, 0, 0.003]),   // 梧桐山：速干长袖
};
export const BY_STYLE = { snow_summit: 'down', cyber_night: 'tech', dawn_mountain: 'hike', cliff_path: 'cliff', night_to_dawn: 'warm', subtropical: 'quick', grid: 'base' };

let styleP = null;
function themeStyle() {                                   // 同 fengge/outfits.js（和 engine.js main() 选世界的规则一样）
  return styleP || (styleP = (async () => {
    const q = new URLSearchParams(location.search);
    const worlds = await fetch('/worlds.json').then(r => r.json()).catch(() => []);
    let id = q.get('preview');
    if (!id) {
      const s = await fetch('/state').then(r => r.json()).catch(() => null);
      if (s && s.terrain && !s.terrain.preset && s.terrain.world) return (s.terrain.world.theme || {}).style || 'grid';
      id = s && s.terrain ? s.terrain.preset : 'everest_north';
    }
    const w = worlds.find(x => x.id === id) || worlds[0];
    return (w && w.theme && w.theme.style) || 'grid';
  })());
}

export async function outfitFor() {
  const o = new URLSearchParams(location.search).get('outfit');
  if (o && OUTFITS[o]) return OUTFITS[o];
  return OUTFITS[BY_STYLE[o || await themeStyle()]] || OUTFITS.base;
}
