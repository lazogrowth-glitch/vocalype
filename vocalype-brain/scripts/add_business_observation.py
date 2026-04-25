"""add_business_observation.py — V8 Phase 1 Manual Business Metrics Recorder.

Records one manual business observation to data/business_observations.jsonl.
Supports honest early-stage recording via explicit status values.

Statuses:
  measured      — data source opened, real numeric value recorded
  zero          — data source opened, confirmed value is 0
  unknown       — data source not checked this week (no value)
  not_available — data source does not exist yet (no value)
  not_applicable — metric not relevant at current stage (no value)

Does NOT modify product code. Does NOT connect APIs. Does NOT automate growth.

Usage:
    # Measured value:
    python vocalype-brain/scripts/add_business_observation.py \\
        --metric downloads --value 12 --unit count \\
        --source vercel --period 2026-W18

    # Confirmed zero:
    python vocalype-brain/scripts/add_business_observation.py \\
        --metric mrr --status zero --value 0 --unit usd \\
        --source stripe_dashboard --period 2026-W18

    # Not checked this week:
    python vocalype-brain/scripts/add_business_observation.py \\
        --metric website_visitors --status unknown \\
        --source vercel_analytics --period 2026-W18 --notes "not checked"

    # Data source missing:
    python vocalype-brain/scripts/add_business_observation.py \\
        --metric activation_attempts --status not_available \\
        --source supabase_dashboard --period 2026-W18

    # Precondition unmet:
    python vocalype-brain/scripts/add_business_observation.py \\
        --metric churned_users --status not_applicable \\
        --source stripe_dashboard --period 2026-W18 --notes "no paying users yet"
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
# Constants
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

VALID_STATUSES = {"measured", "zero", "unknown", "not_available", "not_applicable"}

# Statuses that require a numeric value
VALUE_REQUIRED_STATUSES = {"measured", "zero"}

# Statuses that must NOT have a value
NO_VALUE_STATUSES = {"unknown", "not_available", "not_applicable"}

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


def _resolve_status(args: argparse.Namespace) -> tuple[str, list[str]]:
    """Resolve final status and return (status, errors)."""
    errors: list[str] = []
    status = args.status

    # Default: if --status omitted and --value provided, treat as measured
    if status is None:
        if args.value is not None:
            status = "measured"
        else:
            errors.append(
                "Either --value (for a measured/zero observation) or "
                "--status (unknown | not_available | not_applicable) is required."
            )
            return "unknown", errors

    if status not in VALID_STATUSES:
        errors.append(
            f"--status '{status}' is not valid. "
            f"Must be one of: {', '.join(sorted(VALID_STATUSES))}"
        )
        return status, errors

    # Validate value constraints per status
    if status == "measured":
        if args.value is None:
            errors.append("--status measured requires a numeric --value.")
        elif args.value < 0:
            errors.append(f"--status measured: value {args.value} is negative — verify this is intentional.")

    elif status == "zero":
        if args.value is None:
            errors.append("--status zero requires --value 0.")
        elif args.value != 0:
            errors.append(
                f"--status zero requires --value 0, but got {args.value}. "
                "Use --status measured if the value is non-zero."
            )

    elif status in NO_VALUE_STATUSES:
        if args.value is not None:
            errors.append(
                f"--status {status} should not include --value. "
                "Remove --value or change --status to measured/zero."
            )

    return status, errors


def _validate_common(args: argparse.Namespace, status: str) -> list[str]:
    """Return non-fatal warnings for common fields."""
    warnings: list[str] = []

    if args.metric not in PRIORITY_METRICS:
        warnings.append(
            f"metric '{args.metric}' is not a priority V8 metric. "
            f"Priority metrics: {', '.join(sorted(PRIORITY_METRICS))}"
        )

    if not ISO_WEEK_RE.match(args.period):
        warnings.append(
            f"period '{args.period}' does not match ISO week format YYYY-Www "
            "(e.g. 2026-W18). Observation recorded but grouping may be incorrect."
        )

    if args.source not in KNOWN_SOURCES:
        warnings.append(
            f"source '{args.source}' is not a recognised source. "
            f"Known sources: {', '.join(sorted(KNOWN_SOURCES))}"
        )

    if args.unit and args.unit.lower() not in KNOWN_UNITS:
        warnings.append(
            f"unit '{args.unit}' is not a recognised unit. "
            f"Known units: {', '.join(sorted(KNOWN_UNITS))}"
        )

    if status in VALUE_REQUIRED_STATUSES and not args.unit:
        warnings.append(f"--unit is recommended for status '{status}'.")

    return warnings


def _build_record(args: argparse.Namespace, status: str, now: datetime) -> dict[str, Any]:
    app_version = args.app_version or _get_git_sha()
    record: dict[str, Any] = {
        "date": now.isoformat(),
        "period": args.period,
        "metric": args.metric,
        "status": status,
        "source": args.source,
        "app_version": app_version,
    }
    if args.value is not None and status in VALUE_REQUIRED_STATUSES:
        record["value"] = args.value
    if args.unit and status in VALUE_REQUIRED_STATUSES:
        record["unit"] = args.unit
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
Statuses:
  measured      — real numeric value from dashboard
  zero          — confirmed zero (dashboard opened, result is 0)
  unknown       — not checked this week
  not_available — data source does not exist yet
  not_applicable— metric not relevant at current stage

Examples:
  # Measured:
  add_business_observation.py --metric downloads --value 12 --unit count \\
      --source vercel --period 2026-W18

  # Confirmed zero:
  add_business_observation.py --metric mrr --status zero --value 0 --unit usd \\
      --source stripe_dashboard --period 2026-W18

  # Unknown:
  add_business_observation.py --metric website_visitors --status unknown \\
      --source vercel_analytics --period 2026-W18 --notes "not checked"

  # Not available:
  add_business_observation.py --metric activation_attempts --status not_available \\
      --source supabase_dashboard --period 2026-W18

  # Not applicable:
  add_business_observation.py --metric churned_users --status not_applicable \\
      --source stripe_dashboard --period 2026-W18 --notes "no paying users yet"
        """,
    )
    parser.add_argument("--metric",      required=True,              help="Metric name")
    parser.add_argument("--value",       default=None, type=float,   help="Numeric value (required for measured/zero)")
    parser.add_argument("--unit",        default=None,               help="Unit: count, usd, percent, ratio, bool")
    parser.add_argument("--status",      default=None,               help="measured|zero|unknown|not_available|not_applicable")
    parser.add_argument("--source",      required=True,              help="Data source")
    parser.add_argument("--period",      required=True,              help="ISO week: YYYY-Www (e.g. 2026-W18)")
    parser.add_argument("--channel",     default=None,               help="Acquisition channel")
    parser.add_argument("--segment",     default=None,               help="User segment")
    parser.add_argument("--app_version", default=None,               help="Git SHA (auto-detected if omitted)")
    parser.add_argument("--notes",       default=None,               help="Free-text notes")
    args = parser.parse_args()

    ensure_brain_structure()
    now = datetime.now().replace(microsecond=0)

    status, errors = _resolve_status(args)
    if errors:
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    warnings = _validate_common(args, status)
    for w in warnings:
        print(f"WARNING: {w}", file=sys.stderr)

    record = _build_record(args, status, now)
    append_jsonl("data/business_observations.jsonl", record)

    divider = "=" * 60
    print(divider)
    print("V8 Business Observation Recorded")
    print(divider)
    print(f"  Date      : {record['date']}")
    print(f"  Period    : {record['period']}")
    print(f"  Metric    : {record['metric']}")
    print(f"  Status    : {record['status']}")
    if "value" in record:
        unit_str = f" {record.get('unit', '')}" if record.get("unit") else ""
        print(f"  Value     : {record['value']}{unit_str}")
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
