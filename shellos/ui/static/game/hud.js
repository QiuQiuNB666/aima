// HUD：只读 /state（10 Hz）。DOM 在 game.html 里。
import { KIND_NAME, RISE } from './path.js';

export const KC = { flat: '#8a95a3', up: '#3ddc84', down: '#4fc3f7', stairs_up: '#ffd54f', stairs_down: '#ff8a65', wait: '#ff2e88' };
const $ = id => document.getElementById(id);
const fmt = s => s == null ? '—' : s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const PEAK_S = 1.5;          // 力矩条 = 最近 1.5 s（≥ 一个步态周期）的峰值保持：/state 10 Hz 采样落在脉冲哪里是随机的，瞬时值看不出强弱
const AVOID = ['wait', 'tc', 'summit', 'tr', 'tl', 'puppet', 'banner', 'fg'];   // 影子标签要让开的 HUD 面板
const SAFE = { ACTIVE: ['#3ddc84', '有力'], ARMED: ['#ffc53d', '待命（死人开关松开）'], CONNECTED: ['#ffc53d', '已连接'], PREVIEW: ['#8a95a3', '离线预览'] };

export function makeHud(world) {
  $('wname').textContent = world.name; $('wsub').textContent = world.subtitle || '';
  const acc = (world.theme && world.theme.accent) || [];
  if (acc[1]) document.documentElement.style.setProperty('--acc', acc[1]);
  let lastCard = null, lastApplied = '';
  // 海拔：落差 < 20 m 的世界（训练场 0–5 m）按每步起点高度显示一位小数（和场景里的刻度游标对得上）；大山照旧用 /state 的整数
  const [a0, a1] = world.alt || [0, 0], hs = [];
  if (a1 !== a0 && Math.abs(a1 - a0) < 20) { let h = 0; for (const sg of world.route || []) for (let k = 0; k < sg.steps; k++) { hs.push(h); h += RISE[sg.kind] || 0; } }
  const hmax = Math.max(...hs, 0) || 1;
  const altText = T => hs.length ? (a0 + (a1 - a0) * hs[Math.min(hs.length - 1, T.pos)] / hmax).toFixed(1) : (T.altitude ?? '—');
  const hist = [[], []];      // 每条腿 [{t, v}]
  const cards = $('cards');
  function card(kind, quote, detail) {
    const d = document.createElement('div'); d.className = 'card panel';
    d.innerHTML = `<div class="k"></div><div class="q"></div><div class="d"></div>`;
    d.querySelector('.k').textContent = kind; d.querySelector('.q').textContent = quote; d.querySelector('.d').textContent = detail;
    cards.prepend(d); requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('in')));
    setTimeout(() => d.classList.add('out'), 7000); setTimeout(() => d.remove(), 7800);
    while (cards.children.length > 3) cards.lastChild.remove();
  }
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
        $('time').textContent = fmt(T.elapsed); $('best').textContent = fmt(T.best); $('laps').textContent = `${T.laps} 次`;
        const w = $('wait');
        if (T.segment === 'wait' && !T.force) {        // 红灯永远优先（登顶卡期间也要显示）
          w.style.display = 'block';
          const ws = T.wait_still || 0, need = T.wait_need || 1.5;
          $('waitT').textContent = ws > 0 ? `站定 ${ws.toFixed(1)} / ${need.toFixed(1)} s` : (S.gait && S.gait.moving ? '停下！站稳就放行' : '站稳就放行');
          $('waitB').style.width = `${Math.min(1, ws / need) * 100}%`;
        } else w.style.display = 'none';
      }
      const sent = (S.safety && S.safety.sent) || [0, 0], cap = (S.safety && S.safety.cap) || 3;
      const now = performance.now() / 1000;
      for (const [k, id, fl] of [[0, 'L', flashL], [1, 'R', flashR]]) {
        const h = hist[k]; h.push({ t: now, v: sent[k] }); while (h.length && now - h[0].t > PEAK_S) h.shift();
        const v = h.reduce((m, x) => Math.abs(x.v) > Math.abs(m) ? x.v : m, 0);
        const bar = $('bar' + id), i = bar.firstElementChild, f = Math.min(1, Math.abs(v) / cap) * 50;
        i.style.width = f + '%'; i.style.left = v >= 0 ? '50%' : (50 - f) + '%';
        i.style.background = v >= 0 ? 'var(--acc)' : '#ff8a65';
        bar.classList.toggle('flash', fl);
        $('val' + id).textContent = `${v >= 0 ? '+' : ''}${v.toFixed(1)} Nm`;
      }
      const P = (S.ctl && S.ctl.params) || {};
      $('str').innerHTML = P.strength ? `强度 <b>${(+P.strength[0]).toFixed(1)}</b> Nm · 力矩条 = 近 ${PEAK_S} s 峰值`
        : P.scale ? `摇杆推满 = <b>${(+P.scale[0]).toFixed(1)}</b> Nm · 力矩条 = 近 ${PEAK_S} s 峰值` : '';
      const st = (S.safety && S.safety.state) || '—';
      let [c, t] = SAFE[st] || ['#ff4d4f', st === 'DISARMED' ? '已断开（急停/看门狗）' : st];
      if (st === 'ACTIVE' && S.safety.reason && S.safety.reason !== 'ok') [c, t] = ['#ffc53d', '归零'];   // 低置信/断流：腿上是 0 Nm
      const dot = document.querySelector('#safe .dot'); dot.style.background = c; dot.style.color = c;
      $('safeT').textContent = st === 'PREVIEW' ? t : `${st} · ${t}`; $('safeR').textContent = S.safety && S.safety.reason && S.safety.reason !== 'ok' ? S.safety.reason : '';
      $('wearer').textContent = S.wearer || '—';
      const sim = S.sim && S.sim.on;
      $('hint').style.display = sim ? 'block' : 'none';
      if (sim) $('hintS').innerHTML = S.sim.walk ? `<span class="on">● 走 ${Math.round(S.sim.cadence)} 步/分</span>` : `○ 站 · ${Math.round(S.sim.cadence)} 步/分`;
      // 经验卡：新卡 / 命中
      const m = S.memory;
      if (m && m.cards) {
        const last = m.cards[m.cards.length - 1];
        if (lastCard === null) lastCard = last ? last.id : 0;
        else if (last && last.id !== lastCard) { lastCard = last.id; card(`新经验卡 #${last.id}`, `「${last.quote}」`, deltaText(last.delta)); }
        const ap = (m.applied || []).join(',');
        if (ap !== lastApplied) {
          const added = (m.applied || []).filter(x => !lastApplied.split(',').includes(String(x)) && x !== lastCard);
          lastApplied = ap;
          for (const id of added) { const c = m.cards.find(k => k.id === id); if (c) card(`命中经验 #${id}`, `「${c.quote}」`, `${c.wearer || ''} · ${deltaText(c.delta)}`); }
        }
      }
    },
    // off = 影子不在画面里（或贴着镜头）：标签钉在画面下缘，带 ↓；右下统计面板里的「影子」一行常驻（没影子 = —），面板宽度不跳
    ghostTag(x, y, show, who, rel, off) {
      const g = $('ghostTag');
      g.style.display = show ? 'block' : 'none';
      if (!show) { if (g.dataset.t) { g.dataset.t = ''; $('ghostV').textContent = '—'; } return; }
      const key = `${who}|${rel}|${off ? 1 : 0}`;
      if (g.dataset.t !== key) { g.dataset.t = key; g.innerHTML = `${off ? '↓ ' : ''}上一位：${esc(who)}<small>${esc(rel)}</small>`; $('ghostV').textContent = `${rel || '—'} · ${who}`; }
      if (off) { x = innerWidth / 2; y = innerHeight * 0.84; } else y = Math.min(y, innerHeight * 0.76);   // 别压到右下统计面板
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
    cut() { const c = $('cut'); if (!c) return; c.style.transition = 'none'; c.style.opacity = '1'; void c.offsetWidth; c.style.transition = 'opacity .5s'; c.style.opacity = '0'; },
    puppet(on) { document.body.classList.toggle('puppet', !!on); },
    summit(show, T, prevBest) {
      const s = $('summit');
      if (show && T) {
        $('sName').textContent = world.summit ? world.summit.name : '终点';
        $('sText').textContent = world.summit ? world.summit.text : '';
        const best = T.last_lap != null && (prevBest == null || T.last_lap < prevBest - 1e-6);
        $('sTime').textContent = T.last_lap != null ? `用时 ${fmt(T.last_lap)}${best ? ' · 新纪录' : `（最佳 ${fmt(T.best)}）`} · 第 ${T.laps} 次登顶` : '';
      }
      s.classList.toggle('show', !!show); document.body.classList.toggle('summit', !!show);
    },
    banner(html) { const b = $('banner'); b.style.display = html ? 'block' : 'none'; if (html) b.innerHTML = html; },
    fps(v, extra) { $('fps').textContent = `${v.toFixed(0)} fps${extra || ''}`; },
    ready() { $('tag').remove(); },
  };
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function deltaText(d) { return Object.entries(d || {}).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}`).join('  ') || '—'; }
