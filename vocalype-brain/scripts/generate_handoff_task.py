"""generate_handoff_task.py — V6 Product Implementation Handoff Loop.

Reads the latest approved product patch proposal, validates all safety gates,
extracts read-only code context from target files, and writes a self-contained
handoff_task.md ready to send to Claude Code, Codex, or Aider.

Does NOT modify product code. Does NOT apply any patch. Does NOT call any model.
Dry-run by default — pass --approve to write output files.
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from brain import (
    BRAIN_ROOT,
    append_jsonl,
    ensure_brain_structure,
    load_json,
    read_jsonl,
    write_text,
)


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

# Maximum lines extracted per product file to keep context manageable
CONTEXT_MAX_LINES = 80

# Project root (parent of vocalype-brain)
PROJECT_ROOT = BRAIN_ROOT.parent

FORBIDDEN_WRITE_PREFIXES = ("src", "src-tauri", "backend")


# ---------------------------------------------------------------------------
# Stop-condition helpers
# ---------------------------------------------------------------------------

def _is_forbidden(path: str) -> bool:
    return any(pat in path for pat in FORBIDDEN_FILE_PATTERNS)


def _is_sensitive(path: str) -> bool:
    return any(term in path.lower() for term in SENSITIVE_TERMS)


def _is_vague(proposed_changes: list[Any]) -> bool:
    """Return True if the proposed_changes list is empty or too generic."""
    if not proposed_changes:
        return True
    vague_markers = ("improve", "update", "fix", "change", "enhance", "refactor")
    specific_enough = False
    for change in proposed_changes:
        text = str(change).lower()
        # A change is specific if it mentions a file, a state name, a component, a function,
        # or a concrete UI element — not just a generic verb with no noun.
        if any(c in text for c in (".", "tsx", "ts", "component", "hook", "state",
                                    "button", "message", "error", "label", "icon",
                                    "activat", "license", "session", "dictation")):
            specific_enough = True
            break
    if not specific_enough:
        # Fallback: if every change is only a short vague phrase
        for change in proposed_changes:
            if len(str(change).split()) > 8:
                specific_enough = True
                break
    return not specific_enough


# ---------------------------------------------------------------------------
# Read-only product file reader (NEVER writes)
# ---------------------------------------------------------------------------

def _read_product_file_safe(rel_path: str) -> tuple[bool, str]:
    """Read a product file read-only. Returns (success, content_or_error)."""
    resolved = (PROJECT_ROOT / rel_path).resolve()

    # Belt-and-suspenders: confirm it is inside PROJECT_ROOT, not BRAIN_ROOT writes
    try:
        resolved.relative_to(PROJECT_ROOT)
    except ValueError:
        return False, f"Path escapes project root: {rel_path}"

    # Absolutely never open for writing
    first_part = Path(rel_path).parts[0] if Path(rel_path).parts else ""
    if first_part in FORBIDDEN_WRITE_PREFIXES:
        pass  # reading is allowed; writing is blocked at the write_text call site

    if not resolved.exists():
        return False, f"File not found: {rel_path}"

    try:
        lines = resolved.read_text(encoding="utf-8").splitlines()
        excerpt = lines[:CONTEXT_MAX_LINES]
        suffix = f"\n... ({len(lines) - CONTEXT_MAX_LINES} more lines not shown)" if len(lines) > CONTEXT_MAX_LINES else ""
        return True, "\n".join(excerpt) + suffix
    except Exception as exc:  # noqa: BLE001
        return False, f"Cannot read {rel_path}: {exc}"


# ---------------------------------------------------------------------------
# Benchmark scope classifier
# ---------------------------------------------------------------------------

def _build_benchmark_scope(proposal: dict[str, Any]) -> dict[str, bool]:
    """Determine which V7 benchmark dimensions apply to this change."""
    text = (
        " ".join(str(v) for v in proposal.get("proposed_changes", []))
        + " "
        + str(proposal.get("summary", ""))
        + " "
        + str(proposal.get("title", ""))
    ).lower()

    return {
        "latency": any(t in text for t in ("latency", "dictation", "inference", "model load", "paste")),
        "ram": any(t in text for t in ("ram", "memory", "buffer", "cache")),
        "transcription_quality": any(t in text for t in ("transcription", "error", "wer", "accuracy", "quality")),
        "activation_stability": any(t in text for t in ("activation", "license", "session", "onboard", "permission", "ready", "state")),
    }


# ---------------------------------------------------------------------------
# Task classifier
# ---------------------------------------------------------------------------

def _classify_task(
    proposal: dict[str, Any],
    gate_failure: str,
    context_readable: bool,
) -> str:
    """Return one of: planning_only / measurement_task / proposal_task / implementation_task."""
    if gate_failure:
        return "planning_only"

    text = (str(proposal.get("title", "")) + " " + str(proposal.get("summary", ""))).lower()
    measurement_terms = ("measure", "audit", "observe", "baseline", "checklist", "investigate", "track")
    if any(t in text for t in measurement_terms):
        return "measurement_task"

    if not context_readable:
        return "proposal_task"

    if _is_vague(proposal.get("proposed_changes", [])):
        return "planning_only"

    return "implementation_task"


# ---------------------------------------------------------------------------
# Safety gate evaluator
# ---------------------------------------------------------------------------

def _run_safety_gates(
    proposal: dict[str, Any],
    applied_patches: list[dict[str, Any]],
    config: dict[str, Any],
) -> str:
    """Run all 9 safety gates. Return empty string if all pass, or a STOP message."""

    # G1 — proposal must exist (caller already checked non-empty list, but defensive)
    if not proposal:
        return "STOP: no product proposals found — run generate_product_patch_proposal.py first"

    # G2 — status must be "proposed"
    status = proposal.get("status", "")
    if status != "proposed":
        return f'STOP: proposal status is "{status}" — only "proposed" proposals can be handed off'

    # G3 — manual_approval_required must be true
    if not proposal.get("manual_approval_required", False):
        return "STOP: proposal missing manual approval flag — do not hand off without founder confirmation"

    # G4 — risk must not be high
    risk = str(proposal.get("risk", "high")).lower()
    if risk == "high":
        return "STOP: proposal risk is HIGH — founder must narrow scope before handoff"

    # G5 — no sensitive files
    if proposal.get("sensitive_files_involved", True):
        return "STOP: sensitive files detected in proposal — requires explicit founder approval"

    # G6 — target files must be defined
    target_files = proposal.get("target_files", [])
    if not target_files:
        return "STOP: no target files in proposal — return to measure → propose cycle"

    # G7 — forbidden patterns (string check)
    for f in target_files:
        if _is_forbidden(str(f)):
            return f"STOP: forbidden file in scope: {f} — remove from target_files and re-propose"

    # G7b — forbidden patterns (absolute path check)
    for f in target_files:
        resolved = (PROJECT_ROOT / f).resolve()
        first_part = resolved.parts[len(PROJECT_ROOT.resolve().parts)] if len(resolved.parts) > len(PROJECT_ROOT.resolve().parts) else ""
        if first_part in ("backend", "src-tauri"):
            return f"STOP: forbidden file in scope: {f} — remove from target_files and re-propose"

    # G8 — deduplication against applied_patches (applied status only)
    applied_titles = {
        str(p.get("title", "")).lower()
        for p in applied_patches
        if p.get("status") == "applied"
    }
    proposal_title = str(proposal.get("title", "")).lower()
    for applied_title in applied_titles:
        if applied_title and applied_title in proposal_title:
            applied_date = next(
                (p.get("date", "?") for p in applied_patches
                 if str(p.get("title", "")).lower() == applied_title and p.get("status") == "applied"),
                "?",
            )
            return f"STOP: this patch was already applied ({applied_date}) — verify current state before re-applying"

    # G10 — brain config safety key
    safety = config.get("safety", {})
    if "allow_product_code_modifications" not in safety:
        return "STOP: brain config missing safety key — do not proceed"

    # G11 — safety key must be false
    if safety.get("allow_product_code_modifications") is True:
        return "STOP: safety config anomaly — allow_product_code_modifications must be false"

    # G9 — target files must be readable (checked last — file I/O)
    for f in target_files:
        ok, _ = _read_product_file_safe(str(f))
        if not ok:
            return f"STOP: cannot read target file {f} — verify path and permissions"

    return ""


# ---------------------------------------------------------------------------
# Handoff task document builder
# ---------------------------------------------------------------------------

def _build_handoff_task_md(
    now: datetime,
    proposal: dict[str, Any],
    task_type: str,
    gate_failure: str,
    file_contexts: dict[str, str],
    benchmark_scope: dict[str, bool],
) -> str:
    title = proposal.get("title", "Unknown")
    risk = proposal.get("risk", "unknown")
    target_files: list[str] = proposal.get("target_files", [])
    proposed_changes: list[Any] = proposal.get("proposed_changes", [])
    summary = proposal.get("summary", "")
    why_it_matters = proposal.get("why_it_matters", "Directly improves first successful dictation and activation success rate.")
    validation_plan = proposal.get("validation_plan", "Run npm run lint and manual test all activation states.")
    rollback_plan = proposal.get("rollback_plan", "git checkout -- " + " ".join(target_files))

    lines: list[str] = [
        "# Vocalype — Implementation Handoff Task",
        "",
        f"Date: {now.isoformat()}",
        f"Proposal: {title}",
        f"Task type: {task_type}",
        f"Risk: {risk}",
        "Safety class: product_proposal_only",
        "",
        "---",
        "",
    ]

    # --- planning_only / refused output ---
    if task_type == "planning_only":
        lines.extend([
            "## Status: PLANNING ONLY",
            "",
            f"**Stop reason:** {gate_failure or 'Proposed changes too vague — return to measure → diagnose → propose cycle.'}",
            "",
            "This handoff task cannot be sent to an implementation model yet.",
            "",
            "## Recommended Next Steps",
            "",
            "1. Review the stop reason above.",
            "2. Return to `outputs/measure_activation_failure_points.md` Section 6 and complete manual observations.",
            "3. Re-run `generate_product_patch_proposal.py` after narrowing scope.",
            "4. Re-run `generate_handoff_task.py --approve` once a specific, low-risk proposal exists.",
        ])
        return "\n".join(lines).rstrip() + "\n"

    # --- measurement_task output ---
    if task_type == "measurement_task":
        lines.extend([
            "## Status: MEASUREMENT TASK",
            "",
            "This proposal requires data collection before implementation.",
            "Complete the manual checklist in `outputs/measure_activation_failure_points.md` Section 6 first.",
            "",
            "## Measurement Instructions",
            "",
            "1. Open the app in each activation state (logged_out, checking_activation, subscription_inactive, activation_failed, ready).",
            "2. Record what the user sees in each state.",
            "3. Record whether each state has an actionable next step visible.",
            "4. Add observations to `data/quality_observations.jsonl`.",
            "5. Re-run `generate_product_patch_proposal.py` and then `generate_handoff_task.py --approve`.",
        ])
        return "\n".join(lines).rstrip() + "\n"

    # --- proposal_task output ---
    if task_type == "proposal_task":
        lines.extend([
            "## Status: PROPOSAL TASK",
            "",
            "Target files could not be read or scope is not yet narrow enough.",
            "Refine the proposal before generating an implementation handoff.",
            "",
            "## Refinement Instructions",
            "",
            "1. Verify target files exist in the repo.",
            "2. Narrow the proposed_changes to a single, specific UI change.",
            "3. Re-run `generate_product_patch_proposal.py` to update the proposal.",
            "4. Re-run `generate_handoff_task.py --approve`.",
        ])
        return "\n".join(lines).rstrip() + "\n"

    # --- implementation_task — full handoff document ---
    lines.extend([
        "## Problem Statement",
        "",
        summary or title,
        "",
        "## Why It Matters",
        "",
        why_it_matters,
        "",
        "## Approved Scope",
        "",
        "Files the implementation model is allowed to modify:",
        "",
    ])
    for f in target_files:
        lines.append(f"- `{f}`")

    lines.extend([
        "",
        "## Forbidden Scope",
        "",
        "Files and patterns the implementation model must never touch:",
        "",
        "- `backend/`",
        "- `src-tauri/`",
        "- `src/lib/auth/client.ts`",
        "- `src/lib/license/client.ts`",
        "- payment or billing logic",
        "- auth state logic (do not modify `deriveActivationStatus` or auth reducers)",
        "- license validation logic",
        "- Rust dictation runtime",
        "- `translation.json` / i18n files (add new keys only via correct key registration)",
        "",
        "## Existing Code Context",
        "",
        "The following excerpts are extracted read-only from the current codebase.",
        "Do not add lines that contradict what you see here.",
        "",
    ])
    for f, context in file_contexts.items():
        lines.extend([
            f"### `{f}` — Current Structure",
            "",
            "```tsx" if f.endswith(".tsx") else "```ts",
            context,
            "```",
            "",
        ])

    lines.extend([
        "## Implementation Instructions",
        "",
    ])
    if proposed_changes:
        for i, change in enumerate(proposed_changes, 1):
            lines.append(f"{i}. {change}")
    else:
        lines.append("1. See proposal summary above for guidance.")

    lines.extend([
        "",
        "## Constraints",
        "",
        "- Keep the change small and measurable",
        "- Frontend-only — do not touch backend, auth client, license client, or Rust",
        "- No new dependencies",
        "- Use existing i18n keys if modifying user-facing strings; register new keys correctly",
        "- Do not widen scope beyond the approved files above",
        "- One logical change per commit",
        "",
        "## Validation",
        "",
        validation_plan,
        "",
        "- `npm run lint`",
        "- `npm run format`",
        "- Manual test: all 5 activation states (logged_out, checking_activation, subscription_inactive, activation_failed, ready)",
        "- Manual test scenarios from `outputs/measure_activation_failure_points.md` Section 6",
        "",
        "## Rollback Plan",
        "",
        "```",
        rollback_plan,
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
        "- Every file changed (path + brief description)",
        "- Commands run and whether they passed",
        "- Exact UI/copy changes made",
        "- Manual test results for all activation states",
        "- Remaining risks or limitations",
        "- Suggested follow-up measurement task",
        "",
        "## Benchmark Baseline (V7 will populate)",
        "",
        "V7 will measure these metrics before and after implementation.",
        "Do not run benchmarks now — these are placeholders only.",
        "",
        "| Metric | Before | After |",
        "|---|---|---|",
    ])

    if benchmark_scope.get("latency"):
        lines.append("| dictation_latency_ms | unknown | unknown |")
    if benchmark_scope.get("ram"):
        lines.append("| idle_ram_mb | unknown | unknown |")
        lines.append("| ram_during_transcription_mb | unknown | unknown |")
    if benchmark_scope.get("transcription_quality"):
        lines.append("| transcription_error_rate | unknown | unknown |")
    if benchmark_scope.get("activation_stability"):
        lines.append("| activation_success_rate | unknown | unknown |")
        lines.append("| activation_failed_rate | unknown | unknown |")

    lines.append("")
    return "\n".join(lines).rstrip() + "\n"


# ---------------------------------------------------------------------------
# Planning-only handoff document (used on gate failure)
# ---------------------------------------------------------------------------

def _build_planning_only_md(now: datetime, proposal: dict[str, Any], stop_reason: str) -> str:
    title = proposal.get("title", "Unknown") if proposal else "Unknown"
    lines = [
        "# Vocalype — Implementation Handoff Task",
        "",
        f"Date: {now.isoformat()}",
        f"Proposal: {title}",
        "Task type: planning_only",
        "Risk: n/a",
        "Safety class: refused",
        "",
        "---",
        "",
        "## Status: REFUSED",
        "",
        f"**{stop_reason}**",
        "",
        "No implementation handoff was generated.",
        "",
        "## Recommended Next Steps",
        "",
        "1. Read the stop reason above.",
        "2. Return to `outputs/measure_activation_failure_points.md` Section 6.",
        "3. Re-run `generate_product_patch_proposal.py` once the issue is resolved.",
        "4. Re-run `generate_handoff_task.py --approve`.",
    ]
    return "\n".join(lines).rstrip() + "\n"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(approve: bool = False) -> None:
    ensure_brain_structure()

    now = datetime.now().replace(microsecond=0)
    divider = "=" * 60
    print(divider)
    print("Vocalype Brain — V6 Generate Handoff Task")
    print(divider)

    # --- Load inputs ---
    proposals = read_jsonl("data/product_patch_proposals.jsonl")
    applied_patches = read_jsonl("data/applied_patches.jsonl")

    try:
        config = load_json("config/brain.config.json")
    except FileNotFoundError:
        config = {}

    if not proposals:
        stop = "STOP: no product proposals found — run generate_product_patch_proposal.py first"
        print(f"\n{stop}")
        if approve:
            write_text("outputs/handoff_task.md", _build_planning_only_md(now, {}, stop))
            append_jsonl("data/handoff_tasks.jsonl", {
                "date": now.isoformat(), "title": "", "task_type": "planning_only",
                "status": "refused", "stop_reason": stop,
                "target_files": [], "risk": "unknown",
                "benchmark_scope": {}, "approve": approve,
            })
        print(divider)
        sys.exit(1)

    proposal = proposals[-1]
    title = proposal.get("title", "Unknown")
    target_files: list[str] = proposal.get("target_files", [])
    risk = proposal.get("risk", "unknown")

    print(f"\nLatest proposal : {title}")
    print(f"Status          : {proposal.get('status', 'unknown')}")
    print(f"Risk            : {risk}")
    print(f"Target files    : {', '.join(target_files) or 'none'}")

    # --- Run safety gates ---
    gate_failure = _run_safety_gates(proposal, applied_patches, config)

    if gate_failure:
        print(f"\n{gate_failure}")
        task_type = "planning_only"
        handoff_md = _build_planning_only_md(now, proposal, gate_failure)
        record: dict[str, Any] = {
            "date": now.isoformat(),
            "title": title,
            "task_type": task_type,
            "status": "refused",
            "stop_reason": gate_failure,
            "target_files": target_files,
            "risk": risk,
            "benchmark_scope": {},
            "approve": approve,
        }
        if approve:
            write_text("outputs/handoff_task.md", handoff_md)
            append_jsonl("data/handoff_tasks.jsonl", record)
            print("\nWritten: outputs/handoff_task.md  (planning_only — gate failure)")
        else:
            print("\n[DRY-RUN] Would write: outputs/handoff_task.md  (planning_only — gate failure)")
        print(divider)
        sys.exit(1)

    # --- Extract code context (read-only) ---
    file_contexts: dict[str, str] = {}
    context_ok = True
    for f in target_files:
        ok, content = _read_product_file_safe(str(f))
        if ok:
            file_contexts[str(f)] = content
        else:
            print(f"  Warning: {content}")
            context_ok = False

    # --- Classify task ---
    task_type = _classify_task(proposal, gate_failure, context_ok)

    # --- Build benchmark scope ---
    benchmark_scope = _build_benchmark_scope(proposal)

    # --- Build handoff document ---
    handoff_md = _build_handoff_task_md(
        now=now,
        proposal=proposal,
        task_type=task_type,
        gate_failure=gate_failure,
        file_contexts=file_contexts,
        benchmark_scope=benchmark_scope,
    )

    record = {
        "date": now.isoformat(),
        "title": title,
        "task_type": task_type,
        "status": "generated" if task_type == "implementation_task" else task_type,
        "stop_reason": "",
        "target_files": target_files,
        "risk": risk,
        "benchmark_scope": benchmark_scope,
        "safe_to_send": task_type == "implementation_task",
        "approve": approve,
    }

    print(f"\nTask type       : {task_type}")
    print(f"Context read    : {context_ok} ({len(file_contexts)}/{len(target_files)} files)")
    print(f"Safe to send    : {task_type == 'implementation_task'}")
    print(f"Benchmark scope : {', '.join(k for k, v in benchmark_scope.items() if v) or 'none'}")

    if approve:
        write_text("outputs/handoff_task.md", handoff_md)
        append_jsonl("data/handoff_tasks.jsonl", record)
        print("\nWritten: outputs/handoff_task.md")
        print("Written: data/handoff_tasks.jsonl  (appended)")
    else:
        print("\n[DRY-RUN] Pass --approve to write output files.")
        print("[DRY-RUN] Would write: outputs/handoff_task.md")
        print("[DRY-RUN] Would write: data/handoff_tasks.jsonl  (append)")

    print(divider)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="V6 Generate Handoff Task")
    parser.add_argument(
        "--approve",
        action="store_true",
        help="Write output files. Without this flag, dry-run only.",
    )
    args = parser.parse_args()
    main(approve=args.approve)
