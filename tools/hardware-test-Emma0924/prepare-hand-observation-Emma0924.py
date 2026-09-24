"""Convert a successful saved telemetry report into a stable pose observation.

Offline only: reads JSON and imports the Frame/PoseRecorder data helpers.
It never opens a serial port, starts capture, or sends device commands.
"""
from __future__ import annotations

import argparse
from dataclasses import fields
import json
import math
from pathlib import Path
import statistics
import sys


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from shellos.device.frame import Frame
from shellos.hands.capture import PoseRecorder


WINDOW_SECONDS = 3.0
MINIMUM_SPAN_SECONDS = 2.8
FRAME_KEYS = {field.name for field in fields(Frame)}


def prepare_observation(source: Path, pose: str) -> dict:
    if pose not in ('center', 'back', 'forward', 'upper', 'lower'):
        raise ValueError('Pose must be center, back, forward, upper, or lower')
    source = Path(source).resolve()
    report = json.loads(source.read_text(encoding='utf-8-sig'))
    if not isinstance(report, dict):
        raise ValueError('Expected a saved telemetry report object')
    for name in ('passed', 'enableAcknowledged', 'disableAcknowledged', 'serialClosed'):
        if report.get(name) is not True:
            raise ValueError(f'Source report must confirm {name}')
    if report.get('torqueCommandsSent') is not False:
        raise ValueError('Source report must confirm torqueCommandsSent is false')
    if 'error' in report or 'stopError' in report:
        raise ValueError('Source report contains an error or stopError')
    if type(report.get('invalidFrames')) is not int or report['invalidFrames'] != 0:
        raise ValueError('Source report must have invalidFrames = 0')
    approved_seconds = report.get('operatorApprovedSeconds')
    if type(approved_seconds) is not int or approved_seconds not in (10, 20):
        raise ValueError('operatorApprovedSeconds must be integer 10 or 20')
    commands = report.get('commandAttempts')
    if commands not in (['PING', 'VERSION', 'ENABLE', 'DISABLE'],
                        ['PING', 'VERSION', 'ENABLE', 'DISABLE', 'DISABLE']):
        raise ValueError('Unexpected source command sequence')
    firmware = report.get('firmware')
    if not isinstance(firmware, str) or not firmware.strip():
        raise ValueError('Missing firmware identity')
    responses = report.get('responses')
    required = {'PONG', 'OK,VERSION,' + firmware, 'OK,ENABLE', 'OK,DISABLE'}
    if not isinstance(responses, list) or not all(isinstance(item, str) for item in responses):
        raise ValueError('Missing source acknowledgements')
    if not required.issubset(responses) or any(item.startswith('ERR,') for item in responses):
        raise ValueError('Source acknowledgements do not confirm success and firmware')
    port = report.get('port')
    if not isinstance(port, str) or not port.strip():
        raise ValueError('Missing source port')
    identity = report.get('usbIdentity')
    if (not isinstance(identity, dict)
            or any(type(identity.get(key)) is not int or not 0 <= identity[key] <= 65535
                   for key in ('vid', 'pid'))
            or not isinstance(identity.get('serial'), str) or not identity['serial'].strip()):
        raise ValueError('usbIdentity must contain numeric vid/pid and a nonempty serial')

    samples = report.get('samples')
    if not isinstance(samples, list) or not samples:
        raise ValueError('Missing source samples')
    if type(report.get('frameCount')) is not int or report['frameCount'] != len(samples):
        raise ValueError('Source frameCount does not match its samples')
    frames = []
    for index, row in enumerate(samples):
        if (not isinstance(row, dict) or set(row) != FRAME_KEYS
                or not all(type(value) in (int, float) and math.isfinite(value)
                           for value in row.values())):
            raise ValueError(f'Invalid Frame sample at index {index}')
        # Saved telemetry already passed parse_line; do not normalize right twice.
        frame = Frame(**row)
        if frames and (frame.ms <= frames[-1].ms or frame.t_host < frames[-1].t_host):
            raise ValueError('Source samples contain duplicate/backwards device time or backwards host time')
        frames.append(frame)

    capture_span = frames[-1].t_host - frames[0].t_host
    if not approved_seconds - .2 <= capture_span <= approved_seconds + .2:
        raise ValueError(f'Actual sample span {capture_span:.3f}s does not match approved '
                         f'{approved_seconds}s within 0.2s')
    cutoff = frames[-1].t_host - WINDOW_SECONDS
    selected = [frame for frame in frames if frame.t_host >= cutoff]
    span = selected[-1].t_host - selected[0].t_host
    if span < MINIMUM_SPAN_SECONDS:
        raise ValueError(f'Final window spans only {span:.3f}s; at least 2.8s required')
    if all(frame.l_deg == frame.r_deg == frame.l_dps == frame.r_dps == 0 for frame in selected):
        raise ValueError('四项关节读数持续全零，无法区分真实零位与设备未工作，请确认后重采')
    recorder = PoseRecorder()
    for frame in selected:
        if not recorder.add(frame):
            raise ValueError('PoseRecorder rejected a selected frame')
    result = recorder.result(port, pose, identity)
    if result['stable'] is not True:
        raise ValueError('Final three-second window is not stable; no observation exported')
    clock_origins = [frame.t_host - frame.ms / 1000 for frame in selected]
    result['source'] = {
        'path': str(source), 'firmware': firmware, 'createdAt': report.get('createdAt'),
        'frameCount': len(frames), 'operatorApprovedSeconds': approved_seconds,
        'clockOriginHostSeconds': statistics.median(clock_origins),
        'clockOriginSpreadSeconds': max(clock_origins) - min(clock_origins),
        'clockOriginNote': 'Median of original Windows time.monotonic() seconds minus board ms / 1000 '
                           'over the selected frames. A 0.1-second tolerance is only a clock-continuity '
                           'check between captures using the same host monotonic clock; it does not '
                           'prove device power or working state.',
    }
    result['selection'] = {
        'rule': 'Keep original samples with t_host >= last t_host - 3.0 seconds; no interpolation or sign changes',
        'requestedWindowSeconds': WINDOW_SECONDS, 'minimumSpanSeconds': MINIMUM_SPAN_SECONDS,
        'actualSpanSeconds': span, 'firstSourceIndex': len(frames) - len(selected),
        'lastSourceIndex': len(frames) - 1, 'frameCount': len(selected),
        'firstHostTime': selected[0].t_host, 'lastHostTime': selected[-1].t_host,
        'firstDeviceMs': selected[0].ms, 'lastDeviceMs': selected[-1].ms,
    }
    result['note'] += ' Converted offline from an ENABLE/DISABLE telemetry session; no torque commands were reported.'
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--pose', choices=('center', 'back', 'forward', 'upper', 'lower'), required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.output.exists():
            raise ValueError('Output exists; choose a new filename')
        result = prepare_observation(args.source, args.pose)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('x', encoding='utf-8') as file:
            json.dump(result, file, ensure_ascii=False, indent=2, allow_nan=False)
    except (OSError, ValueError, TypeError) as error:
        parser.error(str(error))
    print(json.dumps({'file': str(args.output.resolve()), 'pose': result['pose'],
                      'frameCount': result['frameCount'], 'duration_s': result['duration_s'],
                      'stable': result['stable'], 'stats': result['stats'],
                      'hardwareOutput': False, 'motorLimits': False}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
