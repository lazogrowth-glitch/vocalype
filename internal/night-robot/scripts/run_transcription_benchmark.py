#!/usr/bin/env python
"""
Transcription benchmark wrapper for Vocalype Night Robot.

Runs parakeet_pipeline_eval against the recruiting-32 manifest,
saves the result JSON, compares against the previous best score,
and exits 0 (pass/improved/same) or 1 (regressed).

Usage (called by robot_config.json commands.transcription_benchmark):
  python internal/night-robot/scripts/run_transcription_benchmark.py
"""

import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths â€” adjust if your layout differs
# ---------------------------------------------------------------------------

_ROBOT_DIR = Path(__file__).resolve().parent.parent
_REPO_ROOT = _ROBOT_DIR.parent
_RUNS_DIR = _ROBOT_DIR / "data" / "runs"

_MODEL_DIR = (
    Path(os.environ.get("APPDATA", ""))
    / "com.vocalype.desktop"
    / "models"
    / "parakeet-tdt-0.6b-v3-int8"
)
_MODEL_ID = "parakeet-tdt-0.6b-v3-int8"

_MANIFEST = (
    _REPO_ROOT
    / "src-tauri"
    / "evals"
    / "parakeet"
    / "dataset_manifest_recruiting_32.json"
)

_BASELINE_FILE = _ROBOT_DIR / "data" / "memory" / "benchmark_baseline.json"

# Metrics where LOWER is better
_LOWER_IS_BETTER = [
    "global_wer",
    "global_cer",
    "global_omission_rate",
    "global_duplication_rate",
    "global_hallucination_rate",
    "average_end_truncation_score",
    "avg_latency_ms",
]

# Primary metric used for pass/fail decision
_PRIMARY_METRIC = "global_wer"

# How much regression (relative %) is tolerated before we call it a fail
_MAX_REGRESSION_PERCENT = 1.0


# ---------------------------------------------------------------------------

def run_eval() -> dict:
    if not _MODEL_DIR.exists():
        print(f"ERROR: Model directory not found: {_MODEL_DIR}", file=sys.stderr)
        print("Download the Parakeet model via the Vocalype app first.", file=sys.stderr)
        sys.exit(1)

    if not _MANIFEST.exists():
        print(f"ERROR: Manifest not found: {_MANIFEST}", file=sys.stderr)
        sys.exit(1)

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    output_path = _RUNS_DIR / f"{ts}_pipeline_eval.json"
    _RUNS_DIR.mkdir(parents=True, exist_ok=True)

    cmd = [
        "cargo", "run",
        "--example", "parakeet_pipeline_eval",
        "--manifest-path", "src-tauri/Cargo.toml",
        "--",
        str(_MODEL_DIR),
        str(_MANIFEST),
        _MODEL_ID,
        str(output_path),
    ]

    print(f"Running: {' '.join(cmd)}")
    print(f"Output : {output_path}")
    print()

    result = subprocess.run(
        cmd,
        cwd=str(_REPO_ROOT),
        timeout=600,
    )

    if result.returncode != 0:
        print(f"\nERROR: cargo run failed (exit {result.returncode})", file=sys.stderr)
        sys.exit(1)

    if not output_path.exists():
        print(f"\nERROR: Output file not created: {output_path}", file=sys.stderr)
        sys.exit(1)

    report = json.loads(output_path.read_text(encoding="utf-8"))
    return report, output_path


def extract_scores(report: dict) -> dict:
    agg = report.get("aggregate", {})
    q = agg.get("quality", {})
    return {
        "global_wer": q.get("global_wer"),
        "global_cer": q.get("global_cer"),
        "global_omission_rate": q.get("global_omission_rate"),
        "global_duplication_rate": q.get("global_duplication_rate"),
        "global_hallucination_rate": q.get("global_hallucination_rate"),
        "average_end_truncation_score": q.get("average_end_truncation_score"),
        "avg_latency_ms": agg.get("avg_latency_ms"),
        "samples": q.get("samples"),
    }


def load_baseline() -> dict | None:
    if _BASELINE_FILE.exists():
        try:
            return json.loads(_BASELINE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return None


def save_baseline(scores: dict) -> None:
    _BASELINE_FILE.parent.mkdir(parents=True, exist_ok=True)
    entry = {"scores": scores, "saved_at": datetime.now().isoformat()}
    _BASELINE_FILE.write_text(json.dumps(entry, indent=2), encoding="utf-8")


def compare(current: dict, baseline: dict) -> tuple[bool, str]:
    """Return (passed, summary_text)."""
    lines = []
    regressions = []

    for metric in _LOWER_IS_BETTER:
        cur = current.get(metric)
        prev = baseline.get(metric)
        if cur is None or prev is None:
            continue

        if prev == 0:
            delta_pct = 0.0
        else:
            delta_pct = (cur - prev) / abs(prev) * 100

        arrow = "â†“ better" if cur < prev else ("â†‘ worse" if cur > prev else "= same")
        lines.append(
            f"  {metric:<42} {prev:.6f} â†’ {cur:.6f}  {delta_pct:+.2f}%  {arrow}"
        )

        if metric == _PRIMARY_METRIC and delta_pct > _MAX_REGRESSION_PERCENT:
            regressions.append(
                f"{metric} regressed by {delta_pct:.2f}% "
                f"({prev:.6f} â†’ {cur:.6f})"
            )

    summary = "\n".join(lines)
    if regressions:
        return False, summary + "\n\nREGRESSIONS:\n" + "\n".join(regressions)
    return True, summary


def main() -> None:
    print("=" * 60)
    print("Vocalype Transcription Benchmark")
    print("=" * 60)

    report, output_path = run_eval()
    current = extract_scores(report)

    print("\n--- Current scores ---")
    for k, v in current.items():
        if v is not None:
            print(f"  {k:<42} {v:.6f}" if isinstance(v, float) else f"  {k:<42} {v}")

    baseline_entry = load_baseline()

    if baseline_entry is None:
        print("\nNo baseline found â€” saving current scores as baseline.")
        save_baseline(current)
        print(f"Baseline saved to: {_BASELINE_FILE}")
        print("\nRESULT: PASS (first run â€” baseline established)")
        sys.exit(0)

    prev = baseline_entry["scores"]
    prev_date = baseline_entry.get("saved_at", "?")[:10]

    print(f"\n--- Comparison vs baseline ({prev_date}) ---")
    passed, summary = compare(current, prev)
    print(summary)

    if passed:
        # Update baseline if primary metric improved
        cur_primary = current.get(_PRIMARY_METRIC, float("inf"))
        prev_primary = prev.get(_PRIMARY_METRIC, float("inf"))
        if cur_primary < prev_primary:
            save_baseline(current)
            print(f"\nBaseline updated (WER improved: {prev_primary:.6f} â†’ {cur_primary:.6f})")

        print(f"\nRESULT: PASS")
        sys.exit(0)
    else:
        print(f"\nRESULT: FAIL (primary metric regressed beyond threshold)")
        sys.exit(1)


if __name__ == "__main__":
    main()
