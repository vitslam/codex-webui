"""User configuration discovery; never load secrets from the working directory."""

from __future__ import annotations

import json
import fcntl
import os
from pathlib import Path
import secrets
import stat
import tempfile
import tomllib
from dataclasses import dataclass, field

from .network import bindable_ipv4


class ConfigError(ValueError):
    pass


def _valid_bind_host(value: object) -> bool:
    """Default is 127.0.0.1; 0.0.0.0 or any unicast IPv4 may be set explicitly."""
    return bindable_ipv4(value)


def private_dir(path: Path) -> None:
    if path.is_symlink():
        raise ConfigError("A private directory cannot be a symlink.")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = path.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise ConfigError("Private directories must belong to the current user.")
    path.chmod(0o700)


def write_private(path: Path, value: str) -> None:
    """Atomically replace an application-owned file without following its symlink."""
    private_dir(path.parent)
    if path.is_symlink():
        raise ConfigError("A private file cannot be a symlink.")
    fd, name = tempfile.mkstemp(prefix=".lazyfish-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def read_private(path: Path) -> str:
    flags = os.O_RDONLY | os.O_NOFOLLOW
    try:
        fd = os.open(path, flags)
    except OSError as exc:
        raise ConfigError("Cannot open private configuration file.") from exc
    with os.fdopen(fd, encoding="utf-8") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
            raise ConfigError("Private files must belong to the current user.")
        if info.st_mode & 0o077:
            raise ConfigError("Private files must have mode 600 (chmod 600 FILE).")
        if info.st_size > 128 * 1024:
            raise ConfigError("Private configuration file is too large.")
        return stream.read(128 * 1024)


def default_config() -> Path:
    root = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return root / "lazyfish" / "config.toml"


def default_data() -> Path:
    root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    return root / "lazyfish"


def config_path(value: str | None = None) -> Path:
    if explicit := value or os.environ.get("LAZYFISH_CONFIG"):
        return Path(explicit).expanduser().absolute()
    default = default_config().expanduser().absolute()
    if default.exists() or default.is_symlink():
        return default
    locator = default.parent / "installation.json"
    if not locator.exists() and not locator.is_symlink():
        return default
    try:
        record = json.loads(read_private(locator))
        target = record.get("config") if isinstance(record, dict) else None
        if not isinstance(target, str) or not target or "\x00" in target or not Path(target).is_absolute():
            raise ValueError
    except (ValueError, ConfigError) as exc:
        raise ConfigError("Cannot read saved installation path; use --config to select your configuration.") from exc
    path = Path(target)
    if not path.exists() and not path.is_symlink():
        raise ConfigError("Saved configuration is missing; restore it or use --config to select your configuration.")
    return path


def remember_config(path: Path) -> None:
    """Remember the first custom installation, without replacing another instance."""
    default = default_config().expanduser().absolute()
    path = path.expanduser().absolute()
    if path == default or default.exists() or default.is_symlink():
        return
    private_dir(default.parent)
    fd = os.open(default.parent / ".installation.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        locator = default.parent / "installation.json"
        if not locator.exists() and not locator.is_symlink():
            write_private(locator, json.dumps({"config": str(path)}, ensure_ascii=False) + "\n")
    finally:
        os.close(fd)


def _path(value: str, base: Path) -> Path:
    if not isinstance(value, str) or not value.strip() or "\x00" in value:
        raise ConfigError("Paths must be nonempty strings.")
    path = Path(value).expanduser()
    return (base / path).absolute() if not path.is_absolute() else path


SECRET_KEYS = {
    "LAZYFISH_TOKEN", "OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_HOME",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "NODE_EXTRA_CA_CERTS",
}


def read_secrets(path: Path) -> dict[str, str]:
    """A deliberately small KEY=value format, never evaluated as shell code."""
    result = {}
    for line in read_private(path).splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, sep, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if not sep or key not in SECRET_KEYS:
            raise ConfigError("Invalid key in secrets file; see docs/configuration.md.")
        if value[:1] in {"'", '"'}:
            if len(value) < 2 or value[-1] != value[0]:
                raise ConfigError("Unclosed quote in secrets file.")
            value = value[1:-1]
        if value:
            result[key] = value
    return result


@dataclass(frozen=True)
class Settings:
    config: Path
    workspace: Path
    data_dir: Path
    codex_binary: str = "codex"
    host: str = "127.0.0.1"
    port: int = 3210
    log_level: str = "INFO"
    secret_env: dict[str, str] = field(default_factory=dict, repr=False)
    token: str = field(default="", repr=False)
    model: str | None = None
    effort: str | None = None
    sandbox: str = "workspace-write"
    approval_policy: str = "on-request"
    workspace_configured: bool = True

    @property
    def runtime_dir(self) -> Path:
        return self.data_dir / "runtime"

    def prepare(self) -> None:
        for path in (self.data_dir, self.runtime_dir, self.runtime_dir / "tmp",
                     self.runtime_dir / "jobs", self.data_dir / "logs", self.data_dir / "attachments"):
            private_dir(path)


def load(path: Path) -> Settings:
    try:
        raw = tomllib.loads(read_private(path))
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError("Invalid TOML configuration.") from exc
    schema = {
        "server": {"host", "port"}, "paths": {"workspace", "data_dir"},
        "codex": {"binary", "model", "effort", "sandbox", "approval_policy"},
        "security": {"secrets_file"}, "logging": {"level"},
    }
    for section, values in raw.items():
        if section not in schema or not isinstance(values, dict) or set(values) - schema[section]:
            raise ConfigError("Unknown configuration section or key.")
    base = path.parent
    env = os.environ
    paths = raw.get("paths", {})
    workspace = env.get("LAZYFISH_WORKSPACE") or paths.get("workspace", "")
    if not isinstance(workspace, str):
        raise ConfigError("Workspace must be a directory path or empty.")
    data = _path(env.get("LAZYFISH_DATA_DIR") or paths.get("data_dir", str(default_data())), base)
    workspace_path = _path(workspace, base).resolve() if workspace else Path.home().resolve()
    if not workspace_path.is_dir():
        raise ConfigError("Workspace must be an existing directory.")
    host = env.get("LAZYFISH_HOST") or raw.get("server", {}).get("host", "127.0.0.1")
    if not _valid_bind_host(host):
        raise ConfigError("Host must be 0.0.0.0 or a unicast IPv4 address.")
    port = env.get("LAZYFISH_PORT") or raw.get("server", {}).get("port", 3210)
    try:
        if isinstance(port, bool) or not isinstance(port, (str, int)):
            raise ValueError
        port = int(port)
        if not 0 <= port <= 65535:
            raise ValueError
    except (TypeError, ValueError) as exc:
        raise ConfigError("Port must be an integer between 0 and 65535.") from exc
    binary = env.get("LAZYFISH_CODEX_BIN") or raw.get("codex", {}).get("binary", "codex")
    if not isinstance(binary, str) or not binary or "\x00" in binary:
        raise ConfigError("Codex binary must be a command name or executable path.")
    if "/" in binary:
        binary = str(_path(binary, base))
    level = env.get("LAZYFISH_LOG_LEVEL") or raw.get("logging", {}).get("level", "INFO")
    if not isinstance(level, str) or level not in {"DEBUG", "INFO", "WARNING", "ERROR"}:
        raise ConfigError("Log level must be DEBUG, INFO, WARNING or ERROR.")
    secret_file = _path(raw.get("security", {}).get("secrets_file", "secrets.env"), base)
    secret_env = read_secrets(secret_file)
    secret_env.update({key: env[key] for key in SECRET_KEYS if env.get(key)})
    token = secret_env.get("LAZYFISH_TOKEN", "")
    if len(token) < 32 or any(c.isspace() for c in token) or not token.isascii():
        raise ConfigError("LAZYFISH_TOKEN must contain at least 32 non-whitespace ASCII characters.")
    codex = raw.get("codex", {})
    model, effort = codex.get("model") or None, codex.get("effort") or None
    if model is not None and (not isinstance(model, str) or len(model) > 120 or any(c.isspace() for c in model)):
        raise ConfigError("Model must be a model identifier or an empty string for the native default.")
    if effort is not None and effort not in ("none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"):
        raise ConfigError("Unknown reasoning effort.")
    sandbox = codex.get("sandbox", "workspace-write")
    policy = codex.get("approval_policy", "on-request")
    if sandbox not in ("read-only", "workspace-write"):
        raise ConfigError("Sandbox must be read-only or workspace-write.")
    if policy not in ("on-request", "untrusted", "never"):
        raise ConfigError("Approval policy must be on-request, untrusted or never.")
    return Settings(path, workspace_path, data, binary, host, port, level, secret_env, token,
                    model, effort, sandbox, policy, bool(workspace))


def rotate_token(path: Path) -> str:
    """Replace the Web token only while this installation is stopped."""
    from . import runtime

    if os.environ.get("LAZYFISH_TOKEN"):
        raise ConfigError("LAZYFISH_TOKEN is set in the environment; unset it before rotating the file token.")
    private_dir(path.parent)
    fd = os.open(path.parent / ".init.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        settings = load(path)
        private_dir(settings.data_dir)
        private_dir(settings.runtime_dir)
        service_fd = os.open(settings.runtime_dir / "service.lock",
                             os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            message = ("Cannot rotate the token while this instance is running. "
                       "Run `lazyfish stop`, then `lazyfish token --rotate`, then `lazyfish serve`.")
            try:
                fcntl.flock(service_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise ConfigError(message) from exc
            if runtime.request(settings) is not None:
                raise ConfigError(message)
            raw = tomllib.loads(read_private(path))
            secret_file = _path(raw.get("security", {}).get("secrets_file", "secrets.env"), path.parent)
            lines = read_private(secret_file).splitlines(keepends=True)
            token = secrets.token_urlsafe(36)
            for index, line in enumerate(lines):
                key, sep, value = line.rstrip("\r\n").partition("=")
                if sep and key.strip() == "LAZYFISH_TOKEN":
                    ending = line[len(line.rstrip("\r\n")):]
                    leading = value[:len(value) - len(value.lstrip())]
                    trailing = value[len(value.rstrip()):]
                    lines[index] = key + "=" + leading + token + trailing + ending
            write_private(secret_file, "".join(lines))
            return token
        finally:
            os.close(service_fd)
    finally:
        os.close(fd)


def initialize(path: Path, workspace: str = "", data_dir: str | None = None,
               port: int = 3210, binary: str = "codex") -> Settings:
    private_dir(path.parent)
    # Concurrent installers must not rotate each other's generated credentials.
    fd = os.open(path.parent / ".init.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        return _initialize(path, workspace, data_dir, port, binary)
    finally:
        os.close(fd)


def _initialize(path: Path, workspace: str, data_dir: str | None,
                port: int, binary: str) -> Settings:
    if path.exists() or path.is_symlink():
        return load(path)  # Idempotent; never rotate an existing token.
    workspace_path = Path(workspace).expanduser().resolve() if workspace else ""
    if workspace and not workspace_path.is_dir():
        raise ConfigError("Workspace must be an existing directory.")
    if not 0 <= port <= 65535:
        raise ConfigError("Port must be between 0 and 65535.")
    data = Path(data_dir or default_data()).expanduser().absolute()
    private_dir(path.parent)
    secret_file = path.parent / "secrets.env"
    if not secret_file.exists() and not secret_file.is_symlink():
        write_private(secret_file, "# Keep this file private. Do not commit it.\nLAZYFISH_TOKEN="
                      + secrets.token_urlsafe(36) + "\n")
    quote = lambda value: json.dumps(str(value), ensure_ascii=False)
    config = (f'[server]\nhost = "127.0.0.1"\nport = {port}\n\n'
              f'[paths]\nworkspace = {quote(workspace_path)}\ndata_dir = {quote(data)}\n\n'
              f'[codex]\nbinary = {quote(binary)}\nmodel = ""\neffort = ""\n'
              'sandbox = "workspace-write"\napproval_policy = "on-request"\n\n'
              '[security]\nsecrets_file = "secrets.env"\n\n[logging]\nlevel = "INFO"\n')
    write_private(path, config)
    settings = load(path)
    settings.prepare()
    return settings
