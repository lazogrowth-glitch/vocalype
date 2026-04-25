# Vocalype Brain — V9 Design Plan
# Growth / Distribution Loop — Content Performance Tracker

Date: 2026-04-25
Task type: planning_only
Author: Vocalype Brain
Status: DESIGN APPROVED — implementation pending

> V9 gives the Brain distribution eyes.
> V7 = product eyes. V8 = business eyes. V9 = content/distribution eyes.
> No product code is touched. No posting is automated. No APIs are called.

---

## 1. What V9 Should Do

V9 makes content distribution **measurable and comparable** without automating it.

The founder creates and posts content manually. V9 tracks what was posted, where, how it
performed, and what was learned. Over time, V9 surfaces which content attributes — platform,
format, hook style, niche, CTA — correlate with downstream business outcomes tracked in V8.

### V9 mandate

| Mandate | How |
|---|---|
| Record every piece of content the founder publishes | Manual entry via `add_content_observation.py` |
| Capture full content metadata at publication time | Platform, type, hook, niche, target user, CTA |
| Record performance metrics 24–72h after posting | Views, likes, comments, saves, shares, profile visits, website clicks |
| Record lesson learned and next content action | Structured free-text fields |
| Surface which content attributes drive profile visits and website clicks | `review_content_performance.py` → `content_report.md` |
| Generate a ranked content backlog by estimated leverage | `distribution_backlog.md` |
| Connect content performance to V8 business outcomes (downloads, signups) | V9 Phase 2 — after baseline data exists |

### V9 phases

| Phase | Description | Gate to enter |
|---|---|---|
| Phase 1 — Manual content log | Founder records each post. Brain generates weekly content report. | Now — no gate |
| Phase 2 — V8 correlation | Brain joins V9 content weeks to V8 business weeks. Asks: did content drive downloads? | ≥10 content observations across ≥2 platforms |
| Phase 3 — Experiment comparison | Before/after tracking for format/hook/niche experiments. | ≥4 weeks of V9 + V8 joint data |
| Phase 4 — Automation of proven channels | Only automates what Phase 3 proves works. | Founder approval required, separate design |

**Phase 4 is not part of this design. It is named only so Phase 1–3 have a clear destination.**

---

## 2. What V9 Must NOT Do

| Forbidden action | Why |
|---|---|
| Auto-post to any platform | V9 Phase 1–3 are manual only. Automation is Phase 4 — separate design |
| Scrape platform analytics | No scraping, crawling, or headless browser access to TikTok / Instagram / YouTube / X |
| Call any social media API | No OAuth, no API tokens, no read-only platform access until Phase 4 |
| Recommend paid advertising | No CAC/LTV baseline exists — paid ads cannot be evaluated |
| Generate content on behalf of the founder | V9 tracks experiments; the founder creates content |
| Declare a content format a "win" with fewer than 5 data points | Anti-hype — same discipline as V8 |
| Attribute downloads to a specific post without V8 correlation | Attribution requires cross-dataset join, not guessing |
| Compute engagement-rate trends from 1–2 posts | One data point is not a pattern |
| Expand scope to product recommendations | V7 handles product. V9 handles distribution |
| Modify backend, auth, license, or product code | Permanently forbidden per operating contract |
| Record content for platforms not in the approved list without noting it | Always flag unknown platforms as warnings, not errors |
| Invent performance numbers | Every metric must come from the founder manually checking the platform |

---

## 3. Exact Growth / Distribution Metrics

### 3a — Content metadata (recorded at publication time)

| Field | Type | Required | Notes |
|---|---|---|---|
| `post_date` | ISO date string `YYYY-MM-DD` | Yes | Date content was published |
| `period` | ISO week `YYYY-Www` | Yes | For join with V8 business week |
| `platform` | enum (see 3c) | Yes | Publishing platform |
| `content_type` | enum (see 3d) | Yes | Format / style of content |
| `hook` | string | Yes | First 3–5 seconds / opening line verbatim or summarized |
| `niche` | enum (see 3e) | Yes | Target audience segment |
| `target_user` | string | Yes | Persona: "developer who types fast", "student with dyslexia", etc. |
| `cta` | string | Yes | Call-to-action text / intent: "download link in bio", "comment X for link" |
| `source` | enum (see 3f) | Yes | Always `manual_founder` for real entries |
| `status` | enum | Yes | `published` / `draft` / `removed` |

