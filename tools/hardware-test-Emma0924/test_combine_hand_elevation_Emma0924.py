"""Offline validation of observation-only upper/lower combination; no hardware."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from uuid import uuid4

import pytest


SCRIPT = Path(__file__).with_name('combine-hand-elevation-Emma0924.py')
spec = importlib.util.spec_from_file_location('combine_elevation', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def record(pose, left, right):
    rows = [{'at': 10 + i * .05, 'sequence': 1000 + i * 50,
             'left_deg': left, 'right_deg': right, 'left_dps': 0., 'right_dps': 0.}
            for i in range(61)]
    return {
        'schema': 'aima.hand.pose-observation.v1', 'pose': pose,
        'stable': True, 'hardwareOutput': False, 'motorLimits': False,
        'port': 'COM6', 'usbIdentity': {'vid': 4292, 'pid': 60000, 'serial': 'offline-fixture'},
        'source': {'firmware': 'fixture-1', 'path': f'/offline/{pose}-telemetry.json'},
        'frameCount': len(rows), 'duration_s': 3.,
        'max_gap_s': max(b['at'] - a['at'] for a, b in zip(rows, rows[1:])),
        'invalidLines': 0, 'samples': rows,
        'stats': {side: {'median_deg': angle, 'min_deg': angle, 'max_deg': angle,
                         'std_deg': 0., 'max_speed_dps': 0.}
                  for side, angle in [('left', left), ('right', right)]},
    }


def inputs():
    return [record('center', -90., -85.), record('lower', -100., -75.), record('upper', -80., -95.)]


def combine(records):
    return module.combine_observations(*records, source_paths={p: f'/offline/{p}.json' for p in module.POSES})


@pytest.fixture
def fixture_dir():
    # Windows sandbox cannot enumerate pytest's mode-0700 temp folders.
    # Use a fresh ordinary workspace folder and retain only synthetic test files.
    path = SCRIPT.parents[2] / 'work/hardware-test-Emma0924' / ('elevation-offline-fixture-' + uuid4().hex)
    path.mkdir(parents=True)
    return path


def test_opposite_signs_and_annotations_are_preserved():
    rows = inputs()
    rows[2]['physicalStopReached'] = False
    rows[2]['operatorDescription'] = 'comfortable upper pose before the mechanical stop'
    result = combine(rows)
    assert result['observed']['left']['upper_angle_direction'] == 1
    assert result['observed']['right']['upper_angle_direction'] == -1
    assert result['sources']['upper']['physicalStopReached'] is False
    assert result['sources']['center']['telemetryPath'] == '/offline/center-telemetry.json'
    assert result['firmware'] == 'fixture-1'
    assert all(result[k] is False for k in ('hardwareReady', 'motorLimits', 'hardwareOutput'))
    assert 'back_deg' not in result['observed']['left']


@pytest.mark.parametrize('upper', [-101., -90., -88.])
def test_nonbracketing_or_insufficient_distance_fails(upper):
    rows = inputs()
    rows[2] = record('upper', upper, -95.)
    with pytest.raises(ValueError, match='观测可保留'):
        combine(rows)


@pytest.mark.parametrize('location,value', [('firmware', 'other'), ('serial', 'other'), ('port', 'COM7')])
def test_identity_mismatch(location, value):
    rows = inputs()
    target = rows[2]['source'] if location == 'firmware' else rows[2]['usbIdentity'] if location == 'serial' else rows[2]
    target[location] = value
    with pytest.raises(ValueError, match='same port, USB identity, and firmware'):
        combine(rows)


@pytest.mark.parametrize('mutation', ['nan_stat', 'inf_sample', 'unstable_flag', 'fast_sample',
                                     'lying_stats', 'long_gap', 'duplicate_sequence', 'wrong_pose',
                                     'motor_output', 'missing_usb', 'missing_firmware'])
def test_invalid_observations_fail(mutation):
    rows = inputs()
    r = rows[2]
    if mutation == 'nan_stat': r['stats']['left']['median_deg'] = float('nan')
    if mutation == 'inf_sample': r['samples'][0]['left_deg'] = float('inf')
    if mutation == 'unstable_flag': r['stable'] = False
    if mutation == 'fast_sample':
        r['samples'][0]['left_dps'] = 6.
        r['stats']['left']['max_speed_dps'] = 6.
    if mutation == 'lying_stats': r['stats']['left']['median_deg'] += .5
    if mutation == 'long_gap': r['samples'] = [r['samples'][0]] + r['samples'][4:]; r['frameCount'] = len(r['samples'])
    if mutation == 'duplicate_sequence': r['samples'][1]['sequence'] = r['samples'][0]['sequence']
    if mutation == 'wrong_pose': r['pose'] = 'back'
    if mutation == 'motor_output': r['hardwareOutput'] = True
    if mutation == 'missing_usb': r['usbIdentity'] = None
    if mutation == 'missing_firmware': del r['source']['firmware']
    with pytest.raises(ValueError):
        combine(rows)


@pytest.mark.parametrize('location', ['top', 'source', 'metadata'])
def test_mechanical_stop_is_rejected_at_any_annotation_location(location):
    rows = inputs()
    target = rows[2] if location == 'top' else rows[2].setdefault(location, {})
    target['physicalStopReached'] = True
    with pytest.raises(ValueError, match='机械极限'):
        combine(rows)


def test_equal_host_times_are_allowed_for_distinct_device_frames():
    rows = inputs()
    for record_ in rows:
        record_['samples'][1]['at'] = record_['samples'][0]['at']
        record_['max_gap_s'] = max(b['at'] - a['at'] for a, b in zip(record_['samples'], record_['samples'][1:]))
    assert combine(rows)['hardwareReady'] is False


def test_clock_origin_is_recomputed_and_old_records_without_hints_are_compatible():
    records = inputs()
    records[1]['source'].update(clockOriginHostSeconds=9., clockOriginSpreadSeconds=0.)
    result = combine(records)
    check = result['clockContinuity']
    assert check['betweenPoseOriginSpreadSeconds'] == 0
    assert check['sameHostMonotonicClockRequired'] is True
    assert check['deviceSessionAuthenticated'] is False
    assert check['devicePowerStateConfirmed'] is False
    assert result['sources']['center']['clockOriginHostSeconds'] == 9.


@pytest.mark.parametrize('sequence_shift', [100.001, -100.001, -1000.])
def test_cross_pose_clock_origin_jump_is_rejected(sequence_shift):
    records = inputs()
    for row in records[2]['samples']:
        row['sequence'] += sequence_shift
    with pytest.raises(ValueError, match='重采同轮三姿态'):
        combine(records)


def test_continuous_origin_small_offset_is_allowed():
    records = inputs()
    for row in records[2]['samples']:
        row['sequence'] += 95.
    result = combine(records)
    assert result['clockContinuity']['betweenPoseOriginSpreadSeconds'] == pytest.approx(.095)


def test_within_observation_clock_origin_drift_is_rejected():
    records = inputs()
    for index, row in enumerate(records[2]['samples']):
        row['sequence'] += index * 4.
    with pytest.raises(ValueError, match='单记录.*重采同轮三姿态'):
        combine(records)


@pytest.mark.parametrize('key,value', [('clockOriginHostSeconds', 8.9), ('clockOriginSpreadSeconds', .05),
                                     ('clockOriginHostSeconds', True), ('clockOriginSpreadSeconds', '0')])
def test_origin_metadata_does_not_override_recomputed_values(key, value):
    records = inputs()
    records[2]['source'][key] = value
    with pytest.raises(ValueError, match='does not match selected samples'):
        combine(records)


def test_cli_only_writes_one_observation_file_and_refuses_overwrite(fixture_dir):
    tmp_path = fixture_dir
    command = [sys.executable, str(SCRIPT)]
    for pose, r in zip(module.POSES, inputs()):
        path = tmp_path / f'{pose}.json'
        path.write_text(json.dumps(r), encoding='utf-8')
        command.extend(['--' + pose, str(path)])
    output = tmp_path / 'combined.json'
    command.extend(['--output', str(output)])
    result = subprocess.run(command, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    first = output.read_bytes()
    repeated = subprocess.run(command, capture_output=True, text=True)
    assert repeated.returncode != 0 and 'Output exists' in repeated.stderr
    assert output.read_bytes() == first
    assert sorted(p.name for p in tmp_path.iterdir()) == ['center.json', 'combined.json', 'lower.json', 'upper.json']


def test_invalid_cli_does_not_create_output(fixture_dir):
    tmp_path = fixture_dir
    command = [sys.executable, str(SCRIPT)]
    records = inputs()
    records[2]['stable'] = False
    for pose, r in zip(module.POSES, records):
        path = tmp_path / f'{pose}.json'
        path.write_text(json.dumps(r), encoding='utf-8')
        command.extend(['--' + pose, str(path)])
    output = tmp_path / 'combined.json'
    result = subprocess.run(command + ['--output', str(output)], capture_output=True, text=True)
    assert result.returncode != 0
    assert not output.exists()
