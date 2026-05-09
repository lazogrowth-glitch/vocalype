import json
import logging
from datetime import datetime
from pathlib import Path
from typing import List


class MemoryStore:
    def __init__(self, memory_dir: Path):
        self.memory_dir = memory_dir
        self.memory_dir.mkdir(parents=True, exist_ok=True)
        self.lessons_file = memory_dir / "lessons.jsonl"

    def save_lesson(self, entry: dict) -> None:
        entry = dict(entry)
        entry["saved_at"] = datetime.now().isoformat()

        # Strip large fields before storing
        for big_key in ["baseline", "after", "plan"]:
            if big_key in entry and isinstance(entry[big_key], dict):
                entry[big_key] = _summarize_result(entry[big_key])

        with open(self.lessons_file, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, default=str) + "\n")

        logging.info("Lesson saved to memory")

    def load_recent(self, n: int = 5) -> List[dict]:
        if not self.lessons_file.exists():
            return []
        lines = self.lessons_file.read_text(encoding="utf-8").strip().splitlines()
        entries = []
        for line in lines[-n:]:
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                pass
        return entries

    def format_for_prompt(self, entries: List[dict]) -> str:
        if not entries:
            return "No previous lessons recorded."

        lines = ["## Previous Lessons"]
        for i, entry in enumerate(entries, 1):
            cycle = entry.get("cycle", "?")
            verdict = entry.get("verdict", "?")
            saved = entry.get("saved_at", "")[:10]
            lines.append(f"\n### Lesson {i} — Cycle {cycle} ({verdict}) {saved}")
            lines.append(f"**Hypothesis**: {str(entry.get('hypothesis', ''))[:250]}")
            touched = ", ".join(entry.get("files_touched", [])) or "none"
            lines.append(f"**Files touched**: {touched}")
            lines.append(f"**Lesson**: {str(entry.get('lesson', ''))[:400]}")

        return "\n".join(lines)


def _summarize_result(result: dict) -> dict:
    summary = {"label": result.get("label", ""), "all_pass": result.get("all_pass")}
    for key in ["typescript_check", "test", "benchmark", "transcription_benchmark"]:
        r = result.get(key)
        if r:
            summary[key] = r.get("status", "?")
    return summary
