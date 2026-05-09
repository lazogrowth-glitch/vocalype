"""generate_unified_report.py â€” V10 Phase 1 Unified Decision Engine.

Reads the three data layers, joins them by ISO week period key, assesses
data sufficiency, runs a rule-based bottleneck diagnosis, and writes:

  outputs/unified_weekly_report.md  â€” cross-layer join table + diagnosis
  outputs/weekly_action.md          â€” one ranked action with evidence

Decision matrix (rule-based, not ML â€” evaluated in priority order):
  1. Product constrained?  â†’ product_investigation (fix before scaling)
  2. Funnel constrained?   â†’ business_data_entry   (fix activation first)
  3. Distribution issue?   â†’ distribution_data_entry (post more content)
  4. Insufficient data?    â†’ business_data_entry   (record data first)
  5. All healthy?          â†’ hold                  (maintain and monitor)

Does NOT modify product code. Does NOT automate actions.
Does NOT invent traction. Does NOT treat validation samples as real data.
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
CHECKED_STATUSES = {"measured", "zero"}

# V7 product constraint thresholds
PASTE_CONSTRAINT_MS = 300
RAM_GROWTH_CONSTRAINT_MB = 50
V7_STALE_WEEKS = 4

# V8 funnel threshold
ACTIVATION_RATE_MIN = 0.30

# Metrics of interest
PASTE_METRIC = "paste_latency_ms"
RAM_GROWTH_METRIC = "memory_growth_mb"
IDLE_LOOP_METRIC = "idle_background_inference_loop"
INFERENCE_METRIC = "stt_inference_time_ms"
TOTAL_LATENCY_METRIC = "total_dictation_latency_ms"


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def _median(values: list[float]) -> float | None:
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    mid = n // 2
    return (s[mid - 1] + s[mid]) / 2 if n % 2 == 0 else s[mid]


def _current_iso_week() -> str:
    today = date.today()
    year, week, _ = today.isocalendar()
    return f"{year}-W{week:02d}"


def _iso_week_from_date(date_str: str) -> str | None:
    if not date_str:
        return None
    try:
        clean = date_str[:19].replace("T", " ")
        dt = datetime.strptime(clean, "%Y-%m-%d %H:%M:%S")
        year, week, _ = dt.isocalendar()
        return f"{year}-W{week:02d}"
    except Exception:
        try:
            dt = datetime.fromisoformat(date_str[:10])
            year, week, _ = dt.isocalendar()
            return f"{year}-W{week:02d}"
        except Exception:
            return None


def _weeks_since(date_str: str) -> int:
    if not date_str:
        return 0
    try:
        dt = datetime.strptime(date_str[:19].replace("T", " "), "%Y-%m-%d %H:%M:%S")
        delta = date.today() - dt.date()
        return delta.days // 7
    except Exception:
        return 0


def _read_layer(path: str) -> list[dict[str, Any]]:
    try:
        return read_jsonl(path)
    except FileNotFoundError:
        return []


# ---------------------------------------------------------------------------
# Layer analysis
# ---------------------------------------------------------------------------

def _analyse_v7(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Analyse V7 benchmark observations. All records are treated as real (no validation concept)."""
    metric_vals: dict[str, list[float]] = defaultdict(list)
    all_dates: list[str] = []

    weeks: set[str] = set()
    by_week: dict[str, list[dict]] = defaultdict(list)

    for r in records:
        metric = r.get("metric", "")
        val = r.get("value")
        d = r.get("date", "")
        if val is not None:
            try:
                metric_vals[metric].append(float(val))
            except (TypeError, ValueError):
                pass
        if d:
            all_dates.append(d)
            w = _iso_week_from_date(d)
            if w:
                weeks.add(w)
                by_week[w].append(r)

    latest_date = max(all_dates) if all_dates else None
    data_age_weeks = _weeks_since(latest_date) if latest_date else 99
    stale = data_age_weeks >= V7_STALE_WEEKS

    paste_vals = metric_vals.get(PASTE_METRIC, [])
    ram_vals = metric_vals.get(RAM_GROWTH_METRIC, [])
    inference_vals = metric_vals.get(INFERENCE_METRIC, [])
    total_latency_vals = metric_vals.get(TOTAL_LATENCY_METRIC, [])

    paste_median = _median(paste_vals)
    ram_growth_max = max(ram_vals) if ram_vals else None
    inference_median = _median(inference_vals)
    total_latency_median = _median(total_latency_vals)
    idle_loop_confirmed = any(v > 0 for v in metric_vals.get(IDLE_LOOP_METRIC, []))

    constraint_reasons: list[str] = []
    product_constrained = False

    if paste_median is not None and paste_median > PASTE_CONSTRAINT_MS:
        product_constrained = True
        constraint_reasons.append(
            f"`paste_latency_ms` median = {paste_median:.0f}ms "
            f"(threshold: >{PASTE_CONSTRAINT_MS}ms)"
        )
    if ram_growth_max is not None and ram_growth_max > RAM_GROWTH_CONSTRAINT_MB:
        product_constrained = True
        constraint_reasons.append(
            f"`memory_growth_mb` max = {ram_growth_max:.0f}MB "
            f"(threshold: >{RAM_GROWTH_CONSTRAINT_MB}MB)"
        )

    return {
        "total_obs": len(records),
        "weeks": sorted(weeks),
        "by_week": dict(by_week),
        "paste_median": paste_median,
        "paste_obs": len(paste_vals),
        "inference_median": inference_median,
        "total_latency_median": total_latency_median,
        "ram_growth_max": ram_growth_max,
        "idle_loop_confirmed": idle_loop_confirmed,
        "latest_date": latest_date,
        "data_age_weeks": data_age_weeks,
        "stale": stale,
        "product_constrained": product_constrained,
        "constraint_reasons": constraint_reasons,
    }


