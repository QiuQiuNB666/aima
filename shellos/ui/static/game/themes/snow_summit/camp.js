// 大本营村落（docs/珠峰-架构.md §2 ★新）：一整块静态合并几何（大穹顶帐篷、餐厅大帐、「珠穆朗玛峰大本营 海拔5200米」石碑、
//   玛尼堆、直升机停机坪 + 风向袋、晾衣绳；前进营地一串晾晒的睡袋）。= 1 次绘制（+ 阴影 1 次），约 5k 三角形；跟山下别的东西一起走过北坳就溶掉（lowVc / hideLow）。
//   位置全按 route.at(s, lat) 算（大本营 = 路线开头那段平地、前进营地 = zonesOf 的 abc），不写死坐标。
//   返回 { meshes, pad（停机坪面中心，世界坐标）, blockers（[{x, z, r}]，路边随机帐篷避开这些） }
import * as THREE from 'three';

const Y = new THREE.Vector3(0, 1, 0);

// 带噪声的粗石块（非索引、面法线 = 低多边形哑光）：box 尺寸 w×h×d，中心在底面
function roughStone(kit, w, h, d, seed = 1, amp = 0.08) {
  const g = new THREE.BoxGeometry(w, h, d, 5, 3, 1).toNonIndexed(), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = kit.fbm(x * 1.7 + seed, y * 1.9 + z, 3) - 0.5;
    const edge = Math.abs(x) > w / 2 - 0.01 || Math.abs(y) > h / 2 - 0.01 ? 1 : 0.4;
    p.setXYZ(i, x * (1 + amp * n * edge), y + (y > 0 ? amp * 1.5 * n : 0), z * (1 + 0.6 * amp * n));
  }
  g.translate(0, h / 2, 0); g.computeVertexNormals();
  return g;
}

