from __future__ import annotations

import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from brain import (
    BRAIN_ROOT,
    append_jsonl,
    ensure_brain_structure,
    load_json,
    read_jsonl,
    read_text,
    write_text,
    score_action,
)
from context_builder import build_context
from local_llm import FALLBACK_MESSAGE, is_ollama_available
from model_router import call_model_for_role, get_model_for_role
from retrieve_context import retrieve_context


STATUS_PATH = BRAIN_ROOT / "data" / "night_shift_status.json"
STOP_REQUEST_PATH = BRAIN_ROOT / "data" / "stop_night_shift.request"


SAFE_BLOCKED_DIRS = {
    ".git",
    "node_modules",
    "dist",
    "build",
    "target",
    ".next",
    ".turbo",
    ".cache",
    "__pycache__",
}
SAFE_BLOCKED_NAMES = {
    ".env",
    ".env.local",
    ".env.development",
    ".env.production",
    ".npmrc",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "AGENTS.md",
    "CLAUDE.md",
    "AIDER.md",
}
SAFE_EXTENSIONS = {
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".rs",
    ".py",
    ".md",
    ".json",
    ".toml",
    ".css",
    ".html",
}

SYSTEM_RULES = """
Night Shift Safety Rules:
1. Never delete files.
2. Never deploy.
3. Never spend money.
4. Never publish content.
5. Never modify product code directly.
6. Never change safety settings.
7. Never run arbitrary shell commands.
8. Never read .env, secrets, credentials, node_modules, .git, target, dist, build.
9. Always require manual review for product code.
10. Keep default mode proposal_only.
""".strip()

FOCUS_AREAS = [
    {
        "name": "Performance / quality",
        "query": "performance quality latency ram crashes reliable dictation onboarding activation",
        "keywords": ["quality", "latency", "ram", "crash", "reliable", "dictation", "activation"],
        "metric": "quality_improvement_rate",
        "files_hint": ["vocalype-brain/", "src/", "src-tauri/"],
    },
    {
        "name": "First successful dictation",
        "query": "first successful dictation activation onboarding permissions paste workflow",
        "keywords": ["dictation", "transcription", "permission", "onboarding", "first", "activate"],
        "metric": "first_dictation_success_rate",
        "files_hint": ["src/", "src-tauri/"],
    },
    {
        "name": "License / activation",
        "query": "license activation auth login subscription checkout access",
        "keywords": ["license", "activation", "auth", "subscription", "checkout", "billing"],
        "metric": "activation_success_rate",
        "files_hint": ["src/", "src-tauri/"],
    },
    {
        "name": "Onboarding",
        "query": "onboarding first run download setup welcome activation",
        "keywords": ["onboarding", "first", "welcome", "download", "setup"],
        "metric": "onboarding_completion_rate",
        "files_hint": ["src/", "docs/"],
    },
    {
        "name": "Permissions",
        "query": "permissions microphone accessibility setup system permission",
        "keywords": ["permission", "permissions", "microphone", "accessibility", "privacy"],
        "metric": "permission_setup_success_rate",
        "files_hint": ["src/", "src-tauri/"],
    },
    {
        "name": "Error messages",
        "query": "error messages activation errors auth errors permission errors",
        "keywords": ["error", "errors", "message", "auth", "activation", "permission"],
        "metric": "support_contact_rate_after_error",
        "files_hint": ["src/"],
    },
    {
        "name": "Model settings",
        "query": "model settings presets accuracy latency defaults",
        "keywords": ["model", "settings", "latency", "preset", "accuracy"],
        "metric": "model_setting_change_success_rate",
        "files_hint": ["src/", "src-tauri/"],
    },
    {
        "name": "Landing page / pricing if found",
        "query": "landing page pricing checkout website hero conversion",
        "keywords": ["pricing", "landing", "checkout", "hero", "website"],
        "metric": "download_button_ctr",
        "files_hint": ["src/", "website/", "web/"],
    },
    {
        "name": "Growth / content ideas",
        "query": "growth distribution demo content hooks shorts tiktok",
        "keywords": ["growth", "content", "distribution", "demo", "hook", "tiktok"],
        "metric": "view_to_download_click_rate",
        "files_hint": ["vocalype-brain/memory/"],
    },
    {
        "name": "Test coverage",
        "query": "test coverage activation onboarding permissions auth dictation",
        "keywords": ["test", "spec", "activation", "onboarding", "auth", "dictation"],
        "metric": "critical_flow_test_coverage",
        "files_hint": ["src/", "tests/"],
    },
    {
        "name": "Documentation / support",
        "query": "documentation support help troubleshooting activation permissions",
        "keywords": ["readme", "docs", "support", "troubleshooting", "activation", "permission"],
        "metric": "support_resolution_rate",
        "files_hint": ["README", "docs/", "vocalype-brain/"],
    },
]