def _analyse_v8(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Analyse V8 business observations. Excludes validation samples."""
    real = [r for r in records if r.get("source", "") not in VALIDATION_SOURCES]
    validation_count = len(records) - len(real)

    weeks: set[str] = set()
    by_week: dict[str, list[dict]] = defaultdict(list)
    for r in real:
        w = r.get("period")
        if w:
            weeks.add(w)
            by_week[w].append(r)

    def _latest_checked(metric: str) -> float | None:
        vals = [
            r.get("value") for r in real
            if r.get("metric") == metric
            and r.get("status", "measured") in CHECKED_STATUSES
            and r.get("value") is not None
        ]
        return float(vals[-1]) if vals else None

    downloads = _latest_checked("downloads")
    activations = _latest_checked("first_successful_dictations")
    mrr = _latest_checked("mrr")
    signups = _latest_checked("account_signups")

    activation_rate: float | None = None
    if downloads is not None and activations is not None and downloads > 0:
        activation_rate = activations / downloads

    funnel_constrained: bool | None = None
    if activation_rate is not None:
        funnel_constrained = activation_rate < ACTIVATION_RATE_MIN

    return {
        "total_real_obs": len(real),
        "validation_count": validation_count,
        "weeks": sorted(weeks),
        "by_week": dict(by_week),
        "downloads": downloads,
        "activations": activations,
        "mrr": mrr,
        "signups": signups,
        "activation_rate": activation_rate,
        "funnel_constrained": funnel_constrained,
    }


def _analyse_v9(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Analyse V9 content observations. Excludes validation samples."""
    real = [r for r in records if r.get("source", "") not in VALIDATION_SOURCES]
    validation_count = len(records) - len(real)

    pub = [r for r in real if r.get("record_type", "publication") == "publication"]

    weeks: set[str] = set()
    by_week: dict[str, list[dict]] = defaultdict(list)
    for r in pub:
        w = r.get("period")
        if w:
            weeks.add(w)
            by_week[w].append(r)

    current_week = _current_iso_week()
    posts_this_week = sum(1 for r in pub if r.get("period") == current_week)
    total_views: int | None = None
    views_sum = sum(r.get("views", 0) for r in real if isinstance(r.get("views"), int))
    if views_sum > 0:
        total_views = views_sum

    distribution_constrained: bool | None = None
    if len(pub) >= 1:
        distribution_constrained = posts_this_week == 0

    return {
        "total_real_obs": len(real),
        "pub_count": len(pub),
        "validation_count": validation_count,
        "weeks": sorted(weeks),
        "by_week": dict(by_week),
        "posts_this_week": posts_this_week,
        "total_views": total_views,
        "distribution_constrained": distribution_constrained,
    }


# ---------------------------------------------------------------------------
# Diagnosis
# ---------------------------------------------------------------------------

def _diagnose(
    v7: dict[str, Any],
    v8: dict[str, Any],
    v9: dict[str, Any],
) -> dict[str, Any]:
    """Apply the rule-based decision matrix. Returns a diagnosis dict."""
    v7_has = v7["total_obs"] > 0
    v8_has = v8["total_real_obs"] > 0
    v9_has = v9["total_real_obs"] > 0

    # â”€â”€ Priority 0: no data at all â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if not v7_has and not v8_has and not v9_has:
        return dict(
            bottleneck="insufficient_data",
            confidence="insufficient_data",
            action_type="business_data_entry",
            action="Record real business metrics â€” no data exists in any layer",
            evidence=[],
            why_not_other=(
                "No real observations exist in V7, V8, or V9. "
                "Recording V8 business data is the fastest path to useful signal "
                "(10-minute Monday session from Stripe, Supabase, and Vercel)."
            ),
            next_step=(
                "Open Stripe, Supabase, and Vercel. "
                "Record downloads, account_signups, first_successful_dictations, and MRR "
                "using: python internal/brain/scripts/add_business_observation.py"
            ),
            what_not_to_do=(
                "Do not make product or distribution decisions without any data. "
                "Do not confuse 'no data' with 'no traction'."
            ),
        )

    # â”€â”€ Priority 1: product constraint (V7 data exists and signals a problem) â”€
    if v7_has and v7["product_constrained"] and not v7["stale"]:
        evidence = [
            ("V7 benchmark", r, "confirmed")
            for r in v7["constraint_reasons"]
        ]
        if v7["idle_loop_confirmed"]:
            evidence.append(
                ("V7 benchmark", "`idle_background_inference_loop` confirmed", "1 observation + log evidence")
            )

        # MEDIUM: V7 has data but V8/V9 are empty â€” can't cross-validate business impact
        # HIGH only when all three layers confirm the same direction
        confidence = "high" if (v8_has and v9_has) else "medium"

        return dict(
            bottleneck="product",
            confidence=confidence,
            action_type="product_investigation",
            action=(
                "Investigate `paste_execute` root cause â€” "
                "read-only inspection of src-tauri/src/actions/paste.rs"
            ),
            evidence=evidence,
            why_not_other=(
                "V7 benchmarks confirm paste_execute â‰ˆ644ms = ~62% of p50 dictation latency. "
                "Scaling distribution or improving the funnel before fixing this sends users "
                "into a sluggish product experience. "
                "V8/V9 have no real data yet â€” but fixing product before measuring growth "
                "is the correct order per the operating contract."
            ),
            next_step=(
                "Read-only code inspection of src-tauri/src/actions/paste.rs. "
                "Output file: outputs/paste_mechanism_diagnosis.md. "
                "This is V7 backlog item PB-1. "
                "No code changes during this investigation â€” diagnosis only."
            ),
            what_not_to_do=(
                "Do not implement any code change before the diagnosis is written. "
                "Do not optimise Parakeet inference (stt_inference_time=~230ms â€” not the bottleneck). "
                "Do not run paid distribution before fixing product. "
                "Do not confuse investigation with implementation."
            ),
        )

    # â”€â”€ Stale V7 data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if v7_has and v7["stale"]:
        return dict(
            bottleneck="product",
            confidence="low",
            action_type="product_investigation",
            action=f"Re-run V7 benchmarks â€” last observation is {v7['data_age_weeks']} weeks old",
            evidence=[("V7 benchmark", "data_age_weeks", str(v7["data_age_weeks"]))],
            why_not_other=(
                "V7 data is stale. Cannot confirm whether the product constraint is still active. "
                "Must re-benchmark before diagnosing."
            ),
            next_step=(
                "Run â‰¥5 manual dictation sessions and record each with: "
                "python internal/brain/scripts/add_benchmark_observation.py"
            ),
            what_not_to_do="Do not diagnose the product layer from benchmarks older than 4 weeks.",
        )

    # â”€â”€ Priority 2: funnel constraint â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if v8_has and v8["funnel_constrained"] is True:
        rate_str = f"{v8['activation_rate']:.0%}" if v8["activation_rate"] is not None else "unknown"
        return dict(
            bottleneck="funnel",
            confidence="medium" if len(v8["weeks"]) >= 2 else "low",
            action_type="business_data_entry",
            action=f"Improve activation flow â€” activation rate is {rate_str} (target â‰¥30%)",
            evidence=[
                ("V8 business", "activation_rate", rate_str),
                ("V8 business", "downloads", str(int(v8["downloads"] or 0))),
                ("V8 business", "first_successful_dictations", str(int(v8["activations"] or 0))),
            ],
            why_not_other=(
                "People are downloading but not activating. Scaling distribution would send "
                "more people into the same broken funnel â€” wasted effort."
            ),
            next_step=(
                "Investigate what happens between download and first successful dictation. "
                "Check activation_failed rate and retry flow."
            ),
            what_not_to_do="Do not scale distribution until activation rate exceeds 30%.",
        )

    # â”€â”€ Priority 3: distribution gap â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if v9_has and v9["distribution_constrained"] is True:
        return dict(
            bottleneck="distribution",
            confidence="low" if len(v9["weeks"]) < 4 else "medium",
            action_type="distribution_data_entry",
            action="Resume content posting â€” no posts recorded this week",
            evidence=[
                ("V9 content", "posts_this_week", "0"),
                ("V9 content", "total_posts_recorded", str(v9["pub_count"])),
            ],
            why_not_other="Product and funnel appear healthy. Distribution effort has paused.",
            next_step=(
                "Record at least one content post: "
                "python internal/brain/scripts/add_content_observation.py --platform <p> ..."
            ),
            what_not_to_do="Do not pause distribution for more than 2 consecutive weeks.",
        )

    # â”€â”€ Insufficient cross-layer data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if not v8_has and not v9_has:
        return dict(
            bottleneck="insufficient_data",
            confidence="insufficient_data",
            action_type="business_data_entry",
            action="Record real business metrics â€” V8 has no real observations",
            evidence=[
                ("V8 business", "real observations", "0"),
                ("V9 content", "real observations", "0"),
            ],
            why_not_other=(
                "V7 product data exists and confirms a product constraint. "
                "However, cross-layer diagnosis requires V8 data to confirm business impact. "
                "Recording V8 data (10-min Monday session) unlocks the full diagnosis."
            ),
            next_step=(
                "Open Stripe, Supabase, and Vercel. "
                "Record downloads, account_signups, first_successful_dictations, and MRR "
                "using: python internal/brain/scripts/add_business_observation.py "
                "--metric <name> --value <n> --status measured --source <src> --period <YYYY-Www>"
            ),
            what_not_to_do=(
                "Do not run bottleneck diagnosis until at least V8 business data is recorded. "
                "Do not confuse 'no V8 data' with 'no business activity'."
            ),
        )

    # â”€â”€ All healthy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    return dict(
        bottleneck="all_healthy",
        confidence="medium",
        action_type="hold",
        action="All three layers are healthy â€” maintain current direction",
        evidence=[],
        why_not_other="No constraints detected across product, funnel, or distribution.",
        next_step="Continue recording weekly V8 and V9 data. Run this report each Monday.",
        what_not_to_do="Do not change strategy when all metrics are trending positively.",
    )


