"""All hand tests use virtual measurements / fake transports; no serial opens."""
from dataclasses import replace
import json
import math
import pytest

from shellos.hands.profile import HandProfile, simulation_profile, blank_hardware_profile
from shellos.hands.control import HandController, Sample, Interlocks, sample_from_frame
from shellos.hands.bridge import GuardedHandSession, DeviceIdentity
from shellos.hands.capture import PoseRecorder, read_pose
from shellos.hands.preview import run_demo, write_report
from shellos.hands.calibration import combine_observations
from shellos.device.frame import parse_line


def measurement(now, **kw):
    return replace(Sample(now,round(now*1000),0,0,0,0,'sim-hands'), **kw)


def locks(now, **kw):
    return replace(Interlocks(now,True,True,True,True,False,'simulation'),**kw)


def active(profile=None):
    ctl=HandController(profile or simulation_profile())
    assert ctl.begin(measurement(0),locks(0),0)
    for i in range(1,31):
        ctl.step(measurement(i*.01),locks(i*.01),i*.01)
    assert ctl.stage=='active'
    return ctl,.3


def test_profiles_are_explicit_and_screen_observations_cannot_be_motor_configuration():
    p=simulation_profile()
    assert HandProfile.from_dict(p.to_dict())==p
    for value in (blank_hardware_profile(),{'schema':'aima.hand.screen-calibration.v1'},None):
        with pytest.raises(ValueError): HandProfile.from_dict(value)
    with pytest.raises(ValueError): replace(p,purpose='hardware')
    with pytest.raises(ValueError): replace(p,left={})
    for key,value in [('cap_nm',8),('cap_nm',float('nan')),('kp_nm_rad',-1),('torque_sign',0),
                      ('pulse_seconds',.6),('hold_deg',50),('lift_speed_dps',200),('slew_nm_s',0)]:
        with pytest.raises(ValueError): replace(p.left,**{key:value})


def test_lift_target_has_bounded_speed_and_waits_for_measured_settling():
    ctl=HandController(simulation_profile()); start=measurement(0,left_deg=-10,right_deg=-10)
    assert ctl.begin(start,locks(0),0)
    state=ctl.step(replace(start,at=.01,sequence=10),locks(.01),.01)
    assert state['target_deg']['left']==pytest.approx(-9.88)
    assert ctl.stage=='raising'
    assert abs(state['torque_nm']['left'])<=.03
    # Repeated begin cannot reset the target trajectory or clear a stuck lift.
    assert not ctl.begin(measurement(.01),locks(.01),.01)
    for i in range(2,1001):
        state=ctl.step(measurement(i*.01,left_deg=-30),locks(i*.01),i*.01)
        if ctl.stage=='fault': break
    assert ctl.stage=='fault'
    assert state['torque_nm']=={'left':0,'right':0}


def test_hold_gravity_and_damping_are_separate_and_commands_respect_axis_caps_and_time_slew():
    ctl,now=active(); previous={'left':0,'right':0}
    for i in range(1,41):
        now+=.01
        state=ctl.step(measurement(now,left_deg=20,right_deg=-20,left_dps=10,right_dps=-10),locks(now),now)
        assert state['components']['left']['damping_nm']<0
        assert state['components']['right']['damping_nm']>0
        assert state['components']['left']['spring_nm']<0
        assert state['components']['left']['gravity_nm']>0
        for side in previous:
            assert abs(state['torque_nm'][side])<=.8
            assert abs(state['torque_nm'][side]-previous[side])<=.03000001
        previous=state['torque_nm']


def test_calibrated_torque_sign_is_relative_to_normalized_shellos_coordinates():
    p=simulation_profile(); p=replace(p,right=replace(p.right,torque_sign=-1))
    ctl,now=active(p); now+=.01
    state=ctl.step(measurement(now,left_deg=-10,right_deg=-10),locks(now),now)
    assert state['torque_nm']['left']>0 and state['torque_nm']['right']<0


