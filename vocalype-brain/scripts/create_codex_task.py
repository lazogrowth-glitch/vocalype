from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime
from typing import Any

from brain import append_jsonl, ensure_brain_structure, read_jsonl, read_text, write_text
from local_llm import FALLBACK_MESSAGE

try:
    from model_router import call_model_for_role
except ImportError:
    call_model_for_role = None


FRONTEND_SAFE_FILES = {
    "src/App.tsx",
    "src/components/AccessibilityPermissions.tsx",
    "src/components/MachineStatusBar.tsx",
    "src/components/auth/AuthPortal.tsx",
    "src/components/onboarding/FirstRunDownload.tsx",
    "src/hooks/useAuthFlow.ts",
}

FORBIDDEN_PATTERNS = [
    "backend/",
    "src-tauri/",
    "src/lib/auth/client.ts",
    "src/lib/license/client.ts",
    "payment",
    "billing",
    "security",
    "translation.json",
]

UI_CLARITY_TERMS = [
    "activation",
    "auth",
    "clarity",
    "error message",
    "first dictation",
    "onboarding",
    "state",
    "ui",
]

MEASUREMENT_TERMS = [
    "measure",
    "measuring",
    "measurement plan",
    "track",
    "observe",
    "failure points",
    "list failure",
    "record where users fail",
    "audit flow",
    "identify bottlenecks",
    "define metric",
    "baseline",
    "instrument",
]

PLANNING_ONLY_TERMS = [
    "clarify",
    "decide",
    "evaluate",
    "research",
    "investigate whether",
    "explore",
    "think about",
    "assess whether",
]

QUALITY_FILE_MAP = {
    "activation messages": ["src/components/auth/AuthPortal.tsx", "src/App.tsx"],
    "auth portal": ["src/components/auth/AuthPortal.tsx"],
    "first-run flow": ["src/App.tsx", "src/components/onboarding/FirstRunDownload.tsx"],
    "license flow": ["src/components/auth/AuthPortal.tsx", "src/hooks/useAuthFlow.ts"],
    "permission UX": ["src/components/AccessibilityPermissions.tsx", "src/components/auth/AuthPortal.tsx"],
}

PROMPT_SCHEMA = {
    "type": "object",
    "required": ["prompt_markdown"],
    "properties": {"prompt_markdown": {"type": "string"}},
}

CRITIC_SCHEMA = {
    "type": "object",
    "required": ["critic_review"],
    "properties": {"critic_review": {"type": "string"}},
}


def _read_optional_text(path: str) -> str:
    try:
        return read_text(path)
    except FileNotFoundError:
        return ""


def _read_optional_jsonl(path: str) -> list[dict[str, Any]]:
    try:
        return read_jsonl(path)
    except FileNotFoundError:
        return []


def _normalize_files(files: list[Any]) -> list[str]:
    normalized: list[str] = []
    for item in files:
        text = str(item).strip()
        if text and text not in normalized:
            normalized.append(text)
    return normalized


def _parse_json_object(text: str) -> dict[str, Any]:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _candidate_from_run(run: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": str(run.get("focus_area", "Untitled")).strip(),
        "summary": str(run.get("proposed_solution", "")).strip(),
        "problem": str(run.get("problem_found", "")).strip(),
        "why_it_matters": str(run.get("why_it_matters", "")).strip(),
        "files": _normalize_files(run.get("files_to_review", [])),
        "risk": str(run.get("risk", "medium")).strip().lower(),
        "priority_score": int(run.get("priority_score", 0)),
        "validation_test": str(run.get("validation_test", "")).strip(),
        "metric": str(run.get("metric", "")).strip(),
        "source": "night_shift",
        "requires_product_changes": True,
    }


def _candidate_from_patch(patch: dict[str, Any]) -> dict[str, Any]:
    patch_type = str(patch.get("patch_type", "product_code")).strip().lower()
    return {
        "title": str(patch.get("title", "Untitled")).replace("Night Shift proposal: ", "").strip(),
        "summary": str(patch.get("patch_text", "")).strip(),
        "problem": str(patch.get("reason", "")).strip(),
        "why_it_matters": str(patch.get("reason", "")).strip(),
        "files": _normalize_files(patch.get("target_files", [])),
        "risk": str(patch.get("risk", "medium")).strip().lower(),
        "priority_score": 0,
        "validation_test": str(patch.get("validation_test", "")).strip(),
        "metric": "",
        "source": "proposed_patch",
        "requires_product_changes": patch_type == "product_code",
    }


