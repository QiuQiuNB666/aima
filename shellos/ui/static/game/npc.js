// J 线：追兵 NPC「捷风」（造型 / 特效 / 模型加载在 npc_jifeng.js）。只读 /state（引擎轮询好的 S），不发任何请求到控制接口——追上只有画面和台词，腿上的力一点不变。
// 行为：落后玩家 gap 步（连续值）。红灯时说一句「站好，我也不动」、绿灯说「가자」。玩家在走：gap 每秒变 (步频 − CAD0) / CAD_K 步——走慢了她逼近（冲刺：前倾 + 拖尾 + 风刃 + 喊一句），
//   走快了被甩开；站着不走（不是红灯）她慢慢贴上来；**红灯路段她也站定**，gap 冻住、不冲刺、不喊（别逼人闯红灯）。
//   gap ≤ CAUGHT = 追上（贴在身后，喊「追上你了」）；gap ≥ LOST = 被甩开（藏起来，屏幕下缘留个名字牌）。
// 登顶：gap < END_GAP → 「抓到你了」，她冲上山顶站到玩家身边 + 风环；否则「被你甩掉了」，停在原地弯腰喘气。登顶卡收起后 gap 回到 START。
// 预览（?preview=…，截图用）：&npcgap=<步>、&npcdash=1（冲刺特效）、&npcsay=<台词>、配合 &summit=1 用 &npcend=caught|shaken。?npc=0 = 不出（在 engine.js 判断）。
// 声音：/voice/npc.wav?t=<台词>（ShellOS 只念 voice.py NPC_LINES 白名单，MiniMax 预设音色）；?voice=0 静音，预览不出声。
// 调试：window.__npc = { gap, state, say(line) }。
import * as THREE from 'three';
import { makeJifeng, 角色名 } from './npc_jifeng.js';   // 旧版追兵「捷风」：?npc=jifeng
import { makeAssistant } from './npc_assistant.js';   // 缺省：峰哥的助理（9/23 夜起）
import { WHO } from './style.js';
import { synthHip } from './anim.js';

const Q = new URLSearchParams(location.search);
export const NPC = {
  START: 2.5, CAUGHT: 0.7, LOST: 4.5, END_GAP: 3,   // 步。跟拍镜头在身后 4.6（台阶 3.7）单位 = 7~9 步，再远她就贴到镜头上了
  CAD0: 100, CAD_K: 40,                        // 步频 100 = 不远不近；80 → 每秒近 0.5 步（约 4 s 追上），130 → 每秒远 0.75 步（约 3 s 甩开）；模拟 1/2/3 键 = 80/105/130
  IDLE_CLOSE: 0.4,                             // 站着不走（非红灯）每秒贴近多少步
  LAT: -0.9,                                   // 横向（左 = 正）：化身 +0.35、影子 −0.5、跟拍镜头在左后方 1.4——她走右路沿（离镜头远的那侧），
                                               //   不进「镜头 → 峰哥」的视锥（美术范式 §6 构图铁律；以前走左侧 0.85 正好挡住峰哥一半以上）
  ARC_IN: 0.6,                                 // 追上那一下往峰哥肩膀那边切多少（−0.9 → −0.3，贴一下再回路沿）
  ARC_S: 1.0,                                   // 追上时绕小弧用几秒
  SAY_GAP: 2.5,                                // 两句之间至少几秒（= 气泡停留时间，不叠）
};
// 台词：原创，短、快、带点嘲讽（风系刺客、嘴欠），夹通用韩语感叹词（가자 = 走、빨리 = 快）；不用任何游戏角色的原台词。
// 声音：配音演员本人当面同意、现场新录的真人录音优先（服务端 data/voice/npc/real/），没有的走合成。一个事件几句的随机挑一句。
// 改台词要同步 shellos/agent/voice.py 的 NPC_LINES（白名单，不在里面的不出声），顺序 = 录音台词单编号。
const LINES = {
  start: ['가자！你先跑三秒。'],
  dash: ['就这？빨리빨리！'],
  caught: ['逮到了，慢死了。', '回头看看？我在这儿。'],
  lost: ['哟，跑挺快嘛。', '喂！我还没热身呢。'],
  red: ['红灯。站好，我也不动。'],               // 红灯她也站定——这句是安全提示，不嘲讽
  green: ['绿灯了，가자！'],
  endCaught: ['又是我先到，拜。', '山顶风大，站稳了。'],
  endShaken: ['啧，算你走运。'],
};

