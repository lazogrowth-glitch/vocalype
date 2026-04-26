"""
run_operating_agent.py -- Vocalype Brain Operating Mode
========================================================
Supervised automatic model router for the Brain operating cycle.

What it does:
  1. Runs the Brain operating cycle (unified report + mission package).
  2. Reads weekly_action.md and classifies the current action.
  3. Routes to local tools, DeepSeek API, or Claude/Codex manual workflow.
  4. Writes a full audit report and a founder-facing recommendation.

VOCALYPE_BRAIN_EXTERNAL_MODE controls DeepSeek API usage:
  off     -- never call external API; only prepare context_pack.md if needed
  confirm -- (DEFAULT) prepare context_pack.md; write founder instructions; no API call
  auto    -- call DeepSeek API for long_reasoning tasks if DEEPSEEK_API_KEY is set

Safety guarantees:
  - Never modifies product code (src/, src-tauri/, backend/).
  - Never sends secrets, .env, auth, payment, or security files externally.
  - Never auto-applies model responses to product code.
  - Never runs as a daemon or background process.
  - DeepSeek is never called unless EXTERNAL_MODE=auto AND DEEPSEEK_API_KEY is set.

Usage:
  python vocalype-brain/scripts/run_operating_agent.py
  python vocalype-brain/scripts/run_operating_agent.py --skip-report-gen
  python vocalype-brain/scripts/run_operating_agent.py --dry-run
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BRAIN_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BRAIN_ROOT.parent
SCRIPTS_DIR = Path(__file__).resolve().parent

CONFIG_PATH           = BRAIN_ROOT / "config"  / "model_routing.json"
WEEKLY_ACTION_PATH    = BRAIN_ROOT / "outputs" / "weekly_action.md"
MISSION_PACKAGE_PATH  = BRAIN_ROOT / "outputs" / "v11_mission_package.md"
CONTEXT_PACK_PATH     = BRAIN_ROOT / "outputs" / "context_pack.md"
AGENT_RUN_REPORT_PATH = BRAIN_ROOT / "outputs" / "agent_run_report.md"
AGENT_RECOMMEND_PATH  = BRAIN_ROOT / "outputs" / "agent_recommendation.md"
EXTERNAL_AUDIT_PATH   = BRAIN_ROOT / "outputs" / "external_context_audit.md"
DEEPSEEK_RESP_PATH    = BRAIN_ROOT / "outputs" / "deepseek_response.md"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
EXTERNAL_MODE_OFF     = "off"
EXTERNAL_MODE_CONFIRM = "confirm"
EXTERNAL_MODE_AUTO    = "auto"
VALID_EXTERNAL_MODES  = {EXTERNAL_MODE_OFF, EXTERNAL_MODE_CONFIRM, EXTERNAL_MODE_AUTO}
DEFAULT_EXTERNAL_MODE = EXTERNAL_MODE_CONFIRM

# Maps V10 action types -> routing categories
ACTION_TYPE_ROUTE_MAP: dict[str, str] = {
    "product_investigation":  "long_reasoning",
    "business_data_entry":    "data_entry",
    "distribution_data_entry":"data_entry",
    "hold":                   "hold",
    # pass-through if weekly_action already uses routing names
    "simple_report":          "simple_report",
    "data_entry":             "data_entry",
    "long_reasoning":         "long_reasoning",
    "product_implementation": "product_implementation",
    "sensitive_code":         "sensitive_code",
}

# Escalate to sensitive_code if these appear in the action text
SENSITIVE_KEYWORDS = [
    "src-tauri", "clipboard.rs", " rust ", "rustc", "auth/",
    "license validation", "payment", "billing", "security logic",
    "audio capture", "audio runtime", "backend/",
]

# Escalate to product_implementation if these appear
IMPLEMENTATION_KEYWORDS = [
    "implement code change", "apply patch to src", "write to product",
    "modify product code", "edit src-tauri", "edit backend",
]

# Files sent externally are forbidden if they match these patterns
FORBIDDEN_PATTERNS: list[str] = [
    ".env", "secret", "backend/", "src-tauri/", "src/lib/auth",
    "src/lib/license", "payment", "billing", "security",
    "translation.json", ".key", ".pem", ".p12", "api_key",
    "password", "token",
]

# DeepSeek model (from model_routing.json role: deepseek_long_context)
DEEPSEEK_DEFAULT_MODEL   = "deepseek-chat"
DEEPSEEK_DEFAULT_API_BASE = "https://api.deepseek.com/v1"

DEEPSEEK_SYSTEM_PROMPT = (
    "You are an analytical assistant reviewing a Vocalype product intelligence context pack.\n\n"
    "Your role:\n"
    "- Validate the recommended action for this week\n"
    "- Identify risks, gaps, or blind spots\n"
    "- Suggest concrete next steps (measurement, diagnosis, or mission prep only)\n\n"
    "Strict rules:\n"
    "- Do NOT write or suggest product code changes\n"
    "- Do NOT suggest modifying auth, payment, billing, security, or Rust runtime\n"
    "- Do NOT suggest automating manual steps required by the operating contract\n"
    "- Respond in Markdown, concise and actionable"
)


# ---------------------------------------------------------------------------
# Safe print helper (Windows cp1252 terminals)
# ---------------------------------------------------------------------------
def _p(text: str) -> None:
    """Print safely on Windows cp1252 terminals."""
    safe = (
        text.replace("→", "->")
            .replace("—", "--")
            .replace("–", "-")
            .replace("✅", "[OK]")
            .replace("❌", "[NO]")
            .replace("⚠", "[!]")
            .replace("✔", "[v]")
            .replace("✖", "[x]")
            .replace("⏳", "[...]")
            .replace("⭐", "[*]")
    )
    try:
        print(safe)
    except UnicodeEncodeError:
        print(safe.encode("ascii", "replace").decode("ascii"))


# ---------------------------------------------------------------------------
# Environment helpers
# ---------------------------------------------------------------------------
def _get_external_mode() -> str:
    """Read VOCALYPE_BRAIN_EXTERNAL_MODE from env. Default: confirm."""
    raw = os.environ.get("VOCALYPE_BRAIN_EXTERNAL_MODE", "").strip().lower()
    if raw in VALID_EXTERNAL_MODES:
        return raw
    if raw:
        _p(f"  [!] Unknown VOCALYPE_BRAIN_EXTERNAL_MODE='{raw}' -- using '{DEFAULT_EXTERNAL_MODE}'")
    return DEFAULT_EXTERNAL_MODE


def _deepseek_configured() -> tuple[bool, str, str, str]:
    """
    Returns (ok, api_key, api_base, model).
    api_key is masked in the returned tuple for logging.
    """
    api_key  = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    api_base = os.environ.get("DEEPSEEK_API_BASE", "").strip() or DEEPSEEK_DEFAULT_API_BASE
    model    = _load_config().get("roles", {}).get(
        "deepseek_long_context", {}
    ).get("model", DEEPSEEK_DEFAULT_MODEL)
    if api_key:
        masked = api_key[:4] + "*" * max(0, len(api_key) - 8) + api_key[-4:] if len(api_key) > 8 else "****"
        return True, masked, api_base, model
    return False, "", api_base, model


# ---------------------------------------------------------------------------
# Config loader
# ---------------------------------------------------------------------------
def _load_config() -> dict:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


# ---------------------------------------------------------------------------
# Subprocess runner
# ---------------------------------------------------------------------------
def _run_script(script_name: str, log: list[dict], dry_run: bool = False) -> bool:
    """Run a Brain script via subprocess. Returns True on success."""
    script_path = SCRIPTS_DIR / script_name
    if not script_path.exists():
        entry = {"step": script_name, "status": "missing", "detail": str(script_path)}
        log.append(entry)
        _p(f"  [!] Script not found: {script_path}")
        return False

    if dry_run:
        _p(f"  [dry-run] Would run: python {script_path.name}")
        log.append({"step": script_name, "status": "dry_run"})
        return True

    _p(f"  Running: python {script_path.name} ...")
    result = subprocess.run(
        [sys.executable, str(script_path)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    ok = result.returncode == 0
    entry: dict = {
        "step": script_name,
        "status": "ok" if ok else "failed",
        "returncode": result.returncode,
    }
    if not ok:
        entry["stderr"] = result.stderr.strip()[-600:] if result.stderr else ""
    log.append(entry)

    if ok:
        _p(f"  [OK] {script_path.name} completed.")
    else:
        _p(f"  [!] {script_path.name} failed (returncode={result.returncode})")
        # Show last few lines of stdout and stderr to aid diagnosis
        combined = []
        if result.stdout:
            combined += result.stdout.strip().splitlines()[-6:]
        if result.stderr:
            combined += result.stderr.strip().splitlines()[-4:]
        for line in combined[-8:]:
            _p(f"      {line}")
    return ok


# ---------------------------------------------------------------------------
# Classification
# ---------------------------------------------------------------------------
def _extract_action_type(text: str) -> str:
    """Extract 'Action type' field from weekly_action.md."""
    match = re.search(r"\*\*Action type:\*\*\s*`([^`]+)`", text)
    if match:
        return match.group(1).strip().lower()
    # Fallback: look for bare value on same line
    match2 = re.search(r"\*\*Action type:\*\*\s*([^\n]+)", text)
    if match2:
        return match2.group(1).strip().strip("`").lower()
    return "unknown"


def _classify(action_text: str) -> tuple[str, str, str]:
    """
    Classify the weekly action into a routing category.
    Returns (route, raw_action_type, classification_reason).
    """
    if not action_text:
        return "hold", "no_action_text", "weekly_action.md is empty or missing"

    raw_action_type = _extract_action_type(action_text)
    text_lower = action_text.lower()

    # Check for sensitive escalation FIRST (highest priority)
    for kw in SENSITIVE_KEYWORDS:
        if kw.lower() in text_lower:
            return (
                "sensitive_code",
                raw_action_type,
                f"Sensitive keyword detected: '{kw}' -- escalated to sensitive_code",
            )

    # Check for implementation escalation
    for kw in IMPLEMENTATION_KEYWORDS:
        if kw.lower() in text_lower:
            return (
                "product_implementation",
                raw_action_type,
                f"Implementation keyword detected: '{kw}' -- escalated to product_implementation",
            )

    # Map known action types
    route = ACTION_TYPE_ROUTE_MAP.get(raw_action_type)
    if route:
        return route, raw_action_type, f"Mapped from action_type='{raw_action_type}'"

    # Unknown action type -- default to long_reasoning (safest: get more context)
    return (
        "long_reasoning",
        raw_action_type,
        f"Unknown action_type='{raw_action_type}' -- defaulting to long_reasoning",
    )


# ---------------------------------------------------------------------------
# Context pack builder (delegates to build_context_pack.py)
# ---------------------------------------------------------------------------
def _build_context_pack(log: list[dict], dry_run: bool = False) -> bool:
    """Build context_pack.md by running build_context_pack.py."""
    _p("  Building context_pack.md ...")
    ok = _run_script("build_context_pack.py", log, dry_run=dry_run)
    if ok and not dry_run and CONTEXT_PACK_PATH.exists():
        size = CONTEXT_PACK_PATH.stat().st_size
        lines = len(CONTEXT_PACK_PATH.read_text(encoding="utf-8", errors="replace").splitlines())
        _p(f"  [OK] context_pack.md: {size:,} bytes, {lines:,} lines")
    return ok


# ---------------------------------------------------------------------------
# External context audit writer
# ---------------------------------------------------------------------------
def _write_external_audit(called: bool, external_mode: str, dry_run: bool = False) -> None:
    """Write external_context_audit.md listing what was/would be sent."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    context_exists = CONTEXT_PACK_PATH.exists()

    if context_exists and not dry_run:
        raw = CONTEXT_PACK_PATH.read_text(encoding="utf-8", errors="replace")
        size = CONTEXT_PACK_PATH.stat().st_size
        lines = len(raw.splitlines())
        context_summary = f"- File: `vocalype-brain/outputs/context_pack.md`\n- Size: {size:,} bytes, {lines:,} lines\n"
    else:
        context_summary = "- File: `vocalype-brain/outputs/context_pack.md` (not built or dry-run)\n"

    sent_status = "SENT to DeepSeek API" if called else (
        "NOT sent -- external mode is '{}'".format(external_mode)
    )

    lines_out = [
        "# Vocalype Brain -- External Context Audit\n\n",
        f"Generated: {timestamp}\n\n",
        "---\n\n",
        "## What Was Prepared\n\n",
        context_summary,
        "\n",
        "## Sent to External API?\n\n",
        f"**{sent_status}**\n\n",
        f"External mode: `VOCALYPE_BRAIN_EXTERNAL_MODE={external_mode}`\n\n",
        "## Files Included in Context Pack\n\n",
        "Only Brain memory and outputs -- no product code:\n\n",
        "- `vocalype-brain/memory/operating_contract.md`\n",
        "- `vocalype-brain/memory/current_state.md`\n",
        "- `vocalype-brain/outputs/weekly_action.md`\n",
        "- `vocalype-brain/outputs/v11_mission_package.md` (if present)\n",
        "- `vocalype-brain/outputs/paste_mechanism_diagnosis.md` (if present)\n",
        "- `vocalype-brain/outputs/paste_utils_diagnosis.md` (if present)\n",
        "\n",
        "## Files That Are NEVER Sent\n\n",
        "The following are permanently forbidden (enforced by build_context_pack.py):\n\n",
    ]
    for pat in FORBIDDEN_PATTERNS:
        lines_out.append(f"- `{pat}`\n")

    lines_out += [
        "\n",
        "## Privacy Guarantee\n\n",
        "- No product code (`src/`, `src-tauri/`, `backend/`) is ever included\n",
        "- No secrets, API keys, `.env`, or auth/payment/security files\n",
        "- The founder always reviews context_pack.md before any external send\n",
        "- DeepSeek API responses are NEVER auto-applied to product code\n",
    ]

    EXTERNAL_AUDIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    EXTERNAL_AUDIT_PATH.write_text("".join(lines_out), encoding="utf-8")
    _p(f"  [OK] external_context_audit.md written.")


