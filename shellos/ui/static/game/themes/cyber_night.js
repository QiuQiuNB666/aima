// 赛博东京·夜行 —— 基础版：夜空渐变 + 紫雾 + 暗地面 + 远处楼群剪影（少量霓虹条）。
// 精细地图（霓虹招牌、自动售货机、鸟居、雨）下一轮只改这个文件。
export function build(scene, ctx) {
  const { THREE, theme, kit, lights, route } = ctx;
  kit.sky(scene, theme.sky[0], theme.sky[1]);
  kit.fog(scene, theme.fog, 10, 75);
  lights.hemi.color.set('#6a5cff'); lights.hemi.groundColor.set('#1a0b2e'); lights.hemi.intensity = 1.1;
  lights.sun.color.set('#ff7ad0'); lights.sun.intensity = 0.8;
  kit.terrain(ctx, { amp: 0, rough: 0, reach: 4 });
  // 楼群：沿路两侧 8–40 单位外的一排方块（InstancedMesh，一次绘制）
  const n = 140, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#0d0f1c' }), n);
  const neon = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#ffffff' }), n);
  const acc = theme.accent.map(c => new THREE.Color(c));
  for (let i = 0; i < n; i++) {
    const sgn = i % 2 ? 1 : -1, sAlong = ctx.rand() * (route.N + 24) - 12, a = route.at(sAlong);
    const off = 6 + ctx.rand() * 30, w = 2 + ctx.rand() * 4, h = 4 + ctx.rand() * ctx.rand() * 30;
    p.copy(a.pos).addScaledVector(a.left, sgn * (off + w / 2)); p.y = a.pos.y + h / 2 - 0.1;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a.heading); s.set(w, h, w);
    blocks.setMatrixAt(i, m4.compose(p, q, s));
    p.y = a.pos.y + h * (0.3 + 0.6 * ctx.rand()); s.set(w * 1.02, 0.12, w * 1.02);
    neon.setMatrixAt(i, m4.compose(p, q, s)); neon.setColorAt(i, acc[i % acc.length]);
  }
  neon.instanceColor.needsUpdate = true;
  scene.add(blocks, neon);
}
export function update(dt, st) {}
