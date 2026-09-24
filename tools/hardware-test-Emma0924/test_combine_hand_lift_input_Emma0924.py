"""Offline lift-input observations; never imports any hardware transport."""
import importlib.util
import json
from pathlib import Path
from uuid import uuid4

import pytest


SCRIPT = Path(__file__).with_name('combine-hand-lift-input-Emma0924.py')
spec = importlib.util.spec_from_file_location('lift_input', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def record(side, pose, left, right):
    rows = [{'at': 10 + i*.05, 'sequence': 1000 + i*50,
             'left_deg': left, 'right_deg': right, 'left_dps': 0., 'right_dps': 0.} for i in range(61)]
    return {
        'schema': 'aima.hand.pose-observation.v1', 'pose': pose, 'stable': True,
        'hardwareOutput': False, 'motorLimits': False, 'intendedSides': [side],
        'physicalStopReached': False, 'operatorDescription': f'offline fixture: {side} {pose}',
        'port': 'COM6', 'usbIdentity': {'vid': 4292, 'pid': 60000, 'serial': 'offline-fixture'},
        'source': {'firmware': 'fixture-1', 'path': f'/offline/{side}-{pose}-raw.json'},
        'samples': rows, 'frameCount': len(rows), 'duration_s': 3., 'invalidLines': 0,
        'max_gap_s': max(b['at']-a['at'] for a, b in zip(rows, rows[1:])),
        'stats': {key: {'median_deg': value, 'min_deg': value, 'max_deg': value,
                        'std_deg': 0., 'max_speed_dps': 0.}
                  for key, value in [('left', left), ('right', right)]},
    }


def inputs():
    return [record('left', 'center', 10, 50), record('left', 'upper', 30, 51),
            record('right', 'center', 70, -20), record('right', 'upper', -500, -50)]


def paths():
    return {name: f'/offline/{name}.json' for name in module.INPUT_NAMES}


def combine(records):
    return module.combine_observations(*records, source_paths=paths())


def test_independent_sides_preserve_positive_and_negative_lift_signs():
    result = combine(inputs())
    assert result['observed'] == {
        'left': {'center_deg': 10, 'upper_deg': 30, 'lift_angle_direction': 1, 'span_deg': 20},
        'right': {'center_deg': -20, 'upper_deg': -50, 'lift_angle_direction': -1, 'span_deg': 30},
    }
    assert result['scope'] == 'software-input-observations-only'
    assert all(result[k] is False for k in ('hardwareReady', 'hardwareOutput', 'motorLimits'))
    assert result['sources']['left_upper']['targetStats']['median_deg'] == 30
    assert result['sources']['right_upper']['telemetryPath'] == '/offline/right-upper-raw.json'


def test_single_axis_check_is_available_without_a_right_side_or_a_bundle():
    center, upper, _, _ = inputs()
    result = module.check_axis('left', center, upper, source_paths={'center': '/center.json', 'upper': '/upper.json'})
    assert result['side'] == 'left' and result['observed']['span_deg'] == 20
    assert result['schema'] == 'aima.hand.lift-axis-observation.v1'
    assert 'right' not in result['observed']
    with pytest.raises(ValueError):
        combine([center, upper, None, None])


@pytest.mark.parametrize('mutation', ['missing_target', 'wrong_target', 'missing_stop', 'stop_true', 'no_description'])
def test_operator_target_and_comfort_confirmations_are_required(mutation):
    records = inputs()
    upper = records[1]
    if mutation == 'missing_target': del upper['intendedSides']
    if mutation == 'wrong_target': upper['intendedSides'] = ['right']
    if mutation == 'missing_stop': del upper['physicalStopReached']
    if mutation == 'stop_true': upper['physicalStopReached'] = True
    if mutation == 'no_description': upper['operatorDescription'] = ''
    with pytest.raises(ValueError):
        combine(records)


@pytest.mark.parametrize('delta', [0, 2.999, -2.999])
def test_small_target_span_fails_even_when_other_side_has_a_large_span(delta):
    records = inputs()
    records[1] = record('left', 'upper', 10 + delta, 1000)
    with pytest.raises(ValueError, match='至少 3°'):
        combine(records)


@pytest.mark.parametrize('mutation', ['within_side_clock', 'across_sides_clock', 'firmware', 'usb', 'bad_sample', 'unstable'])
def test_reused_integrity_and_global_identity_checks(mutation):
    records = inputs()
    if mutation in ('within_side_clock', 'across_sides_clock'):
        changed = [records[1]] if mutation == 'within_side_clock' else records[2:]
        for record_ in changed:
            for sample in record_['samples']:
                sample['sequence'] += 200
    if mutation == 'firmware':
        for record_ in records[2:]: record_['source']['firmware'] = 'other'
    if mutation == 'usb': records[1]['usbIdentity']['serial'] = 'other'
    if mutation == 'bad_sample': records[1]['samples'][0]['left_deg'] = float('nan')
    if mutation == 'unstable': records[1]['stable'] = False
    with pytest.raises(ValueError):
        combine(records)


def test_cli_requires_all_four_inputs_writes_only_bundle_and_refuses_overwrite():
    folder = SCRIPT.parents[2] / 'work/hardware-test-Emma0924' / ('lift-input-offline-fixture-' + uuid4().hex)
    folder.mkdir()
    command = []
    for name, record_ in zip(module.INPUT_NAMES, inputs()):
        path = folder / f'{name}.json'
        path.write_text(json.dumps(record_), encoding='utf-8')
        command.extend(['--' + name.replace('_', '-'), str(path)])
    output = folder / 'bundle.json'
    with pytest.raises(SystemExit) as missing:
        module.main(command[:4] + ['--output', str(output)])
    assert missing.value.code == 2 and not output.exists()
    assert module.main(command + ['--output', str(output)]) == 0
    before = output.read_bytes()
    with pytest.raises(SystemExit) as repeated:
        module.main(command + ['--output', str(output)])
    assert repeated.value.code == 2 and output.read_bytes() == before
    assert sorted(path.name for path in folder.iterdir()) == [
        'bundle.json', 'left_center.json', 'left_upper.json', 'right_center.json', 'right_upper.json']