# ---------------------------------------------------------------------------
# Join table
# ---------------------------------------------------------------------------

def _build_join_rows(
    v7: dict, v8: dict, v9: dict,
) -> list[tuple[str, str, str, str, str, str, str, str]]:
    """Return list of (period, v7_paste, v7_ram, v8_dl, v8_act, v8_rate, v9_posts, v9_views)."""
    all_weeks: set[str] = set()
    all_weeks.update(v7["weeks"])
    all_weeks.update(v8["weeks"])
    all_weeks.update(v9["weeks"])
    if not all_weeks:
        return []

    rows = []
    for week in sorted(all_weeks):
        # V7 columns
        v7_paste = "â€”"
        v7_ram = "â€”"
        week_v7 = v7["by_week"].get(week, [])
        paste_vals = [float(r["value"]) for r in week_v7 if r.get("metric") == PASTE_METRIC and "value" in r]
        ram_vals = [float(r["value"]) for r in week_v7 if r.get("metric") == RAM_GROWTH_METRIC and "value" in r]
        if paste_vals:
            v7_paste = f"{_median(paste_vals):.0f}ms"
        if ram_vals:
            v7_ram = f"{max(ram_vals):.0f}MB"

        # V8 columns
        v8_dl, v8_act, v8_rate = "â€”", "â€”", "â€”"
        week_v8 = v8["by_week"].get(week, [])
        dl_vals = [r.get("value") for r in week_v8 if r.get("metric") == "downloads" and r.get("status") in CHECKED_STATUSES and r.get("value") is not None]
        act_vals = [r.get("value") for r in week_v8 if r.get("metric") == "first_successful_dictations" and r.get("status") in CHECKED_STATUSES and r.get("value") is not None]
        if dl_vals:
            v8_dl = str(int(float(dl_vals[-1])))
        if act_vals:
            v8_act = str(int(float(act_vals[-1])))
        if dl_vals and act_vals and float(dl_vals[-1]) > 0:
            v8_rate = f"{float(act_vals[-1]) / float(dl_vals[-1]):.0%}"

        # V9 columns
        v9_posts, v9_views = "â€”", "â€”"
        week_v9 = [r for r in v9["by_week"].get(week, []) if r.get("record_type", "publication") == "publication"]
        if v9["by_week"].get(week) is not None:
            v9_posts = str(len(week_v9))
            views_sum = sum(r.get("views", 0) for r in week_v9 if isinstance(r.get("views"), int))
            v9_views = f"{views_sum:,}" if views_sum > 0 else "0"

        rows.append((week, v7_paste, v7_ram, v8_dl, v8_act, v8_rate, v9_posts, v9_views))

    return rows


