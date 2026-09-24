"""Rebuild the Emma0924 expansion: original procedural audio, numpy only.

No downloads, models, voices, device access or changes to the 11 original WAVs.
Run from anywhere: python tools/build_expansion.py
"""
import hashlib
import json
from pathlib import Path
import wave

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RATE = 48000
SOURCE = 'original-Emma0924'
records = []


def timeline(seconds):
    return np.arange(round(seconds * RATE)) / RATE


def noise(seconds, seed, low=60, high=1500, color=0.3):
    """Periodic, band-limited stereo noise with a correlated centre image."""
    n = round(seconds * RATE)
    f = np.fft.rfftfreq(n, 1 / RATE)
    shape = (1 - np.exp(-(f / low) ** 4)) / (1 + (f / high) ** 6)
    shape /= np.maximum(f, low) ** color
    shape[0] = 0
    rng = np.random.default_rng(seed)
    channels = []
    for _ in range(3):
        a = np.fft.irfft(shape * np.exp(1j * rng.uniform(0, 2*np.pi, len(f))), n)
        channels.append(a / max(1e-9, np.sqrt(np.mean(a*a))))
    return np.column_stack((channels[0]*0.8+channels[1]*0.3,
                            channels[0]*0.8+channels[2]*0.3))


def mono(x):
    return np.column_stack((x, x))


def envelope(t, attack=0.01, decay=8):
    return (1-np.exp(-t/attack))*np.exp(-t*decay)


def modes(seconds, frequencies, decay=6, amplitude=1):
    t = timeline(seconds)
    x = sum(np.sin(2*np.pi*f*t)*np.exp(-t*(decay+i*1.3))/(i+1)
            for i, f in enumerate(frequencies))
    return mono(x*(1-np.exp(-t*500))*amplitude)


