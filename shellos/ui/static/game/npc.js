// J 线：追兵 NPC（造型 / 特效在 npc_jifeng.js）。只读 /state（引擎轮询好的 S），不发任何请求到控制接口——追上只有画面和台词，腿上的力一点不变。
// 行为：落后玩家 gap 步（连续值）。玩家在走：gap 每秒变 (步频 − CAD0) / CAD_K 步——走慢了她逼近（冲刺：前倾 + 拖尾 + 风刃 + 喊一句），
//   走快了被甩开；站着不走（不是红灯）她慢慢贴上来；**红灯路段她也站定**，gap 冻住、不冲刺、不喊（别逼人闯红灯）。
//   gap ≤ CAUGHT = 追上（贴在身后，喊「追上你了」）；gap ≥ LOST = 被甩开（藏起来，屏幕下缘留个名字牌）。
// 登顶：gap < END_GAP → 「抓到你了」，她冲上山顶站到玩家身边 + 风环；否则「被你甩掉了」，停在原地弯腰喘气。登顶卡收起后 gap 回到 START。
// 预览（?preview=…，截图用）：&npcgap=<步>、&npcdash=1（冲刺特效）、&npcsay=<台词>、配合 &summit=1 用 &npcend=caught|shaken。?npc=0 = 不出（在 engine.js 判断）。
// 声音：/voice/npc.wav?t=<台词>（ShellOS 只念 voice.py NPC_LINES 白名单，MiniMax 预设音色）；?voice=0 静音，预览不出声。
// 调试：window.__npc = { gap, state, say(line) }。
import * as THREE from 'three';
import { makeJifeng, 角色名 } from './npc_jifeng.js';

const Q = new URLSearchParams(location.search);
export const NPC = {
  START: 2.5, CAUGHT: 0.7, LOST: 4.5, END_GAP: 3,   // 步。跟拍镜头在身后 4.6（台阶 3.7）单位 = 7~9 步，再远她就贴到镜头上了
  CAD0: 100, CAD_K: 40,                        // 步频 100 = 不远不近；80 → 每秒近 0.5 步（约 4 s 追上），130 → 每秒远 0.75 步（约 3 s 甩开）；模拟 1/2/3 键 = 80/105/130
  IDLE_CLOSE: 0.4,                             // 站着不走（非红灯）每秒贴近多少步
  LAT: 0.85,                                   // 横向（左 = 正）：化身 +0.35，影子在右边 −0.5 附近；她走左侧路沿，不和影子叠（路宽 2.2）
  SAY_GAP: 2.5,                                // 两句之间至少几秒（= 气泡停留时间，不叠）
};
// 台词：原创，每句 2~6 字。改台词要同步 shellos/agent/voice.py 的 NPC_LINES（白名单，不在里面的不出声）。
const LINES = {
  start: '风起了',
  dash: '别停',
  caught: '追上你了',
  lost: '等等我',
  endCaught: '抓到你了',
  endShaken: '被你甩掉了',
};

const CSS = `
#npcTag{transform:translate(-50%,-100%);display:none;text-align:center;white-space:nowrap}
#npcTag .nm{display:inline-block;font-size:.85rem;font-weight:800;letter-spacing:.15em;padding:.05rem .55rem;border-radius:.4rem;background:#2f7fe0;color:#fff;border:1px solid #9ff3ff}
#npcTag .bub{display:block;margin:0 auto .35rem;padding:.4rem .8rem;font-size:1.25rem;font-weight:800;color:#dffaff;border-color:#9ff3ff;
  opacity:0;transform:translateY(.4rem);transition:opacity .25s,transform .25s}
#npcTag.talk .bub{opacity:1;transform:none}
#npcTag.edge .nm::after{content:" ↓ " attr(data-rel)}`;

