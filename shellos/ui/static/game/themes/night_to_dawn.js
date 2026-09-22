// 富士山·吉田线夜登 —— 基础版：随爬升从星空过渡到日出（天空/雾/光照按进度插值）+ 火山砾地面 + 远山剪影 + 星星。
// 精细地图（头灯光带、山小屋、鸟居）下一轮只改这个文件。
let sky, stars, lights, THREE, kit, theme, ridgeMat, scene;
const NIGHT = { top: '#04061a', bottom: '#141634', fog: '#0c0e24' };
export function build(sc, ctx) {
  ({ THREE, kit, theme, lights } = ctx); scene = sc;
  sky = kit.sky(scene, NIGHT.top, NIGHT.bottom, { exponent: 0.55 });
  kit.fog(scene, NIGHT.fog, 14, 95);
  kit.terrain(ctx, { amp: 7, drop: 0.8, rough: 1.1, reach: 14, seed: 11 });
  ridgeMat = kit.ridge(ctx, { color: '#0a0b1c', radius: 160, height: 26, seed: 5 }).material;
  const n = 700, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = ctx.rand() * Math.PI * 2, e = 0.12 + ctx.rand() * 1.3, r = 400;
    pos.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, fog: false, transparent: true }));
  scene.add(stars);
  update(0, { progress: 0 });
}
export function update(dt, st) {
  const p = Math.max(0, Math.min(1, st.summit ? 1 : st.progress)), e = p * p * (3 - 2 * p);
  sky.uniforms.top.value.copy(kit.mixHex(NIGHT.top, '#3b4f86', e));
  sky.uniforms.bottom.value.copy(kit.mixHex(NIGHT.bottom, theme.sky[1], e));
  scene.fog.color.copy(kit.mixHex(NIGHT.fog, theme.fog, e));
  ridgeMat.color.copy(kit.mixHex('#0a0b1c', '#3a2c44', e));
  stars.material.opacity = 1 - e * 0.9;
  lights.hemi.intensity = 0.45 + 0.9 * e; lights.sun.intensity = 0.25 + 1.3 * e;
  lights.hemi.color.copy(kit.mixHex('#6f7bd8', '#ffd2a8', e)); lights.sun.color.copy(kit.mixHex('#9aa8ff', '#ffb070', e));
}
