// 山涧（梧桐山的泰山涧一类小溪）：从左侧山坡流下来，从路面下的石涵洞穿过去，在右侧陡坡上跌成一串小瀑布，
//   流进右边山谷。一条贴地的水带（顺流滚动的白沫贴图 = 会动），1 次绘制。（试过路两沿各摆一块涵洞石：正面镜头里像两块悬空的板，去掉了）
import * as THREE from 'three';
import { ROAD_W } from '../../path.js';

export function buildStream(scene, ctx, hAt, ctrl) {   // ctrl = [[s, lat], …] 从上游到下游的控制点
  const { route, util } = ctx, pts = [];
  const P = ctrl.map(([s, lat]) => route.at(s, lat).pos.clone());
  const curve = new THREE.CatmullRomCurve3(P), nSeg = Math.ceil(curve.getLength() / 0.3);   // 过控制点的平滑曲线，每 0.3 一段
  for (let i = 0; i <= nSeg; i++) pts.push(curve.getPoint(i / nSeg));
  const W = 1.25, pos = [], uv = [], idx = [], hw = ROAD_W / 2 + 0.15;
  let v = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
    const t = new THREE.Vector3().subVectors(q, o).setY(0).normalize(), n = new THREE.Vector3(t.z, 0, -t.x);
    if (i) v += p.distanceTo(pts[i - 1]);
    for (const sg of [-1, 1]) {
      const x = p.x + n.x * W / 2 * sg, z = p.z + n.z * W / 2 * sg, nr = util.nearestRoute(route, x, z);
      const y = nr.d < hw ? nr.y - 0.25 : hAt(x, z) + 0.07;   // 路面下（涵洞里）压低，别从路面冒出来
      pos.push(x, y, z); uv.push(sg > 0 ? 1 : 0, v / 1.6);
    }
    if (i) { const b = (i - 1) * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const tex = util.canvasTexture(64, 256, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#7fbcb4'); gr.addColorStop(0.5, '#c4ece6'); gr.addColorStop(1, '#7fbcb4');
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    for (let k = 0; k < 70; k++) { const x = ctx.rand() * w, y = ctx.rand() * h, l = 8 + ctx.rand() * 26; c.fillStyle = `rgba(255,255,255,${0.35 + ctx.rand() * 0.5})`; c.fillRect(x, y, 2 + ctx.rand() * 3, l); }   // 顺流的白沫
  }, { repeat: true });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const m = new THREE.Mesh(g, mat); m.name = 'stream'; m.renderOrder = 1; scene.add(m);
  return { update: dt => { tex.offset.y -= dt * 0.9; } };
}
