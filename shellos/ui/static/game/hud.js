// HUD：只读 /state（10 Hz）。DOM 在 game.html 里。
import { KIND_NAME } from './path.js';

export const KC = { flat: '#8a95a3', up: '#3ddc84', down: '#4fc3f7', stairs_up: '#ffd54f', stairs_down: '#ff8a65', wait: '#ff2e88' };
const $ = id => document.getElementById(id);
const fmt = s => s == null ? '—' : s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const SAFE = { ACTIVE: ['#3ddc84', '有力'], ARMED: ['#ffc53d', '待命（死人开关松开）'], CONNECTED: ['#ffc53d', '已连接'], PREVIEW: ['#8a95a3', '离线预览'] };

export function makeHud(world) {
  $('wname').textContent = world.name; $('wsub').textContent = world.subtitle || '';
  const acc = (world.theme && world.theme.accent) || [];
  if (acc[1]) document.documentElement.style.setProperty('--acc', acc[1]);
  let lastCard = null, lastApplied = '';
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
        const chip = document.createElement('span'); chip.className = 'chip'; chip.style.background = KC[kind] || '#888'; chip.textContent = KIND_NAME[kind] || kind; $('seg').append(chip);
        if (T.force) chip.textContent += '（强制）';
        const n = T.next;
        $('next').innerHTML = n ? `<b>${n.in}</b> 步后：${KIND_NAME[n.kind] || n.kind} · ${esc(n.label)}` : `前方：${esc(world.summit ? world.summit.name : '终点')}`;
      }
      if (T) {
        $('alt').innerHTML = `${T.altitude ?? '—'}<small>${world.unit || 'm'}</small>`;
        $('step').textContent = `第 ${Math.min(T.pos + 1, T.total)} / ${T.total} 步`;
        $('prog').firstElementChild.style.width = `${(T.pos / Math.max(1, T.total)) * 100}%`;
        $('time').textContent = fmt(T.elapsed); $('best').textContent = fmt(T.best); $('laps').textContent = `${T.laps} 次`;
        const w = $('wait');
        if (T.segment === 'wait' && !T.force && !summit) {
          w.style.display = 'block';
          const ws = T.wait_still || 0;
          $('waitT').textContent = ws > 0 ? `站定 ${ws.toFixed(1)} / 2.0 s` : (S.gait && S.gait.moving ? '停下！站定 2 秒放行' : '站定 2 秒放行');
          $('waitB').style.width = `${Math.min(1, ws / 2) * 100}%`;
        } else w.style.display = 'none';
      }
      const sent = (S.safety && S.safety.sent) || [0, 0], cap = (S.safety && S.safety.cap) || 3;
      for (const [id, v, fl] of [['L', sent[0], flashL], ['R', sent[1], flashR]]) {
        const bar = $('bar' + id), i = bar.firstElementChild, f = Math.min(1, Math.abs(v) / cap) * 50;
        i.style.width = f + '%'; i.style.left = v >= 0 ? '50%' : (50 - f) + '%';
        i.style.background = v >= 0 ? 'var(--acc)' : '#ff8a65';
        bar.classList.toggle('flash', fl);
        $('val' + id).textContent = `${v >= 0 ? '+' : ''}${v.toFixed(1)} Nm`;
      }
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
    ghostTag(x, y, show, text, rel) {
      const g = $('ghostTag');
      g.style.display = show ? 'block' : 'none';
      if (!show) return;
      g.style.left = x + 'px'; g.style.top = y + 'px';
      if (g.dataset.t !== text + rel) { g.dataset.t = text + rel; g.innerHTML = `${esc(text)}<small>${rel}</small>`; }
    },
    summit(show, T, prevBest) {
      const s = $('summit');
      if (show && T) {
        $('sName').textContent = world.summit ? world.summit.name : '终点';
        $('sText').textContent = world.summit ? world.summit.text : '';
        const best = T.last_lap != null && (prevBest == null || T.last_lap < prevBest - 1e-6);
        $('sTime').textContent = T.last_lap != null ? `用时 ${fmt(T.last_lap)}${best ? ' · 新纪录' : `（最佳 ${fmt(T.best)}）`} · 第 ${T.laps} 次登顶` : '';
      }
      s.classList.toggle('show', !!show);
    },
    banner(html) { const b = $('banner'); b.style.display = html ? 'block' : 'none'; if (html) b.innerHTML = html; },
    fps(v, extra) { $('fps').textContent = `${v.toFixed(0)} fps${extra || ''}`; },
    ready() { $('tag').remove(); },
  };
}
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function deltaText(d) { return Object.entries(d || {}).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}`).join('  ') || '—'; }
