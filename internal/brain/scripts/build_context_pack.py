"""
build_context_pack.py â€” Vocalype Brain Operating Mode
======================================================
Builds a minimal, safe context pack for external models (DeepSeek, Claude, etc.).

What it does:
  - Collects a curated set of Brain memory and output files
  - Verifies no forbidden paths (secrets, product code, auth, payment) are included
  - Writes internal/brain/outputs/context_pack.md

What it does NOT do:
  - Send anything to an external API
  - Include product code (src/, src-tauri/, backend/)
  - Include secrets, .env, or API keys
  - Access the whole repo

Usage:
  python internal/brain/scripts/build_context_pack.py
  python internal/brain/scripts/build_context_pack.py --extra path/to/file.md
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BRAIN_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BRAIN_ROOT.parent
CONFIG_PATH = BRAIN_ROOT / "config" / "model_routing.json"
OUTPUT_PATH = BRAIN_ROOT / "outputs" / "context_pack.md"

# ---------------------------------------------------------------------------
# Default files included in every context pack (relative to repo root)
# ---------------------------------------------------------------------------
DEFAULT_FILES: list[tuple[str, str]] = [
    (
        "internal/brain/memory/operating_contract.md",
        "Operating Contract (safety rules, workflow, stop conditions)",
    ),
    (
        "internal/brain/memory/current_state.md",
        "Current Brain State (phase, pending actions, key files)",
    ),
    (
        "internal/brain/outputs/weekly_action.md",
        "Weekly Action (V10 selected action for this week)",
    ),
]

OPTIONAL_FILES: list[tuple[str, str]] = [
    (
        "internal/brain/outputs/v11_mission_package.md",
        "V11 Mission Package (current scoped mission brief)",
    ),
    (
        "internal/brain/outputs/paste_mechanism_diagnosis.md",
        "Paste Mechanism Diagnosis (V11 PB-1 investigation)",
    ),
    (
        "internal/brain/outputs/paste_utils_diagnosis.md",
        "Paste Utils Diagnosis (root cause confirmation)",
    ),
]

# ---------------------------------------------------------------------------
# Forbidden path patterns â€” never included regardless of arguments
# ---------------------------------------------------------------------------
FORBIDDEN_PATTERNS: list[str] = [
    ".env",
    "secret",
    "backend/",
    "src-tauri/",
    "src/lib/auth",
    "src/lib/license",
    "payment",
    "billing",
    "security",
    "translation.json",
    ".key",
    ".pem",
    ".p12",
    "api_key",
    "password",
    "token",
]


def _load_forbidden_from_config() -> list[str]:
    """Load additional forbidden patterns from model_routing.json if present."""
    if CONFIG_PATH.exists():
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            return data.get("forbidden_in_context_pack", [])
        except (json.JSONDecodeError, KeyError):
            pass
    return []


def _is_forbidden(path: Path) -> tuple[bool, str]:
    """Return (True, reason) if the path matches any forbidden pattern."""
    path_str = str(path).replace("\\", "/").lower()
    all_forbidden = FORBIDDEN_PATTERNS + _load_forbidden_from_config()
    for pattern in all_forbidden:
        pat = pattern.lower().replace("\\", "/")
        if pat in path_str:
            return True, pattern
    return False, ""


def _read_file(path: Path) -> str | None:
    """Read a file safely. Returns None if file does not exist."""
    if not path.exists():
        return None
    try:
        return path.read_text(encoding="utf-8")
    except Exception as exc:  # noqa: BLE001
        return f"[ERROR reading file: {exc}]"


def _build_section(label: str, description: str, content: str | None, path: Path) -> str:
    """Format one file as a context pack section."""
    rel = path.relative_to(REPO_ROOT) if path.is_relative_to(REPO_ROOT) else path
    if content is None:
        return (
            f"## {label}\n\n"
            f"**{description}**\n\n"
            f"*File not found: `{rel}` â€” skipped.*\n\n"
        )
    return (
        f"## {label}\n\n"
        f"**{description}**\n"
        f"*Source: `{rel}`*\n\n"
        f"```\n{content.strip()}\n```\n\n"
    )


def build_context_pack(extra_files: list[Path] | None = None) -> Path:
    """Build the context pack and write it to OUTPUT_PATH. Returns the output path."""

    # Validate extra files for forbidden patterns before anything else
    extra_files = extra_files or []
    for ef in extra_files:
        forbidden, reason = _is_forbidden(ef)
        if forbidden:
            print(f"[BLOCKED] '{ef}' matches forbidden pattern '{reason}' â€” not included.")
            extra_files = [f for f in extra_files if f != ef]

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    sections: list[str] = []

    # ---- Header ----
    sections.append(
        f"# Vocalype Brain â€” Context Pack\n\n"
        f"**Generated:** {timestamp}\n\n"
        f"> **This context pack may be sent to an external model.**\n"
        f"> It contains only Brain memory and output files â€” no product code,\n"
        f"> no secrets, no API keys, no auth/payment/security files.\n"
        f"> The founder reviews this file before sending it externally.\n\n"
        f"---\n\n"
    )

    # ---- Default files ----
    for rel_path, description in DEFAULT_FILES:
        abs_path = REPO_ROOT / rel_path
        forbidden, reason = _is_forbidden(abs_path)
        if forbidden:
            print(f"[SKIP] {rel_path} â€” forbidden pattern '{reason}'")
            continue
        content = _read_file(abs_path)
        label = Path(rel_path).name
        sections.append(_build_section(label, description, content, abs_path))

    # ---- Optional files (included only if they exist) ----
    for rel_path, description in OPTIONAL_FILES:
        abs_path = REPO_ROOT / rel_path
        if not abs_path.exists():
            continue
        forbidden, reason = _is_forbidden(abs_path)
        if forbidden:
            continue
        content = _read_file(abs_path)
        label = Path(rel_path).name
        sections.append(_build_section(label + " (optional)", description, content, abs_path))

    # ---- Extra files passed via CLI ----
    for ef in extra_files:
        abs_path = REPO_ROOT / ef if not ef.is_absolute() else ef
        forbidden, reason = _is_forbidden(abs_path)
        if forbidden:
            print(f"[SKIP] {ef} â€” forbidden pattern '{reason}'")
            continue
        content = _read_file(abs_path)
        label = abs_path.name + " (extra)"
        sections.append(_build_section(label, f"Extra file: {abs_path.name}", content, abs_path))

    # ---- Footer ----
    sections.append(
        f"---\n\n"
        f"## Safety Reminder\n\n"
        f"This pack was built by `build_context_pack.py`.\n\n"
        f"**What was excluded:**\n"
        f"- Product code (`src/`, `src-tauri/`, `backend/`)\n"
        f"- Auth, license, payment, security files\n"
        f"- API keys, secrets, `.env` files\n"
        f"- Translation files\n\n"
        f"**Before sending externally:**\n"
        f"1. Review this file to confirm its contents are appropriate\n"
        f"2. Copy and paste into your external model session manually\n"
        f"3. Do not share API keys, passwords, or secrets in the same session\n"
    )

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text("".join(sections), encoding="utf-8")
    return OUTPUT_PATH


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build a safe context pack for external models."
    )
    parser.add_argument(
        "--extra",
        metavar="FILE",
        nargs="*",
        default=[],
        help="Additional Brain files to include (must be inside internal/brain/)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be included without writing the file",
    )
    args = parser.parse_args()

    extra = [Path(f) for f in (args.extra or [])]

    if args.dry_run:
        print("DRY RUN â€” files that would be included:")
        for rel, desc in DEFAULT_FILES:
            p = REPO_ROOT / rel
            status = "EXISTS" if p.exists() else "MISSING"
            print(f"  [{status}] {rel}")
        for rel, desc in OPTIONAL_FILES:
            p = REPO_ROOT / rel
            if p.exists():
                print(f"  [EXISTS] {rel} (optional)")
        for ef in extra:
            forbidden, reason = _is_forbidden(ef)
            status = f"BLOCKED ({reason})" if forbidden else "EXTRA"
            print(f"  [{status}] {ef}")
        return

    output = build_context_pack(extra)
    print(f"Context pack written: {output}")
    size = output.stat().st_size
    lines = len(output.read_text(encoding="utf-8").splitlines())
    print(f"  Size: {size:,} bytes  |  Lines: {lines:,}")
    print()
    print("Review this file before sending to any external model.")
    print("It contains no product code, no secrets, no API keys.")


if __name__ == "__main__":
    main()
