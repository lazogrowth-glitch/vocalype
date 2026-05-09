"""apply_approved_patch.py â€” V3.5 controlled patch application.

Default mode: dry-run (prints what would happen, touches nothing).
Apply mode:   --approve flag required.

Only brain_safe or docs_safe patches may be applied.
Only internal/brain/ and docs/README target files are permitted.
Patch files must contain an explicit ## Apply Instructions section.
No product code, no src/, no backend/, no auth/license/payment/security/Rust.
No auto-commit, no --no-verify, no deployment, no file deletion.
"""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from brain import BRAIN_ROOT, append_jsonl, ensure_brain_structure, read_jsonl, read_text, write_text


# ---------------------------------------------------------------------------
# Allowlists and blocklists
# ---------------------------------------------------------------------------

APPLY_ALLOWED_PREFIXES = (
    "internal/brain/",
)

APPLY_ALLOWED_PATTERNS = (
    "README",
    "CHANGELOG",
    "CONTRIBUTING",
    "docs/",
)

APPLY_FORBIDDEN_PREFIXES = (
    "src/",
    "src-tauri/",
    "backend/",
)

APPLY_FORBIDDEN_TERMS = (
    "auth",
    "license",
    "payment",
    "security",
    "runtime",
    "secrets",
    ".env",
    "secret_store",
    "translation.json",
)

APPLYABLE_SAFETY_CLASSES = {"brain_safe", "docs_safe"}


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


def _latest_patch_file() -> Path | None:
    patches_dir = BRAIN_ROOT / "patches"
    if not patches_dir.exists():
        return None
    candidates = sorted(p for p in patches_dir.glob("patch_*.md") if p.is_file())
    return candidates[-1] if candidates else None


def _resolve_target(target_file: str) -> Path:
    """Resolve target_file string to an absolute Path via brain.resolve_path logic."""
    p = Path(target_file)
    if p.is_absolute():
        return p
    if p.parts and p.parts[0] == BRAIN_ROOT.name:
        return BRAIN_ROOT.parent / p
    return BRAIN_ROOT / p


# ---------------------------------------------------------------------------
# Target file safety validation
# ---------------------------------------------------------------------------

def _validate_target_file(target_file: str) -> tuple[bool, str]:
    """Return (is_safe, reason).

    A target file is safe if it starts with an allowed prefix and contains no
    forbidden terms. It is unsafe if it starts with a forbidden prefix or
    contains a forbidden term.
    """
    tf = target_file.replace("\\", "/")

    for prefix in APPLY_FORBIDDEN_PREFIXES:
        if tf.startswith(prefix):
            return False, f"Target file starts with forbidden prefix '{prefix}'."

    for term in APPLY_FORBIDDEN_TERMS:
        if term in tf.lower():
            return False, f"Target file path contains forbidden term '{term}'."

    for prefix in APPLY_ALLOWED_PREFIXES:
        if tf.startswith(prefix):
            return True, f"Target file is inside allowed prefix '{prefix}'."

    for pattern in APPLY_ALLOWED_PATTERNS:
        if pattern in tf:
            return True, f"Target file matches allowed pattern '{pattern}'."

    return (
        False,
        f"Target file '{target_file}' is not in the allowed prefix list "
        f"({', '.join(APPLY_ALLOWED_PREFIXES)}) or allowed patterns "
        f"({', '.join(APPLY_ALLOWED_PATTERNS)}).",
    )


# ---------------------------------------------------------------------------
# Apply Instructions parser
# ---------------------------------------------------------------------------

class ApplyInstructions:
    def __init__(
        self,
        target_file: str,
        operation: str,
        content: str,
    ) -> None:
        self.target_file = target_file.strip()
        self.operation = operation.strip().lower()
        self.content = content

    def __repr__(self) -> str:
        return (
            f"ApplyInstructions(target_file={self.target_file!r}, "
            f"operation={self.operation!r}, "
            f"content_len={len(self.content)})"
        )


