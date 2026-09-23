// 峰哥语音：轮询 /state.fengge，出了新的一句就播 /voice/last.wav。
// 引入：<script src="/voice/voice.js"></script>；页面地址加 ?voice=0 关掉（两块屏都引入时只留一块出声）。
// 浏览器不让没点过的页面自动出声：被拦时左下角出一个按钮，点一下 / 按任意键之后就一直能播。
(() => {
  if (new URLSearchParams(location.search).get("voice") === "0") return;
  let seen = null, audio = null, btn = null;

  const unlock = () => {
    if (btn) { btn.remove(); btn = null; }
    if (audio) audio.play().catch(() => {});
  };
  const ask = () => {
    if (btn) return;
    btn = document.createElement("button");
    btn.textContent = "🔈 点一下打开峰哥声音";
    btn.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:9999;padding:8px 14px;border:0;border-radius:8px;" +
      "background:rgba(0,0,0,.72);color:#fff;font:14px/1.4 system-ui,sans-serif;cursor:pointer";
    btn.onclick = unlock;
    document.body.appendChild(btn);
  };
  addEventListener("keydown", () => btn && unlock());

  const play = () => {
    if (audio) audio.pause();
    audio = new Audio("/voice/last.wav?_=" + Date.now());   // 没有 TTS 时是 204，播放失败，安静跳过
    audio.play().catch((e) => { if (e.name === "NotAllowedError") ask(); });
  };

  const poll = async () => {
    try {
      const f = (await (await fetch("/state", { cache: "no-store" })).json()).fengge || {};
      const sig = f.t + "|" + f.event + "|" + f.text;
      if (seen !== null && sig !== seen && f.text) play();   // 第一次只记住，不重播打开页面前那句
      seen = sig;
    } catch (e) { /* 服务重启中，下一轮再说 */ }
    setTimeout(poll, 1000);
  };
  poll();
})();
