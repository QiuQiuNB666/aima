'use strict';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const icons = {
  grid:'<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  wave:'<path d="M3 10v4m4-8v12m5-15v18m5-15v12m4-8v4"/>',
  folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 9h18"/>',
  sliders:'<path d="M4 7h6m4 0h6M4 17h10m4 0h2"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01"/>',
  bluetooth:'<path d="m7 7 10 10-5 4V3l5 4L7 17"/>',
  battery:'<rect x="2" y="6" width="17" height="12" rx="3"/><path d="M22 10v4M6 10v4m4-4v4"/>',
  volume:'<path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  refresh:'<path d="M20 7v-4m0 4h-4M4 17v4m0-4h4M20 7a9 9 0 0 0-16 1m0 9a9 9 0 0 0 16-1"/>',
  arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
  mic:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  text:'<path d="M4 5V3h16v2M12 3v18m-4 0h8"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  play:'<path d="m8 4 12 8-12 8Z"/>',
  pause:'<path d="M8 4v16m8-16v16"/>',
  stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',
  headphones:'<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="3" y="12" width="4" height="9" rx="2"/><rect x="17" y="12" width="4" height="9" rx="2"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  camera:'<path d="m8 6 2-3h4l2 3h4v14H4V6Z"/><circle cx="12" cy="13" r="4"/>',
  video:'<rect x="2" y="5" width="13" height="14" rx="3"/><path d="m15 9 7-4v14l-7-4"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  globe:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  chip:'<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.spark}</svg>`;
function hydrateIcons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const duration = (milliseconds) => { const seconds = Math.floor(Math.max(0, milliseconds) / 1000); return `${String(Math.floor(seconds / 60)).padStart(2,'0')}:${String(seconds % 60).padStart(2,'0')}`; };
const state = {page:'overview',lab:'record',device:null,bridge:false,refreshing:false,testBusy:false,hearing:'待你确认',filter:'all',media:[],urls:[],voices:[],speechToken:0};
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4200); }
let dialogCleanup = null;
function closeDialog() { $('#app-dialog').close(); if (dialogCleanup) { dialogCleanup(); dialogCleanup = null; } }
function showDialog(html, onShow, cleanup) { closeDialog(); $('#dialog-body').innerHTML = html; hydrateIcons($('#dialog-body')); dialogCleanup = cleanup || null; $('#app-dialog').showModal(); onShow?.(); }
$('#dialog-close').addEventListener('click', closeDialog);
$('#app-dialog').addEventListener('click', event => { if (event.target === $('#app-dialog')) closeDialog(); });
$('#app-dialog').addEventListener('close', () => { if (dialogCleanup) { dialogCleanup(); dialogCleanup = null; } });

const pages = {overview:['MAKE ROOM FOR THE WORLD','轻装，出发。'],lab:['A SPACE FOR SOUND','听见，更多。'],library:['KEEP THE LITTLE THINGS','好片段，随身带。'],device:['GET TO KNOW YOUR GLASSES','简单，也清楚。']};
function navigate(page) {
  if (!pages[page]) page = 'overview';
  if (state.page === 'lab' && page !== 'lab') { stopRecording(); stopSpeech(); }
  state.page = page;
  $$('.page').forEach(el => el.classList.toggle('hidden', el.id !== `page-${page}`));
  window.dispatchEvent(new CustomEvent('eye:page', {detail:{page}}));
  $$('.nav-button').forEach(el => { const active = el.dataset.page === page; el.classList.toggle('active',active); if(active) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current'); });
  $('#page-kicker').textContent = pages[page][0]; $('#page-title').textContent = pages[page][1];
  if (location.hash !== `#${page}`) history.replaceState(null,'',`#${page}`);
  if (page === 'library') renderLibrary();
  window.scrollTo({top:0,behavior:'instant'});
}
function labTab(tab) {
  if (state.lab === 'record' && tab !== 'record') stopRecording();
  if (tab !== state.lab) stopSpeech();
  state.lab = tab;
  $$('.lab-panel').forEach(el => el.classList.toggle('hidden',el.id !== `lab-${tab}`));
  $$('[data-lab]').forEach(el => { el.classList.toggle('active',el.dataset.lab === tab); el.setAttribute('aria-selected',el.dataset.lab === tab); });
}
function openLab(tab) { navigate('lab'); labTab(tab); }
document.addEventListener('click', event => {
  const pageButton = event.target.closest('[data-page]'); if(pageButton) navigate(pageButton.dataset.page);
  const labButton = event.target.closest('[data-lab]'); if(labButton) labTab(labButton.dataset.lab);
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'refresh') refreshDevice(true);
  if (action === 'connect-help') connectionHelp();
  if (action === 'test-audio') testAudio();
  if (action === 'open-record') openLab('record');
  if (action === 'open-speak') openLab('speak');
  if (action === 'open-tour') openLab('tour');
  if (action === 'import') $('#file-input').click();
  if (action === 'sample-media') importSample();
});
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));

