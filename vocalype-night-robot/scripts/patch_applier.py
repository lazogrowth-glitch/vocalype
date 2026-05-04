import logging
import re
from pathlib import Path
from typing import List, Tuple

from utils import run_command, timestamp


def _extract_diff(text: str) -> str:
    """Strip markdown fences and return only the unified diff portion."""
    # Remove ```diff or ``` fences
    text = re.sub(r"```(?:diff|patch)?\s*\n?", "", text)
    text = text.replace("```", "")
    text = text.strip()

    # Find where the diff starts
    for marker in ("--- a/", "--- /dev/null", "diff --git"):
        idx = text.find(marker)
        if idx != -1:
            return text[idx:]

    return text


class PatchApplier:
    def __init__(self, repo_root: Path, patches_dir: Path):
        self.repo_root = repo_root
        self.patches_dir = patches_dir
        self.patches_dir.mkdir(parents=True, exist_ok=True)

    def save_diff(self, diff: str, cycle: int) -> Path:
        patch_file = self.patches_dir / f"{timestamp()}_cycle_{cycle}.diff"
        patch_file.write_text(diff, encoding="utf-8")
        logging.info(f"Patch saved: {patch_file.name}")
        return patch_file

    def apply(self, raw_diff: str, cycle: int) -> Tuple[bool, str]:
        diff = _extract_diff(raw_diff)

        if len(diff.strip()) < 20:
            return False, "Diff is empty or too short to apply."

        patch_file = self.save_diff(diff, cycle)

        # Dry-run first
        code, stdout, stderr = run_command(
            f'git apply --check "{patch_file}"',
            cwd=self.repo_root,
        )
        if code != 0:
            return False, f"Patch check (dry-run) failed:\n{stderr.strip()}"

        # Real apply
        code, stdout, stderr = run_command(
            f'git apply "{patch_file}"',
            cwd=self.repo_root,
        )
        if code != 0:
            return False, f"Patch apply failed:\n{stderr.strip()}"

        logging.info("Patch applied successfully")
        return True, "ok"

    def rollback_files(self, files: List[str]) -> bool:
        all_ok = True
        for f in files:
            code, _, stderr = run_command(
                f'git checkout -- "{f}"',
                cwd=self.repo_root,
            )
            if code != 0:
                logging.error(f"Rollback failed for {f}: {stderr.strip()}")
                all_ok = False
            else:
                logging.info(f"Rolled back: {f}")
        return all_ok
