"""Build original scene mixes from downloaded CC0 assets. Build deps: numpy, ffmpeg.

python tools/build_soundscape.py --sources /path/to/audio-sources
Runtime playback needs neither dependency. No hardware access.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import wave

import numpy as np

RATE = 48000
ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT
RNG = np.random.default_rng(20260923)


def read(path):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path),
                                   '-f', 'f32le', '-ar', str(RATE), '-ac', '2', '-'])
    return np.frombuffer(raw, dtype='<f4').reshape(-1, 2).astype(np.float64)


def level(x, rms):
    x = x - np.mean(x, axis=0)
    return x * rms / max(1e-9, np.sqrt(np.mean(x*x)))


def loop(x, seconds=24, offset=0):
    """Overlap-add one-second splice; output boundary lies inside continuous audio."""
    n, f = int(seconds*RATE), RATE
    x = np.tile(x, (int((offset*RATE+n+f)/len(x))+2, 1))
    x = x[int(offset*RATE):int(offset*RATE)+n+f].copy()
    a = (0.5-0.5*np.cos(np.linspace(0, np.pi, f)))[:, None]
    x[:f] = x[n:n+f]*(1-a) + x[:f]*a
    return x[:n]


def periodic_noise(seconds, cutoff=450):
    n = int(seconds*RATE)
    freqs = np.fft.rfftfreq(n, 1/RATE)
    amp = 1 / np.maximum(freqs, 45)**0.6 / (1+(freqs/cutoff)**4)
    amp[0] = 0
    channels = []
    for _ in range(2):
        channels.append(np.fft.irfft(amp*np.exp(1j*RNG.uniform(0, 2*np.pi, len(freqs))), n))
    return np.array(channels).T


def save(name, x, sources, description, is_loop=False):
    x = np.nan_to_num(x)
    peak = float(np.max(np.abs(x)))
    if peak > 0.7:
        x *= 0.7/peak
    path = DEST/'assets'/name
    with wave.open(str(path), 'wb') as w:
        w.setparams((2, 2, RATE, 0, 'NONE', 'not compressed'))
        w.writeframes((x*32767).astype('<i2').tobytes())
    records.append(dict(file='assets/'+name, seconds=round(len(x)/RATE, 3),
                        sampleRate=RATE, channels=2, loop=is_loop,
                        peakDbFS=round(20*np.log10(max(np.max(np.abs(x)), 1e-12)), 2),
                        rmsDbFS=round(20*np.log10(max(np.sqrt(np.mean(x*x)), 1e-12)), 2),
                        seamJump=float(np.max(np.abs(x[0]-x[-1]))) if is_loop else None,
                        sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                        sources=sources, description=description))


def cue(freqs, duration):
    t = np.arange(int(duration*RATE))/RATE
    x = np.zeros(len(t))
    for i, freq in enumerate(freqs):
        u = np.maximum(0, t-i*0.12)
        env = (1-np.exp(-u*90))*np.exp(-u*5)*(t >= i*0.12)
        x += env*(np.sin(2*np.pi*freq*u) + 0.15*np.sin(2*np.pi*freq*2.01*u))
    x *= np.minimum(1, (duration-t)*50)
    return np.repeat(x[:, None], 2, axis=1)*0.13


def main():
    global records
    p = argparse.ArgumentParser()
    p.add_argument('--sources', type=Path, required=True)
    args = p.parse_args()
    src = args.sources
    (DEST/'assets').mkdir(parents=True, exist_ok=True)
    records = []
    sources = json.loads((src/'sources.json').read_text(encoding='utf-8'))
    for entry in sources:
        if 'file' not in entry:  # Original procedural expansion has no downloaded input.
            continue
        assert hashlib.sha256((src/entry['file']).read_bytes()).hexdigest() == entry['sha256']
    birds, wind, rain = read(src/'birds.ogg'), read(src/'wind.wav'), read(src/'rain/1.ogg')
    breeze = level(loop(wind), 0.050)
    birds1 = level(loop(birds, offset=9), 0.035)
    save('taishan.wav', breeze*0.72+birds1, ['wind', 'birds'], '松风感与稀疏鸟鸣；非泰山实地录音', True)
    t = np.arange(24*RATE)/RATE
    gust = level(periodic_noise(24, 330), 0.027)*(0.7+0.3*np.cos(2*np.pi*t/8))[:, None]
    save('fuji.wav', breeze+gust, ['wind', 'original'], '高山风与合成低频阵风；无森林虫鸟', True)
    traffic = level(periodic_noise(24, 180), 0.028)*(0.65+0.35*np.sin(2*np.pi*t/12))[:, None]
    save('tokyo.wav', level(loop(rain), 0.060)+traffic, ['rain', 'original'], '循环雨声与合成远处车流低鸣；非东京实地录音', True)
    save('wutong.wav', level(loop(birds, offset=32), 0.065)+breeze*0.36,
         ['birds', 'wind'], '较密鸟鸣与林间风；鸟种和录音地点未做本地化', True)
    save('training.wav', level(periodic_noise(8, 200), 0.008), ['original'],
         '可选极轻室内底噪；训练模式默认完全静音', True)
    for material, original in [('stone', 'stone01'), ('gravel', 'gravel'), ('leaves', 'leaves01'), ('mud', 'mud02')]:
        x = read(src/'steps'/(original+'.ogg'))
        x = level(x, 0.10)
        f = min(240, len(x)//4)
        x[:f] *= np.linspace(0, 1, f)[:, None]
        x[-f:] *= np.linspace(1, 0, f)[:, None]
        save('step_'+material+'.wav', x, ['steps'], material+' 单次脚步；由游戏进度触发')
    save('arrive.wav', cue([523.25, 659.25, 783.99], 1.5), ['original'], '原创合成通关提示音，不模拟真实寺庙钟声')
    save('checkpoint.wav', cue([587.33, 783.99], 0.8), ['original'], '原创合成路段切换提示音')
    worlds = [json.loads(f.read_text(encoding='utf-8')) for f in sorted((ROOT/'worlds').glob('*.json'))]
    manifest = dict(version=1, sourceCommit='621dfa3', sources=sources, assets=records,
                    worlds=worlds, license='CC0-1.0', originalContributions='CC0-1.0',
                    description='Game sound design, not recordings of the named locations. Training defaults to silence.')
    (DEST/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps([{'file': x['file'], 'seconds': x['seconds'], 'peak': x['peakDbFS'], 'seam': x['seamJump']} for x in records], indent=2))


if __name__ == '__main__':
    main()
