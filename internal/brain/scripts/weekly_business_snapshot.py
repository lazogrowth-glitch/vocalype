"""weekly_business_snapshot.py â€” V8 Weekly Business Snapshot Generator.

Reads data/business_observations.jsonl and writes a founder-facing
weekly checklist to outputs/weekly_business_snapshot.md.

The snapshot is:
  - Honest: distinguishes measured vs zero vs unknown vs not_available vs not_applicable
  - Actionable: one checklist for what to do this week
  - Anti-hype: a "do not overreact yet" section prevents premature conclusions
  - Forward-looking: lists the next metrics to record

Does NOT invent data. Does NOT recommend growth strategy.
Does NOT recommend product changes. Does NOT treat validation samples as traction.
Does NOT modify product code.
"""
from __future__ import annotations

import sys
from collections import defaultdict
from datetime import datetime, date
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
    "website_visitors":              "Website visitors",
    "downloads":                     "Installer downloads",
    "account_signups":               "New signups",
    "activation_attempts":           "Activation attempts",
    "first_successful_dictations":   "First successful dictations (North Star)",
    "trial_starts":                  "Trial starts",
    "paid_conversions":              "Paid conversions",
    "mrr":                           "MRR (USD)",
    "refunds":                       "Refunds",
    "churned_users":                 "Churned users",
    "content_posts":                 "Content posts published",
    "content_views":                 "Content views",
    "founder_distribution_actions":  "Distribution actions",
}

METRIC_SOURCES: dict[str, str] = {
    "website_visitors":              "Vercel / Plausible",
    "downloads":                     "Vercel / GitHub Releases",
    "account_signups":               "Supabase auth.users",
    "activation_attempts":           "Supabase",
    "first_successful_dictations":   "Supabase history table",
    "trial_starts":                  "Stripe Dashboard",
    "paid_conversions":              "Stripe Dashboard",
    "mrr":                           "Stripe Dashboard",
    "refunds":                       "Stripe Dashboard",
    "churned_users":                 "Stripe Dashboard",
    "content_posts":                 "Manual count",
    "content_views":                 "TikTok / social analytics",
    "founder_distribution_actions":  "Manual count",
}

