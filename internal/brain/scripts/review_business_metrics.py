"""review_business_metrics.py â€” V8 Phase 1 Business Metrics Reviewer.

Reads data/business_observations.jsonl and produces:
  outputs/business_report.md

Distinguishes between metric statuses:
  measured / zero  â†’ count as checked; contribute to baseline weeks
  unknown          â†’ not checked; do NOT count toward baseline
  not_available    â†’ data source missing; flag setup backlog
  not_applicable   â†’ precondition unmet; suppress from missing warnings

Does NOT produce growth recommendations or optimisation suggestions.
Does NOT modify product code. Does NOT connect APIs. Measurement only.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any

from brain import ensure_brain_structure, read_jsonl, write_text

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PRIORITY_METRICS = [
    "website_visitors",
    "downloads",
    "account_signups",
    "activation_attempts",
    "first_successful_dictations",
    "trial_starts",
    "paid_conversions",
    "mrr",
    "refunds",
    "churned_users",
    "content_posts",
    "content_views",
    "founder_distribution_actions",
]

METRIC_DESCRIPTIONS: dict[str, str] = {
    "website_visitors":              "Weekly unique website visitors",
    "downloads":                     "Installer downloads per week",
    "account_signups":               "New accounts created (Supabase auth.users)",
    "activation_attempts":           "Sessions that reached activation screen",
    "first_successful_dictations":   "Users who completed first dictation â€” NORTH STAR",
    "trial_starts":                  "New trials started (Stripe)",
    "paid_conversions":              "Trial-to-paid conversions (Stripe)",
    "mrr":                           "Monthly Recurring Revenue snapshot (USD)",
    "refunds":                       "Refunds processed (Stripe)",
    "churned_users":                 "Cancelled subscriptions (Stripe)",
    "content_posts":                 "Content posts published (TikTok / social)",
    "content_views":                 "Total content views across all posts",
    "founder_distribution_actions":  "Founder outreach / distribution actions",
}

METRIC_HINTS: dict[str, str] = {
    "website_visitors":              "Vercel Analytics / Plausible â€” weekly unique sessions",
    "downloads":                     "Vercel / GitHub Releases â€” installer download count",
    "account_signups":               "Supabase: COUNT(*) FROM auth.users WHERE created_at >= week_start",
    "activation_attempts":           "Supabase: sessions that reached activation screen this week",
    "first_successful_dictations":   "Supabase history table: COUNT(DISTINCT user_id) first dictations this week",
    "trial_starts":                  "Stripe Dashboard: New trials started this week",
    "paid_conversions":              "Stripe Dashboard: Subscriptions converted from trial this week",
    "mrr":                           "Stripe Dashboard: MRR snapshot (end of week)",
    "refunds":                       "Stripe Dashboard: Refunds processed this week",
    "churned_users":                 "Stripe Dashboard: Cancelled subscriptions this week",
    "content_posts":                 "Manual count: posts published to TikTok/social this week",
    "content_views":                 "TikTok Analytics: total views across all published content",
    "founder_distribution_actions":  "Manual count: DMs, outreach emails, community posts this week",
}

FUNNEL_GROUPS: dict[str, list[str]] = {
    "Distribution (top of funnel)": [
        "website_visitors", "downloads", "content_posts", "content_views",
        "founder_distribution_actions",
    ],
    "Activation funnel": [
        "account_signups", "activation_attempts", "first_successful_dictations",
    ],
    "Revenue": [
        "trial_starts", "paid_conversions", "mrr", "refunds", "churned_users",
    ],
}

# Statuses that produce a usable numeric value
CHECKED_STATUSES = {"measured", "zero"}

MIN_WEEKS_FOR_BASELINE = 4

STATUS_ICONS = {
    "measured":       "âœ…",
    "zero":           "âœ…",
    "unknown":        "âš ï¸",
    "not_available":  "ðŸ”´",
    "not_applicable": "â¸",
}


# ---------------------------------------------------------------------------
# Data loading and partitioning
# ---------------------------------------------------------------------------

def _read_optional_jsonl(path: str) -> list[dict[str, Any]]:
    try:
        return read_jsonl(path)
    except FileNotFoundError:
        return []


def _partition_observations(
    observations: list[dict[str, Any]],
) -> tuple[
    dict[str, dict[str, list[float]]],   # value_by_metric_period: metric â†’ period â†’ [values]
    dict[str, dict[str, list[str]]],     # status_by_metric_period: metric â†’ period â†’ [statuses]
]:
    value_map: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    status_map: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))

    for obs in observations:
        metric = obs.get("metric", "unknown")
        period = obs.get("period", "unknown")
        status = obs.get("status", "measured")  # legacy records without status field
        value = obs.get("value")

        status_map[metric][period].append(status)

        if status in CHECKED_STATUSES and isinstance(value, (int, float)):
            value_map[metric][period].append(float(value))

    return value_map, status_map


def _all_periods(
    value_map: dict[str, dict[str, list[float]]],
    status_map: dict[str, dict[str, list[str]]],
) -> list[str]:
    periods: set[str] = set()
    for period_map in value_map.values():
        periods.update(period_map.keys())
    for period_map in status_map.values():
        periods.update(period_map.keys())
    return sorted(periods)


def _checked_weeks_for_metric(
    metric: str,
    value_map: dict[str, dict[str, list[float]]],
) -> int:
    """Number of distinct periods where this metric has a checked (measured/zero) value."""
    return len(value_map.get(metric, {}))


def _latest_status_for_metric_period(
    metric: str,
    period: str,
    status_map: dict[str, dict[str, list[str]]],
) -> str | None:
    statuses = status_map.get(metric, {}).get(period)
    if not statuses:
        return None
    # Return the most "informative" status: measured > zero > not_applicable > unknown > not_available
    priority = ["measured", "zero", "not_applicable", "unknown", "not_available"]
    for s in priority:
        if s in statuses:
            return s
    return statuses[-1]


# ---------------------------------------------------------------------------
# Stats helpers
# ---------------------------------------------------------------------------

def _stats(values: list[float]) -> dict[str, float]:
    if not values:
        return {}
    s = sorted(values)
    n = len(s)
    return {
        "count": n,
        "min": s[0],
        "max": s[-1],
        "mean": round(sum(s) / n, 2),
        "last": s[-1],
    }


def _latest_per_period(period_values: dict[str, list[float]]) -> list[tuple[str, float]]:
    result = []
    for period, vals in sorted(period_values.items()):
        result.append((period, round(sum(vals) / len(vals), 2)))
    return result


def _trend_arrow(history: list[float]) -> str:
    if len(history) < 2:
        return ""
    delta = history[-1] - history[-2]
    if delta > 0:
        return "(+)"
    if delta < 0:
        return "(-)"
    return "(=)"


def _get_unit(metric: str, observations: list[dict[str, Any]]) -> str:
    for obs in reversed(observations):
        if obs.get("metric") == metric and obs.get("unit"):
            return obs["unit"]
    return ""


# ---------------------------------------------------------------------------
# Report sections
# ---------------------------------------------------------------------------

def _section_coverage(
    value_map: dict[str, dict[str, list[float]]],
    status_map: dict[str, dict[str, list[str]]],
    total_obs: int,
    all_periods: list[str],
) -> list[str]:
    lines: list[str] = []

    # Determine per-metric category for summary
    checked = []
    never_checked = []
    not_applicable_metrics = []
    for m in PRIORITY_METRICS:
        checked_weeks = _checked_weeks_for_metric(m, value_map)
        all_statuses_for_metric = set()
        for period_statuses in status_map.get(m, {}).values():
            all_statuses_for_metric.update(period_statuses)

        if checked_weeks > 0:
            checked.append(m)
        elif "not_applicable" in all_statuses_for_metric and "measured" not in all_statuses_for_metric and "zero" not in all_statuses_for_metric:
            not_applicable_metrics.append(m)
        else:
            never_checked.append(m)

    baseline_ready = (
        not never_checked
        and all(_checked_weeks_for_metric(m, value_map) >= MIN_WEEKS_FOR_BASELINE for m in PRIORITY_METRICS if m not in not_applicable_metrics)
    )

    lines += [
        "## Coverage",
        "",
        f"- Total observations       : {total_obs}",
        f"- Priority metrics checked : {len(checked)} / {len(PRIORITY_METRICS)}",
        f"- Metrics never checked    : {len(never_checked)}",
        f"- Not applicable yet       : {len(not_applicable_metrics)}",
        f"- Weeks recorded           : {len(all_periods)}",
        f"- Baseline ready (â‰¥{MIN_WEEKS_FOR_BASELINE} weeks all checked): {'YES' if baseline_ready else 'NO'}",
        "",
        "| Metric | Checked weeks | Latest status | Baseline ready |",
        "|---|---|---|---|",
    ]

    for m in PRIORITY_METRICS:
        checked_weeks = _checked_weeks_for_metric(m, value_map)

        # Latest status across all periods for this metric
        all_statuses: list[str] = []
        for period_statuses in status_map.get(m, {}).values():
            all_statuses.extend(period_statuses)
        latest = all_statuses[-1] if all_statuses else "â€”"
        icon = STATUS_ICONS.get(latest, "â€”")

        ready = "âœ…" if checked_weeks >= MIN_WEEKS_FOR_BASELINE else f"âŒ ({checked_weeks}/{MIN_WEEKS_FOR_BASELINE})"
        if latest == "not_applicable":
            ready = "â¸ n/a"

        lines.append(f"| `{m}` | {checked_weeks} | {icon} {latest} | {ready} |")

    lines.append("")
    return lines


def _section_status_breakdown(
    value_map: dict[str, dict[str, list[float]]],
    status_map: dict[str, dict[str, list[str]]],
    all_periods: list[str],
) -> list[str]:
    lines: list[str] = ["## Status Breakdown", ""]

    if not all_periods:
        lines += ["> No observations recorded yet.", ""]
        return lines

    recent_periods = sorted(all_periods)[-4:]
    header = "| Metric | " + " | ".join(recent_periods) + " |"
    sep = "|---|" + "---|" * len(recent_periods)
    lines += [header, sep]

    for m in PRIORITY_METRICS:
        cells = []
        for p in recent_periods:
            status = _latest_status_for_metric_period(m, p, status_map)
            if status is None:
                cells.append("â€”")
            else:
                icon = STATUS_ICONS.get(status, "?")
                # For checked statuses, show the value too
                vals = value_map.get(m, {}).get(p)
                if vals:
                    v = round(sum(vals) / len(vals), 1)
                    cells.append(f"{icon} {v}")
                else:
                    cells.append(f"{icon} {status}")
        lines.append("| `" + m + "` | " + " | ".join(cells) + " |")

    lines += [
        "",
        "Legend: âœ… measured/zero &nbsp; âš ï¸ unknown &nbsp; ðŸ”´ not_available &nbsp; â¸ not_applicable",
        "",
    ]
    return lines


def _section_funnel(
    value_map: dict[str, dict[str, list[float]]],
    status_map: dict[str, dict[str, list[str]]],
    observations: list[dict[str, Any]],
    all_periods: list[str],
) -> list[str]:
    lines: list[str] = ["## Funnel Summary", ""]

    for group_name, metrics in FUNNEL_GROUPS.items():
        lines += [f"### {group_name}", ""]
        lines += ["| Metric | Latest | Trend | Checked weeks |", "|---|---|---|---|"]
        for m in metrics:
            unit = _get_unit(m, observations)
            all_statuses_flat = [s for sl in status_map.get(m, {}).values() for s in sl]
            latest_status = all_statuses_flat[-1] if all_statuses_flat else None
            icon = STATUS_ICONS.get(latest_status, "â€”") if latest_status else "â€”"

            history = _latest_per_period(value_map.get(m, {}))
            checked_weeks = len(history)

            if history:
                latest_period, latest_val = history[-1]
                trend = _trend_arrow([v for _, v in history])
                lines.append(f"| `{m}` | {icon} {latest_val} {unit} ({latest_period}) | {trend} | {checked_weeks} |")
            elif latest_status:
                lines.append(f"| `{m}` | {icon} {latest_status} | â€” | {checked_weeks} |")
            else:
                lines.append(f"| `{m}` | â€” | â€” | 0 |")
        lines.append("")

    return lines


def _section_anomalies(
    value_map: dict[str, dict[str, list[float]]],
    status_map: dict[str, dict[str, list[str]]],
    all_periods: list[str],
) -> list[str]:
    lines: list[str] = ["## Anomaly Flags", ""]
    flags: list[str] = []
    sorted_periods = sorted(all_periods)

    # S7: first_successful_dictations = 0 in any checked week
    for period, vals in value_map.get("first_successful_dictations", {}).items():
        if sum(vals) == 0:
            flags.append(f"ðŸš¨ S7 CRITICAL: `first_successful_dictations` = 0 for {period} â€” activation may be broken.")

    # S6: churned > paid_conversions in latest checked week
    churn_hist = _latest_per_period(value_map.get("churned_users", {}))
    conv_hist = _latest_per_period(value_map.get("paid_conversions", {}))
    if churn_hist and conv_hist:
        _, latest_churn = churn_hist[-1]
        _, latest_conv = conv_hist[-1]
        if latest_churn > latest_conv:
            flags.append(
                f"âš ï¸  S6 WARNING: `churned_users` ({latest_churn}) > `paid_conversions` ({latest_conv}) "
                "in latest week â€” net subscriber loss."
            )

    # MRR drop >10% week-over-week
    mrr_hist = _latest_per_period(value_map.get("mrr", {}))
    if len(mrr_hist) >= 2:
        prev_mrr = mrr_hist[-2][1]
        curr_mrr = mrr_hist[-1][1]
        if prev_mrr > 0:
            drop_pct = (prev_mrr - curr_mrr) / prev_mrr * 100
            if drop_pct > 10:
                flags.append(
                    f"âš ï¸  S5 WARNING: MRR dropped {drop_pct:.1f}% week-over-week "
                    f"({prev_mrr} â†’ {curr_mrr} USD)."
                )

    # Unknown â‰¥2 consecutive weeks for any priority metric
    for m in PRIORITY_METRICS:
        periods_for_metric = sorted(status_map.get(m, {}).keys())
        if len(periods_for_metric) >= 2:
            consecutive_unknown = 0
            for p in periods_for_metric[-4:]:
                statuses = status_map[m].get(p, [])
                if all(s == "unknown" for s in statuses):
                    consecutive_unknown += 1
                else:
                    consecutive_unknown = 0
            if consecutive_unknown >= 2:
                flags.append(
                    f"âš ï¸  UNCHECKED: `{m}` marked unknown for {consecutive_unknown} consecutive weeks â€” add to weekly routine."
                )

    # not_available â‰¥4 weeks for any priority metric
    for m in PRIORITY_METRICS:
        na_count = sum(
            1 for p, statuses in status_map.get(m, {}).items()
            if all(s == "not_available" for s in statuses)
        )
        if na_count >= 4:
            flags.append(
                f"ðŸ”´ SETUP BLOCKER: `{m}` has been not_available for {na_count} weeks â€” data source setup needed."
            )

    if flags:
        for flag in flags:
            lines.append(f"- {flag}")
    else:
        lines.append("> No anomalies detected in current data.")

    lines.append("")
    return lines


def _section_backlog(
    status_map: dict[str, dict[str, list[str]]],
) -> list[str]:
    not_available: list[str] = []
    for m in PRIORITY_METRICS:
        all_statuses = [s for sl in status_map.get(m, {}).values() for s in sl]
        if all_statuses and all(s == "not_available" for s in all_statuses):
            not_available.append(m)

    if not not_available:
        return []

    lines: list[str] = [
        "## Data Source Backlog",
        "",
        "These metrics are marked `not_available` â€” the data source needs to be set up:",
        "",
    ]
    for m in not_available:
        hint = METRIC_HINTS.get(m, "Set up data source.")
        lines.append(f"- **`{m}`**: {hint}")
    lines.append("")
    return lines


def _section_missing(
    value_map: dict[str, dict[str, list[float]]],
    status_map: dict[str, dict[str, list[str]]],
) -> list[str]:
    truly_missing: list[str] = []
    for m in PRIORITY_METRICS:
        has_checked = _checked_weeks_for_metric(m, value_map) > 0
        all_statuses = [s for sl in status_map.get(m, {}).values() for s in sl]
        is_not_applicable = all_statuses and all(s == "not_applicable" for s in all_statuses)
        is_not_available = all_statuses and all(s == "not_available" for s in all_statuses)

        if not has_checked and not is_not_applicable and not is_not_available:
            truly_missing.append(m)

    if not truly_missing:
        return ["## Missing Priority Metrics", "", "> All priority metrics have at least one observation.", ""]

    lines: list[str] = [
        "## Missing Priority Metrics",
        "",
        "No confirmed observations yet (excluding not_available and not_applicable):",
        "",
    ]
    for m in truly_missing:
        desc = METRIC_DESCRIPTIONS.get(m, m)
        hint = METRIC_HINTS.get(m, "Manual measurement required.")
        lines += [
            f"### `{m}`",
            f"*{desc}*",
            "",
            f"How to collect: {hint}",
            "",
            "Record with:",
            "```",
            f"python internal/brain/scripts/add_business_observation.py \\",
            f"    --metric {m} --value <value> --unit <unit> \\",
            f"    --source <source> --period <YYYY-Www>",
            "```",
            "",
        ]
    return lines


def _section_v7_connection() -> list[str]:
    return [
        "## Product-to-Business Connection (V7 Baseline)",
        "",
        "> Placeholder â€” will populate when V7 product data and V8 business data",
        "> cover the same weeks. Requires `correlate_metrics.py` (V8 Phase 2).",
        "",
        "| V7 Metric | Value | V8 Question | Business Metric |",
        "|---|---|---|---|",
        "| `total_dictation_latency_ms` p50 | 1043 ms | Does lower latency increase retention? | `first_successful_dictations` |",
        "| `paste_execute` | 645 ms (62% of p50) | Paste fix â†’ engagement rise? | `content_views` / dictations per WAU |",
        "| Idle RAM growth | +110 MB / 15 min | RAM fix â†’ lower churn? | `churned_users` |",
        "",
    ]


def _section_next_actions(
    value_map: dict[str, dict[str, list[float]]],
    status_map: dict[str, dict[str, list[str]]],
    all_periods: list[str],
) -> list[str]:
    lines = ["## Suggested Next Actions", ""]

    truly_missing = [
        m for m in PRIORITY_METRICS
        if _checked_weeks_for_metric(m, value_map) == 0
        and not all(s == "not_applicable" for sl in status_map.get(m, {}).values() for s in sl)
        and not all(s == "not_available" for sl in status_map.get(m, {}).values() for s in sl)
    ]

    if truly_missing:
        lines += [
            f"**Collect missing metrics ({len(truly_missing)} remaining):**",
            "",
        ]
        for m in truly_missing[:3]:
            lines.append(f"- `{m}`: {METRIC_HINTS.get(m, 'manual measurement required')}")
        if len(truly_missing) > 3:
            lines.append(f"- ... and {len(truly_missing) - 3} more (see Missing Priority Metrics section)")
        lines.append("")

    weeks = len(all_periods)
    if weeks < MIN_WEEKS_FOR_BASELINE:
        lines += [
            f"**Continue weekly recordings:** {weeks}/{MIN_WEEKS_FOR_BASELINE} weeks of checked data needed.",
            "Record metrics every Monday from Stripe / Supabase / Vercel dashboards.",
            "",
        ]
    else:
        all_checked = all(
            _checked_weeks_for_metric(m, value_map) >= MIN_WEEKS_FOR_BASELINE
            for m in PRIORITY_METRICS
            if not all(s == "not_applicable" for sl in status_map.get(m, {}).values() for s in sl)
        )
        if all_checked:
            lines += [
                "**Baseline ready to lock.** All metrics have sufficient checked data.",
                "Next: build `lock_business_baseline.py --approve` (V8 Phase 2 â€” not yet built).",
                "",
            ]
        else:
            lines += [
                f"**{weeks} weeks recorded, but some metrics still need more checked observations.**",
                "",
            ]

    lines += [
        "> This report is measurement-only.",
        "> Growth recommendations require â‰¥4 weeks of checked baseline data.",
        "",
    ]
    return lines


# ---------------------------------------------------------------------------
# Report builder
# ---------------------------------------------------------------------------

def _build_report(observations: list[dict[str, Any]], now: datetime) -> str:
    lines: list[str] = []
    value_map, status_map = _partition_observations(observations)
    all_periods = _all_periods(value_map, status_map)

    lines += [
        "# Vocalype Brain â€” V8 Business Metrics Report",
        "",
        f"Date: {now.isoformat()}",
        f"Total observations: {len(observations)}",
        "",
        "> This report is measurement-only. No growth recommendations.",
        "> Only `measured` and `zero` observations count toward the baseline.",
        "",
        "---",
        "",
    ]

    lines += _section_coverage(value_map, status_map, len(observations), all_periods)
    lines += ["---", ""]
    lines += _section_status_breakdown(value_map, status_map, all_periods)
    lines += ["---", ""]
    lines += _section_funnel(value_map, status_map, observations, all_periods)
    lines += ["---", ""]
    lines += _section_anomalies(value_map, status_map, all_periods)
    lines += ["---", ""]

    backlog = _section_backlog(status_map)
    if backlog:
        lines += backlog
        lines += ["---", ""]

    lines += _section_missing(value_map, status_map)
    lines += ["---", ""]
    lines += _section_v7_connection()
    lines += ["---", ""]
    lines += _section_next_actions(value_map, status_map, all_periods)
    lines += [
        "---",
        "",
        "## Stop Conditions",
        "",
        "Do not begin growth optimisation until:",
        f"- â‰¥{MIN_WEEKS_FOR_BASELINE} weeks of **checked** observations for every applicable metric",
        "- Business baseline locked in `data/business_baseline.jsonl`",
        "- `first_successful_dictations` > 0 every week (activation is working)",
        "- At least one product change benchmarked before AND after",
        "",
        "*This report is measurement-only. V8 Phase 1 does not optimise â€” it measures.*",
    ]

    return "\n".join(lines).rstrip() + "\n"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ensure_brain_structure()
    now = datetime.now().replace(microsecond=0)

    observations = _read_optional_jsonl("data/business_observations.jsonl")
    value_map, status_map = _partition_observations(observations)
    all_periods = _all_periods(value_map, status_map)

    report_md = _build_report(observations, now)
    write_text("outputs/business_report.md", report_md)

    checked_metrics = [m for m in PRIORITY_METRICS if _checked_weeks_for_metric(m, value_map) > 0]
    missing = [
        m for m in PRIORITY_METRICS
        if _checked_weeks_for_metric(m, value_map) == 0
        and not all(s == "not_applicable" for sl in status_map.get(m, {}).values() for s in sl)
    ]

    divider = "=" * 60
    print(divider)
    print("V8 Business Metrics Review")
    print(divider)
    print(f"\nTotal observations   : {len(observations)}")
    print(f"Priority checked     : {len(checked_metrics)}/{len(PRIORITY_METRICS)} metrics")
    print(f"Weeks recorded       : {len(all_periods)}")
    if missing:
        print(f"Missing              : {', '.join(missing[:3])}{'...' if len(missing) > 3 else ''}")
    baseline_ready = (
        len(all_periods) >= MIN_WEEKS_FOR_BASELINE
        and all(_checked_weeks_for_metric(m, value_map) >= MIN_WEEKS_FOR_BASELINE for m in PRIORITY_METRICS
                if not all(s == "not_applicable" for sl in status_map.get(m, {}).values() for s in sl))
    )
    print(f"Baseline ready       : {'YES' if baseline_ready else f'NO ({len(all_periods)}/{MIN_WEEKS_FOR_BASELINE} weeks checked)'}")
    print(f"\nWritten: internal/brain/outputs/business_report.md")
    print(divider)


if __name__ == "__main__":
    main()
