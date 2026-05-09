import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict

from utils import run_command, timestamp

_CHECK_KEYS = ["typescript_check", "test", "benchmark", "transcription_benchmark"]


class BenchmarkRunner:
    def __init__(self, config: dict, repo_root: Path, data_dir: Path):
        self.commands: Dict[str, str] = config.get("commands", {})
        self.repo_root = repo_root
        self.runs_dir = data_dir / "runs"
        self.runs_dir.mkdir(parents=True, exist_ok=True)

    def run_all(self, label: str = "baseline") -> Dict:
        results: Dict = {
            "timestamp": datetime.now().isoformat(),
            "label": label,
            "all_pass": True,
        }

        for key in _CHECK_KEYS:
            cmd = self.commands.get(key, "").strip()
            if not cmd:
                results[key] = {"status": "skipped", "cmd": ""}
                continue

            logging.info(f"Running {key}: {cmd}")
            code, stdout, stderr = run_command(cmd, cwd=self.repo_root, timeout=300)

            passed = code == 0
            results[key] = {
                "status": "pass" if passed else "fail",
                "cmd": cmd,
                "returncode": code,
                "stdout": stdout[-3000:] if stdout else "",
                "stderr": stderr[-2000:] if stderr else "",
            }

            if not passed:
                results["all_pass"] = False
                logging.warning(f"{key} FAILED (exit {code})")

        run_file = self.runs_dir / f"{timestamp()}_{label}.json"
        run_file.write_text(json.dumps(results, indent=2), encoding="utf-8")
        logging.info(f"Run saved: {run_file.name}")

        return results

    def format_summary(self, results: Dict) -> str:
        label = results.get("label", "?")
        lines = [f"### Benchmark Summary — {label}"]

        for key in _CHECK_KEYS:
            r = results.get(key)
            if r is None:
                continue
            status = r.get("status", "?")
            cmd = r.get("cmd", "")
            suffix = f" (`{cmd}`)" if cmd else " (not configured)"
            lines.append(f"- **{key}**: {status}{suffix}")
            if status == "fail":
                stderr = r.get("stderr", "")[-500:].strip()
                if stderr:
                    lines.append(f"  ```\n  {stderr}\n  ```")

        overall = "PASS" if results.get("all_pass") else "FAIL"
        lines.append(f"- **overall**: {overall}")
        return "\n".join(lines)

    def has_any_real_benchmark(self) -> bool:
        for key in ["benchmark", "transcription_benchmark"]:
            if self.commands.get(key, "").strip():
                return True
        return False