@pytest.mark.parametrize('change,interlock,dt',[
    ({'at':-.5},{},.01),({'at':1},{},.01),({'left_deg':float('nan')},{},.01),
    ({'left_deg':51},{},.01),({'right_dps':101},{},.01),({'device_id':'leg-device'},{},.01),
    ({},{'left_grip':False},.01),({},{'right_grip':False},.01),({},{'mount_ok':False},.01),
    ({},{'straps_released':False},.01),({},{'estop':True},.01),({},{'at':-.5},.01),
    ({},{'origin':'browser-checkbox'},.01),({},{'left_grip':1},.01),({},{},.06),({},{},-.01),
])
def test_bad_inputs_latch_zero_and_never_resume_automatically(change,interlock,dt):
    ctl,now=active(); now+=dt
    out=ctl.step(measurement(now,**change),locks(now,**interlock),now)
    assert out['stage']=='fault' and out['torque_nm']=={'left':0,'right':0}
    now+=.1
    assert ctl.step(measurement(now),locks(now),now)['stage']=='fault'
    assert not ctl.begin(measurement(now),locks(now),now)
    assert ctl.acknowledge_fault()
    assert ctl.step(measurement(now),locks(now),now)['stage']=='paused'
    assert ctl.begin(measurement(now),locks(now),now)


def test_same_old_frame_cannot_be_kept_fresh_by_retimestamping_or_clock_reset():
    for sample in (measurement(.31,sequence=100),measurement(.31,sequence=300)):
        ctl,_=active();out=ctl.step(sample,locks(.31),.31)
        assert out['stage']=='fault'


def test_pause_or_scene_change_cannot_clear_a_latched_fault():
    ctl,now=active();ctl.step(measurement(now+.01,left_deg=100),locks(now+.01),now+.01)
    ctl.pause();assert ctl.stage=='fault'
    ctl.configure_game('excavator');assert ctl.stage=='fault'
    assert not ctl.begin(measurement(now+.02),locks(now+.02),now+.02)


def test_independent_pulses_have_a_bounded_envelope_cooldown_and_replay_protection():
    ctl,now=active()
    assert ctl.fire('left',1,now,now)
    assert not ctl.fire('left',1,now,now)
    assert not ctl.fire('left',2,now,now)
    assert ctl.fire('right',3,now,now)
    for i in range(1,7):
        at=now+i*.01;out=ctl.step(measurement(at),locks(at),at)
    assert out['components']['left']['pulse_nm']==pytest.approx(-.18)
    assert out['components']['right']['pulse_nm']==pytest.approx(-.18)
    for i in range(7,60):
        at=now+i*.01;out=ctl.step(measurement(at),locks(at),at)
    assert out['components']['left']['pulse_nm']==0
    assert not ctl.fire('left',4,at-.5,at)
    assert ctl.fire('left',5,at,at)
    at+=.01;out=ctl.step(measurement(at),locks(at),at)
    assert out['components']['left']['pulse_nm']<0 and out['components']['right']['pulse_nm']==0
    ctl.pause();assert not ctl.fire('both',6,at,at)
    assert ctl.snapshot()['torque_nm']=={'left':0,'right':0}


def test_scene_change_cancels_pulse_and_requires_begin_and_excavator_rejects_shots():
    ctl,now=active();ctl.fire('both',1,now,now)
    assert ctl.configure_game('excavator',.5)
    assert ctl.stage=='paused' and not ctl.pulses
    assert not ctl.fire('both',2,now,now)
    assert not ctl.configure_game('range',float('inf'))
    assert ctl.stage=='fault'


def test_snapshots_are_detached_and_controller_never_claims_hardware_output():
    ctl,now=active();state=ctl.step(measurement(now+.01,left_deg=-5),locks(now+.01),now+.01)
    state['torque_nm']['left']=100;state['components']['left']['spring_nm']=100
    assert ctl.snapshot()['torque_nm']['left']<1
    assert ctl.snapshot()['components']['left']['spring_nm']<1
    assert ctl.snapshot()['hardwareOutput'] is False


