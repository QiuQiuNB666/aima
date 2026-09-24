"""Read-only serial pose capture: no handshake, ENABLE, torque, or reconnect.

Run from repo root: python -m shellos.hands.capture --help
"""
from __future__ import annotations
import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import statistics
import time

from ..device.frame import parse_line
from ..device.ownership import DeviceLease


class PoseRecorder:
    def __init__(self):
        self.rows = []
        self.invalid = 0
        self.clock_resets = 0
        self._last_sequence = None

    def add(self, frame):
        if frame is None or not all(math.isfinite(v) for v in asdict(frame).values()):
            self.invalid += 1
            return False
        if self._last_sequence is not None:
            if frame.ms < self._last_sequence:
                self.clock_resets += 1
                raise ValueError('Device clock reset during capture; discard and start a new observation')
            if frame.ms == self._last_sequence:
                return False
            if frame.t_host <= self.rows[-1]['at']:
                raise ValueError('Host clock did not advance')
        self._last_sequence = frame.ms
        self.rows.append({'at': frame.t_host, 'sequence': frame.ms, 'left_deg': frame.l_deg,
                          'right_deg': frame.r_deg, 'left_dps': frame.l_dps, 'right_dps': frame.r_dps})
        return True

    def result(self, port, pose, usb_identity=None):
        rows = self.rows
        if len(rows) < 20 or rows[-1]['at']-rows[0]['at'] < .5:
            raise ValueError('Insufficient streaming data; capture sends no ENABLE to start a stream')
        gaps = [b['at']-a['at'] for a,b in zip(rows,rows[1:])]
        stats = {}
        stable = max(gaps) <= .1
        for side in ('left', 'right'):
            values = [r[side+'_deg'] for r in rows]
            speeds = [abs(r[side+'_dps']) for r in rows]
            stats[side] = dict(median_deg=statistics.median(values), min_deg=min(values), max_deg=max(values),
                               std_deg=statistics.pstdev(values), max_speed_dps=max(speeds))
            stable &= max(values)-min(values) <= 2 and max(speeds) <= 5
        return {'schema':'aima.hand.pose-observation.v1', 'createdAt':datetime.now(timezone.utc).isoformat(),
                'port':port, 'usbIdentity':usb_identity, 'pose':pose, 'frameCount':len(rows),
                'duration_s':rows[-1]['at']-rows[0]['at'], 'max_gap_s':max(gaps),
                'stable':bool(stable), 'stats':stats, 'samples':rows, 'invalidLines':self.invalid,
                'hardwareOutput':False, 'motorLimits':False,
                'note':'Angle observations only; right side is already normalized by ShellOS. No force, sign or load certification.'}


def read_pose(stream, seconds, *, clock=time.monotonic):
    recorder = PoseRecorder()
    start = clock()
    while clock()-start < seconds:
        raw = stream.readline(512)
        if not raw:
            continue
        if not raw.endswith(b'\n'):
            recorder.invalid += 1
            continue
        line = raw.decode('ascii', 'replace').strip()
        if line.startswith('S:'):
            recorder.add(parse_line(line, clock()))
    return recorder


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', required=True, help='Explicit hand-device COM/path; never auto-selects')
    parser.add_argument('--pose', required=True, choices=['center','back','forward','rest'])
    parser.add_argument('--seconds', type=float, default=3)
    parser.add_argument('--output', type=Path, required=True)
    args=parser.parse_args()
    if not math.isfinite(args.seconds) or not .6 <= args.seconds <= 30:
        parser.error('--seconds must be between 0.6 and 30')
    if args.output.exists():
        parser.error('Output exists; use a new file to preserve prior observations')
    import serial
    from serial.tools import list_ports
    devices=[p for p in list_ports.comports() if p.device == args.port]
    usb=None
    if len(devices)==1:
        p=devices[0]
        usb={'vid':p.vid,'pid':p.pid,'serial':p.serial_number}
    # Separate driver, not SerialLink: no startup handshake, auto-reconnect,
    # recovery or close-time DISABLE. Opening a port may still affect USB lines;
    # the operator must confirm this device is mechanically supported.
    with DeviceLease(args.port, 'capture'):
        stream=serial.Serial(port=None, baudrate=3_000_000, timeout=.05, write_timeout=.05)
        stream.dtr=False; stream.rts=False; stream.port=args.port
        try:
            stream.open()
            print(f'Read-only capture: {args.port}, {args.pose}, {args.seconds}s. No ENABLE or torque commands.', flush=True)
            recorder=read_pose(stream,args.seconds)
        finally:
            stream.close()
    result=recorder.result(args.port,args.pose,usb)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open('x',encoding='utf-8') as file:
        json.dump(result,file,ensure_ascii=False,indent=2)
    print(json.dumps({'file':str(args.output),'stable':result['stable'],'stats':result['stats'],
                      'hardwareOutput':False},ensure_ascii=False))


if __name__ == '__main__':
    main()