# ---------------------------------------------------------------------------
# Report builders
# ---------------------------------------------------------------------------

_CONF_ICON = {
    "high": "ðŸŸ¢ HIGH",
    "medium": "ðŸŸ¡ MEDIUM",
    "low": "ðŸ”´ LOW",
    "insufficient_data": "âšª INSUFFICIENT DATA",
}

_LAYER_ICON = {
    "product": "V7 â€” Product",
    "funnel": "V8 â€” Funnel",
    "distribution": "V9 â€” Distribution",
    "all_healthy": "All layers",
    "insufficient_data": "Data entry required",
}


def _build_unified_report(
    v7: dict, v8: dict, v9: dict,
    diagnosis: dict, join_rows: list,
    now: datetime,
) -> str:
    current_week = _current_iso_week()
    all_weeks = sorted({r[0] for r in join_rows}) if join_rows else []
    report_week = all_weeks[-1] if all_weeks else current_week

    # Data state
    layers_with_data = sum([v7["total_obs"] > 0, v8["total_real_obs"] > 0, v9["total_real_obs"] > 0])
    data_state = "FULL" if layers_with_data == 3 else ("PARTIAL" if layers_with_data >= 1 else "EMPTY")

    def suf_icon(has_data: bool, weeks: list) -> str:
        if not has_data:
            return "âŒ No real data"
        return "âœ… Sufficient" if len(weeks) >= 4 else f"âš ï¸ {len(weeks)} week(s) â€” needs â‰¥4"

    lines: list[str] = [
        "# Vocalype Brain â€” Unified Weekly Report",
        "",
        f"Generated: {now.isoformat()}",
        f"Report week: **{report_week}**",
        f"Current week: {current_week}",
        f"Data state: **{data_state}** ({layers_with_data}/3 layers have real data)",
        "",
    ]

    if data_state == "EMPTY":
        lines += [
            "> âš ï¸  No real observations found in any layer.",
            "> Record V8 business metrics (Monday 10-min session) to enable diagnosis.",
            "",
        ]
    elif data_state == "PARTIAL":
        lines += [
            "> âš ï¸  Partial data â€” cross-layer diagnosis is limited.",
            "> See Data Gaps section for what to record.",
            "",
        ]

    lines += ["---", ""]

    # --- Layer status table ---
    lines += ["## Layer Status", ""]

    # V7
    v7_signal = "â€”"
    if v7["total_obs"] > 0:
        parts = []
        if v7["paste_median"] is not None:
            parts.append(f"paste={v7['paste_median']:.0f}ms")
        if v7["inference_median"] is not None:
            parts.append(f"inference={v7['inference_median']:.0f}ms")
        if v7["ram_growth_max"] is not None:
            parts.append(f"RAM+{v7['ram_growth_max']:.0f}MB")
        if v7["idle_loop_confirmed"]:
            parts.append("idle loop confirmed")
        v7_signal = ", ".join(parts) if parts else f"{v7['total_obs']} obs"
    stale_note = f" âš ï¸ {v7['data_age_weeks']}w old" if v7["stale"] else ""

    # V8
    v8_signal = "â€”"
    if v8["total_real_obs"] > 0:
        parts = []
        if v8["downloads"] is not None:
            parts.append(f"downloads={int(v8['downloads'])}")
        if v8["activations"] is not None:
            parts.append(f"activations={int(v8['activations'])}")
        if v8["activation_rate"] is not None:
            parts.append(f"rate={v8['activation_rate']:.0%}")
        if v8["mrr"] is not None:
            parts.append(f"MRR=${v8['mrr']:.0f}")
        v8_signal = ", ".join(parts) if parts else f"{v8['total_real_obs']} obs"

    # V9
    v9_signal = "â€”"
    if v9["total_real_obs"] > 0:
        parts = []
        parts.append(f"{v9['pub_count']} posts")
        if v9["total_views"] is not None:
            parts.append(f"{v9['total_views']:,} views")
        v9_signal = ", ".join(parts)

    lines += [
        "| Layer | Real obs | Weeks of data | Key signals | Sufficiency |",
        "|---|---|---|---|---|",
        f"| **V7 â€” Product** | {v7['total_obs']} | {len(v7['weeks'])} | {v7_signal}{stale_note} | {suf_icon(v7['total_obs'] > 0, v7['weeks'])} |",
        f"| **V8 â€” Business** | {v8['total_real_obs']} ({v8['validation_count']} excluded) | {len(v8['weeks'])} | {v8_signal} | {suf_icon(v8['total_real_obs'] > 0, v8['weeks'])} |",
        f"| **V9 â€” Distribution** | {v9['total_real_obs']} ({v9['validation_count']} excluded) | {len(v9['weeks'])} | {v9_signal} | {suf_icon(v9['total_real_obs'] > 0, v9['weeks'])} |",
        "",
    ]
    lines += ["---", ""]

    # --- Cross-layer join table ---
    lines += ["## Cross-Layer Join Table", ""]
    if join_rows:
        lines += [
            "| Period | V7: paste_ms | V7: RAM+MB | V8: downloads | V8: activations | V8: rate | V9: posts | V9: views |",
            "|---|---|---|---|---|---|---|---|",
        ]
        for row in join_rows:
            lines.append(f"| {' | '.join(row)} |")
        lines.append("")
    else:
        lines += ["> No data in any layer yet â€” join table is empty.", ""]
    lines += ["---", ""]

    # --- Known product constraints ---
    lines += ["## Known Product Constraints (V7)", ""]
    if v7["total_obs"] > 0:
        if v7["constraint_reasons"]:
            lines += [
                "| Constraint | Evidence | Status |",
                "|---|---|---|",
            ]
            for reason in v7["constraint_reasons"]:
                lines.append(f"| Product constraint | {reason} | âš ï¸ Unresolved |")
            if v7["idle_loop_confirmed"]:
                lines.append(f"| Stability risk | idle_background_inference_loop confirmed in logs | âš ï¸ Unresolved |")
            lines.append("")
            if v7["paste_median"] is not None and v7["inference_median"] is not None:
                paste_pct = (v7["paste_median"] / (v7["paste_median"] + v7["inference_median"])) * 100
                lines += [
                    f"> Pipeline is **paste-bound**: paste={v7['paste_median']:.0f}ms = "
                    f"~{paste_pct:.0f}% of (paste+inference). "
                    f"Inference={v7['inference_median']:.0f}ms is NOT the bottleneck.",
                    "",
                ]
        else:
            lines += [f"> No product constraints detected from {v7['total_obs']} benchmark observations.", ""]
        if v7["stale"]:
            lines += [
                f"> âš ï¸ V7 data is **{v7['data_age_weeks']} weeks old** â€” may not reflect current product state.",
                "> Re-run benchmarks before acting on these signals.",
                "",
            ]
    else:
        lines += ["> No V7 benchmark data recorded yet.", ""]
    lines += ["---", ""]

    # --- Bottleneck diagnosis ---
    lines += ["## Bottleneck Diagnosis", ""]
    conf_str = _CONF_ICON.get(diagnosis["confidence"], diagnosis["confidence"].upper())
    layer_str = _LAYER_ICON.get(diagnosis["bottleneck"], diagnosis["bottleneck"])

    if diagnosis["bottleneck"] == "insufficient_data":
        lines += [
            "> âš ï¸ Insufficient data for full cross-layer diagnosis.",
            ">",
            "> **What IS known:**",
        ]
        if v7["total_obs"] > 0 and v7["product_constrained"]:
            lines.append("> - V7 product constraint confirmed (paste_execute bottleneck)")
        if v8["total_real_obs"] == 0:
            lines.append("> - V8 business data: 0 real observations (cannot assess funnel)")
        if v9["total_real_obs"] == 0:
            lines.append("> - V9 distribution data: 0 real observations (cannot assess reach)")
        lines += [
            ">",
            "> **What is NOT known:** business funnel health, activation rate, distribution effectiveness.",
            "",
        ]
    else:
        lines += [
            f"**Bottleneck layer:** {layer_str}  ",
            f"**Confidence:** {conf_str}  ",
            "",
        ]
        if diagnosis["confidence"] == "medium" and not (v8["total_real_obs"] > 0 and v9["total_real_obs"] > 0):
            lines += [
                "> Confidence is MEDIUM (not HIGH) because V8 and/or V9 have no real data.",
                "> Cannot cross-validate the product constraint against business impact.",
                "",
            ]

    lines += ["---", ""]

    # --- Data gaps ---
    lines += ["## Data Gaps â€” What to Record This Week", ""]
    gaps: list[str] = []
    if v8["total_real_obs"] == 0:
        gaps.append(
            "**V8 Business (highest priority):** Open Stripe, Supabase, Vercel. "
            "Record `downloads`, `account_signups`, `first_successful_dictations`, `mrr`. "
            "Use: `python internal/brain/scripts/add_business_observation.py`"
        )
    elif len(v8["weeks"]) < 4:
        gaps.append(
            f"**V8 Business:** {len(v8['weeks'])}/4 weeks recorded. "
            "Continue Monday sessions to reach baseline."
        )
    if v9["total_real_obs"] == 0:
        gaps.append(
            "**V9 Content:** No content posts recorded. "
            "After publishing, record each post with: `python internal/brain/scripts/add_content_observation.py`"
        )
    elif len(v9["weeks"]) < 4:
        gaps.append(
            f"**V9 Content:** {len(v9['weeks'])}/4 weeks recorded. "
            "Record posts consistently to reach trend baseline."
        )
    if v7["stale"]:
        gaps.append(
            f"**V7 Benchmarks:** Last recorded {v7['data_age_weeks']} weeks ago. "
            "Run â‰¥5 manual benchmark sessions using `add_benchmark_observation.py`."
        )

    if gaps:
        for g in gaps:
            lines.append(f"- {g}")
    else:
        lines += ["> All layers have sufficient data for baseline diagnosis."]
    lines.append("")
    lines += ["---", ""]

    # --- Risks ---
    lines += ["## Active Risks", ""]
    risks: list[str] = []
    if v7["product_constrained"] and not v7["stale"]:
        risks.append("**MEDIUM â€” Product latency:** paste_execute â‰ˆ644ms unresolved. Users experience visible paste lag on every dictation.")
    if v7["idle_loop_confirmed"]:
        risks.append("**MEDIUM â€” Memory leak:** idle background inference loop confirmed. RAM grew +110MB in 15 min idle.")
    if v8["total_real_obs"] == 0:
        risks.append("**LOW â€” Business blind spot:** 0 real V8 observations. Cannot detect funnel failures or MRR changes.")
    if v9["total_real_obs"] == 0:
        risks.append("**LOW â€” Distribution blind spot:** 0 real V9 observations. Cannot assess whether content drives downloads.")
    if not risks:
        risks.append("> No active risks flagged from current data.")
    for r in risks:
        lines.append(f"- {r}")
    lines.append("")
    lines += ["---", ""]

    # --- Stop conditions ---
    lines += ["## Active Stop Conditions", ""]
    lines += [
        "| # | Condition | Status |",
        "|---|---|---|",
        f"| SC1 | All three layers have 0 real observations | {'ðŸ”´ Active' if layers_with_data == 0 else 'âœ… Clear'} |",
        f"| SC3 | V8 MRR drops > 30% week-over-week | {'N/A â€” no V8 data' if v8['total_real_obs'] == 0 else 'âœ… Monitoring'} |",
        f"| SC6 | 4+ consecutive weeks without sufficient data | {'âš ï¸ Not yet â€” check in 4 weeks' if layers_with_data < 3 else 'âœ… Clear'} |",
        "",
    ]
    lines += ["---", ""]

    # --- Founder checklist ---
    lines += [
        "## Founder Decision Checklist",
        "",
        "[ ] Read `outputs/weekly_action.md` for this week's recommended action",
        "[ ] Check whether the diagnosis matches your intuition â€” if not, check the Data Gaps above",
    ]
    if v8["total_real_obs"] == 0:
        lines.append("[ ] **Record V8 business metrics** (10-min session â€” Stripe, Supabase, Vercel)")
    if v9["total_real_obs"] == 0:
        lines.append("[ ] **Record V9 content post** after publishing (add_content_observation.py)")
    lines += [
        "[ ] After recording, re-run: `python internal/brain/scripts/generate_unified_report.py`",
        "[ ] Commit: `git add internal/brain/data/ internal/brain/outputs/ && "
        "git commit -m \"data(brain): weekly unified snapshot YYYY-Www\"`",
        "",
    ]
    lines += ["---", ""]

    # --- Do not overreact ---
    lines += ["## Do Not Overreact Yet", ""]
    if data_state == "PARTIAL":
        lines += [
            f"- {layers_with_data}/3 layers have real data â€” full cross-layer pattern requires all three.",
            "- A single confirmed product constraint does not mean the product is failing â€” it means one specific fix has high leverage.",
        ]
    elif data_state == "EMPTY":
        lines += ["- 0 real observations across all layers. No conclusions are possible yet."]
    else:
        lines += ["- All layers have data â€” check confidence level before acting on any single week's signal."]

    lines += [
        "- No trend exists until â‰¥4 consecutive weeks of data in each layer.",
        "",
        "> Full cross-layer diagnosis requires â‰¥4 real weeks in all three layers.",
        "",
    ]

    lines += [
        "---",
        "",
        f"*Report generated from V7={v7['total_obs']} obs, "
        f"V8={v8['total_real_obs']} real obs ({v8['validation_count']} excluded), "
        f"V9={v9['total_real_obs']} real obs ({v9['validation_count']} excluded).*",
        f"*To re-run: `python internal/brain/scripts/generate_unified_report.py`*",
    ]

    return "\n".join(lines).rstrip() + "\n"


