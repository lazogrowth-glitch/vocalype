from __future__ import annotations

from collections import Counter
from datetime import date

from brain import ensure_brain_structure, read_jsonl, read_text, write_text


def main() -> None:
    ensure_brain_structure()
    results = read_jsonl("data/results.jsonl")
    lessons = read_text("memory/lessons_learned.md")
    wins = read_text("memory/wins.md")
    mistakes = read_text("memory/mistakes.md")

    recent = results[-5:]
    statuses = Counter(str(item.get("result_status", "unknown")) for item in results)
    lesson_lines = [line.strip("- ").strip() for line in lessons.splitlines() if line.startswith("- ")]
    win_lines = [line.strip("- ").strip() for line in wins.splitlines() if line.startswith("- ")]
    mistake_lines = [line.strip("- ").strip() for line in mistakes.splitlines() if line.startswith("- ")]

    lines = [
        "# Vocalype Brain â€” Results Report",
        "",
        f"Date: {date.today().isoformat()}",
        "",
        "## Recent Results",
        "",
    ]
    if recent:
        for result in recent:
            lines.append(
                f"- {result.get('date', '')}: {result.get('title', 'Untitled')} -> {result.get('result_status', 'unknown')}"
            )
    else:
        lines.append("- No recorded results yet.")

    lines.extend(["", "## Repeated Wins", ""])
    if win_lines:
        for line in win_lines[-5:]:
            lines.append(f"- {line}")
    else:
        lines.append("- None yet.")

    lines.extend(["", "## Repeated Mistakes", ""])
    if mistake_lines:
        for line in mistake_lines[-5:]:
            lines.append(f"- {line}")
    else:
        lines.append("- None yet.")

    lines.extend(["", "## Top Lessons", ""])
    if lesson_lines:
        for line in lesson_lines[-5:]:
            lines.append(f"- {line}")
    else:
        lines.append("- None yet.")

    lines.extend(["", "## Recommended Changes to Night Shift Behavior", ""])
    lines.append("- Prefer frontend-only scope first for UI clarity tasks.")
    lines.append("- Narrow proposed files to the smallest safe surface before suggesting implementation.")
    lines.append("- Keep quality and activation observations attached to the next proposal.")

    lines.extend(["", "## Recommended Next Action", ""])
    if statuses.get("needs_manual_test", 0) > 0:
        lines.append("- Run the pending manual test scenarios before approving the result as keep.")
    elif statuses.get("revise", 0) > 0:
        lines.append("- Re-scope the latest implementation and run review_implementation.py again after the next patch.")
    else:
        lines.append('- Ask Brain which approved implementation should be reviewed next.')

    report = "\n".join(lines).rstrip() + "\n"
    write_text("outputs/results_report.md", report)
    print("Generated internal/brain/outputs/results_report.md")


if __name__ == "__main__":
    main()
