"""Fully fake serial tests. No ports are enumerated or opened by these tests."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest


SCRIPT = Path(__file__).with_name('capture-ten-seconds-guarded-Emma0924.py')
spec = importlib.util.spec_from_file_location('guarded_capture', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Clock:
    def __init__(self):
        self.now = 100.

    def monotonic(self):
        return self.now


class FakeSerial:
    def __init__(self, clock, values, *, fail_sample=None, disable_ack=True, step=.05, **kwargs):
        self.clock = clock
        self.values = values
        self.fail_sample = fail_sample
        self.disable_ack = disable_ack
        self.step = step
        self.settings = kwargs
        self.is_open = False
        self.enabled = False
        self.commands = []
        self.queue = []
        self.frame_count = 0
        self.open_count = 0
        self.close_count = 0
        self.dtr = True
        self.rts = True

    def open(self):
        assert self.dtr is False and self.rts is False
        assert self.port == 'FAKE_PORT'
        self.is_open = True
        self.open_count += 1

    def close(self):
        self.is_open = False
        self.close_count += 1

    def write(self, payload):
        assert self.is_open
        command = payload.decode('ascii').strip()
        self.commands.append(command)
        if command == 'PING': self.queue.append(b'PONG\n')
        elif command == 'VERSION': self.queue.append((module.EXPECTED_VERSION + '\n').encode())
        elif command == 'ENABLE':
            self.enabled = True
            self.queue.append(b'OK,ENABLE\n')
        elif command == 'DISABLE':
            self.enabled = False
            if self.disable_ack: self.queue.append(b'OK,DISABLE\n')
        else: raise AssertionError('Unexpected hardware command in fake: ' + command)
        return len(payload)

    def readline(self, size):
        self.clock.now += self.step
        if self.queue:
            return self.queue.pop(0)
        if not self.enabled:
            return b''
        self.frame_count += 1
        if self.frame_count == self.fail_sample:
            raise OSError('synthetic read failure')
        left, right, left_speed, right_speed = self.values(self.frame_count)
        fields = [self.frame_count * 50, 0, 0, 0, 0, 0, 0, 0, 0, 1, 101,
                  left, right, left_speed, right_speed]
        return ('S:' + ','.join(map(str, fields)) + '\n').encode('ascii')


def run_fake(monkeypatch, values, *, seconds=10, **options):
    clock = Clock()
    streams = []

    def factory(**kwargs):
        stream = FakeSerial(clock, values, **options, **kwargs)
        streams.append(stream)
        return stream

    port = SimpleNamespace(device='FAKE_PORT', vid=0x10C4, pid=0xEA60, serial_number='offline-fixture')
    # Patch every hardware entry point before invoking run. No real serial object exists.
    monkeypatch.setattr(module.serial, 'Serial', factory)
    monkeypatch.setattr(module.list_ports, 'comports', lambda: [port])
    monkeypatch.setattr(module, 'time', SimpleNamespace(monotonic=clock.monotonic))
    output = SCRIPT.parents[2] / 'work/hardware-test-Emma0924' / ('guarded-capture-offline-fixture-' + uuid4().hex)
    monkeypatch.setattr(module, 'OUT', output)
    status = module.run(port='FAKE_PORT', expected_serial='offline-fixture', seconds=seconds, confirm_off_body_supported_enable=True)
    files = list(output.glob(f'telemetry-{seconds}s-*.json'))
    assert len(files) == 1
    assert len(streams) == 1
    stream = streams[0]
    assert stream.open_count == 1 and stream.close_count == 1
    assert stream.commands[:3] == ['PING', 'VERSION', 'ENABLE']
    assert stream.commands[3:] in (['DISABLE'], ['DISABLE', 'DISABLE'])
    assert stream.settings == {'port': None, 'baudrate': 3_000_000, 'timeout': .05, 'write_timeout': .25}
    report = json.loads(files[0].read_text(encoding='utf-8'))
    assert report['serialClosed'] is True
    assert report['torqueCommandsSent'] is False
    assert report['operatorApprovedSeconds'] == seconds
    assert report['frameCount'] == len(report['samples'])
    return status, report, stream, clock


def test_normal_nonzero_runs_full_ten_seconds(monkeypatch):
    status, report, stream, _ = run_fake(monkeypatch, lambda _: (-80, 85, 0, 0))
    assert status == 0
    assert report['passed'] and report['communicationPassed'] and report['jointDataUsable']
    assert report['terminationReason'] == 'completed'
    assert 10 <= report['captureElapsedSeconds'] < 10.051
    assert report['disableAcknowledged']
    assert report['frameCount'] == stream.frame_count


def test_all_zero_stops_after_two_seconds_and_cleans_up(monkeypatch):
    status, report, stream, _ = run_fake(monkeypatch, lambda _: (0, 0, 0, 0))
    assert status == 1 and not report['passed']
    assert report['communicationPassed'] is True and report['jointDataUsable'] is False
    assert report['terminationReason'] == 'ambiguous_joint_data'
    assert 2 <= report['captureElapsedSeconds'] < 2.11
    assert report['ambiguousJointData']['continuousSeconds'] >= 2
    assert report['ambiguousJointData']['validIncreasingFrames'] >= 20
    assert '无法区分真实零位与设备未工作' in report['ambiguousJointData']['reason']
    assert report['frameCount'] == stream.frame_count
    assert report['disableAcknowledged']


def test_all_zero_requires_twenty_increasing_samples_as_well(monkeypatch):
    _, report, _, _ = run_fake(monkeypatch, lambda _: (0, 0, 0, 0), step=.2)
    assert report['terminationReason'] == 'ambiguous_joint_data'
    assert report['ambiguousJointData']['validIncreasingFrames'] == 20
    assert 3.99 <= report['captureElapsedSeconds'] < 4.01


@pytest.mark.parametrize('values', [(0, 85, 0, 0), (-80, 0, 0, 0), (0, 0, 1, 0), (0, 0, 0, -1)])
def test_legal_single_side_zero_or_nonzero_speed_does_not_trigger(monkeypatch, values):
    status, report, _, _ = run_fake(monkeypatch, lambda _: values)
    assert status == 0 and report['jointDataUsable']
    assert report['terminationReason'] == 'completed'
    assert 'ambiguousJointData' not in report


def test_separated_zero_runs_are_not_added_together(monkeypatch):
    def values(index):
        return (1, 0, 0, 0) if index % 30 == 0 else (0, 0, 0, 0)
    status, report, _, _ = run_fake(monkeypatch, values)
    assert status == 0 and report['terminationReason'] == 'completed'


def test_read_exception_still_disables_closes_and_keeps_partial_samples(monkeypatch):
    status, report, stream, _ = run_fake(monkeypatch, lambda _: (-80, 85, 0, 0), fail_sample=25)
    assert status == 1 and not report['communicationPassed'] and not report['jointDataUsable']
    assert report['terminationReason'] == 'capture_error'
    assert report['error'] == 'synthetic read failure'
    assert report['disableAcknowledged']
    assert report['frameCount'] == 24 and stream.frame_count == 25
    assert 1.24 <= report['captureElapsedSeconds'] < 1.26


def test_missing_disable_ack_retries_once_and_fails_without_extending_capture(monkeypatch):
    status, report, stream, clock = run_fake(monkeypatch, lambda _: (-80, 85, 0, 0), disable_ack=False)
    assert status == 1 and not report['passed'] and not report['communicationPassed']
    assert report['jointDataUsable'] is True
    assert report['terminationReason'] == 'disable_ack_missing'
    assert report['disableAcknowledged'] is False
    assert stream.commands == ['PING', 'VERSION', 'ENABLE', 'DISABLE', 'DISABLE']
    assert 10 <= report['captureElapsedSeconds'] < 10.051
    assert clock.now - 100 - report['captureElapsedSeconds'] >= 2


def test_twenty_seconds_completes_once_with_visible_halfway_progress(monkeypatch, capsys):
    status, report, stream, _ = run_fake(monkeypatch, lambda _: (-80, 85, 0, 0), seconds=20)
    assert status == 0 and report['passed']
    assert report['terminationReason'] == 'completed'
    assert 20 <= report['captureElapsedSeconds'] < 20.051
    assert stream.commands == ['PING', 'VERSION', 'ENABLE', 'DISABLE']
    assert capsys.readouterr().out.count('Sampling 10/20 seconds.') == 1


def test_twenty_seconds_still_stops_ambiguous_zeros_early(monkeypatch, capsys):
    status, report, _, _ = run_fake(monkeypatch, lambda _: (0, 0, 0, 0), seconds=20)
    assert status == 1 and report['terminationReason'] == 'ambiguous_joint_data'
    assert report['communicationPassed'] is True and report['jointDataUsable'] is False
    assert report['disableAcknowledged']
    assert 2 <= report['captureElapsedSeconds'] < 2.11
    assert 'Sampling 10/20 seconds.' not in capsys.readouterr().out


@pytest.mark.parametrize('seconds', [0, 11, 21, 10.0, True, '20'])
def test_bad_duration_is_rejected_before_hardware_access(monkeypatch, seconds):
    def forbidden(*args, **kwargs):
        raise AssertionError('Hardware entry point must not be reached')
    monkeypatch.setattr(module.serial, 'Serial', forbidden)
    monkeypatch.setattr(module.list_ports, 'comports', forbidden)
    with pytest.raises(ValueError, match='no device access attempted'):
        module.run(port='FAKE_PORT', expected_serial='offline-fixture', seconds=seconds, confirm_off_body_supported_enable=True)


def test_cli_requires_explicit_device_duration_and_motor_confirmation(monkeypatch, capsys):
    calls = []
    monkeypatch.setattr(module, 'run', lambda **kwargs: calls.append(kwargs) or 0)
    assert module.main([]) == 0
    assert 'ENABLE also enables motors' in capsys.readouterr().out
    with pytest.raises(SystemExit) as error:
        module.main(['--help'])
    assert error.value.code == 0 and not calls
    options = ['--port', 'FAKE_PORT', '--serial', 'offline-fixture', '--seconds', '20',
               '--confirm-off-body-supported-enable']
    assert module.main(options) == 0
    assert len(calls) == 1 and calls[0]['seconds'] == 20
    assert calls[0]['port'] == 'FAKE_PORT' and calls[0]['expected_serial'] == 'offline-fixture'
    assert calls[0]['confirm_off_body_supported_enable'] is True
    for arguments in (options[:-1], ['--port', 'FAKE_PORT'],
                      [arg if arg != '20' else '30' for arg in options]):
        with pytest.raises(SystemExit) as error:
            module.main(arguments)
        assert error.value.code == 2 and len(calls) == 1


def test_api_cannot_start_without_device_arguments(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError('Hardware entry point must not be reached')
    monkeypatch.setattr(module.serial, 'Serial', forbidden)
    monkeypatch.setattr(module.list_ports, 'comports', forbidden)
    with pytest.raises(TypeError):
        module.run()
    for confirmation in (False, None, 1, 'yes'):
        with pytest.raises(ValueError, match='no device access attempted'):
            module.run(port='FAKE_PORT', expected_serial='offline-fixture', seconds=10,
                       confirm_off_body_supported_enable=confirmation)


@pytest.mark.parametrize(('port', 'serial'), [('', 'device'), ('COM1', ''), (None, 'device')])
def test_empty_device_identity_is_rejected_before_access(monkeypatch, port, serial):
    def forbidden(*args, **kwargs):
        raise AssertionError('Hardware entry point must not be reached')
    monkeypatch.setattr(module.serial, 'Serial', forbidden)
    monkeypatch.setattr(module.list_ports, 'comports', forbidden)
    with pytest.raises(ValueError, match='no device access attempted'):
        module.run(port=port, expected_serial=serial, seconds=10,
                   confirm_off_body_supported_enable=True)