### 3b — Performance metrics (recorded 24–72h after posting)

| Field | Type | Required | Notes |
|---|---|---|---|
| `views` | integer | Yes | Total views / plays at time of check |
| `likes` | integer | Yes | Total likes at time of check |
| `comments` | integer | No | Nullable — not all platforms show comments easily |
| `saves` | integer | No | Nullable — TikTok, Instagram; not available on X/Twitter |
| `shares` | integer | No | Nullable — platform-dependent |
| `profile_visits` | integer | No | Nullable — TikTok shows this; others may not |
| `website_clicks` | integer | No | Nullable — only if link-in-bio analytics available |
| `downloads_attributed` | integer | No | Nullable — leave null unless founder manually traced |
| `check_hours_after_post` | integer | No | Hours between posting and metric check (default 48) |

### 3c — Approved platforms

```
tiktok
instagram_reels
youtube_shorts
youtube
twitter_x
```

Unknown platforms: record with `--notes "platform: <name>"` — script warns but does not block.

### 3d — Content types

```
demo           — product demo showing dictation in action
tutorial       — how to use a feature step by step
pain_point     — problem the founder / user experiences (hook-first)
testimonial    — real user story or result
hook_test      — testing a specific hook style (trend sound, question, shock)
before_after   — typing vs dictation comparison
day_in_life    — founder or user routine showing product in context
reaction       — reacting to typing struggle / productivity content
```

### 3e — Niches

```
productivity
developer
writer
student
accessibility
remote_worker
entrepreneur
general
```

### 3f — Sources

```
manual_founder     — real content observation
manual_validation  — script testing only (excluded from all reports)
```

### 3g — Lesson learned and next action (required free-text)

| Field | Type | Required | Notes |
|---|---|---|---|
| `lesson_learned` | string | Yes (if ≥24h since post) | What this post taught. If nothing: "no lesson yet" |
| `next_action` | string | Yes | What to try next based on this post |

---

## 4. Manual Content Observation Format

One observation = one content post + its performance check.

Recording happens in two passes:

**Pass 1 — at publication time** (metadata only, no performance metrics yet):
```bash
python vocalype-brain/scripts/add_content_observation.py \
    --post_date 2026-04-25 \
    --platform tiktok \
    --content_type demo \
    --hook "I stopped typing forever with this app" \
    --niche productivity \
    --target_user "developer who types a lot" \
    --cta "download link in bio" \
    --status published \
    --source manual_founder \
    --period 2026-W18
```

**Pass 2 — 24–72h after posting** (update with performance metrics):
```bash
python vocalype-brain/scripts/update_content_observation.py \
    --post_id <id_from_pass_1> \
    --views 1240 \
    --likes 52 \
    --saves 18 \
    --profile_visits 34 \
    --website_clicks 8 \
    --check_hours_after_post 48 \
    --lesson_learned "saves higher than likes ratio — audience bookmarking for later" \
    --next_action "test same hook on Instagram Reels"
```

> **Implementation note:** In V9 Phase 1 minimal implementation, both passes can be combined
> into a single `add_content_observation.py` call. The two-pass split is the design ideal;
> single-pass is acceptable if performance metrics are known at recording time.

---

## 5. Future Automated Format (Phase 4 — not yet)

When Phase 4 is approved, the observation schema will extend with:

| Field | Type | Source | Notes |
|---|---|---|---|
| `fetch_source` | enum | `api_tiktok` / `api_instagram` / etc. | How data was collected |
| `fetch_timestamp` | ISO datetime | automated | When the API pulled the data |
| `raw_api_response_sha` | string | automated | Hash of raw response for audit |
| `api_version` | string | automated | Platform API version used |

