from __future__ import annotations

import sys
from datetime import date

from brain import append_jsonl, ensure_brain_structure


def classify_feedback(text: str) -> tuple[str, str, str]:
    lowered = text.lower()
    rules = [
        (("license", "activation", "login"), "activation", "high", "Audit activation and license flow."),
        (("slow", "latency", "delay"), "performance", "medium", "Measure dictation latency and startup time."),
        (("wrong", "error", "transcription"), "transcription", "medium", "Add feedback sample to model benchmark set."),
        (("price", "expensive", "payment"), "pricing", "medium", "Review pricing clarity and upgrade objections."),
        (("confusing", "hard", "unclear"), "UX", "medium", "Simplify the confusing step and add clearer copy."),
        (("install", "download", "permission"), "onboarding", "high", "Improve install or permission instructions."),
    ]
    for keywords, category, severity, action in rules:
        if any(keyword in lowered for keyword in keywords):
            return category, severity, action
    return "general", "low", "Review feedback and convert it into a measurable Vocalype action if repeated."


def main() -> None:
    ensure_brain_structure()
    if len(sys.argv) < 2:
        raise SystemExit('Usage: python internal/brain/scripts/add_feedback.py "User feedback here"')
    feedback = " ".join(sys.argv[1:]).strip()
    category, severity, suggested_action = classify_feedback(feedback)
    append_jsonl(
        "data/feedback.jsonl",
        {
            "date": date.today().isoformat(),
            "source": "manual",
            "feedback": feedback,
            "category": category,
            "severity": severity,
            "suggested_action": suggested_action,
        },
    )
    print(f"Added feedback as {category} severity {severity}")


if __name__ == "__main__":
    main()
