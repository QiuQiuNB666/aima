// U 线 · 游戏设置（普通脚本，game.html 里在所有模块之前加载）。存 localStorage，展位用地址栏覆盖（地址栏写了的参数一律以地址栏为准）。
// 做法：各线的开关本来就读地址栏（?fx= ?npc= ?npctalk= ?guide= ?cam=，模块加载时读一次），这里在模块加载前把「和缺省不同的设置」
//   用 history.replaceState 补进地址栏，并记在 _si=… 里；下次载入先把 _si 列的删掉再按最新设置补，所以改了设置重载就生效，
//   地址栏本来就写着的参数不动（设置页里那一行显示「地址栏固定」）。没有改任何别人的文件。
// 音量：页面里所有声音都是 <audio>（峰哥解说 voice.js、导游 guide.js、捷风 npc.js），这里包一层 HTMLMediaElement.play，
//   按网址分两路设音量（/voice/last.wav、/guide/ = 峰哥；其它 = 捷风 / 音效）。「峰哥解说：少」= 只留登顶 / 红灯 / 造山 / 改手感，
//   其余几种（进新路段、跑起来、站着不动、和影子换位）气泡用 CSS 藏、声音在这里跳过（事件名由 hud.js 每 100 ms 写进 window.__uFg）。
// 只在浏览器里改显示和音量，不调任何 ShellOS 接口。调试：window.__settings.all()。
(function () {
  var KEY = 'fg_settings_v1';
  var DEFS = [
    { k: 'vFengge', name: '峰哥语音音量', vol: true, def: 100 },
    { k: 'vSfx', name: '捷风 / 音效音量', vol: true, def: 100 },
    { k: 'sub', name: '字幕（峰哥气泡）', opts: [['on', '开'], ['off', '关']], def: 'on' },
    { k: 'cam', name: '镜头', opts: [['follow', '跟拍'], ['front', '正面'], ['side', '侧面']], def: 'follow', param: 'cam' },
    { k: 'fx', name: '画质', opts: [['high', '高'], ['low', '低'], ['off', '关（最省）']], def: 'high', param: 'fx', reload: true },
    { k: 'npc', name: '捷风', opts: [['1', '出现'], ['0', '不出现']], def: '1', param: 'npc', reload: true },
    { k: 'npctalk', name: '捷风说话', opts: [['0', '不说话'], ['1', '说话']], def: '0', param: 'npctalk', reload: true },
    { k: 'guide', name: '峰哥导游', opts: [['1', '开'], ['0', '关']], def: '1', param: 'guide', reload: true },
    { k: 'fgrate', name: '峰哥解说', opts: [['high', '多'], ['low', '少（只说关键时刻）']], def: 'high' },
  ];
  var MINOR = { seg: 1, fast: 1, idle: 1, ghost: 1 };   // 「少」时不说的
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
  // 地址栏：先去掉上次补进去的，剩下的就是人写的
  var U = new URL(location.href), Q = U.searchParams, inj = (Q.get('_si') || '').split(',').filter(Boolean);
  inj.forEach(function (p) { Q.delete(p); }); Q.delete('_si');
  var fixed = {};
  DEFS.forEach(function (d) { if (d.param && Q.has(d.param)) fixed[d.k] = Q.get(d.param); });
  var val = function (k) {
    var d = DEFS.filter(function (x) { return x.k === k; })[0];
    if (!d) return undefined;
    if (k in fixed) return fixed[k];
    var v = saved[k];
    if (d.vol) return typeof v === 'number' && v >= 0 && v <= 100 ? v : d.def;
    return d.opts.some(function (o) { return o[0] === v; }) ? v : d.def;
  };
  var added = [];
  DEFS.forEach(function (d) { if (d.param && !(d.k in fixed) && val(d.k) !== d.def) { Q.set(d.param, val(d.k)); added.push(d.param); } });
  if (added.length) Q.set('_si', added.join(','));
  if (U.href !== location.href) try { history.replaceState(history.state, '', U.pathname + (Q.toString() ? '?' + Q : '') + U.hash); } catch (e) { /* file:// 预览 */ }

  var root = document.documentElement;
  function paint() { root.classList.toggle('nosub', val('sub') === 'off'); root.classList.toggle('fg-low', val('fgrate') === 'low'); }
  paint();

  var P = HTMLMediaElement.prototype, play = P.play;
  P.play = function () {
    try {
      var s = this.currentSrc || this.src || '', fg = /\/voice\/last\.wav|\/guide\//.test(s);
      if (fg && /\/voice\/last\.wav/.test(s) && val('fgrate') === 'low' && window.__uFg && MINOR[window.__uFg.event]) return Promise.resolve();
      this.volume = Math.max(0, Math.min(1, val(fg ? 'vFengge' : 'vSfx') / 100));
    } catch (e) { /* 设不上音量就按原样放 */ }
    return play.apply(this, arguments);
  };

  window.__settings = {
    defs: DEFS,
    get: val,
    fixed: function (k) { return k in fixed; },
    set: function (k, v) {
      if (k in fixed) return false;
      saved[k] = v;
      try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* 隐身窗口：本页有效，不落盘 */ }
      paint();
      return true;
    },
    reset: function () { saved = {}; try { localStorage.removeItem(KEY); } catch (e) { /* 同上 */ } paint(); },
    all: function () { var o = {}; DEFS.forEach(function (d) { o[d.k] = val(d.k); }); return o; },
  };
})();
