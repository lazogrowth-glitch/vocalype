"""
model_route_decision.py — Vocalype Brain Operating Mode
========================================================
Given a task type, recommends which model/workflow to use and explains why.

Does NOT call any API. Does NOT send any files externally.
Outputs a recommendation to the terminal and to:
  vocalype-brain/outputs/model_route_decision.md

Usage:
  python vocalype-brain/scripts/model_route_decision.py
  python vocalype-brain/scripts/model_route_decision.py --task-type long_reasoning
  python vocalype-brain/scripts/model_route_decision.py --task-type product_implementation

Task types:
  simple_report           → local Ollama (fast, private)
  data_entry              → local Ollama or no LLM needed
  long_reasoning          → DeepSeek if configured, else Claude manual or local fallback
  product_implementation  → Claude/Codex manual — founder sends mission package
  sensitive_code          → Claude/Codex manual + explicit founder approval required
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BRAIN_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BRAIN_ROOT.parent
CONFIG_PATH = BRAIN_ROOT / "config" / "model_routing.json"
OUTPUT_PATH = BRAIN_ROOT / "outputs" / "model_route_decision.md"

# ---------------------------------------------------------------------------
# Routing table — matches task types to role + guidance
# ---------------------------------------------------------------------------
ROUTING: dict[str, dict] = {
    "simple_report": {
        "role": "local_fast",
        "model_hint": "qwen2.5:1.5b (local Ollama)",
        "privacy": "LOCAL — nothing leaves the machine",
        "requires_approval": False,
        "guidance": (
            "This task is routine and low-risk. Run it locally with Ollama.\n"
            "No external API needed. No founder approval required.\n"
            "Use: python vocalype-brain/scripts/generate_unified_report.py"
        ),
    },
    "data_entry": {
        "role": "local_fast",
        "model_hint": "No LLM required (template-based scripts)",
        "privacy": "LOCAL — nothing leaves the machine",
        "requires_approval": False,
        "guidance": (
            "Data entry tasks use direct CLI scripts — no LLM needed.\n"
            "Examples:\n"
            "  python vocalype-brain/scripts/add_benchmark_observation.py ...\n"
            "  python vocalype-brain/scripts/add_business_observation.py ...\n"
            "  python vocalype-brain/scripts/add_content_observation.py ..."
        ),
    },
    "long_reasoning": {
        "role": "deepseek_long_context",
        "model_hint": "DeepSeek if DEEPSEEK_API_KEY is set, otherwise Claude manual",
        "privacy": "EXTERNAL — only sends context_pack.md contents",
        "requires_approval": True,
        "guidance": (
            "This task needs long-context reasoning across multiple Brain files.\n\n"
            "OPTION A — DeepSeek API (if configured):\n"
            "  1. Run: python vocalype-brain/scripts/check_deepseek_setup.py\n"
            "  2. Run: python vocalype-brain/scripts/build_context_pack.py\n"
            "  3. Review context_pack.md (never send product code or secrets)\n"
            "  4. Paste context_pack.md into your DeepSeek session manually\n\n"
            "OPTION B — Claude manually (no API key needed):\n"
            "  1. Run: python vocalype-brain/scripts/build_context_pack.py\n"
            "  2. Review context_pack.md\n"
            "  3. Paste into claude.ai manually\n\n"
            "OPTION C — Local Ollama fallback (quality may be lower):\n"
            "  Use qwen3:8b with build_context_pack.py output as prompt."
        ),
    },
    "product_implementation": {
        "role": "external_implementation_manual",
        "model_hint": "Claude Code, Codex, or Aider — founder sends manually",
        "privacy": "EXTERNAL — only v11_mission_package.md is sent",
        "requires_approval": True,
        "guidance": (
            "Product implementation must be sent manually by the founder.\n\n"
            "STEPS:\n"
            "  1. Run: Generer_Mission_Claude.bat (or python vocalype-brain/scripts/generate_v11_mission_package.py)\n"
            "  2. Open: vocalype-brain/outputs/v11_mission_package.md\n"
            "  3. Review the mission package — confirm scope, forbidden files, stop conditions\n"
            "  4. Copy and paste into Claude Code, Codex, or Aider\n"
            "  5. Never send more than the mission package to the implementation model\n\n"
            "NEVER automate this step. Founder approval is mandatory."
        ),
    },
    "sensitive_code": {
        "role": "external_implementation_manual",
        "model_hint": "Claude Code, Codex, or Aider — explicit founder approval required",
        "privacy": "EXTERNAL — only approved mission package is sent",
        "requires_approval": True,
        "guidance": (
            "SENSITIVE CODE PATH — explicit founder approval required before any model.\n\n"
            "Sensitive areas (never automated):\n"
            "  - auth / license validation\n"
            "  - payment / billing logic\n"
            "  - security logic\n"
            "  - Rust dictation runtime (src-tauri/)\n"
            "  - audio capture runtime\n\n"
            "STEPS:\n"
            "  1. Confirm the task is in scope (operating_contract.md Section 6)\n"
            "  2. Get explicit per-session founder approval before proceeding\n"
            "  3. Generate a mission package with V11 (safety gates G5/G6 must pass)\n"
            "  4. Founder reviews and sends to implementation model manually\n"
            "  5. Founder reviews diff before commit\n\n"
            "If in doubt, classify as planning_only and diagnose first."
        ),
    },
}

# Aliases for convenience
ALIASES: dict[str, str] = {
    "report": "simple_report",
    "summary": "simple_report",
    "benchmark": "data_entry",
    "metrics": "data_entry",
    "business": "data_entry",
    "content": "data_entry",
    "reasoning": "long_reasoning",
    "analysis": "long_reasoning",
    "deepseek": "long_reasoning",
    "implementation": "product_implementation",
    "product": "product_implementation",
    "rust": "sensitive_code",
    "auth": "sensitive_code",
    "payment": "sensitive_code",
    "security": "sensitive_code",
}

VALID_TASK_TYPES = sorted(ROUTING.keys())


def _deepseek_configured() -> bool:
    """Check whether DEEPSEEK_API_KEY is set in the environment."""
    key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    return bool(key)


def _load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
    return {}


def route(task_type: str) -> dict:
    """Resolve task type (including aliases) and return routing info."""
    resolved = ALIASES.get(task_type.lower(), task_type.lower())
    if resolved not in ROUTING:
        return {
            "task_type": task_type,
            "resolved": resolved,
            "error": (
                f"Unknown task type: '{task_type}'.\n"
                f"Valid types: {', '.join(VALID_TASK_TYPES)}\n"
                f"Aliases: {', '.join(ALIASES.keys())}"
            ),
        }

    info = dict(ROUTING[resolved])
    info["task_type"] = task_type
    info["resolved"] = resolved

    # For long_reasoning, check whether DeepSeek is configured
    if resolved == "long_reasoning":
        info["deepseek_configured"] = _deepseek_configured()
        if not info["deepseek_configured"]:
            info["model_hint"] += " -- DEEPSEEK_API_KEY not set -> use Claude manually or local Ollama"

    return info


def _render_decision(info: dict) -> str:
    """Render the routing decision as a Markdown report."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines: list[str] = [
        "# Vocalype Brain — Model Route Decision\n\n",
        f"Generated: {timestamp}\n\n",
        "---\n\n",
    ]

    if "error" in info:
        lines.append(f"## Error\n\n{info['error']}\n")
        return "".join(lines)

    approval_flag = "⚠️ YES — founder review required" if info["requires_approval"] else "✅ NO — automated OK"

    lines += [
        f"## Task Type\n\n`{info['task_type']}`",
    ]
    if info["resolved"] != info["task_type"]:
        lines.append(f" (resolved from alias → `{info['resolved']}`)")
    lines.append("\n\n")

    lines += [
        f"## Recommended Route\n\n",
        f"| Field | Value |\n",
        f"|---|---|\n",
        f"| Role | `{info['role']}` |\n",
        f"| Model | {info['model_hint']} |\n",
        f"| Privacy | {info['privacy']} |\n",
        f"| Requires founder approval | {approval_flag} |\n",
    ]
    if info.get("resolved") == "long_reasoning":
        ds = "✅ configured" if info.get("deepseek_configured") else "❌ DEEPSEEK_API_KEY not set"
        lines.append(f"| DeepSeek status | {ds} |\n")
    lines.append("\n")

    lines += [
        f"## Guidance\n\n",
        f"{info['guidance']}\n\n",
    ]

    lines += [
        "---\n\n",
        "## Safety Reminder\n\n",
        "- Never send product code (`src-tauri/`, `src/`, `backend/`) to an external model\n",
        "- Never send secrets, API keys, `.env` files, or auth/payment/security files\n",
        "- For external models: only send `context_pack.md` or `v11_mission_package.md`\n",
        "- Founder always reviews before sending any file externally\n",
    ]

    return "".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Recommend which model/workflow to use for a given task type."
    )
    parser.add_argument(
        "--task-type",
        metavar="TYPE",
        default=None,
        help=(
            f"Task type. Valid: {', '.join(VALID_TASK_TYPES)}. "
            f"If omitted, prints the full routing table."
        ),
    )
    args = parser.parse_args()

    if args.task_type is None:
        print("Vocalype Brain — Model Routing Table")
        print("=" * 50)
        for tt, info in ROUTING.items():
            print(f"\n  {tt}")
            print(f"    → {info['role']}  |  {info['model_hint']}")
            print(f"    privacy: {info['privacy']}")
        print()
        print(f"  Valid task types: {', '.join(VALID_TASK_TYPES)}")
        print(f"  Aliases: {', '.join(ALIASES.keys())}")
        return

    info = route(args.task_type)

    if "error" in info:
        print(f"ERROR: {info['error']}", file=sys.stderr)
        sys.exit(1)

    # Print to terminal
    def _p(text: str) -> None:
        """Print safely, replacing unencodable chars with ASCII equivalents."""
        safe = (
            text.replace("→", "->")
                .replace("—", "--")
                .replace("✓", "OK")
                .replace("❌", "NO")
                .replace("⚠", "(!)")
                .replace("✅", "OK")
        )
        print(safe)

    _p(f"\nTask type     : {info['task_type']}")
    if info["resolved"] != info["task_type"]:
        _p(f"Resolved      : {info['resolved']}")
    _p(f"Role          : {info['role']}")
    _p(f"Model         : {info['model_hint']}")
    _p(f"Privacy       : {info['privacy']}")
    _p(f"Needs approval: {'YES' if info['requires_approval'] else 'NO'}")
    if info.get("resolved") == "long_reasoning":
        ds = "YES" if info.get("deepseek_configured") else "NO (DEEPSEEK_API_KEY not set)"
        _p(f"DeepSeek ready: {ds}")
    print()
    print("Guidance:")
    for line in info["guidance"].splitlines():
        _p(f"  {line}")
    print()

    # Write report
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(_render_decision(info), encoding="utf-8")
    print(f"Report written: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
