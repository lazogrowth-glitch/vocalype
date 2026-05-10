"""
check_deepseek_setup.py â€” Vocalype Brain Operating Mode
========================================================
Checks whether DEEPSEEK_API_KEY is configured in the environment.

Does NOT print the key.
Does NOT call the DeepSeek API.
Does NOT store or write the key anywhere.

Usage:
  python internal/brain/scripts/check_deepseek_setup.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

BRAIN_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = BRAIN_ROOT / "config" / "model_routing.json"

SETUP_INSTRUCTIONS = """
HOW TO CONFIGURE DEEPSEEK_API_KEY (Windows):

Option A -- Windows Environment Variable (recommended, permanent):
  1. Press Win+R -> type "sysdm.cpl" -> Advanced -> Environment Variables
  2. Under "User variables", click New
  3. Name:  DEEPSEEK_API_KEY
  4. Value: your-api-key-here
  5. Click OK, restart your terminal

Option B -- Local .env file (NOT committed to git):
  1. Create a file at: C:\\developer\\sas\\vocalype\\.env
  2. Add one line:  DEEPSEEK_API_KEY=your-api-key-here
  3. Make sure .env is in .gitignore (never commit it)
  4. Load it before running Brain scripts:
       python -c "from dotenv import load_dotenv; load_dotenv()"
       (requires: pip install python-dotenv)

Option C -- Set in terminal session only (temporary):
  In PowerShell:  $env:DEEPSEEK_API_KEY = "your-api-key-here"
  In CMD:         set DEEPSEEK_API_KEY=your-api-key-here

IMPORTANT PRIVACY NOTICE:
  - DeepSeek is an EXTERNAL API. Data sent to it leaves your machine.
  - Only send context_pack.md (Brain memory/outputs only -- no product code).
  - Never send: src-tauri/, src/, backend/, secrets, auth, payment, .env files.
  - Always review context_pack.md before pasting into any external model session.

Get a DeepSeek API key at: https://platform.deepseek.com/
"""

GITIGNORE_CHECK = [
    ".env",
    "*.env",
    ".env.local",
    "*.key",
    "*.pem",
]


def _check_gitignore() -> tuple[bool, list[str]]:
    """Check whether common secret patterns are in .gitignore."""
    gitignore_path = BRAIN_ROOT.parent / ".gitignore"
    if not gitignore_path.exists():
        return False, []
    content = gitignore_path.read_text(encoding="utf-8")
    covered = [p for p in GITIGNORE_CHECK if p in content]
    return bool(covered), covered


def main() -> None:
    print("=" * 60)
    print("  Vocalype Brain -- DeepSeek API Setup Check")
    print("=" * 60)
    print()

    # 1. Check for API key in environment
    api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    api_base = os.environ.get("DEEPSEEK_API_BASE", "").strip()

    if api_key:
        masked = api_key[:4] + "*" * max(0, len(api_key) - 8) + api_key[-4:] if len(api_key) > 8 else "****"
        print(f"  DEEPSEEK_API_KEY : [OK] configured  ({masked})")
    else:
        print("  DEEPSEEK_API_KEY : [NO] NOT configured")

    if api_base:
        print(f"  DEEPSEEK_API_BASE: [OK] configured  ({api_base})")
    else:
        print("  DEEPSEEK_API_BASE: (not set -- will use default: https://api.deepseek.com/v1)")

    print()

    # 2. Check .gitignore covers secrets
    covered, patterns = _check_gitignore()
    if covered:
        print(f"  .gitignore check : [OK] secrets covered  ({', '.join(patterns)})")
    else:
        print("  .gitignore check : [!!] could not confirm .env is excluded from git")
        print("                     Add '.env' to your .gitignore before storing any key.")

    print()

    # 3. Check model_routing.json exists
    if CONFIG_PATH.exists():
        print(f"  model_routing.json: [OK] present")
    else:
        print(f"  model_routing.json: [!!] not found at {CONFIG_PATH}")

    print()

    # 4. Status summary
    if api_key:
        print("  STATUS: DeepSeek is CONFIGURED.")
        print("  You can use 'internal/brain/launcher/Creer_Context_DeepSeek.bat' to build a context pack.")
        print("  Remember to review context_pack.md before sending it externally.")
    else:
        print("  STATUS: DeepSeek is NOT configured.")
        print("  You can still use Claude/Codex manually with v11_mission_package.md.")
        print("  To configure DeepSeek, see setup instructions below.")
        print()
        print(SETUP_INSTRUCTIONS)

    print()
    print("  PRIVACY REMINDER:")
    print("  Only context_pack.md is sent to external models.")
    print("  It contains Brain memory and outputs only -- no product code.")
    print("  Founder always reviews before sending anything externally.")
    print()


if __name__ == "__main__":
    main()
