"""Bounded telemetry collector with an ambiguous-all-zero early stop.

Bounded by the operator-approved 10 or 20 seconds; no torque writes or reconnects.
ENABLE also enables the motors. Explicit operator preparation is required.
Joint usability and passed are data-quality flags, not calibration approval,
proof of device power or mechanics, or a guarantee of uninterrupted samples.
Use the offline analysis tools to validate actual sample coverage and gaps.
"""
import argparse
from dataclasses import asdict
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import statistics
import sys
import time

import serial
from serial.tools import list_ports

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from shellos.device.frame import parse_line

EXPECTED_VERSION = 'OK,VERSION,2.9.99.1'
OUT = ROOT / 'work/hardware-test-Emma0924'
ALLOWED = frozenset(('PING', 'VERSION', 'ENABLE', 'DISABLE'))
AMBIGUOUS_ZERO_SECONDS = 2.0
AMBIGUOUS_ZERO_MINIMUM_FRAMES = 20
JOINT_KEYS = ('l_deg', 'r_deg', 'l_dps', 'r_dps')

def run(*, port, expected_serial, seconds, confirm_off_body_supported_enable=False, output_dir=None):
    if type(seconds) is not int or seconds not in (10, 20):
        raise ValueError('seconds must be an integer, either 10 or 20; no device access attempted')
    if confirm_off_body_supported_enable is not True:
        raise ValueError('ENABLE enables motors. Confirm the entire device is off-body and reliably supported; no device access attempted')
    if not isinstance(port, str) or not port.strip() or not isinstance(expected_serial, str) or not expected_serial.strip():
        raise ValueError('Explicit port and USB serial are required; no device access attempted')
    output_dir = OUT if output_dir is None else Path(output_dir)
    devices = [p for p in list_ports.comports() if p.device == port and p.vid == 0x10C4
               and p.pid == 0xEA60 and p.serial_number == expected_serial]
    if len(devices) != 1:
        raise RuntimeError('Confirmed device identity changed; no serial connection attempted')
    report = {'createdAt':datetime.now(timezone.utc).isoformat(), 'port':port,
              'usbIdentity':{'vid':devices[0].vid, 'pid':devices[0].pid, 'serial':devices[0].serial_number},
              'firmware':EXPECTED_VERSION.rsplit(',',1)[-1],
              'operatorApprovedSeconds':seconds, 'torqueCommandsSent':False,
              'operatorConfirmedOffBodySupportedEnable':True,
              'passedNote':'Capture status only; not calibration or torque approval. Offline tools must validate sample coverage and gaps.',
              'commandAttempts':[], 'responses':[], 'enableAcknowledged':False,
              'disableAcknowledged':False, 'invalidFrames':0, 'duplicates':0, 'samples':[],
              'communicationPassed':False, 'jointDataUsable':False,
              'terminationReason':'not_started', 'captureElapsedSeconds':0.0,
              'jointDataNote':'Data-quality flag only; does not certify powered working state, motor behavior, or calibration.'}
    stream = serial.Serial(port=None, baudrate=3_000_000, timeout=.05, write_timeout=.25)
    stream.dtr = False
    stream.rts = False
    stream.port = port
    enable_attempted = False
    started = None
    zero_started = None
    zero_count = 0
    halfway_reported = False

    def send(command):
        if command not in ALLOWED:
            raise ValueError('Command is outside the diagnostic whitelist')
        report['commandAttempts'].append(command)
        payload = (command+'\n').encode('ascii')
        if stream.write(payload) != len(payload):
            raise OSError('Incomplete command write')

    def receive():
        raw = stream.readline(512)
        if not raw:
            return ''
        if not raw.endswith(b'\n'):
            report['invalidFrames'] += 1
            return ''
        line = raw.decode('ascii','replace').strip()
        if line and not line.startswith('S:') and len(report['responses']) < 100:
            report['responses'].append(line[:200])
        return line

    def expect(expected, seconds=1.5):
        end = time.monotonic()+seconds
        while time.monotonic() < end:
            if receive() == expected:
                return True
        return False

    try:
        stream.open()
        print(f'{port} opened; checking identity before approved telemetry session.', flush=True)
        send('PING')
        if not expect('PONG'):
            raise RuntimeError('PING did not return PONG; ENABLE not sent')
        send('VERSION')
        if not expect(EXPECTED_VERSION):
            raise RuntimeError('Firmware identity not confirmed; ENABLE not sent')
        enable_attempted = True  # Even a partial write requires a stop attempt.
        send('ENABLE')
        report['enableAcknowledged'] = expect('OK,ENABLE')
        if not report['enableAcknowledged']:
            raise RuntimeError('ENABLE acknowledgement missing; stopping')
        print(f'ENABLE acknowledged. Sampling for {seconds} seconds; no torque writes.', flush=True)
        started = time.monotonic()
        report['terminationReason'] = 'capturing'
        while time.monotonic()-started < seconds:
            if seconds == 20 and not halfway_reported and time.monotonic()-started >= 10:
                print('Sampling 10/20 seconds. If the comfortable pose is reached, hold steady.', flush=True)
                halfway_reported = True
            invalid_before_read = report['invalidFrames']
            line = receive()
            if report['invalidFrames'] != invalid_before_read:
                zero_started = None
                zero_count = 0
            if not line.startswith('S:'):
                continue
            frame = parse_line(line, time.monotonic())
            if frame is None or not all(math.isfinite(v) for v in asdict(frame).values()):
                report['invalidFrames'] += 1
                zero_started = None
                zero_count = 0
                continue
            row = asdict(frame)
            if report['samples']:
                last = report['samples'][-1]
                if row['ms'] < last['ms']:
                    raise RuntimeError('Device clock moved backwards; capture stopped')
                if row['ms'] == last['ms']:
                    report['duplicates'] += 1
                    continue
            report['samples'].append(row)
            if all(row[key] == 0 for key in JOINT_KEYS):
                if zero_started is None:
                    zero_started = row['t_host']
                zero_count += 1
                zero_seconds = row['t_host'] - zero_started
                if zero_seconds >= AMBIGUOUS_ZERO_SECONDS and zero_count >= AMBIGUOUS_ZERO_MINIMUM_FRAMES:
                    report['terminationReason'] = 'ambiguous_joint_data'
                    report['ambiguousJointData'] = {
                        'reason':'四项关节读数持续全零，无法区分真实零位与设备未工作；已提前结束采集。',
                        'continuousSeconds':zero_seconds, 'validIncreasingFrames':zero_count,
                        'minimumSeconds':AMBIGUOUS_ZERO_SECONDS,
                        'minimumFrames':AMBIGUOUS_ZERO_MINIMUM_FRAMES,
                    }
                    break
            else:
                zero_started = None
                zero_count = 0
        if report['terminationReason'] == 'capturing':
            report['terminationReason'] = 'completed'
    except BaseException as error:
        report['error'] = str(error) or type(error).__name__
        report['terminationReason'] = 'capture_error' if started is not None else 'connection_or_handshake_error'
    finally:
        # Stop the capture timer before DISABLE retries; retain elapsed time on errors.
        if started is not None:
            report['captureElapsedSeconds'] = max(0.0, time.monotonic()-started)
        if enable_attempted and stream.is_open:
            for _ in range(2):
                try:
                    send('DISABLE')
                    if expect('OK,DISABLE', 1.0):
                        report['disableAcknowledged'] = True
                        break
                except BaseException as error:
                    report['stopError'] = str(error) or type(error).__name__
        try:
            stream.close()
        except BaseException as error:
            report['closeError'] = str(error) or type(error).__name__
        report['serialClosed'] = not stream.is_open

    rows = report['samples']
    report['frameCount'] = len(rows)
    if len(rows) > 1:
        gaps = [b['t_host']-a['t_host'] for a,b in zip(rows,rows[1:])]
        host_span = rows[-1]['t_host']-rows[0]['t_host']
        report['observedHz'] = (len(rows)-1)/host_span if host_span > 0 else None
        report['maxHostGapMs'] = max(gaps)*1000
        report['deviceTimeSpanMs'] = rows[-1]['ms']-rows[0]['ms']
        report['jointStats'] = {side: {'medianDeg':statistics.median(r[key+'_deg'] for r in rows),
            'minDeg':min(r[key+'_deg'] for r in rows), 'maxDeg':max(r[key+'_deg'] for r in rows),
            'maxAbsSpeedDps':max(abs(r[key+'_dps']) for r in rows)} for side,key in [('left','l'),('right','r')]}
    report['communicationPassed'] = bool(
        report['enableAcknowledged'] and report['disableAcknowledged'] and report['serialClosed']
        and not any(report.get(key) for key in ('error', 'stopError', 'closeError'))
        and len(rows) >= 20 and report['invalidFrames'] == 0)
    report['jointDataUsable'] = bool(
        len(rows) >= 20 and 'ambiguousJointData' not in report
        and not report.get('error') and report['invalidFrames'] == 0
        and any(any(row[key] != 0 for key in JOINT_KEYS) for row in rows))
    if report['terminationReason'] == 'completed':
        if not report['disableAcknowledged']:
            report['terminationReason'] = 'disable_ack_missing'
        elif not report['serialClosed'] or report.get('closeError'):
            report['terminationReason'] = 'close_failed'
        elif not report['communicationPassed']:
            report['terminationReason'] = 'communication_failed'
    report['passed'] = bool(report['communicationPassed'] and report['jointDataUsable']
                            and report['terminationReason'] == 'completed'
                            and report['captureElapsedSeconds'] >= seconds)
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / (f'telemetry-{seconds}s-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.json')
    with target.open('x', encoding='utf-8') as file:
        json.dump(report, file, ensure_ascii=False, indent=2)
    print(json.dumps({'report':str(target), **{k:v for k,v in report.items() if k != 'samples'}}, ensure_ascii=False))
    return 0 if report['passed'] else 1

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', required=True, help='Explicit serial port, for example COM6')
    parser.add_argument('--serial', required=True, help='Expected USB serial number of the selected device')
    parser.add_argument('--seconds', type=int, choices=(10, 20), required=True,
                        help='Explicit operator-approved sampling duration')
    parser.add_argument('--confirm-off-body-supported-enable', action='store_true', required=True,
                        help='Confirm the entire device is off-body and reliably supported; ENABLE also enables motors')
    parser.add_argument('--output-dir', type=Path, default=OUT,
                        help='Local capture directory (default: ignored work/hardware-test-Emma0924)')
    actual_argv = sys.argv[1:] if argv is None else argv
    if not actual_argv:
        parser.print_help()
        return 0
    args = parser.parse_args(actual_argv)
    return run(port=args.port, expected_serial=args.serial, seconds=args.seconds,
               confirm_off_body_supported_enable=args.confirm_off_body_supported_enable,
               output_dir=args.output_dir)


if __name__ == '__main__':
    raise SystemExit(main())
