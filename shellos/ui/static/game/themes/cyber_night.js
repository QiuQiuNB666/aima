// 赛博东京·夜行：雨夜霓虹。涩谷街头（竖排霓虹招牌、贩卖机、大屏）→ 红灯斑马线（步行者信号跟 wait_still 联动、红灯时车流）
//   → 天桥（桥下挖出一条大街）→ 道玄坂（低层商铺、电线杆）→ 爱宕神社石阶（鸟居、石灯笼、杉树影）。
// 子模块在 cyber_night/：city（楼/招牌/商铺/电线/路灯/贩卖机）、street（路口/信号/天桥/车流）、shrine、rain、lib（公用）。
import * as THREE from 'three';
import { ROAD_W } from '../path.js';
import { radialTex } from './cyber_night/lib.js';
import { buildCity, updateCity } from './cyber_night/city.js';
import { buildStreet, updateStreet } from './cyber_night/street.js';
import { buildShrine, updateShrine } from './cyber_night/shrine.js';
import { buildRain, updateRain } from './cyber_night/rain.js';

// 路面：湿沥青（Phong 高光吃点光源 → 地上有霓虹色的反光）
export function pathMaterials({ theme }) {
  return { road: new THREE.MeshPhongMaterial({ color: theme.path, specular: '#4a4468', shininess: 60, emissive: '#07060e' }) };
}

function asphaltTex(util, rand) {
  return util.canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#7a7e8a'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 5000; k++) { const v = 90 + rand() * 70 | 0; g.fillStyle = `rgb(${v},${v},${v + 8})`; g.fillRect(rand() * w, rand() * h, 2, 2); }
    for (let k = 0; k < 14; k++) {                      // 水洼：更亮更蓝、边缘软（specularMap 也用这张 → 水洼更反光）
      const x = rand() * w, y = rand() * h, r = 30 + rand() * 70, gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(200,212,245,.9)'); gr.addColorStop(0.6, 'rgba(170,185,230,.5)'); gr.addColorStop(1, 'rgba(170,185,230,0)');
      g.save(); g.translate(x, y); g.scale(1, 0.45 + rand() * 0.4); g.translate(-x, -y); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); g.restore();
    }
  }, { repeat: true });
}

export function build(scene, ctx) {
  const { theme, kit, lights, route, util } = ctx, acc = theme.accent;
  kit.sky(scene, theme.sky[0], '#2e1448', { exponent: 0.42 });        // 地平线一圈城市光污染的紫，楼和电线的剪影靠它
  kit.fog(scene, theme.fog, 16, 85);
  lights.hemi.color.set('#6a5cff'); lights.hemi.groundColor.set('#1a0b2e'); lights.hemi.intensity = 0.95;
  lights.sun.color.set('#ff7ad0'); lights.sun.intensity = 0.55;

  const asphalt = asphaltTex(util, ctx.rand), groundColor = new THREE.Color(theme.ground);
  const ground = kit.terrain(ctx, { amp: 0, rough: 0, reach: 4, map: asphalt, uvScale: 6 });
  ground.material = new THREE.MeshPhongMaterial({ vertexColors: true, map: asphalt, specularMap: asphalt, specular: '#3a3450', shininess: 50 });
  const E = { ground, asphalt, groundColor, radial: radialTex(util) };

  // 霓虹色点光源（4 盏，不开阴影）：打在湿地面上的彩色反光
  for (const [s, lat, y, col, k] of [[-4, 3.2, 3.2, acc[1], 7], [3, -2.8, 3, acc[0], 7], [23.5, 2.6, 3, '#ff8a3a', 6], [33, 0, 3.6, '#ffb070', 9]]) {
    const a = route.at(s, lat), L = new THREE.PointLight(col, k, 14, 1.6);
    L.position.set(a.pos.x, a.pos.y + y, a.pos.z); scene.add(L);
  }

  buildStreet(scene, ctx, E);           // 先挖天桥下的大街（改地面），再摆别的
  buildCity(scene, ctx, E);
  buildShrine(scene, ctx, E);
  buildRain(scene, ctx);

  const M = ctx.meshes;
  if (M.camp) M.camp.visible = false;   // 城市里没有帐篷
  // 台阶：天桥 = 钢灰蓝、神社 = 石灰；踏面比地面亮很多 + 每级边缘一条霓虹亮条（台阶 = 腿上脉冲，得让评委看出来）
  const st = M.stairs, idx = M.stairIndex || [];
  if (st && idx.length) {
    st.material.emissive = new THREE.Color('#141018');
    const bridge = new THREE.Color('#66718e'), stone = new THREE.Color('#aaa69c'), col = new THREE.Color();
    idx.forEach((i, k) => st.setColorAt(k, col.copy(i < 22 ? bridge : stone).multiplyScalar(k % 2 ? 1 : 0.9)));
    st.instanceColor.needsUpdate = true;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const nose = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: acc[2] }), idx.length);
    idx.forEach((i, k) => {
      const S = route.steps[i], up = S.kind === 'stairs_up';
      const e = up ? route.P[i] : route.P[i + 1], y = Math.max(S.h0, S.h1);   // 上台阶：立面在步起点；下台阶：落差在步终点
      p.set(e.x, y + 0.012, e.z); q.setFromAxisAngle(Y, -route.H[i]); s.set(0.05, 0.03, ROAD_W);
      nose.setMatrixAt(k, m4.compose(p, q, s));
    });
    nose.name = 'stairNose'; scene.add(nose);
  }
}

export function update(dt, st) {
  updateStreet(dt, st); updateCity(dt, st); updateShrine(dt, st); updateRain(dt, st);
}