def save(name, x, description, looping=False, rms=0.05):
    if not np.isfinite(x).all():
        raise ValueError(name + ': non-finite audio')
    x = x - x.mean(axis=0)
    if not looping:
        fade = min(480, len(x)//4)
        x[:fade] *= np.linspace(0, 1, fade)[:, None]
        x[-fade:] *= np.linspace(1, 0, fade)[:, None]
    x *= rms/max(1e-9, np.sqrt(np.mean(x*x)))
    peak = np.max(np.abs(x))
    if peak > 0.5:
        x *= 0.5/peak
    pcm = np.rint(x*32767).astype('<i2')
    path = ROOT/'assets'/name
    with wave.open(str(path), 'wb') as w:
        w.setparams((2, 2, RATE, 0, 'NONE', 'not compressed'))
        w.writeframes(pcm.tobytes())
    actual = pcm.astype(np.float64)/32768
    records.append(dict(file='assets/'+name, seconds=round(len(x)/RATE, 3),
        sampleRate=RATE, channels=2, loop=looping,
        peakDbFS=round(float(20*np.log10(max(1e-12, np.abs(actual).max()))), 2),
        rmsDbFS=round(float(20*np.log10(max(1e-12, np.sqrt(np.mean(actual**2))))), 2),
        seamJump=float(np.abs(actual[0]-actual[-1]).max()) if looping else None,
        sha256=hashlib.sha256(path.read_bytes()).hexdigest(), sources=[SOURCE],
        description=description))


def main():
    records.clear()
    t = timeline(24)
    gust = (0.75+0.15*np.cos(2*np.pi*t/8)+0.1*np.sin(2*np.pi*t/12))[:, None]
    # Periodic modulation periods divide 24s; no footstep or dialogue baked in.
    wind = noise(24, 11, 80, 1900)*gust
    stove = noise(24, 12, 130, 700)*(0.8+0.1*np.cos(2*np.pi*t*7))[:, None]
    save('everest_camp.wav', wind*0.55+stove*0.35,
         '珠峰营地：低风与炉火气流；帐篷拍击独立触发，无人声', True, .038)
    save('everest_glacier.wav', wind+noise(24, 13, 250, 2400)*0.13,
         '东绒布冰川、北坳冰壁：开阔冷风与细雪；非当地实录', True, .045)
    whistle = noise(24, 14, 900, 1900, 0)
    swell = (0.5+0.5*np.sin(2*np.pi*t/12))[:, None]**4
    save('everest_ridge.wav', wind*0.8+whistle*swell*.32+noise(24, 15, 60, 350)*.18,
         '北山脊、刀脊、北壁横切：低风吼与间歇尖啸，无突发惊吓', True, .050)
    save('huashan_cliff.wav', noise(24, 16, 100, 1400)*gust + noise(24, 17, 650, 2900)*.12,
         '华山悬崖与松风；木板、铁链、扣锁独立触发', True, .041)
    traffic = noise(24, 18, 60, 450)*(0.7+0.3*np.cos(2*np.pi*t/24))[:, None]
    save('parkour_rooftop.wav', noise(24, 19, 200, 1800)*gust*.7+traffic*.4,
         '屋顶风与远处车流感；不烘焙步频、跳跃或追逐声', True, .043)
    pad = sum(np.sin(2*np.pi*f*t)*a for f,a in [(55,.4),(55.125,.23),(82.5,.15),(110,.08)])
    save('cyber_pad.wav', mono(pad)*(0.8+0.2*np.sin(2*np.pi*t/12))[:, None],
         '原创低频科幻氛围垫；可与东京雨声低音量混合，不使用商业配乐', True, .027)
    tr = timeline(8)
    rotor = noise(8, 20, 65, 520)*(0.4+0.6*(0.5+0.5*np.cos(2*np.pi*11*tr))**4)[:, None]
    save('helicopter_rotor.wav', rotor+mono(np.sin(2*np.pi*88*tr))*.12,
         '合成旋翼循环；挂到直升机距离与转速，不作为全地图底音', True, .045)

    for name, seed, hi, decay, desc in [
        ('step_snow',31,4200,9,'雪地压实与雪粒细碎声'),
        ('step_ice',32,6000,13,'冰爪咬冰：短脆响与冰粒'),
        ('step_wood',33,1400,13,'木板脚步：闷响与短木纹摩擦')]:
        tt=timeline(.6)
        crunch=noise(.6,seed,180,hi,0)*envelope(tt,.008,decay)[:,None]
        grains=(0.4+0.6*np.sin(2*np.pi*(63+seed)*tt)**8)[:,None]
        x=crunch*grains+modes(.6,[120,185],12,.1)
        if name=='step_ice': x+=modes(.6,[1860,3210,4670],20,.18)
        if name=='step_wood': x+=modes(.6,[180,350,730],14,.3)
        save(name+'.wav',x,desc+'；单次触发',rms=.070)
    save('step_metal.wav',modes(.85,[430,810,1390,2300],7)+
         noise(.85,34,300,4000)*envelope(timeline(.85),.005,30)[:,None]*.2,
         '空心金属梯脚步；北坳横梯、中国梯、华山铁梯',rms=.065)
    tt=timeline(.9)
    phase=2*np.pi*(170*tt-35*tt**2+2*np.sin(2*np.pi*8*tt))
    save('rope_creak.wav',(mono(np.sin(phase))*.35+noise(.9,35,100,1200)) *
         np.sin(np.pi*tt/.9)[:,None]**2,'受力绳索摩擦与吱呀；按动作触发',rms=.050)
    click=modes(.32,[1900,3400],32)
    click+=np.roll(click,int(.09*RATE))*.6
    save('carabiner_click.wav',click,'游戏中的扣锁开合双击；不表示真实安全锁已扣好',rms=.065)
    save('chain_clink.wav',modes(.9,[1250,1880,2750,3900],8),'铁链与锁环轻碰',rms=.060)
    tt=timeline(1.1)
    flaps=sum(np.exp(-((tt-at)/.038)**2) for at in [.09,.24,.52,.68])
    save('flag_flap.wav',noise(1.1,36,150,1600)*flaps[:,None],
         '帐篷布、经幡、登顶旗帜拍动；独立短音',rms=.058)
    save('yak_bell.wav',modes(1.8,[620,1031,1683,2240],3.2),'牦牛铜铃设计音；按距离触发',rms=.050)
    tt=timeline(1.6)
    save('oxygen_hiss.wav',noise(1.6,37,1300,7000)*np.sin(np.pi*tt/1.6)[:,None]**2,
         '游戏吸氧互动气阀嘶声；单次触发',rms=.045)
    tt=timeline(1.5)
    breath=noise(1.5,38,400,2100)*np.exp(-((tt-.35)/.16)**2)[:,None]
    breath+=noise(1.5,39,180,950)*np.exp(-((tt-1.05)/.26)**2)[:,None]
    save('breath.wav',breath,'滤波噪声模拟吸呼；不是人声录音，默认不自动播放',rms=.035)
    tt=timeline(.65)
    save('parkour_jump.wav',noise(.65,40,250,3300)*np.sin(np.pi*tt/.65)[:,None]**2,
         '跳跃掠风；run.events 的 jump',rms=.055)
    land=modes(.7,[78,133,250],13)+noise(.7,41,120,3800)*envelope(timeline(.7),.004,16)[:,None]*.35
    save('parkour_land.wav',land,'落地鞋底与屋顶闷响；run.events 的 land',rms=.073)
    tt=timeline(.95)
    save('parkour_slide.wav',noise(.95,42,400,4500)*np.sin(np.pi*tt/.95)[:,None]**.8,
         '滑铲摩擦；进入 slide 状态时播放一次',rms=.058)
    save('parkour_hit.wav',modes(.6,[105,177,290],17)+noise(.6,43,300,2400)*
         envelope(timeline(.6),.006,20)[:,None]*.35,'碰撞反馈短音；不同碰撞共用，避免多声叠加',rms=.070)
    tt=timeline(1.5)
    phase=2*np.pi*(60*tt-7*tt**2)
    save('mech_hum.wav',mono(np.sin(phase)+.3*np.sin(phase*2))*envelope(tt,.08,3)[:,None],
         '机甲冲刺 / 接近短促低鸣；单次，不持续循环',rms=.060)
    tt=timeline(.85)
    save('cyber_camo.wav',(noise(.85,44,700,5800)*.7+mono(np.sin(2*np.pi*(850*tt+1800*tt**2)))*.12)*
         np.sin(np.pi*tt/.85)[:,None]**2,'光学迷彩出现的合成扫频',rms=.050)
    tt=timeline(.55)
    env=sum(np.exp(-((tt-at)/.018)**2) for at in [.06,.18,.27,.41])
    save('cyber_glitch.wav',(noise(.55,45,1100,6500)*.6+mono(np.sin(2*np.pi*1470*tt))*
         np.cos(2*np.pi*37*tt)[:,None]*.2)*env[:,None],'电子通讯故障颗粒短音',rms=.044)
    tt=timeline(1.8)
    phase=2*np.pi*(48*tt+62*(1-np.exp(-tt*18))/18)
    save('taiko.wav',mono(np.sin(phase))*envelope(tt,.004,4)[:,None]+noise(1.8,46,140,1600)*
         envelope(tt,.004,35)[:,None]*.35,'原创合成鼓点；东京登顶，不使用任何原曲采样',rms=.065)

    manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
    manifest['assets']=[a for a in manifest['assets'] if SOURCE not in a['sources']]+records
    manifest['sources']=[s for s in manifest['sources'] if s['id'] != SOURCE]+[{
        'id': SOURCE, 'author': 'AIMA / Emma0923 音效包 · 2026-09-24 扩展',
        'license': 'CC0-1.0', 'kind': 'original-procedural',
        'generator': 'tools/build_expansion.py', 'externalSamples': False,
        'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}]
    manifest['version']=2
    manifest['sourceCommit']='9832875'
    manifest['worlds']=[json.loads(f.read_text(encoding='utf-8')) for f in sorted((ROOT/'worlds').glob('*.json'))]
    manifest['interfaces']=[dict(id='parkour',name='屋顶跑酷',previewOnly=True,
        theme={'style':'parkour_rooftop'},route=[{'kind':'flat','steps':1,'label':label}
        for label in ['屋顶起跑','上楼顶','夜奔','亡命追逐']])]
    manifest['description']='8 sound profiles / 8 world routes + parkour interface. Game sound design; not location recordings. Parkour preview routes are not distance telemetry.'
    (ROOT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (ROOT/'sources.json').write_text(json.dumps(manifest['sources'],ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'newAssets':len(records),'totalAssets':len(manifest['assets']),
                     'newBytes':sum((ROOT/a['file']).stat().st_size for a in records)},ensure_ascii=False))


if __name__=='__main__':
    main()
