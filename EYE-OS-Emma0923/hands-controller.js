import { createHandSimulation } from './hands-core.js';

// Local animation only. No fetch, device API, command bus or hardware adapter.
const sim = createHandSimulation();
const $ = id => document.getElementById(id);
const canvas = $('scene'), ctx = canvas.getContext('2d');
const names = {legs:'腿部模式', released:'模拟已解绑', calibrated:'中位已校准', raising:'正在模拟抬起', ready:'双手模式 · 就位', paused:'模拟已暂停'};
let raf = null, previous = performance.now(), lastShots = 0, flash = 0;
const keys = new Set();

function action(value) { sim.dispatch(value); render(); }
function zeroInputs() { keys.clear(); $('left').value = $('right').value = '0'; }
function suspend() { zeroInputs(); action({type:'suspend'}); }
function inputs() { action({type:'input',left:Number($('left').value)/100,right:Number($('right').value)/100}); }
$('release').onchange = () => { zeroInputs(); action({type:'set-release',value:$('release').checked}); };
$('calibrate').onclick = () => { zeroInputs(); action({type:'calibrate'}); };
$('grip').onchange = () => { if (!$('grip').checked) zeroInputs(); action({type:'hold',value:$('grip').checked}); };
$('raise').onclick = () => action({type:'raise'});
$('pause').onclick = suspend;
$('reset').onclick = () => { zeroInputs(); flash = 0; action({type:'reset'}); };
$('damping').oninput = () => action({type:'damping',value:Number($('damping').value)/100});
$('left').oninput = $('right').oninput = inputs;
$('fire').onclick = () => action({type:'fire'});
for (const scene of ['range','excavator']) $('scene-'+scene).onclick = () => {
  zeroInputs(); flash = 0; action({type:'scene',value:scene}); action({type:'input',left:0,right:0});
};

function render() {
  const s = sim.snapshot(), ready = s.stage === 'ready' && s.holding;
  $('release').checked = s.released; $('grip').checked = s.holding;
  $('grip').disabled = !s.calibrated;
  $('calibrate').disabled = !s.released || s.stage === 'raising' || s.stage === 'ready';
  $('raise').disabled = !s.calibrated || !s.holding || s.stage === 'raising' || s.stage === 'ready';
  $('pause').disabled = !s.holding && s.stage !== 'raising';
  $('left').disabled = $('right').disabled = !ready;
  $('fire').disabled = !ready || s.scene !== 'range';
  $('fire').hidden = s.scene !== 'range';
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
    : ready ? '已就位。拖动左右输入，或使用键盘操作。'
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
  $('left-label').textContent = range ? '左手 · 横向瞄准' : '左手 · 动臂升降';
  $('right-label').textContent = range ? '右手 · 纵向瞄准' : '右手 · 铲斗收放';
  $('scene-title').textContent = range ? '让每一次触发，都有回应。' : '把整台机器，握在双手里。';
  $('scene-hint').textContent = range ? '两手输入控制虚拟准星；触发后显示短促反馈。这里不会让真实支撑震动。'
    : '左杆升降动臂，右杆收放铲斗。回到中位即停止操作；旋转和行走留给后续模式扩展。';
  $('metric-label').textContent = range ? '脉冲次数' : '动臂 / 铲斗';
  $('metric-value').textContent = range ? String(s.shots) : `${Math.round(s.excavator.boom*100)} / ${Math.round(s.excavator.bucket*100)}`;
  if (s.shots > lastShots && range && ready) flash = 1;
  lastShots = s.shots;
  if (!ready) flash = 0;
  draw(s);
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
    const tx=735,ty=240;
    line([[tx,ty+90],[tx,420]],'#a2b291',9);
    for(const [r,color] of [[99,'#d7e0cc'],[75,'#edf2e6'],[49,'#adc18e'],[25,'#f4f7ec'],[9,'#6d8b49']]) circle(tx,ty,r,color);
    const x=tx+s.left*145,y=ty-s.right*120;
    line([[x-20,y],[x-7,y]],'#263f2b',2);line([[x+7,y],[x+20,y]],'#263f2b',2);
    line([[x,y-20],[x,y-7]],'#263f2b',2);line([[x,y+7],[x,y+20]],'#263f2b',2);
    if(flash>0){ctx.globalAlpha=flash;line([[600,415],[x,y]],'#b6d581',5);circle(x,y,8+22*(1-flash),'#b4cd80');ctx.globalAlpha=1;}
    label('PULSE RANGE',661,470,14,'#70805f');
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

function keyboardInput() {
  $('left').value=String((Number(keys.has('d'))-Number(keys.has('a')))*100);
  $('right').value=String((Number(keys.has('l'))-Number(keys.has('j')))*100); inputs();
}
window.addEventListener('keydown',event=>{
  const key=event.key.toLowerCase();
  if(key==='escape'){event.preventDefault();suspend();return;}
  if(event.ctrlKey||event.metaKey||event.altKey||!['a','d','j','l','f'].includes(key))return;
  if(sim.snapshot().stage!=='ready')return;
  event.preventDefault();if(event.repeat)return;
  if(key==='f')action({type:'fire'});else{keys.add(key);keyboardInput();}
});
window.addEventListener('keyup',event=>{const key=event.key.toLowerCase();if(keys.delete(key))keyboardInput();});
function frame(now) {
  raf=null; if(document.hidden)return;
  const dt=Math.max(0,(now-previous)/1000);previous=now;
  sim.tick(dt);flash=Math.max(0,flash-Math.min(dt,.05)*4);render();raf=requestAnimationFrame(frame);
}
function startFrames(){previous=performance.now();if(raf===null&&!document.hidden)raf=requestAnimationFrame(frame);}
function stopFrames(){if(raf!==null)cancelAnimationFrame(raf);raf=null;suspend();}
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopFrames();else startFrames();});
window.addEventListener('blur',suspend);
window.addEventListener('pagehide',stopFrames);
window.addEventListener('pageshow',startFrames);
render();startFrames();