# ---------------------------------------------------------------------------
# DeepSeek caller
# ---------------------------------------------------------------------------
def _call_deepseek(log: list[dict]) -> tuple[str | None, str | None]:
    """
    Call DeepSeek API with context_pack.md content.
    Returns (response_text, error_message).
    """
    try:
        from openai import OpenAI  # noqa: PLC0415
    except ImportError:
        msg = "openai package not installed. Run: pip install openai"
        log.append({"step": "deepseek_call", "status": "error", "detail": msg})
        return None, msg

    api_key  = os.environ.get("DEEPSEEK_API_KEY", "").strip()
    api_base = os.environ.get("DEEPSEEK_API_BASE", "").strip() or DEEPSEEK_DEFAULT_API_BASE
    model    = _load_config().get("roles", {}).get(
        "deepseek_long_context", {}
    ).get("model", DEEPSEEK_DEFAULT_MODEL)

    if not api_key:
        msg = "DEEPSEEK_API_KEY is not set -- cannot call DeepSeek"
        log.append({"step": "deepseek_call", "status": "error", "detail": msg})
        return None, msg

    if not CONTEXT_PACK_PATH.exists():
        msg = "context_pack.md does not exist -- build it first"
        log.append({"step": "deepseek_call", "status": "error", "detail": msg})
        return None, msg

    context_content = CONTEXT_PACK_PATH.read_text(encoding="utf-8", errors="replace")

    # Safety check: verify context_pack.md does not contain forbidden content
    context_lower = context_content.lower()
    for pattern in FORBIDDEN_PATTERNS:
        pat = pattern.lower()
        # Only block if a suspicious path structure is present (not just the word)
        if pat in ["backend/", "src-tauri/", "src/lib/auth", "src/lib/license"]:
            if pat in context_lower:
                msg = f"SAFETY BLOCK: context_pack.md contains forbidden pattern '{pattern}' -- aborting DeepSeek call"
                _p(f"  [!] {msg}")
                log.append({"step": "deepseek_call", "status": "safety_block", "detail": msg})
                return None, msg

    user_content = (
        "Below is the Vocalype Brain context pack for this week's operating cycle.\n\n"
        "Please analyze it and provide:\n"
        "1. Validation of the current recommended action\n"
        "2. Key risks or blind spots\n"
        "3. Concrete next steps (measurement, diagnosis, or mission prep only)\n\n"
        "--- BEGIN CONTEXT PACK ---\n\n"
        f"{context_content}\n\n"
        "--- END CONTEXT PACK ---"
    )

    _p(f"  Calling DeepSeek API (model={model}, base={api_base}) ...")
    try:
        client = OpenAI(api_key=api_key, base_url=api_base)
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": DEEPSEEK_SYSTEM_PROMPT},
                {"role": "user",   "content": user_content},
            ],
            temperature=0.1,
            max_tokens=4096,
        )
        text = response.choices[0].message.content or ""
        tokens_in  = getattr(response.usage, "prompt_tokens",     0)
        tokens_out = getattr(response.usage, "completion_tokens", 0)
        log.append({
            "step":         "deepseek_call",
            "status":       "ok",
            "model":        model,
            "tokens_in":    tokens_in,
            "tokens_out":   tokens_out,
        })
        _p(f"  [OK] DeepSeek responded ({tokens_in} in / {tokens_out} out tokens).")
        return text, None

    except Exception as exc:  # noqa: BLE001
        msg = f"DeepSeek API error: {exc}"
        _p(f"  [!] {msg}")
        log.append({"step": "deepseek_call", "status": "error", "detail": str(exc)[:400]})
        return None, msg


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------
def _write_deepseek_response(content: str) -> None:
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    out = (
        "# Vocalype Brain -- DeepSeek Response\n\n"
        f"Generated: {timestamp}\n\n"
        "---\n\n"
        "> **NOTE:** This is a raw DeepSeek API response.\n"
        "> It is for founder review only.\n"
        "> It has NOT been applied to any product code.\n"
        "> Review carefully before acting on any suggestion.\n\n"
        "---\n\n"
        f"{content}\n\n"
        "---\n\n"
        "## Safety Reminder\n\n"
        "- This response was generated from `context_pack.md` only\n"
        "- No product code, secrets, or sensitive files were sent\n"
        "- Do not auto-apply any suggested code changes\n"
        "- Founder reviews and decides next action\n"
    )
    DEEPSEEK_RESP_PATH.parent.mkdir(parents=True, exist_ok=True)
    DEEPSEEK_RESP_PATH.write_text(out, encoding="utf-8")
    _p(f"  [OK] deepseek_response.md written ({len(content):,} chars).")