export async function initNpc({ scene, route, me, camera, getS, preview }) {
  const npc = await makeJifeng(scene);
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  const tag = document.createElement('div'); tag.className = 'hud'; tag.id = 'npcTag';
  tag.innerHTML = '<span class="bub panel"></span><span class="nm"></span>'; document.body.append(tag);
  const nm = tag.querySelector('.nm'), bub = tag.querySelector('.bub'); nm.textContent = 角色名;

  let gap = preview && Q.has('npcgap') ? +Q.get('npcgap') : NPC.START;
  let state = 'chase', lastSay = -99, sayUntil = 0, laps = null, ending = null, endS = 0, phase = 0, lean = 0, sPrev = null, spd = 0, yaw = null, dashSaid = false;
  const mute = preview || Q.get('voice') === '0';
  let audio = null;
  const say = (key, t) => {
    const line = LINES[key] || key;
    if (t - lastSay < NPC.SAY_GAP && !key.startsWith('end')) return false;
    lastSay = t; sayUntil = t + 2.5; bub.textContent = line; tag.classList.add('talk');
    if (mute) return true;
    if (audio) audio.pause();
    audio = new Audio('/voice/npc.wav?t=' + encodeURIComponent(line));   // 204（没 TTS / 不在白名单）= 播放失败，安静跳过
    audio.play().catch(() => {});                                          // 还没点过页面：浏览器不让出声，只出气泡
    return true;
  };
  if (preview && Q.get('npcsay')) { bub.textContent = Q.get('npcsay'); tag.classList.add('talk'); sayUntil = 1e12; }
  if (preview && Q.get('npcend')) ending = Q.get('npcend') === 'shaken' ? 'shaken' : 'caught';

  const A = {}, head = new THREE.Vector3();
  let last = performance.now(), started = false;
  const lerpAng = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;
  window.__npc = { get gap() { return gap; }, get state() { return state; }, say: l => say(l, performance.now() / 1000) };

  function frame() {
    requestAnimationFrame(frame);
    const nowMs = performance.now(), dtR = Math.min(1, (nowMs - last) / 1000), dt = Math.min(0.1, dtR), t = nowMs / 1000; last = nowMs;   // dtR：距离按真实时间积分（掉帧也不会追得慢），动画用 dt
    const S = getS(), T = S && S.terrain;
    const summit = document.body.classList.contains('summit');          // hud.js 登顶卡显示期间
    const moving = !!(S && S.gait && S.gait.moving);
    const red = !!(T && T.segment === 'wait');
    let dash = preview && Q.get('npcdash') === '1' ? 1 : 0;

    if (T && laps === null) laps = T.laps;
    if (!preview && T && T.laps > laps && !ending) {                    // 登顶结局
      ending = gap < NPC.END_GAP ? 'caught' : 'shaken'; endS = me.s - gap;
      say(ending === 'caught' ? 'endCaught' : 'endShaken', t);
      if (ending === 'caught') npc.burst();
    }
    if (T) laps = T.laps;
    if (ending && !summit && !preview) { ending = null; gap = NPC.START; sPrev = null; dashSaid = false; npc.resetTrail(); state = 'chase'; }

    let s;
    if (ending === 'caught') {                                           // 冲上山顶，站到玩家左后侧
      const goal = route.N + 0.6;
      endS = preview ? goal : Math.min(goal, Math.max(endS, me.s - gap) + dtR * 4);
      s = endS; dash = endS < goal - 0.05 ? 1 : 0;
    } else if (ending === 'shaken') {
      s = preview ? me.s - gap : endS;
    } else if (!preview && T) {
      if (!started && moving && !red) { started = true; say('start', t); }
      const rate = red || !started ? 0 : moving ? ((S.gait.cadence || NPC.CAD0) - NPC.CAD0) / NPC.CAD_K : -NPC.IDLE_CLOSE;
      gap = Math.max(NPC.CAUGHT, Math.min(NPC.LOST + 1, gap + rate * dtR));
      if (rate < -0.15 && gap > NPC.CAUGHT + 0.05) dash = Math.min(1, -rate * 2);
      const ns = gap <= NPC.CAUGHT + 0.01 ? 'caught' : gap >= NPC.LOST ? 'lost' : 'chase';
      if (ns !== state) { if (ns === 'caught') say('caught', t); else if (ns === 'lost') say('lost', t); state = ns; }
      else if (dash > 0.5 && !dashSaid && state === 'chase') dashSaid = say('dash', t);   // 每段冲刺喊一次（刚喊过别的就等气泡收了再喊）
      if (dash < 0.2) dashSaid = false;
      s = me.s - gap;
    } else s = me.s - gap;

    route.at(s, ending === 'caught' ? 0.95 : NPC.LAT, A);
    npc.group.position.copy(A.pos);
    yaw = yaw === null ? -A.heading : lerpAng(yaw, -A.heading, 1 - Math.exp(-dt * 6));
    // 步态：按她自己的速度摆腿；冲刺前倾；被甩掉的结局弯腰喘气
    const v = sPrev === null ? 0 : (s - sPrev) / Math.max(dt, 1e-3); sPrev = s;
    spd += (Math.max(0, Math.min(6, v)) - spd) * (1 - Math.exp(-dt * 5));
    const walkV = ending === 'shaken' ? 0 : preview ? (dash ? 3 : 1.6) : spd;
    phase += dt * Math.PI * walkV;
    const amp = Math.min(38, walkV * 14 + dash * 12);
    const wantLean = ending === 'shaken' ? 0.5 : dash * 0.28;
    lean += (wantLean - lean) * (1 - Math.exp(-dt * 5));
    npc.group.rotation.set(0, yaw, -lean);
    if (ending === 'shaken') npc.pose(30 + 4 * Math.sin(t * 5), 30 + 4 * Math.sin(t * 5 + 1));   // 撑膝喘气
    else if (walkV < 0.05) npc.pose(-4, 6);
    else npc.pose(amp * Math.sin(phase), amp * Math.sin(phase + Math.PI));

    const hidden = !ending && gap >= NPC.LOST;                           // 甩到镜头后面去了：藏起来，只留名字牌
    npc.visible = !hidden;
    npc.update(dt, A.pos, A.dir, hidden ? 0 : dash);

    // 头顶名字牌 + 气泡（投影到屏幕；出画 / 被甩开时钉在下缘，写落后几步）
    if (t > sayUntil) tag.classList.remove('talk');
    npc.headWorld(head); head.y += 0.45; head.project(camera);
    const on = !hidden && head.z < 1 && Math.abs(head.x) < 1 && Math.abs(head.y) < 1;
    const x = on ? (head.x + 1) / 2 * innerWidth : innerWidth * 0.36;      // 出画：钉在左下（影子的标签钉在正中下方），底部提示条上面
    const y = on ? (1 - head.y) / 2 * innerHeight : innerHeight - 120;
    tag.style.left = `${Math.max(80, Math.min(innerWidth - 80, x))}px`; tag.style.top = `${Math.max(120, Math.min(innerHeight - 70, y))}px`;
    tag.classList.toggle('edge', !on); nm.dataset.rel = `落后 ${Math.round(gap)} 步`;
    tag.style.display = T || preview ? 'block' : 'none';
  }
  frame();
  return npc;
}