def _parse_apply_instructions(patch_text: str) -> ApplyInstructions | None:
    """Extract the ## Apply Instructions block from patch_text.

    Expected format inside the section:

        target_file: internal/brain/some/path.md
        operation: append | create
        content:
        <multi-line content until next ## heading or EOF>

    Returns None if the section is missing or malformed.
    """
    lines = patch_text.splitlines()

    # Find section start
    section_start = None
    for i, line in enumerate(lines):
        if line.strip().startswith("## Apply Instructions"):
            section_start = i + 1
            break

    if section_start is None:
        return None

    # Collect lines until next ## heading or EOF
    section_lines: list[str] = []
    for line in lines[section_start:]:
        if line.startswith("## ") and section_lines:
            break
        section_lines.append(line)

    # Parse key: value fields
    target_file = ""
    operation = ""
    content_lines: list[str] = []
    in_content = False

    for line in section_lines:
        if in_content:
            content_lines.append(line)
            continue
        stripped = line.strip()
        if stripped.startswith("target_file:"):
            target_file = stripped.split(":", 1)[1].strip()
        elif stripped.startswith("operation:"):
            operation = stripped.split(":", 1)[1].strip().lower()
        elif stripped.startswith("content:"):
            in_content = True
            # Anything after "content:" on the same line is part of content
            remainder = stripped[len("content:"):].strip()
            if remainder:
                content_lines.append(remainder)

    content = "\n".join(content_lines).strip()

    if not target_file or not operation:
        return None
    if operation not in ("append", "create"):
        return None

    return ApplyInstructions(
        target_file=target_file,
        operation=operation,
        content=content,
    )


# ---------------------------------------------------------------------------
# Dry-run summary
# ---------------------------------------------------------------------------

def _dry_run(
    candidate: dict[str, Any],
    patch_file_path: Path | None,
    instructions: ApplyInstructions | None,
    target_safe: bool,
    target_reason: str,
) -> None:
    divider = "=" * 60
    print(divider)
    print("Vocalype Brain â€” Apply Approved Patch (DRY RUN)")
    print("No files will be modified. Pass --approve to apply.")
    print(divider)

    title = candidate.get("title", "Unknown")
    safety_class = candidate.get("safety_class", "unknown")
    status = candidate.get("status", "unknown")
    target_files = candidate.get("target_files", [])

    print(f"\nLatest patch candidate : {title}")
    print(f"Safety class           : {safety_class}")
    print(f"Candidate status       : {status}")
    print(f"Declared target files  : {', '.join(target_files) if target_files else 'none'}")
    print(f"Patch file             : {patch_file_path.name if patch_file_path else 'not found'}")

    applyable = safety_class in APPLYABLE_SAFETY_CLASSES

    print(f"\nSafety class applyable : {'YES' if applyable else 'NO â€” ' + safety_class + ' is not in ' + str(APPLYABLE_SAFETY_CLASSES)}")

    if instructions is None:
        print("\n## Apply Instructions section : NOT FOUND")
        print("  Patch file has no structured Apply Instructions.")
        print("  Manual implementation required.")
        print("  Would NOT apply even with --approve.")
    else:
        print(f"\n## Apply Instructions section : FOUND")
        print(f"  target_file : {instructions.target_file}")
        print(f"  operation   : {instructions.operation}")
        print(f"  content_len : {len(instructions.content)} chars")
        print(f"  target safe : {'YES â€” ' + target_reason if target_safe else 'NO â€” ' + target_reason}")

        would_apply = applyable and target_safe
        print(f"\n  Would apply with --approve : {'YES' if would_apply else 'NO'}")

    print(f"\n{divider}")
    print("To apply: python internal/brain/scripts/apply_approved_patch.py --approve")
    print(divider)


# ---------------------------------------------------------------------------
# Apply logic
# ---------------------------------------------------------------------------

def _apply(
    candidate: dict[str, Any],
    patch_file_path: Path,
    instructions: ApplyInstructions,
    target_safe: bool,
    target_reason: str,
) -> tuple[str, str]:
    """Attempt to apply the patch. Returns (status, reason)."""
    safety_class = candidate.get("safety_class", "unknown")

    if safety_class not in APPLYABLE_SAFETY_CLASSES:
        return (
            "refused",
            f"Safety class '{safety_class}' is not applyable. "
            f"Only {APPLYABLE_SAFETY_CLASSES} patches may be applied.",
        )

    if not target_safe:
        return "refused", f"Target file failed safety check: {target_reason}"

    resolved = _resolve_target(instructions.target_file)

    # Belt-and-suspenders: confirm resolved path stays within BRAIN_ROOT or a
    # safe docs prefix â€” even if the string checks above passed.
    try:
        resolved.relative_to(BRAIN_ROOT)
    except ValueError:
        # Not under BRAIN_ROOT â€” check docs/README allowlist
        rel = str(resolved).replace("\\", "/")
        if not any(pattern in rel for pattern in APPLY_ALLOWED_PATTERNS):
            return (
                "refused",
                f"Resolved path '{resolved}' is outside internal/brain/ and "
                "does not match any allowed docs pattern.",
            )

    if instructions.operation == "create":
        if resolved.exists():
            return (
                "refused",
                f"Operation is 'create' but '{instructions.target_file}' already exists. "
                "Use 'append' to add content, or delete the file manually first.",
            )
        resolved.parent.mkdir(parents=True, exist_ok=True)
        resolved.write_text(instructions.content + "\n", encoding="utf-8")
        return "applied", f"Created '{instructions.target_file}'."

    if instructions.operation == "append":
        resolved.parent.mkdir(parents=True, exist_ok=True)
        with resolved.open("a", encoding="utf-8") as fh:
            fh.write("\n" + instructions.content + "\n")
        return "applied", f"Appended to '{instructions.target_file}'."

    return "refused", f"Unknown operation '{instructions.operation}'."


