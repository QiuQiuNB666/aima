import { createHandSimulation } from './hands-core.js';
import { createHandAngleInput } from './hands-input.js';
import { createHandReader } from './hands-reader.js';

// All outputs remain local animation. The optional reader only obtains angles.
const sim = createHandSimulation();
const $ = id => document.getElementById(id);
const canvas = $('scene'), ctx = canvas.getContext('2d');
const names = {legs:'腿部模式', released:'模拟已解绑', calibrated:'中位已校准', raising:'正在模拟抬起', ready:'双手模式 · 就位', paused:'模拟已暂停'};
let raf = null, previous = performance.now();
const lastShots = {left:0, right:0}, flash = {left:0, right:0};
const keys = new Set();
const angleInput = createHandAngleInput();
let inputSource = 'keyboard', telemetryNote = '读取单独配置的手部数据服务；配置方法见本页底部接入说明。';
const sourceNames = { hardware:'真实设备', simulation:'模拟器数据', replay:'回放数据' };
const reader = createHandReader({
  onSample(report) {
    if(report?.error === 'HANDS_SOURCE_NOT_CONFIGURED') {
      reader.stop(); angleInput.reset(); suspend(); telemetryNote='请配置独立的 SHELLOS_HANDS_PORT，手部不能复用腿部服务端口'; return;
    }
    const result = angleInput.ingest(report, Date.now(), performance.now());
    if (!result.ok) { reader.stop(); suspend(); telemetryNote = result.reason + '；请重新开始读取'; }
    else if (result.changed) { suspend(); telemetryNote = '数据来源改变，请重新记录三个位置'; }
    else if (telemetryNote === '正在读取本机 ShellOS…') telemetryNote = '';
  },
  onError(message) { angleInput.reset(); suspend(); telemetryNote = message; },
});

function stopReading(message) {
  reader.stop(); angleInput.reset(); suspend(); telemetryNote = message;
}
$('input-source').onchange = () => {
  stopReading('输入来源已切换，请重新准备'); inputSource = $('input-source').value;
  action({ type:'reset' }); render();
};
$('telemetry-start').onclick = () => {
  if (inputSource !== 'telemetry' || document.hidden) return;
  stopReading('正在读取本机 ShellOS…'); reader.start(); render();
};
$('telemetry-stop').onclick = () => { stopReading('读取已停止，重新开始后需要校准'); render(); };
for (const name of ['center','back','forward']) $('capture-'+name).onclick = () => {
  suspend();
  const result = angleInput.capture(name, performance.now());
  telemetryNote = result.reason || (result.complete ? '三点已记录。回到中位，应用校准后开始试玩' : '位置已记录，请继续记录其余位置');
  render();
};
$('export-calibration').onclick = () => {
  const record = angleInput.exportCalibration(performance.now()); if (!record) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(record,null,2)], {type:'application/json'}));
  const link = document.createElement('a'); link.href=url; link.download='Emma0923-hand-screen-calibration.json';
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function renderInput() {
  const enabled = inputSource === 'telemetry', status = angleInput.status(performance.now());
  $('telemetry-controls').hidden = !enabled;
  $('telemetry-start').disabled = reader.running;
  $('telemetry-stop').disabled = !reader.running;
  $('telemetry-source').textContent = status.source ? `${sourceNames[status.source.mode]} · ${status.source.port || '无实体串口'} · 只读` : '未连接';
  $('telemetry-status').textContent = telemetryNote || (!status.live ? '等待新鲜数据，画面保持暂停' : !status.calibrated ? '角度正在更新，请记录三个舒适位置' : !status.centered && sim.snapshot().stage !== 'ready' ? '请回到中位，再点击画面就位' : '角度输入已就绪，仅驱动画面');
  $('angle-left').textContent = status.angles ? `${status.angles.left.toFixed(1)}°` : '—';
  $('angle-right').textContent = status.angles ? `${status.angles.right.toFixed(1)}°` : '—';
  $('capture-quality').textContent = status.stable ? '已稳定，可以记录' : '等待稳住约一秒';
  for (const name of ['center','back','forward']) {
    $('capture-'+name).disabled = !status.stable;
    $('capture-'+name).classList.toggle('recorded',Boolean(status.poses[name]));
  }
  $('calibration-summary').textContent = Object.entries(status.poses).map(([name,pose]) => `${{center:'中位',back:'后拉',forward:'前推'}[name]}：${pose.left.toFixed(1)}° / ${pose.right.toFixed(1)}°`).join(' · ') || '尚未记录。三点校准只用于画面映射。';
  $('export-calibration').disabled = !status.live || !status.calibrated;
  return status;
}

