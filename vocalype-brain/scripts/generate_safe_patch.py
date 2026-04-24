from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any

from brain import BRAIN_ROOT, append_jsonl, ensure_brain_structure, read_jsonl, read_text, write_text
from local_llm import FALLBACK_MESSAGE

try:
    from model_router import call_model_for_role
except ImportError:
    call_model_for_role = None


# ---------------------------------------------------------------------------
# Safety classification constants
# ---------------------------------------------------------------------------

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

DOCS_SAFE_PATTERNS = [
    "README",
    "CHANGELOG",
    "CONTRIBUTING",
    "LICENSE",
    ".md",
    "docs/",
]

FRONTEND_SAFE_FILES = {
    "src/App.tsx",
    "src/components/AccessibilityPermissions.tsx",
    "src/components/MachineStatusBar.tsx",
    "src/components/auth/AuthPortal.tsx",
    "src/components/onboarding/FirstRunDownload.tsx",
    "src/hooks/useAuthFlow.ts",
}

BRAIN_PREFIX = "vocalype-brain/"


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


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")[:40]


# ---------------------------------------------------------------------------
# Safety classification
# ---------------------------------------------------------------------------

def _classify_safety(files: list[str], task_type: str) -> tuple[str, str]:
    """Return (safety_class, reason).

    safety_class is one of:
      brain_safe           — only vocalype-brain/ files
      docs_safe            — only README/docs/markdown files
      product_proposal_only — product files in scope but not forbidden
      unsafe               — forbidden scope detected
    """
    if not files:
        if task_type in ("planning_only", "measurement_task"):
            return (
                "brain_safe",
                "No product files targeted. Task is planning or measurement only; "
                "changes are limited to vocalype-brain/ outputs.",
            )
        return (
            "product_proposal_only",
            "No explicit target files found. Treating as proposal only until "
            "approved files are confirmed in codex_task.md.",
        )

    # Forbidden check is highest priority
    forbidden = [f for f in files if any(pat in f for pat in FORBIDDEN_PATTERNS)]
    if forbidden:
        preview = ", ".join(forbidden[:3])
        return "unsafe", f"Target files include forbidden scope: {preview}"

    # All files inside vocalype-brain/
    brain_only = all(BRAIN_PREFIX in f or f.startswith("vocalype-brain/") for f in files)
    if brain_only:
        return "brain_safe", "All target files are inside vocalype-brain/."

    # All non-Brain files are docs-safe
    non_brain = [f for f in files if BRAIN_PREFIX not in f and not f.startswith("vocalype-brain/")]
    docs_only = all(any(pat in f for pat in DOCS_SAFE_PATTERNS) for f in non_brain)
    if docs_only:
        return "docs_safe", "Non-Brain target files are documentation or markdown only."

    # Product files in scope — check against safe set
    product = [f for f in non_brain if not any(pat in f for pat in DOCS_SAFE_PATTERNS)]
    outside_safe = [f for f in product if f not in FRONTEND_SAFE_FILES]
    if outside_safe:
        preview = ", ".join(outside_safe[:3])
        return (
            "product_proposal_only",
            f"Product files outside the approved frontend-safe set: {preview}. "
            "Proposal only — requires manual inspection before application.",
        )

    return (
        "product_proposal_only",
        "Product code is involved. Patch is a text proposal only. "
        "Requires manual approval before any file is touched.",
    )


# ---------------------------------------------------------------------------
# Task info extraction
# ---------------------------------------------------------------------------

def _parse_section_files(text: str, header: str) -> list[str]:
    """Extract '- file' lines following a section header."""
    files: list[str] = []
    in_section = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith(header):
            in_section = True
            continue
        if in_section:
            if stripped.startswith("- "):
                candidate = stripped[2:].strip()
                # Only keep file-like entries (contains a dot or slash, not prose)
                if ("." in candidate or "/" in candidate) and " " not in candidate:
                    files.append(candidate)
            elif stripped and not stripped.startswith("-"):
                in_section = False
    return files


