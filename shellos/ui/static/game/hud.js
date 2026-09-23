// HUD：只读 /state（10 Hz）。DOM 在 game.html 里。
import { KIND_NAME, RISE } from './path.js';
import { makeForce } from './hud_force.js';   // U 线：力矩波形 + 大腿闪光
import { makeAi } from './hud_ai.js';         // U 线：AI 决策卡 + 造山过场
import { makeFlow } from './hud_flow.js';     // U 线：待机 / 准备 / 游戏中 / 登顶 状态流 + 二维码

export const KC = { flat: '#8a95a3', up: '#3ddc84', down: '#4fc3f7', stairs_up: '#ffd54f', stairs_down: '#ff8a65', wait: '#ff2e88' };
const $ = id => document.getElementById(id);
const AVOID = ['wait', 'tc', 'summit', 'tr', 'tl', 'puppet', 'banner', 'fg', 'force', 'aicard', 'uready'];   // 影子标签要让开的 HUD 面板
// 右上角安全灯：灰 = 没按 R2（没力），绿 = 按住 R2（出力中），红 = 急停 / 看门狗断开
const WHY = { 'low confidence': '没认准步子，力归零', 'stream stale': '数据断流，力归零', 'deadman released': '扳机松开' };
export function lampOf(sf) {
  const st = (sf && sf.state) || '—';
  if (st === 'DISARMED') return ['red', '急停', '操作员重新上膛'];
  if (st === 'ACTIVE') return ['green', '出力中', sf.reason && sf.reason !== 'ok' ? WHY[sf.reason] || sf.reason : ''];
  return ['grey', st === 'PREVIEW' ? '离线预览' : 'R2 松开', st === 'PREVIEW' ? '' : '没力'];
}