export function buildCamp(ctx, { hAt, rightOf, texts, lowVc, Z, windDir, LOW }) {
  const { route, kit, util, world } = ctx, R = ctx.rand, P = [], blockers = [];
  const block = (v, r) => blockers.push({ x: v.x, z: v.z, r });
  const bc = route.segs[0] && route.segs[0].kind === 'flat' ? route.segs[0] : { start: 0, steps: 3, label: '大本营' };

  // ---------- 石碑：路左、低矮（镜头那一侧，< 1.3）；正面朝回看的镜头 ----------
  {
    const s = bc.start + Math.min(1.8, bc.steps * 0.6), st = route.at(s, 2.6), sy = route.heightAt(s);
    const face = st.dir.clone().negate().addScaledVector(st.left, -0.55).normalize(), ry = Math.atan2(face.x, face.z);
    P.push({ geo: roughStone(kit, 2.2, 1.25, 0.5, 3), p: st.pos.clone().setY(sy - 0.05), ry, color: '#6f6962' });
    for (let k = 0; k < 5; k++) P.push({ geo: new THREE.IcosahedronGeometry(0.2 + 0.1 * R(), 0), p: st.pos.clone().addScaledVector(face, 0.35 + 0.1 * R()).addScaledVector(st.dir, (k - 2) * 0.45).setY(sy + 0.05), s: [1.2, 0.6, 1], color: '#5b5650' });
    const everest = /珠穆朗玛|珠峰/.test(world.name || '') || world.id === 'everest_north', alt = world.alt ? Math.round(world.alt[0]) : '';
    texts.push({ text: everest ? `珠穆朗玛峰大本营\n海拔${alt}米` : `${bc.label || '大本营'}\n${alt} m`, p: st.pos.clone().setY(sy + 0.68).addScaledVector(face, 0.27), ry, h: 0.62,
      color: '#c8241c', weight: 900, pad: 0.12, font: '"Songti SC","STSong","Noto Serif CJK SC",serif' });
    block(st.pos, 1.6);
  }

  // ---------- 玛尼堆：一摞扁石头（几块刷白、几块刻了红字），顶上插一小把经幡；路左石碑旁边、矮 ----------
  {
    const a = route.at(bc.start + 0.1, 3.7), y0 = hAt(a.pos.x, a.pos.z);
    const cols = ['#8d877d', '#a39d92', '#6f6a62', '#e8e4da', '#8d877d', '#b8322a', '#a39d92'];
    for (let k = 0; k < (LOW ? 16 : 26); k++) {
      const lv = Math.floor(k / 6), r = Math.max(0.1, 0.62 - lv * 0.15) * Math.sqrt(R()), ang = R() * 6.283;
      P.push({ geo: new THREE.IcosahedronGeometry(0.2, 0), p: [a.pos.x + Math.cos(ang) * r, y0 + 0.07 + lv * 0.16 + R() * 0.05, a.pos.z + Math.sin(ang) * r], ry: R() * 6, s: [1.35, 0.42, 1.1], color: cols[k % cols.length] });
    }
    P.push({ geo: new THREE.CylinderGeometry(0.025, 0.03, 1.2, 5), p: [a.pos.x, y0 + 0.9, a.pos.z], color: '#8a6a44' });
    ['#2f64e8', '#f4f4f0', '#d7342b', '#2f8f4e', '#f2c21b'].forEach((c, k) => P.push({ geo: new THREE.BoxGeometry(0.16, 0.12, 0.01), p: [a.pos.x + 0.1, y0 + 1.42 - k * 0.1, a.pos.z], ry: k * 0.5, color: c }));
    block(a.pos, 1.2);
  }

  // ---------- 餐厅大帐：长方帐篷 + 三角屋顶 + 两侧门 + 烟囱；路右 ----------
  {
    const a = route.at(bc.start - 2.8, -8.6), y0 = hAt(a.pos.x, a.pos.z) - 0.05, ry = -a.heading;
    const loc = (x, y, z) => new THREE.Vector3(x, y, z).applyAxisAngle(Y, ry).add(a.pos).setY(y0 + y);
    P.push({ geo: new THREE.BoxGeometry(4.4, 1.4, 2.8), p: loc(0, 0.7, 0), ry, color: '#e7a93a' });
    P.push({ geo: new THREE.CylinderGeometry(1.62, 1.62, 4.5, 3, 1).rotateY(Math.PI / 2).rotateZ(Math.PI / 2), p: loc(0, 1.4, 0), ry, s: [1, 0.62, 1.05], color: '#c9862a' });
    for (const zz of [-1.41, 1.41]) P.push({ geo: new THREE.BoxGeometry(0.8, 1.1, 0.02), p: loc(0.6, 0.55, zz), ry, color: '#3a2e24' });
    P.push({ geo: new THREE.CylinderGeometry(0.07, 0.07, 1.2, 6), p: loc(-1.5, 2.3, 0.5), color: '#6b6b6b' });
    block(a.pos, 3.2);
  }

  // ---------- 大穹顶帐篷（测地线穹顶，不动的东西直接并进静态几何：少一次绘制 + 一次阴影） ----------
  const dg = new THREE.IcosahedronGeometry(1, 1).toNonIndexed(), dp = dg.attributes.position;
  for (let i = 0; i < dp.count; i++) dp.setY(i, Math.max(0, dp.getY(i)) * 0.72);
  dg.computeVertexNormals();
  const door = new THREE.CircleGeometry(0.3, 3).rotateY(Math.PI / 2);
  {
    const spots = [[-7, -6.8, 1.9], [bc.start + 3.4, -11, 2.2], [-1.2, -13.4, 1.8], [-3.6, 7.6, 1.7], [bc.start + 2.6, 10.2, 2.0]].slice(0, LOW ? 3 : 5);
    const DC = ['#f2c21b', '#e8781c', '#d63b2a', '#f2c21b', '#e8781c'];
    spots.forEach(([s, lat, sc], k) => {
      const a = route.at(s, lat);
      const ry = -a.heading + (lat < 0 ? Math.PI / 2 : -Math.PI / 2), base = a.pos.clone().setY(hAt(a.pos.x, a.pos.z) - 0.05);
      P.push({ geo: dg, p: base, ry, s: sc, color: DC[k] });
      P.push({ geo: door, p: new THREE.Vector3(0.95 * sc, 0.24 * sc, 0).applyAxisAngle(Y, ry).add(base), ry, s: sc, color: '#3a332c' });
      block(a.pos, sc + 1.2);
    });
  }

  // ---------- 停机坪：石头垒的台子（地不平就垫高）+ 白圈 + H + 橙白边石 + 风向袋；路右、出了大本营往前 ~11 步的碛石滩上
  //   （跟拍镜头在身后 5–6 个单位：放远一点，直升机落地那几秒一直在画面右前方）。离所有路段 ≥ 4 个单位（冰川那段有拐弯） ----------
  const pad = (() => {
    const s0 = bc.start + bc.steps + 11;
    let a = null;
    for (const [ds, dl] of [[0, 0], [1, -0.8], [-1, -0.8], [2, -1.6], [-2, -1.6], [0, -2.6], [3, -2.6]]) { a = route.at(s0 + ds, -6.2 + dl); if (util.offRoad(route, a.pos.x, a.pos.z, 3.0)) break; }
    const c = a.pos, ry = -a.heading;
    let gmax = -1e9, gmin = 1e9;
    for (let k = 0; k < 9; k++) { const ang = k / 8 * 6.283, r = k ? 2.4 : 0, h = hAt(c.x + Math.cos(ang) * r, c.z + Math.sin(ang) * r); gmax = Math.max(gmax, h); gmin = Math.min(gmin, h); }
    const top = gmax + 0.14, h = top - gmin + 0.3;
    P.push({ geo: new THREE.CylinderGeometry(2.45, 2.7, h, 20), p: [c.x, top - h / 2, c.z], color: '#8a8782' });
    P.push({ geo: new THREE.RingGeometry(1.75, 1.96, 32).rotateX(-Math.PI / 2), p: [c.x, top + 0.012, c.z], color: '#f2f2ee' });
    const hq = (x, z, w, d) => P.push({ geo: new THREE.BoxGeometry(w, 0.02, d), p: new THREE.Vector3(x, 0, z).applyAxisAngle(Y, ry).add(c).setY(top + 0.015), ry, color: '#f2f2ee' });
    hq(0, -0.42, 1.25, 0.24); hq(0, 0.42, 1.25, 0.24); hq(0, 0, 0.24, 0.62);
    for (let k = 0; k < 14; k++) { const ang = k / 14 * 6.283; P.push({ geo: new THREE.BoxGeometry(0.28, 0.14, 0.2), p: [c.x + Math.cos(ang) * 2.3, top + 0.07, c.z + Math.sin(ang) * 2.3], ry: -ang, color: k % 2 ? '#e8781c' : '#f2f2ee' }); }
    const wp = new THREE.Vector3(2.9, 0, -1.2).applyAxisAngle(Y, ry).add(c), wy = hAt(wp.x, wp.z);
    P.push({ geo: new THREE.CylinderGeometry(0.035, 0.045, 2.4, 6), p: [wp.x, wy + 1.2, wp.z], color: '#9a9a9a' });
    const wd = windDir.clone().setY(-0.15).normalize();
    P.push({ geo: new THREE.CylinderGeometry(0.17, 0.06, 0.85, 8, 1, true).translate(0, -0.42, 0), p: [wp.x, wy + 2.35, wp.z], q: new THREE.Quaternion().setFromUnitVectors(Y.clone().negate(), wd), color: '#f06a1a' });
    block(c, 3.4);
    return new THREE.Vector3(c.x, top, c.z);
  })();

  // ---------- 晾衣绳：两根杆 + 下垂的绳 + 挂着的衣服 / 睡袋 ----------
  const line = (s0, s1, lat, bags) => {
    const a = rightOf(s0, lat), b = rightOf(s1, lat), H = 1.7, n = 8;
    for (const q of [a, b]) P.push({ geo: new THREE.CylinderGeometry(0.035, 0.045, H, 5), p: [q.x, q.y + H / 2, q.z], color: '#8a6a44' });
    const pt = f => a.clone().lerp(b, f).setY(a.y + (b.y - a.y) * f + H - 0.05 - 0.25 * 4 * f * (1 - f));
    for (let k = 0; k < n; k++) {
      const p0 = pt(k / n), p1 = pt((k + 1) / n), d = p1.clone().sub(p0);
      P.push({ geo: new THREE.CylinderGeometry(0.01, 0.01, 1, 3), p: p0.clone().lerp(p1, 0.5), q: new THREE.Quaternion().setFromUnitVectors(Y, d.clone().normalize()), s: [1, d.length(), 1] });
    }
    const ry = Math.atan2(-(b.z - a.z), b.x - a.x), C = bags ? ['#d63b2a', '#e8781c', '#2f8f4e', '#f2c21b', '#d63b2a'] : ['#d63b2a', '#f2c21b', '#2f8f4e', '#e8781c', '#8d8d8d', '#f4f4f0'];
    const m = bags ? 5 : 7;
    for (let k = 0; k < m; k++) {
      const f = (k + 0.7) / (m + 0.4), q = pt(f), [w, hh, dd] = bags ? [0.42, 1.0, 0.14] : [0.3, 0.42, 0.03];
      P.push({ geo: new THREE.BoxGeometry(w, hh, dd), p: q.clone().setY(q.y - hh / 2), ry: ry + (R() - 0.5) * 0.3, color: C[k % C.length] });
    }
    block(a.clone().lerp(b, 0.5), a.distanceTo(b) / 2 + 0.6);
  };
  line(bc.start + 1.6, bc.start + 5.8, -6.3, false);
  if (Z.abc) line(Z.abc.start - 1.2, Z.abc.start + 2.8, -3.7, true);

  const statics = new THREE.Mesh(util.merged(P), lowVc); statics.name = 'campVillage';
  return { meshes: [statics], pad, blockers };
}
