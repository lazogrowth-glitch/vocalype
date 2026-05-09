"""generate_product_patch_proposal.py â€” V5 Product Patch Proposal Mode.

Reads Night Shift runs, the approved task, and the measurement plan to select
the best safe frontend improvement. Writes a structured proposal with a
copy-pasteable implementation prompt.

Does NOT modify product code. Does NOT apply patches.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from brain import append_jsonl, ensure_brain_structure, read_jsonl, read_text, write_text


# ---------------------------------------------------------------------------
# Safety constants
# ---------------------------------------------------------------------------

FORBIDDEN_FILE_PATTERNS = (
    "backend/",
    "src-tauri/",
    "src/lib/auth/client.ts",
    "src/lib/license/client.ts",
    "payment",
    "billing",
    "security",
    "translation.json",
    "secret_store",
    ".env",
    "secrets",
)

SENSITIVE_TERMS = (
    "auth/client",
    "license/client",
    "secret_store",
    "security",
    "payment",
    "billing",
    "runtime",
)

FRONTEND_SAFE_FILES = {
    "src/App.tsx",
    "src/components/AccessibilityPermissions.tsx",
    "src/components/MachineStatusBar.tsx",
    "src/components/auth/AuthPortal.tsx",
    "src/components/onboarding/FirstRunDownload.tsx",
    "src/hooks/useAuthFlow.ts",
    "src/lib/userFacingErrors.ts",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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


def _is_forbidden(path: str) -> bool:
    return any(pat in path for pat in FORBIDDEN_FILE_PATTERNS)


def _is_sensitive(path: str) -> bool:
    return any(term in path.lower() for term in SENSITIVE_TERMS)


def _filter_safe_files(files: list[Any]) -> list[str]:
    return [str(f) for f in files if not _is_forbidden(str(f))]


def _has_clear_product_impact(run: dict[str, Any]) -> bool:
    text = f"{run.get('focus_area','')} {run.get('problem_found','')} {run.get('why_it_matters','')}".lower()
    product_terms = ("dictation", "activation", "onboarding", "ux", "ui", "first", "license", "message", "error")
    return any(t in text for t in product_terms)


# ---------------------------------------------------------------------------
# Measurement plan option parser
# ---------------------------------------------------------------------------

def _parse_measurement_options(plan_text: str) -> list[dict[str, Any]]:
    """Parse Section 7 table rows from measure_activation_failure_points.md."""
    options: list[dict[str, Any]] = []
    in_table = False
    for line in plan_text.splitlines():
        if "Minimal Future Implementation Options" in line or "implementation options" in line.lower():
            in_table = True
            continue
        if in_table:
            # Markdown table row: | A | description | Risk | Impact | Files |
            if line.startswith("|") and not line.startswith("| ---") and not line.startswith("|---|"):
                parts = [p.strip() for p in line.split("|") if p.strip()]
                if len(parts) >= 4:
                    label = parts[0]
                    description = parts[1] if len(parts) > 1 else ""
                    risk = parts[2].lower() if len(parts) > 2 else "medium"
                    impact = parts[3].lower() if len(parts) > 3 else "medium"
                    raw_files = parts[4] if len(parts) > 4 else ""
                    # Extract file names from backtick-quoted names
                    file_names = re.findall(r"`([^`]+)`", raw_files)
                    # Map short names to full paths
                    resolved: list[str] = []
                    for fn in file_names:
                        for full in FRONTEND_SAFE_FILES:
                            if fn in full:
                                resolved.append(full)
                                break
                        else:
                            if "/" not in fn and "." in fn:
                                resolved.append(f"src/components/auth/{fn}" if "Portal" in fn else f"src/hooks/{fn}" if "use" in fn else f"src/lib/{fn}")
                            else:
                                resolved.append(fn)
                    safe_files = _filter_safe_files(resolved)
                    if label and description and safe_files:
                        score = 0
                        if "low" in risk:
                            score += 30
                        elif "medium" in risk:
                            score += 10
                        if "high" in impact:
                            score += 30
                        elif "medium" in impact:
                            score += 10
                        options.append({
                            "label": label,
                            "title": description,
                            "risk": risk.strip(),
                            "impact": impact.strip(),
                            "target_files": safe_files,
                            "score": score,
                            "source": "measurement_plan",
                        })
            elif in_table and line.startswith("**Recommended"):
                break
            elif in_table and line.startswith("##"):
                break
    return options


# ---------------------------------------------------------------------------
# Night Shift candidate builder
# ---------------------------------------------------------------------------

def _build_night_shift_candidates(runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen_titles: set[str] = set()
    candidates: list[dict[str, Any]] = []
    for run in reversed(runs[-20:]):
        title = str(run.get("focus_area", "")).strip()
        if title in seen_titles:
            continue
        seen_titles.add(title)
        all_files = [str(f) for f in run.get("files_to_review", [])]
        safe_files = _filter_safe_files(all_files)
        if not safe_files:
            continue
        if not _has_clear_product_impact(run):
            continue
        risk = str(run.get("risk", "medium")).lower()
        if risk == "high":
            continue
        score = int(run.get("priority_score", 0))
        if risk == "low":
            score += 20
        if run.get("validation_test"):
            score += 15
        candidates.append({
            "label": "",
            "title": f"Fix: {title}",
            "risk": risk,
            "impact": str(run.get("expected_impact", "medium")).lower(),
            "target_files": safe_files,
            "score": score,
            "source": "night_shift",
            "summary": str(run.get("proposed_solution", "")),
            "problem": str(run.get("problem_found", "")),
            "why_it_matters": str(run.get("why_it_matters", "")),
            "validation_test": str(run.get("validation_test", "")),
            "metric": str(run.get("metric", "")),
        })
    return candidates


# ---------------------------------------------------------------------------
# Selector
# ---------------------------------------------------------------------------

def _select_best(
    measurement_options: list[dict[str, Any]],
    night_shift_candidates: list[dict[str, Any]],
    results: list[dict[str, Any]],
) -> dict[str, Any] | None:
    # Prefer measurement plan options (they are post-analysis, more precise)
    all_candidates = measurement_options + night_shift_candidates
    if not all_candidates:
        return None

    # Penalise titles that were already implemented recently
    recent_titles = {
        str(r.get("title", r.get("summary", ""))).lower()
        for r in results[-6:]
    }

    scored: list[tuple[int, dict[str, Any]]] = []
    for c in all_candidates:
        score = c.get("score", 0)
        title_lower = c.get("title", "").lower()
        if any(rt and rt in title_lower for rt in recent_titles if len(rt) > 8):
            score -= 40
        scored.append((score, c))

    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[0][1] if scored else None


# ---------------------------------------------------------------------------
# Sensitive file check
# ---------------------------------------------------------------------------

def _check_sensitive(files: list[str]) -> tuple[bool, list[str]]:
    sensitive = [f for f in files if _is_sensitive(f)]
    return bool(sensitive), sensitive


# ---------------------------------------------------------------------------
# Implementation prompt builder
# ---------------------------------------------------------------------------

def _build_implementation_prompt(
    title: str,
    target_files: list[str],
    summary: str,
    problem: str,
    why_it_matters: str,
    validation_test: str,
    risk: str,
    rollback_files: list[str],
) -> str:
    forbidden_lines = [
        "backend/",
        "src-tauri/",
        "src/lib/auth/client.ts",
        "src/lib/license/client.ts",
        "payment or billing logic",
        "auth logic changes",
        "license validation logic",
        "Rust dictation runtime",
        "translation files",
    ]
    lines = [
        "# Mission â€” Implement Approved Vocalype Product Change",
        "",
        f"Task: {title}",
        "",
        "## Problem",
        "",
        problem or summary,
        "",
        "## Why It Matters",
        "",
        why_it_matters or "Directly improves first successful dictation and activation success rate.",
        "",
        "## Approved Scope",
        "",
    ]
    for f in target_files:
        lines.append(f"- {f}")
    lines.extend([
        "",
        "## Forbidden Scope",
        "",
    ])
    for f in forbidden_lines:
        lines.append(f"- {f}")
    lines.extend([
        "",
        "## Implementation Constraints",
        "",
        "- Keep the change small and measurable",
        "- Frontend-only â€” do not touch backend, auth client, license client, or Rust",
        "- No new dependencies",
        "- Use existing i18n keys if modifying user-facing strings, or add new keys correctly",
        "- Do not widen scope beyond the approved files above",
        "",
        "## Validation",
        "",
        f"- {validation_test}" if validation_test else "- Manual test: verify the changed UI state renders correctly in all relevant scenarios",
        "- Run: npm run lint",
        "- Manual test scenarios from outputs/measure_activation_failure_points.md Section 6",
        "",
        "## Rollback Plan",
        "",
        "```",
        "git checkout -- " + " ".join(rollback_files),
        "```",
        "",
        "## Safety Rules",
        "",
        "- Do not modify product code outside the approved scope",
        "- Do not apply unrelated patches",
        "- Do not deploy",
        "- Do not delete files",
        "- Do not use --no-verify",
        "- Do not loosen safety rules",
        "",
        "## What To Report After Implementation",
        "",
        "- Every file changed",
        "- Commands run and whether they passed",
        "- Exact UI/copy changes made",
        "- Manual test results for all activation states",
        "- Remaining risks or limitations",
    ])
    return "\n".join(lines).rstrip() + "\n"


# ---------------------------------------------------------------------------
# Report writer
# ---------------------------------------------------------------------------

def _write_report(
    now: datetime,
    title: str,
    source: str,
    target_files: list[str],
    risk: str,
    sensitive: bool,
    sensitive_files: list[str],
    summary: str,
    problem: str,
    why_it_matters: str,
    proposed_changes: list[str],
    validation_plan: str,
    rollback_plan: str,
    implementation_prompt: str,
    refused: bool,
    refusal_reason: str,
) -> None:
    lines = [
        "# Vocalype Brain â€” Product Patch Proposal",
        "",
        f"Date: {now.isoformat()}",
        "",
    ]

    if refused:
        lines.extend([
            "## Status: REFUSED",
            "",
            f"Reason: {refusal_reason}",
            "",
            "No proposal was generated. Review the Night Shift runs and quality report,",
            "then re-run once a clearer low-risk frontend task is available.",
        ])
        write_text("outputs/product_patch_proposal_report.md", "\n".join(lines).rstrip() + "\n")
        return

    lines.extend([
        "## Selected Task",
        "",
        f"**{title}**",
        f"Source: {source}",
        "",
        "## Why It Matters",
        "",
        why_it_matters or summary,
        "",
        "## Target Files",
        "",
    ])
    for f in target_files:
        lines.append(f"- `{f}`")

    lines.extend([
        "",
        f"Sensitive files involved: {'YES â€” ' + ', '.join(sensitive_files) if sensitive else 'No'}",
        f"Risk: {risk}",
        "",
        "## Proposed Changes",
        "",
    ])
    for change in proposed_changes:
        lines.append(f"- {change}")

    lines.extend([
        "",
        "## Validation Plan",
        "",
        validation_plan,
        "",
        "## Risks",
        "",
        "- Auth/activation UI is shared across all user states â€” keep changes narrow",
        "- Any user-facing string changes should use i18n keys, not hardcoded text",
        "- Do not modify auth state logic, only UI rendering and error text",
        "- Revert immediately if manual test shows regression in any activation state",
        "",
        "## Rollback Plan",
        "",
        f"```\n{rollback_plan}\n```",
        "",
        "## Human Approval Required",
        "",
        "**This proposal must be reviewed and approved by the founder before implementation.**",
        "",
        "Steps:",
        "1. Read the Exact Prompt below.",
        "2. Confirm the approved scope matches the intended change.",
        "3. Confirm the forbidden scope excludes all sensitive files.",
        "4. Copy the prompt to Codex or Claude Code for implementation.",
        "5. Review the diff before committing.",
        "6. Run lint and manual test scenarios after applying.",
        "",
        "## Exact Prompt For Claude/Codex",
        "",
        "```",
        implementation_prompt.strip(),
        "```",
    ])

    write_text("outputs/product_patch_proposal_report.md", "\n".join(lines).rstrip() + "\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ensure_brain_structure()

    runs = _read_optional_jsonl("data/night_shift_runs.jsonl")
    candidates_log = _read_optional_jsonl("data/approved_task_candidates.jsonl")
    results = _read_optional_jsonl("data/results.jsonl")
    lessons = _read_optional_text("memory/lessons_learned.md")
    mistakes = _read_optional_text("memory/mistakes.md")
    plan_text = _read_optional_text("outputs/measure_activation_failure_points.md")

    measurement_options = _parse_measurement_options(plan_text) if plan_text else []
    night_shift_candidates = _build_night_shift_candidates(runs)

    best = _select_best(measurement_options, night_shift_candidates, results)

    now = datetime.now().replace(microsecond=0)

    if best is None:
        refusal = "No suitable low-risk frontend product candidate found in Night Shift runs or measurement plan."
        record: dict[str, Any] = {
            "date": now.isoformat(),
            "title": "No proposal",
            "source": "none",
            "target_files": [],
            "risk": "unknown",
            "sensitive_files_involved": False,
            "manual_approval_required": True,
            "summary": refusal,
            "proposed_changes": [],
            "validation_plan": "",
            "rollback_plan": "",
            "status": "refused",
        }
        append_jsonl("data/product_patch_proposals.jsonl", record)
        _write_report(
            now=now, title="", source="", target_files=[], risk="", sensitive=False,
            sensitive_files=[], summary="", problem="", why_it_matters="",
            proposed_changes=[], validation_plan="", rollback_plan="",
            implementation_prompt="", refused=True, refusal_reason=refusal,
        )
        print(f"REFUSED: {refusal}")
        print("Written internal/brain/outputs/product_patch_proposal_report.md")
        return

    title = best.get("title", "Untitled")
    source = best.get("source", "unknown")
    target_files = best.get("target_files", [])
    risk = best.get("risk", "medium")
    summary = best.get("summary", best.get("title", ""))
    problem = best.get("problem", summary)
    why_it_matters = best.get("why_it_matters", "")
    validation_test = best.get("validation_test", "")

    sensitive, sensitive_files = _check_sensitive(target_files)

    # Build proposed changes list from best candidate
    proposed_changes: list[str] = []
    if "activation_failed" in title.lower() or "message" in title.lower():
        proposed_changes = [
            "Improve the `activation_failed` UI state text in AuthPortal.tsx to show a specific, actionable reason.",
            "Add a 'Retry' button that calls `onRefreshSession()` when `activationStatus === 'activation_failed'`.",
            "Update `getUserFacingErrorMessage` in userFacingErrors.ts if the error classification needs improvement.",
        ]
    elif "checking_activation" in title.lower() or "timeout" in title.lower() or "spinner" in title.lower():
        proposed_changes = [
            "Add a 15-second timeout to the `checking_activation` spinner.",
            "Show a retry CTA after timeout expires.",
        ]
    else:
        proposed_changes = [best.get("summary", "See source proposal for details.")]

    validation_plan = (
        validation_test
        or "1. Manual test: activation_failed state â€” confirm message is clear and retry button works.\n"
           "2. Manual test: checking_activation â€” confirm spinner does not hang indefinitely.\n"
           "3. Run: npm run lint\n"
           "4. Run the 10-scenario checklist in outputs/measure_activation_failure_points.md Section 6."
    )

    rollback_plan = "git checkout -- " + " ".join(target_files)

    implementation_prompt = _build_implementation_prompt(
        title=title,
        target_files=target_files,
        summary=summary,
        problem=problem,
        why_it_matters=why_it_matters,
        validation_test=validation_test,
        risk=risk,
        rollback_files=target_files,
    )

    record = {
        "date": now.isoformat(),
        "title": title,
        "source": source,
        "target_files": target_files,
        "risk": risk,
        "sensitive_files_involved": sensitive,
        "manual_approval_required": True,
        "summary": summary,
        "proposed_changes": proposed_changes,
        "validation_plan": validation_plan,
        "rollback_plan": rollback_plan,
        "status": "proposed",
    }
    append_jsonl("data/product_patch_proposals.jsonl", record)

    _write_report(
        now=now,
        title=title,
        source=source,
        target_files=target_files,
        risk=risk,
        sensitive=sensitive,
        sensitive_files=sensitive_files,
        summary=summary,
        problem=problem,
        why_it_matters=why_it_matters,
        proposed_changes=proposed_changes,
        validation_plan=validation_plan,
        rollback_plan=rollback_plan,
        implementation_prompt=implementation_prompt,
        refused=False,
        refusal_reason="",
    )

    print(f"Generated proposal: {title}")
    print(f"Source: {source}")
    print(f"Risk: {risk}")
    print(f"Target files: {', '.join(target_files)}")
    print(f"Sensitive files involved: {sensitive}")
    print("Written internal/brain/outputs/product_patch_proposal_report.md")


if __name__ == "__main__":
    main()