The JSONL schema is designed to be backward-compatible: Phase 1 manual records and Phase 4
automated records will coexist in the same `data/content_observations.jsonl` file.

**Phase 4 is not designed here. It must have its own design document.**

---

## 6. Exact Input Files

| File | Purpose | Read by |
|---|---|---|
| `data/content_observations.jsonl` | All content posts and their performance | `review_content_performance.py`, `weekly_content_snapshot.py` |
| `data/business_observations.jsonl` | V8 weekly business metrics (downloads, signups) | V9 Phase 2 correlation script |
| `data/benchmark_observations.jsonl` | V7 product metrics (latency, RAM) | V9 Phase 3 — when correlating product quality to content reach |
| `memory/operating_contract.md` | Safety rules | Every script reads implicitly via Brain contract |
| `outputs/v8_design_plan.md` | Business metric definitions (to ensure V9 uses same period format) | Design-time reference |

---

## 7. Exact Output Files

| File | Generated by | Contents |
|---|---|---|
| `data/content_observations.jsonl` | `add_content_observation.py` | One record per content post |
| `outputs/content_report.md` | `review_content_performance.py` | Platform breakdown, content type breakdown, hook analysis, top posts, coverage gaps |
| `outputs/distribution_backlog.md` | `review_content_performance.py` | Ranked list of content experiment candidates by estimated leverage |
| `outputs/weekly_content_snapshot.md` | `weekly_content_snapshot.py` | Founder checklist: what was posted, what performed, what to post next week |
| `outputs/v9_design_plan.md` | Planning only | This file |

---

## 8. Proposed JSONL Schemas

### 8a — `data/content_observations.jsonl`

One record per observation. Records are append-only. Performance updates are new records
with the same `post_id` and `record_type: "performance_update"`.

```json
{
  "observation_id": "v9-20260425-001",
  "post_id": "post-20260425-tiktok-001",
  "record_type": "publication",
  "date_recorded": "2026-04-25T10:00:00",
  "post_date": "2026-04-25",
  "period": "2026-W18",
  "platform": "tiktok",
  "content_type": "demo",
  "hook": "I stopped typing forever with this app",
  "niche": "productivity",
  "target_user": "developer who types a lot",
  "cta": "download link in bio",
  "status": "published",
  "source": "manual_founder",
  "app_version": "abc1234",
  "notes": null
}
```

Performance update record (same `post_id`, different `observation_id`):
```json
{
  "observation_id": "v9-20260427-001",
  "post_id": "post-20260425-tiktok-001",
  "record_type": "performance_update",
  "date_recorded": "2026-04-27T09:00:00",
  "period": "2026-W18",
  "platform": "tiktok",
  "check_hours_after_post": 48,
  "views": 1240,
  "likes": 52,
  "comments": 8,
  "saves": 18,
  "shares": null,
  "profile_visits": 34,
  "website_clicks": 8,
  "downloads_attributed": null,
  "lesson_learned": "saves higher than likes ratio — audience bookmarking for later",
  "next_action": "test same hook on Instagram Reels",
  "source": "manual_founder",
  "app_version": "abc1234"
}
```

**Field rules:**
- `observation_id`: auto-generated `v9-YYYYMMDD-NNN` (sequential within day)
- `post_id`: founder-supplied or auto-generated `post-YYYYMMDD-platform-NNN`
- `record_type`: `publication` | `performance_update`
- `period`: ISO week format `YYYY-Www` — must match V8 period keys exactly
- All nullable performance fields omitted (not stored as null) if not provided
- `source: manual_validation` records are excluded from all reports

### 8b — Field validation rules

