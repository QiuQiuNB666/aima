"""Offline comfortable lower/center/upper observations for software input only.

No hardware imports, serial access, motor profile, or torque configuration.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import statistics


POSES = ('center', 'lower', 'upper')
SIDES = ('left', 'right')
STATS = ('median_deg', 'min_deg', 'max_deg', 'std_deg', 'max_speed_dps')
CLOCK_ORIGIN_TOLERANCE_SECONDS = .1


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def valid_text(value):
    return isinstance(value, str) and bool(value.strip())


def validate_stop_annotations(value, pose):
    if type(value) is float and not math.isfinite(value):
        raise ValueError(f'{pose}: nonfinite metadata or sample value')
    if isinstance(value, dict):
        for key, child in value.items():
            if key == 'physicalStopReached' and child is not False:
                raise ValueError(f'{pose}: physicalStopReached must be false when present; '
                                 '机械极限观测不能作为游戏工作端点，观测可保留但不导出标定')
            validate_stop_annotations(child, pose)
    elif isinstance(value, list):
        for child in value:
            validate_stop_annotations(child, pose)


def validate_record(record, pose):
    if not isinstance(record, dict) or record.get('schema') != 'aima.hand.pose-observation.v1':
        raise ValueError(f'{pose}: expected a pose-observation.v1 record')
    if (record.get('pose') != pose or record.get('stable') is not True
            or record.get('hardwareOutput') is not False or record.get('motorLimits') is not False):
        raise ValueError(f'{pose}: must be correctly named, stable, and not a motor configuration')
    validate_stop_annotations(record, pose)
    if not valid_text(record.get('port')):
        raise ValueError(f'{pose}: missing port')
    usb = record.get('usbIdentity')
    if (not isinstance(usb, dict)
            or any(type(usb.get(k)) is not int or not 0 <= usb[k] <= 65535 for k in ('vid', 'pid'))
            or not valid_text(usb.get('serial'))):
        raise ValueError(f'{pose}: missing complete USB identity')
    source = record.get('source')
    if (not isinstance(source, dict) or not valid_text(source.get('firmware'))
            or not valid_text(source.get('path'))):
        raise ValueError(f'{pose}: missing source path or firmware identity')
    if record.get('invalidLines') != 0 or type(record.get('invalidLines')) is not int:
        raise ValueError(f'{pose}: invalid source lines')

    rows = record.get('samples')
    if (not isinstance(rows, list) or len(rows) < 20
            or type(record.get('frameCount')) is not int or record['frameCount'] != len(rows)):
        raise ValueError(f'{pose}: missing samples or inconsistent frame count')
    keys = {'at', 'sequence', 'left_deg', 'right_deg', 'left_dps', 'right_dps'}
    for i, row in enumerate(rows):
        if not isinstance(row, dict) or set(row) != keys or not all(finite(v) for v in row.values()):
            raise ValueError(f'{pose}: nonfinite or malformed sample {i}')
        if i and (row['at'] < rows[i-1]['at'] or row['sequence'] <= rows[i-1]['sequence']):
            raise ValueError(f'{pose}: nonmonotonic sample times')
    duration = rows[-1]['at'] - rows[0]['at']
    max_gap = max(b['at'] - a['at'] for a, b in zip(rows, rows[1:]))
    if not 2.8 <= duration <= 3.001 or max_gap > .1:
        raise ValueError(f'{pose}: expected a stable final three-second window with gaps <= 0.1s')
    for key, actual in (('duration_s', duration), ('max_gap_s', max_gap)):
        if not finite(record.get(key)) or not math.isclose(record[key], actual, abs_tol=1e-9):
            raise ValueError(f'{pose}: inconsistent {key}')

    result = {}
    for side in SIDES:
        stats = record.get('stats', {}).get(side, {}) if isinstance(record.get('stats'), dict) else {}
        if not isinstance(stats, dict) or not all(finite(stats.get(k)) for k in STATS):
            raise ValueError(f'{pose}/{side}: invalid observation statistics')
        values = [r[side + '_deg'] for r in rows]
        actual = (statistics.median(values), min(values), max(values), statistics.pstdev(values),
                  max(abs(r[side + '_dps']) for r in rows))
        if not all(math.isclose(stats[k], v, rel_tol=1e-9, abs_tol=1e-9) for k, v in zip(STATS, actual)):
            raise ValueError(f'{pose}/{side}: statistics do not match source samples')
        median, low, high, std, speed = actual
        if not low <= median <= high or high-low > 2 or not 0 <= std <= 2 or not 0 <= speed <= 5:
            raise ValueError(f'{pose}/{side}: observation not sufficiently stable')
        result[side] = median
    return result


def clock_origin(record, pose):
    # Independently derive these values from selected samples, never trust a hint.
    values = [row['at'] - row['sequence'] / 1000 for row in record['samples']]
    origin = statistics.median(values)
    spread = max(values) - min(values)
    if not finite(origin) or not finite(spread):
        raise ValueError(f'{pose}: nonfinite derived clock origin')
    if spread > CLOCK_ORIGIN_TOLERANCE_SECONDS + 1e-9:
        raise ValueError(f'{pose}: 单记录主机/板时原点变化超过 0.1 秒，无法确认采集连续性。'
                         '可能存在时钟跳变或传输时间异常；请在同一采集主机重采同轮三姿态。')
    result = {'clockOriginHostSeconds': origin, 'clockOriginSpreadSeconds': spread}
    for key, actual in result.items():
        if key in record['source']:
            hint = record['source'][key]
            if not finite(hint) or not math.isclose(hint, actual, rel_tol=0, abs_tol=1e-9):
                raise ValueError(f'{pose}: source {key} does not match selected samples')
    return result


def combine_observations(center, lower, upper, source_paths):
    records = dict(zip(POSES, (center, lower, upper)))
    axes = {side: {} for side in SIDES}
    identity = None
    sources = {}
    origins = {}
    for pose, record in records.items():
        medians = validate_record(record, pose)
        origins[pose] = clock_origin(record, pose)
        current = (record['port'], record['usbIdentity'], record['source']['firmware'])
        if identity is None:
            identity = current
        elif current != identity:
            raise ValueError('All observations must have the same port, USB identity, and firmware')
        if not valid_text(source_paths.get(pose)):
            raise ValueError(f'{pose}: missing observation file path')
        sources[pose] = {
            'observationPath': source_paths[pose], 'telemetryPath': record['source']['path'],
            'firmware': record['source']['firmware'], 'createdAt': record.get('createdAt'),
            'frameCount': record['frameCount'], 'duration_s': record['duration_s'],
            **origins[pose],
        }
        for key in ('physicalStopReached', 'operatorDescription', 'operatorObservation', 'metadata'):
            if key in record:
                sources[pose][key] = record[key]
            if key in record['source']:
                sources[pose].setdefault('sourceAnnotations', {})[key] = record['source'][key]
        for side in SIDES:
            axes[side][pose + '_deg'] = medians[side]
    origin_values = [value['clockOriginHostSeconds'] for value in origins.values()]
    origin_spread = max(origin_values) - min(origin_values)
    if origin_spread > CLOCK_ORIGIN_TOLERANCE_SECONDS + 1e-9:
        raise ValueError('三姿态的主机/板时原点跨度超过 0.1 秒，可能跨板时重置或主机时钟环境。'
                         '观测可保留，但不能合并；请在同一采集主机重采同轮三姿态。')
    for side, data in axes.items():
        lo = data['lower_deg'] - data['center_deg']
        hi = data['upper_deg'] - data['center_deg']
        if lo * hi >= 0 or min(abs(lo), abs(hi)) < 3:
            raise ValueError(f'{side}: 中位必须位于舒适的下放/上抬位置之间，且两侧各相距至少 3°。'
                             '观测可保留，但本次软件输入标定失败；不导出合并文件。请勿为满足阈值超出舒适活动范围。')
        data['upper_angle_direction'] = 1 if hi > 0 else -1
    port, usb, firmware = identity
    return {
        'schema': 'aima.hand.elevation-observation-bundle.v1',
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'port': port, 'usbIdentity': usb, 'firmware': firmware,
        'poseLabels': {'center': '中位', 'lower': '下放', 'upper': '上抬'},
        'observed': axes, 'sources': sources,
        'clockContinuity': {
            'method': 'median(sample.at - sample.sequence / 1000), independently recomputed per pose',
            'maximumSpreadSeconds': CLOCK_ORIGIN_TOLERANCE_SECONDS,
            'betweenPoseOriginSpreadSeconds': origin_spread,
            'perPose': origins,
            'sameHostMonotonicClockRequired': True,
            'deviceSessionAuthenticated': False, 'devicePowerStateConfirmed': False,
            'note': '仅适用于同一采集主机、同一 monotonic 时钟基准的连续性启发检查。'
                    '通过不等于严格设备会话认证，也不能证明设备处于开机工作态。',
        },
        'hardwareReady': False, 'motorLimits': False, 'hardwareOutput': False,
        'purpose': 'software-input-mapping-observations-only',
        'note': '仅记录舒适活动位置和上抬时角度变化方向，用于软件输入映射。'
                '不代表机械限位、力矩极性、可用增益或电机输出配置；没有生成任何硬件配置文件。'
                '右侧读数沿用已归一化采样，未再次翻转符号。',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in (*POSES, 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.output.exists():
            raise ValueError('Output exists; choose a new filename')
        paths = {pose: str(getattr(args, pose).resolve()) for pose in POSES}
        records = [json.loads(Path(paths[pose]).read_text(encoding='utf-8-sig')) for pose in POSES]
        result = combine_observations(*records, source_paths=paths)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open('x', encoding='utf-8') as file:
            json.dump(result, file, ensure_ascii=False, indent=2, allow_nan=False)
    except (OSError, ValueError, TypeError) as error:
        parser.error(str(error))
    print(json.dumps({'file': str(args.output.resolve()), 'observed': result['observed'],
                      'hardwareReady': False, 'motorLimits': False, 'hardwareOutput': False}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
