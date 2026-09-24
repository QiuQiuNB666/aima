// File-based alternatives to the existing procedural sounds; do not layer both.
export const events = [
  ['snow.step','踩雪','step_snow.wav',['everest_north'],'kit.sfx(crunch)','st.s crosses an integer while moving; no wait segments'],
  ['ice.step','冰爪咬冰','step_ice.wav',['everest_north'],'kit.sfx(ice)','One accepted step on the ice wall'],
  ['ladder.step','金属梯踩踏','step_metal.wav',['everest_north','huashan_plank'],'kit.sfx(ladder)','One accepted step on ladder; exclude waiting in queue'],
  ['plank.step','木板踩踏','step_wood.wav',['huashan_plank'],'new file step slot','One accepted step on the plank walk'],
  ['rope.tension','绳索吃力','rope_creak.wav',['everest_north'],'kit.sfx(rope)','Reuse existing rope cadence in soundscape.js'],
  ['lock.click','游戏扣锁','carabiner_click.wav',['huashan_plank'],'kit.sfx(click)','Existing visual latch event; not physical wear verification'],
  ['chain.clink','铁链轻碰','chain_clink.wav',['huashan_plank'],'kit.sfx(clink)','Existing chain contact event'],
  ['fabric.flap','经幡 / 帐篷拍动','flag_flap.wav',['everest_north'],'kit.sfx(flap), kit.sfx(flutter)','Existing flag or tent event; distance attenuation'],
  ['yak.bell','牦牛铃','yak_bell.wav',['everest_north'],'kit.sfx(yakbell)','yaks.js bell event, distance attenuation; avoid overlapping tails'],
  ['oxygen.hiss','吸氧气阀','oxygen_hiss.wav',['everest_north'],'kit.sfx(hiss)','Existing oxygen interaction, once per interaction'],
  ['altitude.breath','高山呼吸（可选）','breath.wav',['everest_north'],'kit.sfx(breath)','Reuse hypoxia timer; user-selectable, never interpret as measured breathing'],
  ['parkour.jump','跳跃掠风','parkour_jump.wav',['parkour'],'run.events: jump','One play when jump is emitted'],
  ['parkour.land','落地','parkour_land.wav',['parkour'],'run.events: land','One play when land is emitted'],
  ['parkour.slide','滑铲','parkour_slide.wav',['parkour'],'run.events: slide','Once on entry; not once per animation frame'],
  ['parkour.hit','碰撞','parkour_hit.wav',['parkour'],'run.events: low/high/block/fall/wall/caught/corner','At most one hit sound per update; stop at reset/exit'],
  ['mech.hum','机甲接近','mech_hum.wav',['parkour'],'makeAudio().hum()','Replace existing dash/caught hum; one-shot'],
  ['cyber.camo','光学迷彩','cyber_camo.wav',['tokyo_night'],'kit.sfx(camo)','Reuse gits.js camo edge'],
  ['cyber.glitch','电子故障','cyber_glitch.wav',['tokyo_night'],'kit.sfx(glitch)','Reuse gits.js cooldown'],
  ['cyber.taiko','登顶鼓点','taiko.wav',['tokyo_night'],'kit.sfx(taiko)','Reuse gits.js summit edge; original synthesis'],
  ['world.arrive','通关提示','arrive.wav',['*'],'ProgressGate.arrive','Once on verified lap boundary, never on initial connection'],
  ['world.checkpoint','路段提示（可选）','checkpoint.wav',['*'],'optional scene transition','Disabled by default; do not compete with narration']
].map(([id,label,file,worlds,currentHook,trigger]) => ({
  id,label,file,worlds,currentHook,trigger,
  defaultGain: id==='altitude.breath' ? .35 : .65,
  enabledByDefault: !['altitude.breath','world.checkpoint'].includes(id),
  integration: 'reference mapping; not auto-wired to main game'
}));

export const layers = [
  { id:'helicopter.rotor',file:'helicopter_rotor.wav',worlds:['everest_north'],currentHook:'kit.sfxLoop(rotor)',trigger:'heli.js: distance × rotor speed; zero outside audible range',defaultGain:.3 },
  { id:'cyber.pad',file:'cyber_pad.wav',worlds:['tokyo_night'],currentHook:'kit.sfxLoop(pad)',trigger:'gits.js: original synth pad replacement, mix quietly below rain',defaultGain:.25 }
];
