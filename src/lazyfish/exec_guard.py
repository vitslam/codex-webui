"""Journal ownership BEFORE exec. Run as a script, with no package imports.

This closes the spawn/database crash window: native code cannot start without a
private ownership record. The inherited lease remains open across exec.
"""

import ctypes
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
from processes import machine_id


def main():
    record_path, job, owner, parent, lease, binary, *options = sys.argv[1:]
    parent, lease = int(parent), int(lease)
    libc = ctypes.CDLL(None, use_errno=True)
    # Even during initialization, parent death must not leave a new independent executor.
    if libc.prctl(1, signal.SIGTERM, 0, 0, 0) != 0 or os.getppid() != parent:
        return 125
    pid = os.getpid()
    fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
    record = {"job":job,"owner":owner,"pid":pid,"start_ticks":int(fields[19]),
              "boot_id":Path("/proc/sys/kernel/random/boot_id").read_text().strip(),"machine_id":machine_id()}
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
