"""Pure, deterministic hand torque proposal. No serial, threads or I/O.

Angles/velocities arrive in normalized ShellOS degrees / degrees per second.
Internal control math uses radians; output uses normalized device N m.
"""
from __future__ import annotations
from dataclasses import dataclass
from math import sin, pi, radians
from .profile import HandProfile, number


@dataclass(frozen=True)
class Sample:
    at: float
    sequence: float
    left_deg: float
    right_deg: float
    left_dps: float
    right_dps: float
    device_id: str


@dataclass(frozen=True)
class Interlocks:
    at: float
    left_grip: bool
    right_grip: bool
    mount_ok: bool
    straps_released: bool
    estop: bool
    origin: str  # simulation or trusted local hardware interlock adapter


def sample_from_frame(frame, device_id):
    """Keep the original arrival/board clocks; never refresh stale frames here."""
    return Sample(frame.t_host, frame.ms, frame.l_deg, frame.r_deg, frame.l_dps, frame.r_dps, device_id)


def clip(value, limit):
    return max(-limit, min(limit, value))


class HandController:
    def __init__(self, profile: HandProfile):
        self.profile = profile
        self.stage = 'idle'
        self.reason = 'not armed'
        self.scene = 'range'
        self.damping = 1.0
        self.last_now = None
        self.last_sequence = None
        self.last_sample_at = None
        self.started_at = 0.0
        self.settled_since = None
        self.target = {'left': 0.0, 'right': 0.0}
        self.previous = {'left': 0.0, 'right': 0.0}
        self.pulses = {}
        self.cooldown_until = {'left': 0.0, 'right': 0.0}
        self.last_event_id = 0
        self.components = {}

    def pause(self, reason='operator pause', fault=False):
        self.stage = 'fault' if fault or self.stage == 'fault' else 'paused'
        self.reason = reason
        self.previous = {'left': 0.0, 'right': 0.0}
        self.pulses.clear()
        self.components = {}
        self.settled_since = None
        return self.snapshot()

    def _problem(self, sample, interlocks, now):
        if not number(now) or not isinstance(sample, Sample) or not isinstance(interlocks, Interlocks):
            return 'invalid sample/interlocks'
        if not all(number(getattr(sample, k)) for k in ('at', 'sequence', 'left_deg', 'right_deg', 'left_dps', 'right_dps')):
            return 'nonfinite sample'
        if not number(interlocks.at) or not 0 <= now - sample.at <= self.profile.sample_timeout_s:
            return 'stale sample'
        if not 0 <= now - interlocks.at <= self.profile.interlock_timeout_s:
            return 'stale grip/mount state'
        if sample.device_id != self.profile.device_id:
            return 'device identity changed'
        if interlocks.origin != ('hardware' if self.profile.purpose == 'hardware' else 'simulation'):
            return 'unverified interlock source'
        if not all(type(getattr(interlocks, k)) is bool for k in ('left_grip', 'right_grip', 'mount_ok', 'straps_released', 'estop')):
            return 'invalid interlocks'
        if interlocks.estop:
            return 'emergency stop'
        if not (interlocks.left_grip and interlocks.right_grip and interlocks.mount_ok and interlocks.straps_released):
            return 'grip/mount/strap interlock released'
        if self.last_sequence is not None and (sample.sequence < self.last_sequence or sample.at < self.last_sample_at):
            return 'device clock/session reset'
        if self.last_sequence == sample.sequence and sample.at != self.last_sample_at:
            return 'duplicate frame was re-timestamped'
        for side in ('left', 'right'):
            axis = getattr(self.profile, side)
            if not axis.min_deg <= getattr(sample, side + '_deg') <= axis.max_deg:
                return side + ' angle outside engineering range'
            if abs(getattr(sample, side + '_dps')) > axis.speed_limit_dps:
                return side + ' speed limit'
        return None

    def begin(self, sample, interlocks, now):
        # Explicit operator action, not automatic recovery on a new good sample.
        # A fault requires acknowledge_fault first; no software ENABLE is issued.
        if self.stage == 'fault':
            return False
        problem = self._problem(sample, interlocks, now)
        if problem:
            self.pause(problem, fault=True)
            return False
        if self.stage in ('raising', 'active'):
            return False
        self.last_now = now
        self.last_sequence, self.last_sample_at = sample.sequence, sample.at
        self.target = {side: getattr(sample, side + '_deg') for side in ('left', 'right')}
        self.previous = {'left': 0.0, 'right': 0.0}
        self.pulses.clear()
        self.started_at = now
        self.settled_since = None
        self.stage, self.reason = 'raising', 'moving a bounded target toward hold position'
        return True

    def acknowledge_fault(self):
        if self.stage != 'fault':
            return False
        self.stage = 'paused'
        self.pause('fault acknowledged; explicit begin required')
        self.last_sequence = self.last_sample_at = self.last_now = None
        # Event sequence numbers never rewind on pause/rearm.
        return True

    def configure_game(self, scene, damping=1.0):
        if scene not in ('range', 'excavator') or not number(damping) or not 0 <= damping <= 1:
            self.pause('invalid game settings', fault=True)
            return False
        if scene != self.scene:
            self.pause('scene changed; explicit begin required')
        self.scene, self.damping = scene, damping
        return True

    def fire(self, side, event_id, event_at, now):
        if side not in ('left', 'right', 'both') or type(event_id) is not int or event_id <= self.last_event_id:
            return False
        if not number(now) or not number(event_at) or not 0 <= now - event_at <= self.profile.pulse_event_ttl_s:
            return False
        self.last_event_id = event_id  # Never replay a previously rejected game request later.
        if self.stage != 'active' or self.scene != 'range' or self.last_now is None or not 0 <= now - self.last_now <= self.profile.loop_timeout_s:
            return False
        accepted = False
        for name in (('left', 'right') if side == 'both' else (side,)):
            if now < self.cooldown_until[name]:
                continue
            self.pulses[name] = now
            self.cooldown_until[name] = now + getattr(self.profile, name).pulse_cooldown_seconds
            accepted = True
        return accepted

    def step(self, sample, interlocks, now):
        if self.stage not in ('raising', 'active'):
            return self.snapshot()
        problem = self._problem(sample, interlocks, now)
        if problem:
            return self.pause(problem, fault=True)
        dt = now - self.last_now
        if not 0 < dt <= self.profile.loop_timeout_s:
            return self.pause('control clock stalled or moved backwards', fault=True)
        self.last_now = now
        self.last_sequence, self.last_sample_at = sample.sequence, sample.at
        if self.stage == 'raising' and now - self.started_at > self.profile.lift_timeout_s:
            return self.pause('lift did not settle before timeout', fault=True)
        settled = True
        for side in ('left', 'right'):
            axis = getattr(self.profile, side)
            q, speed = getattr(sample, side + '_deg'), getattr(sample, side + '_dps')
            if self.stage == 'raising':
                self.target[side] += clip(axis.hold_deg - self.target[side], axis.lift_speed_dps * dt)
                if abs(self.target[side] - q) > axis.tracking_error_deg:
                    return self.pause(side + ' lift tracking error', fault=True)
            else:
                self.target[side] = axis.hold_deg
            error = radians(self.target[side] - q)
            velocity = radians(speed)
            spring = axis.kp_nm_rad * error
            gravity = axis.gravity_nm * sin(radians(q - axis.gravity_zero_deg))
            damping = -(axis.kd_nm_s_rad + axis.damping_nm_s_rad * self.damping) * velocity
            pulse = 0.0
            started = self.pulses.get(side)
            if started is not None:
                age = now - started
                if 0 <= age < axis.pulse_seconds:
                    pulse = axis.pulse_nm * axis.pulse_direction * sin(pi * age / axis.pulse_seconds)
                else:
                    del self.pulses[side]
            wanted = clip(spring + gravity + damping + pulse, axis.cap_nm)
            # Limit the whole command, including lift, gravity and game pulses, in N m/s.
            physical = self.previous[side] * axis.torque_sign
            physical += clip(wanted - physical, axis.slew_nm_s * dt)
            # Never command farther outward when at a configured boundary.
            if (q <= axis.min_deg and physical < 0) or (q >= axis.max_deg and physical > 0):
                physical = 0.0
            self.previous[side] = physical * axis.torque_sign
            self.components[side] = dict(spring_nm=spring, gravity_nm=gravity, damping_nm=damping,
                                         pulse_nm=pulse, proposed_nm=self.previous[side])
            settled &= abs(q - axis.hold_deg) <= axis.settle_deg and abs(speed) <= axis.lift_speed_dps
            settled &= abs(self.target[side] - axis.hold_deg) <= 1e-9
        if self.stage == 'raising':
            if settled:
                if self.settled_since is None:
                    self.settled_since = now
                if now - self.settled_since >= self.profile.settle_seconds:
                    self.stage, self.reason = 'active', 'hold + damping; independent game feedback available'
            else:
                self.settled_since = None
        return self.snapshot()

    def snapshot(self):
        return {'stage': self.stage, 'reason': self.reason, 'scene': self.scene,
                'torque_nm': dict(self.previous), 'target_deg': dict(self.target),
                'components': {side: dict(parts) for side, parts in self.components.items()},
                'profilePurpose': self.profile.purpose, 'hardwareOutput': False}