| Field | Validation |
|---|---|
| `platform` | Must be in approved list (Section 3c) — warn if not, do not block |
| `content_type` | Must be in approved list (Section 3d) — warn if not, do not block |
| `niche` | Must be in approved list (Section 3e) — warn if not, do not block |
| `post_date` | Must be valid ISO date `YYYY-MM-DD` |
| `period` | Must match `^\d{4}-W(0[1-9]\|[1-4]\d\|5[0-3])$` |
| `views` | Must be integer ≥ 0 |
| `likes` | Must be integer ≥ 0 |
| `saves`, `shares`, `comments` | Integer ≥ 0 or absent |
| `profile_visits`, `website_clicks` | Integer ≥ 0 or absent |
| `downloads_attributed` | Integer ≥ 0 or absent — must not be inferred, only founder-confirmed |
| `lesson_learned` | Required string for performance_update records |
| `next_action` | Required string for performance_update records |

---

## 9. Safety Gates

These gates prevent premature conclusions from insufficient data.

| Gate | Rule | Consequence if violated |
|---|---|---|
| G1 — Minimum posts per format | Do not declare a content type a "winner" with fewer than 5 posts | Report shows count; no ranking until ≥5 |
| G2 — Minimum posts per platform | Do not recommend abandoning a platform with fewer than 5 posts | Report shows count; no abandonment suggestion until ≥5 |
| G3 — Performance check timing | Do not record performance metrics before 24h post age | Script warns if `check_hours_after_post < 24` |
| G4 — V8 join requires real V8 data | Phase 2 correlation requires ≥4 weeks of real V8 observations | Script checks V8 baseline before running correlation |
| G5 — No attribution without evidence | `downloads_attributed` must be founder-confirmed, not inferred from website_clicks alone | Field is nullable; script never auto-populates it |
| G6 — No trend from 1 week | Weekly content snapshot explicitly states "N weeks of data — not a trend yet" until ≥4 | Anti-hype section in every snapshot |
| G7 — No paid recommendation | Report never suggests paid amplification | Hardcoded exclusion from recommendations section |
| G8 — Validation exclusion | `source: manual_validation` records are always filtered before any analysis | Same mechanism as V8 |

---

## 10. Stop Conditions

Stop recording / stop analyzing and report to founder when:

| # | Condition | Action |
|---|---|---|
| SC1 | Founder records views > 500,000 for an early-stage post | Flag for verification — potential input error or viral outlier |
| SC2 | Platform analytics show website_clicks >> V8 website_visitors for same week | Flag discrepancy — attribution may be measuring different audiences |
| SC3 | Content observations exist but V8 observations do not for the same period | Warn: "V9 distribution data exists for this week but V8 business data is missing — Phase 2 correlation will be incomplete" |
| SC4 | Founder records `downloads_attributed` that exceed V8 `downloads` for same period | Flag impossible attribution — cannot attribute more downloads than were recorded |
| SC5 | ≥3 consecutive weeks with 0 content posts | Flag: "No content recorded for 3+ weeks — distribution effort may have paused" |
| SC6 | All recorded posts are from a single platform | Warn: "All data is from one platform — cannot assess cross-platform performance" |
| SC7 | Script asked to auto-post, call API, or scrape | Stop immediately — outside V9 Phase 1–3 scope |
| SC8 | Founder attempts to derive engagement rate as a trend from 1 post | Warn: "Engagement rate from a single post is not a trend" |

---

## 11. How V9 Connects to V8 Business Metrics

V9 and V8 share the same period key: ISO week `YYYY-Www`.

This join makes the following questions answerable (Phase 2):

| V9 signal | V8 signal | Question |
|---|---|---|
| `content_posts` count in week N | V8 `downloads` in week N and N+1 | Does posting more content correlate with more downloads? |
| `profile_visits` sum in week N | V8 `website_visitors` in week N | Do profile visits drive site visits? |
| `website_clicks` sum in week N | V8 `website_visitors` in week N | Does link-in-bio traffic appear in Vercel analytics? |
| `content_type = demo` posts | V8 `first_successful_dictations` | Do demo posts drive activation events? |
| `platform = tiktok` posts | V8 `downloads` next week | Is TikTok a meaningful download driver? |

