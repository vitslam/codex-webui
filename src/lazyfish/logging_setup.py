"""Private rotating logs, deliberately excluding request and native CLI payloads."""

import logging
from logging.handlers import RotatingFileHandler
import re

from .config import Settings


class Redactor(logging.Filter):
    def __init__(self, secrets: list[str]):
        super().__init__()
        self.secrets = sorted((value for value in secrets if value), key=len, reverse=True)

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        for value in self.secrets:
            message = message.replace(value, "[redacted]")
        record.msg = re.sub(r"\bsk-[A-Za-z0-9_-]+", "[redacted]", message)
        record.args = ()
        return True


def setup(settings: Settings) -> logging.Logger:
    logger = logging.getLogger("lazyfish")
    logger.setLevel(settings.log_level)
    logger.propagate = False
    for handler in logger.handlers[:]:
        handler.close()
        logger.removeHandler(handler)
    path = settings.data_dir / "logs" / "lazyfish.log"
    if path.is_symlink():
        raise ValueError("Log file cannot be a symlink.")
    handler = RotatingFileHandler(path, maxBytes=1024 * 1024, backupCount=3, encoding="utf-8")
    path.chmod(0o600)
    handler.addFilter(Redactor(list(settings.secret_env.values())))
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(handler)
    return logger
