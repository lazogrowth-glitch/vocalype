import logging
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Tuple


def timestamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def setup_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)s | %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )


def run_command(
    cmd: str,
    cwd: Path = None,
    timeout: int = 120,
) -> Tuple[int, str, str]:
    """Run a shell command. Returns (returncode, stdout, stderr)."""
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            cwd=str(cwd) if cwd else None,
            timeout=timeout,
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return -1, "", f"Command timed out after {timeout}s: {cmd}"
    except Exception as exc:
        return -1, "", f"Command exception: {exc}"