PROPOSAL_SCHEMA = {
    "type": "object",
    "required": [
        "problem_found",
        "why_it_matters",
        "proposed_solution",
        "files_to_review",
        "risk",
        "expected_impact",
        "validation_test",
        "metric",
        "confidence",
    ],
}

FOCUS_TO_AUDIT_TERMS = {
    "Performance / quality": ["telemetry", "dictation", "activation", "permissions", "model", "error"],
    "First successful dictation": ["dictation", "onboarding", "first-run", "activation", "permissions"],
    "License / activation": ["license", "activation", "auth", "billing", "subscription"],
    "Onboarding": ["onboarding", "first-run", "model", "permissions"],
    "Permissions": ["permissions", "accessibility", "microphone"],
    "Error messages": ["error messages", "userFacingErrors", "activation", "permission"],
    "Model settings": ["model selection", "settings", "model catalog"],
    "Landing page / pricing if found": ["website", "pricing", "landing", "billing"],
    "Growth / content ideas": ["distribution", "growth", "demo", "content"],
    "Test coverage": ["tests", "integration tests", "auth", "license", "dictation"],
    "Documentation / support": ["documentation", "support", "permissions", "activation"],
}


def _repo_root() -> Path:
    return BRAIN_ROOT.parent


def _write_status(
    *,
    running: bool,
    mode: str,
    started_at: str | None = None,
    finished_at: str | None = None,
) -> None:
    payload: dict[str, Any] = {
        "running": running,
        "pid": os.getpid() if running else None,
        "mode": mode,
    }
    if started_at:
        payload["started_at"] = started_at
    if finished_at:
        payload["finished_at"] = finished_at
    STATUS_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _stop_requested() -> bool:
    return STOP_REQUEST_PATH.exists()


def _clear_stop_request() -> None:
    if STOP_REQUEST_PATH.exists():
        STOP_REQUEST_PATH.unlink()


def _night_shift_config() -> dict[str, Any]:
    config = load_json("config/brain.config.json")
    return config.get("night_shift", {})


def _safe_repo_files() -> list[Path]:
    repo_root = _repo_root()
    results: list[Path] = []
    for path in repo_root.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(repo_root)
        parts = set(relative.parts)
        if parts & SAFE_BLOCKED_DIRS:
            continue
        if any(part.startswith(".") and part not in {".github"} for part in relative.parts):
            continue
        if path.name in SAFE_BLOCKED_NAMES:
            continue
        if path.suffix.lower() not in SAFE_EXTENSIONS and path.name != "README.md":
            continue
        results.append(path)
    return results


def _find_repo_hits(keywords: list[str], files_hint: list[str], limit: int = 6) -> list[dict[str, str]]:
    scored_hits: list[tuple[int, dict[str, str]]] = []
    repo_root = _repo_root()
    lowered_keywords = [keyword.lower() for keyword in keywords]
    for path in _safe_repo_files():
        rel = str(path.relative_to(repo_root)).replace("\\", "/")
        path_text = rel.lower()
        if files_hint and not any(hint.lower() in path_text for hint in files_hint):
            continue
        score = sum(2 for keyword in lowered_keywords if keyword in path_text)
        excerpt = ""
        if score == 0:
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            lowered = text.lower()
            for keyword in lowered_keywords:
                if keyword in lowered:
                    score += 1
                    if not excerpt:
                        index = lowered.find(keyword)
                        start = max(0, index - 80)
                        end = min(len(text), index + 220)
                        excerpt = " ".join(text[start:end].split())
        if score > 0:
            scored_hits.append((score, {"file": rel, "excerpt": excerpt}))
    scored_hits.sort(key=lambda item: (-item[0], item[1]["file"]))
    return [item for _, item in scored_hits[:limit]]


def _extract_context_files(chunks: list[dict[str, Any]]) -> list[str]:
    files: list[str] = []
    for chunk in chunks:
        file_path = str(chunk.get("file_path", ""))
        if file_path and file_path not in files:
            files.append(file_path)
    return files


