// ART 线：全作品统一的美术常量（规范正文见 docs/美术范式.md）。游戏、HUD、跑酷都直接 import 这里的值，别再各写一份。
//   不 import three：纯数据，node / 跑酷 / HUD 都能用。颜色都是 sRGB 十六进制（THREE.Color 直接吃）。
//   改这里的值 = 改全作品，先在指挥板上和 ART 线说一声。

// 路段色：全局唯一，主题不许改（3D 里的台阶沿条 / 坡道箭头 / 路段门 / HUD 路段标签 / 力曲线都用它）。台阶上下同色，方向用 ▲▼ 表示
export const SEG = { up: '#3ddc84', stairs_up: '#ffd54f', stairs_down: '#ffd54f', down: '#4fc3f7', wait: '#ff4d4f', flat: '#8a95a3' };

// 三个人一眼分开：峰哥 = 实体 + 暖轮廓 + 琥珀外骨骼；影子 = 半透明冰青；捷风 = 实体钴蓝 + 白发 + 风白拖尾
export const WHO = {
  fengge: { exo: '#ffb03a', rim: '#ffd9a8', rimK: [0.9, 1.3], tag: '#ffb03a' },
  ghost: { color: '#bff3ff', bright: '#12b5a5', opacity: [0.4, 0.6], tag: '#9fe8ff' },   // bright = 雪地 / 白天高亮场景用的深青（偏绿，避开下坡蓝和捷风蓝；不许换成蓝）
  jett: { coat: '#2f7fe0', hair: '#eef3f8', wind: '#eaf2ff', rim: '#f2f6ff', tag: '#2f7fe0' },
};

// HUD：强调色全局固定（霓虹紫），不再跟主题 accent 走——主题 accent 会撞路段色（泰山黄 = 台阶、训练场蓝 = 下坡、梧桐青绿 = 上坡）；
//   也不用峰哥琥珀：琥珀和台阶黄色相只差 10°，放在同一块面板里分不清。琥珀只给峰哥本人（外骨骼、头像框、气泡）
export const UI = {
  fg: '#f4f7fa', dim: '#a9b3bf', panel: 'rgba(8,10,16,.86)', line: 'rgba(255,255,255,.12)', radius: '1rem', pad: '.8rem 1.1rem',
  acc: '#b48cff', ok: SEG.up, warn: '#ff9f1a', danger: SEG.wait,   // 状态色（AI 卡生效 / 裁剪 / 否决、安全灯）；提议之类的中性标签用 acc，别用蓝（撞下坡）
  font: '-apple-system,"PingFang SC","Hiragino Sans GB","Noto Sans CJK SC",sans-serif',
};

// 字号层级（rem；html{font-size:clamp(13px,1.04vw,44px)}，1080p 下 1rem = 20px）。大屏 3 米外最小 caption，再小的只给调试行
export const TYPE = { display: 5, hero: 3.4, h1: 2.5, h2: 1.7, body: 1.3, small: 1.0, caption: 0.85 };

// 动效节奏（秒）。闪烁一律 ≤ 2 Hz，整屏闪一次都不行
export const MOTION = { fast: 0.15, base: 0.35, slow: 0.8, stagger: 0.65, hold: 4.5, summitHold: 8, blinkMaxHz: 2, camMaxRadPerS: 1.0 };

// 光照上下限（lighting.js PRESET 要落在这里面）；fogNearMin = 雾起点（世界单位）不小于镜头到化身的距离（身后 4.6、左 1.4 ≈ 4.8）+ 余量，人不能被雾吃
export const LIGHT = { exp: [0.75, 1.25], bloomStrength: [0.2, 0.8], bloomThrMin: 0.9, sat: [1.0, 1.12], vigMax: 0.4, fogNearMin: 6 };

// 材质：大面积自发光上限、反射上限、人物自发光打底
export const MAT = { emissiveBigMax: 0.35, reflectMax: 0.55, selfGlow: [0.2, 0.3], rimPow: 3 };

// 每张图的主色 / 辅色 / 强调色（强调色只用在道具、招牌、天光；路段标记一律用 SEG）
export const PALETTE = {
  cyber_night: { main: '#1a0b2e', sub: '#2a2f3d', accent: ['#ff2e88', '#29e7ff'] },     // 东京：深紫夜 / 湿钢灰 / 霓虹品红 + 霓虹青
  dawn_mountain: { main: '#8a8478', sub: '#f6c177', accent: ['#c0392b'] },             // 泰山：花岗岩灰 / 拂晓金 / 朱红
  night_to_dawn: { main: '#5a3b2e', sub: '#1a1f4a', accent: ['#ff8a3d'] },             // 富士：火山褐 / 夜蓝紫 / 御来光橙
  subtropical: { main: '#3f6b3a', sub: '#bfe3f2', accent: ['#f29cc0'] },               // 梧桐：林绿 / 天青 / 毛棉杜鹃粉
  snow_summit: { main: '#e8eef5', sub: '#1447a2', accent: ['#d7342b'] },               // 珠峰：雪白 / 高空蓝 / 觇标经幡红
  grid: { main: '#141a22', sub: '#3b5a78', accent: ['#5fd3ff'] },                      // 训练场：深蓝灰 / 网格蓝 / 发光青（路段色本身就是主角）
  parkour: { main: '#1a1238', sub: '#2a2f3a', accent: ['#ff2e88', '#ffe9c4'] },        // 跑酷：夜紫 / 楼灰 / 品红 + 月光
};

// 把上面的值写成 CSS 变量（--seg-up、--who-ghost、--ui-acc …），game.html / parkour.html 的样式直接 var(--seg-up)
export function applyCssVars(root = document.documentElement) {
  const set = (k, v) => root.style.setProperty(k, v);
  for (const [k, v] of Object.entries(SEG)) set(`--seg-${k.replace('_', '-')}`, v);
  for (const [who, o] of Object.entries(WHO)) set(`--who-${who}`, o.tag);
  for (const k of ['fg', 'dim', 'panel', 'line', 'acc', 'ok', 'warn', 'danger']) set(`--${k === 'acc' ? 'acc' : 'ui-' + k}`, UI[k]);
}