def _extract_task_info(codex_text: str, candidates: list[dict[str, Any]]) -> dict[str, Any]:
    info: dict[str, Any] = {
        "title": "Unknown task",
        "task_type": "unknown",
        "approved_files": [],
        "summary": "",
        "validation_plan": "",
        "critic_review": "",
    }

    for line in codex_text.splitlines():
        if line.startswith("Task type:"):
            info["task_type"] = line.split(":", 1)[1].strip()
        elif line.startswith("Task title:"):
            info["title"] = line.split(":", 1)[1].strip()

    # Approved scope: section (implementation tasks)
    approved = _parse_section_files(codex_text, "Approved scope:")
    # Fallback: Files to inspect: section (measurement/planning tasks)
    if not approved:
        approved = _parse_section_files(codex_text, "Files to inspect:")

    info["approved_files"] = approved

    if candidates:
        latest = candidates[-1]
        info["title"] = latest.get("selected_title", info["title"])
        info["task_type"] = latest.get("task_type", info["task_type"])
        info["summary"] = latest.get("reason_selected", "")
        info["critic_review"] = latest.get("critic_review", "")
        info["validation_plan"] = latest.get("critic_review", "")

    return info


# ---------------------------------------------------------------------------
# Patch file generation
# ---------------------------------------------------------------------------

def _patch_file_content(
    title: str,
    safety_class: str,
    reason: str,
    target_files: list[str],
    task_type: str,
    summary: str,
    validation_plan: str,
    codex_text: str,
) -> str:
    is_proposal = safety_class == "product_proposal_only"

    lines = [
        "# Safe Patch Proposal" if is_proposal else "# Safe Patch",
        "",
        f"Title: {title}",
        f"Safety class: {safety_class}",
        f"Task type: {task_type}",
        f"Manual approval required: {'YES — do not apply without founder review' if is_proposal else 'Yes (review before applying)'}",
        "",
        "Target files:",
    ]
    for f in target_files:
        lines.append(f"- {f}")
    if not target_files:
        lines.append("- (none — Brain/docs files only)")

    lines.extend(["", "## Reason", "", summary or reason, ""])

    if is_proposal:
        lines.extend([
            "## Proposed Changes",
            "",
            "**This is a TEXT PROPOSAL ONLY.**",
            "Do not apply this patch automatically.",
            "Copy the implementation prompt below and send to Codex or Claude for review.",
            "The founder must approve the scope and validation plan before any file is modified.",
            "",
        ])
    else:
        lines.extend([
            "## Proposed Changes",
            "",
            f"Patch is `{safety_class}`. Changes are limited to non-product files.",
            "Review the target files listed above before applying.",
            "",
        ])

    lines.extend([
        "## Exact Implementation Prompt",
        "",
        "```",
        codex_text.strip() if codex_text else "(no codex task text available)",
        "```",
        "",
        "## Validation Plan",
        "",
        validation_plan or "Run the validation commands listed in the implementation prompt above.",
        "",
        "## Risks",
        "",
    ])

    if is_proposal:
        lines.extend([
            "- Product code change requires manual inspection before application.",
            "- Do not apply to auth, license, payment, backend, or Rust files.",
            "- Run `npm run lint` and manual test scenarios after applying.",
            "- Revert with `git checkout -- <file>` if validation fails.",
        ])
    else:
        lines.extend([
            "- Changes are limited to Brain/docs files.",
            "- No product behavior is affected.",
            "- Revert with `git checkout -- <file>` if needed.",
        ])

    rollback_target = " ".join(target_files) if target_files else "<changed files>"
    lines.extend([
        "",
        "## Rollback Plan",
        "",
        "```",
        f"git checkout -- {rollback_target}",
        "```",
        "",
        "## Safety Rules",
        "",
        "- Do not apply patches to backend/, src-tauri/, auth/client.ts, license/client.ts",
        "- Do not modify payment, billing, or security logic",
        "- Do not modify Rust runtime",
        "- Do not auto-commit",
        "- Do not use --no-verify",
        "- Do not deploy",
        "- Manual approval required before any product file is touched",
    ])

    return "\n".join(lines).rstrip() + "\n"


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

