"""All serial handles are mocks. Exercises conflicts and stale owners, not motors."""
import subprocess
import sys
import threading
import time
from unittest.mock import MagicMock, patch

import pytest

from shellos.device.ownership import DeviceLease, DeviceBusyError, canonical_port
from shellos.device.serial_link import SerialLink
from shellos.safety.guard import Guard


def test_canonical_port_aliases_and_duplicate_roles():
    assert canonical_port('com005') == canonical_port(r'\\.\COM5') == 'COM5'
    with DeviceLease('COM65501', 'hands'):
        with pytest.raises(DeviceBusyError):
            DeviceLease('com65501', 'legs')
        with DeviceLease('COM65502', 'legs'):
            pass
    with DeviceLease('COM65501', 'legs'):
        pass


def test_cross_process_conflict_and_crash_release():
    code = "from shellos.device.ownership import DeviceLease; lease=DeviceLease('COM65503','hands'); print('locked',flush=True); input()"
    child = subprocess.Popen([sys.executable, '-u', '-c', code], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    try:
        assert child.stdout.readline().strip() == 'locked'
        with pytest.raises(DeviceBusyError):
            DeviceLease('COM65503', 'legs')
    finally:
        child.kill(); child.communicate(timeout=5)
    with DeviceLease('COM65503', 'legs'):
        pass


def test_concurrent_claim_has_one_winner():
    barrier = threading.Barrier(3)
    leases, errors = [], []
    def claim(role):
        barrier.wait()
        try: leases.append(DeviceLease('COM65504', role))
        except DeviceBusyError: errors.append(role)
    threads = [threading.Thread(target=claim, args=(role,)) for role in ('hands','legs')]
    for thread in threads: thread.start()
    barrier.wait()
    for thread in threads: thread.join(timeout=2)
    try:
        assert len(leases) == len(errors) == 1
    finally:
        for lease in leases: lease.close()


@pytest.fixture
def serial_mocks():
    with patch('shellos.device.serial_link.serial.Serial') as serial, patch('shellos.device.serial_link.threading.Thread'), patch('shellos.device.serial_link.usb_identity', return_value=(1,2,'test-only')):
        yield serial


@pytest.mark.parametrize('identity',[None,(1,2,'different-device')])
def test_reconnect_refuses_unknown_or_replaced_usb_even_on_same_com(serial_mocks, identity):
    link=SerialLink('COM65510')
    try:
        with patch('shellos.device.serial_link.usb_identity',return_value=identity), patch('shellos.device.serial_link.time.sleep'):
            assert not link._reconnect()
        assert serial_mocks.call_count == 1
        assert not link.enabled and 'USB_IDENTITY_UNVERIFIED' in link.last_err
        with pytest.raises(DeviceBusyError): DeviceLease('COM65510','hands')
    finally: link.close()


def test_serial_reconnect_keeps_original_port_and_close_prevents_old_writes(serial_mocks):
    link = SerialLink('COM65505')
    try:
        with patch('shellos.device.serial_link.find_port', return_value='COM65506') as discover, patch('shellos.device.serial_link.time.sleep'):
            assert link._reconnect()
            discover.assert_not_called()
        assert serial_mocks.call_args.args[0] == 'COM65505'
        assert link.port == 'COM65505'
    finally: link.close()
    sent = serial_mocks.return_value.write.call_count
    link.send_torque(1,1); link.disable(); assert not link.recover()
    assert serial_mocks.return_value.write.call_count == sent
    with pytest.raises(RuntimeError): link.handshake()
    with pytest.raises(ValueError, match='closed'): Guard(link)
    with DeviceLease('COM65505','hands'):
        pass


def test_close_during_reconnect_never_reopens_or_reclaims(serial_mocks):
    link=SerialLink('COM65507')
    with patch('shellos.device.serial_link.time.sleep', side_effect=lambda _:link.close()):
        assert not link._reconnect()
    assert serial_mocks.call_count == 1
    with DeviceLease('COM65507','hands'):
        pass


def test_busy_port_fails_before_serial_open_and_readonly_capture_conflicts(serial_mocks, tmp_path):
    from shellos.hands.capture import main
    with DeviceLease('COM65508','legs'):
        with pytest.raises(DeviceBusyError): SerialLink('com65508', role='hands')
        with patch.object(sys,'argv',['capture','--port','COM65508','--pose','center','--output',str(tmp_path/'observation.json')]), patch('serial.tools.list_ports.comports', return_value=[]):
            with pytest.raises(DeviceBusyError): main()
    serial_mocks.assert_not_called()


def test_failed_serial_open_releases_port_and_hands_never_auto_enable(serial_mocks):
    serial_mocks.side_effect=OSError('fake open failure')
    with pytest.raises(OSError): SerialLink('COM65509')
    serial_mocks.side_effect=None
    link=SerialLink('COM65509',role='hands')
    try:
        assert not link.recover()
        with pytest.raises(RuntimeError): link.handshake()
        with pytest.raises(AttributeError): link.role='legs'
        serial_mocks.return_value.write.assert_not_called()
    finally: link.close()
    with pytest.raises(ValueError): SerialLink(role='hands')


def fake_link(role='legs'):
    link=MagicMock(); link.role=role; link.stream_age.return_value=0
    return link


def test_one_guard_per_link_and_role_binding():
    link=fake_link()
    old=Guard(link)
    try:
        with pytest.raises(DeviceBusyError): Guard(link)
        with pytest.raises(ValueError): Guard(link,role='hands')
    finally: old.shutdown()
    with pytest.raises(ValueError): Guard(fake_link('hands'))


def test_closed_guard_and_its_callbacks_cannot_interrupt_new_owner():
    link=fake_link(); old=Guard(link, wd_zero=.01, wd_disable=.03)
    old.arm(); old.set_deadman(1); old.submit(.1,.1); old.shutdown()
    new=Guard(link,wd_disable=10)
    try:
        new.arm();new.set_deadman(1);new.submit(.2,.2)
        before=list(link.mock_calls)
        assert not old.rearm() and not old.arm()
        old.trigger_estop();old.shutdown();old.set_deadman(1);old.submit(1,1)
        time.sleep(.05)
        assert link.mock_calls == before
        assert new.state == 'ACTIVE'
    finally: new.shutdown()


def test_two_devices_have_independent_deadman_fault_and_shutdown():
    legs,hands=fake_link('legs'),fake_link('hands')
    lg,hg=Guard(legs),Guard(hands,role='hands')
    try:
        lg.arm();hg.arm();lg.set_deadman(1)
        assert hg.submit(1,1) == (0,0)
        hg.set_deadman(1);hg.submit(.1,.1)
        before=list(hands.mock_calls)
        lg.trigger_estop();lg.shutdown()
        assert hands.mock_calls == before and hg.state == 'ACTIVE'
        assert not hg.rearm()  # No leg recovery path for a hand-role Guard.
    finally: lg.shutdown();hg.shutdown()