**Phase 2 join protocol:**
- Group V9 performance records by `period`
- Group V8 observations by `period` (checked status only)
- Produce a weekly join table: `period | content_posts | total_views | profile_visits | website_clicks | v8_downloads | v8_signups`
- Only produce the join table when ≥10 V9 observations and ≥4 real V8 weeks both exist

**Current status:** Neither dataset has real data. The join infrastructure will be designed
in Phase 2. The period key alignment is the only current connection.

---

## 12. How V9 Connects to V7 Product Insights

V7 found that `paste_execute` takes 645ms — 62% of total dictation latency. This is the
visible lag a user sees when the transcription pastes into their active window.

| V7 finding | V9 implication |
|---|---|
| paste_execute = 645ms constant bottleneck | Content demos show a visible paste delay — founder should know this is real lag, not editing |
| Idle background inference loop (+110MB/15min) | Long recording demos risk showing RAM warnings on lower-spec machines |
| p95 tail latency = 2405ms (chunk_cleanup) | Demo recordings sometimes show slow outlier — not representative of p50 |
| stt_inference_time = 230ms (not the bottleneck) | The inference model is fast — demos can honestly highlight inference speed |

**V9 Phase 3 product–content link:**
When the V7 paste_execute fix is applied and V7 Phase 2 baseline comparison is run,
V9 should record a `content_type: before_after` post showing the speed improvement.
This is the first data-backed content asset. V9 Phase 3 will track whether product
improvement content drives higher download conversion than general demos.

---

## 13. Future Implementation Steps

### Phase 1 — Minimal implementation (next session)

| Step | Deliverable | Type |
|---|---|---|
| 1 | `add_content_observation.py` — CLI recorder for publication + performance | `feat(brain)` |
| 2 | `data/content_observations.jsonl` — empty JSONL store | `feat(brain)` |
| 3 | Validate with 2 manual_validation records (publication + performance update) | `feat(brain)` |
| 4 | `review_content_performance.py` — report generator | `feat(brain)` |
| 5 | `outputs/content_report.md` — generated on validation run | `feat(brain)` |
| 6 | `weekly_content_snapshot.py` — founder checklist | `feat(brain)` |
| 7 | `outputs/weekly_content_snapshot.md` — generated on validation run | `feat(brain)` |

### Phase 2 — V8 correlation (after ≥10 V9 observations and ≥4 real V8 weeks)

| Step | Deliverable | Type |
|---|---|---|
| 8 | `correlate_content_business.py` — joins V9 × V8 by period | `feat(brain)` |
| 9 | `outputs/content_business_correlation.md` — weekly join table + commentary | `feat(brain)` |

### Phase 3 — Experiment comparison (after ≥4 weeks joint data)

| Step | Deliverable | Type |
|---|---|---|
| 10 | `compare_content_experiments.py` — before/after format/hook/niche comparisons | `feat(brain)` |
| 11 | `outputs/experiment_report.md` — which experiments moved the needle | `feat(brain)` |
| 12 | `outputs/distribution_backlog.md` — ranked experiment candidates | updated by above |

### Phase 4 — Automation of proven channels (separate design, future)

- Requires: Phase 3 proof, founder approval, new V9 design document
- Out of scope for this plan

---

## 14. Validation Commands

After Phase 1 implementation, run these to confirm the scripts work:

```bash
# Syntax check
python -m py_compile vocalype-brain/scripts/add_content_observation.py
python -m py_compile vocalype-brain/scripts/review_content_performance.py
python -m py_compile vocalype-brain/scripts/weekly_content_snapshot.py

# Record a validation publication
python vocalype-brain/scripts/add_content_observation.py \
    --post_date 2026-04-25 \
    --platform tiktok \
    --content_type demo \
    --hook "Test hook for validation" \
    --niche productivity \
    --target_user "developer" \
    --cta "link in bio" \
    --status published \
    --source manual_validation \
    --period 2026-W18

# Record a validation performance update
python vocalype-brain/scripts/add_content_observation.py \
    --post_id post-20260425-tiktok-001 \
    --record_type performance_update \
    --views 100 \
    --likes 10 \
    --saves 5 \
    --check_hours_after_post 48 \
    --lesson_learned "validation sample — no lesson" \
    --next_action "validation sample — no action" \
    --source manual_validation \
    --period 2026-W18

# Generate report (should show 0 real observations, 2 validation samples excluded)
python vocalype-brain/scripts/review_content_performance.py

# Generate weekly snapshot
python vocalype-brain/scripts/weekly_content_snapshot.py

# Confirm validation samples are excluded from reports
grep -c "manual_validation" vocalype-brain/outputs/content_report.md || echo "excluded correctly"
```

Expected outcomes:
- All `py_compile` commands: no output (clean)
- `review_content_performance.py`: generates `content_report.md` showing 0 real observations
- `weekly_content_snapshot.py`: generates `weekly_content_snapshot.md` with warning about no real data
- `content_report.md` does not expose validation sample data in any analysis section

---

## 15. How V9 Prepares V10 Unified Decision Engine

V10 will be the first phase where the Brain can make **cross-layer decisions** — connecting
product performance (V7), business outcomes (V8), and distribution results (V9) into a
single recommendation engine.

V9 enables V10 by:

| V9 deliverable | What V10 can do with it |
|---|---|
| `content_observations.jsonl` with consistent `period` key | V10 joins all three datasets by week |
| `platform` and `content_type` breakdown | V10 asks: "which content format drives the most downloads per post?" |
| `profile_visits` and `website_clicks` per week | V10 correlates distribution effort to funnel top |
| `lesson_learned` and `next_action` free-text | V10 surfaces patterns across lessons (NLP or founder-curated) |
| `distribution_backlog.md` ranked by leverage | V10 inputs this as the growth experiment candidate queue |

**V10 North Star question:**
> "Given current product quality (V7), current funnel conversion (V8), and current
> distribution performance (V9) — what is the single highest-leverage action this week?"

V10 cannot answer this question until all three layers have ≥4 weeks of real data.

**V10 gates (preliminary — V10 will define its own):**
- V7 Phase 2 baseline locked (benchmark comparison running)
- V8 ≥4 weeks real business observations
- V9 ≥4 weeks real content observations across ≥2 platforms
- At least one V7 product improvement applied and measured
- Founder has reviewed and signed off on V9 Phase 2 correlation report

---

## 16. Exact Next Prompt for V9 Minimal Implementation

Copy and send this prompt to begin V9 Phase 1:

