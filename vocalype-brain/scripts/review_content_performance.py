"""review_content_performance.py — V9 Content Performance Report Generator.

Reads data/content_observations.jsonl and writes:
  outputs/content_report.md

Report sections:
  1. Summary
  2. Platform breakdown
  3. Content type breakdown
  4. Niche breakdown
  5. Top posts by views (gate: ≥1 real post with views)
  6. Hook pattern list
  7. Lessons learned
  8. Coverage gaps (posts without performance data)
  9. V8 connection placeholder
  10. Distribution backlog (next_action items)

Safety:
  - source=manual_validation excluded from all analysis
  - No ranking if fewer than 5 posts of a type (gate G1/G2)
  - Warns loudly when only validation samples exist
  - Does NOT recommend paid ads
  - Does NOT make strategy decisions from insufficient data
  - Does NOT auto-populate downloads_attributed
"""
from __future__ import annotations

import sys
from collections import defaultdict
from datetime import datetime
from typing import Any

from brain import ensure_brain_structure, read_jsonl, write_text

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VALIDATION_SOURCES = {"manual_validation"}
MIN_POSTS_FOR_RANKING = 5
PERFORMANCE_FIELDS = ("views", "likes", "comments", "saves", "shares",
                      "profile_visits", "website_clicks")


# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------

def _is_validation(obs: dict[str, Any]) -> bool:
    return obs.get("source", "") in VALIDATION_SOURCES


def _read_optional_jsonl(path: str) -> list[dict[str, Any]]:
    try:
        return read_jsonl(path)
    except FileNotFoundError:
        return []