def _score_proposal(cycle_result: dict[str, Any]) -> int:
    action = {
        "title": cycle_result.get("focus_area", ""),
        "problem": cycle_result.get("problem_found", ""),
        "why_it_matters": cycle_result.get("why_it_matters", ""),
        "expected_impact": cycle_result.get("expected_impact", "medium"),
        "difficulty": "easy" if cycle_result.get("risk") == "low" else "medium" if cycle_result.get("risk") == "medium" else "hard",
        "area": ", ".join(cycle_result.get("files_to_review", [])),
        "action": cycle_result.get("proposed_solution", ""),
        "validation_test": cycle_result.get("validation_test", ""),
        "metric": cycle_result.get("metric", ""),
        "urgency": cycle_result.get("expected_impact", "medium"),
    }
    return score_action(action)


def _fallback_cycle_proposal(focus: dict[str, Any], context_files: list[str], repo_hits: list[dict[str, str]]) -> dict[str, Any]:
    files_to_review = [item["file"] for item in repo_hits[:4]]
    if not files_to_review:
        files_to_review = context_files[:3]
    return {
        "problem_found": f"{focus['name']} likely contains friction that is not fully mapped into a measurable next step.",
        "why_it_matters": f"{focus['name']} directly affects {focus['metric']} and can block first successful dictation, trust, or conversion.",
        "proposed_solution": f"Audit the files linked to {focus['name']} and convert the main friction point into one small measurable change with clear user-facing copy or guidance.",
        "files_to_review": files_to_review,
        "risk": "low",
        "expected_impact": "high",
        "validation_test": f"Review the main {focus['name'].lower()} path and verify the next step is obvious in one pass.",
        "metric": focus["metric"],
        "confidence": "medium" if context_files else "low",
    }


def _parse_llm_object(text: str) -> dict[str, Any]:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _repo_audit_excerpt(focus_name: str, limit: int = 1800) -> str:
    try:
        audit = read_text("outputs/repo_audit.md")
    except FileNotFoundError:
        return ""

    terms = FOCUS_TO_AUDIT_TERMS.get(focus_name, [])
    lowered = audit.lower()
    best_index = -1
    for term in terms:
        idx = lowered.find(term.lower())
        if idx != -1 and (best_index == -1 or idx < best_index):
            best_index = idx
    if best_index == -1:
        return audit[:limit]
    start = max(0, best_index - 200)
    end = min(len(audit), best_index + limit)
    return audit[start:end]


def _focus_plan_excerpt(focus_name: str, limit: int = 900) -> str:
    try:
        plan = read_text("outputs/first_improvement_plan.md")
    except FileNotFoundError:
        return ""
    if focus_name in {"License / activation", "First successful dictation", "Onboarding", "Error messages"}:
        return plan[:limit]
    return ""


def _generate_cycle_proposal(focus: dict[str, Any], cycle: int) -> tuple[dict[str, Any], list[str]]:
    context_chunks = retrieve_context(focus["query"], top_k=5)
    context_files = _extract_context_files(context_chunks)
    repo_hits = _find_repo_hits(focus["keywords"], focus.get("files_hint", []))
    contextual_prompt = build_context(focus["query"])
    quality_observations = read_jsonl("data/quality_observations.jsonl")[-10:]
    quality_report = ""
    try:
        quality_report = read_text("outputs/quality_report.md")
    except FileNotFoundError:
        quality_report = ""
    repo_audit_excerpt = _repo_audit_excerpt(focus["name"])
    focus_plan_excerpt = _focus_plan_excerpt(focus["name"])
    repo_summary = "\n".join(
        [
            f"- file: {item['file']}" + (f"\n  excerpt: {item['excerpt']}" if item["excerpt"] else "")
            for item in repo_hits
        ]
    ) or "- No safe repo hits found."

    prompt = "\n\n".join(
        [
            contextual_prompt,
            SYSTEM_RULES,
            f"Cycle: {cycle}",
            f"Focus area: {focus['name']}",
            f"Recent quality observations:\n{json.dumps(quality_observations, indent=2)}",
            f"Latest quality report excerpt:\n{quality_report[:1200]}",
            f"Relevant repo audit excerpt:\n{repo_audit_excerpt}",
            f"Relevant existing improvement plan:\n{focus_plan_excerpt}",
            "Safe repo inspection hits:",
            repo_summary,
            "Task:",
            "Generate one concrete Night Shift proposal for Vocalype. Stay within proposal_only mode. "
            "Do not write code. Prefer one low-risk, measurable next step. Use the repo audit and file hits to stay specific. "
            "Return JSON only with: problem_found, why_it_matters, proposed_solution, files_to_review, risk, expected_impact, validation_test, metric, confidence.",
        ]
    )

    response = call_model_for_role("ceo", prompt, system=SYSTEM_RULES, schema=PROPOSAL_SCHEMA)
    parsed = _parse_llm_object(response)
    if not parsed or FALLBACK_MESSAGE in response:
        parsed = _fallback_cycle_proposal(focus, context_files, repo_hits)
    return parsed, context_files


