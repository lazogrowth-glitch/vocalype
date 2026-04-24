"""review_product_patch_proposal.py — V5 Product Patch Proposal Review.

Reads and summarises the latest product patch proposal.
Does NOT apply anything.
"""
from __future__ import annotations

from typing import Any

from brain import ensure_brain_structure, read_jsonl, read_text


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


def _is_safe_to_request(proposal: dict[str, Any]) -> tuple[bool, str]:
    """Return (safe, reason) — whether it is safe to send this to an implementation model."""
    if proposal.get("status") == "refused":
        return False, "Proposal was refused — no safe candidate available."

    risk = proposal.get("risk", "high")
    if risk == "high":
        return False, "Risk is HIGH — do not send to implementation model without founder review."

    if proposal.get("sensitive_files_involved"):
        return False, "Sensitive files are involved — requires explicit founder approval before implementation."

    target_files = proposal.get("target_files", [])
    if not target_files:
        return False, "No target files defined — proposal is too vague to implement safely."

    for f in target_files:
        if _is_sensitive(f):
            return False, f"Target file '{f}' is sensitive — requires explicit founder approval."

    return True, "Proposal is low/medium risk, no sensitive files, target files are defined."


def _recommended_action(proposal: dict[str, Any], safe: bool) -> list[str]:
    if proposal.get("status") == "refused":
        return [
            "No product proposal available.",
            "Run generate_product_patch_proposal.py after adding quality observations.",
            "Or run night_shift.py to generate new proposals.",
        ]
    if not safe:
        return [
            "Do not send to implementation model yet.",
            "Review the proposal manually.",
            "Narrow scope or get explicit founder approval first.",
        ]
    return [
        "Read outputs/product_patch_proposal_report.md.",
        "Review the Exact Prompt section.",
        "Confirm approved scope and forbidden scope are correct.",
        "Copy the prompt to Codex or Claude Code for implementation.",
        "Review the diff before committing.",
        "Run lint and manual test scenarios after applying.",
    ]


def main() -> None:
    ensure_brain_structure()

    proposals = _read_optional_jsonl("data/product_patch_proposals.jsonl")

    divider = "=" * 60
    print(divider)
    print("Vocalype Brain — Product Patch Proposal Review")
    print(divider)

    if not proposals:
        print("\nNo product patch proposals found.")
        print("Run: python vocalype-brain/scripts/generate_product_patch_proposal.py")
        print(divider)
        return

    latest = proposals[-1]
    title = latest.get("title", "Unknown")
    source = latest.get("source", "unknown")
    risk = latest.get("risk", "unknown")
    status = latest.get("status", "unknown")
    target_files = latest.get("target_files", [])
    sensitive = latest.get("sensitive_files_involved", False)
    summary = latest.get("summary", "")
    proposed_changes = latest.get("proposed_changes", [])
    validation_plan = latest.get("validation_plan", "")

    safe, safety_reason = _is_safe_to_request(latest)

    print(f"\nLatest proposal   : {title}")
    print(f"Date              : {latest.get('date', 'unknown')}")
    print(f"Source            : {source}")
    print(f"Risk              : {risk}")
    print(f"Status            : {status}")
    print(f"Sensitive files   : {'YES' if sensitive else 'No'}")
    print(f"Manual approval   : YES (always required)")

    if target_files:
        print("\nTarget files:")
        for f in target_files:
            marker = " [SENSITIVE]" if _is_sensitive(f) else ""
            print(f"  - {f}{marker}")
    else:
        print("\nTarget files      : none defined")

    if summary:
        print(f"\nSummary : {summary}")

    if proposed_changes:
        print("\nProposed changes:")
        for change in proposed_changes[:5]:
            print(f"  - {change}")

    if validation_plan:
        first_line = validation_plan.splitlines()[0] if validation_plan else ""
        print(f"\nValidation        : {first_line}")

    print(f"\nSafe to request   : {'YES — ' + safety_reason if safe else 'NO — ' + safety_reason}")

    print(f"\n{divider}")
    print("Recommended next action:")
    for step in _recommended_action(latest, safe):
        print(f"  {step}")
    print(divider)

    if len(proposals) > 1:
        print(f"\nAll proposals ({len(proposals)} total):")
        for p in proposals[-6:]:
            print(f"  [{p.get('date','?')}] {p.get('risk','?')} / {p.get('status','?')} — {p.get('title','?')}")
        print(divider)


if __name__ == "__main__":
    main()
