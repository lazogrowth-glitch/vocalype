"""add_business_observation.py — V8 Phase 1 Manual Business Metrics Recorder.

Records one manual business observation to data/business_observations.jsonl.
Used by the founder to build the V8 baseline from Stripe, Supabase, Vercel,
TikTok, and other dashboards.

Does NOT modify product code. Does NOT connect APIs. Does NOT automate growth.

Usage:
    python vocalype-brain/scripts/add_business_observation.py \\
        --metric downloads \\
        --value 12 \\
        --unit count \\
        --source vercel \\
        --period 2026-W17 \\
        [--channel website] \\
        [--segment all] \\
        [--app_version <git-sha>] \\
        [--notes "free text"]
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from datetime import datetime
from typing import Any

from brain import append_jsonl, ensure_brain_structure

# ---------------------------------------------------------------------------
# Priority metrics
# ---------------------------------------------------------------------------

PRIORITY_METRICS = {
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
}

KNOWN_UNITS = {
    "count", "usd", "percent", "%", "ratio", "bool",
    "ms", "mb", "s",
}

KNOWN_SOURCES = {
    "stripe_dashboard",
    "supabase_dashboard",
    "vercel_analytics",
    "tiktok_analytics",
    "github_releases",
    "manual_founder",
    "manual_validation",
    "automated",
}

ISO_WEEK_RE = re.compile(r"^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$")


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
    warnings: list[str] = []

    if args.metric not in PRIORITY_METRICS:
        warnings.append(
            f"metric '{args.metric}' is not a priority V8 metric. "
            f"Priority metrics: {', '.join(sorted(PRIORITY_METRICS))}"
        )

    if args.unit.lower() not in KNOWN_UNITS:
        warnings.append(
            f"unit '{args.unit}' is not a recognised unit. "
            f"Known units: {', '.join(sorted(KNOWN_UNITS))}"
        )

    if args.source not in KNOWN_SOURCES:
        warnings.append(
            f"source '{args.source}' is not a recognised source. "
            f"Known sources: {', '.join(sorted(KNOWN_SOURCES))}"
        )

    if not ISO_WEEK_RE.match(args.period):
        warnings.append(
            f"period '{args.period}' does not match ISO week format YYYY-Www "
            f"(e.g. 2026-W18). Observation recorded but grouping may be incorrect."
        )

    if args.value < 0:
        warnings.append(
            f"value {args.value} is negative — verify this is intentional."
        )

    return warnings


def _build_record(args: argparse.Namespace, now: datetime) -> dict[str, Any]:
    app_version = args.app_version or _get_git_sha()
    record: dict[str, Any] = {
        "date": now.isoformat(),
        "period": args.period,
        "metric": args.metric,
        "value": args.value,
        "unit": args.unit,
        "source": args.source,
        "app_version": app_version,
    }
    if args.channel:
        record["channel"] = args.channel
    if args.segment:
        record["segment"] = args.segment
    if args.notes:
        record["notes"] = args.notes
    return record


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="V8 Manual Business Metrics Recorder — append one observation.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python vocalype-brain/scripts/add_business_observation.py \\
      --metric downloads --value 12 --unit count \\
      --source vercel --period 2026-W17 \\
      --channel website --notes "manual dashboard entry"

  python vocalype-brain/scripts/add_business_observation.py \\
      --metric mrr --value 420 --unit usd \\
      --source stripe_dashboard --period 2026-W18

  python vocalype-brain/scripts/add_business_observation.py \\
      --metric first_successful_dictations --value 3 --unit count \\
      --source supabase_dashboard --period 2026-W18 \\
      --notes "from history table, distinct users"
        """,
    )
    parser.add_argument("--metric",      required=True,              help="Metric name (see PRIORITY_METRICS)")
    parser.add_argument("--value",       required=True, type=float,  help="Measured value (numeric)")
    parser.add_argument("--unit",        required=True,              help="Unit: count, usd, percent, ratio, bool")
    parser.add_argument("--source",      required=True,              help="Data source: stripe_dashboard, supabase_dashboard, vercel_analytics, etc.")
    parser.add_argument("--period",      required=True,              help="ISO week period: YYYY-Www (e.g. 2026-W18)")
    parser.add_argument("--channel",     default=None,               help="Optional: acquisition channel (website, tiktok, organic, etc.)")
    parser.add_argument("--segment",     default=None,               help="Optional: user segment (all, trial, paid, free)")
    parser.add_argument("--app_version", default=None,               help="Git SHA (auto-detected if omitted)")
    parser.add_argument("--notes",       default=None,               help="Free-text notes")
    args = parser.parse_args()

    ensure_brain_structure()
    now = datetime.now().replace(microsecond=0)

    warnings = _validate(args)
    for w in warnings:
        print(f"  WARNING: {w}", file=sys.stderr)

    record = _build_record(args, now)
    append_jsonl("data/business_observations.jsonl", record)

    divider = "=" * 60
    print(divider)
    print("V8 Business Observation Recorded")
    print(divider)
    print(f"  Date      : {record['date']}")
    print(f"  Period    : {record['period']}")
    print(f"  Metric    : {record['metric']}")
    print(f"  Value     : {record['value']} {record['unit']}")
    print(f"  Source    : {record['source']}")
    print(f"  Version   : {record['app_version']}")
    if args.channel:
        print(f"  Channel   : {args.channel}")
    if args.segment:
        print(f"  Segment   : {args.segment}")
    if args.notes:
        print(f"  Notes     : {args.notes}")
    if warnings:
        print(f"\n  {len(warnings)} warning(s) — observation was still recorded.", file=sys.stderr)
    print(divider)
    print("Written: vocalype-brain/data/business_observations.jsonl")


if __name__ == "__main__":
    main()