class FakeLink:
    port='TESTPORT'; enabled=True; reboots=0; role='hands'
    def __init__(self): self.sent=[]
    def stream_age(self): return 0
    def send_torque(self,l,r): self.sent.append(('T',l,r))
    def disable(self): self.sent.append(('DISABLE',))
    def send(self,c): raise AssertionError('No ENABLE, recovery or raw command allowed')


def hardware_fixture():
    p=replace(simulation_profile(),purpose='hardware',device_id='TEST-ONLY',port='TESTPORT',firmware='test',
              review_id='UNIT-TEST-NOT-A-HARDWARE-APPROVAL',retention_confirmed=True)
    identity=DeviceIdentity(p.device_id,p.port,p.firmware,'hands')
    return p,identity,FakeLink()


def test_guard_adapter_requires_opt_in_hardware_profile_identity_and_pre_enabled_link():
    p,identity,link=hardware_fixture()
    with pytest.raises(ValueError): GuardedHandSession(link,p,identity)
    with pytest.raises(ValueError): GuardedHandSession(link,simulation_profile(),identity,allow_output=True)
    with pytest.raises(ValueError): GuardedHandSession(link,p,replace(identity,role='legs'),allow_output=True)
    with pytest.raises(ValueError): GuardedHandSession(link,p,replace(identity,firmware='other'),allow_output=True)
    link.enabled=False
    with pytest.raises(ValueError): GuardedHandSession(link,p,identity,allow_output=True)
    assert link.sent==[]


def test_real_guard_with_fake_transport_only_writes_through_guard_and_latches_grip_loss():
    p,identity,link=hardware_fixture()
    session=GuardedHandSession(link,p,identity,allow_output=True)
    sample=lambda t:measurement(t,device_id=p.device_id,left_deg=-10)
    interlock=lambda t:locks(t,origin='hardware')
    try:
        assert session.begin(sample(0),interlock(0),0)
        assert link.sent==[]
        result=session.step(sample(.01),interlock(.01),.01)
        assert result['hardwareOutput'] is True
        assert link.sent[-1][0]=='T'
        assert not session.fire('left',1,.01,.01), 'Raising is not a game-ready state'
        assert session.configure_game('excavator',.5)
        assert link.sent[-1]==('T',0,0)
        assert session.begin(sample(.02),interlock(.02),.02)
        out=session.step(sample(.03),replace(interlock(.03),left_grip=False),.03)
        assert out['hardwareOutput'] is False and link.sent[-1]==('DISABLE',)
        assert not session.begin(sample(.04),interlock(.04),.04)
    finally: session.close()


def test_device_reboot_or_serial_role_change_never_automatically_recovers():
    for mutation in ('port','reboots','enabled'):
        p,identity,link=hardware_fixture();session=GuardedHandSession(link,p,identity,allow_output=True)
        try:
            sample=measurement(0,device_id=p.device_id);interlock=locks(0,origin='hardware')
            assert session.begin(sample,interlock,0)
            setattr(link,mutation,{'port':'OTHER','reboots':1,'enabled':False}[mutation])
            out=session.step(replace(sample,at=.01,sequence=10),replace(interlock,at=.01),.01)
            assert out['stage']=='fault' and out['hardwareOutput'] is False
            assert link.sent[-1]==('DISABLE',)
        finally:session.close()


def test_guard_adapter_transport_failure_latches_fault_and_does_not_claim_delivery():
    p,identity,link=hardware_fixture();session=GuardedHandSession(link,p,identity,allow_output=True)
    def broken(*args):raise OSError('fake transport disconnected')
    try:
        assert session.begin(measurement(0,device_id=p.device_id),locks(0,origin='hardware'),0)
        link.send_torque=broken
        out=session.step(measurement(.01,device_id=p.device_id),locks(.01,origin='hardware'),.01)
        assert out['stage']=='fault' and out['hardwareOutput'] is False
        assert out['commanded_nm'] is None
        assert not session.begin(measurement(.02,device_id=p.device_id),locks(.02,origin='hardware'),.02)
    finally:session.close()