async function refreshDevice(manual = false) {
  if(state.refreshing) return; state.refreshing = true;
  $$('[data-action="refresh"]').forEach(el => el.disabled = true);
  try {
    const response = await fetch('./api/device', {signal:AbortSignal.timeout(20000),cache:'no-store'});
    if(!response.ok) throw new Error('bridge unavailable');
    const data = await response.json();
    const wasActive = state.device?.playback?.active;
    state.device = data; state.bridge = data.bridge === true && data.platform === 'windows';
    if(wasActive !== data.playback?.active) state.hearing = '待你确认';
    if(manual) toast(data.error ? '设备状态暂不可读，请检查本机连接服务。' : '已刷新设备状态。实际听感仍以试听为准。');
  } catch {
    state.device = null; state.bridge = false; state.hearing = '待你确认';
    if(manual) toast('已切换为浏览器模式，请在系统设置中连接眼镜。');
  } finally {
    state.refreshing = false; $$('[data-action="refresh"]').forEach(el => el.disabled = false); renderDevice();
  }
}
function renderDevice() {
  const d = state.device, native = state.bridge, unavailable = native && Boolean(d?.error), output = native && d?.playback?.active, input = native && d?.microphone?.active;
  $('#connection-label').textContent = unavailable ? '设备状态暂不可读' : native ? (output ? '已识别音频设备' : '等待连接眼镜') : '手机 / 浏览器模式';
  $('#connection-pill').classList.toggle('is-connected',!!output);
  $('#bridge-badge').textContent = native ? '本机连接' : '系统管理';
  $('#output-state').textContent = unavailable ? '状态读取失败' : native ? (output ? (d.playback.muted ? '已静音' : '端点可用') : '未检测到') : '由系统选择';
  $('#input-state').textContent = unavailable ? '状态读取失败' : native ? (input ? '端点可用 · 待试录' : '未检测到') : '录音时确认';
  $('#hearing-state').textContent = state.hearing;
  const v = d?.playback?.volume;
  $('#device-volume').textContent = native && typeof v === 'number' ? `${Math.round(v)}%` : '由系统管理';
  $('#device-footnote').textContent = unavailable ? '暂未获得状态，请稍后重新检查。' : native ? '已识别 ≠ 已听到，请用试听确认。' : '先在手机系统中配对蓝牙眼镜。';
  const rows = [
    ['运行方式',native?'Windows 本机连接':'独立浏览器'],['声音输出',native?(output?'E06 输出端点可用':'未发现可用 E06 输出'):'系统当前音频输出'],['麦克风',native?(input?'E06 输入端点可用':'未发现可用 E06 输入'):'需授权并选择实际音源'],['实际听感',state.hearing],['眼镜电量','未开放读取'],['厂商接口','尚未接入']
  ];
  if(unavailable){rows[1][1]='状态读取失败';rows[2][1]='状态读取失败';rows.push(['检测说明',d.notes?.[0]||'请稍后重试']);}
  $('#device-diagnostics').innerHTML = rows.map(([a,b])=>`<div class="capability-item"><span>${escapeHTML(a)}</span><strong>${escapeHTML(b)}</strong></div>`).join('');
  $('#diagnostic-time').textContent = d?.checkedAt ? `最近检查：${new Date(d.checkedAt).toLocaleTimeString('zh-CN')}` : '本页不直接读取手机蓝牙配对状态。';
}
function connectionHelp() {
  showDialog(`<span class="eyebrow">CONNECT & GO</span><h2>让眼镜，连上手机。</h2><ol class="connection-steps"><li><strong>打开系统蓝牙设置</strong><p>让眼镜进入配对模式，选择 E06-003B。网页不能替你完成系统配对。</p></li><li><strong>确认声音输出</strong><p>在手机音频输出菜单选择眼镜，再回来点「听一听」。</p></li><li><strong>再试麦克风</strong><p>进入声音实验室，授权并确认音源。能播放音乐，不代表所有应用都能使用眼镜麦克风。</p></li></ol><div class="status-banner">手机端需在 HTTPS 页面打开本应用。当前电脑 localhost 地址不能直接在手机上访问。</div><button class="btn primary full" id="connection-done">知道了</button>`,()=>$('#connection-done').onclick=closeDialog);
}
$('#help-button').onclick = () => showDialog(`<span class="eyebrow">HELLO, EYE OS</span><h2>一副眼镜，一个轻巧入口。</h2><p>这是为 E06 制作的独立控制台，支持手机布局。音频、朗读和本地资料可以先用起来。</p><p>拍摄、眼镜内文件、电量、固件等专有功能，仍需厂商提供接口。它不会刷写或替换眼镜里的系统。</p><div class="status-banner">录音与资料保存在当前浏览器。系统语音可能由系统提供在线或离线声音。</div><button class="btn primary full" id="help-done">开始探索</button>`,()=>$('#help-done').onclick=closeDialog);

