"""add_content_observation.py â€” V9 Phase 1 Manual Content Performance Recorder.

Records one manual content observation to data/content_observations.jsonl.
Handles both publication metadata and performance metrics in a single call,
or as a separate performance_update to an existing post_id.

Does NOT auto-post. Does NOT call platform APIs. Does NOT scrape.
Does NOT recommend paid ads. Does NOT invent performance numbers.

record_type=publication (default):
    Captures what was posted: platform, hook, niche, CTA, etc.
    Can optionally include performance metrics if known at recording time.

record_type=performance_update:
    Captures metrics 24-72h after posting for an existing post_id.

Usage:
    # Publication (metadata only):
    python internal/brain/scripts/add_content_observation.py \\
        --platform tiktok --content_type demo \\
        --hook "Stop typing long prompts" --niche productivity \\
        --target_user "developers" --cta "link in bio" \\
        --period 2026-W18 --source manual_founder

    # Publication + performance in one call:
    python internal/brain/scripts/add_content_observation.py \\
        --platform tiktok --content_type demo \\
        --hook "Stop typing long prompts" --niche productivity \\
        --target_user "developers" --cta "link in bio" \\
        --period 2026-W18 --views 1240 --likes 52 --saves 18 \\
        --lesson "saves ratio higher than likes â€” good sign" \\
        --next_action "test same hook on Instagram Reels" \\
        --source manual_founder

    # Performance update to existing post:
    python internal/brain/scripts/add_content_observation.py \\
        --post_id post-20260425-tiktok-001 \\
        --record_type performance_update \\
        --views 2100 --likes 88 --saves 30 \\
        --lesson "views kept climbing after 48h" \\
        --next_action "post similar hook next week" \\
        --period 2026-W18 --source manual_founder
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from datetime import datetime, date
from typing import Any

from brain import append_jsonl, ensure_brain_structure, read_jsonl

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

APPROVED_PLATFORMS = {
    "tiktok",
    "instagram_reels",
    "youtube_shorts",
    "youtube",
    "twitter_x",
}

APPROVED_CONTENT_TYPES = {
    "demo",
    "tutorial",
    "pain_point",
    "testimonial",
    "hook_test",
    "before_after",
    "day_in_life",
    "reaction",
}

APPROVED_NICHES = {
    "productivity",
    "developer",
    "writer",
    "student",
    "accessibility",
    "remote_worker",
    "entrepreneur",
    "general",
}

VALID_RECORD_TYPES = {"publication", "performance_update"}
VALID_STATUSES = {"published", "draft", "removed"}
KNOWN_SOURCES = {"manual_founder", "manual_validation"}

ISO_WEEK_RE = re.compile(r"^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$")

VIEWS_VIRAL_THRESHOLD = 500_000


# ---------------------------------------------------------------------------
# ID generation
# ---------------------------------------------------------------------------

def _next_observation_id(existing: list[dict[str, Any]], today: str) -> str:
    compact = today.replace("-", "")
    prefix = f"v9-{compact}-"
    count = sum(1 for r in existing if r.get("observation_id", "").startswith(prefix))
    return f"{prefix}{count + 1:03d}"


def _next_post_id(existing: list[dict[str, Any]], today: str, platform: str) -> str:
    compact = today.replace("-", "")
    prefix = f"post-{compact}-{platform}-"
    count = sum(
        1 for r in existing
        if r.get("post_id", "").startswith(prefix)
        and r.get("record_type", "publication") == "publication"
    )
    return f"{prefix}{count + 1:03d}"


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


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _validate(args: argparse.Namespace, record_type: str) -> tuple[list[str], list[str]]:
    """Return (errors, warnings). Errors block recording; warnings do not."""
    errors: list[str] = []
    warnings: list[str] = []

    if not ISO_WEEK_RE.match(args.period):
        warnings.append(
            f"period '{args.period}' does not match ISO week format YYYY-Www. "
            "Observation recorded but V8 join may be incorrect."
        )

    if args.source not in KNOWN_SOURCES:
        warnings.append(
            f"source '{args.source}' is not recognised. "
            f"Known sources: {', '.join(sorted(KNOWN_SOURCES))}"
        )

    if record_type == "publication":
        if args.platform not in APPROVED_PLATFORMS:
            warnings.append(
                f"platform '{args.platform}' is not in the approved list. "
                f"Approved: {', '.join(sorted(APPROVED_PLATFORMS))}"
            )
        if args.content_type not in APPROVED_CONTENT_TYPES:
            warnings.append(
                f"content_type '{args.content_type}' is not in the approved list. "
                f"Approved: {', '.join(sorted(APPROVED_CONTENT_TYPES))}"
            )
        if args.niche not in APPROVED_NICHES:
            warnings.append(
                f"niche '{args.niche}' is not in the approved list. "
                f"Approved: {', '.join(sorted(APPROVED_NICHES))}"
            )
        if args.status not in VALID_STATUSES:
            warnings.append(
                f"status '{args.status}' is not recognised. "
                f"Valid: {', '.join(sorted(VALID_STATUSES))}"
            )

    if record_type == "performance_update" and not args.post_id:
        errors.append(
            "--post_id is required for record_type=performance_update. "
            "Provide the post_id returned when the publication was recorded."
        )

    if args.check_hours is not None and args.check_hours < 24:
        warnings.append(
            f"check_hours_after_post={args.check_hours} is less than 24. "
            "Performance metrics before 24h may not be representative (gate G3)."
        )

    if args.views is not None and args.views > VIEWS_VIRAL_THRESHOLD:
        warnings.append(
            f"views={args.views:,} exceeds {VIEWS_VIRAL_THRESHOLD:,}. "
            "Please verify this is correct before committing (stop condition SC1)."
        )

    return errors, warnings


# ---------------------------------------------------------------------------
# Record builder
# ---------------------------------------------------------------------------

def _build_record(
    args: argparse.Namespace,
    record_type: str,
    observation_id: str,
    post_id: str,
    now: datetime,
) -> dict[str, Any]:
    today = date.today().isoformat()
    app_version = args.app_version or _get_git_sha()

    record: dict[str, Any] = {
        "observation_id": observation_id,
        "post_id": post_id,
        "record_type": record_type,
        "date_recorded": now.isoformat(),
        "period": args.period,
        "source": args.source,
        "app_version": app_version,
    }

    if record_type == "publication":
        record["post_date"] = args.post_date or today
        record["platform"] = args.platform
        record["content_type"] = args.content_type
        record["hook"] = args.hook
        record["niche"] = args.niche
        record["target_user"] = args.target_user
        record["cta"] = args.cta
        record["status"] = args.status
        if args.post_url:
            record["post_url"] = args.post_url
        if args.posted_at:
            record["posted_at"] = args.posted_at

    # Performance fields (valid on both record types)
    if args.views is not None:
        record["views"] = args.views
    if args.likes is not None:
        record["likes"] = args.likes
    if args.comments is not None:
        record["comments"] = args.comments
    if args.saves is not None:
        record["saves"] = args.saves
    if args.shares is not None:
        record["shares"] = args.shares
    if args.profile_visits is not None:
        record["profile_visits"] = args.profile_visits
    if args.website_clicks is not None:
        record["website_clicks"] = args.website_clicks
    if args.downloads is not None:
        record["downloads_attributed"] = args.downloads
    if args.check_hours is not None:
        record["check_hours_after_post"] = args.check_hours
    if args.lesson:
        record["lesson_learned"] = args.lesson
    if args.next_action:
        record["next_action"] = args.next_action
    if args.notes:
        record["notes"] = args.notes

    return record


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="V9 Manual Content Performance Recorder â€” append one observation.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    # Identity / routing
    parser.add_argument("--post_id",          default=None,               help="Existing post ID (required for performance_update)")
    parser.add_argument("--record_type",      default="publication",      help="publication (default) | performance_update")

    # Publication metadata (required for publication)
    parser.add_argument("--platform",         default=None,               help="tiktok|instagram_reels|youtube_shorts|youtube|twitter_x")
    parser.add_argument("--content_type",     default=None,               help="demo|tutorial|pain_point|testimonial|hook_test|before_after|day_in_life|reaction")
    parser.add_argument("--hook",             default=None,               help="Opening line or first 3â€“5 seconds verbatim or summarized")
    parser.add_argument("--niche",            default=None,               help="productivity|developer|writer|student|accessibility|remote_worker|entrepreneur|general")
    parser.add_argument("--target_user",      default=None,               help="Persona description (e.g. 'developer who types a lot')")
    parser.add_argument("--cta",              default=None,               help="Call-to-action text or intent")
    parser.add_argument("--status",           default="published",        help="published (default) | draft | removed")
    parser.add_argument("--post_date",        default=None,               help="YYYY-MM-DD (defaults to today)")
    parser.add_argument("--post_url",         default=None,               help="URL to the post (optional)")
    parser.add_argument("--posted_at",        default=None,               help="Datetime posted (optional)")

    # Performance metrics (optional on both record types)
    parser.add_argument("--views",            default=None, type=int,     help="Total views / plays")
    parser.add_argument("--likes",            default=None, type=int,     help="Total likes")
    parser.add_argument("--comments",         default=None, type=int,     help="Total comments")
    parser.add_argument("--saves",            default=None, type=int,     help="Total saves (TikTok, Instagram)")
    parser.add_argument("--shares",           default=None, type=int,     help="Total shares")
    parser.add_argument("--profile_visits",   default=None, type=int,     help="Profile visits attributed to this post")
    parser.add_argument("--website_clicks",   default=None, type=int,     help="Website / link-in-bio clicks")
    parser.add_argument("--downloads",        default=None, type=int,     help="Downloads attributed (founder-confirmed only â€” not auto-inferred)")
    parser.add_argument("--check_hours",      default=None, type=int,     help="Hours after posting when metrics were checked")

    # Learnings
    parser.add_argument("--lesson",           default=None,               help="Lesson learned from this post")
    parser.add_argument("--next_action",      default=None,               help="What to try next based on this post")

    # Metadata
    parser.add_argument("--period",           required=True,              help="ISO week YYYY-Www (e.g. 2026-W18)")
    parser.add_argument("--source",           default="manual_founder",   help="manual_founder (default) | manual_validation")
    parser.add_argument("--notes",            default=None,               help="Free-text notes")
    parser.add_argument("--app_version",      default=None,               help="Git SHA (auto-detected if omitted)")

    args = parser.parse_args()

    record_type = args.record_type
    if record_type not in VALID_RECORD_TYPES:
        print(f"ERROR: --record_type must be one of: {', '.join(sorted(VALID_RECORD_TYPES))}", file=sys.stderr)
        sys.exit(1)

    # Required fields for publication
    if record_type == "publication":
        missing = [
            f"--{f}" for f in ("platform", "content_type", "hook", "niche", "target_user", "cta")
            if not getattr(args, f)
        ]
        if missing:
            print(
                f"ERROR: publication record requires: {', '.join(missing)}",
                file=sys.stderr,
            )
            sys.exit(1)

    ensure_brain_structure()
    now = datetime.now().replace(microsecond=0)
    today = date.today().isoformat()

    errors, warnings = _validate(args, record_type)
    if errors:
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    for w in warnings:
        print(f"WARNING: {w}", file=sys.stderr)

    existing = read_jsonl("data/content_observations.jsonl")
    observation_id = _next_observation_id(existing, today)
    platform_for_id = args.platform or "unknown"
    post_id = args.post_id or _next_post_id(existing, today, platform_for_id)

    record = _build_record(args, record_type, observation_id, post_id, now)
    append_jsonl("data/content_observations.jsonl", record)

    divider = "=" * 60
    print(divider)
    print("V9 Content Observation Recorded")
    print(divider)
    print(f"  Observation ID : {observation_id}")
    print(f"  Post ID        : {post_id}")
    print(f"  Record type    : {record_type}")
    print(f"  Date recorded  : {record['date_recorded']}")
    print(f"  Period         : {args.period}")
    print(f"  Source         : {record['source']}")
    if record_type == "publication":
        print(f"  Platform       : {args.platform}")
        print(f"  Content type   : {args.content_type}")
        hook_preview = (args.hook or "")[:60]
        suffix = "..." if args.hook and len(args.hook) > 60 else ""
        print(f"  Hook           : {hook_preview}{suffix}")
        print(f"  Niche          : {args.niche}")
    if args.views is not None:
        print(f"  Views          : {args.views:,}")
    if args.lesson:
        lesson_preview = args.lesson[:60]
        suffix = "..." if len(args.lesson) > 60 else ""
        print(f"  Lesson         : {lesson_preview}{suffix}")
    if warnings:
        print(f"\n  {len(warnings)} warning(s) â€” observation was still recorded.", file=sys.stderr)
    print(divider)
    print("Written: internal/brain/data/content_observations.jsonl")


if __name__ == "__main__":
    main()
