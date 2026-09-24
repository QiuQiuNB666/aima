import { profiles, mixFor } from './state.mjs';

export class Soundscape {
  constructor(assetURL = name => new URL('assets/'+name, import.meta.url).href) {
    this.assetURL = assetURL;
    this.cache = new Map(); this.oneshots = new Set(); this.steps = new Set(); this.loops = new Set();
    this.style = 'dawn_mountain'; this.enabled = false; this.version = 0;
    this.volume = 0.25; this.trainingAudio = false; this.duck = false; this.regionGain = 1;
    this.onChange = () => {}; this.onError = () => {};
    this.id = Math.random().toString(36);
    try {
      this.channel = new BroadcastChannel('aima-soundscape-output-v1');
      this.channel.onmessage = e => { if (e.data !== this.id) this.stop('另一试听页接管了声音'); };
    } catch (_) { /* file:// may not provide same-origin coordination */ }
    this.visibility = () => { if (document.hidden) this.stop('页面进入后台，请回到本页重新启用'); };
    document.addEventListener('visibilitychange', this.visibility);
  }
  async start() {
    const request = ++this.version;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain(); this.master.gain.value = 0;
      this.meter = this.ctx.createAnalyser(); this.meter.fftSize = 256;
      this.meterSamples = new Float32Array(256);
      this.ambience = this.ctx.createGain(); this.effects = this.ctx.createGain();
      const limit = this.ctx.createDynamicsCompressor();
      limit.threshold.value = -12; limit.knee.value = 6; limit.ratio.value = 8;
      this.ambience.connect(this.master); this.effects.connect(this.master);
      this.master.connect(this.meter); this.meter.connect(limit); limit.connect(this.ctx.destination);
    }
    await this.ctx.resume();
    if (request !== this.version) return;
    this.enabled = true; this.channel?.postMessage(this.id); this.updateGains();
    this.onChange('声音已启用 · 输出到系统当前音频设备');
    const region = this.region, style = this.style;
    await this.switchScene(style);
    if (this.enabled && style === this.style && region) this.setRegion(region);
  }
  async buffer(name) {
    if (!this.cache.has(name)) {
      const task = fetch(this.assetURL(name)).then(r => {
        if (!r.ok) throw Error('音频读取失败：'+name);
        return r.arrayBuffer();
      }).then(data => this.ctx.decodeAudioData(data)).catch(e => { this.cache.delete(name); throw e; });
      this.cache.set(name, task);
    }
    return this.cache.get(name);
  }
  gain(node, value, seconds=0.08) {
    const t = this.ctx.currentTime;
    node.gain.cancelScheduledValues(t); node.gain.setTargetAtTime(value, t, seconds);
  }
  updateGains() {
    if (!this.ctx) return;
    const muted = this.style === 'grid' && !this.trainingAudio;
    this.gain(this.master, this.enabled && !muted ? this.volume : 0, 0.025);
    this.gain(this.ambience, this.regionGain * (this.duck ? 0.22 : 1));
    this.gain(this.effects, this.duck ? 0.45 : 1);
  }
  setVolume(value) { this.volume = Math.max(0, Math.min(0.8, Number(value)||0)); this.updateGains(); }
  setNarrationActive(active) { this.duck = !!active; this.updateGains(); }
  setTrainingAudio(active) { this.trainingAudio = !!active; this.updateGains(); }
  setRegion(T) {
    this.region = T;
    const mix = mixFor(T, this.style);
    this.regionGain = mix.gain;
    this.updateGains();
    if (this.enabled && this.currentFile !== mix.file) {
      void this.replaceLoop(mix.file).catch(e => this.onError(e));
    }
  }
  async switchScene(style) {
    this.style = Object.hasOwn(profiles, style) ? style : 'grid';
    this.region = null; this.regionGain = 1;
    for (const s of this.oneshots) { try { s.stop(); } catch (_) {} }
    await this.replaceLoop(profiles[this.style].file);
    if (this.enabled) await Promise.all(['stone', 'gravel', 'leaves', 'mud', 'snow', 'ice', 'wood', 'metal']
      .map(m => this.buffer('step_'+m+'.wav')));
  }
  async replaceLoop(file) {
    const version = ++this.version;
    this.currentFile = file;
    this.stopSteps(); this.updateGains();
    // Retire the previous source immediately; slow downloads must not leave the old scene audible.
    for (const item of this.loops) {
      this.gain(item.gain, 0, 0.10);
      try { item.source.stop(this.ctx.currentTime+0.55); } catch (_) {}
    }
    if (!this.enabled) return;
    let buffer;
    try { buffer = await this.buffer(file); }
    catch (e) { if (version === this.version) this.currentFile = null; throw e; }
    if (version !== this.version || !this.enabled) return;
    const source = this.ctx.createBufferSource(), gain = this.ctx.createGain();
    source.buffer = buffer; source.loop = true; gain.gain.value = 0;
    source.connect(gain); gain.connect(this.ambience);
    const item = { source, gain }; this.loops.add(item);
    source.onended = () => { this.loops.delete(item); source.disconnect(); gain.disconnect(); };
    source.start(); this.gain(gain, 1, 0.25);
  }
  async shot(file, pan=0, isStep=false, level=1) {
    if (!this.enabled || this.style === 'grid' && !this.trainingAudio) return;
    const version = this.version, generation = this.stepGeneration || 0;
    const buffer = await this.buffer(file);
    if (!this.enabled || version !== this.version || isStep && generation !== (this.stepGeneration || 0)) return;
    const source = this.ctx.createBufferSource(), panner = this.ctx.createStereoPanner(), gain = this.ctx.createGain();
    source.buffer = buffer; panner.pan.value = pan;
    gain.gain.value = Math.max(0, Math.min(1, level));
    source.connect(panner); panner.connect(gain); gain.connect(this.effects);
    this.oneshots.add(source);
    if (isStep) this.steps.add(source);
    source.onended = () => { this.oneshots.delete(source); this.steps.delete(source); source.disconnect(); panner.disconnect(); gain.disconnect(); };
    source.start();
  }
  step(material='stone') {
    this.side = this.side === 1 ? -1 : 1;
    void this.shot('step_'+material+'.wav', this.side*0.13, true).catch(e => this.onError(e));
  }
  cue(name='arrive') { return this.shot(name+'.wav'); }
  stopSteps() {
    this.stepGeneration = (this.stepGeneration || 0)+1;
    for (const s of this.steps) { try { s.stop(); } catch (_) {} }
  }
  stop(reason='已停止所有声音') {
    this.enabled = false; this.version++; this.stopSteps();
    for (const s of this.oneshots) { try { s.stop(); } catch (_) {} }
    for (const item of this.loops) { try { item.source.stop(); } catch (_) {} }
    if (this.ctx) { this.master.gain.cancelScheduledValues(this.ctx.currentTime); this.master.gain.setValueAtTime(0, this.ctx.currentTime); }
    this.onChange(reason);
  }
  testTone(pan=0, when=null) {
    if (!this.enabled) throw Error('请先启用声音');
    // Test signals bypass scene muting and ducking, but retain the user's volume.
    const t = when ?? this.ctx.currentTime+0.06;
    const osc = this.ctx.createOscillator(), env = this.ctx.createGain(), stereo = this.ctx.createStereoPanner();
    osc.frequency.value = 660; stereo.pan.value = pan;
    env.gain.setValueAtTime(0, t); env.gain.linearRampToValueAtTime(this.volume*0.18, t+0.015);
    env.gain.setValueAtTime(this.volume*0.18, t+0.14); env.gain.linearRampToValueAtTime(0, t+0.18);
    osc.connect(env); env.connect(stereo); stereo.connect(this.ctx.destination);
    this.oneshots.add(osc); osc.onended = () => { this.oneshots.delete(osc); osc.disconnect(); env.disconnect(); stereo.disconnect(); };
    osc.start(t); osc.stop(t+0.20); return t;
  }
  diagnostics() {
    if (this.meter) this.meter.getFloatTimeDomainData(this.meterSamples);
    const rms = this.meterSamples ? Math.sqrt(this.meterSamples.reduce((n,x)=>n+x*x,0)/this.meterSamples.length) : 0;
    return { enabled: this.enabled, style: this.style, file: this.currentFile, audioContext: this.ctx?.state || 'not-created',
      sampleRate: this.ctx?.sampleRate, baseLatencyEstimate: this.ctx?.baseLatency,
      outputLatencyEstimate: this.ctx?.outputLatency, activeLoops: this.loops.size,
      digitalRmsDbFS: Math.round(20*Math.log10(Math.max(rms,1e-6))),
      note: '浏览器估计不等于蓝牙端到端延迟，也不能证明眼镜发出了声音。' };
  }
}