VALIDATION_SOURCES = {"manual_validation"}
CHECKED_STATUSES = {"measured", "zero"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_optional_jsonl(path: str) -> list[dict[str, Any]]:
    try:
        return read_jsonl(path)
    except FileNotFoundError:
        return []


def _current_iso_week() -> str:
    today = date.today()
    year, week, _ = today.isocalendar()
    return f"{year}-W{week:02d}"


def _is_validation(obs: dict[str, Any]) -> bool:
    return obs.get("source", "") in VALIDATION_SOURCES


def _latest_period(observations: list[dict[str, Any]]) -> str | None:
    """Return the most recent non-validation period, or None if all are validation."""
    periods = [
        obs["period"] for obs in observations
        if obs.get("period") and not _is_validation(obs)
    ]
    return max(periods) if periods else None


def _observations_for_period(
    observations: list[dict[str, Any]],
    period: str,
    include_validation: bool = False,
) -> list[dict[str, Any]]:
    return [
        obs for obs in observations
        if obs.get("period") == period
        and (include_validation or not _is_validation(obs))
    ]


def _status_for_metric(
    metric: str,
    period_obs: list[dict[str, Any]],
) -> str | None:
    """Return the most informative status for a metric within a period's observations."""
    statuses = [
        obs.get("status", "measured")
        for obs in period_obs
        if obs.get("metric") == metric
    ]
    if not statuses:
        return None
    priority = ["measured", "zero", "not_applicable", "unknown", "not_available"]
    for s in priority:
        if s in statuses:
            return s
    return statuses[-1]


def _latest_value_for_metric(
    metric: str,
    period_obs: list[dict[str, Any]],
) -> tuple[float | None, str]:
    """Return (value, unit) for the latest checked observation of a metric."""
    for obs in reversed(period_obs):
        if obs.get("metric") == metric and obs.get("status") in CHECKED_STATUSES:
            return obs.get("value"), obs.get("unit", "")
    return None, ""


def _notes_for_metric(
    metric: str,
    period_obs: list[dict[str, Any]],
) -> str | None:
    for obs in reversed(period_obs):
        if obs.get("metric") == metric and obs.get("notes"):
            return obs["notes"]
    return None


# ---------------------------------------------------------------------------
# Snapshot builder
# ---------------------------------------------------------------------------

def _build_snapshot(
    observations: list[dict[str, Any]],
    now: datetime,
) -> str:
    lines: list[str] = []

    current_week = _current_iso_week()
    real_obs = [o for o in observations if not _is_validation(o)]
    latest_period = _latest_period(observations)
    snapshot_period = latest_period or current_week
    period_obs = _observations_for_period(observations, snapshot_period, include_validation=False)
    has_real_data = len(real_obs) > 0

    # Classify metrics for the snapshot period
    checked: list[tuple[str, float | None, str, str | None]] = []   # (metric, value, unit, notes)
    zeroed: list[tuple[str, str | None]] = []                        # (metric, notes)
    unknown: list[str] = []
    not_available: list[str] = []
    not_applicable: list[str] = []
    unrecorded: list[str] = []

    for m in PRIORITY_METRICS:
        status = _status_for_metric(m, period_obs)
        if status == "measured":
            val, unit = _latest_value_for_metric(m, period_obs)
            notes = _notes_for_metric(m, period_obs)
            checked.append((m, val, unit, notes))
        elif status == "zero":
            notes = _notes_for_metric(m, period_obs)
            zeroed.append((m, notes))
        elif status == "unknown":
            unknown.append(m)
        elif status == "not_available":
            not_available.append(m)
        elif status == "not_applicable":
            not_applicable.append(m)
        else:
            unrecorded.append(m)

    # ---
    lines += [
        "# Vocalype Brain â€” Weekly Business Snapshot",
        "",
        f"Generated: {now.isoformat()}",
        f"Snapshot period: **{snapshot_period}**",
        f"Current week: {current_week}",
        "",
    ]

    if not has_real_data:
        lines += [
            "> âš ï¸  No real business observations found â€” only validation samples exist.",
            "> Record actual metrics from your Stripe, Supabase, and Vercel dashboards",
            "> before using this snapshot for any decisions.",
            "",
        ]

    lines += ["---", ""]

    # --- Metrics checked ---
    lines += ["## Metrics Recorded This Week", ""]
    if checked or zeroed:
        lines += ["| Metric | Value | Notes |", "|---|---|---|"]
        for m, val, unit, notes in checked:
            desc = METRIC_DESCRIPTIONS.get(m, m)
            val_str = f"{val} {unit}".strip() if val is not None else "â€”"
            notes_str = notes or "â€”"
            lines.append(f"| **{desc}** | {val_str} | {notes_str} |")
        for m, notes in zeroed:
            desc = METRIC_DESCRIPTIONS.get(m, m)
            notes_str = notes or "confirmed zero"
            lines.append(f"| {desc} | âœ… 0 (confirmed) | {notes_str} |")
    else:
        lines.append("> No metrics recorded yet for this period.")
    lines.append("")

    # --- Unknown ---
    if unknown:
        lines += [
            "## Metrics Not Checked This Week",
            "",
            "These were not checked â€” status is `unknown`. They do NOT count toward the baseline.",
            "",
        ]
        for m in unknown:
            desc = METRIC_DESCRIPTIONS.get(m, m)
            source = METRIC_SOURCES.get(m, "manual")
            lines.append(f"- **{desc}** â€” check: {source}")
        lines.append("")

    # --- Not available ---
    if not_available:
        lines += [
            "## Data Sources Missing",
            "",
            "These metrics cannot be recorded until the data source is set up:",
            "",
        ]
        for m in not_available:
            desc = METRIC_DESCRIPTIONS.get(m, m)
            source = METRIC_SOURCES.get(m, "manual")
            lines.append(f"- **{desc}** â€” needs: {source}")
        lines.append("")

    # --- Not applicable ---
    if not_applicable:
        lines += [
            "## Not Applicable Yet",
            "",
            "These metrics don't apply at the current stage:",
            "",
        ]
        for m in not_applicable:
            desc = METRIC_DESCRIPTIONS.get(m, m)
            lines.append(f"- {desc}")
        lines.append("")

    # --- Unrecorded (not even a status) ---
    if unrecorded:
        lines += [
            "## Not Yet Recorded",
            "",
            "No observation of any kind for these metrics:",
            "",
        ]
        for m in unrecorded:
            desc = METRIC_DESCRIPTIONS.get(m, m)
            source = METRIC_SOURCES.get(m, "manual")
            lines.append(f"- **{desc}** â€” source: {source}")
        lines.append("")

    lines += ["---", ""]

    # --- Founder action checklist ---
    lines += [
        "## Founder Action Checklist",
        "",
        "Run this every Monday (10 minutes):",
        "",
    ]

    checklist_items: list[str] = []

    # North Star first
    north_star_status = _status_for_metric("first_successful_dictations", period_obs)
    if north_star_status is None or north_star_status in ("unknown", "not_available"):
        checklist_items.append(
            "[ ] **Check North Star:** open Supabase â†’ history table â†’ "
            "count distinct users with first dictation this week â†’ record `first_successful_dictations`"
        )
    elif north_star_status == "zero":
        checklist_items.append(
            "[ ] **North Star = 0 this week.** Verify activation flow is working before anything else."
        )

    # MRR
    mrr_status = _status_for_metric("mrr", period_obs)
    if mrr_status not in CHECKED_STATUSES:
        checklist_items.append(
            "[ ] Open Stripe â†’ record `mrr` (even if $0)"
        )

    # Downloads
    dl_status = _status_for_metric("downloads", period_obs)
    if dl_status not in CHECKED_STATUSES:
        checklist_items.append(
            "[ ] Open Vercel / download page â†’ record `downloads` (even if 0)"
        )

    # Unknown metrics
    for m in unknown:
        desc = METRIC_DESCRIPTIONS.get(m, m)
        source = METRIC_SOURCES.get(m, "manual")
        checklist_items.append(f"[ ] Check {source} â†’ record `{m}`")

    # Not available blockers
    for m in not_available:
        desc = METRIC_DESCRIPTIONS.get(m, m)
        source = METRIC_SOURCES.get(m, "manual")
        checklist_items.append(
            f"[ ] **Setup needed:** configure {source} so `{m}` can be recorded"
        )

    # Unrecorded priority items
    priority_unrecorded = [m for m in ("account_signups", "content_posts", "founder_distribution_actions") if m in unrecorded]
    for m in priority_unrecorded:
        source = METRIC_SOURCES.get(m, "manual")
        checklist_items.append(f"[ ] Record `{m}` from {source}")

    # Always: run review
    checklist_items.append(
        "[ ] Run: `python internal/brain/scripts/review_business_metrics.py`"
    )
    checklist_items.append(
        "[ ] Commit: `git add internal/brain/data/business_observations.jsonl "
        "internal/brain/outputs/ && git commit -m \"data(brain): weekly business snapshot YYYY-Www\"`"
    )

    for item in checklist_items:
        lines.append(item)
    lines.append("")

    lines += ["---", ""]

    # --- Do not overreact yet ---
    lines += [
        "## Do Not Overreact Yet",
        "",
        "This is an **early measurement phase.** These conclusions are premature:",
        "",
    ]

    premature: list[str] = []

    zero_metrics = [m for m, _ in zeroed]
    if "downloads" in zero_metrics or "downloads" in unrecorded:
        premature.append(
            "- 0 downloads â‰  product failure. It may mean distribution has not started yet."
        )
    if "mrr" in zero_metrics or not checked:
        premature.append(
            "- $0 MRR â‰  unsustainable. Pre-revenue is normal at this stage."
        )
    if "first_successful_dictations" in zero_metrics:
        premature.append(
            "- 0 first dictations: check the activation flow before drawing conclusions "
            "(may be a bug, not a product problem)."
        )
    if len(unrecorded) > 5:
        premature.append(
            f"- {len(unrecorded)} metrics unrecorded: no trend exists yet. "
            "One week of data is not a pattern."
        )
    if not premature:
        premature.append(
            "- No specific overreaction risk flagged â€” but remember: one data point is not a trend."
        )

    lines += premature
    lines += [
        "",
        "> Baseline requires â‰¥4 weeks of checked data before any pattern is meaningful.",
        "",
    ]

    lines += ["---", ""]

    # --- Next metrics to record ---
    next_to_record: list[str] = []
    if "first_successful_dictations" in unrecorded or north_star_status in ("unknown", None):
        next_to_record.append("`first_successful_dictations` â€” North Star, highest priority")
    for m in unrecorded:
        if m != "first_successful_dictations":
            source = METRIC_SOURCES.get(m, "manual")
            next_to_record.append(f"`{m}` â€” {source}")
    for m in unknown:
        source = METRIC_SOURCES.get(m, "manual")
        next_to_record.append(f"`{m}` â€” was unknown last check ({source})")

    lines += ["## Next Metrics to Record", ""]
    if next_to_record:
        for item in next_to_record[:6]:
            lines.append(f"1. {item}")
        if len(next_to_record) > 6:
            lines.append(f"   *(and {len(next_to_record) - 6} more â€” see business_report.md)*")
    else:
        lines.append("> All priority metrics have been checked this period.")
    lines.append("")

    lines += [
        "---",
        "",
        f"*Snapshot generated from {len(real_obs)} real observations "
        f"({len(observations) - len(real_obs)} validation samples excluded).*",
        f"*Source: `internal/brain/data/business_observations.jsonl`*",
        f"*To record an observation: `python internal/brain/scripts/add_business_observation.py --help`*",
    ]

    return "\n".join(lines).rstrip() + "\n"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ensure_brain_structure()
    now = datetime.now().replace(microsecond=0)

    observations = _read_optional_jsonl("data/business_observations.jsonl")
    snapshot_md = _build_snapshot(observations, now)
    write_text("outputs/weekly_business_snapshot.md", snapshot_md)

    real_obs = [o for o in observations if o.get("source", "") not in {"manual_validation"}]
    latest_period = _latest_period(observations)
    period_obs = [
        o for o in observations
        if o.get("period") == latest_period and o.get("source", "") not in {"manual_validation"}
    ] if latest_period else []

    checked_count = sum(
        1 for m in ["website_visitors", "downloads", "mrr", "first_successful_dictations",
                    "account_signups", "paid_conversions", "content_posts"]
        if any(o.get("metric") == m and o.get("status", "measured") in {"measured", "zero"}
               for o in period_obs)
    )

    divider = "=" * 60
    print(divider)
    print("V8 Weekly Business Snapshot")
    print(divider)
    print(f"\nSnapshot period  : {latest_period or _current_iso_week()} (latest with data)")
    print(f"Real observations: {len(real_obs)} (validation samples excluded)")
    print(f"Checked metrics  : {checked_count} / 7 key metrics")
    if not real_obs:
        print("\nWARNING: No real observations â€” only validation samples found.")
        print("         Record actual metrics from your dashboards first.")
    print(f"\nWritten: internal/brain/outputs/weekly_business_snapshot.md")
    print(divider)


if __name__ == "__main__":
    main()