function action(value) { sim.dispatch(value); render(); }
function zeroInputs() { keys.clear(); $('left').value = $('right').value = '0'; }
function suspend() { zeroInputs(); action({type:'suspend'}); }
function inputs() { if(inputSource === 'keyboard') action({type:'input',left:Number($('left').value)/100,right:Number($('right').value)/100}); }
$('release').onchange = () => { zeroInputs(); action({type:'set-release',value:$('release').checked}); };
$('calibrate').onclick = () => { if(inputSource === 'telemetry' && !angleInput.status(performance.now()).calibrated) return; zeroInputs(); action({type:'calibrate'}); };
$('grip').onchange = () => { if (!$('grip').checked) zeroInputs(); action({type:'hold',value:$('grip').checked}); };
$('raise').onclick = () => { if(inputSource === 'telemetry' && !angleInput.status(performance.now()).centered) return; telemetryNote=''; action({type:'raise'}); };
$('pause').onclick = suspend;
$('reset').onclick = () => { stopReading('已复位，重新读取后需要校准'); flash.left = flash.right = 0; action({type:'reset'}); };
$('damping').oninput = () => action({type:'damping',value:Number($('damping').value)/100});
$('left').oninput = $('right').oninput = inputs;
$('fire').onclick = () => action({type:'fire',side:'left'});
$('fire-right').onclick = () => action({type:'fire',side:'right'});
for (const scene of ['range','excavator']) $('scene-'+scene).onclick = () => {
  zeroInputs(); flash.left = flash.right = 0;
  // A held physical handle must not become a shot/motion on a scene switch.
  if(inputSource === 'telemetry') suspend();
  action({type:'scene',value:scene}); action({type:'input',left:0,right:0});
};

function render() {
  const s = sim.snapshot(), ready = s.stage === 'ready' && s.holding;
  const sourceStatus = renderInput(), measured = inputSource === 'telemetry';
  $('release').checked = s.released; $('grip').checked = s.holding;
  $('grip').disabled = !s.calibrated;
  $('calibrate').textContent = measured ? '应用角度校准' : '校准模拟中位';
  $('calibrate').disabled = !s.released || s.stage === 'raising' || s.stage === 'ready' || (measured && !sourceStatus.calibrated);
  $('raise').textContent = measured ? '画面就位，开始角度试玩' : '抬起到握持位置';
  $('raise').disabled = !s.calibrated || !s.holding || s.stage === 'raising' || s.stage === 'ready' || (measured && !sourceStatus.centered);
  $('pause').disabled = !s.holding && s.stage !== 'raising';
  $('left').disabled = $('right').disabled = !ready || measured;
  if (measured) { $('left').value=String(s.left*100); $('right').value=String(s.right*100); }
  $('fire').disabled = !ready || s.scene !== 'range';
  $('fire').hidden = s.scene !== 'range';
  $('fire-right').disabled = $('fire').disabled; $('fire-right').hidden = $('fire').hidden;
  $('stage-badge').textContent = names[s.stage] || '模拟已停止';
  $('raise-progress').style.width = `${s.raiseProgress*100}%`;
  $('step-release').classList.toggle('done',s.released);
  $('step-calibrate').classList.toggle('done',s.calibrated);
  $('step-raise').classList.toggle('done',s.stage === 'raising' || s.stage === 'ready');
  $('step-play').classList.toggle('done',ready);
  const status = !s.released ? '先勾选模拟解绑，再校准中位。'
    : !s.calibrated ? '校准两个虚拟输入的中位，准备切换手部模式。'
    : !s.holding ? '勾选模拟双手握持，再主动点击抬起就位。'
    : s.stage === 'raising' ? '支撑正在画面中缓慢抬起。取消握持可随时停止。'
    : ready ? measured ? '已就位。前推或后拉两根支撑杆，分别操控左右输入。' : '已就位。拖动左右输入，或使用键盘操作。'
    : '点击抬起到握持位置，继续模拟。';
  if ($('status').textContent !== status) $('status').textContent = status;
  $('damping-value').textContent = `${Math.round(s.damping*100)}%`;
  $('damping').value = String(s.damping*100);
  $('left-value').textContent = `${Math.round(s.left*100)}%`;
  $('right-value').textContent = `${Math.round(s.right*100)}%`;
  $('feedback-left').textContent = s.feedbackLeft.toFixed(2);
  $('feedback-right').textContent = s.feedbackRight.toFixed(2);
  const range = s.scene === 'range';
  $('scene-range').classList.toggle('selected',range); $('scene-range').setAttribute('aria-pressed',String(range));
  $('scene-excavator').classList.toggle('selected',!range); $('scene-excavator').setAttribute('aria-pressed',String(!range));
  $('left-label').textContent = range ? '左操作杆 · 左枪' : '左操作杆 · 动臂升降';
  $('right-label').textContent = range ? '右操作杆 · 右枪' : '右操作杆 · 铲斗收放';
  $('scene-title').textContent = range ? '让每一次触发，都有回应。' : '把整台机器，握在双手里。';
  $('scene-hint').textContent = range ? '前推哪侧操作杆，就触发哪侧枪；回拉后可再次前推。左右脉冲独立，仅显示反馈。'
    : '左杆升降动臂，右杆收放铲斗。回到中位即停止操作；旋转和行走留给后续模式扩展。';
  $('metric-label').textContent = range ? '左枪 / 右枪' : '动臂 / 铲斗';
  $('metric-value').textContent = range ? `${s.shotsLeft} / ${s.shotsRight}` : `${Math.round(s.excavator.boom*100)} / ${Math.round(s.excavator.bucket*100)}`;
  for(const side of ['left','right']) {
    const count = s[side === 'left' ? 'shotsLeft' : 'shotsRight'];
    if(count > lastShots[side] && range && ready) flash[side] = 1;
    lastShots[side] = count;
    if(!ready) flash[side] = 0;
  }
}

