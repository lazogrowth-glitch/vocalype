"""review_handoff_task.py â€” V6 Product Implementation Handoff Review.

Reads the latest handoff task record from data/handoff_tasks.jsonl and the
generated handoff_task.md. Prints a structured summary and recommended next action.

Does NOT execute the handoff. Does NOT modify product code.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from brain import BRAIN_ROOT, ensure_brain_structure, read_jsonl, read_text


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_optional_jsonl(path: str) -> list[dict[str, Any]]:
    try:
        return read_jsonl(path)
    except FileNotFoundError:
        return []


def _read_optional_text(path: str) -> str:
    try:
        return read_text(path)
    except FileNotFoundError:
        return ""


def _is_sensitive(path: str) -> bool:
    sensitive_terms = ("auth/client", "license/client", "secret_store", "security", "payment", "billing", "runtime")
    return any(t in path.lower() for t in sensitive_terms)


def _safe_to_send(record: dict[str, Any]) -> tuple[bool, str]:
    """Return (safe, reason) â€” whether this handoff is safe to send to an implementation model."""
    task_type = record.get("task_type", "")
    status = record.get("status", "")
    stop_reason = record.get("stop_reason", "")

    if status == "refused" or stop_reason:
        return False, stop_reason or "Handoff was refused â€” see stop_reason."

    if task_type == "planning_only":
        return False, "Task type is planning_only â€” resolve stop condition first."

    if task_type == "measurement_task":
        return False, "Task type is measurement_task â€” complete manual observations first."

    if task_type == "proposal_task":
        return False, "Task type is proposal_task â€” narrow scope and re-run generate_product_patch_proposal.py."

    if task_type != "implementation_task":
        return False, f"Unknown task type: {task_type}"

    target_files = record.get("target_files", [])
    if not target_files:
        return False, "No target files â€” too vague to implement safely."

    for f in target_files:
        if _is_sensitive(str(f)):
            return False, f"Target file '{f}' is sensitive â€” requires explicit founder approval."

    risk = str(record.get("risk", "high")).lower()
    if risk == "high":
        return False, "Risk is HIGH â€” founder must narrow scope first."

    return True, "Task type is implementation_task, risk is not high, no sensitive files, target files defined."


def _recommended_action(record: dict[str, Any], safe: bool, reason: str) -> list[str]:
    task_type = record.get("task_type", "")
    status = record.get("status", "")

    if not record:
        return [
            "No handoff task found.",
            "Run: python internal/brain/scripts/generate_handoff_task.py --approve",
        ]

    if status == "refused":
        return [
            f"Resolve stop condition: {record.get('stop_reason', 'unknown')}",
            "Re-run generate_product_patch_proposal.py after fixing the issue.",
            "Re-run generate_handoff_task.py --approve.",
        ]

    if task_type == "measurement_task":
        return [
            "Complete manual observation checklist: outputs/measure_activation_failure_points.md Section 6.",
            "Add observations to data/quality_observations.jsonl.",
            "Re-run generate_product_patch_proposal.py.",
            "Re-run generate_handoff_task.py --approve.",
        ]

    if task_type == "proposal_task":
        return [
            "Verify target files exist in the repo.",
            "Narrow proposed_changes to a single specific UI change.",
            "Re-run generate_product_patch_proposal.py.",
            "Re-run generate_handoff_task.py --approve.",
        ]

    if task_type == "planning_only":
        return [
            f"Resolve: {record.get('stop_reason', 'see outputs/handoff_task.md')}",
            "Re-run generate_handoff_task.py --approve after resolving.",
        ]

    if safe:
        return [
            "Read outputs/handoff_task.md â€” review the full handoff document.",
            "Confirm the Approved Scope matches the intended change.",
            "Confirm the Forbidden Scope excludes all sensitive files.",
            "Confirm the Existing Code Context section looks correct.",
            "Copy outputs/handoff_task.md to Claude Code, Codex, or Aider for implementation.",
            "Review the diff before committing.",
            "Run npm run lint and npm run format after implementation.",
            "Run manual test: all 5 activation states.",
        ]

    return [
        f"Not safe to send: {reason}",
        "Resolve the issue above, then re-run generate_handoff_task.py --approve.",
    ]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ensure_brain_structure()

    records = _read_optional_jsonl("data/handoff_tasks.jsonl")
    handoff_md = _read_optional_text("outputs/handoff_task.md")

    divider = "=" * 60
    print(divider)
    print("Vocalype Brain â€” V6 Handoff Task Review")
    print(divider)

    if not records:
        print("\nNo handoff tasks found.")
        print("Run: python internal/brain/scripts/generate_handoff_task.py --approve")
        print(divider)
        return

    latest = records[-1]
    title = latest.get("title", "Unknown")
    task_type = latest.get("task_type", "unknown")
    status = latest.get("status", "unknown")
    risk = latest.get("risk", "unknown")
    target_files = latest.get("target_files", [])
    stop_reason = latest.get("stop_reason", "")
    benchmark_scope = latest.get("benchmark_scope", {})

    safe, reason = _safe_to_send(latest)

    print(f"\nLatest handoff task : {title}")
    print(f"Date               : {latest.get('date', 'unknown')}")
    print(f"Task type          : {task_type}")
    print(f"Status             : {status}")
    print(f"Risk               : {risk}")
    print(f"Mode               : {'--approve (written)' if latest.get('approve') else 'dry-run (not written)'}")

    if target_files:
        print("\nTarget files:")
        for f in target_files:
            marker = " [SENSITIVE]" if _is_sensitive(str(f)) else ""
            print(f"  - {f}{marker}")
    else:
        print("\nTarget files       : none defined")

    print("\nForbidden scope    : backend/, src-tauri/, auth/client.ts, license/client.ts, payment, billing, security, runtime")

    if stop_reason:
        print(f"\nStop condition     : {stop_reason}")

    if benchmark_scope:
        active = [k for k, v in benchmark_scope.items() if v]
        print(f"\nV7 benchmark scope : {', '.join(active) if active else 'none'}")

    if handoff_md:
        # Count sections in the handoff doc as a health check
        section_count = handoff_md.count("\n## ")
        has_context = "## Existing Code Context" in handoff_md
        has_benchmark = "## Benchmark Baseline" in handoff_md
        has_forbidden = "## Forbidden Scope" in handoff_md
        print(f"\nHandoff doc health:")
        print(f"  Sections         : {section_count}")
        print(f"  Has code context : {has_context}")
        print(f"  Has benchmark    : {has_benchmark}")
        print(f"  Has forbidden    : {has_forbidden}")
    else:
        print("\nHandoff doc        : not written yet (run --approve)")

    print(f"\nSafe to send       : {'YES â€” ' + reason if safe else 'NO â€” ' + reason}")

    print(f"\n{divider}")
    print("Recommended next action:")
    for step in _recommended_action(latest, safe, reason):
        print(f"  {step}")
    print(divider)

    if len(records) > 1:
        print(f"\nAll handoff attempts ({len(records)} total):")
        for r in records[-6:]:
            print(f"  [{r.get('date','?')}] {r.get('task_type','?')} / {r.get('status','?')} â€” {r.get('title','?')}")
        print(divider)


if __name__ == "__main__":
    main()