def _real_observations(observations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [o for o in observations if not _is_validation(o)]


def _build_post_map(observations: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Merge publication + performance_update records by post_id into unified posts."""
    posts: dict[str, dict[str, Any]] = {}

    # First pass: publication records establish the base
    for obs in observations:
        if obs.get("record_type", "publication") == "publication":
            post_id = obs.get("post_id") or obs.get("observation_id", "")
            if post_id:
                posts[post_id] = dict(obs)

    # Second pass: performance_update records enrich the base
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


def _has_performance(post: dict[str, Any]) -> bool:
    return any(f in post for f in PERFORMANCE_FIELDS)


# ---------------------------------------------------------------------------
# Report builder
# ---------------------------------------------------------------------------

def _build_report(observations: list[dict[str, Any]], now: datetime) -> str:
    lines: list[str] = []
    real_obs = _real_observations(observations)
    validation_count = len(observations) - len(real_obs)
    posts = _build_post_map(real_obs)
    post_list = list(posts.values())
    pub_posts = [p for p in post_list if p.get("record_type", "publication") == "publication"]
    total_posts = len(pub_posts)

    lines += [
        "# Vocalype Brain — V9 Content Performance Report",
        "",
        f"Generated: {now.isoformat()}",
        "",
    ]

    if not real_obs:
        lines += [
            "> ⚠️  No real content observations found.",
            f"> {validation_count} validation sample(s) exist but are excluded from all analysis.",
            "> Record actual content observations using `add_content_observation.py --source manual_founder`.",
            "",
        ]

    lines += ["---", ""]

    # --- 1. Summary ---
    lines += ["## Summary", ""]
    with_perf = sum(1 for p in pub_posts if _has_performance(p))
    without_perf = total_posts - with_perf
    lines += [
        f"| Metric | Value |",
        f"|---|---|",
        f"| Total content observations | {total_posts} |",
        f"| With performance data | {with_perf} |",
        f"| Pending performance check | {without_perf} |",
        f"| Validation samples (excluded) | {validation_count} |",
        "",
    ]

    if total_posts == 0:
        lines += [
            "> No real content posts recorded yet.",
            "> Use `add_content_observation.py` to record your first post.",
            "",
        ]
        # Append remaining empty sections and footer
        _append_empty_sections(lines)
        return "\n".join(lines).rstrip() + "\n"

    lines += ["---", ""]

    # --- 2. Platform breakdown ---
    lines += ["## Platform Breakdown", ""]
    platform_counts: dict[str, int] = defaultdict(int)
    platform_views: dict[str, list[int]] = defaultdict(list)
    for p in pub_posts:
        platform = p.get("platform", "unknown")
        platform_counts[platform] += 1
        if "views" in p:
            platform_views[platform].append(p["views"])

    lines += ["| Platform | Posts | Avg Views | Note |", "|---|---|---|---|"]
    for platform, count in sorted(platform_counts.items(), key=lambda x: -x[1]):
        if platform_views[platform]:
            avg = sum(platform_views[platform]) // len(platform_views[platform])
            avg_str = f"{avg:,}"
        else:
            avg_str = "—"
        note = "" if count >= MIN_POSTS_FOR_RANKING else f"< {MIN_POSTS_FOR_RANKING} posts — no ranking yet"
        lines.append(f"| {platform} | {count} | {avg_str} | {note} |")
    lines.append("")

    if len(platform_counts) == 1:
        lines += [
            "> ⚠️  All posts are from a single platform. "
            "Cross-platform comparison requires posting on ≥2 platforms.",
            "",
        ]

    lines += ["---", ""]

    # --- 3. Content type breakdown ---
    lines += ["## Content Type Breakdown", ""]
    type_counts: dict[str, int] = defaultdict(int)
    type_views: dict[str, list[int]] = defaultdict(list)
    for p in pub_posts:
        ct = p.get("content_type", "unknown")
        type_counts[ct] += 1
        if "views" in p:
            type_views[ct].append(p["views"])

    lines += ["| Content Type | Posts | Avg Views | Ranking |", "|---|---|---|---|"]
    for ct, count in sorted(type_counts.items(), key=lambda x: -x[1]):
        if type_views[ct]:
            avg = sum(type_views[ct]) // len(type_views[ct])
            avg_str = f"{avg:,}"
        else:
            avg_str = "—"
        if count >= MIN_POSTS_FOR_RANKING and type_views[ct]:
            rank_note = "ranked"
        else:
            rank_note = f"< {MIN_POSTS_FOR_RANKING} posts — count only"
        lines.append(f"| {ct} | {count} | {avg_str} | {rank_note} |")
    lines.append("")
    lines += ["---", ""]

    # --- 4. Niche breakdown ---
    lines += ["## Niche Breakdown", ""]
    niche_counts: dict[str, int] = defaultdict(int)
    for p in pub_posts:
        niche = p.get("niche", "unknown")
        niche_counts[niche] += 1

    lines += ["| Niche | Posts |", "|---|---|"]
    for niche, count in sorted(niche_counts.items(), key=lambda x: -x[1]):
        lines.append(f"| {niche} | {count} |")
    lines.append("")
    lines += ["---", ""]

    # --- 5. Top posts by views ---
    lines += ["## Top Posts by Views", ""]
    posts_with_views = [p for p in pub_posts if "views" in p]
    if posts_with_views:
        top = sorted(posts_with_views, key=lambda p: p.get("views", 0), reverse=True)[:5]
        lines += ["| Post ID | Platform | Content Type | Hook (preview) | Views | Likes | Saves |",
                  "|---|---|---|---|---|---|---|"]
        for p in top:
            post_id = p.get("post_id", "—")
            platform = p.get("platform", "—")
            ct = p.get("content_type", "—")
            hook = (p.get("hook", "") or "")[:40]
            if p.get("hook") and len(p["hook"]) > 40:
                hook += "..."
            views = f"{p.get('views', 0):,}"
            likes = str(p.get("likes", "—"))
            saves = str(p.get("saves", "—"))
            lines.append(f"| {post_id} | {platform} | {ct} | {hook} | {views} | {likes} | {saves} |")
        lines.append("")
    else:
        lines += ["> No posts with performance data yet. Record views and likes with `--views` and `--likes`.", ""]
    lines += ["---", ""]

    # --- 6. Hook patterns ---
    lines += ["## Hooks Tested", ""]
    hooks = [(p.get("post_id", ""), p.get("platform", ""), p.get("hook", ""), p.get("views"))
             for p in pub_posts if p.get("hook")]
    if hooks:
        lines += ["| Post ID | Platform | Hook | Views |", "|---|---|---|---|"]
        for post_id, platform, hook, views in hooks:
            hook_preview = hook[:60] + ("..." if len(hook) > 60 else "")
            views_str = f"{views:,}" if views is not None else "—"
            lines.append(f"| {post_id} | {platform} | {hook_preview} | {views_str} |")
        lines.append("")
    else:
        lines += ["> No hooks recorded yet.", ""]
    lines += ["---", ""]

    # --- 7. Lessons learned ---
    lines += ["## Lessons Learned", ""]
    lessons = [
        (p.get("post_id", ""), p.get("period", ""), p.get("lesson_learned", ""))
        for p in pub_posts
        if p.get("lesson_learned")
    ]
    if lessons:
        lines += ["| Post ID | Period | Lesson |", "|---|---|---|"]
        for post_id, period, lesson in lessons:
            lesson_preview = lesson[:80] + ("..." if len(lesson) > 80 else "")
            lines.append(f"| {post_id} | {period} | {lesson_preview} |")
        lines.append("")
    else:
        lines += ["> No lessons recorded yet. Add `--lesson` when recording performance data.", ""]
    lines += ["---", ""]

    # --- 8. Coverage gaps ---
    lines += ["## Coverage Gaps — Posts Pending Performance Check", ""]
    pending = [p for p in pub_posts if not _has_performance(p)]
    if pending:
        lines += ["| Post ID | Platform | Period | Hook (preview) |", "|---|---|---|---|"]
        for p in pending:
            post_id = p.get("post_id", "—")
            platform = p.get("platform", "—")
            period = p.get("period", "—")
            hook = (p.get("hook", "") or "")[:50]
            if p.get("hook") and len(p["hook"]) > 50:
                hook += "..."
            lines.append(f"| {post_id} | {platform} | {period} | {hook} |")
        lines.append("")
        lines += [
            f"> {len(pending)} post(s) have no performance data. "
            "Record views and likes 24–72h after posting.",
            "",
        ]
    else:
        lines += ["> All recorded posts have performance data.", ""]
    lines += ["---", ""]

    # --- 9. V8 connection placeholder ---
    lines += [
        "## V8 Business Metrics Connection",
        "",
        "> Phase 2 only — requires ≥10 V9 observations and ≥4 weeks of real V8 data.",
        ">",
        "> When ready, `correlate_content_business.py` will join V9 content weeks",
        "> to V8 business weeks by the shared `period` key (ISO week YYYY-Www) and ask:",
        "> - Did weeks with more content posts drive more downloads?",
        "> - Do TikTok profile visits appear in Vercel website_visitors?",
        "> - Do demo posts correlate with first_successful_dictations?",
        "",
    ]
    lines += ["---", ""]

    # --- 10. Distribution backlog ---
    lines += ["## Distribution Backlog — Next Experiments", ""]
    next_actions = [
        (p.get("post_id", ""), p.get("platform", ""), p.get("period", ""), p.get("next_action", ""))
        for p in pub_posts
        if p.get("next_action")
    ]
    if next_actions:
        lines += ["| Source Post | Platform | Period | Suggested Next Action |",
                  "|---|---|---|---|"]
        for post_id, platform, period, action in next_actions:
            action_preview = action[:80] + ("..." if len(action) > 80 else "")
            lines.append(f"| {post_id} | {platform} | {period} | {action_preview} |")
        lines.append("")
        lines += [
            "> These are experiment candidates derived from `--next_action` fields.",
            "> No ranking is applied until ≥5 posts per format exist (gate G1).",
            "",
        ]
    else:
        lines += [
            "> No next actions recorded yet.",
            "> Add `--next_action` when recording performance data to build this backlog.",
            "",
        ]

    lines += ["---", ""]
    lines += [
        f"*Report generated from {total_posts} real post(s) "
        f"({validation_count} validation sample(s) excluded).*",
        f"*Source: `vocalype-brain/data/content_observations.jsonl`*",
        f"*To record a post: `python vocalype-brain/scripts/add_content_observation.py --help`*",
    ]

    return "\n".join(lines).rstrip() + "\n"


def _append_empty_sections(lines: list[str]) -> None:
    for section in (
        "Platform Breakdown",
        "Content Type Breakdown",
        "Niche Breakdown",
        "Top Posts by Views",
        "Hooks Tested",
        "Lessons Learned",
        "Coverage Gaps — Posts Pending Performance Check",
        "V8 Business Metrics Connection",
        "Distribution Backlog — Next Experiments",
    ):
        lines += [f"## {section}", "", "> No data yet.", "", "---", ""]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ensure_brain_structure()
    now = datetime.now().replace(microsecond=0)

    observations = _read_optional_jsonl("data/content_observations.jsonl")
    report_md = _build_report(observations, now)
    write_text("outputs/content_report.md", report_md)

    real_obs = [o for o in observations if o.get("source", "") not in VALIDATION_SOURCES]
    validation_count = len(observations) - len(real_obs)
    posts = _build_post_map(real_obs)
    pub_posts = [p for p in posts.values() if p.get("record_type", "publication") == "publication"]

    divider = "=" * 60
    print(divider)
    print("V9 Content Performance Report")
    print(divider)
    print(f"\nReal posts     : {len(pub_posts)}")
    print(f"With perf data : {sum(1 for p in pub_posts if _has_performance(p))}")
    print(f"Excluded       : {validation_count} validation sample(s)")
    if not real_obs:
        print("\nWARNING: No real observations — only validation samples found.")
        print("         Record actual content posts from your platforms first.")
    print(f"\nWritten: vocalype-brain/outputs/content_report.md")
    print(divider)


if __name__ == "__main__":
    main()