function line(points, color, width=3) {
  ctx.beginPath(); ctx.moveTo(...points[0]); for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.strokeStyle=color; ctx.lineWidth=width; ctx.lineCap='round'; ctx.lineJoin='round'; ctx.stroke();
}
function circle(x,y,r,color) { ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fillStyle=color; ctx.fill(); }
function label(text,x,y,size=14,color='#849574') { ctx.fillStyle=color; ctx.font=`${size}px Segoe UI, Microsoft YaHei, sans-serif`; ctx.fillText(text,x,y); }
function draw(s) {
  ctx.clearRect(0,0,1000,520);
  const sky=ctx.createLinearGradient(0,0,0,520); sky.addColorStop(0,'#f1f4eb'); sky.addColorStop(1,'#e8edde');
  ctx.fillStyle=sky; ctx.fillRect(0,0,1000,520);
  for(let x=0;x<1000;x+=55) line([[x,430],[500+(x-500)*.2,335]],'#dce3d1',1);
  for(let y=355;y<500;y+=30) line([[0,y],[1000,y]],'#dce3d1',1);
  ctx.fillStyle='#6a7e5710'; ctx.beginPath();ctx.ellipse(245,422,122,22,0,0,Math.PI*2);ctx.fill();
  circle(245,122,27,'#d3dcc7'); line([[245,155],[245,271]],'#becbb0',66);
  line([[223,284],[212,411]],'#bdcaae',27);line([[267,284],[278,411]],'#bdcaae',27);
  line([[199,270],[290,270]],'#253e2c',26);
  for (const [pivot,side,axis,feedback] of [[195,-1,s.left,s.feedbackLeft],[295,1,s.right,s.feedbackRight]]) {
    const p=s.raiseProgress;
    const endX=pivot+side*(12+p*45), endY=270+120*(1-p)-62*p-axis*30+feedback*12;
    line([[pivot,270],[endX,endY]],'#324a35',12); circle(pivot,270,17,'#2a432f');circle(pivot,270,8,'#a8c778');
    line([[endX-16,endY],[endX+16,endY]],'#24362a',15);
    if(s.holding){line([[245+side*34,178],[245+side*57,226],[endX,endY]],'#c2d1b4',18);circle(endX,endY,9,'#92ac6b');}
    else line([[245+side*34,177],[245+side*52,242]],'#c2d1b4',18);
    label(side<0?'L':'R',endX-5,endY+34,13,'#71855d');
    const barX=pivot+side*78;
    line([[barX,272],[barX,272-feedback*70]],feedback<0?'#af7e42':'#819f53',7);
  }
  label('双路支撑 · 虚拟姿态',164,471,15,'#6f835d');
  line([[430,80],[430,435]],'#dbe3d2',1);
  if(s.scene==='range') {
    for(const [side,tx,tint] of [['left',600,'#88a95b'],['right',830,'#b18958']]) {
      const ty=220, y=260-s[side]*60;
      line([[tx,ty+70],[tx,410]],'#a2b291',8);
      for(const [r,color] of [[72,'#d7e0cc'],[52,'#edf2e6'],[31,tint],[10,'#f4f7ec']])circle(tx,ty,r,color);
      line([[tx-19,y],[tx+19,y]],'#263f2b',2);line([[tx,y-19],[tx,y+19]],'#263f2b',2);
      line([[tx-20,430],[tx+12,400]],tint,16);
      if(flash[side]>0){ctx.globalAlpha=flash[side];line([[tx,405],[tx,y]],tint,5);circle(tx,y,8+22*(1-flash[side]),tint);ctx.globalAlpha=1;}
      label(side==='left'?'LEFT / 左枪':'RIGHT / 右枪',tx-43,470,13,'#70805f');
    }
  } else {
    const baseX=640,baseY=350;
    line([[565,408],[720,408]],'#344932',39);line([[574,408],[712,408]],'#7d9365',20);
    ctx.fillStyle='#b0c976'; ctx.fillRect(575,320,139,65);ctx.fillStyle='#516a42'; ctx.fillRect(585,270,62,67);
    ctx.fillStyle='#d9e5c4';ctx.fillRect(592,280,45,45);
    const angle=-.15-s.excavator.boom*1.25, elbow={x:baseX+150*Math.cos(angle),y:baseY+150*Math.sin(angle)};
    const tip={x:elbow.x+105*Math.cos(.7),y:elbow.y+105*Math.sin(.7)};
    line([[baseX,baseY],[elbow.x,elbow.y],[tip.x,tip.y]],'#9cb664',24);
    line([[baseX+5,baseY-18],[elbow.x-10,elbow.y+12]],'#637e4b',5);
    circle(baseX,baseY,14,'#46623a');circle(elbow.x,elbow.y,11,'#46623a');
    ctx.save();ctx.translate(tip.x,tip.y);ctx.rotate(-.8+s.excavator.bucket*1.7);
    ctx.fillStyle='#455e35';ctx.beginPath();ctx.moveTo(-10,-10);ctx.lineTo(44,0);ctx.lineTo(45,41);ctx.lineTo(2,30);ctx.closePath();ctx.fill();ctx.restore();
    label('DIG & DISCOVER',645,470,14,'#70805f');
  }
}