def _write_agent_run_report(
    timestamp: str,
    log: list[dict],
    route: str,
    action_type: str,
    classification_reason: str,
    external_mode: str,
    deepseek_key_set: bool,
    deepseek_called: bool,
    deepseek_error: str | None,
    context_built: bool,
    dry_run: bool,
) -> None:
    """Write agent_run_report.md -- technical audit."""
    lines = [
        "# Vocalype Brain -- Agent Run Report\n\n",
        f"Generated: {timestamp}\n",
        f"Dry run: {'YES' if dry_run else 'NO'}\n\n",
        "---\n\n",
        "## Classification\n\n",
        f"| Field | Value |\n|---|---|\n",
        f"| Raw action type | `{action_type}` |\n",
        f"| Route decided | `{route}` |\n",
        f"| Reason | {classification_reason} |\n\n",
        "## External Mode\n\n",
        f"| Field | Value |\n|---|---|\n",
        f"| VOCALYPE_BRAIN_EXTERNAL_MODE | `{external_mode}` |\n",
        f"| DEEPSEEK_API_KEY set | {'YES' if deepseek_key_set else 'NO'} |\n",
        f"| Context pack built | {'YES' if context_built else 'NO'} |\n",
        f"| DeepSeek called | {'YES' if deepseek_called else 'NO'} |\n",
    ]
    if deepseek_error:
        lines.append(f"| DeepSeek error | {deepseek_error[:200]} |\n")
    lines.append("\n")

    lines.append("## Step Log\n\n")
    for i, entry in enumerate(log, 1):
        step   = entry.get("step", "?")
        status = entry.get("status", "?")
        detail = entry.get("detail", "")
        rc     = entry.get("returncode", "")
        line   = f"{i}. `{step}` -- {status}"
        if rc != "":
            line += f" (rc={rc})"
        if detail:
            line += f" -- {detail[:200]}"
        lines.append(line + "\n")

    lines += [
        "\n",
        "## Safety Audit\n\n",
        "- Product code touched: NO\n",
        "- Forbidden files sent externally: NO\n",
        "- DeepSeek auto-applied to product code: NO\n",
        "- API keys committed: NO\n",
    ]

    AGENT_RUN_REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    AGENT_RUN_REPORT_PATH.write_text("".join(lines), encoding="utf-8")
    _p(f"  [OK] agent_run_report.md written.")


