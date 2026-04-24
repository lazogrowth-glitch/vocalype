from __future__ import annotations

from datetime import date

from brain import append_jsonl, ensure_brain_structure


def ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    value = input(f"{prompt}{suffix}: ").strip()
    return value or default


def main() -> None:
    ensure_brain_structure()
    today = date.today().isoformat()
    experiment = {
        "date": today,
        "name": ask("Experiment name"),
        "hypothesis": ask("Hypothesis"),
        "change": ask("Change"),
        "metric": ask("Metric"),
        "start_date": ask("Start date", today),
        "end_date": ask("End date"),
        "success_condition": ask("Success condition"),
        "result": "",
        "decision": "pending",
        "status": "active",
    }
    append_jsonl("data/experiments.jsonl", experiment)
    print("Added experiment to vocalype-brain/data/experiments.jsonl")


if __name__ == "__main__":
    main()