def _build_patch_record(cycle_result: dict[str, Any]) -> dict[str, Any] | None:
    files = cycle_result.get("files_to_review", [])
    if not isinstance(files, list) or not files:
        return None

    patch_type = "product_code"
    for file_path in files:
        lowered = str(file_path).lower()
        if lowered.endswith(".md"):
            patch_type = "documentation"
            break
        if ".test." in lowered or lowered.endswith(".spec.ts") or lowered.endswith(".spec.tsx"):
            patch_type = "test"
            break

    return {
        "date": datetime.now().replace(microsecond=0).isoformat(),
        "title": f"Night Shift proposal: {cycle_result.get('focus_area', 'Untitled')}",
        "target_files": files,
        "reason": cycle_result.get("problem_found", ""),
        "patch_type": patch_type,
        "risk": cycle_result.get("risk", "medium"),
        "patch_text": cycle_result.get("proposed_solution", ""),
        "manual_review_required": True,
        "validation_test": cycle_result.get("validation_test", ""),
    }


def _report_markdown(
    cycles: list[dict[str, Any]],
    patches: list[dict[str, Any]],
    runtime_seconds: float,
    model_used: str,
    ollama_available: bool,
    mode: str,
    stopped_manually: bool = False,
) -> str:
    lines = [
        "# Vocalype Brain — Night Shift Report",
        "",
        f"Date: {datetime.now().replace(microsecond=0).isoformat()}",
        f"Mode: {mode}",
        f"Cycles completed: {len(cycles)}",
        f"Runtime: {runtime_seconds:.1f}s",
        f"Model used: {model_used}",
        f"Ollama available: {'yes' if ollama_available else 'no'}",
        "",
        "## Executive Summary",
        "",
    ]

    if cycles:
        top = sorted(cycles, key=lambda item: item.get("priority_score", 0), reverse=True)[0]
        lines.append(
            f"Night Shift reviewed {len(cycles)} Vocalype focus areas in proposal-only mode. "
            f"Top opportunity: {top.get('focus_area', 'unknown')} with score {top.get('priority_score', 0)}."
        )
    else:
        lines.append("No Night Shift cycles completed.")
    if stopped_manually:
        lines.append("Run status: stopped manually after the current cycle finished.")

    lines.extend(["", "## Work Completed", ""])
    for cycle in cycles:
        lines.extend(
            [
                f"### Cycle {cycle['cycle']} — {cycle['focus_area']}",
                "",
                f"Problem found: {cycle['problem_found']}",
                f"Why it matters: {cycle['why_it_matters']}",
                f"Proposed solution: {cycle['proposed_solution']}",
                f"Files to review: {', '.join(cycle.get('files_to_review', [])) or 'None'}",
                f"Metric: {cycle['metric']}",
                f"Validation test: {cycle['validation_test']}",
                f"Risk: {cycle['risk']}",
                f"Impact: {cycle['expected_impact']}",
                f"Priority score: {cycle['priority_score']}",
                f"Confidence: {cycle['confidence']}",
                "",
            ]
        )

    lines.extend(["## Top Opportunities Found", ""])
    for cycle in sorted(cycles, key=lambda item: item.get("priority_score", 0), reverse=True)[:5]:
        lines.append(f"- {cycle['focus_area']}: {cycle['proposed_solution']} (score {cycle['priority_score']})")

    lines.extend(["", "## Proposed Patches", ""])
    if patches:
        for patch in patches:
            lines.append(
                f"- {patch['title']} | type: {patch['patch_type']} | risk: {patch['risk']} | review required: {patch['manual_review_required']}"
            )
    else:
        lines.append("- None.")

    lines.extend(["", "## Tests Suggested", ""])
    if cycles:
        for cycle in cycles:
            lines.append(f"- {cycle['validation_test']}")
    else:
        lines.append("- None.")

    lines.extend(["", "## Risks", ""])
    if cycles:
        for cycle in cycles:
            if cycle["risk"] != "low":
                lines.append(f"- {cycle['focus_area']}: {cycle['risk']} risk")
        if all(cycle["risk"] == "low" for cycle in cycles):
            lines.append("- All proposals are low risk and remain proposal-only.")
    else:
        lines.append("- No risks recorded.")

    lines.extend(["", "## What Needs Human Approval", ""])
    if patches:
        for patch in patches:
            lines.append(f"- Review proposed patch for {', '.join(patch['target_files'])}")
    else:
        lines.append("- Any future code or docs change requires manual approval.")

    lines.extend(["", "## Recommended Next Action", ""])
    if cycles:
        top = sorted(cycles, key=lambda item: item.get("priority_score", 0), reverse=True)[0]
        lines.append(
            f"Review the top proposal for {top['focus_area']} and decide whether to turn it into a human-approved implementation task."
        )
    else:
        lines.append("Re-run Night Shift after indexing memory and adding more recent observations.")

    return "\n".join(lines).rstrip() + "\n"


