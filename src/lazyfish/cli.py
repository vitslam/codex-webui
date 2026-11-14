"""Small, explicit administration commands for a local installation."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import signal
import sys

from . import __version__
from .codex import diagnose
from .config import ConfigError, config_path, initialize, load, remember_config, rotate_token
from . import runtime


def _remember(path) -> None:
    try:
        remember_config(path)
    except (ConfigError, OSError):
        print("lazyfish: Could not remember this installation; keep using --config or LAZYFISH_CONFIG.",
              file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    os.umask(0o077)

    def interrupt(*_):
        raise KeyboardInterrupt

    previous = signal.signal(signal.SIGTERM, interrupt)
    try:
        return _main(argv)
    except KeyboardInterrupt:
        print("Interrupted; owned diagnostic processes were closed.", file=sys.stderr)
        return 130
    finally:
        signal.signal(signal.SIGTERM, previous)


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Lazyfish: a local Codex web companion.")
    parser.add_argument("--version", action="version", version=f"lazyfish {__version__}")
    parser.add_argument("--config", help="Optional configuration override; otherwise use the default or saved installation")
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init", help="Create private configuration; never overwrite existing configuration")
    init.add_argument("--workspace", default="", help="Optional default working directory for new chats; not an access boundary")
    init.add_argument("--data-dir")
    init.add_argument("--port", type=int, default=3210)
    init.add_argument("--codex-bin", default="codex")
    doctor = commands.add_parser("doctor", help="Check local CLI installation and stored login, without inference")
    doctor.add_argument("--probe", action="store_true", help="Also initialize/reap an owned app-server; no model request")
    doctor.add_argument("--json", action="store_true")
    serve = commands.add_parser("serve", help="Start the foreground local chat service")
    serve.add_argument("--no-token", action="store_true",
                       help="Disable Web sign-in authentication; anyone who can reach the URL can use this Codex session")
    commands.add_parser("status", help="Check this data directory's running instance")
    commands.add_parser("stop", help="Gracefully stop this instance using authentication, never a stale PID")
    token = commands.add_parser("token", help="Reveal or rotate the private Web sign-in token in this terminal")
    token.add_argument("--rotate", action="store_true",
                       help="Generate a new Web sign-in token; stop the service first")
    args = parser.parse_args(argv)
    try:
        path = config_path(args.config)
        if args.command == "init":
            settings = initialize(path, args.workspace, args.data_dir, args.port, args.codex_bin)
            _remember(settings.config)
            print(f"Configuration ready: {settings.config}")
            command = ["lazyfish"]
            try:
                automatic = config_path()
            except (ConfigError, OSError):
                automatic = None
            if automatic != settings.config:
                command += ["--config", str(settings.config)]
            print(f"Existing configuration and token are preserved. Use `{shlex.join(command + ['token'])}` to view the token.")
            return 0
        if args.command == "token" and args.rotate:
            token = rotate_token(path)
            print(token)
            print("Web sign-in token rotated; the previous token is no longer valid. "
                  "Run `lazyfish serve` to start the service.", file=sys.stderr)
            _remember(path)
            return 0
        settings = load(path)
        _remember(settings.config)
        if args.command == "token":
            print(settings.token)
        elif args.command == "doctor":
            report = diagnose(settings, protocol=args.probe)
            if args.json:
                print(json.dumps(report, indent=2))
            else:
                for key, good in report["checks"].items():
                    print(f"{'OK' if good else 'FAIL'}  {key}")
                print(f"Codex version: {report['version'] or 'unknown'}")
                if args.probe:
                    print(f"App-server initialize: {'OK' if report['protocol'] else 'FAIL'}")
                print("Local checks only. Network access, inference and billing were not tested.")
                print("See docs/troubleshooting.md if a check fails.")
            return 0 if report["ready"] else 1
        elif args.command == "serve":
            runtime.serve(settings, no_token=args.no_token)
        elif args.command == "status":
            report = runtime.request(settings)
            print(json.dumps(report or {"running": False}, indent=2))
            return 0 if report else 1
        elif args.command == "stop":
            stopped = runtime.stop(settings)
            print("Stopped cleanly." if stopped else "No matching instance stopped; no process signal was sent.")
            return 0 if stopped else 1
        return 0
    except (ConfigError, OSError, ValueError) as exc:
        # Known config messages contain no secret values; OS errors can contain paths.
        message = str(exc) if isinstance(exc, ConfigError) else "Operation failed; check paths, port and private file permissions."
        print(f"lazyfish: {message}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
