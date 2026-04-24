from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from add_feedback import classify_feedback
from brain import (
    BRAIN_ROOT,
    append_jsonl,
    ensure_brain_structure,
    generate_daily_report,
    read_jsonl,
    read_text,
    resolve_path,
    save_actions,
    score_action,
    write_text,
)


SAFE_MEMORY_NAMES = {
    "product_knowledge",
    "founder_rules",
    "competitors",
    "user_feedback",
    "experiments",
    "decisions",
    "distribution_log",
    "model_benchmarks",
    "growth_playbook",
    "saas_playbook",
    "model_playbook",
    "mistakes",
    "wins",
}


def _summarize(value: Any) -> str:
    text = str(value)
    return text if len(text) <= 180 else text[:177] + "..."


def log_tool_call(tool: str, args: dict[str, Any], result_summary: str, status: str) -> None:
    ensure_brain_structure()
    append_jsonl(
        "data/tool_calls.jsonl",
        {
            "date": datetime.now().replace(microsecond=0).isoformat(),
            "tool": tool,
            "args": args,
            "result_summary": result_summary,
            "status": status,
        },
    )


def _memory_path(name: str) -> Path:
    normalized = name.replace(".md", "").strip()
    if normalized not in SAFE_MEMORY_NAMES:
        raise ValueError(f"Memory file '{name}' is not allowed.")
    return BRAIN_ROOT / "memory" / f"{normalized}.md"


def _safe_jsonl_path(path: str) -> str:
    normalized = path.replace("\\", "/").strip()
    allowed = {
        "data/actions.jsonl",
        "data/feedback.jsonl",
        "data/experiments.jsonl",
        "data/benchmarks.jsonl",
        "data/decisions.jsonl",
        "data/self_improvements.jsonl",
        "data/tool_calls.jsonl",
    }
    if normalized.startswith("vocalype-brain/"):
        normalized = normalized[len("vocalype-brain/") :]
    if normalized not in allowed:
        raise ValueError(f"JSONL path '{path}' is not allowed.")
    return normalized


def read_memory_file(name: str) -> str:
    try:
        content = _memory_path(name).read_text(encoding="utf-8")
        log_tool_call("read_memory_file", {"name": name}, f"Read {len(content)} characters", "success")
        return content
    except Exception as exc:
        log_tool_call("read_memory_file", {"name": name}, str(exc), "error")
        raise


def write_memory_file(name: str, content: str) -> dict[str, Any]:
    try:
        target = _memory_path(name)
        target.write_text(content, encoding="utf-8")
        result = {"path": str(target.relative_to(BRAIN_ROOT)), "bytes": len(content.encode("utf-8"))}
        log_tool_call("write_memory_file", {"name": name}, _summarize(result), "success")
        return result
    except Exception as exc:
        log_tool_call("write_memory_file", {"name": name}, str(exc), "error")
        raise


def append_jsonl_tool(path: str, obj: dict[str, Any]) -> dict[str, Any]:
    try:
        safe_path = _safe_jsonl_path(path)
        append_jsonl(safe_path, obj)
        result = {"path": safe_path, "appended": True}
        log_tool_call("append_jsonl_tool", {"path": path, "obj": obj}, _summarize(result), "success")
        return result
    except Exception as exc:
        log_tool_call("append_jsonl_tool", {"path": path}, str(exc), "error")
        raise


def read_actions() -> list[dict[str, Any]]:
    try:
        actions = read_jsonl("data/actions.jsonl")
        log_tool_call("read_actions", {}, f"Read {len(actions)} actions", "success")
        return actions
    except Exception as exc:
        log_tool_call("read_actions", {}, str(exc), "error")
        raise


def save_action(action: dict[str, Any]) -> dict[str, Any]:
    try:
        score_action(action)
        append_jsonl("data/actions.jsonl", action)
        result = {"title": action.get("title", ""), "priority_score": action.get("priority_score", 0)}
        log_tool_call("save_action", {"action": action}, _summarize(result), "success")
        return result
    except Exception as exc:
        log_tool_call("save_action", {"action": action}, str(exc), "error")
        raise


def score_actions_tool() -> list[dict[str, Any]]:
    try:
        actions = read_jsonl("data/actions.jsonl")
        for action in actions:
            score_action(action)
        save_actions(actions)
        log_tool_call("score_actions_tool", {}, f"Scored {len(actions)} actions", "success")
        return actions
    except Exception as exc:
        log_tool_call("score_actions_tool", {}, str(exc), "error")
        raise


def generate_daily_report_tool() -> str:
    try:
        actions = score_actions_tool()
        report = generate_daily_report(actions)
        write_text("outputs/daily_actions.md", report)
        log_tool_call("generate_daily_report_tool", {}, "Generated outputs/daily_actions.md", "success")
        return report
    except Exception as exc:
        log_tool_call("generate_daily_report_tool", {}, str(exc), "error")
        raise


def add_feedback_tool(feedback_text: str) -> dict[str, Any]:
    try:
        category, severity, suggested_action = classify_feedback(feedback_text)
        obj = {
            "date": datetime.now().date().isoformat(),
            "source": "orchestrator",
            "feedback": feedback_text,
            "category": category,
            "severity": severity,
            "suggested_action": suggested_action,
        }
        append_jsonl("data/feedback.jsonl", obj)
        log_tool_call("add_feedback_tool", {"feedback_text": feedback_text}, _summarize(obj), "success")
        return obj
    except Exception as exc:
        log_tool_call("add_feedback_tool", {"feedback_text": feedback_text}, str(exc), "error")
        raise


def create_experiment_tool(experiment_obj: dict[str, Any]) -> dict[str, Any]:
    try:
        experiment = dict(experiment_obj)
        experiment.setdefault("date", datetime.now().date().isoformat())
        experiment.setdefault("decision", "pending")
        experiment.setdefault("status", "active")
        append_jsonl("data/experiments.jsonl", experiment)
        log_tool_call("create_experiment_tool", {"experiment_obj": experiment_obj}, _summarize(experiment), "success")
        return experiment
    except Exception as exc:
        log_tool_call("create_experiment_tool", {"experiment_obj": experiment_obj}, str(exc), "error")
        raise


def propose_repo_audit_task() -> dict[str, Any]:
    action = {
        "agent": "product_agent",
        "title": "Audit Vocalype repo for activation, dictation, onboarding, model settings, and errors",
        "problem": "Vocalype Brain recommendations are weaker until they are mapped to the actual product code areas.",
        "why_it_matters": "Repo-aware tasks reduce vague advice and improve implementation speed.",
        "expected_impact": "high",
        "difficulty": "medium",
        "urgency": "high",
        "area": "repo audit, product code mapping",
        "suggested_files": ["vocalype-brain/outputs/repo_audit.md"],
        "action": "Create a repo audit report listing relevant files, risks, opportunities, tests, and top tasks.",
        "validation_test": "Report identifies the main files for activation, dictation start, model settings, onboarding, errors, and landing/pricing.",
        "metric": "repo_audit_coverage_rate",
    }
    result = save_action(action)
    log_tool_call("propose_repo_audit_task", {}, _summarize(result), "success")
    return action
