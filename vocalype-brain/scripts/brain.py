from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any


BRAIN_ROOT = Path(__file__).resolve().parents[1]

REQUIRED_DIRS = [
    "config",
    "memory",
    "agents",
    "schemas",
    "scripts",
    "data",
    "outputs",
]

REQUIRED_FILES = {
    "data/actions.jsonl": "",
    "data/feedback.jsonl": "",
    "data/experiments.jsonl": "",
    "data/benchmarks.jsonl": "",
    "data/decisions.jsonl": "",
    "data/memory_index.jsonl": "",
    "data/tool_calls.jsonl": "",
    "data/self_improvements.jsonl": "",
    "data/night_shift_runs.jsonl": "",
    "data/proposed_patches.jsonl": "",
    "data/quality_observations.jsonl": "",
    "data/performance_metrics.jsonl": "",
    "data/results.jsonl": "",
    "data/approved_task_candidates.jsonl": "",
    "outputs/daily_actions.md": "# Vocalype Brain - Daily Actions\n\nNo report generated yet.\n",
    "outputs/weekly_review.md": "# Weekly Experiment Review\n\nNo review generated yet.\n",
    "outputs/product_report.md": "# Product Report\n\nNo report generated yet.\n",
    "outputs/growth_report.md": "# Growth Report\n\nNo report generated yet.\n",
    "outputs/model_report.md": "# Model Report\n\nNo report generated yet.\n",
    "outputs/improvement_proposals.md": "# Vocalype Brain - Improvement Proposals\n\nNo proposals generated yet.\n",
    "outputs/night_shift_report.md": "# Vocalype Brain - Night Shift Report\n\nNo report generated yet.\n",
    "outputs/quality_report.md": "# Vocalype Brain - Quality Report\n\nNo report generated yet.\n",
    "outputs/implementation_review.md": "# Vocalype Brain - Implementation Review\n\nNo review generated yet.\n",
    "outputs/results_report.md": "# Vocalype Brain - Results Report\n\nNo report generated yet.\n",
    "outputs/codex_task.md": "# Codex Task\n\nNo task generated yet.\n",
}

FOCUS_TERMS = [
    "vocalype",
    "dictation",
    "transcription",
    "speech",
    "voice",
    "model",
    "license",
    "activation",
    "onboarding",
    "download",
    "pricing",
    "payment",
    "conversion",
    "trial",
    "privacy",
    "offline",
    "paste",
    "settings",
    "permission",
    "content",
    "distribution",
    "benchmark",
    "user",
    "ux",
    "bug",
]


def resolve_path(path: str | Path) -> Path:
    path = Path(path)
    if path.is_absolute():
        return path
    if path.parts and path.parts[0] == BRAIN_ROOT.name:
        return BRAIN_ROOT.parent / path
    return BRAIN_ROOT / path


def load_json(path: str | Path) -> Any:
    target = resolve_path(path)
    with target.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def save_json(path: str | Path, data: Any) -> None:
    target = resolve_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def read_text(path: str | Path) -> str:
    target = resolve_path(path)
    return target.read_text(encoding="utf-8")


def write_text(path: str | Path, text: str) -> None:
    target = resolve_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


def append_jsonl(path: str | Path, obj: dict[str, Any]) -> None:
    target = resolve_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(obj, ensure_ascii=False) + "\n")


def read_jsonl(path: str | Path) -> list[dict[str, Any]]:
    target = resolve_path(path)
    if not target.exists():
        return []
    rows: list[dict[str, Any]] = []
    with target.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                value = json.loads(stripped)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSONL in {target} line {line_number}: {exc}") from exc
            if isinstance(value, dict):
                rows.append(value)
            else:
                raise ValueError(f"Invalid JSONL in {target} line {line_number}: expected object")
    return rows


def ensure_brain_structure() -> None:
    for directory in REQUIRED_DIRS:
        (BRAIN_ROOT / directory).mkdir(parents=True, exist_ok=True)
    for relative_path, default_text in REQUIRED_FILES.items():
        target = BRAIN_ROOT / relative_path
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(default_text, encoding="utf-8")


def load_memory_files() -> dict[str, str]:
    memory_dir = BRAIN_ROOT / "memory"
    memory: dict[str, str] = {}
    if not memory_dir.exists():
        return memory
    for path in sorted(memory_dir.glob("*.md")):
        memory[path.stem] = path.read_text(encoding="utf-8")
    return memory


