"""Offline analysis of a 10- or 20-second, operator-labelled single-side lift.

Plan: hold for the first 3 seconds, slowly lift only the target side, then hold
for the final 3 seconds. No serial, network, or hardware actions are performed.
An insufficient observation is still saved, with no direction conclusion.
"""
from __future__ import annotations

import argparse
from dataclasses import fields
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import statistics
import sys


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from shellos.device.frame import Frame


FRAME_KEYS = {field.name for field in fields(Frame)}
SIDE_KEYS = {'left': 'l', 'right': 'r'}


def load_capture(source: Path):
    report = json.loads(source.read_text(encoding='utf-8-sig'))
    if not isinstance(report, dict):
        raise ValueError('Expected a saved telemetry report object')
    for key in ('passed', 'enableAcknowledged', 'disableAcknowledged', 'serialClosed'):
        if report.get(key) is not True:
            raise ValueError(f'Source report must confirm {key}')
    if report.get('torqueCommandsSent') is not False or 'error' in report or 'stopError' in report:
        raise ValueError('Source must report no torque commands, error, or stopError')
    if type(report.get('invalidFrames')) is not int or report['invalidFrames'] != 0:
        raise ValueError('Source must have invalidFrames = 0')
    approved_seconds = report.get('operatorApprovedSeconds')
    if type(approved_seconds) is not int or approved_seconds not in (10, 20):
        raise ValueError('operatorApprovedSeconds must be integer 10 or 20')
    if report.get('commandAttempts') not in (
            ['PING', 'VERSION', 'ENABLE', 'DISABLE'],
            ['PING', 'VERSION', 'ENABLE', 'DISABLE', 'DISABLE']):
        raise ValueError('Unexpected source command sequence')
    firmware, responses = report.get('firmware'), report.get('responses')
    if not isinstance(firmware, str) or not firmware.strip():
        raise ValueError('Missing firmware identity')
    if not isinstance(responses, list) or not all(isinstance(value, str) for value in responses):
        raise ValueError('Missing source acknowledgements')
    if (not {'PONG', 'OK,VERSION,' + firmware, 'OK,ENABLE', 'OK,DISABLE'}.issubset(responses)
            or any(value.startswith('ERR,') for value in responses)):
        raise ValueError('Source acknowledgements do not confirm success and firmware')
    if not isinstance(report.get('port'), str) or not report['port'].strip():
        raise ValueError('Missing source port')
    identity = report.get('usbIdentity')
    if (not isinstance(identity, dict)
            or any(type(identity.get(key)) is not int or not 0 <= identity[key] <= 65535
                   for key in ('vid', 'pid'))
            or not isinstance(identity.get('serial'), str) or not identity['serial'].strip()):
        raise ValueError('usbIdentity must contain numeric vid/pid and a nonempty serial')
    rows = report.get('samples')
    if (not isinstance(rows, list) or len(rows) < 2
            or type(report.get('frameCount')) is not int or report['frameCount'] != len(rows)):
        raise ValueError('Missing samples or mismatched frameCount')
    frames = []
    for index, row in enumerate(rows):
        if (not isinstance(row, dict) or set(row) != FRAME_KEYS
                or not all(type(value) in (int, float) and math.isfinite(value) for value in row.values())):
            raise ValueError(f'Invalid Frame sample at index {index}')
        # The saved report already normalized the right side; do not parse it again.
        frame = Frame(**row)
        if frames and (frame.ms <= frames[-1].ms or frame.t_host < frames[-1].t_host):
            raise ValueError('Duplicate/backwards device time or backwards host time')
        frames.append(frame)
    origins = [frame.t_host - frame.ms / 1000 for frame in frames]
    if max(origins) - min(origins) > .1:
        raise ValueError('Host and board clock origins are not continuous within 0.1 seconds')
    return report, frames, origins


def angle_stats(frames, side):
    key = SIDE_KEYS[side]
    angles = [getattr(frame, key + '_deg') for frame in frames]
    speeds = [abs(getattr(frame, key + '_dps')) for frame in frames]
    return {'medianDeg': statistics.median(angles), 'minDeg': min(angles), 'maxDeg': max(angles),
            'spanDeg': max(angles) - min(angles), 'maxAbsSpeedDps': max(speeds)}


def window_stats(frames):
    duration = frames[-1].t_host - frames[0].t_host
    max_gap = max((b.t_host - a.t_host for a, b in zip(frames, frames[1:])), default=0)
    sides = {side: angle_stats(frames, side) for side in SIDE_KEYS}
    all_zero = all(frame.l_deg == frame.r_deg == frame.l_dps == frame.r_dps == 0 for frame in frames)
    stable = (len(frames) >= 20 and duration >= 2.8 and max_gap <= .1
              and all(stats['spanDeg'] <= 2 and stats['maxAbsSpeedDps'] <= 5 for stats in sides.values()))
    return {'frameCount': len(frames), 'firstHostTime': frames[0].t_host,
            'lastHostTime': frames[-1].t_host, 'firstDeviceMs': frames[0].ms,
            'lastDeviceMs': frames[-1].ms, 'durationSeconds': duration,
            'maxHostGapSeconds': max_gap, 'stable': stable,
            'allJointChannelsZero': all_zero, 'sides': sides}


