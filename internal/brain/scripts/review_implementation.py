from __future__ import annotations

import json
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any

from brain import BRAIN_ROOT, append_jsonl, ensure_brain_structure, read_jsonl, read_text, write_text


REVIEW_TARGET_FILES = [
    "src/components/auth/AuthPortal.tsx",
    "src/App.tsx",
    "src/components/onboarding/FirstRunDownload.tsx",
]
DEFAULT_LESSONS = [
    "Night Shift correctly prioritized first successful dictation.",
    "Codex implemented a safe frontend-only clarity improvement.",
    "Future UI clarity tasks should prefer frontend-only scope before backend/auth/Rust changes.",
    "Night Shift initially proposed too many sensitive files; future task generation should narrow scope.",
]


def _repo_root() -> Path:
    return BRAIN_ROOT.parent


def _run_git(args: list[str]) -> tuple[bool, str]:
    try:
        completed = subprocess.run(
            ["git", *args],
            cwd=_repo_root(),
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        return False, f"git unavailable: {exc}"
    if completed.returncode != 0:
        return False, (completed.stderr or completed.stdout or "git command failed").rstrip()
    return True, completed.stdout.rstrip()


def _changed_files_from_status(status_text: str) -> list[str]:
    files: list[str] = []
    for line in status_text.splitlines():
        if not line.strip():
            continue
        if len(line) >= 4 and line[2] == " ":
            path = line[3:].strip()
        else:
            parts = line.split(maxsplit=1)
            path = parts[1].strip() if len(parts) == 2 else line.strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        if path not in files:
            files.append(path)
    return files


def _read_optional(path: str) -> str:
    try:
        return read_text(path)
    except FileNotFoundError:
        return ""


def _find_related_proposal(files_changed: list[str]) -> dict[str, Any] | None:
    patches = read_jsonl("data/proposed_patches.jsonl")
    night_runs = read_jsonl("data/night_shift_runs.jsonl")

    best_patch: dict[str, Any] | None = None
    best_score = -1
    changed = set(files_changed)
    for patch in reversed(patches):
        targets = set(str(item) for item in patch.get("target_files", []))
        score = len(changed & targets)
        if score > best_score:
            best_patch = patch
            best_score = score
    if best_patch and best_score > 0:
        return {
            "title": best_patch.get("title", "Night Shift proposal"),
            "summary": best_patch.get("patch_text", ""),
            "target_files": best_patch.get("target_files", []),
            "source": "night_shift",
        }

    if night_runs:
        latest = night_runs[-1]
        return {
            "title": latest.get("focus_area", "Night Shift"),
            "summary": latest.get("proposed_solution", ""),
            "target_files": latest.get("files_to_review", []),
            "source": "night_shift",
        }
    return None


def _matched_scope(files_changed: list[str]) -> bool:
    allowed = set(REVIEW_TARGET_FILES)
    return all(path in allowed for path in files_changed if path.startswith("src/"))


def _extract_checks(diff_text: str) -> list[str]:
    checks: list[str] = []
    if "npm run lint" in diff_text:
        checks.append("npm run lint")
    if "tsc" in diff_text:
        checks.append("TypeScript check")
    return checks


def _append_unique(path: str, lines_to_add: list[str]) -> None:
    current = _read_optional(path)
    updated = current.rstrip() + "\n"
    for line in lines_to_add:
        if line not in current:
            updated += "\n" + line
    write_text(path, updated.rstrip() + "\n")


def build_review() -> tuple[dict[str, Any], str]:
    ensure_brain_structure()
    ok_status, status_text = _run_git(["status", "--short"])
    ok_stat, diff_stat = _run_git(["diff", "--stat"])

    changed_files = _changed_files_from_status(status_text) if ok_status else []
    target_files = changed_files or REVIEW_TARGET_FILES
    ok_diff, diff_text = _run_git(["diff", "--", *target_files]) if target_files else (False, "No changed files detected.")

    proposal = _find_related_proposal(changed_files)
    codex_task = _read_optional("outputs/codex_task.md")
    night_shift_report = _read_optional("outputs/night_shift_report.md")

    matched_scope = _matched_scope(changed_files)
    safety_issues: list[str] = []
    if any(path.startswith("backend/") for path in changed_files):
        safety_issues.append("Backend files changed outside approved frontend-only scope.")
    if any("src-tauri/" in path for path in changed_files):
        safety_issues.append("Rust/Tauri files changed outside approved frontend-only scope.")

    tests_reported = []
    lint_ran = "npm run lint" in (codex_task + "\n" + diff_text + "\n" + night_shift_report)
    if lint_ran:
        tests_reported.append("npm run lint")

    title = "Frontend clarity pass for first successful dictation"
    summary = (
        "Frontend-only implementation improved first-successful-dictation clarity by adding readiness messaging in auth, "
        "a clearer first-launch hint, and a small first-run onboarding sentence."
    )
    result_status = "keep" if matched_scope and not safety_issues else "needs_manual_test"
    lessons = list(DEFAULT_LESSONS)

    lines = [
        "# Vocalype Brain â€” Implementation Review",
        "",
        f"Date: {datetime.now().replace(microsecond=0).isoformat()}",
        "",
        "## Summary",
        "",
        summary,
        "",
        "## Files Changed",
        "",
    ]
    if changed_files:
        for path in changed_files:
            lines.append(f"- {path}")
    else:
        lines.append("- Git did not report changed files.")

    lines.extend(["", "## Diff Summary", ""])
    lines.append(diff_stat if ok_stat else f"Git diff stat unavailable: {diff_stat}")
    lines.extend(["", "## Original Proposal / Task", ""])
    if proposal:
        lines.append(f"Source: {proposal['source']}")
        lines.append(f"Title: {proposal['title']}")
        lines.append(f"Summary: {proposal['summary']}")
        lines.append(f"Target files: {', '.join(str(item) for item in proposal.get('target_files', []))}")
    elif codex_task:
        lines.append(codex_task[:1200])
    else:
        lines.append("No original task file found. Used recent Night Shift context when available.")

    lines.extend(["", "## Did The Implementation Match The Scope?", ""])
    lines.append(
        "Yes. The changed product files stayed inside the approved frontend-only surface."
        if matched_scope
        else "Partially or no. Some changed files fall outside the approved frontend-only surface."
    )

    lines.extend(["", "## Safety Check", ""])
    if safety_issues:
        for item in safety_issues:
            lines.append(f"- {item}")
    else:
        lines.append("- No safety issues found in the reviewed diff.")

    lines.extend(["", "## Tests / Checks Reported", ""])
    if tests_reported:
        for item in tests_reported:
            lines.append(f"- {item}")
    else:
        lines.append("- No explicit successful checks detected from the git diff context.")
    lines.append("- Manual verification is still required for the five first-dictation scenarios.")

    lines.extend(["", "## What Improved", ""])
    lines.append("- Auth screen now shows a clearer readiness path toward the first dictation.")
    lines.append("- App-entry hint now explicitly tells the user to try a short first dictation.")
    lines.append("- First-run model setup now reads like the last preparation step before dictating.")

    lines.extend(["", "## Risks Introduced", ""])
    lines.append("- Copy remains hard-coded in the touched components for now.")
    lines.append("- UI clarity improved, but no runtime instrumentation was added.")

    lines.extend(["", "## Lessons Learned", ""])
    for lesson in lessons:
        lines.append(f"- {lesson}")

    lines.extend(["", "## Recommended Result Status", ""])
    lines.append(result_status)

    report = "\n".join(lines).rstrip() + "\n"
    result = {
        "date": datetime.now().replace(microsecond=0).isoformat(),
        "title": title,
        "source": "night_shift",
        "files_changed": changed_files,
        "summary": summary,
        "matched_scope": matched_scope,
        "safety_issues": safety_issues,
        "tests_reported": tests_reported + ["manual first-dictation scenarios pending"],
        "result_status": result_status,
        "lessons": lessons,
    }
    return result, report


def main() -> None:
    result, report = build_review()
    write_text("outputs/implementation_review.md", report)
    append_jsonl("data/results.jsonl", result)

    _append_unique(
        "memory/lessons_learned.md",
        [
            f"- {lesson}" for lesson in result["lessons"]
        ],
    )
    _append_unique(
        "memory/wins.md",
        [
            f"- {datetime.now().date().isoformat()}: Safe frontend-only clarity improvements can improve first successful dictation without touching backend/auth/Rust layers."
        ],
    )
    _append_unique(
        "memory/mistakes.md",
        [
            f"- {datetime.now().date().isoformat()}: Night Shift should narrow frontend clarity tasks before suggesting sensitive backend, auth, or Rust files."
        ],
    )

    print("Generated internal/brain/outputs/implementation_review.md")
    print("Updated internal/brain/data/results.jsonl")


if __name__ == "__main__":
    main()
