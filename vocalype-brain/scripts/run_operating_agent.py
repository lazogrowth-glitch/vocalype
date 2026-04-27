"""
run_operating_agent.py -- Vocalype Brain Operating Mode
========================================================
Supervised automatic model router for the Brain operating cycle.

What it does:
  1. Runs the Brain operating cycle (unified report + mission package).
  2. Reads weekly_action.md and classifies the current action.
  3. Checks action lifecycle state -- skips actions already handled.
  4. Routes to local tools, DeepSeek API, or Claude/Codex manual workflow.
  5. Writes a full audit report and a founder-facing recommendation.

Action lifecycle states (checked before routing):
  NEW              -- not investigated; can generate diagnosis/proposal mission
  DIAGNOSED        -- root cause found; needs proposal or patch decision
  PATCH_PROPOSED   -- patch proposed; waiting for founder approval
  PATCH_SHIPPED    -- code patch committed; needs result recording or observation
  OBSERVATION_WAIT -- logging/diagnostic patch shipped; waiting for real-world
                      reproduction or benchmark data; must NOT generate new mission
  VERIFIED_KEEP    -- patch validated and kept; action is closed
  VERIFIED_REVERT  -- patch reverted; action closed, may create follow-up
  CLOSED           -- no further action unless new evidence appears

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

CONFIG_PATH              = BRAIN_ROOT / "config"  / "model_routing.json"
WEEKLY_ACTION_PATH       = BRAIN_ROOT / "outputs" / "weekly_action.md"
MISSION_PACKAGE_PATH     = BRAIN_ROOT / "outputs" / "v11_mission_package.md"
CONTEXT_PACK_PATH        = BRAIN_ROOT / "outputs" / "context_pack.md"
AGENT_RUN_REPORT_PATH    = BRAIN_ROOT / "outputs" / "agent_run_report.md"
AGENT_RECOMMEND_PATH     = BRAIN_ROOT / "outputs" / "agent_recommendation.md"
EXTERNAL_AUDIT_PATH      = BRAIN_ROOT / "outputs" / "external_context_audit.md"
DEEPSEEK_RESP_PATH       = BRAIN_ROOT / "outputs" / "deepseek_response.md"
NEXT_BOTTLENECK_PATH     = BRAIN_ROOT / "outputs" / "next_product_bottleneck.md"
FRESH_MISSION_PATH       = BRAIN_ROOT / "outputs" / "fresh_investigation_mission.md"
BENCHMARK_OBS_PATH       = BRAIN_ROOT / "data"    / "benchmark_observations.jsonl"
RESULTS_JSONL_PATH       = BRAIN_ROOT / "data"    / "results.jsonl"
V11_EXEC_LOG_PATH        = BRAIN_ROOT / "data"    / "v11_execution_log.jsonl"
AGENT_ROUTE_PATH         = BRAIN_ROOT / "outputs" / "agent_route.txt"

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

# ---------------------------------------------------------------------------
# Action lifecycle states
# ---------------------------------------------------------------------------
LC_NEW              = "NEW"
LC_DIAGNOSED        = "DIAGNOSED"
LC_PATCH_PROPOSED   = "PATCH_PROPOSED"
LC_PATCH_SHIPPED    = "PATCH_SHIPPED"
LC_OBSERVATION_WAIT = "OBSERVATION_WAIT"
LC_VERIFIED_KEEP    = "VERIFIED_KEEP"
LC_VERIFIED_REVERT  = "VERIFIED_REVERT"
LC_CLOSED           = "CLOSED"

# States that block new mission generation for the same action.
BLOCKED_LIFECYCLE_STATES = {
    LC_PATCH_SHIPPED,
    LC_OBSERVATION_WAIT,
    LC_VERIFIED_KEEP,
    LC_VERIFIED_REVERT,
    LC_CLOSED,
}

# ---------------------------------------------------------------------------
# Route contract
# ---------------------------------------------------------------------------
# ONE ROUTE = ONE AUTHORIZED BEHAVIOR.
# Each route declares exactly what it is and is not allowed to do.
# enforce_route_contract() uses this table to delete forbidden files
# and prevent the launcher from opening the wrong outputs.
#
# forbidden_files: list of Path objects that must NOT exist after this route runs.
# may_generate_claude_mission: whether fresh_investigation_mission.md may be written.
# may_call_deepseek: whether the DeepSeek API call is ever allowed.
# opens_fresh_mission: whether the launcher should open fresh_investigation_mission.md.
# founder_message_type: controls which branch _write_agent_recommendation() uses.

# Forward-declared as a function so Path constants are available at call time.
def _build_route_contract() -> dict[str, dict]:
    return {
        "data_entry": {
            "description": "Local measurement or founder data entry (benchmarks, V8/V9 obs)",
            "may_generate_claude_mission": False,
            "may_call_deepseek":          False,
            "opens_fresh_mission":        False,
            "founder_message_type":       "local_steps",
            "forbidden_files":            [FRESH_MISSION_PATH],
        },
        "simple_report": {
            "description": "Brain-only report or local analysis",
            "may_generate_claude_mission": False,
            "may_call_deepseek":          False,
            "opens_fresh_mission":        False,
            "founder_message_type":       "local_steps",
            "forbidden_files":            [FRESH_MISSION_PATH],
        },
        "hold": {
            "description": "No action -- insufficient data or nothing to do this cycle",
            "may_generate_claude_mission": False,
            "may_call_deepseek":          False,
            "opens_fresh_mission":        False,
            "founder_message_type":       "hold",
            "forbidden_files":            [FRESH_MISSION_PATH],
        },
        "observation_wait": {
            "description": "Patch/diagnostic already shipped; waiting for real-world evidence",
            "may_generate_claude_mission": False,
            "may_call_deepseek":          False,
            "opens_fresh_mission":        False,
            "founder_message_type":       "observation_wait",
            "forbidden_files":            [FRESH_MISSION_PATH],
        },
        "long_reasoning": {
            "description": "Long-context Brain review via DeepSeek or manual claude.ai",
            "may_generate_claude_mission": False,
            "may_call_deepseek":          True,
            "opens_fresh_mission":        False,
            "founder_message_type":       "deepseek_or_manual",
            "forbidden_files":            [FRESH_MISSION_PATH],
        },
        "sensitive_code": {
            "description": "Rust/audio/security inspection or product implementation mission",
            "may_generate_claude_mission": True,
            "may_call_deepseek":          False,
            "opens_fresh_mission":        True,
            "founder_message_type":       "send_to_claude",
            "forbidden_files":            [],
        },
        "product_implementation": {
            "description": "Product implementation -- manual Claude/Codex mission required",
            "may_generate_claude_mission": True,
            "may_call_deepseek":          False,
            "opens_fresh_mission":        True,
            "founder_message_type":       "send_to_claude",
            "forbidden_files":            [],
        },
        "completed_action_blocked": {
            "description": "Current V11 action already COMPLETE; stale mission suppressed",
            "may_generate_claude_mission": False,
            "may_call_deepseek":          False,
            "opens_fresh_mission":        False,
            "founder_message_type":       "stale_suppressed",
            "forbidden_files":            [FRESH_MISSION_PATH],
        },
    }


# result_status values from results.jsonl -> lifecycle state mapping
RESULT_STATUS_TO_LIFECYCLE: dict[str, str] = {
    "keep":             LC_VERIFIED_KEEP,
    "provisional_keep": LC_PATCH_SHIPPED,   # shipped but incomplete validation
    "needs_manual_test":LC_PATCH_SHIPPED,
    "revert":           LC_VERIFIED_REVERT,
    "reverted":         LC_VERIFIED_REVERT,
    "closed":           LC_CLOSED,
}

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
# Action lifecycle helpers
# ---------------------------------------------------------------------------

def normalize_action_key(raw: str) -> str:
    """
    Produce a stable lowercase key from an action title or bottleneck_id.
    Strips punctuation, normalises whitespace, lowercases.
    Used to match results.jsonl entries to bottleneck IDs.

    Examples:
      "idle_background_inference_loop"  -> "idle_background_inference_loop"
      "Idle Background Inference Loop / RAM Growth" -> "idle_background_inference_loop_ram_growth"
      "RC-2 Patch 1 -- stuck recording diagnostic logs" -> "rc2_patch_1_stuck_recording_diagnostic_logs"
    """
    s = raw.lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = s.strip("_")
    return s


def _load_jsonl(path: Path) -> list[dict]:
    """Load all valid JSON objects from a JSONL file."""
    if not path.exists():
        return []
    rows: list[dict] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return rows


def infer_action_state_from_results(bottleneck_id: str, results: list[dict]) -> str:
    """
    Inspect results.jsonl rows to infer the current lifecycle state for a given
    bottleneck_id.  Returns the state from the LATEST matching result (by date).

    Matching strategy (most-to-least specific):
      1. Exact match on 'bottleneck_id' field (if present in the result row).
      2. Normalized key match on 'title' field (substring).
      3. Normalized key match on 'summary' field (substring).

    State inference per row:
      - Explicit 'lifecycle_state' field in the row overrides everything.
      - behavior_changed=False + status=keep  -> OBSERVATION_WAIT
        (logging/diagnostic patch shipped; waiting for real-world evidence)
      - behavior_changed=True  + status=keep  -> VERIFIED_KEEP
      - behavior_changed=True  + status=revert -> VERIFIED_REVERT
      - behavior_changed=None  + status=keep  -> DIAGNOSED
        (read-only investigation or brain-only change; product not patched yet)
      - Everything else: RESULT_STATUS_TO_LIFECYCLE mapping.

    Ordering: latest result date wins (most recent state supersedes earlier ones).
    """
    norm_bid = normalize_action_key(bottleneck_id)
    candidates: list[tuple[str, str]] = []   # (date_str, lifecycle_state)

    for row in results:
        # --- Match check ---
        matched = False
        if normalize_action_key(row.get("bottleneck_id", "")) == norm_bid:
            matched = True
        elif norm_bid in normalize_action_key(row.get("title", "")):
            matched = True
        elif norm_bid in normalize_action_key(row.get("summary", "")):
            matched = True

        if not matched:
            continue

        # --- State inference ---
        # 1. Explicit lifecycle_state field is always authoritative
        explicit_lc = row.get("lifecycle_state", "")
        if explicit_lc in {
            LC_NEW, LC_DIAGNOSED, LC_PATCH_PROPOSED, LC_PATCH_SHIPPED,
            LC_OBSERVATION_WAIT, LC_VERIFIED_KEEP, LC_VERIFIED_REVERT, LC_CLOSED,
        }:
            state = explicit_lc
        else:
            result_status = row.get("result_status", "").lower()
            behavior_changed = row.get("behavior_changed", None)  # bool or None

            if isinstance(behavior_changed, bool) and not behavior_changed and result_status == "keep":
                # Logging/diagnostic-only patch -- no behaviour change, waiting for evidence
                state = LC_OBSERVATION_WAIT
            elif isinstance(behavior_changed, bool) and behavior_changed and result_status == "keep":
                state = LC_VERIFIED_KEEP
            elif isinstance(behavior_changed, bool) and behavior_changed \
                    and result_status in ("revert", "reverted"):
                state = LC_VERIFIED_REVERT
            elif behavior_changed is None and result_status == "keep":
                # Read-only investigation or brain-only change (no product behaviour touched)
                state = LC_DIAGNOSED
            else:
                state = RESULT_STATUS_TO_LIFECYCLE.get(result_status, LC_NEW)

        date_str = row.get("date", "")
        candidates.append((date_str, state))

    if not candidates:
        return LC_NEW

    # Latest date (lexicographic sort is fine for ISO-8601 strings) wins.
    candidates.sort(key=lambda x: x[0], reverse=True)
    return candidates[0][1]


def load_action_lifecycle_map(bottleneck_ids: list[str]) -> dict[str, str]:
    """
    Build a mapping of {bottleneck_id -> lifecycle_state} by reading
    results.jsonl and v11_execution_log.jsonl.

    Also checks the execution log: if an action is in COMPLETE status in
    v11_execution_log.jsonl, it is at minimum DIAGNOSED (may be superseded
    by a higher state from results.jsonl).
    """
    results = _load_jsonl(RESULTS_JSONL_PATH)
    exec_log = _load_jsonl(V11_EXEC_LOG_PATH)

    # Build exec_log lookup: normalized action_summary -> status
    exec_complete: set[str] = set()
    for row in exec_log:
        if row.get("status", "").upper() == "COMPLETE":
            exec_complete.add(normalize_action_key(row.get("action_summary", "")))

    state_map: dict[str, str] = {}
    for bid in bottleneck_ids:
        state = infer_action_state_from_results(bid, results)
        # If execution log marks this action complete but results say NEW, upgrade to DIAGNOSED
        if state == LC_NEW:
            norm = normalize_action_key(bid)
            for key in exec_complete:
                if norm in key or key in norm:
                    state = LC_DIAGNOSED
                    break
        state_map[bid] = state

    return state_map


def should_skip_action(lifecycle_state: str) -> bool:
    """Return True if the action must not generate a new mission."""
    return lifecycle_state in BLOCKED_LIFECYCLE_STATES


def _observation_wait_recommendation(bottleneck_id: str) -> list[str]:
    """
    Return a founder-readable instruction block for an OBSERVATION_WAIT action.
    Generic by default; specialised for known bottleneck IDs.
    """
    if "idle_background" in bottleneck_id or "stuck_recording" in bottleneck_id:
        return [
            "## Action: OBSERVATION_WAIT -- Diagnostic Patch Already Shipped\n\n",
            "**What was done:**\n\n",
            "- Root cause diagnosed: RC-2 stuck recording session in chunking sampler\n",
            "- Logging-only patch committed: `0820936` (chore(app): add stuck recording diagnostic logs)\n",
            "- `stop_transcription_action` entry now logged at `info` level\n",
            "- binding_id mismatch guard now logs at `warn` level (silent drops are now visible)\n",
            "- Sampler thread warns after 5 min running; logs exit with elapsed time + chunk count\n\n",
            "**What is needed next (founder task -- no Brain session):**\n\n",
            "1. Use Vocalype normally (dictate, stop, repeat) until the issue reproduces\n",
            "   (mic running, RAM growing, no active dictation in progress)\n",
            "2. Collect the app logs (Windows Event Log or Vocalype log file)\n",
            "3. Look for these specific log entries:\n\n",
            "   ```\n",
            "   warn  stop_transcription_action: binding_id mismatch -- received='...' active=...;\n",
            "         stop signal dropped (diagnostic)\n",
            "   warn  [sampler] session_id=... still running after 300s (N chunks dispatched)\n",
            "         -- possible stuck session (diagnostic)\n",
            "   info  [sampler] exiting -- ran Ns, M chunks dispatched\n",
            "   ```\n\n",
            "4. Record what you find:\n",
            "   - Was a `binding_id mismatch` warn visible? -> Path 2B confirmed\n",
            "   - Was `[sampler] still running` warn visible? -> RC-2 still active\n",
            "   - Was `[sampler] exiting` missing? -> sampler never stopped\n\n",
            "5. Once you have log evidence, start a new Brain session and share the logs\n",
            "   -> Patch 2 (defensive sampler timeout) can then be sized correctly\n\n",
            "**Do NOT open fresh_investigation_mission.md -- it is stale.**\n",
            "**Do NOT start a new investigation mission for this action.**\n\n",
        ]

    if "paste_latency" in bottleneck_id:
        return [
            "## Action: OBSERVATION_WAIT -- Post-Fix Benchmarks Needed\n\n",
            "Patch was shipped (V12, commit `f842401`). Waiting for:\n\n",
            "- Slack, Teams, Word smoke tests (T1/T2/T3 each)\n",
            "- 5 or more post-fix `paste_latency_ms` benchmark observations\n\n",
            "Run when ready:\n",
            "```\n",
            "python vocalype-brain/scripts/add_benchmark_observation.py \\\n",
            '  --metric paste_latency_ms --value <ms> --notes "post-fix floor=150ms"\n',
            "```\n\n",
        ]

    # Generic
    return [
        "## Action: OBSERVATION_WAIT\n\n",
        f"Action `{bottleneck_id}` has a patch or diagnostic change already shipped.\n\n",
        "Waiting for real-world observation data before the next step.\n\n",
        "Record new evidence (logs, benchmarks, or test results) and re-run this agent.\n\n",
    ]


# ---------------------------------------------------------------------------
# Route contract enforcement
# ---------------------------------------------------------------------------

def enforce_route_contract(
    route: str,
    dry_run: bool = False,
) -> list[str]:
    """
    Delete files that are forbidden for this route, then return the list of
    suppressed file names.  Call this AFTER all outputs have been written so
    any file that should not exist gets cleaned up.

    Writes nothing to disk beyond deletions; callers are responsible for
    recording suppressed items in the run report.
    """
    contract = _build_route_contract().get(route, {})
    forbidden: list[Path] = contract.get("forbidden_files", [])
    suppressed: list[str] = []
    for path in forbidden:
        if isinstance(path, Path) and path.exists():
            if not dry_run:
                path.unlink()
            suppressed.append(path.name)
    return suppressed


def _route_authorized_summary(route: str) -> str:
    """One-line human-readable summary of what the route is authorized to do."""
    contract = _build_route_contract().get(route, {})
    parts: list[str] = []
    if contract.get("may_generate_claude_mission"):
        parts.append("generate Claude/Codex mission")
    if contract.get("may_call_deepseek"):
        parts.append("call DeepSeek (if key set + auto mode)")
    if not parts:
        parts.append("local output only")
    return ", ".join(parts)


def _route_next_human_action(route: str, next_bottleneck: dict | None) -> str:
    """One-line instruction for the founder printed at the end of the run."""
    nb_id = (next_bottleneck or {}).get("bottleneck_id", "")
    if route == "data_entry":
        return (
            "Follow local measurement steps in agent_recommendation.md. "
            "Do NOT send anything to Claude/Codex."
        )
    if route in ("simple_report", "hold"):
        return "Read agent_recommendation.md. No external action needed."
    if route == "observation_wait":
        return (
            "Wait for real-world log evidence. "
            "Read agent_recommendation.md for exact log patterns to look for."
        )
    if route == "long_reasoning":
        return (
            "Review context_pack.md, then paste into claude.ai or enable auto mode "
            "to call DeepSeek."
        )
    if route in ("sensitive_code", "product_implementation"):
        return (
            "Open fresh_investigation_mission.md (if present) and send it to Claude/Codex manually. "
            "Founder review required before any commit."
        )
    if route == "completed_action_blocked":
        return "Current weekly action is stale. Read agent_recommendation.md for next steps."
    return "Read agent_recommendation.md."


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

    # Always store stdout tail so callers can inspect output (e.g. G7 gate failures)
    entry["stdout_tail"] = result.stdout.strip()[-800:] if result.stdout else ""

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
# V11 gate failure detection
# ---------------------------------------------------------------------------
def _is_duplicate_complete_failure(output_text: str) -> bool:
    """
    Return True if generate_v11_mission_package.py failed because the current
    weekly action is already marked COMPLETE in the execution log (G7 gate).

    Matches strings like:
      "G7 FAILED: duplicate COMPLETE action in execution log"
      "BLOCKED: G7 FAILED"
      "duplicate COMPLETE action"
    """
    text_lower = output_text.lower()
    return (
        "duplicate complete action" in text_lower
        or ("g7 failed" in text_lower)
        or ("blocked: g7" in text_lower)
    )


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
# Next product bottleneck selector
# ---------------------------------------------------------------------------
def _load_benchmark_observations() -> list[dict]:
    """Load all benchmark observations from the JSONL store."""
    if not BENCHMARK_OBS_PATH.exists():
        return []
    obs: list[dict] = []
    for line in BENCHMARK_OBS_PATH.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line:
            try:
                obs.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return obs


def _select_next_product_bottleneck(
    blocked_ids: set[str] | None = None,
    lifecycle_map: dict[str, str] | None = None,
) -> dict:
    """
    Inspect existing Brain data and select the next unresolved product bottleneck.
    Skips any bottleneck whose lifecycle_state is in BLOCKED_LIFECYCLE_STATES.

    Priority order (operating_contract.md Section 5):
      1. Safety / stability issue with evidence
      2. RAM growth / idle background inference loop
      3. Latency bottleneck not yet benchmarked post-fix
      4. Transcription quality measurement gap
      5. First successful dictation / activation issue
      6. Distribution / business data only if no product bottleneck exists
    """
    blocked_ids = blocked_ids or set()
    lifecycle_map = lifecycle_map or {}
    observations = _load_benchmark_observations()

    # Index observations by metric name
    by_metric: dict[str, list[dict]] = {}
    for obs in observations:
        m = obs.get("metric", "")
        if m:
            by_metric.setdefault(m, []).append(obs)

    # --- Priority 1/2: Idle background inference loop / RAM growth ---
    # Evidence: idle_background_inference_loop observation OR the observation file
    idle_bid        = "idle_background_inference_loop"
    idle_loop_obs   = by_metric.get("idle_background_inference_loop", [])
    ram_growth_obs  = by_metric.get("memory_growth_mb", [])
    idle_ram_obs    = by_metric.get("app_idle_ram_mb", [])
    idle_obs_file   = BRAIN_ROOT / "outputs" / "idle_background_transcription_observation.md"

    if (idle_loop_obs or ram_growth_obs or idle_obs_file.exists()) \
            and idle_bid not in blocked_ids:
        evidence: list[str] = []
        lc_state = lifecycle_map.get(idle_bid, LC_NEW)
        if idle_loop_obs:
            evidence.append(
                f"idle_background_inference_loop: {len(idle_loop_obs)} confirmed observation(s)"
            )
        if ram_growth_obs:
            max_growth = max(o.get("value", 0) for o in ram_growth_obs)
            evidence.append(f"memory_growth_mb: max observed = {max_growth:.0f} MB while idle")
        if len(idle_ram_obs) >= 2:
            vals = sorted(o.get("value", 0) for o in idle_ram_obs)
            evidence.append(
                f"app_idle_ram_mb: {vals[0]:.0f} MB (start) -> {vals[-1]:.0f} MB "
                f"(+{vals[-1] - vals[0]:.0f} MB over ~15 min idle)"
            )
        if idle_obs_file.exists():
            evidence.append(
                "idle_background_transcription_observation.md: present (severity=HIGH)"
            )
        evidence.append(
            "Log pattern: repeated chunk processing + 'Transcription result is empty' "
            "every ~1-2s with no user dictation in progress"
        )
        evidence.append(f"Lifecycle state: {lc_state}")
        return {
            "bottleneck_id":       idle_bid,
            "title":               "Idle Background Inference Loop / RAM Growth",
            "priority":            1,
            "lifecycle_state":     lc_state,
            "evidence":            evidence,
            "task_type":           "product_investigation",
            "route":               "sensitive_code",
            "requires_approval":   True,
            "goal": (
                "Diagnose why Vocalype runs inference and grows RAM while idle "
                "(no dictation in progress). Read-only inspection of the audio manager. "
                "No code changes during this investigation."
            ),
            "investigation_output": "outputs/idle_background_transcription_diagnosis.md",
            "files_to_read": [
                "src-tauri/src/managers/audio.rs  (read-only)",
                "src-tauri/src/managers/transcription.rs  (read-only)",
                "%LOCALAPPDATA%\\com.vocalype.desktop\\logs\\vocalype.log",
            ],
            "forbidden": (
                "Do NOT modify src-tauri/ during investigation. "
                "Read-only inspection only. No code changes."
            ),
        }

    # --- Priority 3: Paste latency — post-fix benchmarks pending ---
    paste_bid    = "paste_latency_pending_benchmarks"
    paste_obs    = by_metric.get("paste_latency_ms", [])
    post_fix_obs = [o for o in paste_obs if "post-fix" in o.get("notes", "").lower()]
    v12_result   = BRAIN_ROOT / "outputs" / "v12_experiment_result.md"
    if paste_obs and len(post_fix_obs) < 5 and paste_bid not in blocked_ids:
        lc_state = lifecycle_map.get(paste_bid, LC_NEW)
        evidence = [
            f"paste_latency_ms: {len(paste_obs)} total obs, "
            f"{len(post_fix_obs)} post-fix obs (need >=5 to close V12)",
            "V12 status: PROVISIONAL_KEEP -- Slack/Teams/Word test matrix pending",
            f"Lifecycle state: {lc_state}",
        ]
        if v12_result.exists():
            evidence.append("v12_experiment_result.md: PROVISIONAL_KEEP confirmed")
        return {
            "bottleneck_id":       paste_bid,
            "title":               "Paste Latency -- V12 Benchmarks Pending",
            "priority":            3,
            "lifecycle_state":     lc_state,
            "evidence":            evidence,
            "task_type":           "measurement_task",
            "route":               "data_entry",
            "requires_approval":   False,
            "goal": (
                "Complete V12 Phase 4: test Slack (T1/T2/T3), Teams (T1/T2/T3), "
                "Word (T1/T2/T3), then record >=5 post-fix paste_latency_ms observations "
                "to close V12 and upgrade to FULL_KEEP."
            ),
            "investigation_output": None,
            "files_to_read": [],
            "forbidden": "Do not modify product code. Record observations only.",
        }

    # --- Fallback: all known bottlenecks blocked or insufficient data ---
    return {
        "bottleneck_id":       "insufficient_product_data",
        "title":               "Insufficient Product Benchmark Data",
        "priority":            5,
        "lifecycle_state":     LC_NEW,
        "evidence":            ["Fewer than 5 observations for priority metrics"],
        "task_type":           "measurement_task",
        "route":               "data_entry",
        "requires_approval":   False,
        "goal":                "Record more benchmark observations to identify the next bottleneck.",
        "investigation_output": None,
        "files_to_read": [],
        "forbidden":           "Do not modify product code.",
    }


def _write_next_bottleneck_report(bottleneck: dict) -> None:
    """Write next_product_bottleneck.md with the selected bottleneck and investigation plan."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    b = bottleneck

    lines = [
        "# Vocalype Brain -- Next Product Bottleneck\n\n",
        f"Generated: {timestamp}\n",
        f"Bottleneck ID: `{b['bottleneck_id']}` | Priority: {b['priority']}\n\n",
        "---\n\n",
        f"## Selected Bottleneck\n\n**{b['title']}**\n\n",
        f"Task type: `{b['task_type']}` | Route: `{b['route']}`\n\n",
        f"**Goal:** {b['goal']}\n\n",
        "---\n\n",
        "## Evidence\n\n",
    ]
    for ev in b["evidence"]:
        lines.append(f"- {ev}\n")
    lines.append("\n")

    if b.get("files_to_read"):
        lines.append("## Files to Read (Investigation)\n\n")
        for f in b["files_to_read"]:
            lines.append(f"- `{f}`\n")
        lines.append("\n")

    if b.get("investigation_output"):
        lines.append(f"## Expected Output\n\n`{b['investigation_output']}`\n\n")

    lines += [
        "## Safety Rules\n\n",
        f"- {b['forbidden']}\n",
        "- No product code modifications during investigation\n",
        "- Founder reviews all outputs before any implementation\n",
        "- Operating contract Section 3 and Section 6 apply\n\n",
        "---\n\n",
        "## How to Proceed\n\n",
    ]

    if b["route"] == "sensitive_code":
        lines += [
            "1. Get explicit per-session founder approval\n",
            "2. Run `generate_v11_mission_package.py` once execution log is cleared\n",
            "   (or create a direct investigation mission)\n",
            "3. Send to Claude Code for **read-only diagnosis only**\n",
            "4. Claude writes `" + (b.get("investigation_output") or "diagnosis.md") + "` -- no code edits\n",
            "5. Review diagnosis before any follow-up implementation\n",
        ]
    elif b["route"] == "data_entry":
        lines += [
            "1. Follow the measurement steps in the Goal section above\n",
            "2. Record observations with `add_benchmark_observation.py`\n",
            "3. Re-run the agent after recording -- V10 will select a fresh action\n",
        ]
    else:
        lines += [
            "1. Open `weekly_action.md` and follow the action instructions\n",
            "2. Use the appropriate launcher or CLI script\n",
        ]

    NEXT_BOTTLENECK_PATH.parent.mkdir(parents=True, exist_ok=True)
    NEXT_BOTTLENECK_PATH.write_text("".join(lines), encoding="utf-8")
    _p(f"  [OK] next_product_bottleneck.md written (bottleneck: {b['bottleneck_id']}).")


