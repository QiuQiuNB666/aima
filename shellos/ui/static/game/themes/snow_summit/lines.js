// 珠峰地标互动的峰哥台词：画面动作出来的那一帧，同时弹气泡 + 放预生成的峰哥语音（照 guide.js 的路子，不走大模型、不加服务端请求）。
//   语音走导游的只读缓存：/guide/everest_north_fx/<i>.wav（server.py 现成的路由，只读 data/voice，没缓存就 404 → 只出气泡）。
//   要出声：把下面 LINES 的文字按顺序抄进 shellos/agent/guide.py 的 GUIDE["everest_north_fx"]，再跑 python3 -m shellos.agent.guide --tts。
//   口吻：「这是个好事儿啊…恰恰相反」的辩证反转，每句 ≤ 20 字，不碰两性和政治。?voice=0 只出气泡；离线预览只出气泡不出声。
//   音量归 U 设置页的「峰哥语音音量」（它按 /guide/ 网址认）。
//   两句之间至少隔 3 s：前一句没说完 / 不到 3 s，后一句排队（同一句不重复排；排了 6 s 还没轮到就丢，免得画面早过去了才说）。
export const LINES = [
  ['heli', '坐亡命小飞机来的，这是个好事儿啊。'],       // 直升机降落（峰哥 2020 年真坐小飞机降落卢卡拉）
  ['yak', '牦牛给我让路？恰恰相反，是我挡了它的道。'], // 牦牛让路
  ['oxygen', '吸氧不丢人，恰恰相反，不吸才丢命。'],    // 北坳吸氧
  ['queue', '排队是好事儿啊，前面的人替我试过梯子了。'], // 第二台阶排队放行
  ['summit', '旗靠风吹开，恰恰相反，人得自己走上来。'],  // 登顶红旗展开
  ['ladder_wobble', '慢点，一步一档。'],                 // 北坳横梯：步频太快 / 站太久，梯子晃
  ['ladder_pass', '过了，这是个好事儿啊。'],             // 北坳横梯：稳稳走过去
  ['fall', '掉下去？恰恰相反，是梯子把我弹回来了。'],    // 北坳横梯：失足黑场淡回来
  ['knife', '两边是悬崖？恰恰相反，中间才是路。'],       // 大风口刀脊
  ['traverse', '路窄是好事儿啊，想走错都难。'],          // 北壁横切·贴壁栈道
];
const KEY = 'everest_north_fx';
const Q = new URLSearchParams(location.search);
const MUTE = Q.get('voice') === '0' || Q.has('preview');
const clips = MUTE ? [] : LINES.map((_, k) => Object.assign(new Audio(`/guide/${KEY}/${k}.wav`), { preload: 'auto' }));   // 先下好：动作出来那一帧就能响
const GAP = 3000, STALE = 6000, queue = [];
let busyUntil = 0, timer = 0;
function speak(i) {
  const key = LINES[i][0], text = LINES[i][1];
  window.__fenggeHud?.say('map', text);
  window.__fgMapLine = { t: performance.now(), key, text };   // 给 voice.js / 气泡用：刚说过地标台词，大模型那句（红灯 / 登顶事件）可以晚一点或跳过，免得两句叠着念
  let dur = 0;
  if (!MUTE) { const a = clips[i]; a.currentTime = 0; a.play().catch(() => {}); if (isFinite(a.duration)) dur = a.duration * 1000; }   // 没缓存 / 浏览器不让出声：只有气泡
  busyUntil = performance.now() + Math.max(GAP, dur + 300);
}
function pump() {
  timer = 0;
  const now = performance.now();
  while (queue.length && now - queue[0].t > STALE) queue.shift();
  if (!queue.length) return;
  if (now >= busyUntil) speak(queue.shift().i);
  if (queue.length) timer = setTimeout(pump, Math.max(0, busyUntil - performance.now()));
}
export function fgSay(key) {
  const i = LINES.findIndex(l => l[0] === key); if (i < 0 || queue.some(q => q.i === i)) return;
  queue.push({ i, t: performance.now() });
  if (!timer) pump();
}