# ---------------------------------------------------------------------------
# Report writer
# ---------------------------------------------------------------------------

def _write_report(
    now: datetime,
    candidate: dict[str, Any],
    patch_file_path: Path | None,
    instructions: ApplyInstructions | None,
    status: str,
    reason: str,
    dry_run: bool,
) -> None:
    lines = [
        "# Vocalype Brain â€” Apply Patch Report",
        "",
        f"Date: {now.isoformat()}",
        f"Mode: {'dry_run' if dry_run else 'approve'}",
        "",
        "## Patch Candidate",
        "",
        f"- Title: {candidate.get('title', 'Unknown')}",
        f"- Safety class: {candidate.get('safety_class', 'unknown')}",
        f"- Patch file: {patch_file_path.name if patch_file_path else 'not found'}",
        "",
        "## Apply Instructions",
        "",
    ]

    if instructions:
        lines.extend([
            f"- target_file: {instructions.target_file}",
            f"- operation: {instructions.operation}",
            f"- content_length: {len(instructions.content)} chars",
        ])
    else:
        lines.append("- NOT FOUND â€” no structured Apply Instructions section in patch file.")

    lines.extend([
        "",
        "## Result",
        "",
        f"- Status: {status}",
        f"- Reason: {reason}",
        "",
        "## Safety Rules (always active)",
        "",
        "- No product code modified",
        "- No src/, backend/, src-tauri/ files touched",
        "- No auth/license/payment/security/runtime/secrets files touched",
        "- No files deleted",
        "- No auto-commit",
        "- No --no-verify",
        "- No deployment",
        "- Manual approval required (--approve flag) for any write",
    ])

    write_text("outputs/apply_patch_report.md", "\n".join(lines).rstrip() + "\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(approve: bool = False) -> None:
    ensure_brain_structure()

    candidates = _read_optional_jsonl("data/safe_patch_candidates.jsonl")
    if not candidates:
        print("No patch candidates found.")
        print("Run: python internal/brain/scripts/generate_safe_patch.py")
        return

    candidate = candidates[-1]
    patch_file_ref = candidate.get("patch_file", "")

    # Locate patch file
    patch_file_path: Path | None = None
    if patch_file_ref:
        from brain import resolve_path
        candidate_path = resolve_path(patch_file_ref)
        if candidate_path.exists():
            patch_file_path = candidate_path

    if patch_file_path is None:
        patch_file_path = _latest_patch_file()

    patch_text = patch_file_path.read_text(encoding="utf-8") if patch_file_path else ""
    instructions = _parse_apply_instructions(patch_text)

    target_safe = False
    target_reason = "No Apply Instructions found."
    if instructions:
        target_safe, target_reason = _validate_target_file(instructions.target_file)

    now = datetime.now().replace(microsecond=0)

    if not approve:
        _dry_run(candidate, patch_file_path, instructions, target_safe, target_reason)
        status = "dry_run"
        reason = "Dry-run mode. Pass --approve to apply."
    else:
        # Approve path
        if instructions is None:
            status = "refused"
            reason = (
                "No ## Apply Instructions section found in patch file. "
                "Manual implementation required. "
                "Add a structured Apply Instructions block to the patch file before approving."
            )
            print(f"REFUSED: {reason}")
        else:
            status, reason = _apply(candidate, patch_file_path, instructions, target_safe, target_reason)
            print(f"Status : {status}")
            print(f"Reason : {reason}")

    # Log to JSONL
    record: dict[str, Any] = {
        "date": now.isoformat(),
        "title": candidate.get("title", "Unknown"),
        "patch_file": str(patch_file_path) if patch_file_path else "",
        "safety_class": candidate.get("safety_class", "unknown"),
        "target_file": instructions.target_file if instructions else "",
        "operation": instructions.operation if instructions else "",
        "mode": "approve" if approve else "dry_run",
        "status": status,
        "reason": reason,
    }
    append_jsonl("data/applied_patches.jsonl", record)

    _write_report(
        now=now,
        candidate=candidate,
        patch_file_path=patch_file_path,
        instructions=instructions,
        status=status,
        reason=reason,
        dry_run=not approve,
    )
    print("Written internal/brain/outputs/apply_patch_report.md")


if __name__ == "__main__":
    main(approve="--approve" in sys.argv)
