// 泰山·十八盘 —— 基础版：晨光渐变 + 淡雾 + 山体高度场 + 远山两层剪影。
// 精细地图（松、南天门、云海）下一轮只改这个文件。
export function build(scene, ctx) {
  const { theme, kit, lights } = ctx;
  kit.sky(scene, theme.sky[0], theme.sky[1], { exponent: 0.6 });
  kit.fog(scene, theme.fog, 18, 110);
  lights.hemi.color.set('#fff1d6'); lights.hemi.groundColor.set('#55604a'); lights.hemi.intensity = 1.3;
  lights.sun.color.set('#ffd9a0'); lights.sun.intensity = 1.5;
  kit.terrain(ctx, { amp: 9, drop: 0.9, rough: 1.4, reach: 16, seed: 3 });
  kit.ridge(ctx, { color: kit.mixHex(theme.fog, theme.sky[1], 0.35), radius: 150, height: 30, seed: 2 });
  kit.ridge(ctx, { color: kit.mixHex(theme.fog, theme.sky[1], 0.7), radius: 200, height: 45, seed: 7 });
}
export function update(dt, st) {}