```
Read and follow:
- vocalype-brain/memory/operating_contract.md
- vocalype-brain/memory/current_state.md
- vocalype-brain/outputs/v9_design_plan.md

Mission:
Implement V9 Phase 1 — Content Performance Recorder.

Task type:
implementation_task (Brain-only).
No product code changes.

Goal:
Build the minimal V9 scripts that let the founder record content posts and
generate a weekly content performance report.

Create:
- vocalype-brain/scripts/add_content_observation.py
- vocalype-brain/data/content_observations.jsonl  (empty JSONL store)
- vocalype-brain/scripts/review_content_performance.py
- vocalype-brain/scripts/weekly_content_snapshot.py
- vocalype-brain/outputs/content_report.md         (generated)
- vocalype-brain/outputs/weekly_content_snapshot.md (generated)

Update:
- vocalype-brain/memory/current_state.md

Implementation must follow v9_design_plan.md exactly:
- Section 3: field definitions, platform/content_type/niche enums
- Section 4: two-pass observation format (publication + performance_update)
- Section 8: JSONL schemas (observation_id, post_id, record_type)
- Section 9: safety gates (≥5 posts before ranking, ≥24h before performance check)
- Section 10: stop conditions (SC1, SC4, SC8 must be implemented in scripts)
- Section 14: validation commands must all pass

add_content_observation.py requirements:
- Required args: --post_date (or --post_id for update), --platform, --content_type,
  --hook, --niche, --target_user, --cta, --source, --period
- Optional args: --record_type (default: publication), --post_id, --status,
  --views, --likes, --comments, --saves, --shares, --profile_visits,
  --website_clicks, --downloads_attributed, --check_hours_after_post,
  --lesson_learned, --next_action, --notes, --app_version
- Auto-generates observation_id and post_id if not provided
- Validates platform, content_type, niche against approved enums (warn, not block)
- Warns if check_hours_after_post < 24 (gate G3)
- Warns if views > 500000 (stop condition SC1)
- Does NOT allow downloads_attributed to be auto-populated
- Excludes source=manual_validation from all reports

review_content_performance.py requirements:
- Reads data/content_observations.jsonl
- Excludes source=manual_validation from all analysis
- Sections: platform breakdown, content_type breakdown, top posts by views,
  hook pattern summary (tabular — no NLP), V8 connection placeholder,
  coverage gaps (posts with no performance update yet), distribution backlog
- Safety: do not rank if fewer than 5 posts of a type (show count only)
- Output: outputs/content_report.md

weekly_content_snapshot.py requirements:
- Reads data/content_observations.jsonl
- Excludes source=manual_validation
- Shows: posts this week, best performer (if ≥1), pending performance checks,
  lesson summary (list of lesson_learned fields), next actions (list of next_action fields)
- Anti-hype section: "N weeks of data — not a trend yet" until ≥4
- Founder checklist: what to post this week (next_action items from last week)
- Output: outputs/weekly_content_snapshot.md

After implementation:
- Run all validation commands from v9_design_plan.md Section 14
- Run python -m py_compile on all three scripts
- All checks must pass before committing

Commit if all checks pass:
feat(brain): add V9 content performance recorder

Rules:
- Do not modify product code.
- Do not add API calls.
- Do not add web scraping.
- Do not auto-post.
- Only write inside vocalype-brain/.
- Follow brain.py (from brain module) for file I/O — use append_jsonl, write_text, read_jsonl.
```

---

## Summary Card

```
V9 DESIGN (2026-04-25)
────────────────────────────────────────────────────────────────────
Purpose:   Content / distribution visibility
           Manual-first. No automation. No APIs. No paid ads.

What it tracks:
  Per content post:  platform, content_type, hook, niche, target_user, CTA
  Per performance:   views, likes, comments, saves, shares,
                     profile_visits, website_clicks, downloads_attributed
  Per lesson:        lesson_learned, next_action (free-text, required)

Platforms:   tiktok | instagram_reels | youtube_shorts | youtube | twitter_x
Types:       demo | tutorial | pain_point | testimonial | hook_test |
             before_after | day_in_life | reaction

Period key:  ISO week YYYY-Www (same as V8 — enables cross-dataset join)

Scripts to build (Phase 1):
  add_content_observation.py   — CLI recorder (publication + performance update)
  review_content_performance.py — content report + distribution backlog
  weekly_content_snapshot.py   — founder checklist (anti-hype)

Safety:
  - No ranking until ≥5 posts of a type (gate G1/G2)
  - No trend until ≥4 weeks (gate G6)
  - validation samples excluded from all reports (gate G8)
  - downloads_attributed never auto-populated (gate G5)
  - Views > 500K flagged for verification (SC1)

V8 link:    join by period — content weeks × business weeks
V7 link:    paste latency known — demos show real p50 lag
V10 link:   all three layers (V7+V8+V9) join by period → unified decision engine

Phases:
  Phase 1 — Manual content log         ← NEXT (implement now)
  Phase 2 — V8 correlation             (after ≥10 posts + ≥4 V8 weeks)
  Phase 3 — Experiment comparison      (after ≥4 joint weeks)
  Phase 4 — Channel automation         (separate design — not now)

Product code touched during V9 design: ZERO
────────────────────────────────────────────────────────────────────
```

---

*This document is planning_only. No product code was modified or proposed for modification.*
*V9 Phase 1 implementation prompt is in Section 16 above.*
