"""Cooperative serial exclusivity across local ShellOS processes, no device I/O.

Locks remain on disk; the OS releases them on exit/crash. Never unlink a live
lock file. Other applications must also respect serial-driver exclusivity.
"""
from __future__ import annotations
import hashlib
import os
from pathlib import Path
import re
import tempfile
import threading


class DeviceBusyError(RuntimeError):
    pass


def canonical_port(port):
    if not isinstance(port, str) or not port.strip():
        raise ValueError('An explicit serial port is required')
    value = port.strip()
    if value.startswith('\\\\.\\'):
        value = value[4:]
    if re.fullmatch(r'COM\d+', value, re.I):
        return 'COM' + str(int(value[3:]))
    return os.path.normcase(os.path.realpath(value))


_lock = threading.RLock()
_ports = set()
_controllers = {}


class DeviceLease:
    """Acquire before serial open; release only after the serial handle closes."""
    def __init__(self, port, role):
        if role not in ('legs', 'hands', 'capture'):
            raise ValueError('Unknown device role')
        self.key, self.role, self._file = canonical_port(port), role, None
        directory = Path(tempfile.gettempdir()) / 'aima-shellos-device-locks'
        directory.mkdir(exist_ok=True)
        path = directory / (hashlib.sha256(self.key.encode()).hexdigest() + '.lock')
        with _lock:
            if self.key in _ports:
                raise DeviceBusyError(f'{port} is already owned; stop its current session first')
            handle = path.open('a+b')
            try:
                if handle.seek(0, 2) == 0:
                    handle.write(b'0'); handle.flush()
                handle.seek(0)
                if os.name == 'nt':
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                handle.close()
                raise DeviceBusyError(f'{port} is in use by another session; no device opened') from exc
            self._file = handle
            _ports.add(self.key)

    def close(self):
        with _lock:
            if self._file is None:
                return
            self._file.close()  # Closing releases the kernel lock on Windows and POSIX.
            self._file = None
            _ports.remove(self.key)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class ControllerLease:
    """One Guard per transport object. Closed owners cannot release a new owner."""
    def __init__(self, link, role):
        if role not in ('hands', 'legs') or getattr(link, 'role', 'legs') != role:
            raise ValueError('Controller role does not match the transport role')
        if getattr(link, 'closed', False) is True:
            raise ValueError('A closed transport cannot accept a new controller')
        self.link, self._token = link, object()
        with _lock:
            if id(link) in _controllers:
                raise DeviceBusyError('This connection already has a controller; shut it down first')
            _controllers[id(link)] = (link, self._token)

    def close(self):
        with _lock:
            current = _controllers.get(id(self.link))
            if current is not None and current[0] is self.link and current[1] is self._token:
                del _controllers[id(self.link)]
