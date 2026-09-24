"""Offline, independently confirmed two-point lift input observations per side.

center means that side's game input 0%, upper means its input 100%.
No mechanical midpoint, motor profile, serial access, or control output is inferred.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import importlib.util
import json
from pathlib import Path


_validator_path = Path(__file__).with_name('combine-hand-elevation-Emma0924.py')
_spec = importlib.util.spec_from_file_location('lift_observation_validation', _validator_path)
_validation = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_validation)
SIDES = ('left', 'right')
POSES = ('center', 'upper')
INPUT_NAMES = ('left_center', 'left_upper', 'right_center', 'right_upper')
FLAGS = {'hardwareReady': False, 'motorLimits': False, 'hardwareOutput': False}


def _identity(record):
    return record['port'], record['usbIdentity'], record['source']['firmware']


def _continuity(sources):
    origins = [source['clockOriginHostSeconds'] for source in sources.values()]
    spread = max(origins) - min(origins)
    if spread > _validation.CLOCK_ORIGIN_TOLERANCE_SECONDS + 1e-9:
        raise ValueError('主机/板时原点跨度超过 0.1 秒；观测可保留，但需在同一主机重采同轮输入位置，不能合并。')
    return {
        'method': 'median(sample.at - sample.sequence / 1000), independently recomputed',
        'maximumSpreadSeconds': _validation.CLOCK_ORIGIN_TOLERANCE_SECONDS,
        'betweenObservationOriginSpreadSeconds': spread,
        'sameHostMonotonicClockRequired': True,
        'deviceSessionAuthenticated': False, 'devicePowerStateConfirmed': False,
        'note': '仅适用于同一采集主机、同一 monotonic 时钟基准的连续性启发检查；不证明设备会话或开机状态。',
    }


def _confirmed_record(record, side, pose, observation_path):
    medians = _validation.validate_record(record, pose)
    intended = record.get('intendedSides')
    if (not isinstance(intended, list) or side not in intended
            or any(item not in SIDES for item in intended)):
        raise ValueError(f'{side}/{pose}: intendedSides must explicitly confirm the target side')
    if record.get('physicalStopReached') is not False:
        raise ValueError(f'{side}/{pose}: explicit physicalStopReached=false is required')
    if not _validation.valid_text(record.get('operatorDescription')):
        raise ValueError(f'{side}/{pose}: operatorDescription is required')
    if not _validation.valid_text(observation_path):
        raise ValueError(f'{side}/{pose}: missing observation file path')
    try:
        clock = _validation.clock_origin(record, f'{side}/{pose}')
    except ValueError as error:
        raise ValueError(str(error).replace('重采同轮三姿态', '重采同轮该侧两个输入位置')) from error
    source = {
        'observationPath': observation_path, 'telemetryPath': record['source']['path'],
        'firmware': record['source']['firmware'], 'port': record['port'], 'usbIdentity': record['usbIdentity'],
        'createdAt': record.get('createdAt'), 'frameCount': record['frameCount'],
        'duration_s': record['duration_s'], 'targetSide': side, 'pose': pose,
        'intendedSides': list(intended), 'operatorDescription': record['operatorDescription'],
        'physicalStopReached': False, 'targetStats': dict(record['stats'][side]), **clock,
    }
    return medians[side], source


def check_axis(side, center, upper, *, source_paths):
    """Validate one side only; never substitutes the other side or emits a bundle.

source_paths must map 'center' and 'upper' to their observation file paths.
"""
    if side not in SIDES:
        raise ValueError('side must be left or right')
    if not isinstance(source_paths, dict):
        raise ValueError('source_paths must map center and upper to observation paths')
    center_deg, center_source = _confirmed_record(center, side, 'center', source_paths.get('center'))
    upper_deg, upper_source = _confirmed_record(upper, side, 'upper', source_paths.get('upper'))
    if _identity(center) != _identity(upper):
        raise ValueError(f'{side}: all observations must use the same port, USB identity, and firmware')
    sources = {'center': center_source, 'upper': upper_source}
    continuity = _continuity(sources)
    delta = upper_deg - center_deg
    if not _validation.finite(delta) or abs(delta) < 3:
        raise ValueError(f'{side}: 舒适上抬与游戏起点的角度差须至少 3°；观测可保留，但软件输入标定未通过。')
    return {
        'schema': 'aima.hand.lift-axis-observation.v1', 'side': side,
        'scope': 'software-input-observations-only',
        'observed': {'center_deg': center_deg, 'upper_deg': upper_deg,
                     'lift_angle_direction': 1 if delta > 0 else -1, 'span_deg': abs(delta)},
        'inputMeaning': {'center': '该侧游戏输入 0%', 'upper': '该侧游戏输入 100%'},
        'sources': sources, 'clockContinuity': continuity, **FLAGS,
        'note': 'center 仅是该侧游戏输入起点，不表示力学中位；方向符号不表示力矩极性。'
                '另一侧静止角度未用于此侧端点；未生成控制器配置。',
    }


def combine_observations(left_center, left_upper, right_center, right_upper, *, source_paths):
    if not isinstance(source_paths, dict):
        raise ValueError('source_paths must include all four observation paths')
    records = dict(zip(INPUT_NAMES, (left_center, left_upper, right_center, right_upper)))
    axes = {}
    for side in SIDES:
        axes[side] = check_axis(side, records[side + '_center'], records[side + '_upper'],
                               source_paths={pose: source_paths.get(side + '_' + pose) for pose in POSES})
    if any(_identity(record) != _identity(left_center) for record in records.values()):
        raise ValueError('Both sides must use the same port, USB identity, and firmware')
    sources = {side + '_' + pose: axes[side]['sources'][pose] for side in SIDES for pose in POSES}
    continuity = _continuity(sources)
    port, usb, firmware = _identity(left_center)
    return {
        'schema': 'aima.hand.lift-input-observation-bundle.v1',
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'scope': 'software-input-observations-only',
        'port': port, 'usbIdentity': usb, 'firmware': firmware,
        'observed': {side: axes[side]['observed'] for side in SIDES},
        'inputMeaning': {'center': '各侧独立游戏输入 0%', 'upper': '各侧独立游戏输入 100%'},
        'sources': sources, 'clockContinuity': continuity, **FLAGS,
        'note': '左右侧分别按已确认的起点和舒适上抬位置记录；center 不表示力学中位。'
                '仅供软件输入观察，不表示机械限位、力矩方向或可用控制参数。'
                '右侧沿用既有归一化读数，未再次翻转；未生成任何控制器配置文件。',
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in (*INPUT_NAMES, 'output'):
        parser.add_argument('--' + name.replace('_', '-'), type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.output.exists():
            raise ValueError('Output exists; choose a new filename')
        paths = {name: str(getattr(args, name).resolve()) for name in INPUT_NAMES}
        records = [json.loads(Path(paths[name]).read_text(encoding='utf-8-sig')) for name in INPUT_NAMES]
        result = combine_observations(*records, source_paths=paths)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('x', encoding='utf-8') as file:
            json.dump(result, file, ensure_ascii=False, indent=2, allow_nan=False)
    except (OSError, ValueError, TypeError) as error:
        parser.error(str(error))
    print(json.dumps({'file': str(args.output.resolve()), 'observed': result['observed'],
                      'scope': result['scope'], **FLAGS}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
