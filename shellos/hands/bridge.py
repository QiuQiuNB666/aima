"""Explicit local Guard adapter. No launcher, serial open, ENABLE or recovery.

The integrating process must exclusively own a verified, already-enabled hand
link and trusted grip/mount sensors. The web page is not an interlock provider.
"""
from __future__ import annotations
from dataclasses import dataclass
from .control import HandController
from .profile import HandProfile
from ..safety.guard import Guard, CONNECTED, ARMED, ACTIVE


@dataclass(frozen=True)
class DeviceIdentity:
    device_id: str
    port: str
    firmware: str
    role: str


class GuardedHandSession:
    def __init__(self, link, profile: HandProfile, identity: DeviceIdentity, *, allow_output=False, guard_factory=Guard):
        if allow_output is not True:
            raise ValueError('Physical output requires explicit local opt-in; default is disabled')
        if profile.purpose != 'hardware' or not profile.retention_confirmed:
            raise ValueError('Simulation profiles cannot reach the device')
        expected = DeviceIdentity(profile.device_id, profile.port, profile.firmware, 'hands')
        if identity != expected or identity.port.lower() in ('sim', 'replay') or identity.device_id.startswith('sim-'):
            raise ValueError('Profile must match this hand device and firmware')
        if link.port != identity.port or link.enabled is not True:
            raise ValueError('Local operator must provide the verified hand link; no auto enable')
        self.link, self.profile, self.identity = link, profile, identity
        self.reboots = getattr(link, 'reboots', 0)
        self.controller = HandController(profile)
        # A dedicated Guard avoids max(deadman_sources) from a leg controller.
        # HandController supplies per-axis caps and time-based slew. The extra
        # per-tick Guard limiter is set wide enough not to distort that command.
        cap = max(profile.left.cap_nm, profile.right.cap_nm)
        self.guard = guard_factory(link, soft_cap=cap, slew=2*cap, min_conf=1,
                                   wd_zero=profile.loop_timeout_s, wd_disable=.2,
                                   stream_timeout=profile.sample_timeout_s)
        self.closed = False

    def _link_valid(self):
        return (not self.closed and self.link.port == self.identity.port and self.link.enabled is True
                and getattr(self.link, 'reboots', 0) == self.reboots)

    def begin(self, sample, interlocks, now):
        if not self._link_valid() or self.guard.state not in (CONNECTED, ARMED):
            return False
        if not self.controller.begin(sample, interlocks, now):
            if self.controller.stage == 'fault':
                self.guard.trigger_estop(self.controller.reason)
            return False
        if self.guard.arm() is False:
            self.controller.pause('Guard denied arm', fault=True)
            return False
        # No nonzero command until a subsequent fresh loop iteration.
        self.guard.set_deadman(0, source='hands')
        return True

    def configure_game(self, scene, damping=1.0):
        result = self.controller.configure_game(scene, damping)
        if self.controller.stage not in ('raising', 'active'):
            self.guard.set_deadman(0, source='hands')
            if self.controller.stage == 'fault':
                self.guard.trigger_estop(self.controller.reason)
            else:
                self.guard.submit(0, 0, confidence=1)
        return result

    def fire(self, side, event_id, event_at, now):
        if not self._link_valid() or self.guard.state != ACTIVE:
            return False
        return self.controller.fire(side, event_id, event_at, now)

    def step(self, sample, interlocks, now):
        try:
            return self._step(sample, interlocks, now)
        except Exception:
            self.controller.pause('local control/transport exception', fault=True)
            self.guard.set_deadman(0, source='hands')
            try:
                self.guard.trigger_estop('hand control exception')
            except Exception:
                pass  # Broken transport: no claim that a stop command arrived.
            return {**self.controller.snapshot(), 'hardwareOutput':False, 'commanded_nm':None,
                    'transportStatus':'unconfirmed; verify physical support/stop locally'}

    def _step(self, sample, interlocks, now):
        if not self._link_valid():
            self.controller.pause('hand link changed, rebooted or disabled', fault=True)
        elif self.controller.stage in ('raising', 'active') and self.guard.state not in (ARMED, ACTIVE):
            self.controller.pause('Guard stopped; local reset required', fault=True)
        else:
            self.controller.step(sample, interlocks, now)
        state = self.controller.snapshot()
        active = state['stage'] in ('raising', 'active')
        self.guard.set_deadman(1 if active else 0, source='hands')
        if state['stage'] == 'fault':
            self.guard.trigger_estop(state['reason'])
            sent = (0.0, 0.0)
        else:
            sent = self.guard.submit(state['torque_nm']['left'], state['torque_nm']['right'], confidence=1)
            if active and (not self._link_valid() or self.guard.state != ACTIVE or self.guard.last_reason != 'ok'):
                self.controller.pause('Guard or transport rejected output', fault=True)
                self.guard.trigger_estop('hand output rejected')
                state = self.controller.snapshot()
                sent = (0.0, 0.0)
        # Guard reports commands sent, not a measured physical torque sensor.
        return {**state, 'hardwareOutput': active and self.guard.state == ACTIVE,
                'commanded_nm': {'left': sent[0], 'right': sent[1]}}

    def pause(self, reason='operator pause'):
        self.controller.pause(reason)
        self.guard.set_deadman(0, source='hands')
        self.guard.submit(0, 0, confidence=1)

    def close(self):
        if not self.closed:
            self.closed = True
            self.controller.pause('session closed')
            self.guard.shutdown()

    # No rearm/recover method: after a fault, close this session and require a
    # local operator to verify identity/interlocks before creating a new session.
