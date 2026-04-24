"""add_benchmark_observation.py — V7 Phase 1 Manual Benchmark Recorder.

Records one manual benchmark observation to data/benchmark_observations.jsonl.
Used by the founder to build the baseline before any optimization work begins.

Does NOT modify product code. Does NOT instrument the app. Does NOT optimize.

Usage:
    python vocalype-brain/scripts/add_benchmark_observation.py \\
        --scenario first_dictation \\
        --metric total_dictation_latency_ms \\
        --value 2400 \\
        --unit ms \\
        [--app_version <git-sha>] \\
        [--model <model-id>] \\
        [--device <device-label>] \\
        [--notes "free text"]
"""
from __future__ import annotations

import argparse
import subprocess
import sys
from datetime import datetime
from typing import Any

from brain import append_jsonl, ensure_brain_structure

# ---------------------------------------------------------------------------
# Priority metrics — used for validation warnings
# ---------------------------------------------------------------------------

PRIORITY_METRICS = {
    "total_dictation_latency_ms",
    "model_load_time_ms",
    "stt_inference_time_ms",
    "app_idle_ram_mb",
    "ram_during_transcription_mb",
    "ram_after_transcription_mb",
    "wer_percent",
    "cer_percent",
    "first_successful_dictation_time_ms",
    "activation_success_rate",
}

KNOWN_UNITS = {"ms", "mb", "percent", "%", "ratio", "count", "s", "bool"}

KNOWN_SCENARIOS = {
    "first_dictation",
    "warm_dictation",
    "cold_start",
    "activation",
    "ram_idle",
    "ram_transcription",
    "wer_french_short",
    "wer_english_short",
    "wer_quebec_accent",
    "wer_code_dictation",
    "punctuation",
    "proper_nouns",
    "noise_test",
    "stability",
    "crash_rate",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_git_sha() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, check=True,
        )
        return result.stdout.strip()
    except Exception:  # noqa: BLE001
        return "unknown"


def _validate(args: argparse.Namespace) -> list[str]:
    """Return a list of warning strings (non-fatal)."""
    warnings: list[str] = []

    if args.metric not in PRIORITY_METRICS:
        warnings.append(
            f"metric '{args.metric}' is not a priority metric. "
            f"Priority metrics: {', '.join(sorted(PRIORITY_METRICS))}"
        )

    if args.unit.lower() not in KNOWN_UNITS:
        warnings.append(
            f"unit '{args.unit}' is not a recognised unit. "
            f"Known units: {', '.join(sorted(KNOWN_UNITS))}"
        )

    if args.scenario not in KNOWN_SCENARIOS:
        warnings.append(
            f"scenario '{args.scenario}' is not a recognised scenario. "
            f"Known scenarios: {', '.join(sorted(KNOWN_SCENARIOS))}"
        )

    if args.value < 0:
        warnings.append(f"value {args.value} is negative — verify this is intentional.")

    return warnings


def _build_record(args: argparse.Namespace, now: datetime) -> dict[str, Any]:
    app_version = args.app_version or _get_git_sha()
    record: dict[str, Any] = {
        "date": now.isoformat(),
        "scenario": args.scenario,
        "metric": args.metric,
        "value": args.value,
        "unit": args.unit,
        "app_version": app_version,
    }
    if args.model:
        record["model"] = args.model
    if args.device:
        record["device"] = args.device
    if args.notes:
        record["notes"] = args.notes
    return record


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="V7 Manual Benchmark Recorder — append one observation.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python vocalype-brain/scripts/add_benchmark_observation.py \\
      --scenario first_dictation \\
      --metric total_dictation_latency_ms \\
      --value 2400 --unit ms --model parakeet --device windows_4060

  python vocalype-brain/scripts/add_benchmark_observation.py \\
      --scenario wer_french_short \\
      --metric wer_percent \\
      --value 8.3 --unit percent \\
      --notes "phrase: Bonjour je m appelle Jean"
        """,
    )
    parser.add_argument("--scenario", required=True, help="Test scenario identifier")
    parser.add_argument("--metric", required=True, help="Metric name (e.g. total_dictation_latency_ms)")
    parser.add_argument("--value", required=True, type=float, help="Measured value (numeric)")
    parser.add_argument("--unit", required=True, help="Unit (ms, mb, percent, ratio, count, bool)")
    parser.add_argument("--app_version", default=None, help="Git SHA or version tag (auto-detected if omitted)")
    parser.add_argument("--model", default=None, help="Model ID (e.g. parakeet-tdt-0.6b-v3)")
    parser.add_argument("--device", default=None, help="Device label (e.g. windows_4060, mac_m2)")
    parser.add_argument("--notes", default=None, help="Free-text notes")
    args = parser.parse_args()

    ensure_brain_structure()
    now = datetime.now().replace(microsecond=0)

    warnings = _validate(args)
    for w in warnings:
        print(f"  WARNING: {w}")

    record = _build_record(args, now)
    append_jsonl("data/benchmark_observations.jsonl", record)

    divider = "=" * 60
    print(divider)
    print("V7 Benchmark Observation Recorded")
    print(divider)
    print(f"  Date      : {record['date']}")
    print(f"  Scenario  : {record['scenario']}")
    print(f"  Metric    : {record['metric']}")
    print(f"  Value     : {record['value']} {record['unit']}")
    print(f"  Version   : {record['app_version']}")
    if args.model:
        print(f"  Model     : {args.model}")
    if args.device:
        print(f"  Device    : {args.device}")
    if args.notes:
        print(f"  Notes     : {args.notes}")
    if warnings:
        print(f"\n  {len(warnings)} warning(s) above — observation was still recorded.")
    print(divider)
    print("Written: vocalype-brain/data/benchmark_observations.jsonl")


if __name__ == "__main__":
    main()