const AVOID = ['wait', 'tc', 'summit', 'tr', 'tl', 'puppet', 'banner', 'fg', 'force', 'aicard', 'uready', 'uidle', 'uqr', 'ghostTag'];   // hud.js 的 AVOID + 待机 / 二维码 / 影子标签
const CSS = `
#npcTag{transform:translate(-50%,-100%);display:none;text-align:center;white-space:nowrap}
#npcTag .nm{display:inline-block;font-size:.85rem;font-weight:800;letter-spacing:.15em;padding:.05rem .55rem;border-radius:.4rem;background:${WHO.jett.tag};color:#fff;border:1px solid ${WHO.jett.rim}}
#npcTag .bub{display:block;margin:0 auto .35rem;padding:.4rem .8rem;font-size:1.25rem;font-weight:800;color:#fff;border-color:${WHO.jett.tag};
  opacity:0;transform:translateY(.4rem);transition:opacity .25s,transform .25s}
#npcTag.talk .bub{opacity:1;transform:none}
#npcTag.edge .nm::after{content:" ↓ " attr(data-rel)}`;

export async function initNpc({ scene, route, me, camera, getS, preview }) {
  const LEGACY = Q.get('npc') === 'jifeng';
  const npc = LEGACY ? await makeJifeng(scene) : await makeAssistant(scene);
  const st = document.createElement('style'); st.textContent = CSS; document.head.append(st);
  const tag = document.createElement('div'); tag.className = 'hud'; tag.id = 'npcTag';
  tag.innerHTML = '<span class="bub panel"></span><span class="nm"></span>'; document.body.append(tag);
  const nm = tag.querySelector('.nm'), bub = tag.querySelector('.bub'); nm.textContent = LEGACY ? 角色名 : npc.name;

  let gap = preview && Q.has('npcgap') ? +Q.get('npcgap') : NPC.START;
  let state = 'chase', lastSay = -99, sayUntil = 0, laps = null, ending = null, endS = 0, phase = 0, lean = 0, sPrev = null, spd = 0, yaw = null, dashSaid = false, wasRed = false, arcT = 9, gph = 0;
  const mute = preview || Q.get('voice') === '0';
  let audio = null;
  const quiet = Q.get('npctalk') !== '1';   // 9/23 球球：主角是峰哥，捷风先闭嘴（不出气泡不出声）；?npctalk=1 恢复
  const say = (key, t) => {
    if (quiet) return false;
    const L = LINES[key], line = L ? L[Math.floor(Math.random() * L.length)] : key;
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
    if (ending === 'caught') {                                           // 冲上山顶，站到峰哥右后侧
      const goal = route.N + 0.6;
      endS = preview ? goal : Math.min(goal, Math.max(endS, me.s - gap) + dtR * 4);
      s = endS; dash = endS < goal - 0.05 ? 1 : 0;
    } else if (ending === 'shaken') {
      s = preview ? me.s - gap : endS;
    } else if (!preview && T) {
      if (!started && moving && !red) { started = true; say('start', t); }
      if (started && red !== wasRed) say(red ? 'red' : 'green', t);        // 红灯一起停 / 绿灯一起走
      wasRed = red;
      const rate = red || !started ? 0 : moving ? ((S.gait.cadence || NPC.CAD0) - NPC.CAD0) / NPC.CAD_K : -NPC.IDLE_CLOSE;
      gap = Math.max(NPC.CAUGHT, Math.min(NPC.LOST + 1, gap + rate * dtR));
      if (rate < -0.15 && gap > NPC.CAUGHT + 0.05) dash = Math.min(1, -rate * 2);
      const ns = gap <= NPC.CAUGHT + 0.01 ? 'caught' : gap >= NPC.LOST ? 'lost' : 'chase';
      if (ns !== state) { if (ns === 'caught') { say('caught', t); arcT = 0; } else if (ns === 'lost') say('lost', t); state = ns; }
      else if (dash > 0.5 && !dashSaid && state === 'chase') dashSaid = say('dash', t);   // 每段冲刺喊一次（刚喊过别的就等气泡收了再喊）
      if (dash < 0.2) dashSaid = false;
      s = me.s - gap;
    } else s = me.s - gap;

    // 追上那一下：绕一个小弧——先往前、往峰哥肩膀那边切，再回到右路沿站定
    arcT += dtR; const arc = arcT < NPC.ARC_S ? Math.sin(Math.PI * arcT / NPC.ARC_S) : 0;
    if (!ending) s += 0.35 * arc;
    route.at(s, NPC.LAT + NPC.ARC_IN * arc, A);
    npc.group.position.copy(A.pos);
    yaw = yaw === null ? -A.heading : lerpAng(yaw, -A.heading + 0.5 * arc, 1 - Math.exp(-dt * 6));
    // 步态：按她自己的速度摆腿；冲刺前倾；被甩掉的结局弯腰喘气
    const v = sPrev === null ? 0 : (s - sPrev) / Math.max(dt, 1e-3); sPrev = s;
    spd += (Math.max(0, Math.min(6, v)) - spd) * (1 - Math.exp(-dt * 5));
    const walkV = ending === 'shaken' ? 0 : preview ? (dash ? 3 : 1.6) : spd;
    phase += dt * Math.PI * walkV;
    const amp = Math.min(38, walkV * 14 + dash * 12);
    const wantLean = npc.statue ? (ending === 'shaken' ? 0.3 : 0.03 + dash * 0.32 + (walkV > 0.05 ? 0.1 : 0))
      : ending === 'shaken' ? 0.5 : dash * (npc.animate ? 0.12 : 0.28);   // A2 跑步自己会前倾，整体只再压一点
    lean += (wantLean - lean) * (1 - Math.exp(-dt * 5));
    npc.group.rotation.set(0, yaw, -lean);
    if (npc.statue) {                                                    // 雕像（STL）四肢不能动：风系飘行——离地浮着，走时上下起伏，停下来慢慢呼吸
      npc.group.position.y += ending === 'shaken' ? 0.02 : walkV > 0.05 ? 0.1 + 0.05 * Math.sin(phase * 2) : 0.07 + 0.03 * Math.sin(t * 2.2);
      npc.group.scale.y = 1 + 0.012 * Math.sin(t * 1.8);
    }
    const stand = walkV < 0.05 && (ending === 'caught' || (!ending && state === 'caught'));   // 追上后站定 / 登顶抓到：播模型自带的格斗站姿（有的话）
    if (npc.stance(stand)) { /* 自带动画在摆 */ }
    else if (npc.animate) {                                              // CesiumMan 系：A2 全身动作，髋角用合成步态（一周期 = 两步），冲刺时步频 > 150 自动切成跑
      const rate = walkV / 2, a = ending === 'shaken' ? 0 : Math.min(1.4, walkV / 1.8);
      gph = (gph + dt * rate) % 1;
      const [l, wl] = synthHip(gph, a, 8 * a), [r, wr] = synthHip((gph + 0.5) % 1, a, 8 * a);
      npc.animate(dt, t, { fl: l, fr: r, wl: wl * rate, wr: wr * rate, kind: A.kind, summit: ending === 'caught' });
    }
    else if (ending === 'shaken') npc.pose(30 + 4 * Math.sin(t * 5), 30 + 4 * Math.sin(t * 5 + 1));   // 撑膝喘气
    else if (walkV < 0.05) npc.pose(-4, 6);
    else npc.pose(amp * Math.sin(phase), amp * Math.sin(phase + Math.PI));

    const hidden = !ending && gap >= NPC.LOST;                           // 甩到镜头后面去了：藏起来，只留名字牌
    npc.visible = !hidden;
    npc.update(dt, A.pos, A.dir, hidden ? 0 : dash);

    // 头顶名字牌 + 气泡（投影到屏幕；出画 / 被甩开时钉在下缘，写落后几步）
    if (t > sayUntil) tag.classList.remove('talk');
    npc.headWorld(head); head.y += 0.28; head.project(camera);          // 标签贴着她自己的头顶（以前 +0.45，离镜头近时飘到很高）
    const on = !hidden && head.z < 1 && Math.abs(head.x) < 1 && Math.abs(head.y) < 1;
    const x = on ? (head.x + 1) / 2 * innerWidth : innerWidth * 0.66;      // 出画：钉在右下（她走右路沿；影子的标签钉在正中下方），底部提示条上面
    const y = on ? (1 - head.y) / 2 * innerHeight : innerHeight - 120;
    tag.classList.toggle('edge', !on); nm.dataset.rel = `落后 ${Math.round(gap)} 步`;
    tag.style.display = T || preview ? 'block' : 'none';
    // 和 HUD 面板（「按住 R2 开始」#uready、待机、红灯、路段、登顶卡、影子标签…）重叠就挪到面板下面，放不下就挪到上面——同 hud.js 的影子标签
    const w = tag.offsetWidth, h = tag.offsetHeight, m = 8;
    let X = Math.max(w / 2 + m, Math.min(innerWidth - w / 2 - m, x)), Y = Math.max(h + m, Math.min(innerHeight - 70, y));
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const id of AVOID) {
        const e = document.getElementById(id); if (!e || (id === 'summit' && !e.classList.contains('show'))) continue;
        const r = e.getBoundingClientRect(); if (!r.width) continue;   // display:none
        if (X + w / 2 > r.left - m && X - w / 2 < r.right + m && Y > r.top - m && Y - h < r.bottom + m) { Y = r.bottom + m + h > innerHeight - m ? r.top - m : r.bottom + m + h; moved = true; }
      }
      if (!moved) break;
    }
    tag.style.left = `${X}px`; tag.style.top = `${Y}px`;
  }
  frame();
  return npc;
}