def _quality_candidates() -> list[dict[str, Any]]:
    report = _read_optional_text("outputs/quality_report.md")
    if not report:
        return []

    pattern = re.compile(
        r"### \d+\. (?P<title>.+?)\n\n"
        r"- Problem: (?P<problem>.+?)\n"
        r"- Metric: (?P<metric>.+?)\n"
        r"- Baseline: (?P<baseline>.+?)\n"
        r"- Target: (?P<target>.+?)\n"
        r"- Proposed change: (?P<change>.+?)\n"
        r"- Files/areas to inspect: (?P<files>.+?)\n"
        r"- Validation test: (?P<validation>.+?)\n"
        r"- Risk: (?P<risk>.+?)\n"
        r"- Priority score: (?P<score>\d+)",
        re.MULTILINE,
    )
    candidates: list[dict[str, Any]] = []
    for match in pattern.finditer(report):
        areas = [item.strip() for item in match.group("files").split(",") if item.strip()]
        mapped_files: list[str] = []
        for area in areas:
            mapped_files.extend(QUALITY_FILE_MAP.get(area.lower(), []))
        candidates.append(
            {
                "title": match.group("title").strip(),
                "summary": match.group("change").strip(),
                "problem": match.group("problem").strip(),
                "why_it_matters": f"Metric {match.group('metric').strip()} currently has baseline {match.group('baseline').strip()} and target {match.group('target').strip()}.",
                "files": _normalize_files(mapped_files),
                "areas": areas,
                "risk": match.group("risk").strip().lower(),
                "priority_score": int(match.group("score")),
                "validation_test": match.group("validation").strip(),
                "metric": match.group("metric").strip(),
                "source": "quality",
                "requires_product_changes": False,
            }
        )
    return candidates


def _build_candidates() -> list[dict[str, Any]]:
    runs = _read_optional_jsonl("data/night_shift_runs.jsonl")
    patches = _read_optional_jsonl("data/proposed_patches.jsonl")
    candidates: list[dict[str, Any]] = []
    for run in runs[-20:]:
        candidates.append(_candidate_from_run(run))
    for patch in patches[-20:]:
        candidates.append(_candidate_from_patch(patch))
    candidates.extend(_quality_candidates())
    return candidates


def _overlaps_recent_result(candidate: dict[str, Any], results: list[dict[str, Any]]) -> bool:
    title = f"{candidate.get('title', '')} {candidate.get('summary', '')}".lower()
    files = set(candidate.get("files", []))
    for result in reversed(results[-8:]):
        result_text = f"{result.get('title', '')} {result.get('summary', '')}".lower()
        result_files = {str(item) for item in result.get("files_changed", [])}
        if title and any(term and term in result_text for term in title.split()[:6]):
            if "activation" in title and "clarity" in result_text:
                return True
        if files and files & result_files:
            return True
    return False


def _frontend_reduction(candidate: dict[str, Any]) -> tuple[list[str], str]:
    files = candidate.get("files", [])
    safe_files = [path for path in files if path in FRONTEND_SAFE_FILES]
    if not safe_files:
        safe_files = [path for path in files if path.startswith("src/") and not any(pattern in path for pattern in FORBIDDEN_PATTERNS)]
    if not safe_files and any(term in f"{candidate.get('title', '')} {candidate.get('summary', '')}".lower() for term in UI_CLARITY_TERMS):
        safe_files = [
            "src/components/auth/AuthPortal.tsx",
            "src/App.tsx",
            "src/components/onboarding/FirstRunDownload.tsx",
        ]
    reason = (
        "Reduced scope to frontend-first work because past results show UI clarity tasks should avoid backend, auth, payment, security, and Rust files unless a concrete limitation proves they are required."
    )
    return _normalize_files(safe_files), reason


