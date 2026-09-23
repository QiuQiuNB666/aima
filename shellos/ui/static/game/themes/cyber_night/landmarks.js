// 认得出的真地标：涩谷站前的忠犬ハチ公铜像（开场帧左侧人行道、面朝走过来的人）、天桥脚下的蓝色桥名牌、
//   爱宕神社「出世の石段」石柱（大鸟居右柱外）。都不吃光（紫色环境光会把铜像染成塑料紫），明暗按朝向烘进顶点色。
import * as THREE from 'three';

// 顶点色 × 朝向明暗（上亮、朝镜头一侧亮）
function bake(geo, lo = 0.55) {
  const n = geo.attributes.normal, c = geo.attributes.color;
  for (let k = 0; k < c.count; k++) { const f = lo + (1 - lo) * Math.max(0, n.getY(k) * 0.75 + n.getX(k) * -0.35 + n.getZ(k) * 0.25 + 0.2); c.setXYZ(k, c.getX(k) * f, c.getY(k) * f, c.getZ(k) * f); }
  return geo;
}

// 坐着的秋田犬（ハチ公）：局部 −x = 狗脸朝向，y 向上，站在 y=0；高约 0.62
function hachiko(util, y0) {
  const B = (x, y, z) => new THREE.BoxGeometry(x, y, z), BR = '#5e5238', parts = [];
  const put = (geo, x, y, z, rz = 0) => { if (rz) geo.rotateZ(-rz); parts.push({ geo, p: [-x, y0 + y, z], color: BR }); };
  put(B(0.4, 0.24, 0.2), 0.0, 0.2, 0, 0.55);                       // 躯干（坐姿，胸口抬起）
  put(B(0.24, 0.2, 0.25), -0.13, 0.1, 0);                          // 后腿 / 臀
  for (const z of [-0.06, 0.06]) put(B(0.06, 0.27, 0.06), 0.15, 0.135, z);   // 前腿
  put(B(0.13, 0.2, 0.15), 0.19, 0.38, 0, -0.35);                   // 脖子
  put(B(0.19, 0.15, 0.16), 0.24, 0.5, 0);                          // 头
  put(B(0.12, 0.08, 0.1), 0.36, 0.47, 0);                          // 嘴
  for (const z of [-0.05, 0.05]) put(new THREE.ConeGeometry(0.035, 0.09, 4), 0.22, 0.61, z);   // 立耳
  const tail = new THREE.TorusGeometry(0.055, 0.022, 6, 10); tail.rotateY(Math.PI / 2);
  parts.push({ geo: tail, p: [0.21, y0 + 0.27, 0], color: BR });  // 卷尾
  return parts;
}

export function buildLandmarks(scene, ctx) {
  const { route, util } = ctx, gy = (x, z) => util.nearestRoute(route, x, z).y - 0.06;
  const place = (obj, s, lat, face = 0) => {          // 局部 +x = 行进方向，face 再绕 y 转
    const a = route.at(s, lat); obj.position.set(a.pos.x, gy(a.pos.x, a.pos.z), a.pos.z); obj.rotation.y = -a.heading + face; scene.add(obj); return obj;
  };
  const stoneMat = new THREE.MeshBasicMaterial({ vertexColors: true });

  // ---- ハチ公：花岗岩底座 0.8 × 0.55 + 铜像，底座朝来路那面嵌铭牌 ----
  {
    const g = new THREE.Group(); g.name = 'hachiko';
    const parts = [{ geo: new THREE.BoxGeometry(0.8, 0.55, 0.46), p: [0, 0.275, 0], color: '#6e6b66' },
      { geo: new THREE.BoxGeometry(0.88, 0.08, 0.54), p: [0, 0.04, 0], color: '#575550' }, ...hachiko(util, 0.55)];
    g.add(new THREE.Mesh(bake(util.merged(parts)), stoneMat));
    const plate = util.textPlane('忠犬ハチ公', 0.13, { color: '#f3e6c4', bg: '#3a3226', border: '#b89a5a', weight: 900 });
    plate.position.set(-0.405, 0.33, 0); plate.rotation.y = -Math.PI / 2; g.add(plate);
    place(g, 3.2, 3.5);                      // 离路 3.5：镜头（路左 1.75）走过时不从头顶擦过
  }

  // ---- 歩道橋の橋名板：天桥脚下右侧，蓝底白字（日本歩道橋的标准样式），正对走过来的人 ----
  const bridge = route.segs.find(q => q.kind === 'stairs_up');
  if (bridge) {
    const g = new THREE.Group(); g.name = 'bridgePlate';
    g.add(new THREE.Mesh(bake(util.merged([{ geo: new THREE.CylinderGeometry(0.035, 0.04, 2.1, 6), p: [0, 1.05, 0], color: '#9aa0ac' }])), stoneMat));
    const plate = ctx.kit.sign2(util, '渋谷駅前歩道橋', 0.3, { color: '#ffffff', bg: '#1f55b0', border: '#ffffff', weight: 800 });
    plate.position.set(-0.05, 1.85, 0); plate.rotation.y = -Math.PI / 2; g.add(plate);
    place(g, bridge.start - 0.6, -1.75);
  }

  // ---- 出世の石段：大鸟居右柱外的花岗岩石柱（高 1.7），竖刻黑字，正对走过来的人 ----
  const shrine = route.segs.filter(q => q.kind === 'stairs_up').pop();
  if (shrine && shrine !== bridge) {
    const g = new THREE.Group(); g.name = 'shusseStone';
    g.add(new THREE.Mesh(bake(util.merged([{ geo: new THREE.BoxGeometry(0.34, 1.7, 0.34), p: [0, 0.85, 0], color: '#a7a399' },
      { geo: new THREE.BoxGeometry(0.5, 0.12, 0.5), p: [0, 0.06, 0], color: '#77736b' }]), 0.6), stoneMat));
    const t = util.textPlane('出世の石段', 1.25, { vertical: true, color: '#1d1a17', bg: '#b9b5aa', weight: 900 });
    t.position.set(-0.175, 0.95, 0); t.rotation.y = -Math.PI / 2; g.add(t);
    place(g, shrine.start - 1.2, -1.45);     // 鸟居右柱前、路沿外：再往外会被右侧商铺挡住
  }
}
