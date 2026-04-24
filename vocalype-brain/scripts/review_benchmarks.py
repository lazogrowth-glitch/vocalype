"""review_benchmarks.py — V7 Phase 1 Benchmark Reviewer.

Reads data/benchmark_observations.jsonl and produces:
  outputs/benchmark_report.md

Reports current coverage, per-metric summaries, missing priority metrics,
and suggested next measurements. Does NOT produce optimization recommendations.

Does NOT modify product code. Does NOT instrument the app.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any

from brain import ensure_brain_structure, read_jsonl, write_text

# ---------------------------------------------------------------------------
# Priority metrics
# ---------------------------------------------------------------------------

PRIORITY_METRICS = [
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
]

# Human-readable descriptions for the report
METRIC_DESCRIPTIONS: dict[str, str] = {
    "total_dictation_latency_ms":       "Total dictation latency (trigger → paste)",
    "model_load_time_ms":               "Model cold-load time",
    "stt_inference_time_ms":            "STT inference time",
    "app_idle_ram_mb":                  "App idle RAM",
    "ram_during_transcription_mb":      "RAM during transcription (peak)",
    "ram_after_transcription_mb":       "RAM after transcription (steady-state)",
    "wer_percent":                      "Word error rate (%)",
    "cer_percent":                      "Character error rate (%)",
    "first_successful_dictation_time_ms": "Time to first successful dictation",
    "activation_success_rate":          "Activation success rate",
}

# Suggested next measurement for each missing metric
NEXT_MEASUREMENT_HINTS: dict[str, str] = {
    "total_dictation_latency_ms":
        "Time trigger → paste complete. Use a stopwatch on 3 warm dictations.",
    "model_load_time_ms":
        "Cold-start: relaunch app, time from launch to first 'ready' state.",
    "stt_inference_time_ms":
        "Check Tauri console logs for inference timing during a dictation.",
    "app_idle_ram_mb":
        "Open Task Manager → Vocalype process → record RSS with no dictation running.",
    "ram_during_transcription_mb":
        "Open Task Manager → Vocalype → record peak RAM while dictating 10s audio.",
    "ram_after_transcription_mb":
        "Record RAM 5s after a dictation completes (check for leak vs. idle).",
    "wer_percent":
        "Dictate 5 known reference phrases. Compare hypothesis to reference manually.",
    "cer_percent":
        "Same as WER test but count character errors instead of word errors.",
    "first_successful_dictation_time_ms":
        "Fresh install / new account: time from app open to first successful paste.",
    "activation_success_rate":
        "Run 5 app launches. Count how many reach 'ready' state without manual retry.",
}

MIN_OBSERVATIONS_FOR_BASELINE = 5


# ---------------------------------------------------------------------------
# Stats helpers
# ---------------------------------------------------------------------------

def _stats(values: list[float]) -> dict[str, float]:
    if not values:
        return {}
    s = sorted(values)
    n = len(s)
    p50 = s[n // 2]
    p95 = s[min(int(n * 0.95), n - 1)]
    return {
        "count": n,
        "min": s[0],
        "max": s[-1],
        "p50": p50,
        "p95": p95,
        "mean": round(sum(s) / n, 2),
    }


def _read_optional_jsonl(path: str) -> list[dict[str, Any]]:
    try:
        return read_jsonl(path)
    except FileNotFoundError:
        return []


# ---------------------------------------------------------------------------
# Report builder
# ---------------------------------------------------------------------------

def _build_report(observations: list[dict[str, Any]], now: datetime) -> str:
    lines: list[str] = []

    lines += [
        "# Vocalype Brain — V7 Benchmark Report",
        "",
        f"Date: {now.isoformat()}",
        f"Total observations: {len(observations)}",
        "",
        "> This report is measurement-only. No optimization recommendations.",
        "> Run more sessions to build a reliable baseline.",
        "",
        "---",
        "",
    ]

    # --- Coverage summary ---
    by_metric: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_scenario: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for obs in observations:
        metric = obs.get("metric", "unknown")
        scenario = obs.get("scenario", "unknown")
        by_metric[metric].append(obs)
        by_scenario[scenario].append(obs)

    covered = set(by_metric.keys()) & set(PRIORITY_METRICS)
    missing = [m for m in PRIORITY_METRICS if m not in by_metric]

    lines += [
        "## Coverage",
        "",
        f"- Priority metrics covered : {len(covered)} / {len(PRIORITY_METRICS)}",
        f"- Priority metrics missing  : {len(missing)}",
        f"- Unique scenarios recorded : {len(by_scenario)}",
        f"- Unique metrics recorded   : {len(by_metric)}",
        "",
    ]

    # Baseline readiness per metric
    lines += ["### Baseline readiness per priority metric", ""]
    lines += [f"| Metric | Observations | Baseline ready (≥{MIN_OBSERVATIONS_FOR_BASELINE}) |", "|---|---|---|"]
    for m in PRIORITY_METRICS:
        count = len(by_metric.get(m, []))
        ready = "✅ Yes" if count >= MIN_OBSERVATIONS_FOR_BASELINE else f"❌ No ({count}/{MIN_OBSERVATIONS_FOR_BASELINE})"
        lines.append(f"| `{m}` | {count} | {ready} |")
    lines += [""]

    # --- Per-metric summaries (only for metrics that have observations) ---
    if by_metric:
        lines += ["---", "", "## Metric Summaries", ""]
        for metric in PRIORITY_METRICS:
            if metric not in by_metric:
                continue
            obs_list = by_metric[metric]
            values = [o["value"] for o in obs_list if isinstance(o.get("value"), (int, float))]
            st = _stats(values)
            unit = obs_list[-1].get("unit", "?")
            desc = METRIC_DESCRIPTIONS.get(metric, metric)
            lines += [
                f"### `{metric}`",
                f"*{desc}*",
                "",
                f"- Observations : {st.get('count', 0)}",
                f"- Min          : {st.get('min', '?')} {unit}",
                f"- Max          : {st.get('max', '?')} {unit}",
                f"- Mean         : {st.get('mean', '?')} {unit}",
                f"- p50          : {st.get('p50', '?')} {unit}",
                f"- p95          : {st.get('p95', '?')} {unit}",
            ]
            # Show last 3 individual values with dates
            recent = obs_list[-3:]
            if recent:
                lines.append("- Recent observations:")
                for o in recent:
                    date_str = str(o.get("date", "?"))[:16]
                    device = f" [{o['device']}]" if o.get("device") else ""
                    note = f" — {o['notes']}" if o.get("notes") else ""
                    lines.append(f"  - {date_str}{device}: {o['value']} {unit}{note}")
            lines.append("")

        # Non-priority metrics (extra observations)
        extra = [m for m in by_metric if m not in PRIORITY_METRICS]
        if extra:
            lines += ["### Additional metrics recorded", ""]
            for m in extra:
                obs_list = by_metric[m]
                values = [o["value"] for o in obs_list if isinstance(o.get("value"), (int, float))]
                st = _stats(values)
                unit = obs_list[-1].get("unit", "?")
                lines.append(
                    f"- `{m}`: {st.get('count', 0)} obs, "
                    f"mean {st.get('mean', '?')} {unit}, "
                    f"range [{st.get('min', '?')}–{st.get('max', '?')}]"
                )
            lines.append("")

    # --- Latest observations ---
    lines += ["---", "", "## Latest Observations", ""]
    recent_all = observations[-10:] if len(observations) >= 10 else observations
    lines.append("| Date | Scenario | Metric | Value | Unit | Device |")
    lines.append("|---|---|---|---|---|---|")
    for o in reversed(recent_all):
        date_str = str(o.get("date", "?"))[:16]
        scenario = o.get("scenario", "?")
        metric = o.get("metric", "?")
        value = o.get("value", "?")
        unit = o.get("unit", "?")
        device = o.get("device", "—")
        lines.append(f"| {date_str} | {scenario} | {metric} | {value} | {unit} | {device} |")
    lines.append("")

    # --- Missing priority metrics ---
    if missing:
        lines += ["---", "", "## Missing Priority Metrics", ""]
        lines.append("The following priority metrics have no observations yet.")
        lines.append("Collect these before building a baseline.\n")
        for m in missing:
            desc = METRIC_DESCRIPTIONS.get(m, m)
            hint = NEXT_MEASUREMENT_HINTS.get(m, "Manual measurement required.")
            lines += [
                f"### `{m}`",
                f"*{desc}*",
                "",
                f"How to measure: {hint}",
                "",
            ]

    # --- Suggested next measurements ---
    lines += ["---", "", "## Suggested Next Measurements", ""]

    if not observations:
        lines += [
            "No observations recorded yet.",
            "",
            "**Start with M1 — Cold start:**",
            "1. Close Vocalype. Reopen it. Start a stopwatch.",
            "2. Record time from launch to first 'ready' state → `model_load_time_ms`",
            "3. Trigger one dictation. Record trigger → paste time → `total_dictation_latency_ms`",
            "4. Open Task Manager. Record Vocalype RAM at idle → `app_idle_ram_mb`",
        ]
    else:
        # Prioritise the first missing metric
        if missing:
            top = missing[0]
            hint = NEXT_MEASUREMENT_HINTS.get(top, "Manual measurement required.")
            lines += [
                f"**Next priority:** `{top}`",
                "",
                f"{hint}",
                "",
                "Command to record:",
                "```",
                f"python vocalype-brain/scripts/add_benchmark_observation.py \\",
                f"    --scenario <scenario_name> \\",
                f"    --metric {top} \\",
                f"    --value <your_measurement> \\",
                f"    --unit {_default_unit(top)} \\",
                f"    --device <your_device>",
                "```",
            ]
        else:
            # All priority metrics covered — check baseline readiness
            not_ready = [m for m in PRIORITY_METRICS if len(by_metric.get(m, [])) < MIN_OBSERVATIONS_FOR_BASELINE]
            if not_ready:
                lines += [
                    f"All priority metrics have at least one observation. "
                    f"Build up to {MIN_OBSERVATIONS_FOR_BASELINE}+ observations per metric before locking the baseline.",
                    "",
                    "Metrics needing more observations:",
                ]
                for m in not_ready:
                    count = len(by_metric.get(m, []))
                    lines.append(f"- `{m}`: {count}/{MIN_OBSERVATIONS_FOR_BASELINE}")
            else:
                lines += [
                    f"✅ All priority metrics have ≥{MIN_OBSERVATIONS_FOR_BASELINE} observations.",
                    "",
                    "**Next step:** Lock the baseline.",
                    "```",
                    "python vocalype-brain/scripts/lock_benchmark_baseline.py --approve",
                    "```",
                    "",
                    "> lock_benchmark_baseline.py is a V7 Phase 2 script — not yet built.",
                ]

    lines += [
        "",
        "---",
        "",
        "## Stop Conditions",
        "",
        "Do not begin optimization until:",
        f"- ≥{MIN_OBSERVATIONS_FOR_BASELINE} observations exist for every priority metric",
        "- Baseline is locked in `data/benchmark_baseline.jsonl`",
        "- At least one product change has been benchmarked before AND after",
        "",
        "*This report is measurement-only. V7 does not optimize — it measures.*",
    ]

    return "\n".join(lines).rstrip() + "\n"


def _default_unit(metric: str) -> str:
    if metric.endswith("_ms"):
        return "ms"
    if metric.endswith("_mb"):
        return "mb"
    if metric.endswith("_rate") or metric.endswith("_percent"):
        return "percent"
    return "?"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ensure_brain_structure()
    now = datetime.now().replace(microsecond=0)

    observations = _read_optional_jsonl("data/benchmark_observations.jsonl")

    report_md = _build_report(observations, now)
    write_text("outputs/benchmark_report.md", report_md)

    divider = "=" * 60
    print(divider)
    print("V7 Benchmark Review")
    print(divider)
    print(f"\nTotal observations : {len(observations)}")

    by_metric: dict[str, list[Any]] = defaultdict(list)
    for obs in observations:
        by_metric[obs.get("metric", "unknown")].append(obs)

    covered = [m for m in PRIORITY_METRICS if m in by_metric]
    missing = [m for m in PRIORITY_METRICS if m not in by_metric]

    print(f"Priority metrics   : {len(covered)}/{len(PRIORITY_METRICS)} covered")
    if missing:
        print(f"Missing            : {', '.join(missing[:3])}{'...' if len(missing) > 3 else ''}")

    baseline_ready = all(len(by_metric.get(m, [])) >= MIN_OBSERVATIONS_FOR_BASELINE for m in PRIORITY_METRICS)
    print(f"Baseline ready     : {'YES' if baseline_ready else 'NO — collect more observations'}")
    print(f"\nWritten: vocalype-brain/outputs/benchmark_report.md")
    print(divider)


if __name__ == "__main__":
    main()