def _write_report(
    now: datetime,
    title: str,
    task_type: str,
    safety_class: str,
    reason: str,
    target_files: list[str],
    patch_file: str,
    status: str,
    validation_plan: str,
) -> None:
    lines = [
        "# Vocalype Brain — Safe Patch Report",
        "",
        f"Date: {now.isoformat()}",
        "",
        "## Latest Patch Candidate",
        "",
        f"- Title: {title}",
        f"- Safety class: {safety_class}",
        f"- Task type: {task_type}",
        f"- Status: {status}",
        f"- Manual approval required: Yes",
        f"- Target files: {', '.join(target_files) if target_files else 'none'}",
        f"- Reason: {reason}",
        "",
    ]

    if status == "generated":
        lines.extend([
            "## Patch File",
            "",
            f"- {patch_file}",
            "",
            "## Next Action",
            "",
        ])
        if safety_class == "product_proposal_only":
            lines.extend([
                "1. Read the patch proposal file.",
                "2. Confirm the implementation prompt matches the intended change.",
                "3. Confirm approved files do not include forbidden scope.",
                "4. Send the prompt to Codex or Claude for implementation.",
                "5. Do NOT apply automatically.",
            ])
        else:
            lines.extend([
                "1. Review the patch file.",
                "2. Apply manually if the change is correct.",
                "3. Run validation commands listed in the patch file.",
                "4. Commit only Brain/docs files after review.",
            ])
    else:
        lines.extend([
            "## Rejection Reason",
            "",
            reason,
            "",
            "## Next Action",
            "",
            "1. Review codex_task.md and narrow target files to frontend-safe scope.",
            "2. Re-run create_codex_task.py to generate a safer task.",
            "3. Re-run generate_safe_patch.py after the task is updated.",
        ])

    lines.extend([
        "",
        "## Safety Rules (always active)",
        "",
        "- No product code is modified by this script",
        "- No patch is applied automatically",
        "- Manual approval required before any product file is touched",
        "- Forbidden scope: backend/, src-tauri/, auth/client.ts, license/client.ts, payment, billing, security, translation.json",
    ])

    write_text("outputs/safe_patch_report.md", "\n".join(lines).rstrip() + "\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ensure_brain_structure()

    patches_dir = BRAIN_ROOT / "patches"
    patches_dir.mkdir(parents=True, exist_ok=True)

    codex_text = _read_optional_text("outputs/codex_task.md")
    candidates = _read_optional_jsonl("data/approved_task_candidates.jsonl")

    task_info = _extract_task_info(codex_text, candidates)
    title = task_info["title"]
    task_type = task_info["task_type"]
    approved_files = task_info["approved_files"]
    summary = task_info["summary"]
    validation_plan = task_info["validation_plan"]

    safety_class, reason = _classify_safety(approved_files, task_type)

    now = datetime.now().replace(microsecond=0)
    timestamp = now.strftime("%Y%m%d_%H%M%S")
    slug = _slug(title)
    patch_filename = f"patch_{timestamp}_{slug}.md"
    patch_path = f"vocalype-brain/patches/{patch_filename}"

    if safety_class == "unsafe":
        patch_file_written = ""
        status = "rejected"
        print(f"REJECTED — unsafe task.")
        print(f"Reason: {reason}")
    else:
        content = _patch_file_content(
            title=title,
            safety_class=safety_class,
            reason=reason,
            target_files=approved_files,
            task_type=task_type,
            summary=summary,
            validation_plan=validation_plan,
            codex_text=codex_text,
        )
        write_text(patch_path, content)
        patch_file_written = patch_path
        status = "generated"
        print(f"Generated {patch_path}")

    record: dict[str, Any] = {
        "date": now.isoformat(),
        "title": title,
        "source_task": task_type,
        "safety_class": safety_class,
        "target_files": approved_files,
        "patch_file": patch_file_written,
        "manual_approval_required": True,
        "reason": reason,
        "validation_plan": validation_plan or "See patch file.",
        "status": status,
    }
    append_jsonl("data/safe_patch_candidates.jsonl", record)

    _write_report(
        now=now,
        title=title,
        task_type=task_type,
        safety_class=safety_class,
        reason=reason,
        target_files=approved_files,
        patch_file=patch_file_written,
        status=status,
        validation_plan=validation_plan,
    )

    print("Written vocalype-brain/outputs/safe_patch_report.md")
    print(f"Safety class: {safety_class}")
    print(f"Status: {status}")


if __name__ == "__main__":
    main()
