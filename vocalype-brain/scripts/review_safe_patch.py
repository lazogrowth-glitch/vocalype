from __future__ import annotations

from pathlib import Path
from typing import Any

from brain import BRAIN_ROOT, ensure_brain_structure, read_jsonl, read_text


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


def _list_patches() -> list[Path]:
    patches_dir = BRAIN_ROOT / "patches"
    if not patches_dir.exists():
        return []
    return sorted(p for p in patches_dir.glob("patch_*.md") if p.is_file())


def _is_product_file(path: str) -> bool:
    return (
        path.startswith("src/")
        or path.startswith("src-tauri/")
        or path.startswith("backend/")
    ) and not path.startswith("vocalype-brain/")


def _recommended_action(safety_class: str, status: str) -> list[str]:
    if status == "rejected":
        return [
            "Task was REJECTED as unsafe.",
            "Run create_codex_task.py to generate a safer task.",
            "Then re-run generate_safe_patch.py.",
        ]
    if safety_class == "product_proposal_only":
        return [
            "This is a PROPOSAL ONLY — do not apply automatically.",
            "Read the patch file and review the implementation prompt.",
            "Confirm the approved files do not include forbidden scope.",
            "Send the prompt to Codex or Claude for implementation.",
            "Founder approval required before any product file is touched.",
        ]
    if safety_class in ("brain_safe", "docs_safe"):
        return [
            f"Patch is {safety_class}.",
            "Review the patch file and apply manually if correct.",
            "Run validation commands from the patch file.",
            "Commit only Brain/docs files after review.",
        ]
    return ["Unknown safety class — review manually before proceeding."]


def main() -> None:
    ensure_brain_structure()

    candidates = _read_optional_jsonl("data/safe_patch_candidates.jsonl")
    patch_files = _list_patches()

    divider = "=" * 60
    print(divider)
    print("Vocalype Brain — Safe Patch Review")
    print(divider)

    if not candidates:
        print("\nNo patch candidates found.")
        print("Run: python vocalype-brain/scripts/generate_safe_patch.py")
        print(divider)
        return

    latest = candidates[-1]
    title = latest.get("title", "Unknown")
    safety_class = latest.get("safety_class", "unknown")
    task_type = latest.get("source_task", "unknown")
    status = latest.get("status", "unknown")
    target_files = latest.get("target_files", [])
    patch_file = latest.get("patch_file", "")
    reason = latest.get("reason", "none")
    validation_plan = latest.get("validation_plan", "none")
    manual_approval = latest.get("manual_approval_required", True)

    product_files = [f for f in target_files if _is_product_file(f)]

    print(f"\nLatest patch candidate : {title}")
    print(f"Date                   : {latest.get('date', 'unknown')}")
    print(f"Safety class           : {safety_class}")
    print(f"Task type              : {task_type}")
    print(f"Status                 : {status}")
    print(f"Manual approval        : {'YES' if manual_approval else 'No'}")
    print(f"Product code involved  : {'YES — ' + ', '.join(product_files) if product_files else 'No'}")

    if target_files:
        print("\nTarget files:")
        for f in target_files:
            print(f"  - {f}")
    else:
        print("\nTarget files           : none")

    print(f"\nReason       : {reason}")
    print(f"Validation   : {validation_plan}")

    if patch_file:
        print(f"\nPatch file   : {patch_file}")
    else:
        print("\nPatch file   : none (rejected or not yet generated)")

    total = len(patch_files)
    print(f"\nTotal patch files in vocalype-brain/patches/ : {total}")
    if patch_files:
        recent = patch_files[-5:]
        for p in recent:
            print(f"  - {p.name}")

    print(f"\n{divider}")
    print("Recommended next action:")
    for line in _recommended_action(safety_class, status):
        print(f"  {line}")
    print(divider)

    # Candidate history summary
    if len(candidates) > 1:
        print(f"\nAll patch candidates ({len(candidates)} total):")
        for c in candidates[-8:]:
            sc = c.get("safety_class", "?")
            st = c.get("status", "?")
            dt = c.get("date", "?")
            ttl = c.get("title", "?")
            print(f"  [{dt}] {sc} / {st} — {ttl}")
        print(divider)


if __name__ == "__main__":
    main()
