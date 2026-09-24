"""Measure delivered PCM, including loop seams and mono fold-down (numpy).
This verifies file integrity/digital levels, not subjective listening or glasses.
"""
import hashlib
import json
from pathlib import Path
import wave
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'))
rows=[]
for a in manifest['assets']:
    path=ROOT/a['file']
    with wave.open(str(path),'rb') as w:
        assert (w.getframerate(),w.getnchannels(),w.getsampwidth())==(48000,2,2)
        samples=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').reshape(-1,2)
    x=samples.astype(np.float64)/32768
    peak=float(np.abs(x).max());rms=float(np.sqrt(np.mean(x*x)))
    mono=float(np.sqrt(np.mean(x.mean(axis=1)**2)))
    seam=float(np.abs(x[0]-x[-1]).max()) if a['loop'] else None
    adjacent=float(np.quantile(np.abs(np.diff(x,axis=0)),.999))
    errors=[]
    if hashlib.sha256(path.read_bytes()).hexdigest()!=a['sha256']:errors.append('hash')
    if peak>=10**(-3/20):errors.append('peak')
    if rms<1e-5:errors.append('silent')
    if mono/rms<.35:errors.append('mono cancellation')
    if a['loop'] and seam>adjacent*2+.0001:errors.append('loop seam')
    if not a['loop'] and max(np.abs(x[0]).max(),np.abs(x[-1]).max())>.001:errors.append('one-shot edge')
    rows.append(dict(file=a['file'],peakDbFS=round(20*np.log10(peak),2),
        rmsDbFS=round(20*np.log10(rms),2),monoRmsRatio=round(mono/rms,3),
        seamJump=seam,adjacentDifferenceP999=adjacent,errors=errors))
report=dict(sourceCommit=manifest['sourceCommit'],assetCount=len(rows),
    totalBytes=sum((ROOT/a['file']).stat().st_size for a in manifest['assets']),
    allPassed=all(not r['errors'] for r in rows),
    limitations='Digital file QA only; no subjective listening or physical glasses verification.',assets=rows)
(ROOT/'docs/audio-qa-20260924.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='assets'},ensure_ascii=False))
for row in rows:
    if row['errors']:print(row['file'],row['errors'])
raise SystemExit(0 if report['allPassed'] else 1)
