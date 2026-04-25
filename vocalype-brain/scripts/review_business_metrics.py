"""review_business_metrics.py — V8 Phase 1 Business Metrics Reviewer.

Reads data/business_observations.jsonl and produces:
  outputs/business_report.md

Reports funnel coverage, weekly trends, missing priority metrics,
and a V7-to-business connection placeholder.
Does NOT produce growth recommendations or optimisation suggestions.

Does NOT modify product code. Does NOT connect APIs. Measurement only.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any

from brain import ensure_brain_structure, read_jsonl, write_text

# ---------------------------------------------------------------------------
# Priority metrics and metadata
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
    "first_successful_dictations":   "Users who completed first dictation — North Star",
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
    "website_visitors":              "Vercel Analytics or Plausible — weekly unique sessions",
    "downloads":                     "Vercel / GitHub Releases — installer download count",
    "account_signups":               "Supabase: SELECT COUNT(*) FROM auth.users WHERE created_at >= week_start",
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

# Funnel groupings for the report
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

MIN_WEEKS_FOR_BASELINE = 4


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_optional_jsonl(path: str) -> list[dict[str, Any]]:
    try:
        return read_jsonl(path)
    except FileNotFoundError:
        return []


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


def _group_by_metric_and_period(
    observations: list[dict[str, Any]],
) -> dict[str, dict[str, list[float]]]:
    """Returns {metric: {period: [values]}}."""
    result: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for obs in observations:
        metric = obs.get("metric", "unknown")
        period = obs.get("period", "unknown")
        value = obs.get("value")
        if isinstance(value, (int, float)):
            result[metric][period].append(float(value))
    return result


def _latest_per_period(period_values: dict[str, list[float]]) -> list[tuple[str, float]]:
    """Returns sorted list of (period, mean_value) — most recent last."""
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


# ---------------------------------------------------------------------------
# Report sections
# ---------------------------------------------------------------------------

def _section_coverage(
    by_metric_period: dict[str, dict[str, list[float]]],
    total_obs: int,
    all_periods: list[str],
) -> list[str]:
    lines: list[str] = []
    covered = [m for m in PRIORITY_METRICS if m in by_metric_period]
    missing = [m for m in PRIORITY_METRICS if m not in by_metric_period]
    weeks_recorded = len(all_periods)

    lines += [
        "## Coverage",
        "",
        f"- Total observations     : {total_obs}",
        f"- Priority metrics seen  : {len(covered)} / {len(PRIORITY_METRICS)}",
        f"- Priority metrics missing: {len(missing)}",
        f"- Weeks recorded         : {weeks_recorded}",
        f"- Baseline ready (≥{MIN_WEEKS_FOR_BASELINE} weeks): "
        f"{'YES' if weeks_recorded >= MIN_WEEKS_FOR_BASELINE and not missing else 'NO'}",
        "",
        "| Metric | Weeks recorded | Baseline ready |",
        "|---|---|---|",
    ]
    for m in PRIORITY_METRICS:
        weeks = len(by_metric_period.get(m, {}))
        ready = "✅ Yes" if weeks >= MIN_WEEKS_FOR_BASELINE else f"❌ No ({weeks}/{MIN_WEEKS_FOR_BASELINE})"
        lines.append(f"| `{m}` | {weeks} | {ready} |")
    lines.append("")
    return lines


def _section_funnel(
    by_metric_period: dict[str, dict[str, list[float]]],
    observations: list[dict[str, Any]],
) -> list[str]:
    lines: list[str] = ["## Funnel Summary", ""]

    # Show latest week value per group
    for group_name, metrics in FUNNEL_GROUPS.items():
        lines += [f"### {group_name}", ""]
        lines += ["| Metric | Latest week | Trend | Weeks recorded |", "|---|---|---|---|"]
        for m in metrics:
            if m not in by_metric_period:
                lines.append(f"| `{m}` | — | — | 0 |")
                continue
            history = _latest_per_period(by_metric_period[m])
            trend = _trend_arrow([v for _, v in history])
            latest_period, latest_val = history[-1]
            weeks = len(history)
            unit = _get_unit(m, observations)
            lines.append(f"| `{m}` | {latest_val} {unit} ({latest_period}) | {trend} | {weeks} |")
        lines.append("")

    return lines


def _section_weekly_trends(
    by_metric_period: dict[str, dict[str, list[float]]],
    observations: list[dict[str, Any]],
    all_periods: list[str],
) -> list[str]:
    if len(all_periods) < 2:
        return ["## Weekly Trends", "", "> Insufficient data — need ≥2 weeks to show trends.", ""]

    lines = ["## Weekly Trends", ""]
    recent_periods = sorted(all_periods)[-4:]  # Last 4 weeks

    # Header
    header = "| Metric | " + " | ".join(recent_periods) + " |"
    sep = "|---|" + "---|" * len(recent_periods)
    lines += [header, sep]

    for m in PRIORITY_METRICS:
        if m not in by_metric_period:
            row = f"| `{m}` | " + " | ".join("—" for _ in recent_periods) + " |"
        else:
            vals = []
            for p in recent_periods:
                period_vals = by_metric_period[m].get(p)
                if period_vals:
                    vals.append(str(round(sum(period_vals) / len(period_vals), 1)))
                else:
                    vals.append("—")
            row = f"| `{m}` | " + " | ".join(vals) + " |"
        lines.append(row)

    lines.append("")
    return lines


def _section_v7_connection() -> list[str]:
    return [
        "## Product-to-Business Connection (V7 Baseline)",
        "",
        "> This section will populate automatically once V7 product data and V8 business",
        "> data cover the same time periods. Placeholder until correlate_metrics.py is built.",
        "",
        "| V7 Product Metric | Current Value | V8 Business Question | Business Metric |",
        "|---|---|---|---|",
        "| `total_dictation_latency_ms` p50 | 1043 ms (38 runs) | Does lower latency increase retention? | `first_successful_dictations` |",
        "| `paste_execute` | 645 ms (62% of p50) | If paste drops to 100ms, does engagement rise? | `dictations_per_wau` (not yet recorded) |",
        "| Idle background inference loop | +110 MB over 15min | Does fixing RAM growth reduce churn? | `churned_users` |",
        "| `activation_success_rate` | Unmeasured | Is activation the conversion bottleneck? | `activation_attempts` vs `first_successful_dictations` |",
        "",
        "> Correlation analysis requires `correlate_metrics.py` (V8 Phase 2 — not yet built).",
        "",
    ]


def _section_missing(
    by_metric_period: dict[str, dict[str, list[float]]],
) -> list[str]:
    missing = [m for m in PRIORITY_METRICS if m not in by_metric_period]
    if not missing:
        return ["## Missing Priority Metrics", "", "> All priority metrics have at least one observation.", ""]

    lines = [
        "## Missing Priority Metrics",
        "",
        "The following priority metrics have no observations yet.",
        "Record these during your weekly 10-minute dashboard session.",
        "",
    ]
    for m in missing:
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
            f"python vocalype-brain/scripts/add_business_observation.py \\",
            f"    --metric {m} --value <your_value> --unit <unit> \\",
            f"    --source <source> --period <YYYY-Www>",
            "```",
            "",
        ]
    return lines


def _section_anomalies(
    by_metric_period: dict[str, dict[str, list[float]]],
) -> list[str]:
    lines: list[str] = ["## Anomaly Flags", ""]
    flags: list[str] = []

    # S7: first_successful_dictations = 0 in any week
    if "first_successful_dictations" in by_metric_period:
        for period, vals in by_metric_period["first_successful_dictations"].items():
            if sum(vals) == 0:
                flags.append(f"S7 CRITICAL: `first_successful_dictations` = 0 for {period} — activation may be broken.")

    # S6: churned > converted for last available week
    if "churned_users" in by_metric_period and "paid_conversions" in by_metric_period:
        churn_hist = _latest_per_period(by_metric_period["churned_users"])
        conv_hist = _latest_per_period(by_metric_period["paid_conversions"])
        if churn_hist and conv_hist:
            _, latest_churn = churn_hist[-1]
            _, latest_conv = conv_hist[-1]
            if latest_churn > latest_conv:
                flags.append(
                    f"S6 WARNING: `churned_users` ({latest_churn}) > `paid_conversions` ({latest_conv}) "
                    f"in latest week — net subscriber loss."
                )

    # MRR drop > 10% week-over-week
    if "mrr" in by_metric_period:
        mrr_hist = _latest_per_period(by_metric_period["mrr"])
        if len(mrr_hist) >= 2:
            prev_mrr = mrr_hist[-2][1]
            curr_mrr = mrr_hist[-1][1]
            if prev_mrr > 0:
                drop_pct = (prev_mrr - curr_mrr) / prev_mrr * 100
                if drop_pct > 10:
                    flags.append(
                        f"S5 WARNING: MRR dropped {drop_pct:.1f}% week-over-week "
                        f"({prev_mrr} -> {curr_mrr} USD)."
                    )

    if flags:
        for flag in flags:
            lines.append(f"- {flag}")
    else:
        lines.append("> No anomalies detected in current data.")

    lines.append("")
    return lines


def _section_next_actions(
    by_metric_period: dict[str, dict[str, list[float]]],
    all_periods: list[str],
) -> list[str]:
    missing = [m for m in PRIORITY_METRICS if m not in by_metric_period]
    lines = ["## Suggested Next Actions", ""]

    if missing:
        lines += [
            f"**Collect missing metrics ({len(missing)} remaining):**",
            "",
        ]
        for m in missing[:3]:
            lines.append(f"- `{m}`: {METRIC_HINTS.get(m, 'Manual measurement required.')}")
        if len(missing) > 3:
            lines.append(f"- ... and {len(missing) - 3} more (see Missing Priority Metrics section)")
        lines.append("")

    weeks = len(all_periods)
    if weeks < MIN_WEEKS_FOR_BASELINE:
        lines += [
            f"**Continue weekly recordings:** {weeks}/{MIN_WEEKS_FOR_BASELINE} weeks recorded.",
            "Record metrics every Monday from Stripe / Supabase / Vercel dashboards.",
            "",
        ]
    else:
        lines += [
            f"**Baseline ready to lock:** {weeks} weeks of data recorded.",
            "Next: build `lock_business_baseline.py --approve` (V8 Phase 2 — not yet built).",
            "",
        ]

    lines += [
        "> This report is measurement-only.",
        "> Growth recommendations require ≥4 weeks of baseline data + locked baseline.",
    ]
    lines.append("")
    return lines


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_unit(metric: str, observations: list[dict[str, Any]]) -> str:
    for obs in reversed(observations):
        if obs.get("metric") == metric:
            return obs.get("unit", "")
    return ""


def _all_periods(by_metric_period: dict[str, dict[str, list[float]]]) -> list[str]:
    periods: set[str] = set()
    for period_map in by_metric_period.values():
        periods.update(period_map.keys())
    return sorted(periods)


# ---------------------------------------------------------------------------
# Report builder
# ---------------------------------------------------------------------------

def _build_report(observations: list[dict[str, Any]], now: datetime) -> str:
    lines: list[str] = []
    by_metric_period = _group_by_metric_and_period(observations)
    all_periods = _all_periods(by_metric_period)

    lines += [
        "# Vocalype Brain — V8 Business Metrics Report",
        "",
        f"Date: {now.isoformat()}",
        f"Total observations: {len(observations)}",
        "",
        "> This report is measurement-only. No growth recommendations.",
        "> Collect ≥4 weeks of data before locking the business baseline.",
        "",
        "---",
        "",
    ]

    lines += _section_coverage(by_metric_period, len(observations), all_periods)
    lines += ["---", ""]
    lines += _section_funnel(by_metric_period, observations)
    lines += ["---", ""]
    lines += _section_weekly_trends(by_metric_period, observations, all_periods)
    lines += ["---", ""]
    lines += _section_v7_connection()
    lines += ["---", ""]
    lines += _section_anomalies(by_metric_period)
    lines += ["---", ""]
    lines += _section_missing(by_metric_period)
    lines += ["---", ""]
    lines += _section_next_actions(by_metric_period, all_periods)
    lines += [
        "---",
        "",
        "## Stop Conditions",
        "",
        f"Do not begin growth optimisation until:",
        f"- ≥{MIN_WEEKS_FOR_BASELINE} weeks of observations for every priority metric",
        "- Business baseline locked in `data/business_baseline.jsonl`",
        "- At least one product change has been benchmarked before AND after",
        "- `first_successful_dictations` > 0 every week (activation is working)",
        "",
        "*This report is measurement-only. V8 Phase 1 does not optimise — it measures.*",
    ]

    return "\n".join(lines).rstrip() + "\n"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ensure_brain_structure()
    now = datetime.now().replace(microsecond=0)

    observations = _read_optional_jsonl("data/business_observations.jsonl")
    by_metric_period = _group_by_metric_and_period(observations)
    all_periods = _all_periods(by_metric_period)

    report_md = _build_report(observations, now)
    write_text("outputs/business_report.md", report_md)

    covered = [m for m in PRIORITY_METRICS if m in by_metric_period]
    missing = [m for m in PRIORITY_METRICS if m not in by_metric_period]

    divider = "=" * 60
    print(divider)
    print("V8 Business Metrics Review")
    print(divider)
    print(f"\nTotal observations   : {len(observations)}")
    print(f"Priority metrics     : {len(covered)}/{len(PRIORITY_METRICS)} covered")
    print(f"Weeks recorded       : {len(all_periods)}")
    if missing:
        print(f"Missing              : {', '.join(missing[:3])}{'...' if len(missing) > 3 else ''}")
    baseline_ready = len(all_periods) >= MIN_WEEKS_FOR_BASELINE and not missing
    print(f"Baseline ready       : {'YES' if baseline_ready else f'NO ({len(all_periods)}/{MIN_WEEKS_FOR_BASELINE} weeks)'}")
    print(f"\nWritten: vocalype-brain/outputs/business_report.md")
    print(divider)


if __name__ == "__main__":
    main()
