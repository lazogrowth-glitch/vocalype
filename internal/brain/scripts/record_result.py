from __future__ import annotations

from datetime import datetime

from brain import append_jsonl, ensure_brain_structure


def _ask(prompt: str) -> str:
    return input(f"{prompt}: ").strip()


def main() -> None:
    ensure_brain_structure()
    title = _ask("title")
    completed = _ask("was implementation completed? yes/no")
    files_changed = _ask("files changed (comma-separated)")
    tests_run = _ask("tests run")
    tests_passed = _ask("tests passed? yes/no/unknown")
    manual_test_passed = _ask("manual test passed? yes/no/unknown")
    metric_affected = _ask("metric affected")
    baseline = _ask("baseline")
    result_value = _ask("result")
    status = _ask("keep/revise/rollback/needs_manual_test")
    lesson = _ask("lesson learned")

    row = {
        "date": datetime.now().replace(microsecond=0).isoformat(),
        "title": title,
        "source": "manual",
        "completed": completed.lower() == "yes",
        "files_changed": [item.strip() for item in files_changed.split(",") if item.strip()],
        "tests_run": [item.strip() for item in tests_run.split(",") if item.strip()],
        "tests_passed": tests_passed,
        "manual_test_passed": manual_test_passed,
        "metric_affected": metric_affected,
        "baseline": baseline,
        "result": result_value,
        "result_status": status,
        "lessons": [lesson] if lesson else [],
    }
    append_jsonl("data/results.jsonl", row)
    print("Recorded result in internal/brain/data/results.jsonl")


if __name__ == "__main__":
    main()