def _text_for_scoring(action: dict[str, Any]) -> str:
    values: list[str] = []
    for key in ["title", "problem", "why_it_matters", "area", "action", "validation_test", "metric"]:
        value = action.get(key, "")
        if isinstance(value, list):
            values.extend(str(item) for item in value)
        else:
            values.append(str(value))
    return " ".join(values).lower()


def score_action(action: dict[str, Any]) -> int:
    scoring = load_json("config/scoring.config.json")
    impact = str(action.get("expected_impact", action.get("impact", "low"))).lower()
    difficulty = str(action.get("difficulty", "medium")).lower()
    urgency = str(action.get("urgency", impact)).lower()

    text = _text_for_scoring(action)
    if action.get("rejected") or not any(term in text for term in FOCUS_TERMS):
        action["rejected"] = True
        action["priority_score"] = 0
        return 0

    score = scoring["impact_weights"].get(impact, 10)
    score += scoring["urgency_bonus"].get(urgency, 0)
    score -= scoring["difficulty_penalty"].get(difficulty, 15)

    if "first successful dictation" in text or "first dictation" in text:
        score += 25
    if "payment conversion" in text or "upgrade conversion" in text or "trial-to-paid" in text or "checkout" in text:
        score += 20
    if "distribution" in text or "content" in text or "tiktok" in text or "short-form" in text:
        score += 15
    if not str(action.get("metric", "")).strip() or not str(action.get("validation_test", "")).strip():
        score -= 50

    action["priority_score"] = max(0, int(score))
    return action["priority_score"]


def format_action_markdown(action: dict[str, Any], rank: int | None = None) -> str:
    title = action.get("title", "Untitled action")
    heading = f"### {rank}. {title}" if rank is not None else f"### {title}"
    return "\n".join(
        [
            heading,
            "",
            f"Agent: {action.get('agent', 'unknown')}",
            f"Impact: {action.get('expected_impact', action.get('impact', 'unknown'))}",
            f"Difficulty: {action.get('difficulty', 'unknown')}",
            f"Priority score: {action.get('priority_score', 0)}",
            "",
            f"Problem: {action.get('problem', '')}",
            f"Why it matters: {action.get('why_it_matters', '')}",
            f"Expected business impact: {action.get('expected_business_impact', action.get('expected_impact', ''))}",
            f"Files or areas affected: {action.get('area', '')}",
            f"Proposed action: {action.get('action', '')}",
            f"Validation test: {action.get('validation_test', '')}",
            f"Metric to measure: {action.get('metric', '')}",
            "",
            "---",
            "",
        ]
    )


def generate_daily_report(actions: list[dict[str, Any]]) -> str:
    today = date.today().isoformat()
    scored = [dict(action) for action in actions]
    for action in scored:
        score_action(action)

    accepted = [action for action in scored if not action.get("rejected") and action.get("priority_score", 0) > 0]
    accepted.sort(key=lambda item: item.get("priority_score", 0), reverse=True)
    top_actions = accepted[:5]

    low_priority = [
        action for action in scored if action.get("rejected") or action.get("priority_score", 0) < 40
    ][:10]

    lines = [
        "# Vocalype Brain - Daily Actions",
        "",
        f"Date: {today}",
        "",
        "## Top 5 Actions",
        "",
    ]
    if top_actions:
        for index, action in enumerate(top_actions, start=1):
            lines.append(format_action_markdown(action, index).rstrip())
            lines.append("")
    else:
        lines.append("No measurable Vocalype actions found. Add actions to `data/actions.jsonl`.")
        lines.append("")

    lines.extend(["## Rejected / Low Priority", ""])
    if low_priority:
        for action in low_priority:
            decision = "Rejected" if action.get("rejected") else "Low priority"
            lines.append(f"- {decision}: {action.get('title', 'Untitled')} (score {action.get('priority_score', 0)})")
    else:
        lines.append("- None.")

    return "\n".join(lines).rstrip() + "\n"


def save_actions(actions: list[dict[str, Any]], path: str | Path = "data/actions.jsonl") -> None:
    target = resolve_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:
        for action in actions:
            handle.write(json.dumps(action, ensure_ascii=False) + "\n")