function hearingDialog(kind) {
  showDialog(`<span class="eyebrow">A LITTLE SOUND CHECK</span><h2>这一次，听到了吗？</h2><p>${escapeHTML(kind)}。软件完成播放，不代表耳边一定有声音。</p><div class="button-row"><button class="btn primary" id="heard-yes">听到了，很清楚</button><button class="btn secondary" id="heard-no">没有听到</button></div>`,()=>{
    $('#heard-yes').onclick = () => { state.hearing='本次试听已确认';renderDevice();closeDialog();toast('已记录本次试听成功。'); };
    $('#heard-no').onclick = () => { state.hearing='本次试听未听到';renderDevice();showDialog('<h2>一起检查这三处。</h2><ol class="connection-steps"><li>眼镜是否开机，并连接到当前这台设备。</li><li>系统是否选中了 E06，音量是否合适。</li><li>眼镜是否被另一台手机抢占了音频连接。</li></ol><p class="hint">已记为「未听到」，不会自动判定测试通过。</p>'); };
  });
}
async function browserTone() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if(!Context) throw new Error('当前浏览器不支持提示音播放。');
  const audio = new Context();
  try {
    await audio.resume(); const start = audio.currentTime + 0.35;
    [0,0.6,1.8,2.4].forEach((offset,index)=>{const osc=audio.createOscillator(),gain=audio.createGain();osc.frequency.value=index%2?659.25:523.25;gain.gain.setValueAtTime(0,start+offset);gain.gain.linearRampToValueAtTime(0.04,start+offset+0.03);gain.gain.setValueAtTime(0.04,start+offset+0.27);gain.gain.linearRampToValueAtTime(0,start+offset+0.32);osc.connect(gain).connect(audio.destination);osc.start(start+offset);osc.stop(start+offset+0.34);});
    await new Promise(resolve=>setTimeout(resolve,3500));
  } finally { await audio.close(); }
}
async function testAudio() {
  if(state.testBusy) return;
  if(recorder || micPending) { toast('请先结束录音，再测试播放。'); return; }
  stopSpeech();
  if(!state.bridge) {
    showDialog('<span class="eyebrow">SOUND CHECK</span><h2>先选择你的眼镜。</h2><p>浏览器会向系统当前输出播放轻柔提示音。请先在手机或电脑的音频菜单选择 E06。</p><button class="btn primary full" id="browser-tone-start">准备好了，播放</button>',()=>{
      $('#browser-tone-start').onclick=async()=>{closeDialog();state.testBusy=true;setTestButtons(true);try{await browserTone();hearingDialog('提示音已发往系统当前输出');}catch(error){toast(error.message);}finally{state.testBusy=false;setTestButtons(false);}};
    }); return;
  }
  state.testBusy=true;setTestButtons(true);toast('向 E06 播放两组轻柔提示音，约 9 秒。');
  try {
    const response=await fetch('./api/audio/test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(30000)});
    const data=await response.json(); if(!response.ok || !data.ok) throw new Error(data.message || data.error || '播放失败，请检查连接。');
    hearingDialog('提示音已发往 E06-003B 指定输出');
  } catch(error) {state.hearing='播放未完成';renderDevice();toast(error.name==='TimeoutError'?'测试等待超时，请检查设备后重试。':error.message);}
  finally{state.testBusy=false;setTestButtons(false);}
}
function setTestButtons(busy){$$('[data-action="test-audio"]').forEach(el=>{el.disabled=busy;el.setAttribute('aria-busy',busy);});}

// Local-only media storage. No audio or file upload endpoint exists.
let databasePromise;
function database(){
  if(!databasePromise) databasePromise=new Promise((resolve,reject)=>{const request=indexedDB.open('eyeos-media',1);request.onupgradeneeded=()=>request.result.createObjectStore('media',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('浏览器本地存储不可用。'));});
  return databasePromise;
}
async function mediaTransaction(mode,operation){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('media',mode);const request=operation(tx.objectStore('media'));let value;request.onsuccess=()=>value=request.result;tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(tx.error||new Error('保存失败'));tx.onabort=()=>reject(tx.error||new Error('保存被取消'));});}
async function loadMedia(){try{state.media=(await mediaTransaction('readonly',store=>store.getAll())).sort((a,b)=>b.createdAt-a.createdAt);renderLibrary();}catch{toast('本地资料库不可用；请检查浏览器存储权限。');}}
const uid=()=>crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
function classify(type){return type.startsWith('image/')?'image':type.startsWith('video/')?'video':'audio';}
async function addMedia(blob,name,source='导入',seconds=null){const item={id:uid(),name,blob,type:classify(blob.type),mime:blob.type,size:blob.size,createdAt:Date.now(),source,seconds};await mediaTransaction('readwrite',store=>store.put(item));await loadMedia();return item;}
async function importSample(){try{const response=await fetch('./icon.svg');if(!response.ok)throw new Error('sample');await addMedia(await response.blob(),'EYE OS 示例图标.svg','本地示例');toast('已加入一份示例图标，可预览和下载。');}catch{toast('示例保存失败，请检查浏览器本地存储。');}}
function formatSize(bytes){return bytes<1024*1024?`${Math.max(1,Math.round(bytes/1024))} KB`:`${(bytes/(1024*1024)).toFixed(1)} MB`;}
function renderLibrary(){
  state.urls.forEach(url=>URL.revokeObjectURL(url));state.urls=[];
  $('#nav-count').textContent=state.media.length;$('#library-total').textContent=state.media.length;
  const items=state.media.filter(item=>state.filter==='all'||item.type===state.filter);
  $('#library-empty').classList.toggle('hidden',items.length>0);
  $('#library-list').innerHTML=items.map(item=>{
    let cover=icon(item.type==='audio'?'wave':item.type==='video'?'video':'image');
    if(item.type==='image'){const url=URL.createObjectURL(item.blob);state.urls.push(url);cover=`<img src="${url}" alt="${escapeHTML(item.name)}" loading="lazy">`;}
    return `<article class="media-card"><button class="media-cover ${item.type}" data-preview="${item.id}" aria-label="预览 ${escapeHTML(item.name)}">${cover}<span class="media-type">${({audio:'音频',video:'视频',image:'照片'})[item.type]}</span></button><div class="media-info"><h3 title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</h3><p>${escapeHTML(item.source)} · ${formatSize(item.size)} · ${new Date(item.createdAt).toLocaleDateString('zh-CN')}</p><div class="media-actions"><button class="icon-button" data-download="${item.id}" aria-label="下载 ${escapeHTML(item.name)}">${icon('download')}</button><button class="icon-button" data-delete="${item.id}" aria-label="删除 ${escapeHTML(item.name)}">${icon('trash')}</button></div></div></article>`;
  }).join('');
}
$('#file-input').addEventListener('change',async event=>{
  const files=[...event.target.files];event.target.value='';if(!files.length)return;
  let count=0;
  for(const file of files){if(!/^(audio|image|video)\//.test(file.type)){toast(`不支持 ${file.name}：请选择音频、照片或视频。`);continue;}if(file.size>100*1024*1024){toast(`${file.name} 超过单文件 100 MB 上限。`);continue;}try{await addMedia(file,file.name);count++;}catch{toast('保存失败，可能是本地存储空间不足。');break;}}
  navigate('library');if(count)toast(`已导入 ${count} 份文件，仅保存在当前浏览器。`);
});
$$('[data-filter]').forEach(button=>button.onclick=()=>{state.filter=button.dataset.filter;$$('[data-filter]').forEach(el=>el.classList.toggle('active',el===button));renderLibrary();});
function downloadItem(item){const url=URL.createObjectURL(item.blob),link=document.createElement('a');link.href=url;link.download=item.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
document.addEventListener('click',event=>{
  const preview=event.target.closest('[data-preview]')?.dataset.preview;
  const download=event.target.closest('[data-download]')?.dataset.download;
  const remove=event.target.closest('[data-delete]')?.dataset.delete;
  const item=state.media.find(item=>item.id===(preview||download||remove));if(!item)return;
  if(download){downloadItem(item);return;}
  if(remove){showDialog(`<h2>删除这个片段？</h2><p>${escapeHTML(item.name)}</p><p class="hint">只删除此浏览器中的副本。此操作无法撤销。</p><div class="button-row"><button class="btn danger" id="confirm-delete">删除</button><button class="btn secondary" id="cancel-delete">保留</button></div>`,()=>{$('#cancel-delete').onclick=closeDialog;$('#confirm-delete').onclick=async()=>{try{await mediaTransaction('readwrite',store=>store.delete(item.id));closeDialog();await loadMedia();toast('已删除本地副本。');}catch{toast('删除失败，请重试。');}};});return;}
  stopSpeech();const url=URL.createObjectURL(item.blob);
  const player=item.type==='image'?`<img class="media-preview" src="${url}" alt="${escapeHTML(item.name)}">`:`<${item.type} class="media-preview" src="${url}" controls playsinline preload="metadata"></${item.type}>`;
  showDialog(`<h2>${escapeHTML(item.name)}</h2>${player}<p class="hint">${escapeHTML(item.source)} · ${formatSize(item.size)}。音频经由系统当前输出播放。</p><button class="btn secondary" id="preview-download">下载备份</button>`,()=>$('#preview-download').onclick=()=>downloadItem(item),()=>{const player=$('#dialog-body audio, #dialog-body video');player?.pause();URL.revokeObjectURL(url);});
});

let recorder=null,micStream=null,micPending=false,recordSaving=false,micToken=0,micContext=null,meterAnimation=null,recordInterval=null,recordStart=0;
function micError(error){return ({NotAllowedError:'麦克风权限未获得。请在浏览器提示中允许，或检查系统权限。',NotFoundError:'没有找到所选麦克风。',NotReadableError:'麦克风正忙或系统无法打开，请关闭占用它的应用。',OverconstrainedError:'所选麦克风已不可用，请重新识别。'})[error.name]||error.message||'麦克风暂不可用。';}
async function listInputs(){
  if(!navigator.mediaDevices?.enumerateDevices)return;
  const devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput'),old=$('#input-select').value;
  $('#input-select').innerHTML='<option value="">系统默认麦克风（未确认眼镜）</option>'+devices.map((d,i)=>`<option value="${escapeHTML(d.deviceId)}">${escapeHTML(d.label||`麦克风 ${i+1}（未授权名称）`)}</option>`).join('');
  if(devices.some(d=>d.deviceId===old))$('#input-select').value=old;
}
$('#refresh-inputs').onclick=async()=>{
  if(micPending||recorder)return;
  if(!navigator.mediaDevices?.getUserMedia){toast('麦克风需要 HTTPS 或本机 localhost，以及支持录音的浏览器。');return;}
  $('#refresh-inputs').disabled=true;let stream;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:true});await listInputs();$('#input-detail').textContent=`本次授权的默认音源：${stream.getAudioTracks()[0]?.label||'系统默认'}。请从上方选择 E06；若列表没有 E06，不要将本机麦克风当成眼镜。`;toast('已识别输入设备，请选择实际音源。');}
  catch(error){toast(micError(error));}
  finally{stream?.getTracks().forEach(track=>track.stop());$('#refresh-inputs').disabled=false;}
};
function releaseMic(){micStream?.getTracks().forEach(track=>track.stop());micStream=null;cancelAnimationFrame(meterAnimation);clearInterval(recordInterval);if(micContext){micContext.close().catch(()=>{});micContext=null;}$('#level-fill').style.width='0%';$('#level-meter').setAttribute('aria-valuenow','0');}
function recordingUI(active){$('#record-start').classList.toggle('hidden',active);$('#record-stop').classList.toggle('hidden',!active);$('#record-orb').classList.toggle('is-recording',active);$('#input-select').disabled=active;$('#refresh-inputs').disabled=active;}
async function startRecording(){
  if(recorder||micPending||recordSaving)return;
  if(state.testBusy){toast('请等试听完成后再录音。');return;}
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){toast('当前环境不支持录音。请使用 HTTPS 或 localhost 下的现代浏览器。');return;}
  stopSpeech();const token=++micToken;micPending=true;$('#record-start').disabled=true;$('#record-status').textContent='等待麦克风授权…';
  try{
    const id=$('#input-select').value;
    const stream=await navigator.mediaDevices.getUserMedia({audio:id?{deviceId:{exact:id}}:true});
    if(token!==micToken||state.page!=='lab'||state.lab!=='record'){stream.getTracks().forEach(t=>t.stop());return;}
    micStream=stream;
    const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    const current=new MediaRecorder(stream,mime?{mimeType:mime}:undefined),chunks=[];recorder=current;recordStart=Date.now();
    current.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
    current.onerror=()=>{toast('录音出现错误，已结束。');stopRecording();};
    current.onstop=async()=>{
      const elapsed=Date.now()-recordStart,blob=new Blob(chunks,{type:current.mimeType||'audio/webm'});recordSaving=true;recorder=null;releaseMic();recordingUI(false);$('#record-start').disabled=true;$('#record-time').textContent=duration(elapsed);$('#record-status').textContent='正在保存录音，请稍候…';
      if(!blob.size){$('#record-status').textContent='未获得录音数据，请检查输入设备。';recordSaving=false;$('#record-start').disabled=false;return;}
      const extension=blob.type.includes('mp4')?'m4a':'webm',name=`声音片段 ${new Date().toLocaleString('zh-CN').replace(/[/:]/g,'-')}.${extension}`;
      try{await addMedia(blob,name,`录音 · ${stream.getAudioTracks()[0]?.label||'系统默认'}`,elapsed/1000);$('#record-status').textContent='已保存，去资料库回听这段声音。';toast('录音已保存到资料库。');}
      catch{$('#record-status').textContent='本地保存失败，请立即下载这段录音。';showDialog('<h2>录音还在，先下载。</h2><p>浏览器本地存储写入失败。关闭此提示前，请下载备份。</p><button class="btn primary" id="rescue-recording">下载录音</button>',()=>$('#rescue-recording').onclick=()=>downloadItem({blob,name}));}
      finally{recordSaving=false;$('#record-start').disabled=false;}
    };
    current.start(1000);recordingUI(true);$('#record-status').textContent=`正在录音 · ${stream.getAudioTracks()[0]?.label||'系统默认麦克风（未确认眼镜）'}`;
    recordInterval=setInterval(()=>{const elapsed=Date.now()-recordStart;$('#record-time').textContent=duration(elapsed);if(elapsed>=300000)stopRecording();},200);
    stream.getAudioTracks()[0].onended=()=>{toast('麦克风已断开，正在保存已有录音。');stopRecording();};
    try{const Context=window.AudioContext||window.webkitAudioContext;micContext=new Context();await micContext.resume();const analyser=micContext.createAnalyser();analyser.fftSize=256;micContext.createMediaStreamSource(stream).connect(analyser);const values=new Uint8Array(analyser.fftSize);const tick=()=>{if(!recorder)return;analyser.getByteTimeDomainData(values);const rms=Math.sqrt(values.reduce((sum,v)=>sum+((v-128)/128)**2,0)/values.length),level=Math.min(100,Math.round(rms*500));$('#level-fill').style.width=`${level}%`;$('#level-meter').setAttribute('aria-valuenow',level);meterAnimation=requestAnimationFrame(tick);};tick();}catch{/* Recording can work without visual metering. */}
  }catch(error){releaseMic();recorder=null;recordingUI(false);$('#record-status').textContent=micError(error);toast(micError(error));}
  finally{micPending=false;$('#record-start').disabled=recordSaving;}
}
function stopRecording(){++micToken;if(recorder&&recorder.state!=='inactive')recorder.stop();else if(micPending){$('#record-status').textContent='已取消开始录音。';} }
$('#record-start').onclick=startRecording;$('#record-stop').onclick=stopRecording;