def _build_weekly_action(
    v7: dict, v8: dict, v9: dict,
    diagnosis: dict, now: datetime,
) -> str:
    current_week = _current_iso_week()
    conf_str = _CONF_ICON.get(diagnosis["confidence"], diagnosis["confidence"].upper())
    action_type = diagnosis["action_type"].replace("_", " ").title()

    lines: list[str] = [
        "# Vocalype Brain â€” Weekly Action",
        "",
        f"Generated: {now.isoformat()}",
        f"Week: {current_week}",
        f"Confidence: **{conf_str}**",
        "",
        "---",
        "",
        "## This Week's Action",
        "",
        f"**Action type:** `{diagnosis['action_type']}`  ",
        f"**Action:** {diagnosis['action']}  ",
        "",
    ]

    lines += ["---", ""]

    # Evidence
    lines += ["## Evidence", ""]
    if diagnosis["evidence"]:
        lines += ["| Source | Signal | Value |", "|---|---|---|"]
        for source, signal, value in diagnosis["evidence"]:
            lines.append(f"| {source} | {signal} | {value} |")
        lines.append("")
    else:
        lines += ["> No layer-specific evidence available â€” diagnosis based on absence of data.", ""]

    # Also show layer data state
    lines += [
        "| Layer | Real observations | Status |",
        "|---|---|---|",
        f"| V7 â€” Product | {v7['total_obs']} | {'âš ï¸ Constraint confirmed' if v7['product_constrained'] else ('âœ… No constraint' if v7['total_obs'] > 0 else 'âŒ No data')} |",
        f"| V8 â€” Business | {v8['total_real_obs']} | {'âš ï¸ Funnel issue' if v8['funnel_constrained'] else ('âœ… Healthy' if v8['total_real_obs'] > 0 else 'âŒ No data')} |",
        f"| V9 â€” Distribution | {v9['total_real_obs']} | {'âš ï¸ Gap detected' if v9['distribution_constrained'] else ('âœ… Posting' if v9['total_real_obs'] > 0 else 'âŒ No data')} |",
        "",
    ]
    lines += ["---", ""]

    # Why
    lines += ["## Why This Action", "", diagnosis["why_not_other"], "", "---", ""]

    # Exact next step
    lines += ["## Exact Next Step", "", diagnosis["next_step"], "", "---", ""]

    # What NOT to do
    lines += ["## What NOT to Do", "", diagnosis["what_not_to_do"], "", "---", ""]

    # Confidence explanation
    lines += ["## Confidence Explanation", ""]
    if diagnosis["confidence"] == "medium":
        lines += [
            f"**{conf_str}** â€” Signal is real but cross-layer validation is incomplete.",
            "",
            "What would raise confidence to HIGH:",
        ]
        if v8["total_real_obs"] == 0:
            lines.append("- Record â‰¥4 weeks of V8 business data (enable funnel cross-validation)")
        if v9["total_real_obs"] == 0:
            lines.append("- Record â‰¥4 weeks of V9 content data (enable distribution cross-validation)")
        if v7["stale"]:
            lines.append("- Re-run V7 benchmarks (data is stale)")
    elif diagnosis["confidence"] == "insufficient_data":
        lines += [
            f"**{conf_str}** â€” Cannot make a confident recommendation without real observations.",
            "",
            "What would enable a recommendation:",
            "- Record V8 business metrics for at least 1 week",
            "- Record V9 content posts for at least 1 week",
        ]
    elif diagnosis["confidence"] == "high":
        lines += [f"**{conf_str}** â€” All three layers have â‰¥4 weeks of consistent data pointing in the same direction."]
    elif diagnosis["confidence"] == "low":
        lines += [
            f"**{conf_str}** â€” Signal is present but from limited data (< 2 weeks or 1 layer only).",
            "Confirm over 2+ consecutive weeks before changing strategy.",
        ]
    lines.append("")

    lines += [
        "---",
        "",
        f"*Action generated from unified analysis of V7 ({v7['total_obs']} obs), "
        f"V8 ({v8['total_real_obs']} real obs), V9 ({v9['total_real_obs']} real obs).*",
        f"*To update: record new data then re-run `python internal/brain/scripts/generate_unified_report.py`*",
    ]

    return "\n".join(lines).rstrip() + "\n"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ensure_brain_structure()
    now = datetime.now().replace(microsecond=0)

    # Read all three layers
    v7_raw = _read_layer("data/benchmark_observations.jsonl")
    v8_raw = _read_layer("data/business_observations.jsonl")
    v9_raw = _read_layer("data/content_observations.jsonl")

    # Analyse
    v7 = _analyse_v7(v7_raw)
    v8 = _analyse_v8(v8_raw)
    v9 = _analyse_v9(v9_raw)

    # Diagnose
    diagnosis = _diagnose(v7, v8, v9)

    # Build join table
    join_rows = _build_join_rows(v7, v8, v9)

    # Write outputs
    unified_md = _build_unified_report(v7, v8, v9, diagnosis, join_rows, now)
    action_md = _build_weekly_action(v7, v8, v9, diagnosis, now)

    write_text("outputs/unified_weekly_report.md", unified_md)
    write_text("outputs/weekly_action.md", action_md)

    divider = "=" * 60
    print(divider)
    print("V10 Unified Weekly Decision Report")
    print(divider)
    print(f"\nData state  : {sum([v7['total_obs'] > 0, v8['total_real_obs'] > 0, v9['total_real_obs'] > 0])}/3 layers with real data")
    print(f"V7 product  : {v7['total_obs']} obs - {'CONSTRAINT' if v7['product_constrained'] else ('stale' if v7['stale'] else 'ok')}")
    print(f"V8 business : {v8['total_real_obs']} real obs ({v8['validation_count']} excluded)")
    print(f"V9 content  : {v9['total_real_obs']} real obs ({v9['validation_count']} excluded)")
    print(f"\nBottleneck  : {diagnosis['bottleneck']}")
    print(f"Confidence  : {diagnosis['confidence'].upper()}")
    print(f"Action type : {diagnosis['action_type']}")
    print(f"\nAction      : {diagnosis['action'][:80]}{'...' if len(diagnosis['action']) > 80 else ''}")
    print(f"\nWritten: internal/brain/outputs/unified_weekly_report.md")
    print(f"Written: internal/brain/outputs/weekly_action.md")
    print(divider)


if __name__ == "__main__":
    main()