function keyboardInput(key) {
  // Editing one keyboard axis must not wipe the other hand's slider input.
  if (['a','d'].includes(key)) $('left').value=String((Number(keys.has('d'))-Number(keys.has('a')))*100);
  if (['j','l'].includes(key)) $('right').value=String((Number(keys.has('l'))-Number(keys.has('j')))*100);
  inputs();
}
window.addEventListener('keydown',event=>{
  const key=event.key.toLowerCase();
  if(key==='escape'){event.preventDefault();suspend();return;}
  if(event.ctrlKey||event.metaKey||event.altKey||!['a','d','j','l','f','h'].includes(key))return;
  if(event.target?.closest?.('select,textarea,input:not([type=range])') || event.target?.isContentEditable)return;
  if(inputSource === 'telemetry' && !['f','h'].includes(key))return;
  if(sim.snapshot().stage!=='ready')return;
  event.preventDefault();if(event.repeat)return;
  if(['f','h'].includes(key))action({type:'fire',side:key==='f'?'left':'right'});else{keys.add(key);keyboardInput(key);}
});
window.addEventListener('keyup',event=>{const key=event.key.toLowerCase();if(keys.delete(key))keyboardInput(key);});
function frame(now) {
  raf=null; if(document.hidden)return;
  const dt=Math.max(0,(now-previous)/1000);previous=now;
  if(inputSource === 'telemetry') {
    const input=angleInput.axes(now,dt), s=sim.snapshot();
    if(!input && ['raising','ready'].includes(s.stage)) { suspend(); telemetryNote='数据已过期或校准失效，画面暂停；恢复后回到中位并重新就位'; }
    else if(input && s.stage==='ready') sim.dispatch({type:'input',...input});
  }
  const state=sim.tick(dt);
  if(dt>0.25){zeroInputs();telemetryNote='页面更新中断，旧输入已清除，请重新就位';}
  for(const side of ['left','right']) flash[side]=Math.max(0,flash[side]-Math.min(dt,.05)*4);
  render();draw(state);raf=requestAnimationFrame(frame);
}
function startFrames(){previous=performance.now();if(raf===null&&!document.hidden)raf=requestAnimationFrame(frame);}
function stopFrames(){if(raf!==null)cancelAnimationFrame(raf);raf=null;stopReading('离开页面后读取已停止，请重新开始并校准');}
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopFrames();else startFrames();});
window.addEventListener('blur',suspend);
window.addEventListener('offline',()=>stopReading('网络不可用，读取已停止'));
window.addEventListener('pagehide',stopFrames);
window.addEventListener('pageshow',startFrames);
render();draw(sim.snapshot());startFrames();