def analyze(source: Path, target: str) -> dict:
    if target not in SIDE_KEYS:
        raise ValueError('Target must be left or right')
    source = Path(source).resolve()
    report, frames, origins = load_capture(source)
    before_frames = [frame for frame in frames if frame.t_host <= frames[0].t_host + 3]
    after_frames = [frame for frame in frames if frame.t_host >= frames[-1].t_host - 3]
    before, after = window_stats(before_frames), window_stats(after_frames)
    overall = {side: angle_stats(frames, side) for side in SIDE_KEYS}
    deltas = {side: after['sides'][side]['medianDeg'] - before['sides'][side]['medianDeg']
              for side in SIDE_KEYS}
    other = 'right' if target == 'left' else 'left'
    duration = frames[-1].t_host - frames[0].t_host
    max_gap = max(b.t_host - a.t_host for a, b in zip(frames, frames[1:]))
    reasons = []
    approved_seconds = report['operatorApprovedSeconds']
    if not approved_seconds - .2 <= duration <= approved_seconds + .2:
        reasons.append(f'实际样本跨度 {duration:.3f} 秒与批准的 {approved_seconds} 秒不符（容差 0.2 秒）')
    if max_gap > .1:
        reasons.append('整段存在超过 0.1 秒的数据间隙，不能确认非目标侧全程保持')
    if before_frames[-1].t_host >= after_frames[0].t_host:
        reasons.append('初末观察窗口重叠')
    for name, window in (('初始', before), ('末尾', after)):
        if not window['stable']:
            reasons.append(name + '三秒窗口稳定性或有效时长不足')
        if window['allJointChannelsZero']:
            reasons.append(name + '窗口四项关节读数持续全零，无法区分真实零位与设备未工作')
    if abs(deltas[target]) < 3:
        reasons.append('目标侧前后中位角变化不足 3 度')
    if overall[other]['spanDeg'] > 2:
        reasons.append('非目标侧整段角度跨度超过 2 度')
    imu = {}
    for field in ('pitch', 'roll'):
        first = statistics.median(getattr(frame, field) for frame in before_frames)
        last = statistics.median(getattr(frame, field) for frame in after_frames)
        values = [getattr(frame, field) for frame in frames]
        imu[field] = {'beforeMedianDeg': first, 'afterMedianDeg': last,
                      'medianDeltaDeg': last - first, 'overallSpanDeg': max(values) - min(values)}
    sufficient = not reasons
    return {
        'schema': 'aima.hand.single-lift-observation.v1',
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'source': {'path': str(source), 'createdAt': report.get('createdAt'),
                   'port': report['port'], 'usbIdentity': report['usbIdentity'],
                   'firmware': report['firmware'], 'frameCount': len(frames),
                   'operatorApprovedSeconds': approved_seconds,
                   'clockOriginHostSeconds': statistics.median(origins),
                   'clockOriginSpreadSeconds': max(origins) - min(origins),
                   'clockOriginNote': 'Original Windows monotonic seconds minus board ms / 1000 over the full capture; 0.1 s checks clock continuity only, not power or working state.'},
        'selectionRule': 'Original samples in first 3.0 seconds and final 3.0 seconds, inclusive; no interpolation or sign changes.',
        'target': target, 'before': before, 'after': after,
        'medianDeltaDeg': deltas, 'targetDeltaDeg': deltas[target],
        'nonTarget': other, 'nonTargetOverallSpanDeg': overall[other]['spanDeg'],
        'overallDurationSeconds': duration, 'overallMaxHostGapSeconds': max_gap,
        'imu': imu,
        'imuNote': 'Raw pitch/roll changes are reference information only, without wrap correction; they do not determine the conclusion.',
        'observationSufficient': sufficient, 'status': 'sufficient' if sufficient else 'insufficient',
        'insufficientReasons': reasons,
        'direction': ('angle_increases' if deltas[target] > 0 else 'angle_decreases') if sufficient else None,
        'scope': 'Only the input-angle change for the operator-labelled lift in this placement. The physical action was not independently observed; this is not an engineering limit or torque-polarity verification.',
        'hardwareOutput': False, 'motorLimits': False, 'torquePolarityVerified': False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--target', choices=('left', 'right'), required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.output.exists():
            raise ValueError('Output exists; choose a new filename')
        result = analyze(args.source, args.target)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('x', encoding='utf-8') as file:
            json.dump(result, file, ensure_ascii=False, indent=2, allow_nan=False)
    except (OSError, ValueError, TypeError) as error:
        parser.error(str(error))
    print(json.dumps({'file': str(args.output.resolve()), 'status': result['status'],
                      'target': result['target'], 'targetDeltaDeg': result['targetDeltaDeg'],
                      'nonTargetOverallSpanDeg': result['nonTargetOverallSpanDeg'],
                      'direction': result['direction'],
                      'insufficientReasons': result['insufficientReasons']}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