export function makeHud(world, preview = false) {
  document.body.classList.toggle('debug', new URLSearchParams(location.search).get('debug') === '1');
  $('wname').textContent = world.name; $('wsub').textContent = world.subtitle || '';
  const acc = (world.theme && world.theme.accent) || [];
  if (acc[1]) document.documentElement.style.setProperty('--acc', acc[1]);
  let lastApplied = null;
  // 海拔：落差 < 20 m 的世界（训练场 0–5 m）按每步起点高度显示一位小数（和场景里的刻度游标对得上）；大山照旧用 /state 的整数
  const [a0, a1] = world.alt || [0, 0], hs = [];
  if (a1 !== a0 && Math.abs(a1 - a0) < 20) { let h = 0; for (const sg of world.route || []) for (let k = 0; k < sg.steps; k++) { hs.push(h); h += RISE[sg.kind] || 0; } }
  const hmax = Math.max(...hs, 0) || 1;
  const altText = T => hs.length ? (a0 + (a1 - a0) * hs[Math.min(hs.length - 1, T.pos)] / hmax).toFixed(1) : (T.altitude ?? '—');
  const force = makeForce(acc[1] || '#29e7ff'), ai = makeAi(world), flow = makeFlow(world, preview);
  window.__hudAi = ai.debug;
  return {
    update(S, flashL, flashR, summit) {
      const T = S.terrain;
      if (T && summit) { $('seg').textContent = world.summit ? world.summit.name : '终点'; $('next').textContent = '登顶！'; }
      if (T && !summit) {
        const kind = T.segment;
        $('seg').innerHTML = ''; $('seg').append(T.label || KIND_NAME[kind] || kind);
        const chip = document.createElement('span'); chip.className = 'chip'; chip.style.background = KC[kind] || '#888'; chip.textContent = KIND_NAME[kind] || kind;
        if ((T.label && T.label !== chip.textContent) || T.force) $('seg').append(chip);   // 段名就是类型名（训练场）：别写两遍
        if (T.force) chip.textContent += '（强制）';
        const n = T.next;
        const nk = n ? KIND_NAME[n.kind] || n.kind : '';
        $('next').innerHTML = n ? `<b>${n.in}</b> 步后：${nk}${n.label && n.label !== nk ? ' · ' + esc(n.label) : ''}` : `前方：${esc(world.summit ? world.summit.name : '终点')}`;
      }
      if (T) {
        $('alt').innerHTML = `${altText(T)}<small>${world.unit || 'm'}</small>`;
        $('step').textContent = `第 ${Math.min(T.pos + 1, T.total)} / ${T.total} 步`;
        $('prog').firstElementChild.style.width = `${(T.pos / Math.max(1, T.total)) * 100}%`;
        const w = $('wait');
        if (T.segment === 'wait' && !T.force) {        // 红灯永远优先（登顶卡期间也要显示）
          w.style.display = 'block';
          const ws = T.wait_still || 0, need = T.wait_need || 1.5;
          $('waitT').textContent = ws > 0 ? `站定 ${ws.toFixed(1)} / ${need.toFixed(1)} s` : (S.gait && S.gait.moving ? '停下！站稳就放行' : '站稳就放行');
          $('waitB').style.width = `${Math.min(1, ws / need) * 100}%`;
        } else w.style.display = 'none';
      }
      force.update(S); ai.update(S);
      const P = (S.ctl && S.ctl.params) || {};
      $('fStr').textContent = P.strength ? `强度 ${(+P.strength[0]).toFixed(1)} Nm` : P.scale ? `摇杆推满 ${(+P.scale[0]).toFixed(1)} Nm` : '';
      const [lc, lt, ls] = lampOf(S.safety), lamp = $('lamp');
      lamp.className = `hud ${lc}`; $('lampT').textContent = lt; $('lampS').textContent = ls;
      const sim = S.sim && S.sim.on;
      $('hint').style.display = sim ? 'block' : 'none';
      if (sim) $('hintS').innerHTML = S.sim.walk ? `<span class="on">● 走 ${Math.round(S.sim.cadence)} 步/分</span>` : `○ 站 · ${Math.round(S.sim.cadence)} 步/分`;
      // 自动检索命中经验（走满 6 步后，不经过蜂群时间线）→ 也上 AI 卡；新卡在蜂群那一轮里已经有了
      const m = S.memory;
      if (m && m.cards) {
        const ap = m.applied || [];
        if (lastApplied !== null) {
          const hits = ap.filter(x => !lastApplied.includes(x)).map(id => m.cards.find(k => k.id === id))
            .filter(c => c && c.wearer !== S.wearer);   // 自己刚说的那张不算「命中」
          if (hits.length) ai.show(hits.map(c => ({ who: '记忆员', verdict: '生效', msg: `命中 ${c.wearer || '上一位'} 的经验卡 #${c.id}「${c.quote}」→ 自动套用 ${deltaText(c.delta)}` })));
        }
        lastApplied = ap.slice();
      }
      flow.update(S);
    },
    // off = 影子不在画面里（或贴着镜头）：标签钉在画面下缘，带 ↓
    ghostTag(x, y, show, who, rel, off) {
      const g = $('ghostTag');
      g.style.display = show ? 'block' : 'none';
      if (!show) { g.dataset.t = ''; return; }
      const key = `${who}|${rel}|${off ? 1 : 0}`;
      if (g.dataset.t !== key) { g.dataset.t = key; g.innerHTML = `${off ? '↓ ' : ''}上一位：${esc(who)}<small>${esc(rel)}</small>`; }
      if (off) { x = innerWidth / 2; y = innerHeight * 0.84; } else y = Math.min(y, innerHeight * 0.76);   // 别压到底部的力 / AI 卡
      // 标签（锚点在底边中点）和上方面板（红灯 / 路段 / 海拔 / 登顶卡…）重叠就挪到面板下面；左右不出屏
      const w = g.offsetWidth, h = g.offsetHeight, m = 8;
      x = Math.max(w / 2 + m, Math.min(innerWidth - w / 2 - m, x));
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (const id of AVOID) {
          const e = $(id); if (!e || (id === 'summit' && !e.classList.contains('show'))) continue;
          const r = e.getBoundingClientRect(); if (!r.width) continue;   // display:none
          if (x + w / 2 > r.left - m && x - w / 2 < r.right + m && y > r.top - m && y - h < r.bottom + m) { y = r.bottom + m + h > innerHeight - m ? r.top - m : r.bottom + m + h; moved = true; }
        }
        if (!moved) break;
      }
      g.style.left = x + 'px'; g.style.top = y + 'px';
    },
    attach(av) { force.attach(av); },
    cut() { const c = $('cut'); if (!c) return; c.style.transition = 'none'; c.style.opacity = '1'; void c.offsetWidth; c.style.transition = 'opacity .5s'; c.style.opacity = '0'; },
    puppet(on) { document.body.classList.toggle('puppet', !!on); },
    summit(show, T, prevBest) { flow.summit(show, T, prevBest); document.body.classList.toggle('summit', !!show); },   // 成绩卡归 hud_flow（引擎收起后还留一会儿）
    banner(html) { const b = $('banner'); b.style.display = html ? 'block' : 'none'; if (html) b.innerHTML = html; },
    fps(v, extra) { $('fps').textContent = `${v.toFixed(0)} fps${extra || ''}`; },
    ready() { $('tag').remove(); },
  };
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function deltaText(d) { return Object.entries(d || {}).map(([k, v]) => `${k === 'strength' ? '强度' : k} ${v >= 0 ? '+' : ''}${Number(v).toFixed(1)}`).join('，'); }
