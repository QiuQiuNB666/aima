"""Explicit engineering parameters. Game angle observations are not limits."""
from __future__ import annotations

from dataclasses import asdict, dataclass, fields
import math


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


@dataclass(frozen=True)
class AxisProfile:
    min_deg: float
    max_deg: float
    hold_deg: float
    kp_nm_rad: float
    kd_nm_s_rad: float
    damping_nm_s_rad: float
    gravity_nm: float
    gravity_zero_deg: float
    cap_nm: float
    slew_nm_s: float
    speed_limit_dps: float
    lift_speed_dps: float
    settle_deg: float
    tracking_error_deg: float
    pulse_nm: float
    pulse_direction: int
    pulse_seconds: float
    pulse_cooldown_seconds: float
    # Relative to already normalized ShellOS coordinates, not raw right wire sign.
    torque_sign: int

    def __post_init__(self):
        if not all(number(getattr(self, f.name)) for f in fields(self)):
            raise ValueError('Every axis parameter must be explicitly finite; no null/default motor limits')
        if not self.min_deg < self.hold_deg < self.max_deg:
            raise ValueError('Hold position must lie strictly inside the engineering limits')
        if self.torque_sign not in (-1, 1) or self.pulse_direction not in (-1, 1):
            raise ValueError('Verified torque and pulse signs must be +1 or -1')
        if min(self.kp_nm_rad, self.kd_nm_s_rad, self.damping_nm_s_rad, self.gravity_nm, self.pulse_nm) < 0:
            raise ValueError('Gains and magnitudes must be nonnegative')
        if not 0 < self.cap_nm <= 7.5 or max(self.gravity_nm, self.pulse_nm) > self.cap_nm:
            raise ValueError('Explicit hand cap must respect the existing Guard hard cap')
        if min(self.slew_nm_s, self.speed_limit_dps, self.lift_speed_dps, self.settle_deg, self.tracking_error_deg) <= 0:
            raise ValueError('Rates and tolerances must be positive')
        if self.lift_speed_dps >= self.speed_limit_dps or self.settle_deg >= self.tracking_error_deg:
            raise ValueError('Lift speed / settle tolerance must leave room for fault limits')
        if not 0 < self.pulse_seconds <= 0.25 or not self.pulse_seconds < self.pulse_cooldown_seconds <= 10:
            raise ValueError('Pulse duration/cooldown outside software envelope')


@dataclass(frozen=True)
class HandProfile:
    left: AxisProfile
    right: AxisProfile
    purpose: str
    device_id: str
    port: str
    firmware: str
    review_id: str
    retention_confirmed: bool
    sample_timeout_s: float
    interlock_timeout_s: float
    loop_timeout_s: float
    lift_timeout_s: float
    settle_seconds: float
    pulse_event_ttl_s: float

    def __post_init__(self):
        if not isinstance(self.left, AxisProfile) or not isinstance(self.right, AxisProfile):
            raise ValueError('Both sides require validated AxisProfile values')
        if self.purpose not in ('simulation', 'hardware'):
            raise ValueError('Profile purpose must be simulation or hardware')
        for name in ('device_id', 'port', 'firmware', 'review_id'):
            if not isinstance(getattr(self, name), str) or not getattr(self, name).strip():
                raise ValueError(f'{name} must be explicit')
        if type(self.retention_confirmed) is not bool:
            raise ValueError('retention_confirmed must be boolean')
        for name in ('sample_timeout_s', 'interlock_timeout_s', 'loop_timeout_s', 'lift_timeout_s', 'settle_seconds', 'pulse_event_ttl_s'):
            if not number(getattr(self, name)) or getattr(self, name) <= 0:
                raise ValueError(f'{name} must be positive and finite')
        if max(self.sample_timeout_s, self.interlock_timeout_s, self.pulse_event_ttl_s) > .2 or self.loop_timeout_s > .05:
            raise ValueError('Timeout exceeds the hand-control software envelope')
        if self.settle_seconds >= self.lift_timeout_s:
            raise ValueError('Lift timeout must exceed settling time')
        if self.purpose == 'hardware' and not self.retention_confirmed:
            raise ValueError('A verified support/retention response on torque loss is required')

    def to_dict(self):
        return {'schema': 'aima.hand.haptics-profile.v1', **asdict(self)}

    @classmethod
    def from_dict(cls, data):
        if not isinstance(data, dict) or data.get('schema') != 'aima.hand.haptics-profile.v1':
            raise ValueError('Expected an engineering haptics profile, not screen calibration')
        try:
            return cls(**{**{k: v for k, v in data.items() if k not in ('schema', 'left', 'right')},
                          'left': AxisProfile(**data['left']), 'right': AxisProfile(**data['right'])})
        except (TypeError, KeyError) as error:
            raise ValueError('Missing or unexpected engineering profile fields') from error


def simulation_profile():
    """Arbitrary virtual plant values, NEVER a suggested real-device setting."""
    axis = AxisProfile(-50, 50, 0, 2.5, .25, .55, .2, 0, .8, 3, 100, 12, 2, 25, .18, -1, .12, .5, 1)
    return HandProfile(axis, axis, 'simulation', 'sim-hands', 'sim', 'sim', 'SIMULATION-ONLY', False,
                       .1, .1, .05, 10, .25, .12)


def blank_hardware_profile():
    value = simulation_profile().to_dict()
    for key in value:
        if key not in ('schema', 'left', 'right', 'purpose'):
            value[key] = None
    value['purpose'] = 'hardware'
    value['left'] = {f.name: None for f in fields(AxisProfile)}
    value['right'] = dict(value['left'])
    return value