def _git_status_lines() -> list[str]:
    try:
        completed = subprocess.run(
            ["git", "status", "--short"],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    except OSError:
        return []
    if completed.returncode != 0:
        return []
    return [line.rstrip() for line in completed.stdout.splitlines() if line.strip()]


def _changed_paths() -> list[str]:
    paths: list[str] = []
    for line in _git_status_lines():
        if len(line) < 4:
            continue
        path = line[3:].strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[1].strip()
        paths.append(path.replace("\\", "/"))
    return paths


def _classify_task_type(candidate: dict[str, Any]) -> str:
    """Return 'planning_only', 'measurement_task', or 'implementation_task'."""
    text = f"{candidate.get('title', '')} {candidate.get('summary', '')} {candidate.get('problem', '')}".lower()
    if any(term in text for term in MEASUREMENT_TERMS):
        return "measurement_task"
    mode = candidate.get("mode", "implementation")
    if mode == "planning":
        return "planning_only"
    if candidate.get("risk") == "high":
        return "planning_only"
    if not candidate.get("validation_test"):
        return "planning_only"
    if any(term in text for term in PLANNING_ONLY_TERMS):
        return "planning_only"
    return "implementation_task"


def _worktree_warning(candidate: dict[str, Any]) -> str:
    changed = _changed_paths()
    if not changed:
        return ""
    product_changes = [
        path for path in changed if not path.startswith("vocalype-brain/") and not path.endswith(".bat")
    ]
    approved_files = set(candidate.get("approved_files", []))
    unrelated = [path for path in product_changes if path not in approved_files]
    if unrelated:
        preview = ", ".join(unrelated[:5])
        return (
            "Warning: the current git worktree already contains unrelated product changes. "
            f"Review those first or keep the next task narrowly scoped. Example changed files: {preview}."
        )
    return ""


def _score_candidate(
    candidate: dict[str, Any],
    *,
    mistakes: str,
    lessons: str,
    wins: str,
    results: list[dict[str, Any]],
    founder_rules: str,
    worktree_dirty: bool,
) -> int:
    score = int(candidate.get("priority_score", 0))
    risk = candidate.get("risk", "medium")
    if risk == "low":
        score += 25
    elif risk == "medium":
        score += 5
    else:
        score -= 50

    if candidate.get("validation_test"):
        score += 15
    else:
        score -= 30

    files = candidate.get("files", [])
    if candidate.get("source") == "quality":
        score += 30
    elif all(not any(pattern in path for pattern in FORBIDDEN_PATTERNS) for path in files):
        score += 20
    else:
        score -= 30

    text = f"{candidate.get('title', '')} {candidate.get('summary', '')} {candidate.get('problem', '')}".lower()
    if any(term in text for term in UI_CLARITY_TERMS) and "frontend-only" in f"{lessons} {wins}".lower():
        score += 20
    if "sensitive" in mistakes.lower() and any(any(pattern in path for pattern in FORBIDDEN_PATTERNS) for path in files):
        score -= 25
    if _overlaps_recent_result(candidate, results):
        score -= 45
    if worktree_dirty and candidate.get("requires_product_changes", False):
        score -= 20
    if "reject" in founder_rules.lower() and "unrelated" in founder_rules.lower():
        score += 5
    return score


def _critic_fallback(candidate: dict[str, Any], worktree_warning: str, scope_reason: str) -> str:
    bits = [scope_reason]
    if candidate.get("requires_product_changes", False):
        bits.append("Keep this task frontend-first and do not widen scope without concrete evidence.")
    if worktree_warning:
        bits.append(worktree_warning)
    if candidate.get("source") == "quality":
        bits.append("Prefer measurement and inspection before additional product changes.")
    return " ".join(bits)


def _critic_review(candidate: dict[str, Any], worktree_warning: str, scope_reason: str, lessons: str, mistakes: str) -> tuple[str, str]:
    fallback = _critic_fallback(candidate, worktree_warning, scope_reason)
    if call_model_for_role is None:
        return fallback, "fallback"

    prompt = "\n\n".join(
        [
            "Review this proposed Codex task for scope and safety.",
            "Return one concise critic_review string only in JSON.",
            f"Candidate:\n{json.dumps(candidate, indent=2)}",
            f"Scope reduction rationale:\n{scope_reason}",
            f"Worktree warning:\n{worktree_warning or 'none'}",
            f"Lessons learned:\n{lessons}",
            f"Mistakes to avoid:\n{mistakes}",
        ]
    )
    response = call_model_for_role("critic", prompt, schema=CRITIC_SCHEMA)
    if FALLBACK_MESSAGE in response:
        return fallback, "fallback"
    parsed = _parse_json_object(response)
    critic_review = str(parsed.get("critic_review", "")).strip()
    if not critic_review:
        return fallback, "fallback"
    return critic_review, "critic"


def _forbidden_scope_lines() -> list[str]:
    return [
        "backend/app.py",
        "src-tauri/src/security/secret_store.rs",
        "src-tauri/src/lib.rs",
        "src/lib/auth/client.ts",
        "src/lib/license/client.ts",
        "payment or billing logic",
        "auth logic",
        "license validation logic",
        "Rust dictation runtime",
        "translation files",
    ]


def _validation_commands(candidate: dict[str, Any]) -> list[str]:
    commands = []
    if any(path.endswith(".ts") or path.endswith(".tsx") for path in candidate.get("approved_files", [])):
        commands.append("npm run lint")
    if candidate.get("source") == "quality":
        commands.append("python vocalype-brain/scripts/review_quality.py")
    return commands or ["Report the safest relevant check available in the repo."]


def _manual_test_plan(candidate: dict[str, Any]) -> list[str]:
    if candidate.get("source") == "quality":
        return [
            "1. Run the described baseline measurement on the current build.",
            "2. Confirm the metric, baseline, and target are recorded clearly.",
            "3. Verify the next decision is obvious from the report.",
        ]
    metric = str(candidate.get("metric", "")).lower()
    if "activation" in metric or "dictation" in metric:
        return [
            "1. logged out",
            "2. logged in / activation checking",
            "3. inactive subscription",
            "4. valid access + first-run model setup",
            "5. app entered + first-launch hint visible",
        ]
    return [
        "1. main happy path",
        "2. blocked or error state",
        "3. regression check for adjacent UI states",
    ]


def _measurement_prompt(candidate: dict[str, Any], critic_review: str, worktree_warning: str, scope_reason: str) -> str:
    title = candidate.get("title", "Untitled")
    slug = re.sub(r"[^a-z0-9]+", "_", title.lower()).strip("_")
    output_file = f"vocalype-brain/outputs/{slug}.md"
    is_activation = "activation" in title.lower()

    lines = [
        "# Mission Codex — Measurement Plan Task",
        "",
        "Task type: measurement_task",
        "",
        f"Task title: {title}",
        "",
        "Goal:",
        f"Create a measurement plan for: {title}",
        "",
        "Do NOT modify product code.",
        "",
        f"Create: {output_file}",
        "",
    ]

    if is_activation:
        lines.extend([
            "Include in the plan:",
            "1. Activation flow steps (all states a user passes through from install to first use)",
            "2. Where users may hesitate or fail (friction points, confusing states, error conditions)",
            "3. Existing files likely involved (inspect only, do not modify)",
            "4. Proposed metrics (e.g. activation_success_rate, steps_to_first_dictation)",
            "5. Events that could be tracked later (once a plan is approved by founder)",
            "6. Manual observation checklist (what to verify without any code changes)",
            "7. Minimal future implementation options (ranked by risk and impact)",
            "8. Risks (what could go wrong with each approach)",
            "9. Recommendation for whether instrumentation is needed and what type",
        ])
    else:
        lines.extend([
            "Include in the plan:",
            "1. Flow steps relevant to this area",
            "2. Where failures or friction points likely occur",
            "3. Existing files likely involved (inspect only, do not modify)",
            "4. Proposed metrics",
            "5. Events that could be tracked later",
            "6. Manual observation checklist",
            "7. Minimal future implementation options",
            "8. Risks",
            "9. Recommendation for next step",
        ])

    lines.extend([
        "",
        "Allowed:",
        "- inspect frontend/auth flow files",
        "- inspect existing hooks/components",
        f"- write the measurement plan inside vocalype-brain/outputs/ as {output_file}",
        "",
        "Forbidden:",
        "- no product code changes",
        "- no backend changes",
        "- no auth behavior changes",
        "- no license behavior changes",
        "- no new analytics implementation yet",
        "- no event tracking implementation yet",
        "",
    ])

    if worktree_warning:
        lines.extend(["Worktree warning:", worktree_warning, ""])

    lines.extend([
        "Validation:",
        f"- File created: {output_file}",
        "- All 9 sections present",
        "- No product code was modified",
        "",
        "Safety rules:",
        "- do not apply patches",
        "- do not deploy",
        "- do not delete files",
        "- do not loosen safety rules",
        "",
        "Critic review:",
        critic_review,
        "",
        "Scope note:",
        scope_reason,
    ])
    return "\n".join(lines).rstrip() + "\n"


def _deterministic_prompt(candidate: dict[str, Any], critic_review: str, worktree_warning: str, scope_reason: str) -> str:
    approved_files = candidate.get("approved_files", [])
    files_to_inspect = approved_files or candidate.get("files", [])
    mode = candidate.get("mode", "implementation")

    if mode == "measurement":
        return _measurement_prompt(candidate, critic_review, worktree_warning, scope_reason)

    if mode == "planning":
        lines = [
            "# Mission Codex — Clarify Next Safe Vocalype Task",
            "",
            f"Task title: {candidate.get('title', 'Untitled')}",
            "",
            "Original proposal summary:",
            candidate.get("summary", ""),
            "",
            "Why it matters:",
            candidate.get("why_it_matters", ""),
            "",
        ]
        if worktree_warning:
            lines.extend(["Worktree warning:", worktree_warning, ""])
        lines.extend(
            [
                "Approved scope:",
            ]
        )
        lines.extend(f"- {item}" for item in approved_files)
        lines.extend(
            [
                "",
                "Forbidden scope:",
            ]
        )
        lines.extend(f"- {item}" for item in _forbidden_scope_lines())
        lines.extend(
            [
                "",
                "Files to inspect:",
            ]
        )
        lines.extend(f"- {item}" for item in files_to_inspect)
        lines.extend(
            [
                "",
                "Implementation constraints:",
                "- do not modify product code yet",
                "- inspect frontend first",
                "- do not touch backend/auth/payment/security/Rust unless a concrete frontend limitation proves it is required",
                "- produce a reduced implementation plan only",
                "",
                "Validation commands:",
            ]
        )
        lines.extend(f"- {item}" for item in _validation_commands(candidate))
        lines.extend(
            [
                "",
                "Manual test plan:",
            ]
        )
        lines.extend(f"- {item}" for item in _manual_test_plan(candidate))
        lines.extend(
            [
                "",
                "Rollback plan:",
                "- no rollback needed because this is planning-only",
                "",
                "Safety rules:",
                "- do not apply patches",
                "- do not deploy",
                "- do not delete files",
                "- do not loosen safety rules",
                "",
                "Critic review:",
                critic_review,
                "",
                "What to report after implementation:",
                "- the reduced scope you recommend",
                "- exact files that would be touched",
                "- why backend/auth/Rust are or are not necessary",
                "- safest next command",
            ]
        )
        return "\n".join(lines).rstrip() + "\n"

    lines = [
        "# Mission Codex — Implement Approved Vocalype Task",
        "",
        f"Task title: {candidate.get('title', 'Untitled')}",
        "",
        "Original proposal summary:",
        candidate.get("summary", ""),
        "",
        "Why it matters:",
        candidate.get("why_it_matters", ""),
        "",
    ]
    if worktree_warning:
        lines.extend(["Worktree warning:", worktree_warning, ""])
    lines.extend(["Approved scope:"])
    lines.extend(f"- {item}" for item in approved_files)
    lines.extend(
        [
            "",
            "Forbidden scope:",
        ]
    )
    lines.extend(f"- {item}" for item in _forbidden_scope_lines())
    lines.extend(
        [
            "",
            "Files to inspect:",
        ]
    )
    lines.extend(f"- {item}" for item in files_to_inspect)
    lines.extend(
        [
            "",
            "Implementation constraints:",
            "- keep the change small and measurable",
            "- inspect frontend first",
            "- do not touch backend/auth/payment/security/Rust unless a concrete frontend limitation proves it is required",
            "- no new dependencies",
            "- if current repo changes create risk, warn before expanding product scope",
            "",
            "Validation commands:",
        ]
    )
    lines.extend(f"- {item}" for item in _validation_commands(candidate))
    lines.extend(
        [
            "",
            "Manual test plan:",
        ]
    )
    lines.extend(f"- {item}" for item in _manual_test_plan(candidate))
    lines.extend(
        [
            "",
            "Rollback plan:",
            "- revert only the touched approved files",
            "- remove the change if the validation test or manual test gets worse",
            "",
            "Safety rules:",
            "- do not modify product code outside the approved scope",
            "- do not apply unrelated patches",
            "- do not deploy",
            "- do not delete files",
            "- do not loosen safety rules",
            "",
            "Critic review:",
            critic_review,
            "",
            "What to report after implementation:",
            "- every file changed",
            "- commands run and whether they passed",
            "- exact copy/UI/report changes made",
            "- manual test results",
            "- remaining risks or limitations",
            "",
            "Scope reduction note:",
            scope_reason,
        ]
    )
    return "\n".join(lines).rstrip() + "\n"


def _coder_prompt(candidate: dict[str, Any], critic_review: str, worktree_warning: str, scope_reason: str) -> tuple[str, str]:
    fallback = _deterministic_prompt(candidate, critic_review, worktree_warning, scope_reason)
    if call_model_for_role is None:
        return fallback, "fallback"

    prompt = "\n\n".join(
        [
            "Write a ready-to-send Codex task prompt in Markdown.",
            "Use these exact sections: task title, original proposal summary, why it matters, approved scope, forbidden scope, files to inspect, implementation constraints, validation commands, manual test plan, rollback plan, safety rules, what to report after implementation.",
            "Keep the scope small and practical.",
            "If the candidate mode is planning, make the prompt planning-only and say not to implement yet.",
            "If the candidate mode is measurement, make the prompt a measurement plan task: goal is to create a plan file, no product code changes, no implementation yet.",
            f"Candidate:\n{json.dumps(candidate, indent=2)}",
            f"Critic review:\n{critic_review}",
            f"Worktree warning:\n{worktree_warning or 'none'}",
            f"Scope reduction note:\n{scope_reason}",
        ]
    )
    response = call_model_for_role("coder", prompt, schema=PROMPT_SCHEMA)
    if FALLBACK_MESSAGE in response:
        return fallback, "fallback"
    parsed = _parse_json_object(response)
    prompt_markdown = str(parsed.get("prompt_markdown", "")).strip()
    required_sections = [
        "Task title:",
        "Original proposal summary:",
        "Why it matters:",
        "Approved scope:",
        "Forbidden scope:",
        "Files to inspect:",
        "Implementation constraints:",
        "Validation commands:",
        "Manual test plan:",
        "Rollback plan:",
        "Safety rules:",
        "What to report after implementation:",
    ]
    if not prompt_markdown or any(section not in prompt_markdown for section in required_sections):
        return fallback, "fallback"
    return prompt_markdown + "\n", "coder"


def _best_candidate() -> tuple[dict[str, Any], str, str, str]:
    candidates = _build_candidates()
    results = _read_optional_jsonl("data/results.jsonl")
    lessons = _read_optional_text("memory/lessons_learned.md")
    mistakes = _read_optional_text("memory/mistakes.md")
    wins = _read_optional_text("memory/wins.md")
    founder_rules = _read_optional_text("memory/founder_rules.md")

    if not candidates:
        candidate = {
            "title": "Clarify the next safe Vocalype task",
            "summary": "No approved Night Shift, patch, or quality candidate is ready yet.",
            "problem": "There is no low-risk validated candidate ready for implementation.",
            "why_it_matters": "The founder needs a narrow, measurable next step.",
            "files": [],
            "risk": "medium",
            "priority_score": 0,
            "validation_test": "Create one measurable frontend-first proposal.",
            "metric": "task_clarity_rate",
            "source": "manual",
            "requires_product_changes": False,
            "approved_files": [],
            "mode": "planning",
            "task_type": "planning_only",
        }
        return (
            candidate,
            "No Night Shift, patch, or quality candidate was available, so a planning prompt was generated instead.",
            "No scope reduction was possible because there was no implementation-ready proposal.",
            "",
        )

    worktree_dirty = bool(_changed_paths())
    scored: list[tuple[int, dict[str, Any]]] = []
    for candidate in candidates:
        score = _score_candidate(
            candidate,
            mistakes=mistakes,
            lessons=lessons,
            wins=wins,
            results=results,
            founder_rules=founder_rules,
            worktree_dirty=worktree_dirty,
        )
        candidate["selected_score"] = score
        scored.append((score, candidate))
    scored.sort(key=lambda item: item[0], reverse=True)
    top_candidate = scored[0][1]
    approved_files, scope_reason = _frontend_reduction(top_candidate)
    top_candidate["approved_files"] = approved_files
    warning = _worktree_warning(top_candidate)

    if top_candidate["selected_score"] < 25 or top_candidate.get("risk") == "high" or not top_candidate.get("validation_test"):
        task_type = _classify_task_type(top_candidate)
        top_candidate["task_type"] = task_type
        top_candidate["mode"] = "measurement" if task_type == "measurement_task" else "planning"
        return (
            top_candidate,
            "All current proposals were too risky, too vague, or not validated enough, so a planning prompt was generated instead.",
            scope_reason,
            warning,
        )

    if warning and top_candidate.get("requires_product_changes", False):
        task_type = _classify_task_type(top_candidate)
        top_candidate["task_type"] = task_type
        top_candidate["mode"] = "measurement" if task_type == "measurement_task" else "planning"
        return (
            top_candidate,
            "Selected the best candidate, but the current git worktree already contains unrelated product changes, so the generated prompt is planning-first rather than direct implementation.",
            scope_reason,
            warning,
        )

    top_candidate["mode"] = "implementation"
    task_type = _classify_task_type(top_candidate)
    if task_type == "measurement_task":
        top_candidate["mode"] = "measurement"
    elif task_type == "planning_only":
        top_candidate["mode"] = "planning"
    top_candidate["task_type"] = task_type
    return (
        top_candidate,
        "Selected because it directly improves Vocalype, scores well, has a clear validation path, and avoids repeating the last implementation lesson.",
        scope_reason,
        warning,
    )


def main() -> None:
    ensure_brain_structure()
    candidate, reason_selected, reason_scope_reduced, worktree_warning = _best_candidate()
    lessons = _read_optional_text("memory/lessons_learned.md")
    mistakes = _read_optional_text("memory/mistakes.md")

    critic_review, critic_mode = _critic_review(candidate, worktree_warning, reason_scope_reduced, lessons, mistakes)
    prompt, coder_mode = _coder_prompt(candidate, critic_review, worktree_warning, reason_scope_reduced)
    write_text("outputs/codex_task.md", prompt)

    task_type = candidate.get("task_type", "implementation_task")
    record = {
        "date": datetime.now().replace(microsecond=0).isoformat(),
        "selected_title": candidate.get("title", "Untitled"),
        "task_type": task_type,
        "source": candidate.get("source", "manual"),
        "priority_score": int(candidate.get("selected_score", candidate.get("priority_score", 0))),
        "risk": candidate.get("risk", "medium"),
        "reason_selected": reason_selected,
        "reason_scope_reduced": reason_scope_reduced,
        "critic_review": critic_review,
        "generated_prompt_path": "vocalype-brain/outputs/codex_task.md",
    }
    append_jsonl("data/approved_task_candidates.jsonl", record)

    print("Generated vocalype-brain/outputs/codex_task.md")
    print(f"Selected task: {candidate.get('title', 'Untitled')}")
    print(f"Task type: {task_type}")
    print(f"Source: {candidate.get('source', 'manual')}")
    print(f"Coder routing: {coder_mode}")
    print(f"Critic routing: {critic_mode}")


if __name__ == "__main__":
    main()
