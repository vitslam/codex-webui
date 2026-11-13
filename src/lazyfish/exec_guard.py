"""Journal ownership BEFORE exec. Run as a script, with no package imports.

This closes the spawn/database crash window: native code cannot start without a
private ownership record. The inherited lease remains open across exec.
"""

import ctypes
from contextlib import closing
import json
import os
from pathlib import Path
import signal
import select
import resource
import sys
import tempfile
from processes import boot_id, identity, machine_id, stop_session


def _watch_parent(parent, worker, ready):
    """Darwin guardian: outside the worker session, with no inherited leases.

    Register both exits before acknowledging readiness. Watching the worker too
    avoids a persistent guardian after normal completion. kqueue registration
    plus the worker's final getppid check closes the parent-exit startup race.
    """
    try:
        os.setsid()
        with closing(select.kqueue()) as events:
            keep = sorted((ready, events.fileno()))
            limit = resource.getrlimit(resource.RLIMIT_NOFILE)[0]
            if limit == resource.RLIM_INFINITY:
                limit = os.sysconf("SC_OPEN_MAX")
            start = 0
            for fd in keep:
                os.closerange(start, fd)
                start = fd + 1
            os.closerange(start, limit)
            changes = [select.kevent(pid, filter=select.KQ_FILTER_PROC,
                       flags=select.KQ_EV_ADD | select.KQ_EV_ONESHOT,
                       fflags=select.KQ_NOTE_EXIT) for pid in (parent, worker)]
            events.control(changes, 0, 0)
            current = identity(worker)
            if current is None:
                return
            record = {"pid": worker, "start_ticks": current[0],
                      "boot_id": boot_id(), "machine_id": machine_id()}
            os.write(ready, b"1")
            os.close(ready)
            while True:
                exits = events.control(None, 2, None)
                # Parent exit wins even if the worker also exited: tool children
                # can still hold the session/lease and need ownership-safe cleanup.
                if any(event.ident == parent for event in exits):
                    stop_session(record)
                    return
                if any(event.ident == worker for event in exits):
                    return
    except (OSError, ValueError):
        # No ready byte means the worker must fail closed before exec.
        return


def protect_parent(parent):
    if os.getppid() != parent:
        return False
    if sys.platform != "darwin":
        libc = ctypes.CDLL(None, use_errno=True)
        return libc.prctl(1, signal.SIGTERM, 0, 0, 0) == 0 and os.getppid() == parent
    reader, writer = os.pipe()
    try:
        guardian = os.fork()
    except OSError:
        os.close(reader)
        os.close(writer)
        return False
    if guardian == 0:
        try:
            os.close(reader)
            _watch_parent(parent, os.getppid(), writer)
        finally:
            os._exit(0)
    os.close(writer)
    try:
        return os.read(reader, 1) == b"1" and os.getppid() == parent
    finally:
        os.close(reader)


def main():
    record_path, job, owner, parent, lease, binary, *options = sys.argv[1:]
    parent, lease = int(parent), int(lease)
    # No native code starts until the parent-death guard is armed.
    if not protect_parent(parent):
        return 125
    pid = os.getpid()
    current = identity(pid)
    if current is None:
        return 125
    record = {"job":job,"owner":owner,"pid":pid,"start_ticks":current[0],
              "boot_id":boot_id(),"machine_id":machine_id()}
    path = Path(record_path)
    fd, temporary = tempfile.mkstemp(prefix=".execution-",dir=path.parent)
    try:
        with os.fdopen(fd,"w") as stream:
            json.dump(record,stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary,path)
    finally:
        Path(temporary).unlink(missing_ok=True)
    if os.getppid() != parent:
        return 125
    os.set_inheritable(lease,True)
    os.execve(binary,[binary,"app-server",*options],dict(os.environ))


if __name__ == "__main__":
    raise SystemExit(main())