def run_night_shift() -> tuple[list[dict[str, Any]], list[dict[str, Any]], str]:
    ensure_brain_structure()
    config = load_json("config/brain.config.json")
    night_config = _night_shift_config()
    if not night_config.get("enabled", True):
        raise SystemExit("Night Shift is disabled in config.")

    mode = str(night_config.get("mode", "proposal_only"))
    if mode != "proposal_only":
        mode = "proposal_only"

    max_cycles = int(night_config.get("max_cycles", 5))
    max_runtime_minutes = int(night_config.get("max_runtime_minutes", 60))
    model_used = str(get_model_for_role("ceo").get("resolved_model", config.get("local_llm", {}).get("main_model", "qwen3:8b")))
    ollama_ok = is_ollama_available()
    started_at = datetime.now().replace(microsecond=0).isoformat()
    _write_status(running=True, mode=mode, started_at=started_at)

    started = time.time()
    cycles: list[dict[str, Any]] = []
    patches: list[dict[str, Any]] = []
    stopped_manually = False

    try:
        for index, focus in enumerate(FOCUS_AREAS[:max_cycles], start=1):
            if _stop_requested():
                stopped_manually = True
                break
            elapsed_minutes = (time.time() - started) / 60
            if elapsed_minutes >= max_runtime_minutes:
                break

            proposal, context_files = _generate_cycle_proposal(focus, index)
            cycle_result = {
                "date": datetime.now().replace(microsecond=0).isoformat(),
                "cycle": index,
                "focus_area": focus["name"],
                "retrieved_context_files": context_files,
                "problem_found": str(proposal.get("problem_found", "")).strip(),
                "why_it_matters": str(proposal.get("why_it_matters", "")).strip(),
                "proposed_solution": str(proposal.get("proposed_solution", "")).strip(),
                "files_to_review": [str(item) for item in proposal.get("files_to_review", []) if str(item).strip()],
                "risk": str(proposal.get("risk", "medium")).strip().lower(),
                "expected_impact": str(proposal.get("expected_impact", "medium")).strip().lower(),
                "validation_test": str(proposal.get("validation_test", "")).strip(),
                "metric": str(proposal.get("metric", focus["metric"])).strip(),
                "priority_score": 0,
                "confidence": str(proposal.get("confidence", "medium")).strip().lower(),
                "status": "proposed",
            }
            if cycle_result["risk"] not in {"low", "medium", "high"}:
                cycle_result["risk"] = "medium"
            if cycle_result["expected_impact"] not in {"low", "medium", "high", "critical"}:
                cycle_result["expected_impact"] = "medium"
            if cycle_result["confidence"] not in {"low", "medium", "high"}:
                cycle_result["confidence"] = "medium"

            cycle_result["priority_score"] = _score_proposal(cycle_result)
            append_jsonl("data/night_shift_runs.jsonl", cycle_result)
            cycles.append(cycle_result)

            if night_config.get("allow_patch_files", True):
                patch = _build_patch_record(cycle_result)
                if patch:
                    append_jsonl("data/proposed_patches.jsonl", patch)
                    patches.append(patch)
    finally:
        runtime_seconds = time.time() - started
        report = _report_markdown(
            cycles,
            patches,
            runtime_seconds,
            model_used,
            ollama_ok,
            mode,
            stopped_manually=stopped_manually,
        )
        write_text("outputs/night_shift_report.md", report)
        _write_status(
            running=False,
            mode=mode,
            started_at=started_at,
            finished_at=datetime.now().replace(microsecond=0).isoformat(),
        )
        _clear_stop_request()
    return cycles, patches, report


def main() -> None:
    cycles, patches, _ = run_night_shift()
    print(f"Night Shift completed {len(cycles)} cycles in proposal_only mode.")
    print(f"Saved {len(patches)} proposed patches.")
    print("Report: vocalype-brain/outputs/night_shift_report.md")


if __name__ == "__main__":
    main()