function populateVoices(){if(!window.speechSynthesis)return;state.voices=speechSynthesis.getVoices();const old=$('#voice-select').value;$('#voice-select').innerHTML='<option value="">系统默认</option>'+state.voices.map((voice,i)=>`<option value="${i}">${escapeHTML(voice.name)} · ${escapeHTML(voice.lang)}</option>`).join('');if(old && state.voices[Number(old)])$('#voice-select').value=old;}
function stopSpeech(){++state.speechToken;window.speechSynthesis?.cancel();if(window.speechSynthesis?.paused)speechSynthesis.resume();$('#speak-pause').disabled=true;$('#speak-stop').disabled=true;$('#speak-start').disabled=false;$('#speak-pause').innerHTML=icon('pause')+'暂停';$('#speech-status').textContent='经由系统当前音频输出播放。';$('#tour-status').textContent='准备出发。';}
function speakText(text,mode='text'){
  if(!window.speechSynthesis||!window.SpeechSynthesisUtterance){toast('此浏览器不支持系统语音朗读。');return;}
  if(!text.trim()){toast('先写下一段想听的文字。');return;}
  if(recorder||micPending||state.testBusy){toast('请先结束录音或试听，再开始朗读。');return;}
  stopSpeech();const token=state.speechToken,utterance=new SpeechSynthesisUtterance(text);utterance.lang='zh-CN';utterance.rate=Number($('#speech-rate').value);utterance.volume=Number($('#speech-volume').value);const selected=$('#voice-select').value;if(selected!==''&&state.voices[Number(selected)])utterance.voice=state.voices[Number(selected)];
  const target=mode==='tour'?$('#tour-status'):$('#speech-status');
  utterance.onstart=()=>{if(token===state.speechToken)target.textContent='正在朗读 · 系统当前音频输出';};
  utterance.onend=()=>{if(token!==state.speechToken)return;target.textContent='朗读结束。';$('#speak-pause').disabled=true;$('#speak-stop').disabled=true;$('#speak-start').disabled=false;};
  utterance.onerror=event=>{if(token!==state.speechToken)return;$('#speak-start').disabled=false;$('#speak-pause').disabled=true;$('#speak-stop').disabled=true;target.textContent=event.error==='not-allowed'?'请点击按钮允许播放声音。':'系统语音未能播放，请换一个声音或检查输出。';};
  speechSynthesis.speak(utterance);$('#speak-pause').disabled=false;$('#speak-stop').disabled=false;$('#speak-start').disabled=true;target.textContent='正在准备声音…';
}
$('#speak-start').onclick=()=>speakText($('#speech-text').value);
$('#speak-stop').onclick=stopSpeech;
$('#speak-pause').onclick=()=>{if(speechSynthesis.paused){speechSynthesis.resume();$('#speak-pause').innerHTML=icon('pause')+'暂停';$('#speech-status').textContent='正在朗读 · 系统当前音频输出';}else{speechSynthesis.pause();$('#speak-pause').innerHTML=icon('play')+'继续';$('#speech-status').textContent='已暂停。';}};
$('#speech-rate').oninput=()=>$('#rate-value').textContent=`${Number($('#speech-rate').value).toFixed(1)}×`;
$('#speech-volume').oninput=()=>$('#speech-volume-value').textContent=`${Math.round(Number($('#speech-volume').value)*100)}%`;
const tours=[
  {region:'KYOTO, JAPAN',title:'京都 · 巷间慢行',subtitle:'木窗、石板与一杯热茶',body:'想象清晨的京都，阳光刚刚越过屋檐。放慢脚步，听鞋底轻轻落在石板上的声音。街角的木窗后，一壶茶正在冒出热气。此刻不必赶路，也不必收集所有景点。把注意力放回呼吸，给眼前的小巷多留一分钟。下一次蹬腿，就当作向这座城市轻轻问好。'},
  {region:'ICELAND',title:'冰岛 · 沿风而行',subtitle:'远山、海岸与开阔的风',body:'这是一段想象中的冰岛海岸之旅。眼前是开阔的天空，远处的山沿着海平线缓缓延伸。让呼吸变得均匀，跟随自己的节奏前行。你不需要追上风，只需要留意每一次发力与放松。停下来时，想象海浪在远处替你数着拍子。'},
  {region:'AMALFI, ITALY',title:'阿马尔菲 · 海边午后',subtitle:'柠檬、暖阳与蓝色海面',body:'想象一个地中海边的午后。明亮的房子沿着山坡排列，远处的海面闪着细碎的光。你沿着一条安静的小路慢慢前进，微风里仿佛带着柠檬的香气。肩膀放松，保持舒适的节奏。这段旅程没有排名，只有属于你自己的下一步。'}
];
let tourIndex=0;
function selectTour(index){stopSpeech();tourIndex=index;const tour=tours[index];window.dispatchEvent(new CustomEvent('eye:scene',{detail:{title:tour.title,subtitle:tour.subtitle,region:tour.region,theme:['kyoto','iceland','amalfi'][index]}}));$('#tour-region').textContent=tour.region;$('#tour-title').textContent=tour.title;$('#tour-body').textContent=tour.body;$$('[data-route]').forEach(el=>el.classList.toggle('active',Number(el.dataset.route)===index));}
$('#route-list').innerHTML=tours.map((tour,index)=>`<button class="route-button ${index===0?'active':''}" data-route="${index}"><span class="route-number">0${index+1}</span><span><strong>${tour.title}</strong><small>${tour.subtitle}</small></span>${icon('arrow')}</button>`).join('');
$$('[data-route]').forEach(el=>el.onclick=()=>selectTour(Number(el.dataset.route)));$('#tour-play').onclick=()=>speakText(tours[tourIndex].body,'tour');$('#tour-stop').onclick=stopSpeech;

