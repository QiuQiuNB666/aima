import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHandSimulation } from './hands-core.js';
import { createHandAngleInput } from './hands-input.js';
import { createHandReader } from './hands-reader.js';

const source = (await readFile(new URL('./hands-controller.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const markup = await readFile(new URL('./hands.html', import.meta.url), 'utf8');
const flush = async () => { for(let i=0;i<8;i++) await Promise.resolve(); };
class Events {
  listeners = new Map();
  addEventListener(name, fn) { if(!this.listeners.has(name)) this.listeners.set(name,[]); this.listeners.get(name).push(fn); }
  emit(name, data={}) { for(const fn of this.listeners.get(name)||[]) fn({preventDefault(){},...data}); }
}
function fixture() {
  const elements = new Map([...markup.matchAll(/\bid="([^"]+)"/g)].map(([,id]) => [id, {
    value:'0', textContent:'', checked:false, hidden:false, disabled:false, style:{},
    classList:{toggle(){}}, setAttribute(){},
  }]));
  const canvas = new Proxy({}, {get:(_,key) => key === 'createLinearGradient' ? () => ({addColorStop(){}}) : () => {}});
  elements.get('scene').getContext = () => canvas;
  const el = id => { assert.ok(elements.has(id), `Markup must contain ${id}`); return elements.get(id); };
  const document = Object.assign(new Events(), {hidden:false,getElementById:el});
  const window = new Events(), sim = createHandSimulation();
  let clock=0, serial=0;
  const frames=new Map(), timers=new Map(), calls=[];
  const schedule=(fn,ms) => {const id=++serial;timers.set(id,{fn,due:clock+ms});return id;};
  const cancel=id=>timers.delete(id), fetcher=(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject}));
  class ClockDate extends Date { static now(){return 1700000000000+clock;} }
  vm.runInNewContext(source, {
    document,window,performance:{now:()=>clock},Date:ClockDate,
    createHandSimulation:()=>sim,createHandAngleInput,
    createHandReader:options=>createHandReader({...options,fetcher,schedule,cancel,clock:()=>clock}),
    requestAnimationFrame:fn=>{const id=++serial;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
    setTimeout:schedule,clearTimeout:cancel,
  },{filename:'hands-controller.js'});
  async function advance(ms=50) {
    clock+=ms;
    for(const [id,timer] of [...timers]) if(timer.due<=clock){timers.delete(id);timer.fn();}
    for(const [id,fn] of [...frames]) {frames.delete(id);fn(clock);}
    await flush();
  }
  async function prepare() {
    el('release').checked=true;el('release').onchange();el('calibrate').onclick();
    el('grip').checked=true;el('grip').onchange();el('raise').onclick();
    for(let i=0;i<26;i++)await advance();
    assert.equal(sim.snapshot().stage,'ready');
  }
  function telemetry() {el('input-source').value='telemetry';el('input-source').onchange();el('telemetry-start').onclick();}
  async function reply(value) {calls.at(-1).resolve({ok:true,json:async()=>value});await flush();await advance(1);}
  return {el,document,window,sim,frames,timers,calls,advance,prepare,telemetry,reply};
}

test('page initializes inert, keyboard keeps the other slider axis, and each gun has its own button', async()=>{
  const f=fixture();assert.equal(f.calls.length,0);await f.prepare();
  f.el('right').value='-40';f.el('right').oninput();
  f.window.emit('keydown',{key:'d'});
  assert.equal(f.sim.snapshot().right,-0.4);assert.equal(f.sim.snapshot().shotsLeft,1);assert.equal(f.sim.snapshot().shotsRight,0);
  f.window.emit('keyup',{key:'d'});assert.equal(f.sim.snapshot().left,0);assert.equal(f.sim.snapshot().right,-0.4);
  f.el('fire-right').onclick();assert.equal(f.el('metric-value').textContent,'1 / 1');
  f.el('scene-excavator').onclick();assert.equal(f.el('fire').hidden,true);assert.equal(f.el('fire-right').hidden,true);
});

test('a stalled frame freezes excavator motion, clears held keys and requires explicit rearming',async()=>{
  const f=fixture();await f.prepare();f.el('scene-excavator').onclick();f.window.emit('keydown',{key:'d'});await f.advance();
  const position=f.sim.snapshot().excavator.boom;
  await f.advance(500);assert.equal(f.sim.snapshot().stage,'paused');assert.equal(f.el('grip').checked,false);
  assert.equal(f.el('left').value,'0');assert.equal(f.sim.snapshot().excavator.boom,position);
  await f.advance();assert.equal(f.sim.snapshot().excavator.boom,position);
  f.el('grip').checked=true;f.el('grip').onchange();await f.advance();assert.equal(f.sim.snapshot().stage,'paused');
});

test('hiding, leaving, stopping, switching sources and going offline abort optional telemetry without late revival',async()=>{
  for(const ending of ['hide','pagehide','stop','switch','offline']) {
    const f=fixture();f.telemetry();const call=f.calls[0];assert.equal(call.url,'/api/hands-telemetry');assert.equal(call.options.method,'GET');
    if(ending==='hide'){f.document.hidden=true;f.document.emit('visibilitychange');}
    if(ending==='pagehide')f.window.emit('pagehide');
    if(ending==='stop')f.el('telemetry-stop').onclick();
    if(ending==='switch'){f.el('input-source').value='keyboard';f.el('input-source').onchange();}
    if(ending==='offline')f.window.emit('offline');
    assert.equal(call.options.signal.aborted,true,ending);assert.equal(f.timers.size,0,ending);
    await f.reply({available:false});assert.equal(f.el('telemetry-source').textContent,'未连接');assert.equal(f.calls.length,1);
  }
});

test('unconfigured hand source has actionable status and never enables angle play',async()=>{
  const f=fixture();f.telemetry();await f.reply({available:false,error:'HANDS_SOURCE_NOT_CONFIGURED'});
  assert.match(f.el('telemetry-status').textContent,/SHELLOS_HANDS_PORT/);
  assert.equal(f.el('telemetry-start').disabled,false);assert.equal(f.el('calibrate').disabled,true);
  assert.equal(f.el('raise').disabled,true);assert.equal(f.el('capture-center').disabled,true);
});

test('changing measured-game scene pauses instead of turning a held excavator input into a gun shot',async()=>{
  const f=fixture();await f.prepare();f.el('input-source').value='telemetry';f.el('input-source').onchange();
  for(const action of [{type:'set-release',value:true},{type:'calibrate'},{type:'hold',value:true},{type:'raise'}])f.sim.dispatch(action);
  for(let i=0;i<26;i++)f.sim.tick(.05);
  f.sim.dispatch({type:'scene',value:'excavator'});f.sim.dispatch({type:'input',left:1,right:1});
  f.el('scene-range').onclick();assert.equal(f.sim.snapshot().stage,'paused');assert.equal(f.sim.snapshot().shots,0);
  assert.equal(f.sim.snapshot().left,0);assert.equal(f.sim.snapshot().right,0);
});
