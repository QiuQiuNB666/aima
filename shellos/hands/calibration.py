"""Combine stable read-only observations, without inventing motor parameters."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from .profile import number, blank_hardware_profile


def combine_observations(center, back, forward):
    observations={'center':center,'back':back,'forward':forward}
    port=None; usb=None; axes={'left':{},'right':{}}
    for name,record in observations.items():
        if not isinstance(record,dict) or record.get('schema')!='aima.hand.pose-observation.v1':
            raise ValueError('Expected a read-only pose observation')
        if record.get('pose')!=name or record.get('stable') is not True or record.get('hardwareOutput') is not False or record.get('motorLimits') is not False:
            raise ValueError('Each observation must be stable, correctly named, and not a motor configuration')
        if not isinstance(record.get('port'),str) or not record['port']:
            raise ValueError('Missing source port')
        if port is None:
            port,usb=record['port'],record.get('usbIdentity')
        elif record['port']!=port or record.get('usbIdentity')!=usb:
            raise ValueError('All observations must refer to the same USB identity and port')
        for side in axes:
            stats=record.get('stats',{}).get(side,{})
            values=[stats.get(k) for k in ('median_deg','min_deg','max_deg','std_deg','max_speed_dps')]
            if not all(number(v) for v in values):
                raise ValueError('Invalid observation statistics')
            median,low,high,std,speed=values
            if not low<=median<=high or high-low>2 or not 0<=std<=2 or not 0<=speed<=5:
                raise ValueError('Observation not sufficiently stable')
            axes[side][name+'_deg']=median
    for side,data in axes.items():
        a=data['back_deg']-data['center_deg'];b=data['forward_deg']-data['center_deg']
        if a*b>=0 or min(abs(a),abs(b))<3:
            raise ValueError(side+' center must lie between comfortable back/forward, at least 3 degrees each')
        data['forward_angle_direction']=1 if b>0 else -1
    return {'schema':'aima.hand.observation-bundle.v1','port':port,'usbIdentity':usb,'observed':axes,
            'hardwareOutput':False,'motorLimits':False,'hardwareReady':False,
            'pending':['device/firmware identity verification','torque and velocity sign verification',
                       'engineering joint limits','load/gravity identification','validated gains, torque and rate limits',
                       'physical grip/mount/strap interlocks','retention response and local emergency stop'],
            'note':'Comfortable angles are observations only. Forward angle direction does not prove torque polarity.'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('center','back','forward','output'):
        parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args()
    if args.output.exists():parser.error('Output exists; choose a new filename')
    values=[json.loads(getattr(args,name).read_text(encoding='utf-8-sig')) for name in ('center','back','forward')]
    result=combine_observations(*values)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open('x',encoding='utf-8') as file:json.dump(result,file,ensure_ascii=False,indent=2)
    template=args.output.with_name(args.output.stem+'-hardware-TEMPLATE.json')
    if not template.exists():
        with template.open('x',encoding='utf-8') as file:json.dump(blank_hardware_profile(),file,indent=2)
    print(json.dumps({'file':str(args.output),'observed':result['observed'],'hardwareReady':False},ensure_ascii=False))


if __name__=='__main__':main()
