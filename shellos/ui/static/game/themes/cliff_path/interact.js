// 地图互动（华山 / 珠峰共用）：化身旁边弹的图标。音效统一用 kit.sfx（themes/kit.js）。只动画面，不碰任何控制接口。
import * as THREE from 'three';
import { UI } from '../../style.js';

// 化身头顶的图标：一块圆角深底牌（同 HUD 面板色）+ 图 + 一行字。on(true) 弹出（先放大一点再回），on(false) 淡掉。
//   draw(g, w, h) 在 256×256 的画布上画图（上半），text 写在下面。始终在绘制列表里（透明度 0），不会第一次出现时卡一下
export function popIcon(scene, draw, text, { size = 0.95, color = '#ffffff' } = {}) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = UI.panel; g.beginPath(); g.roundRect(8, 8, 240, 240, 44); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 4; g.stroke();
  g.save(); draw(g, 256, 256); g.restore();
  g.font = `800 50px ${UI.font}`; const fs = Math.min(50, 50 * 222 / g.measureText(text).width);   // 字多就缩，写满一行
  g.fillStyle = color; g.font = `800 ${fs}px ${UI.font}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 206);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
  sp.renderOrder = 30; sp.name = 'popIcon'; sp.scale.setScalar(size); scene.add(sp);
  let want = false, k = 0, pop = 0;
  return {
    sprite: sp,
    on(v) { if (v && !want) pop = 0; want = !!v; },
    update(dt, at) {                                                       // at = 图标中心（世界坐标）
      k = want ? Math.min(1, k + dt * 5) : Math.max(0, k - dt * 2.5);
      pop = Math.min(1, pop + dt * 3.2);
      const s = size * (want ? 1 + 0.25 * Math.sin(Math.PI * pop) * (1 - pop) * 2 : 1);
      sp.material.opacity = k; sp.scale.setScalar(s * (0.6 + 0.4 * k));
      if (at) sp.position.copy(at);
    },
  };
}
