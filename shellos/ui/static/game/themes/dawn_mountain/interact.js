// 泰山的场景互动（只看化身位置 st.s / 登顶 st.summit；只动画面和音效）：
//   ① 挑山工：化身爬慢十八时，一个挑着扁担的挑山工从前面台阶上下来，擦肩而过时头上冒一句「加油！」——3 次绘制（人 / 两条腿 / 字）
//   ② 摩崖石刻路过时发金光：化身走到哪块字前后 2.5 步，那块字叠一层金色加色字，亮起再慢慢收——同时最多 1–2 块在画
//   ③ 南天门：化身穿过门洞 / 登顶那一刻，钟响三声、城楼上惊起一群鸟——1 次绘制
import * as THREE from 'three';

export function buildInteract(scene, ctx, { carvings, gate, gateS }) {
  const { route, util, kit } = ctx, N = route.N, LOW = kit.LOW;

  // ---------- ① 挑山工 ----------
  const B = (x, y, z) => new THREE.BoxGeometry(x, y, z);
  const man = new THREE.Mesh(util.merged([                               // 本地 +x = 走的方向（下山）
    { geo: B(0.24, 0.55, 0.34), p: [0, 1.0, 0], color: '#4c5a6a' },       // 蓝灰褂子
    { geo: new THREE.SphereGeometry(0.12, 10, 8), p: [0.03, 1.42, 0], color: '#b98a64' },
    { geo: new THREE.CylinderGeometry(0.2, 0.2, 0.05, 12), p: [0.03, 1.55, 0], color: '#d9c38c' },   // 草帽檐
    { geo: new THREE.CylinderGeometry(0.03, 0.03, 1.9, 6).rotateZ(Math.PI / 2), p: [0, 1.3, 0.12], color: '#9a7a40' },   // 扁担（压在右肩，前后各伸出 0.95）
    ...[-0.85, 0.85].flatMap(x => [
      { geo: new THREE.CylinderGeometry(0.008, 0.008, 0.55, 4), p: [x, 1.02, 0.12], color: '#3a2e20' },   // 挑绳
      { geo: B(0.34, 0.3, 0.3), p: [x, 0.62, 0.12], color: x > 0 ? '#c9463a' : '#3f6fb0' },              // 货：一箱矿泉水、一袋粮
    ]),
    { geo: B(0.07, 0.42, 0.07), p: [0.05, 1.05, -0.2], color: '#4c5a6a' },  // 扶担的胳膊
  ]), new THREE.MeshLambertMaterial({ vertexColors: true }));
  man.name = 'porter'; man.visible = false; scene.add(man);
  const legs = new THREE.InstancedMesh(B(0.1, 0.72, 0.11).translate(0, -0.36, 0), new THREE.MeshLambertMaterial({ color: '#2a2e36' }), 2);
  legs.name = 'porterLegs'; legs.visible = false; legs.frustumCulled = false; scene.add(legs);
  const ct = util.textTexture('加油！', { size: 96, weight: 900, color: '#ffffff', bg: '#c9463a', pad: 0.3 });
  const cheer = new THREE.Sprite(new THREE.SpriteMaterial({ map: ct, depthWrite: false, toneMapped: false }));
  cheer.scale.set(0.42 * ct.userData.aspect, 0.42, 1); cheer.visible = false; cheer.name = 'porterCheer'; scene.add(cheer);
  const tight = route.segs.filter(q => q.kind === 'stairs_up'), S0 = tight.length ? tight[0].start : 8, S1 = tight.length > 1 ? tight[1].start + tight[1].steps : 24;
  const go = kit.edge();
  let ps = null, cheerT = 0, said = false;
  const at = {}, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), qa = new THREE.Quaternion(), Z = new THREE.Vector3(0, 0, 1), hip = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const porter = (dt, st) => {
    if (go(st.s > S0 - 1 && st.s < S1 - 6 && !st.summit)) { ps = Math.min(S1 + 2, st.s + 11); said = false; }   // 在化身前 11 步的台阶上出现
    if (ps === null) return;
    ps -= dt * 1.25;                                                      // 下山比上山快
    if (ps < st.s - 9 || ps < 0 || st.summit) { ps = null; man.visible = legs.visible = cheer.visible = false; return; }
    route.at(ps, -0.92, at);
    const bob = Math.abs(Math.sin(st.t * 5)) * 0.05, ry = -at.heading + Math.PI;   // 面朝下山
    man.position.set(at.pos.x, route.heightAt(ps) + bob, at.pos.z); man.rotation.set(0, ry, Math.sin(st.t * 5) * 0.04); man.visible = true;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    for (const [i, z] of [[0, 0.08], [1, -0.08]]) {
      hip.set(0, 0.72, z).applyQuaternion(q).add(man.position);
      qa.setFromAxisAngle(Z, Math.sin(st.t * 5 + i * Math.PI) * 0.45).premultiply(q);
      legs.setMatrixAt(i, m4.compose(hip, qa, one));
    }
    legs.instanceMatrix.needsUpdate = true; legs.visible = true;
    if (!said && ps - st.s < 2.5) { said = true; cheerT = 2.2; }           // 擦肩前一句「加油！」
    if (cheerT > 0) { cheerT -= dt; cheer.position.set(man.position.x, man.position.y + 2.0, man.position.z); cheer.material.opacity = Math.min(1, cheerT * 3); cheer.visible = cheerT > 0; }
  };

  // ---------- ② 石刻发金光 ----------
  const glows = (LOW ? [] : carvings).map(c => {
    const t = c.txt, m = util.textPlane(t.text, t.h, { vertical: t.vertical, weight: 900, pad: t.pad, font: t.font, color: '#ffd76a', glow: 0.9 });
    m.material.blending = THREE.AdditiveBlending; m.material.transparent = true; m.material.depthWrite = false; m.material.opacity = 0; m.material.side = THREE.FrontSide;
    const p = t.p.isVector3 ? t.p : new THREE.Vector3(...t.p);
    m.position.copy(p).add(new THREE.Vector3(Math.sin(t.ry), 0, Math.cos(t.ry)).multiplyScalar(0.03)); m.rotation.y = t.ry; m.visible = false; m.renderOrder = 2; m.name = 'carvingGlow';
    scene.add(m); return { m, s: c.s, k: 0 };
  });
  const glow = (dt, st) => {
    for (const g of glows) {
      const want = Math.abs(st.s - g.s) < 2.5 && !st.summit ? 1 : 0;
      g.k += (want - g.k) * Math.min(1, dt * (want ? 3 : 0.8));
      g.m.material.opacity = g.k * (0.75 + 0.25 * Math.sin(st.t * 3)); g.m.visible = g.k > 0.01;
    }
  };

  // ---------- ③ 南天门：钟声 + 惊鸟 ----------
  const birds = kit.birdBurst(ctx, { count: LOW ? 7 : 14, size: 0.6, color: '#2b2622', name: 'gateBirds', climb: 0.3 });
  const through = kit.edge(), top = kit.edge();
  let quiet = 0;
  const bell = (dt, st) => {
    quiet -= dt;
    const hit = through(st.s > gateS + 0.4 && st.s < N + 0.5) | top(st.summit);
    if (hit && quiet <= 0) {
      quiet = 8;                                                          // 穿门和登顶挨得近：8 s 内只响一次
      kit.sfx('bell', 0.9);
      const eave = route.at(gateS + 6, 2.0).pos; eave.y += 1.6;          // 从门后天街的屋檐上惊起（门楼顶在镜头头顶后面，拍不到）
      birds.fire(eave, gate.dir.clone().addScaledVector(gate.left, -0.8));   // 往右前方（云海那边）横着飞过画面
    }
    birds.update(dt);
  };

  return { update(dt, st) { porter(dt, st); glow(dt, st); bell(dt, st); } };
}
