from __future__ import annotations

import json
from collections import Counter
from datetime import date
from typing import Any

from brain import ensure_brain_structure, read_jsonl, read_text, write_text, score_action
from context_builder import build_context
from local_llm import FALLBACK_MESSAGE
from model_router import call_model_for_role


QUALITY_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "required": [
            "title",
            "problem",
            "metric",
            "baseline",
            "target",
            "proposed_change",
            "files_or_areas",
            "validation_test",
            "risk",
            "expected_impact",
        ],
    },
}

BASELINES = {
    "dictation_latency_ms": ("unknown", "<500ms first useful text"),
    "ram_usage_mb": ("unknown", "<800 MB after 10 minutes"),
    "crash_free_sessions_rate": ("unknown", ">99.5%"),
    "activation_success_rate": ("unknown", ">95%"),
    "first_dictation_success_rate": ("unknown", ">85%"),
    "transcription_accuracy_rate": ("unknown", ">95% on key scenarios"),
    "permission_setup_success_rate": ("unknown", ">90%"),
    "model_setting_change_success_rate": ("unknown", ">90%"),
    "quality_signal_count": ("unknown", "down week over week"),
}


def _parse_json_list(text: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return []
    if isinstance(parsed, dict):
        parsed = parsed.get("actions", parsed.get("items", []))
    return [item for item in parsed if isinstance(item, dict)] if isinstance(parsed, list) else []


def _metric_baseline(metric: str, metrics: list[dict[str, Any]]) -> str:
    relevant = [row for row in metrics if row.get("metric") == metric]
    if not relevant:
        return BASELINES.get(metric, ("unknown", "improve"))[0]
    latest = relevant[-1]
    value = latest.get("value", "unknown")
    unit = latest.get("unit", "")
    return f"{value} {unit}".strip()


def _target_for(metric: str) -> str:
    return BASELINES.get(metric, ("unknown", "improve"))[1]


def _deterministic_actions(observations: list[dict[str, Any]], metrics: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not observations:
        return [
            {
                "title": "Measure first-run dictation latency",
                "problem": "Latency is a top product priority, but there is no recorded first-run latency baseline yet.",
                "metric": "dictation_latency_ms",
                "baseline": _metric_baseline("dictation_latency_ms", metrics),
                "target": _target_for("dictation_latency_ms"),
                "proposed_change": "Define one first-run timing method and record 5 manual measurements across the same machine and model.",
                "files_or_areas": ["quality_playbook", "manual benchmark flow", "first-run dictation path"],
                "validation_test": "Record 5 comparable first-run latency measurements with scenario notes.",
                "risk": "low",
                "expected_impact": "critical",
            }
        ]

    by_category: dict[str, list[dict[str, Any]]] = {}
    for row in observations:
        by_category.setdefault(str(row.get("category", "unknown")), []).append(row)

    actions: list[dict[str, Any]] = []
    for category, rows in sorted(by_category.items(), key=lambda item: len(item[1]), reverse=True):
        latest = rows[-1]
        metric = str(latest.get("suggested_metric", "quality_signal_count"))
        title = {
            "latency": "Create a first-run latency baseline",
            "ram": "Track RAM growth during active dictation",
            "crash": "Create a crash incident checklist",
            "activation": "Measure activation failure points",
            "onboarding": "Measure first successful dictation friction",
            "transcription": "Track transcription accuracy on key scenarios",
            "permissions": "Measure permission setup success",
            "model_settings": "Measure model preset success rate",
            "unknown": "Classify unknown quality signals",
        }.get(category, "Measure product quality risk")
        problem = f"Recent quality signals show risk in {category}: {latest.get('observation', '')}"
        proposed_change = {
            "latency": "Create a repeatable stopwatch-based test for first-run and warm-run dictation latency, then rank the slowest steps.",
            "ram": "Record RAM usage at 1, 5, and 10 minutes for one stable dictation scenario.",
            "crash": "Create a simple crash log review routine and count crash-free sessions manually until instrumentation exists.",
            "activation": "List each activation step and record where users hesitate, fail, or need support.",
            "onboarding": "Run a first-run walkthrough and note every step before first successful dictation.",
            "transcription": "Use the benchmark template to compare expected vs actual text on the top user scenarios.",
            "permissions": "Write down the exact permission flow and where the user loses confidence.",
            "model_settings": "Test whether users can choose a model preset without reading extra documentation.",
            "unknown": "Reclassify the signal and link it to one measurable metric before taking action.",
        }.get(category, "Convert this quality signal into a measurable checklist.")
        files_or_areas = {
            "latency": ["dictation path", "model startup", "first-run flow"],
            "ram": ["runtime memory usage", "long-session behavior"],
            "crash": ["crash reports", "startup flow", "dictation runtime"],
            "activation": ["auth portal", "license flow", "activation messages"],
            "onboarding": ["first-run UX", "permissions", "first dictation flow"],
            "transcription": ["benchmark templates", "model presets"],
            "permissions": ["permission UX", "setup guidance"],
            "model_settings": ["model settings UI", "presets"],
            "unknown": ["quality observation review"],
        }.get(category, ["quality review"])
        actions.append(
            {
                "title": title,
                "problem": problem,
                "metric": metric,
                "baseline": _metric_baseline(metric, metrics),
                "target": _target_for(metric),
                "proposed_change": proposed_change,
                "files_or_areas": files_or_areas,
                "validation_test": f"Capture a before/after quality check for {metric}.",
                "risk": "low" if category in {"latency", "ram", "activation", "onboarding", "permissions"} else "medium",
                "expected_impact": "critical" if category in {"latency", "crash", "activation", "onboarding"} else "high",
            }
        )
    return actions[:5]


def _llm_actions(observations: list[dict[str, Any]], metrics: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prompt = "\n\n".join(
        [
            build_context("performance quality latency ram crashes activation onboarding reliability"),
            "Generate up to 5 measurable quality actions for Vocalype.",
            "Prioritize latency, RAM, crashes, activation, onboarding, and reliable dictation.",
            "Return JSON only.",
            f"Quality observations:\n{json.dumps(observations[-20:], indent=2)}",
            f"Performance metrics:\n{json.dumps(metrics[-20:], indent=2)}",
        ]
    )
    response = call_model_for_role("ceo", prompt, system=read_text("memory/quality_playbook.md"), schema=QUALITY_SCHEMA)
    if FALLBACK_MESSAGE in response:
        return []
    return _parse_json_list(response)


def _score_quality_action(action: dict[str, Any]) -> int:
    score_payload = {
        "title": action.get("title", ""),
        "problem": action.get("problem", ""),
        "why_it_matters": action.get("problem", ""),
        "expected_impact": action.get("expected_impact", "medium"),
        "difficulty": "easy" if action.get("risk") == "low" else "medium",
        "area": ", ".join(action.get("files_or_areas", [])),
        "action": action.get("proposed_change", ""),
        "validation_test": action.get("validation_test", ""),
        "metric": action.get("metric", ""),
    }
    return score_action(score_payload)


def generate_quality_report() -> str:
    ensure_brain_structure()
    playbook = read_text("memory/quality_playbook.md")
    observations = read_jsonl("data/quality_observations.jsonl")
    metrics = read_jsonl("data/performance_metrics.jsonl")
    actions = _llm_actions(observations, metrics) or _deterministic_actions(observations, metrics)

    for action in actions:
        action["priority_score"] = _score_quality_action(action)
    actions.sort(key=lambda item: item.get("priority_score", 0), reverse=True)

    categories = Counter(str(row.get("category", "unknown")) for row in observations)
    severe = [row for row in observations if row.get("severity") in {"high", "critical"}]
    missing_metrics = sorted({row.get("suggested_metric", "") for row in observations if row.get("suggested_metric")})[:8]

    lines = [
        "# Vocalype Brain — Quality Report",
        "",
        f"Date: {date.today().isoformat()}",
        "",
        "## Executive Summary",
        "",
        f"Open quality observations: {len(observations)}. Recorded performance metrics: {len(metrics)}.",
        f"Most common quality categories: {', '.join(f'{name} ({count})' for name, count in categories.most_common(5)) or 'none'}.",
        "",
        "## Current Quality Signals",
        "",
    ]
    if observations:
        for row in observations[-10:]:
            lines.append(
                f"- [{row.get('severity', 'medium')}] {row.get('category', 'unknown')}: {row.get('observation', '')}"
            )
    else:
        lines.append("- No quality observations recorded yet.")

    lines.extend(["", "## Top Quality Risks", ""])
    if severe:
        for row in severe[:5]:
            lines.append(f"- {row.get('category', 'unknown')}: {row.get('observation', '')}")
    else:
        lines.append("- No high-severity quality observations recorded yet.")

    lines.extend(["", "## Top 5 Quality Actions", ""])
    for index, action in enumerate(actions[:5], start=1):
        lines.extend(
            [
                f"### {index}. {action.get('title', 'Untitled')}",
                "",
                f"- Problem: {action.get('problem', '')}",
                f"- Metric: {action.get('metric', '')}",
                f"- Baseline: {action.get('baseline', 'unknown')}",
                f"- Target: {action.get('target', 'improve')}",
                f"- Proposed change: {action.get('proposed_change', '')}",
                f"- Files/areas to inspect: {', '.join(action.get('files_or_areas', []))}",
                f"- Validation test: {action.get('validation_test', '')}",
                f"- Risk: {action.get('risk', 'medium')}",
                f"- Priority score: {action.get('priority_score', 0)}",
                "",
            ]
        )
    if not actions:
        lines.append("- No quality actions generated.")

    lines.extend(["## What Needs Human Approval", ""])
    lines.append("- Any product-code implementation based on these actions still requires manual review and approval.")
    lines.extend(["", "## Recommended Next Step", ""])
    if actions:
        top = actions[0]
        lines.append(
            f"Measure the baseline for {top.get('metric', 'the top risk')} first, then decide whether the proposed change should become a human-approved task."
        )
    else:
        lines.append("Add a few quality observations, then re-run the quality loop.")

    if missing_metrics:
        lines.extend(["", "<!-- Missing metrics: " + ", ".join(str(item) for item in missing_metrics) + " -->"])
    lines.extend(["", "<!-- Quality playbook loaded -->", f"<!-- Playbook length: {len(playbook)} -->"])

    report = "\n".join(lines).rstrip() + "\n"
    write_text("outputs/quality_report.md", report)
    return report


def main() -> None:
    report = generate_quality_report()
    print("Generated vocalype-brain/outputs/quality_report.md")
    print(report.splitlines()[0])


if __name__ == "__main__":
    main()
