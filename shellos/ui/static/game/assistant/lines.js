// J 线 · 助理的台词（第 7 轮）：15 句干练的助理话术，不碰两性话题（峰哥人设禁），只做带路 / 提醒 / 照应。
// 声音：MiniMax 系统预设女声（shellos/agent/voice.py 的 ASST_VOICE），不用真人录音；`python3 brain/tts.py --asst` 预生成进缓存，
//   /voice/npc.wav 对这些句子**只读缓存**（没缓存就不出声，只出气泡）。改台词要同步 voice.py 的 ASST_LINES（tests/test_voice.py 会对一遍）。
// 地标那句气泡写「前面就是 xx」（地名是路线里的，每张图不一样），声音统一念 mark 这句。
export const LINES = {
  start: '出发！我在前面带路。',
  mark: '看前面，到地标了。',
  follow: '这段路我查过，跟着我。',
  red: '红灯，先停一下。',
  green: '绿灯了，走吧。',
  pace: '节奏很好，保持住。',
  stairs: '台阶来了，抬脚。',
  down: '下坡慢一点，膝盖放松。',
  oxygen: '氧气给你，慢慢吸。',
  queue: '排队呢，我在前面挡着。',
  go: '到你了，上！',
  summit: '登顶了！来，击个掌！',
  rest: '喝口水，歇十秒。',
  wind: '风大，拉好拉链。',
  wait: '我在这儿，你慢慢来。',
};
