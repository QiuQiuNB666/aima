// 训练场 —— 干净网格：地面网格贴图，路堤贴着路，远处回到 0 高度；不加道具。
export function build(scene, ctx) {
  const { theme, kit, lights } = ctx;
  kit.sky(scene, theme.sky[0], theme.sky[1]);
  kit.fog(scene, theme.fog, 20, 90);
  lights.hemi.intensity = 1.4; lights.sun.intensity = 0.9;
  kit.terrain(ctx, { color: '#ffffff', flatTo: 0, reach: 3, map: kit.gridTexture(theme.path, theme.ground), uvScale: 1 });
}
export function update(dt, st) {}
