"""Offline virtual-plant haptics report; never imports a serial driver.

python -m shellos.hands.preview --output work/hands-haptics.html
"""
from __future__ import annotations
import argparse
import csv
import html
import json
import math
from pathlib import Path
from .control import HandController, Sample, Interlocks
from .profile import simulation_profile, blank_hardware_profile


def run_demo():
    profile=simulation_profile()
    ctl=HandController(profile)
    q={'left':-12.0,'right':-10.0}; velocity={'left':0.0,'right':0.0}
    rows=[]; events=[]; stage=None; counter=0
    def sample(at, seq):
        return Sample(at,seq,q['left'],q['right'],velocity['left'],velocity['right'],'sim-hands')
    def locks(at):
        return Interlocks(at,True,True,True,True,False,'simulation')
    ctl.begin(sample(0,0),locks(0),0)
    for tick in range(1,1401):
        now=tick/100; current=sample(now,tick)
        if tick in (500,560,620):
            counter+=1
            side={500:'left',560:'right',620:'both'}[tick]
            accepted=ctl.fire(side,counter,now,now)
            events.append((now,f'{side} pulse: {accepted}'))
        if tick==700:
            ctl.configure_game('excavator',.8)
            ctl.begin(current,locks(now),now)
            out=ctl.snapshot()
        else:
            if tick>=1150:
                current=Sample(now-1,tick,q['left'],q['right'],velocity['left'],velocity['right'],'sim-hands')
            out=ctl.step(current,locks(now),now)
        if out['stage']!=stage:
            stage=out['stage'];events.append((now,stage+': '+out['reason']))
        rows.append({'seconds':now,'stage':stage,**{side+'_nm':out['torque_nm'][side] for side in q},
                     **{side+'_deg':q[side] for side in q},
                     **{side+'_target_deg':out['target_deg'][side] for side in q},
                     **{side+'_pulse_nm':out['components'].get(side,{}).get('pulse_nm',0) for side in q}})
        for side in q:
            # Arbitrary simulated inertia, friction and hand interaction, not
            # identified mechanics or a claim about actual Hypershell dynamics.
            human=.16 if side=='left' and 800<=tick<900 else -.16 if side=='right' and 900<=tick<1000 else 0
            gravity=.2*math.sin(math.radians(q[side]))
            acceleration=(out['torque_nm'][side]+human-gravity-.05*math.radians(velocity[side]))/.08
            velocity[side]+=math.degrees(acceleration)*.01
            q[side]+=velocity[side]*.01
    return rows,events


def chart(rows, names, bound, title, unit):
    width,height=960,220
    colors=['#26755e','#bd762e','#83a79a','#d6b693']
    paths=[]
    for index,name in enumerate(names):
        points=' '.join(f'{20+r["seconds"]/14*(width-40):.1f},{height/2-r[name]/bound*(height/2-20):.1f}' for r in rows[::2])
        paths.append(f'<polyline points="{points}" fill="none" stroke="{colors[index]}" stroke-width="2"/>')
    legend=' · '.join(f'<span style="color:{colors[i]}">{html.escape(name)}</span>' for i,name in enumerate(names))
    return f'<section><h2>{title} <small>{unit}</small></h2><p>{legend}</p><svg viewBox="0 0 {width} {height}" role="img" aria-label="{title}"><path d="M20 {height/2}H940" stroke="#d5e0d9"/> {"".join(paths)}</svg><p>0 秒 → 14 秒</p></section>'


def write_report(output):
    rows,events=run_demo()
    peak=max(abs(r[s+'_nm']) for r in rows for s in ('left','right'))
    event_html=''.join(f'<li><b>{at:.2f}s</b> {html.escape(note)}</li>' for at,note in events)
    doc='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Emma · 力反馈离线验证</title><style>
    body{font:15px/1.7 "Segoe UI","Microsoft YaHei",sans-serif;background:#f3f5ef;color:#203b2d;max-width:1040px;margin:40px auto;padding:0 20px}h1{font-size:34px;line-height:1.3}h2{font-size:19px}small,p{color:#687e6b}section{background:white;border:1px solid #dce4d7;border-radius:18px;padding:22px;margin:20px 0}svg{width:100%;display:block}li{padding:5px}b{display:inline-block;min-width:60px}.badge{display:inline-block;background:#e1ebcc;padding:8px 16px;border-radius:30px}</style>
    <span class="badge">离线虚拟模型 · 没有硬件输出</span><h1>抬起、保持、阻尼、双侧脉冲</h1><p>Emma0924 / AIMA · 使用虚拟惯量和示例参数，检查控制流程与指令约束。图中的 N·m 为软件计算值，不是实测力矩，也不是可用于人体的推荐参数。</p>'''
    doc+=f'<section><h2>本次模拟</h2><p>1400 个控制周期 · 100 Hz · 峰值指令 {peak:.3f} N·m · 两侧示例上限 0.8 N·m</p><p>5.0s 左侧脉冲 → 5.6s 右侧 → 6.2s 双侧；7s 切换并主动重新就位；8–10s 加入虚拟手推扰动；11.5s 注入过期数据。</p></section>'
    doc+=chart(rows,['left_nm','right_nm'],.9,'双侧力矩提案','N·m')
    doc+=chart(rows,['left_deg','right_deg','left_target_deg','right_target_deg'],16,'支撑杆位置与抬起目标','°')
    doc+=chart(rows,['left_pulse_nm','right_pulse_nm'],.25,'独立游戏脉冲分量','N·m')
    doc+=f'<section><h2>状态记录</h2><ul>{event_html}</ul></section>'
    doc+='<section><h2>接真机前仍需实测</h2><p>设备身份与固件、力矩正方向、工程限位、负载/重力补偿、控制增益与力矩限值、握持检测，以及失去力矩时的机械支撑。角度观测文件不能自动填成这些参数。</p></section></html>'
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(doc,encoding='utf-8')
    with output.with_suffix('.csv').open('w',encoding='utf-8',newline='') as file:
        writer=csv.DictWriter(file,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    output.with_name('hand-hardware-profile-TEMPLATE.json').write_text(json.dumps(blank_hardware_profile(),indent=2),encoding='utf-8')
    return {'report':str(output),'peak_proposed_nm':peak,'events':events,'hardwareOutput':False}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    print(json.dumps(write_report(parser.parse_args().output),ensure_ascii=False,indent=2))