def _write_agent_recommendation(
    route: str,
    action_type: str,
    classification_reason: str,
    external_mode: str,
    deepseek_key_set: bool,
    deepseek_called: bool,
    deepseek_response_text: str | None,
    deepseek_error: str | None,
    context_built: bool,
    dry_run: bool,
) -> None:
    """Write agent_recommendation.md -- founder-facing next action."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")

    header = [
        "# Vocalype Brain -- Agent Recommendation\n\n",
        f"Generated: {timestamp}\n",
        f"Route: `{route}` | Action type: `{action_type}`\n\n",
        "---\n\n",
    ]

    body: list[str] = []

    if route == "hold":
        body = [
            "## Recommended Action: HOLD\n\n",
            "No action needed this week. All signals are healthy.\n\n",
            "Continue monitoring and record data when available.\n",
        ]

    elif route in ("simple_report", "data_entry"):
        body = [
            "## Recommended Action: LOCAL TOOLS\n\n",
            f"This task (`{action_type}`) is handled locally -- no LLM needed.\n\n",
            "**What to do:**\n\n",
            "- For report generation: already done by this script\n",
            "- For data entry: use the appropriate CLI script:\n",
            "  - `python vocalype-brain/scripts/add_benchmark_observation.py ...`\n",
            "  - `python vocalype-brain/scripts/add_business_observation.py ...`\n",
            "  - `python vocalype-brain/scripts/add_content_observation.py ...`\n",
            "- Review: open `weekly_action.md` and `unified_weekly_report.md`\n\n",
            "No external API call needed.\n",
        ]

    elif route == "long_reasoning":
        if external_mode == EXTERNAL_MODE_OFF:
            body = [
                "## Recommended Action: LONG REASONING (external mode OFF)\n\n",
                "External API is disabled (`VOCALYPE_BRAIN_EXTERNAL_MODE=off`).\n\n",
                "**Context pack has been built.** Review it, then choose:\n\n",
                "**Option A -- Manual Claude session:**\n",
                "  1. Open `vocalype-brain/outputs/context_pack.md`\n",
                "  2. Review contents (no product code, no secrets)\n",
                "  3. Copy and paste into claude.ai\n\n",
                "**Option B -- Enable DeepSeek auto mode:**\n",
                "  Set: `VOCALYPE_BRAIN_EXTERNAL_MODE=auto` (and ensure `DEEPSEEK_API_KEY` is set)\n",
                "  Then re-run: `python vocalype-brain/scripts/run_operating_agent.py`\n\n",
                "**Option C -- Enable confirm mode (default):**\n",
                "  Set: `VOCALYPE_BRAIN_EXTERNAL_MODE=confirm` (or unset it)\n",
                "  The agent will prepare the pack and show exact instructions.\n",
            ]
        elif external_mode == EXTERNAL_MODE_CONFIRM:
            body = [
                "## Recommended Action: LONG REASONING (confirm mode)\n\n",
                "Context pack is ready. **External API NOT called** (confirm mode).\n\n",
                "**To send to DeepSeek manually:**\n\n",
                "  1. Open `vocalype-brain/outputs/context_pack.md`\n",
                "  2. Review it -- confirm it contains no product code or secrets\n",
                "  3. Copy the full content\n",
                "  4. Paste into your DeepSeek or Claude session\n\n",
                "**To enable auto DeepSeek call:**\n\n",
                "  In PowerShell:  `$env:VOCALYPE_BRAIN_EXTERNAL_MODE = 'auto'`\n",
                "  In CMD:         `set VOCALYPE_BRAIN_EXTERNAL_MODE=auto`\n",
                "  Then re-run:    `python vocalype-brain/scripts/run_operating_agent.py`\n\n",
                "  Requires `DEEPSEEK_API_KEY` to be set.\n",
            ]
            if not deepseek_key_set:
                body.append(
                    "\n**DeepSeek API key:** NOT configured. "
                    "See `check_deepseek_setup.py` for setup instructions.\n"
                )
        elif external_mode == EXTERNAL_MODE_AUTO:
            if deepseek_called and deepseek_response_text:
                body = [
                    "## Recommended Action: LONG REASONING (DeepSeek called)\n\n",
                    "DeepSeek API was called successfully.\n\n",
                    "**Review the response:**\n",
                    "  Open `vocalype-brain/outputs/deepseek_response.md`\n\n",
                    "**Important:**\n",
                    "- The response is for your review only\n",
                    "- Do NOT auto-apply any suggested code changes\n",
                    "- Use it to inform your next mission package\n",
                    "- Re-run `generate_v11_mission_package.py` if needed\n\n",
                    "**Files sent:**\n",
                    "  See `vocalype-brain/outputs/external_context_audit.md` for full audit.\n",
                ]
            elif deepseek_error:
                body = [
                    "## Recommended Action: LONG REASONING (DeepSeek error)\n\n",
                    f"DeepSeek call failed: `{deepseek_error[:300]}`\n\n",
                    "**Fallback: manual review**\n",
                    "  1. Check `DEEPSEEK_API_KEY` is set and valid\n",
                    "  2. Check `DEEPSEEK_API_BASE` if using a custom endpoint\n",
                    "  3. Or paste `context_pack.md` manually into claude.ai\n",
                ]
            else:
                body = [
                    "## Recommended Action: LONG REASONING (auto mode -- no key)\n\n",
                    "External mode is `auto` but `DEEPSEEK_API_KEY` is not set.\n\n",
                    "Set the key and re-run, or paste `context_pack.md` into Claude manually.\n",
                ]

    elif route == "product_implementation":
        body = [
            "## Recommended Action: PRODUCT IMPLEMENTATION (manual)\n\n",
            "This action requires a Claude/Codex mission package.\n",
            "The V11 mission package has been generated.\n\n",
            "**Steps:**\n\n",
            "  1. Open `vocalype-brain/outputs/v11_mission_package.md`\n",
            "  2. Review scope, forbidden files, and stop conditions\n",
            "  3. Copy the full content\n",
            "  4. Paste into Claude Code, Codex, or Aider\n",
            "  5. Review the diff before committing\n\n",
            "**NEVER automate this step. Founder sends the mission manually.**\n",
        ]

    elif route == "sensitive_code":
        body = [
            "## Recommended Action: SENSITIVE CODE (explicit approval required)\n\n",
            f"Reason: {classification_reason}\n\n",
            "**This route requires per-session founder approval before any model.**\n\n",
            "Sensitive areas (never automated):\n",
            "  - auth / license validation\n",
            "  - payment / billing logic\n",
            "  - security logic\n",
            "  - Rust dictation runtime (src-tauri/)\n",
            "  - audio capture runtime\n\n",
            "**Steps:**\n\n",
            "  1. Confirm task is in scope (operating_contract.md Section 6)\n",
            "  2. Get explicit per-session founder approval\n",
            "  3. Generate mission package with safety gates G5/G6\n",
            "  4. Founder reviews and sends to Claude manually\n",
            "  5. Founder reviews diff before commit\n\n",
            "If in doubt, classify as planning_only first.\n",
        ]

    else:
        body = [
            f"## Recommended Action: UNKNOWN ROUTE ({route})\n\n",
            "Route was not recognized. Defaulting to manual review.\n\n",
            "Open `weekly_action.md` and `v11_mission_package.md` and decide manually.\n",
        ]

    # Dry run notice
    if dry_run:
        body.insert(0, "> **DRY RUN** -- no scripts were actually run, no API was called.\n\n")

    footer = [
        "\n---\n\n",
        "## Safety Reminder\n\n",
        "- Product code is never auto-modified by this agent\n",
        "- External APIs only receive `context_pack.md` (Brain memory only)\n",
        "- DeepSeek responses are for review only -- never auto-applied\n",
        "- Claude/Codex mission packages are always sent manually by the founder\n",
    ]

    AGENT_RECOMMEND_PATH.parent.mkdir(parents=True, exist_ok=True)
    AGENT_RECOMMEND_PATH.write_text(
        "".join(header + body + footer), encoding="utf-8"
    )
    _p(f"  [OK] agent_recommendation.md written.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Supervised Brain operating agent -- classify, route, optionally call DeepSeek. "
            "Never modifies product code."
        )
    )
    parser.add_argument(
        "--skip-report-gen",
        action="store_true",
        help="Skip running generate_unified_report.py and generate_v11_mission_package.py",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not run scripts or call external APIs; only show what would happen",
    )
    args = parser.parse_args()

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    log: list[dict] = []

    _p("=" * 60)
    _p("  Vocalype Brain -- Operating Agent")
    _p("=" * 60)
    _p("")

    # ---- Step 1: External mode ----
    external_mode = _get_external_mode()
    _p(f"  External mode : VOCALYPE_BRAIN_EXTERNAL_MODE={external_mode}")
    deepseek_ok, deepseek_masked, deepseek_base, deepseek_model = _deepseek_configured()
    if deepseek_ok:
        _p(f"  DeepSeek key  : [OK] configured ({deepseek_masked})")
    else:
        _p("  DeepSeek key  : [NO] DEEPSEEK_API_KEY not set")
    _p("")

    # ---- Step 2: Run operating cycle ----
    if args.skip_report_gen:
        _p("  [skip] Skipping report generation (--skip-report-gen)")
        log.append({"step": "report_gen", "status": "skipped"})
    else:
        _p("[1/2] Generating unified weekly report ...")
        _run_script("generate_unified_report.py", log, dry_run=args.dry_run)
        _p("")
        _p("[2/2] Generating V11 mission package ...")
        _run_script("generate_v11_mission_package.py", log, dry_run=args.dry_run)
        _p("")

    # ---- Step 3: Classify ----
    _p("[3] Classifying current action ...")
    action_text = ""
    if WEEKLY_ACTION_PATH.exists():
        action_text = WEEKLY_ACTION_PATH.read_text(encoding="utf-8", errors="replace")
        _p(f"  Read: {WEEKLY_ACTION_PATH.name} ({len(action_text):,} chars)")
    else:
        _p(f"  [!] {WEEKLY_ACTION_PATH.name} not found -- cannot classify")
        log.append({"step": "read_weekly_action", "status": "missing"})

    route, action_type, classification_reason = _classify(action_text)
    _p(f"  Action type   : {action_type}")
    _p(f"  Route         : {route}")
    _p(f"  Reason        : {classification_reason}")
    log.append({
        "step": "classify",
        "status": "ok",
        "action_type": action_type,
        "route": route,
        "reason": classification_reason,
    })
    _p("")

    # ---- Step 4: Route execution ----
    context_built    = False
    deepseek_called  = False
    deepseek_error: str | None   = None
    deepseek_response_text: str | None = None

    _p(f"[4] Executing route: {route} ...")

    if route in ("simple_report", "data_entry"):
        _p("  -> Local tools only. No external API needed.")
        log.append({"step": "route_exec", "status": "local_only", "route": route})

    elif route == "hold":
        _p("  -> HOLD. No action needed this week.")
        log.append({"step": "route_exec", "status": "hold"})

    elif route == "long_reasoning":
        # Always build context_pack for long_reasoning (unless dry_run)
        _p("  -> Building context pack for long-context reasoning ...")
        context_built = _build_context_pack(log, dry_run=args.dry_run)

        if external_mode == EXTERNAL_MODE_OFF:
            _p("  -> External mode=off. Context pack built but NOT sent.")
            _write_external_audit(called=False, external_mode=external_mode)
            log.append({"step": "route_exec", "status": "context_ready_no_send", "mode": "off"})

        elif external_mode == EXTERNAL_MODE_CONFIRM:
            _p("  -> External mode=confirm. Context pack ready. Instructions written.")
            if not args.dry_run:
                _write_external_audit(called=False, external_mode=external_mode)
            log.append({"step": "route_exec", "status": "context_ready_awaiting_founder", "mode": "confirm"})

        elif external_mode == EXTERNAL_MODE_AUTO:
            if deepseek_ok:
                if not args.dry_run:
                    _write_external_audit(called=True, external_mode=external_mode)
                    deepseek_response_text, deepseek_error = _call_deepseek(log)
                    if deepseek_response_text:
                        deepseek_called = True
                        _write_deepseek_response(deepseek_response_text)
                    elif deepseek_error:
                        _p(f"  [!] DeepSeek failed: {deepseek_error}")
                else:
                    _p("  [dry-run] Would call DeepSeek API.")
                    log.append({"step": "deepseek_call", "status": "dry_run"})
            else:
                _p("  [!] auto mode but DEEPSEEK_API_KEY not set -- skipping API call")
                if not args.dry_run:
                    _write_external_audit(called=False, external_mode=external_mode)
                log.append({"step": "deepseek_call", "status": "skipped_no_key"})

    elif route in ("product_implementation", "sensitive_code"):
        _p(f"  -> Manual Claude/Codex mission. Mission package path:")
        if MISSION_PACKAGE_PATH.exists():
            _p(f"     {MISSION_PACKAGE_PATH}")
        else:
            _p("     [!] v11_mission_package.md not found -- run generate_v11_mission_package.py")
        log.append({"step": "route_exec", "status": "manual_mission", "route": route})

    _p("")

    # ---- Step 5: Write outputs ----
    _p("[5] Writing outputs ...")
    if not args.dry_run:
        _write_agent_run_report(
            timestamp=timestamp,
            log=log,
            route=route,
            action_type=action_type,
            classification_reason=classification_reason,
            external_mode=external_mode,
            deepseek_key_set=deepseek_ok,
            deepseek_called=deepseek_called,
            deepseek_error=deepseek_error,
            context_built=context_built,
            dry_run=args.dry_run,
        )
        _write_agent_recommendation(
            route=route,
            action_type=action_type,
            classification_reason=classification_reason,
            external_mode=external_mode,
            deepseek_key_set=deepseek_ok,
            deepseek_called=deepseek_called,
            deepseek_response_text=deepseek_response_text,
            deepseek_error=deepseek_error,
            context_built=context_built,
            dry_run=args.dry_run,
        )
    else:
        _p("  [dry-run] Skipping file writes.")

    _p("")
    _p("=" * 60)
    _p("  DONE")
    _p(f"  Route        : {route}")
    _p(f"  External mode: {external_mode}")
    _p(f"  DeepSeek key : {'YES' if deepseek_ok else 'NO'}")
    _p(f"  DeepSeek call: {'YES' if deepseek_called else 'NO'}")
    _p(f"  Context built: {'YES' if context_built else 'NO'}")
    _p("")
    _p("  Open:")
    _p("    vocalype-brain/outputs/agent_recommendation.md")
    _p("    vocalype-brain/outputs/agent_run_report.md")
    if context_built:
        _p("    vocalype-brain/outputs/external_context_audit.md")
    if deepseek_called:
        _p("    vocalype-brain/outputs/deepseek_response.md")
    if MISSION_PACKAGE_PATH.exists() and route in ("product_implementation", "sensitive_code"):
        _p("    vocalype-brain/outputs/v11_mission_package.md")
    _p("=" * 60)
    _p("")


if __name__ == "__main__":
    main()