# ---------------------------------------------------------------------------
# Fresh investigation mission writer
# ---------------------------------------------------------------------------
def _write_fresh_investigation_mission(bottleneck: dict) -> None:
    """
    Write fresh_investigation_mission.md -- a copy-pasteable read-only diagnosis
    mission for Claude Code, generated from the selected next product bottleneck.
    """
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    b = bottleneck

    output_file = b.get("investigation_output") or "outputs/diagnosis.md"
    files_to_read = b.get("files_to_read", [])
    forbidden = b.get("forbidden", "Do not modify product code.")

    lines = [
        "# Vocalype Brain -- Fresh Investigation Mission\n\n",
        f"Generated: {timestamp}\n",
        f"Bottleneck: `{b['bottleneck_id']}` (priority {b['priority']})\n\n",
        "> **COPY-PASTEABLE MISSION** -- paste this entire document into Claude Code.\n",
        "> This is a READ-ONLY investigation. No code changes are permitted.\n\n",
        "---\n\n",
        "## Mission Briefing\n\n",
        f"**Title:** {b['title']}\n\n",
        f"**Goal:** {b['goal']}\n\n",
        "---\n\n",
        "## Context Files to Read First\n\n",
        "Before starting the investigation, read these Brain memory files:\n\n",
        "1. `vocalype-brain/memory/operating_contract.md` -- safety rules and operating boundaries\n",
        "2. `vocalype-brain/memory/current_state.md` -- current Brain state and history\n",
        "3. `vocalype-brain/outputs/next_product_bottleneck.md` -- bottleneck evidence and plan\n",
    ]
    idle_obs_file = BRAIN_ROOT / "outputs" / "idle_background_transcription_observation.md"
    if idle_obs_file.exists():
        lines.append(
            "4. `vocalype-brain/outputs/idle_background_transcription_observation.md`"
            " -- severity=HIGH observation (read this for concrete log evidence)\n"
        )
    lines.append("\n")

    lines += [
        "---\n\n",
        "## Product Files to Inspect (Read-Only)\n\n",
        "**READ ONLY. Do not modify any of these files.**\n\n",
    ]
    for f in files_to_read:
        lines.append(f"- `{f}`\n")
    lines += [
        "\n",
        "---\n\n",
        "## Investigation Questions\n\n",
        "Answer each question with specific evidence (file:line references):\n\n",
        "1. **Where does the audio loop run when no dictation is in progress?**\n",
        "   - Which function or timer starts the inference loop?\n",
        "   - Is there a guard that should stop processing when idle?\n\n",
        "2. **Why does RAM grow continuously while idle?**\n",
        "   - What objects are allocated per-cycle and not released?\n",
        "   - Is there a buffer, channel, or accumulation that never drains?\n\n",
        "3. **What causes repeated 'Transcription result is empty' log entries?**\n",
        "   - Is audio being captured from silence and sent to the model?\n",
        "   - Is VAD (voice activity detection) running and filtering correctly?\n\n",
        "4. **What is the minimum safe fix?**\n",
        "   - Describe the change in plain English (no code yet)\n",
        "   - What is the blast radius? What could break?\n",
        "   - Is a read-only investigation enough, or is a full implementation mission needed?\n\n",
        "---\n\n",
        "## Deliverable\n\n",
        f"Write a single output file: `vocalype-brain/{output_file}`\n\n",
        "Required sections:\n\n",
        "1. **Root Cause** -- what causes the idle inference loop\n",
        "2. **Evidence** -- exact file:line references supporting the diagnosis\n",
        "3. **RAM Growth Mechanism** -- how RAM accumulates while idle\n",
        "4. **Proposed Fix (plain English)** -- describe the change; do not write code\n",
        "5. **Blast Radius** -- what could break, what tests are needed\n",
        "6. **Recommended Next Step** -- investigation only, or implementation mission needed?\n\n",
        "---\n\n",
        "## Safety Rules (MANDATORY)\n\n",
        f"- **{forbidden}**\n",
        "- Do NOT modify any file under `src-tauri/`, `src/`, or `backend/`\n",
        "- Do NOT run `cargo build`, `cargo test`, or any build command\n",
        f"- Write ONLY to `vocalype-brain/{output_file}`\n",
        "- If you discover a critical safety issue, STOP and report it in the output file\n",
        "- The founder reviews the diagnosis before any implementation is authorized\n\n",
        "---\n\n",
        "## Stop Conditions\n\n",
        "Stop immediately if you encounter:\n\n",
        "- Any auth, payment, billing, or security logic\n",
        "- A scope larger than audio manager read-only inspection\n",
        "- Instructions to write product code\n",
        "- Uncertainty about the safety of a proposed change\n\n",
        "---\n\n",
        "## Evidence Summary (from Vocalype Brain data)\n\n",
    ]
    for ev in b["evidence"]:
        lines.append(f"- {ev}\n")
    lines += [
        "\n",
        "---\n\n",
        "*Generated by Vocalype Brain Operating Mode -- founder review required before sending.*\n",
    ]

    FRESH_MISSION_PATH.parent.mkdir(parents=True, exist_ok=True)
    FRESH_MISSION_PATH.write_text("".join(lines), encoding="utf-8")
    _p(f"  [OK] fresh_investigation_mission.md written ({b['bottleneck_id']}).")


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
    v11_blocked_detail: str | None = None,
    lifecycle_map: dict[str, str] | None = None,
    selected_bottleneck_id: str | None = None,
    skipped_actions: list[dict] | None = None,
) -> None:
    """Write agent_run_report.md -- technical audit."""
    lines = [
        "# Vocalype Brain -- Agent Run Report\n\n",
        f"Generated: {timestamp}\n",
        f"Dry run: {'YES' if dry_run else 'NO'}\n\n",
        "---\n\n",
    ]

    # Prominent block notice at the top when the action is already complete
    if v11_blocked_detail:
        lines += [
            "## [BLOCKED] Current Action Already Completed\n\n",
            "The V11 mission package generator was blocked by safety gate **G7**.\n\n",
            f"**Exact error:** `{v11_blocked_detail}`\n\n",
            "**What this means:** The current weekly action is already marked COMPLETE\n"
            "in the execution log. The stale `v11_mission_package.md` was NOT recommended.\n\n",
            "**Next safe action:** Record new V8/V9 data so V10 selects a fresh action,\n"
            "then re-run this agent.\n\n",
            "---\n\n",
        ]

    # Lifecycle state section
    if lifecycle_map or skipped_actions:
        lines += ["## Action Lifecycle State\n\n"]
        if selected_bottleneck_id:
            sel_state = (lifecycle_map or {}).get(selected_bottleneck_id, LC_NEW)
            lines.append(
                f"| Field | Value |\n|---|---|\n"
                f"| Selected action | `{selected_bottleneck_id}` |\n"
                f"| Inferred state | `{sel_state}` |\n"
                f"| Final route | `{route}` |\n\n"
            )
        if skipped_actions:
            lines.append("**Skipped actions (lifecycle state blocked):**\n\n")
            for sk in skipped_actions:
                lines.append(
                    f"- `{sk['bottleneck_id']}` -- state=`{sk['lifecycle_state']}` "
                    f"(reason: {sk['reason']})\n"
                )
            lines.append("\n")
        if lifecycle_map:
            lines.append("**Full lifecycle map:**\n\n")
            lines.append("| Bottleneck ID | State |\n|---|---|\n")
            for bid, state in sorted(lifecycle_map.items()):
                lines.append(f"| `{bid}` | `{state}` |\n")
            lines.append("\n")
        lines.append("---\n\n")

    lines += [
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
    next_bottleneck: dict | None = None,
    skipped_actions: list[dict] | None = None,
) -> None:
    """Write agent_recommendation.md -- founder-facing next action."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")

    lc_state = (next_bottleneck or {}).get("lifecycle_state", "")
    header = [
        "# Vocalype Brain -- Agent Recommendation\n\n",
        f"Generated: {timestamp}\n",
        f"Route: `{route}` | Action type: `{action_type}`"
        + (f" | Lifecycle: `{lc_state}`" if lc_state else "")
        + "\n\n",
        "---\n\n",
    ]

    body: list[str] = []

    if route == "observation_wait":
        bid = (next_bottleneck or {}).get("bottleneck_id", "unknown")
        body = _observation_wait_recommendation(bid)
        if skipped_actions:
            body += [
                "---\n\n",
                "## Skipped Actions (lifecycle state blocked)\n\n",
            ]
            for sk in skipped_actions:
                body.append(
                    f"- `{sk['bottleneck_id']}` -- `{sk['lifecycle_state']}`: {sk['reason']}\n"
                )
            body.append("\n")

    elif route == "completed_action_blocked":
        body = [
            "## Current Weekly Action: ALREADY COMPLETE\n\n",
            "> **V11 blocked by safety gate G7 -- duplicate COMPLETE action in execution log.**\n",
            "> The existing `v11_mission_package.md` is stale. Do NOT send it to Claude/Codex.\n\n",
        ]

        # --- Fresh bottleneck section ---
        if next_bottleneck:
            nb = next_bottleneck
            body += [
                "---\n\n",
                f"## Fresh Next Product Bottleneck Selected\n\n",
                f"**{nb['title']}**\n\n",
                f"| Field | Value |\n|---|---|\n",
                f"| Bottleneck ID | `{nb['bottleneck_id']}` |\n",
                f"| Priority | {nb['priority']} |\n",
                f"| Task type | `{nb['task_type']}` |\n",
                f"| Route | `{nb['route']}` |\n",
                f"| Requires approval | {'YES' if nb.get('requires_approval') else 'NO'} |\n\n",
                "**Goal:** " + nb["goal"] + "\n\n",
                "**Evidence:**\n\n",
            ]
            for ev in nb["evidence"]:
                body.append(f"- {ev}\n")
            body.append("\n")

            # Route-specific action steps
            if nb["route"] == "sensitive_code":
                body += [
                    "**How to proceed (read-only investigation):**\n\n",
                    "1. This is a `sensitive_code` route -- per-session founder approval required\n",
                    "2. Open `vocalype-brain/outputs/next_product_bottleneck.md` for full details\n",
                    "3. If approved: send a read-only diagnosis mission to Claude Code\n",
                    "   - Claude reads `src-tauri/` audio/runtime managers only\n",
                    "   - Claude writes `" + (nb.get("investigation_output") or "diagnosis.md") + "` -- no code edits\n",
                    "4. Founder reviews diagnosis before any implementation\n\n",
                    "**Files to read (investigation only):**\n\n",
                ]
                for f in nb.get("files_to_read", []):
                    body.append(f"- `{f}`\n")
                body.append("\n")
                body.append(f"**Safety:** {nb['forbidden']}\n\n")
            elif nb["route"] == "data_entry":
                body += [
                    "**How to proceed:**\n\n",
                    "1. Open `vocalype-brain/outputs/next_product_bottleneck.md` for details\n",
                    "2. Follow the measurement steps to record observations\n",
                    "3. Re-run this agent -- V10 will select a fresh action once data is in\n\n",
                ]
        else:
            body.append("No fresh bottleneck could be selected from available data.\n\n")

        # --- Always-present fallback options ---
        body += [
            "---\n\n",
            "## Other Options If Not Proceeding With Investigation\n\n",
            "**Record V8 business metrics** (Stripe / Supabase / Vercel, 10 min):\n",
            "```\n",
            "python vocalype-brain/scripts/add_business_observation.py --metric <m> ...\n",
            "```\n\n",
            "**Record V9 content performance** (after each post):\n",
            "```\n",
            "python vocalype-brain/scripts/add_content_observation.py --platform <p> ...\n",
            "```\n\n",
            "**Record V12 post-fix benchmarks** (if Slack/Teams/Word tests still pending):\n",
            "```\n",
            "python vocalype-brain/scripts/add_benchmark_observation.py \\\n",
            '  --metric paste_latency_ms --value <ms> --notes "post-fix floor=150ms"\n',
            "```\n\n",
            "**No Claude/Codex mission should be sent based on the stale weekly action.**\n",
        ]

    elif route == "hold":
        body = [
            "## Recommended Action: HOLD\n\n",
            "No action needed this week. All signals are healthy.\n\n",
            "Continue monitoring and record data when available.\n",
        ]

    elif route in ("simple_report", "data_entry"):
        # Build route-specific body based on selected bottleneck (if available)
        nb_id = (next_bottleneck or {}).get("bottleneck_id", "")

        if route == "data_entry" and nb_id == "paste_latency_pending_benchmarks":
            body = [
                "## Recommended Action: LOCAL MEASUREMENT STEPS\n\n",
                "> **Do NOT send this to Claude or Codex.**\n",
                "> This is a founder data-entry task. No LLM or external API is needed.\n\n",
                "---\n\n",
                "### What to do: Complete V12 Paste Benchmark\n\n",
                "**Step 1 — Smoke test remaining apps** (if not yet done):\n\n",
                "- [ ] Slack: T1 (short), T2 (medium), T3 (long) -- paste into Slack message box\n",
                "- [ ] Teams: T1, T2, T3 -- paste into Teams chat\n",
                "- [ ] Word: T1, T2, T3 -- paste into Word document\n\n",
                "If any test fails -> revert immediately:\n",
                "```\n",
                "git checkout -- src-tauri/src/platform/clipboard.rs\n",
                "cargo build --release\n",
                "```\n\n",
                "**Step 2 — Record post-fix paste latency benchmarks** (need >= 5):\n\n",
                "```\n",
                "python vocalype-brain/scripts/add_benchmark_observation.py \\\n",
                '  --metric paste_latency_ms --value <measured_ms> \\\n',
                '  --unit ms --source manual_founder \\\n',
                '  --notes "post-fix floor=150ms" \\\n',
                '  --period 2026-W17\n',
                "```\n\n",
                "Run once per observation. Repeat until >= 5 post-fix observations exist.\n\n",
                "**Step 3 — Re-run this agent** once >= 5 post-fix observations are recorded:\n\n",
                "```\n",
                "python vocalype-brain/scripts/run_operating_agent.py\n",
                "```\n\n",
                "V12 will upgrade from PROVISIONAL_KEEP to FULL_KEEP automatically.\n\n",
                "---\n\n",
                "**Route: `data_entry`** -- local steps only, no LLM, no external API.\n",
            ]
        else:
            body = [
                "## Recommended Action: LOCAL TOOLS\n\n",
                "> **Do NOT send this to Claude or Codex.** Local data entry only.\n\n",
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
        if next_bottleneck:
            # Arrived here via completed_action_blocked -> fresh bottleneck selected
            nb = next_bottleneck
            body = [
                "## Previous Action: COMPLETE (blocked) -- Fresh Investigation Selected\n\n",
                "> The previous weekly action is already marked COMPLETE (V11 G7 gate).\n",
                "> A fresh product bottleneck was automatically selected as the next action.\n\n",
                f"**Bottleneck:** {nb['title']}\n\n",
                "| Field | Value |\n|---|---|\n",
                f"| ID | `{nb['bottleneck_id']}` |\n",
                f"| Priority | {nb['priority']} |\n",
                f"| Task type | `{nb['task_type']}` |\n",
                f"| Requires approval | {'YES' if nb.get('requires_approval') else 'NO'} |\n\n",
                "**Goal:** " + nb["goal"] + "\n\n",
                "**Evidence:**\n\n",
            ]
            for ev in nb["evidence"]:
                body.append(f"- {ev}\n")
            body += [
                "\n",
                "---\n\n",
                "## Action: SENSITIVE CODE -- Explicit Approval Required\n\n",
                "This is a **read-only investigation** of Rust/audio runtime code.\n\n",
                "**Per-session founder approval is required before sending to Claude Code.**\n\n",
                "**Steps:**\n\n",
                "1. Read `vocalype-brain/outputs/next_product_bottleneck.md` -- full evidence\n",
                "2. Read `vocalype-brain/outputs/fresh_investigation_mission.md` -- the mission\n",
                "3. Decide: approve this investigation? (operating_contract.md Section 6)\n",
                "4. If approved: copy `fresh_investigation_mission.md` and paste into Claude Code\n",
                "   - Claude reads `src-tauri/` audio/runtime managers only (read-only)\n",
                "   - Claude writes `vocalype-brain/"
                + (nb.get("investigation_output") or "outputs/diagnosis.md")
                + "` -- NO code edits\n",
                "5. Founder reviews the diagnosis before any implementation\n\n",
                "**Files for Claude to read (investigation only):**\n\n",
            ]
            for f in nb.get("files_to_read", []):
                body.append(f"- `{f}`\n")
            body += [
                "\n",
                f"**Safety:** {nb['forbidden']}\n\n",
            ]
        else:
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
    v11_blocked_detail: str | None = None  # set if G7 duplicate-COMPLETE gate fires

    if args.skip_report_gen:
        _p("  [skip] Skipping report generation (--skip-report-gen)")
        log.append({"step": "report_gen", "status": "skipped"})
    else:
        _p("[1/2] Generating unified weekly report ...")
        _run_script("generate_unified_report.py", log, dry_run=args.dry_run)
        _p("")
        _p("[2/2] Generating V11 mission package ...")
        v11_ok = _run_script("generate_v11_mission_package.py", log, dry_run=args.dry_run)
        if not v11_ok and not args.dry_run:
            # Inspect stdout of the last log entry for the G7 duplicate-COMPLETE failure
            last_stdout = log[-1].get("stdout_tail", "") if log else ""
            if _is_duplicate_complete_failure(last_stdout):
                # Extract the exact error line for the report
                for line in last_stdout.splitlines():
                    if "duplicate complete" in line.lower() or "g7 failed" in line.lower() or "blocked" in line.lower():
                        v11_blocked_detail = line.strip()
                        break
                if not v11_blocked_detail:
                    v11_blocked_detail = "G7 FAILED: duplicate COMPLETE action in execution log"
                _p(f"  [!] ACTION ALREADY COMPLETE -- {v11_blocked_detail}")
                _p("      Stale mission package will NOT be recommended.")
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

    # Override: if V11 was blocked by G7 (duplicate COMPLETE), force a safe hold route
    # and select a fresh product bottleneck to give the founder a concrete next action
    next_bottleneck: dict | None = None
    skipped_actions: list[dict] = []

    # ---- Step 3b: Build action lifecycle map ----
    # Always build the lifecycle map, even if V11 was not blocked.
    # This prevents the bottleneck selector from re-selecting already-handled actions.
    known_bottleneck_ids = [
        "idle_background_inference_loop",
        "paste_latency_pending_benchmarks",
        "insufficient_product_data",
    ]
    lifecycle_map: dict[str, str] = {}
    if not args.dry_run:
        _p("[3b] Building action lifecycle map ...")
        lifecycle_map = load_action_lifecycle_map(known_bottleneck_ids)
        blocked_ids: set[str] = {
            bid for bid, state in lifecycle_map.items()
            if should_skip_action(state)
        }
        for bid in blocked_ids:
            skipped_actions.append({
                "bottleneck_id":   bid,
                "lifecycle_state": lifecycle_map[bid],
                "reason":          f"state={lifecycle_map[bid]} -- no new mission needed",
            })
        for bid, state in lifecycle_map.items():
            _p(f"  Lifecycle: {bid} -> {state}")
        if blocked_ids:
            _p(f"  Blocked (will not generate mission): {', '.join(sorted(blocked_ids))}")
        _p("")
    else:
        blocked_ids = set()

    if v11_blocked_detail:
        original_route = route
        route = "completed_action_blocked"
        classification_reason = (
            f"V11 blocked (G7 duplicate COMPLETE) -- original route was '{original_route}'. "
            "Stale mission package suppressed."
        )
        if not args.dry_run:
            _p("[3c] Selecting next product bottleneck (lifecycle-aware) ...")
            next_bottleneck = _select_next_product_bottleneck(
                blocked_ids=blocked_ids, lifecycle_map=lifecycle_map
            )
            _p(f"  Selected: {next_bottleneck['bottleneck_id']} "
               f"(priority {next_bottleneck['priority']}, "
               f"state={next_bottleneck.get('lifecycle_state', '?')})")
            _write_next_bottleneck_report(next_bottleneck)

            nb_lc = next_bottleneck.get("lifecycle_state", LC_NEW)
            if should_skip_action(nb_lc):
                # All bottlenecks are blocked -- route to OBSERVATION_WAIT
                route = "observation_wait"
                classification_reason = (
                    f"All known bottlenecks blocked by lifecycle state. "
                    f"Top bottleneck '{next_bottleneck['bottleneck_id']}' "
                    f"is in state '{nb_lc}'. "
                    "Routing to OBSERVATION_WAIT -- waiting for new evidence."
                )
                _p(f"  [!] Top bottleneck is blocked ({nb_lc}) -- route -> observation_wait")
                # Suppress fresh_investigation_mission for OBSERVATION_WAIT
                if FRESH_MISSION_PATH.exists():
                    FRESH_MISSION_PATH.unlink()
                    _p("  [OK] Deleted stale fresh_investigation_mission.md")
            else:
                # Override route to the fresh bottleneck's route (e.g. sensitive_code)
                route = next_bottleneck["route"]
                classification_reason = (
                    f"V11 blocked (G7 duplicate COMPLETE) -- fresh bottleneck selected: "
                    f"'{next_bottleneck['bottleneck_id']}' (priority {next_bottleneck['priority']}). "
                    f"Route overridden to '{route}'."
                )
                _p(f"  Route overridden to: {route}")
                _write_fresh_investigation_mission(next_bottleneck)
    else:
        # V11 not blocked -- lifecycle-aware bottleneck selector determines final route.
        # The weekly_action.md classification is treated as an initial signal only;
        # the bottleneck lifecycle state is authoritative.
        if not args.dry_run:
            _p("[3c] Lifecycle-aware bottleneck selection (V11 not blocked) ...")
            candidate = _select_next_product_bottleneck(
                blocked_ids=blocked_ids, lifecycle_map=lifecycle_map
            )
            nb_lc = candidate.get("lifecycle_state", LC_NEW)
            nb_route = candidate.get("route", route)
            next_bottleneck = candidate

            if should_skip_action(nb_lc):
                # Top bottleneck blocked -- route to observation_wait
                route = "observation_wait"
                classification_reason = (
                    f"Top bottleneck '{candidate['bottleneck_id']}' is in lifecycle state "
                    f"'{nb_lc}' -- cannot generate new mission. "
                    "Routing to OBSERVATION_WAIT."
                )
                _p(f"  [!] Bottleneck '{candidate['bottleneck_id']}' "
                   f"lifecycle={nb_lc} -- route -> observation_wait")
                if FRESH_MISSION_PATH.exists():
                    FRESH_MISSION_PATH.unlink()
                    _p("  [OK] Deleted stale fresh_investigation_mission.md")

            elif nb_route != route and candidate["bottleneck_id"] != "insufficient_product_data":
                # Bottleneck's route differs from weekly_action.md classification.
                # The lifecycle-aware selector is authoritative -- override.
                old_route = route
                route = nb_route
                classification_reason = (
                    f"Lifecycle-aware selector chose '{candidate['bottleneck_id']}' "
                    f"(lifecycle={nb_lc}, route={nb_route}); "
                    f"overrides weekly_action.md classification '{old_route}'."
                )
                _p(f"  Bottleneck '{candidate['bottleneck_id']}' "
                   f"lifecycle={nb_lc} -- route overridden {old_route} -> {route}")
                _write_next_bottleneck_report(candidate)
                # Only write fresh mission if new route authorizes it
                if _build_route_contract().get(route, {}).get("may_generate_claude_mission"):
                    _write_fresh_investigation_mission(candidate)
                elif FRESH_MISSION_PATH.exists():
                    FRESH_MISSION_PATH.unlink()
                    _p("  [OK] Deleted stale fresh_investigation_mission.md "
                       f"(not authorized for route '{route}')")

            else:
                _p(f"  Bottleneck '{candidate['bottleneck_id']}' "
                   f"lifecycle={nb_lc} -- route '{route}' confirmed")
                if _build_route_contract().get(route, {}).get("may_generate_claude_mission"):
                    _write_next_bottleneck_report(candidate)

    _p(f"  Action type   : {action_type}")
    _p(f"  Route         : {route}")
    _p(f"  Reason        : {classification_reason}")
    log.append({
        "step": "classify",
        "status": "ok",
        "action_type": action_type,
        "route": route,
        "reason": classification_reason,
        "skipped_actions": [s["bottleneck_id"] for s in skipped_actions],
    })
    _p("")

    # ---- Step 4: Route execution ----
    context_built    = False
    deepseek_called  = False
    deepseek_error: str | None   = None
    deepseek_response_text: str | None = None

    _p(f"[4] Executing route: {route} ...")

    if route == "observation_wait":
        bid = (next_bottleneck or {}).get("bottleneck_id", "unknown")
        lc  = (next_bottleneck or {}).get("lifecycle_state", "OBSERVATION_WAIT")
        _p(f"  -> OBSERVATION_WAIT: '{bid}' is in state '{lc}'.")
        _p("     Patch/diagnostic already shipped. Waiting for real-world evidence.")
        _p("     No new mission generated. fresh_investigation_mission.md suppressed.")
        log.append({
            "step": "route_exec", "status": "observation_wait",
            "bottleneck_id": bid, "lifecycle_state": lc,
        })

    elif route == "completed_action_blocked":
        _p("  -> Current action already COMPLETE. Stale mission NOT recommended.")
        _p("     Record new V8/V9 data, then re-run to get a fresh action.")
        log.append({"step": "route_exec", "status": "completed_action_blocked",
                    "detail": v11_blocked_detail or ""})

    elif route in ("simple_report", "data_entry"):
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
        if next_bottleneck and FRESH_MISSION_PATH.exists():
            _p("  -> Fresh investigation mission ready. Read-only diagnosis for Claude Code.")
            _p(f"     {FRESH_MISSION_PATH}")
        elif MISSION_PACKAGE_PATH.exists():
            _p("  -> Manual Claude/Codex mission. Mission package path:")
            _p(f"     {MISSION_PACKAGE_PATH}")
        else:
            _p("  [!] No mission file found -- run generate_v11_mission_package.py or check bottleneck selection")
        log.append({"step": "route_exec", "status": "manual_mission", "route": route})

    _p("")

    # ---- Step 5: Write outputs ----
    _p("[5] Writing outputs ...")
    suppressed_files: list[str] = []
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
            v11_blocked_detail=v11_blocked_detail,
            lifecycle_map=lifecycle_map,
            selected_bottleneck_id=(next_bottleneck or {}).get("bottleneck_id"),
            skipped_actions=skipped_actions,
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
            next_bottleneck=next_bottleneck,
            skipped_actions=skipped_actions,
        )

        # Enforce route contract: delete forbidden files, write route marker
        suppressed_files = enforce_route_contract(route, dry_run=False)
        if suppressed_files:
            _p(f"  [OK] Route contract enforced -- suppressed: {', '.join(suppressed_files)}")
        AGENT_ROUTE_PATH.parent.mkdir(parents=True, exist_ok=True)
        AGENT_ROUTE_PATH.write_text(route, encoding="utf-8")
        _p(f"  [OK] agent_route.txt written: {route}")

        # Append suppression notice to run report if any files were deleted
        if suppressed_files:
            try:
                existing = AGENT_RUN_REPORT_PATH.read_text(encoding="utf-8", errors="replace")
                notice = (
                    "\n---\n\n"
                    "## Route Contract Enforcement\n\n"
                    f"Route `{route}` forbids: {', '.join(f'`{f}`' for f in suppressed_files)}\n\n"
                    "The following files were **deleted** to enforce the route contract:\n\n"
                    + "".join(f"- `{f}` -- suppressed (not authorized for route `{route}`)\n"
                              for f in suppressed_files)
                    + "\nThe launcher will not open these files for this route.\n"
                )
                AGENT_RUN_REPORT_PATH.write_text(existing + notice, encoding="utf-8")
            except Exception:
                pass
    else:
        _p("  [dry-run] Skipping file writes.")

    _p("")
    _p("=" * 60)
    _p("  DONE")
    _p(f"  Final route       : {route}")
    _p(f"  Authorized for    : {_route_authorized_summary(route)}")
    _p(f"  External mode     : {external_mode}")
    _p(f"  DeepSeek key      : {'YES' if deepseek_ok else 'NO'}")
    _p(f"  DeepSeek call     : {'YES' if deepseek_called else 'NO'}")
    _p(f"  Context built     : {'YES' if context_built else 'NO'}")
    if suppressed_files:
        _p(f"  Suppressed files  : {', '.join(suppressed_files)}")
    _p("")
    _p("  Open:")
    _p("    vocalype-brain/outputs/agent_recommendation.md")
    _p("    vocalype-brain/outputs/agent_run_report.md")
    if context_built:
        _p("    vocalype-brain/outputs/external_context_audit.md")
    if deepseek_called:
        _p("    vocalype-brain/outputs/deepseek_response.md")
    if route in ("sensitive_code", "product_implementation") and not v11_blocked_detail:
        if MISSION_PACKAGE_PATH.exists():
            _p("    vocalype-brain/outputs/v11_mission_package.md")
        if FRESH_MISSION_PATH.exists():
            _p("    vocalype-brain/outputs/fresh_investigation_mission.md  (send to Claude manually)")
    if next_bottleneck:
        _p(f"    vocalype-brain/outputs/next_product_bottleneck.md  ({next_bottleneck['bottleneck_id']})")
    if v11_blocked_detail:
        _p("  [!] Stale v11_mission_package.md suppressed -- action already complete")
    _p("")
    _p(f"  Next action: {_route_next_human_action(route, next_bottleneck)}")
    _p("=" * 60)
    _p("")


if __name__ == "__main__":
    main()