let timerStarted=null,timerElapsed=0;
$('#timer-toggle').onclick=()=>{if(timerStarted!==null){timerElapsed+=Date.now()-timerStarted;timerStarted=null;}else timerStarted=Date.now();$('#timer-toggle').innerHTML=icon(timerStarted!==null?'pause':'play')+`<span>${timerStarted!==null?'暂停计时':timerElapsed?'继续计时':'开始计时'}</span>`;};
$('#timer-reset').onclick=()=>{timerStarted=null;timerElapsed=0;$('#timer-display').textContent='00:00';$('#timer-toggle').innerHTML=icon('play')+'<span>开始计时</span>';};
setInterval(()=>{if(timerStarted!==null)$('#timer-display').textContent=duration(timerElapsed+Date.now()-timerStarted);},250);

const features=[
  ['volume','声音输出','播放提示音、媒体与系统朗读。','可以使用','test-audio'],
  ['mic','麦克风录音','选择音源，录音并回听。','可试录','open-record'],
  ['text','文字朗读','系统语音，语速与声音可选。','可以使用','open-speak'],
  ['folder','本地资料库','导入、预览、下载与删除媒体。','可以使用','library'],
  ['headphones','声音导览','三段预设旅行讲解。','示例可用','open-tour'],
  ['camera','眼镜拍照','需要确认相机能力与快门接口。','待厂商接入','camera'],
  ['video','眼镜录像','需要确认录像控制与文件接口。','待厂商接入','video'],
  ['image','眼镜相册同步','自动读取眼镜里的照片和视频。','待厂商接入','sync'],
  ['globe','实时翻译','需要语音识别与翻译服务。','待服务接入','translate'],
  ['spark','AI 对话与识物','需要 AI 服务；识物还需要图像接口。','待服务接入','ai'],
  ['battery','电量与按键','需要设备遥测和按键事件协议。','待厂商接入','battery'],
  ['chip','固件与设备设置','需要厂商升级与配置协议。','待厂商接入','firmware'],
];
$('#feature-grid').innerHTML=features.map(([symbol,title,description,status,action])=>`<button class="feature-card" data-feature="${action}"><span class="feature-icon">${icon(symbol)}</span><span class="feature-status ${status.includes('待')?'pending':'available'}">${status}</span><h3>${title}</h3><p>${description}</p></button>`).join('');
$$('[data-feature]').forEach(button=>button.onclick=()=>{
  const action=button.dataset.feature;if(action==='library'){navigate('library');return;}if(action==='test-audio'){testAudio();return;}if(action.startsWith('open-')){openLab(({ 'open-record':'record','open-speak':'speak','open-tour':'tour'})[action]);return;}
  const feature=features.find(f=>f[4]===action);
  const details={camera:'需要厂商提供相机能力信息、远程快门命令与拍摄结果回传。不会调用手机或电脑摄像头来冒充眼镜拍摄。',video:'需要厂商提供录像开始/停止、时长状态和录像文件获取接口。当前不会发送未经确认的设备命令。',sync:'需要厂商提供眼镜媒体列表、缩略图与文件下载协议。现在可以从 EYEVUE 手动导出，再导入本资料库。',translate:'需要接入语音识别、翻译与语音合成服务，并确认语言、延迟和计费。当前文字朗读不会翻译文本。',ai:'需要选择并接入 AI 服务。图像识别还需要眼镜相机或用户导入的图片。当前没有隐藏的 AI API 调用。',battery:'需要眼镜向系统或厂商 SDK 开放电量及按键事件。当前不显示推测的电量，也不改写按键功能。',firmware:'需要厂商提供适配型号、升级包与升级流程。当前控制台不会刷写或修改眼镜固件。'};
  showDialog(`<span class="eyebrow">CAPABILITY IN PROGRESS</span><h2>${feature[1]}</h2><span class="tag">${feature[3]}</span><p>${details[action]}</p><div class="status-banner">接口准备好后，这个入口可以直接接入；当前还不能控制这项眼镜功能。</div>`);
});
window.addEventListener('beforeunload',event=>{if(recorder||recordSaving){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{++micToken;micStream?.getTracks().forEach(track=>track.stop());window.speechSynthesis?.cancel();state.urls.forEach(url=>URL.revokeObjectURL(url));});
hydrateIcons();navigate(location.hash.slice(1)||'overview');selectTour(0);populateVoices();if(window.speechSynthesis)speechSynthesis.addEventListener('voiceschanged',populateVoices);
loadMedia();listInputs().catch(()=>{});refreshDevice();
if('serviceWorker' in navigator && location.protocol!=='file:')navigator.serviceWorker.register('./sw.js').catch(()=>{});
