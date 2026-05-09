"""weekly_content_snapshot.py â€” V9 Weekly Content Snapshot Generator.

Reads data/content_observations.jsonl and writes a founder-facing
weekly checklist to outputs/weekly_content_snapshot.md.

The snapshot is:
  - Honest: shows real posts this week, pending performance checks
  - Actionable: posting checklist for next week derived from next_action fields
  - Anti-hype: "N weeks of data â€” not a trend yet" until â‰¥4 weeks
  - Forward-looking: missing platforms, experiments to try

Does NOT invent data. Does NOT call APIs. Does NOT recommend paid ads.
Does NOT modify product code. Does NOT treat validation samples as real posts.
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

VALIDATION_SOURCES = {"manual_validation"}
ALL_PLATFORMS = ("tiktok", "instagram_reels", "youtube_shorts", "youtube", "twitter_x")
PERFORMANCE_FIELDS = ("views", "likes", "comments", "saves", "shares",
                      "profile_visits", "website_clicks")
MIN_WEEKS_FOR_TREND = 4


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _read_optional_jsonl(path: str) -> list[dict[str, Any]]:
    try:
        return read_jsonl(path)
    except FileNotFoundError:
        return []


def _is_validation(obs: dict[str, Any]) -> bool:
    return obs.get("source", "") in VALIDATION_SOURCES


def _real_observations(observations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [o for o in observations if not _is_validation(o)]


def _current_iso_week() -> str:
    today = date.today()
    year, week, _ = today.isocalendar()
    return f"{year}-W{week:02d}"


def _latest_period(observations: list[dict[str, Any]]) -> str | None:
    periods = [
        obs.get("period") for obs in observations
        if obs.get("period") and obs.get("record_type", "publication") == "publication"
    ]
    return max(periods) if periods else None


def _distinct_weeks(observations: list[dict[str, Any]]) -> list[str]:
    weeks = {
        obs.get("period") for obs in observations
        if obs.get("period") and obs.get("record_type", "publication") == "publication"
    }
    return sorted(weeks)


def _has_performance(post: dict[str, Any]) -> bool:
    return any(f in post for f in PERFORMANCE_FIELDS)


def _build_post_map(observations: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    posts: dict[str, dict[str, Any]] = {}
    for obs in observations:
        if obs.get("record_type", "publication") == "publication":
            post_id = obs.get("post_id") or obs.get("observation_id", "")
            if post_id:
                posts[post_id] = dict(obs)
    for obs in observations:
        if obs.get("record_type") == "performance_update":
            post_id = obs.get("post_id", "")
            if post_id in posts:
                for field in ("views", "likes", "comments", "saves", "shares",
                              "profile_visits", "website_clicks", "downloads_attributed",
                              "check_hours_after_post", "lesson_learned", "next_action"):
                    if field in obs:
                        posts[post_id][field] = obs[field]
    return posts


# ---------------------------------------------------------------------------
# Snapshot builder
# ---------------------------------------------------------------------------

def _build_snapshot(observations: list[dict[str, Any]], now: datetime) -> str:
    lines: list[str] = []

    current_week = _current_iso_week()
    real_obs = _real_observations(observations)
    validation_count = len(observations) - len(real_obs)
    has_real_data = len(real_obs) > 0

    latest_period = _latest_period(real_obs)
    snapshot_period = latest_period or current_week
    distinct_weeks = _distinct_weeks(real_obs)
    weeks_of_data = len(distinct_weeks)

    all_posts = _build_post_map(real_obs)
    week_posts = {
        pid: p for pid, p in all_posts.items()
        if p.get("period") == snapshot_period
    }
    week_post_list = list(week_posts.values())

    lines += [
        "# Vocalype Brain â€” Weekly Content Snapshot",
        "",
        f"Generated: {now.isoformat()}",
        f"Snapshot period: **{snapshot_period}**",
        f"Current week: {current_week}",
        f"Weeks of data: {weeks_of_data}",
        "",
    ]

    if not has_real_data:
        lines += [
            "> âš ï¸  No real content observations found â€” only validation samples exist.",
            "> Record actual content posts from your platforms",
            "> before using this snapshot for any decisions.",
            "",
        ]

    lines += ["---", ""]

    # --- Posts this week ---
    lines += ["## Posts This Week", ""]
    if week_post_list:
        lines += ["| Post ID | Platform | Content Type | Hook (preview) | Views | Status |",
                  "|---|---|---|---|---|---|"]
        for p in week_post_list:
            post_id = p.get("post_id", "â€”")
            platform = p.get("platform", "â€”")
            ct = p.get("content_type", "â€”")
            hook = (p.get("hook", "") or "")[:45]
            if p.get("hook") and len(p["hook"]) > 45:
                hook += "..."
            views = f"{p.get('views', 'â€”'):,}" if isinstance(p.get("views"), int) else "â€”"
            status = "âœ… has data" if _has_performance(p) else "â³ pending check"
            lines.append(f"| {post_id} | {platform} | {ct} | {hook} | {views} | {status} |")
        lines.append("")
    else:
        lines += ["> No content posts recorded for this period.", ""]
    lines += ["---", ""]

    # --- Best performer ---
    posts_with_views = [p for p in week_post_list if isinstance(p.get("views"), int)]
    if posts_with_views:
        best = max(posts_with_views, key=lambda p: p.get("views", 0))
        lines += [
            "## Best Performer This Week",
            "",
            f"**Post:** {best.get('post_id', 'â€”')}  ",
            f"**Platform:** {best.get('platform', 'â€”')}  ",
            f"**Content type:** {best.get('content_type', 'â€”')}  ",
            f"**Hook:** {best.get('hook', 'â€”')}  ",
            f"**Views:** {best.get('views', 0):,}  ",
        ]
        if best.get("likes") is not None:
            lines.append(f"**Likes:** {best['likes']:,}  ")
        if best.get("saves") is not None:
            lines.append(f"**Saves:** {best['saves']:,}  ")
        if best.get("lesson_learned"):
            lines.append(f"**Lesson:** {best['lesson_learned']}  ")
        lines.append("")
        lines += ["---", ""]

    # --- Pending performance checks ---
    pending = [p for p in week_post_list if not _has_performance(p)]
    if pending:
        lines += ["## Pending Performance Checks", ""]
        lines += ["These posts have no performance data yet â€” check platform analytics 24â€“72h after posting:", ""]
        for p in pending:
            post_id = p.get("post_id", "â€”")
            platform = p.get("platform", "â€”")
            post_date = p.get("post_date", "â€”")
            hook = (p.get("hook", "") or "")[:50]
            lines.append(f"- **{post_id}** ({platform}, posted {post_date}): {hook}")
        lines.append("")
        lines += [
            "To record performance:",
            "```",
            "python internal/brain/scripts/add_content_observation.py \\",
            "    --post_id <post_id> --record_type performance_update \\",
            "    --views <n> --likes <n> --saves <n> \\",
            "    --lesson \"<what you learned>\" --next_action \"<what to try next>\" \\",
            "    --period <YYYY-Www> --source manual_founder",
            "```",
            "",
        ]
        lines += ["---", ""]

    # --- Lessons from this week ---
    lessons = [
        (p.get("post_id", ""), p.get("lesson_learned", ""))
        for p in week_post_list
        if p.get("lesson_learned")
    ]
    if lessons:
        lines += ["## Lessons From This Week", ""]
        for post_id, lesson in lessons:
            lines.append(f"- **{post_id}:** {lesson}")
        lines.append("")
        lines += ["---", ""]

    # --- Founder posting checklist ---
    lines += [
        "## Founder Posting Checklist",
        "",
        "Actions for next week based on this week's data:",
        "",
    ]

    checklist: list[str] = []

    # Next actions from this week's posts
    next_actions = [
        (p.get("post_id", ""), p.get("next_action", ""))
        for p in week_post_list
        if p.get("next_action")
    ]
    for post_id, action in next_actions:
        checklist.append(f"[ ] (from {post_id}) {action}")

    # Platform coverage gaps
    used_platforms = {p.get("platform") for p in week_post_list}
    missing_platforms = [pl for pl in ALL_PLATFORMS if pl not in used_platforms]
    if not week_post_list:
        checklist.append("[ ] Record at least one content post this week")
    elif missing_platforms and len(used_platforms) < 2:
        checklist.append(
            f"[ ] Consider posting on a second platform to enable cross-platform comparison"
        )

    # Always: record performance for pending posts
    if pending:
        checklist.append(
            f"[ ] Record performance data for {len(pending)} pending post(s) â€” see above"
        )

    # Always: run review
    checklist.append(
        "[ ] Run: `python internal/brain/scripts/review_content_performance.py`"
    )
    checklist.append(
        "[ ] Commit: `git add internal/brain/data/content_observations.jsonl "
        "internal/brain/outputs/ && git commit -m \"data(brain): weekly content snapshot YYYY-Www\"`"
    )

    if checklist:
        for item in checklist:
            lines.append(item)
    else:
        lines.append("> No checklist items â€” add performance data and next_action fields to generate actions.")
    lines.append("")

    lines += ["---", ""]

    # --- Missing platforms ---
    if week_post_list:
        lines += ["## Platform Coverage This Week", ""]
        for pl in ALL_PLATFORMS:
            count = sum(1 for p in week_post_list if p.get("platform") == pl)
            status = f"{count} post(s)" if count else "not posted"
            lines.append(f"- **{pl}**: {status}")
        lines.append("")
        lines += ["---", ""]

    # --- Anti-hype section ---
    lines += [
        "## Do Not Overreact Yet",
        "",
        f"This is week **{weeks_of_data}** of content data. "
        f"{'**Not a trend yet.** ' if weeks_of_data < MIN_WEEKS_FOR_TREND else ''}",
        "",
    ]

    premature: list[str] = []
    if weeks_of_data < MIN_WEEKS_FOR_TREND:
        premature.append(
            f"- {weeks_of_data} week(s) of data â€” baseline requires â‰¥{MIN_WEEKS_FOR_TREND} weeks "
            "before any pattern is meaningful."
        )
    if not week_post_list:
        premature.append(
            "- No posts this week does NOT mean the strategy is failing. It may mean distribution "
            "has not started yet."
        )
    if posts_with_views and max(p.get("views", 0) for p in posts_with_views) < 100:
        premature.append(
            "- Low views on early posts is normal â€” reach grows as the account grows."
        )
    if not premature:
        premature.append(
            "- No specific overreaction risk flagged â€” but remember: one week is not a trend."
        )

    lines += premature
    lines += [
        "",
        "> Trend analysis requires â‰¥4 weeks of consistent posting across â‰¥2 platforms.",
        "",
    ]

    lines += ["---", ""]

    # --- Footer ---
    lines += [
        f"*Snapshot generated from {len(all_posts)} real post(s) "
        f"({validation_count} validation sample(s) excluded).*",
        f"*Source: `internal/brain/data/content_observations.jsonl`*",
        f"*To record a post: `python internal/brain/scripts/add_content_observation.py --help`*",
    ]

    return "\n".join(lines).rstrip() + "\n"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ensure_brain_structure()
    now = datetime.now().replace(microsecond=0)

    observations = _read_optional_jsonl("data/content_observations.jsonl")
    snapshot_md = _build_snapshot(observations, now)
    write_text("outputs/weekly_content_snapshot.md", snapshot_md)

    real_obs = _real_observations(observations)
    all_posts = _build_post_map(real_obs)
    pub_posts = [p for p in all_posts.values() if p.get("record_type", "publication") == "publication"]
    latest_period = _latest_period(real_obs)
    weeks_of_data = len(_distinct_weeks(real_obs))

    divider = "=" * 60
    print(divider)
    print("V9 Weekly Content Snapshot")
    print(divider)
    print(f"\nSnapshot period : {latest_period or _current_iso_week()} (latest with data)")
    print(f"Real posts      : {len(pub_posts)} (validation samples excluded)")
    print(f"Weeks of data   : {weeks_of_data}")
    if not real_obs:
        print("\nWARNING: No real observations â€” only validation samples found.")
        print("         Record actual content posts from your platforms first.")
    print(f"\nWritten: internal/brain/outputs/weekly_content_snapshot.md")
    print(divider)


if __name__ == "__main__":
    main()
