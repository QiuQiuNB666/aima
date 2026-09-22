// 深圳梧桐山·好汉坡 —— 基础版：浅蓝天 + 湿雾 + 绿色山体 + 远山剪影。
// 精细地图（榕树、城市天际线、山雾）下一轮只改这个文件。
export function build(scene, ctx) {
  const { theme, kit, lights } = ctx;
  kit.sky(scene, theme.sky[0], theme.sky[1], { exponent: 0.7 });
  kit.fog(scene, theme.fog, 14, 90);
  lights.hemi.color.set('#e8f6ff'); lights.hemi.groundColor.set('#2f4a2c'); lights.hemi.intensity = 1.35;
  lights.sun.color.set('#fff6e0'); lights.sun.intensity = 1.3;
  kit.terrain(ctx, { amp: 8, drop: 0.85, rough: 1.6, reach: 15, seed: 21 });
  kit.ridge(ctx, { color: kit.mixHex(theme.fog, '#6f8f7a', 0.35), radius: 150, height: 24, seed: 9 });
}
export function update(dt, st) {}