def test_frame_adapter_preserves_sensor_clock_and_normalized_right_angle():
    frame=parse_line(line(50),1.2);sample=sample_from_frame(frame,'test-device')
    assert sample.at==1.2 and sample.sequence==50
    assert sample.right_deg==20 and sample.device_id=='test-device'


def line(seq=1,l=10,r=-20,ls=0,rs=0):
    return f'S:{seq},0,0,0,0,0,0,0,0,1,101,{l},{r},{ls},{rs}\n'


def test_pose_capture_normalizes_right_once_filters_invalid_and_marks_observations_not_limits():
    recorder=PoseRecorder()
    for i in range(120):recorder.add(parse_line(line(i),i*.005))
    assert not recorder.add(parse_line(line(119),.6))
    assert not recorder.add(parse_line(line(120,l=float('nan')),.61))
    value=recorder.result('TESTPORT','center')
    assert value['stable'] is True and value['frameCount']==120
    assert value['stats']['left']['median_deg']==10 and value['stats']['right']['median_deg']==20
    assert value['hardwareOutput'] is False and value['motorLimits'] is False
    with pytest.raises(ValueError):recorder.add(parse_line(line(1),.62))


def test_motion_and_stream_gaps_cannot_be_exported_as_stable_calibration():
    recorder=PoseRecorder()
    for i in range(20):recorder.add(parse_line(line(i,l=i),i*.1))
    assert not recorder.result('TEST','forward')['stable']
    with pytest.raises(ValueError):PoseRecorder().result('TEST','center')


def test_read_only_capture_never_calls_a_write_or_handshake():
    class Stream:
        i=0
        def readline(self,limit):
            self.i+=1
            return line(self.i).encode()
        def write(self,*_):raise AssertionError('Capture must be read-only')
    stream=Stream();now=iter(i*.005 for i in range(10000))
    recorder=read_pose(stream,1,clock=lambda:next(now))
    assert recorder.result('TEST','center')['stable']


def test_three_pose_bundle_checks_identity_spans_and_never_fills_motor_limits():
    def pose(name,l,r):
        recorder=PoseRecorder()
        for i in range(120):recorder.add(parse_line(line(i,l=l,r=r),i*.005))
        return recorder.result('TEST',name,{'serial':'test-device'})
    center,back,forward=pose('center',10,20),pose('back',-10,0),pose('forward',30,40)
    result=combine_observations(center,back,forward)
    assert result['observed']['left']['forward_angle_direction']==1
    assert result['observed']['right']['forward_angle_direction']==-1
    assert result['motorLimits'] is False and result['hardwareReady'] is False
    with pytest.raises(ValueError):combine_observations(center,back,{**forward,'port':'OTHER'})
    with pytest.raises(ValueError):combine_observations(center,back,{**forward,'usbIdentity':{'serial':'other'}})
    with pytest.raises(ValueError):combine_observations(center,back,{**forward,'stable':False})
    with pytest.raises(ValueError):combine_observations(center,back,pose('forward',11,21))


def test_virtual_plant_report_completes_lift_pulses_and_stale_fault_with_no_hardware(tmp_path):
    rows,events=run_demo()
    assert len(rows)==1400
    assert sum('pulse: True' in note for _,note in events)==3
    assert any(note.startswith('active:') for _,note in events)
    assert rows[-1]['stage']=='fault'
    assert all(r['left_nm']==r['right_nm']==0 for r in rows if r['seconds']>=11.5)
    assert max(abs(r[s+'_nm']) for r in rows for s in ('left','right'))<=.8
    result=write_report(tmp_path/'report.html')
    assert result['hardwareOutput'] is False
    template=json.loads((tmp_path/'hand-hardware-profile-TEMPLATE.json').read_text())
    assert template['left']['cap_nm'] is None
