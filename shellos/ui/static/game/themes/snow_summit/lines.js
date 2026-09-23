// 珠峰地标互动的峰哥台词：画面动作出来的那一帧，同时弹气泡 + 放预生成的峰哥语音（照 guide.js 的路子，不走大模型、不加服务端请求）。
//   语音走导游的只读缓存：/guide/everest_north_fx/<i>.wav（server.py 现成的路由，只读 data/voice，没缓存就 404 → 只出气泡）。
//   要出声：把下面 LINES 的文字按顺序抄进 shellos/agent/guide.py 的 GUIDE["everest_north_fx"]，再跑 python3 -m shellos.agent.guide --tts。
//   口吻：「这是个好事儿啊…恰恰相反」的辩证反转，每句 ≤ 20 字，不碰两性和政治。?voice=0 只出气泡；离线预览只出气泡不出声。
//   音量归 U 设置页的「峰哥语音音量」（它按 /guide/ 网址认）。
export const LINES = [
  ['heli', '坐亡命小飞机来的，这是个好事儿啊。'],       // 直升机降落（峰哥 2020 年真坐小飞机降落卢卡拉）
  ['yak', '牦牛给我让路？恰恰相反，是我挡了它的道。'], // 牦牛让路
  ['oxygen', '吸氧不丢人，恰恰相反，不吸才丢命。'],    // 北坳吸氧
  ['queue', '排队是好事儿啊，前面的人替我试过梯子了。'], // 第二台阶排队放行
  ['summit', '旗靠风吹开，恰恰相反，人得自己走上来。'],  // 登顶红旗展开
];
const KEY = 'everest_north_fx';
const Q = new URLSearchParams(location.search);
const MUTE = Q.get('voice') === '0' || Q.has('preview');
const clips = MUTE ? [] : LINES.map((_, k) => Object.assign(new Audio(`/guide/${KEY}/${k}.wav`), { preload: 'auto' }));   // 先下好：动作出来那一帧就能响
export function fgSay(key) {
  const i = LINES.findIndex(l => l[0] === key); if (i < 0) return;
  window.__fenggeHud?.say('map', LINES[i][1]);
  window.__fgMapLine = { t: performance.now(), key, text: LINES[i][1] };   // 给 voice.js / 气泡用：刚说过地标台词，大模型那句（红灯 / 登顶事件）可以晚一点或跳过，免得两句叠着念
  if (MUTE) return;
  const a = clips[i]; a.currentTime = 0; a.play().catch(() => {});   // 没缓存 / 浏览器不让出声：只有气泡
}
