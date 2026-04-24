from __future__ import annotations

from datetime import date

from brain import ensure_brain_structure, read_jsonl, write_text


def bullet(experiment: dict) -> str:
    return (
        f"- {experiment.get('name', 'Untitled')}: {experiment.get('hypothesis', '')} "
        f"| Metric: {experiment.get('metric', '')} | Decision: {experiment.get('decision', 'pending')}"
    )


def main() -> None:
    ensure_brain_structure()
    experiments = read_jsonl("data/experiments.jsonl")
    active = [item for item in experiments if item.get("status") == "active"]
    completed = [item for item in experiments if item.get("status") == "completed"]
    pending = [item for item in experiments if item.get("decision", "pending") == "pending"]
    keep = [item for item in experiments if item.get("decision") == "keep"]
    kill = [item for item in experiments if item.get("decision") == "kill"]
    iterate = [item for item in experiments if item.get("decision") == "iterate"]

    sections = [
        ("# Weekly Experiment Review", [f"Date: {date.today().isoformat()}"]),
        ("## Active Experiments", [bullet(item) for item in active] or ["- None."]),
        ("## Completed Experiments", [bullet(item) for item in completed] or ["- None."]),
        ("## Decisions Needed", [bullet(item) for item in pending] or ["- None."]),
        ("## What to Keep", [bullet(item) for item in keep] or ["- None."]),
        ("## What to Kill", [bullet(item) for item in kill] or ["- None."]),
        ("## What to Iterate", [bullet(item) for item in iterate] or ["- None."]),
    ]
    lines: list[str] = []
    for heading, body in sections:
        lines.append(heading)
        lines.append("")
        lines.extend(body)
        lines.append("")
    write_text("outputs/weekly_review.md", "\n".join(lines).rstrip() + "\n")
    print("Generated vocalype-brain/outputs/weekly_review.md")


if __name__ == "__main__":
    main()
