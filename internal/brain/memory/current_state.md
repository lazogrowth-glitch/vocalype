# Vocalype Brain â€” Current State

Last updated: 2026-04-26
Latest commit: chore(brain): simplify operating mode launchers
Brain phase: OPERATING MODE â€” construction complete (V1â€“V12)

---

## Phase

**OPERATING MODE. Construction phase V1â€“V12 complete.**

All Brain infrastructure layers are built and exercised. No new Brain versions are needed.
The Brain now runs existing loops â€” it does not build new ones.

**V12 CLOSED â€” PROVISIONAL_KEEP.**
Product commit `f842401`: `paste_delay_ms.max(450)` â†’ `max(150)` at clipboard.rs:120.
Smoke tests: Notepad âœ… VS Code âœ… Chrome âœ… Gmail âœ… Slack âœ… Teams âœ… Word âœ… â€” 21/21 PASS (2026-04-27)
Benchmarks pending: â‰¥5 post-fix `paste_latency_ms` observations not yet recorded.
Rollback still armed: `git checkout -- src-tauri/src/platform/clipboard.rs`
Upgrades to FULL_KEEP when â‰¥5 benchmarks confirm median < 420ms.
Lifecycle: `paste_latency_pending_benchmarks` â†’ `PATCH_SHIPPED` (smoke test phase closed).

**Desktop launchers â€” Bureau simplifiÃ©:**
- `Lancer Agent Vocalype Auto.bat` â€” **SEUL bouton principal** sur le Bureau

**Dossier avancÃ©** : `C:\Users\ziani\Desktop\Vocalype Brain - AvancÃ©\`
- `Lancer Vocalype Brain.bat` â€” cycle manuel
- `Voir Action du Robot.bat` â€” ouvre weekly_action.md directement
- `Generer Mission Claude.bat` â€” gÃ©nÃ¨re + ouvre v11_mission_package.md
- `Enregistrer Resultat.bat` â€” lance tous les review scripts + ouvre rapports
- `Voir Rapports Vocalype Brain.bat` â€” ouvre tous les rapports disponibles
- `Stop Vocalype Brain.bat` â€” rappelle qu'il n'y a pas de daemon
- `Creer Context DeepSeek.bat` â€” construit context_pack.md pour modÃ¨le externe

**Workflow normal (4 Ã©tapes) :**
1. Double-clic `Lancer Agent Vocalype Auto` â†’ lit `agent_recommendation.md`
2. Si mission produit â†’ copier `v11_mission_package.md` dans Claude / Codex
3. Laisser Claude exÃ©cuter â†’ review diff avant commit
4. Si besoin â†’ dossier AvancÃ© â†’ `Enregistrer Resultat.bat`

**Model Routing Pack:** `config/model_routing.json` â€” 5 rÃ´les dÃ©finis
- `local_fast` â†’ qwen2.5:1.5b (routine, privÃ©)
- `local_coder` â†’ qwen2.5-coder:7b (code review, privÃ©)
- `local_critic` â†’ qwen3:8b (safety review, privÃ©)
- `deepseek_long_context` â†’ DeepSeek API (raisonnement long, nÃ©cessite DEEPSEEK_API_KEY)
- `external_implementation_manual` â†’ Claude/Codex (implÃ©mentation sensible, manuel)
API key : jamais dans git â€” variable d'environnement Windows ou .env local exclus.

**Supervised Auto-Router:** `scripts/run_operating_agent.py`
- Lance le cycle Brain, classifie l'action, route vers local/DeepSeek/Claude
- ContrÃ´lÃ© par `VOCALYPE_BRAIN_EXTERNAL_MODE` : off | confirm (dÃ©faut) | auto
- `confirm` = prÃ©pare context_pack.md + instructions, n'appelle PAS DeepSeek
- `auto` = appelle DeepSeek uniquement pour `long_reasoning` si DEEPSEEK_API_KEY est dÃ©fini
- Ne modifie jamais le code produit. Ne dÃ©ploie rien. Pas de daemon.
- Sorties : `agent_run_report.md`, `agent_recommendation.md`, `external_context_audit.md`, `deepseek_response.md`

**Operating Mode weekly rhythm:**
1. Founder: double-clic `Lancer Agent Vocalype Auto.bat` â†’ lit `agent_recommendation.md` â†’ copie mission dans Claude
2. Founder: record V8 business data every Monday (~10 min, Stripe/Supabase/Vercel)
3. Founder: record V9 content observations after each post
4. After Claude finishes â†’ dossier AvancÃ© â†’ `Enregistrer Resultat.bat` si nÃ©cessaire

V8 status: CLOSED. Infrastructure complete. Real business observations = 0 (founder Monday session pending).
V8 real data needed: record weekly metrics from Stripe / Supabase / Vercel each Monday (10 min).

---

## What Works Right Now

- Night Shift: 5-cycle proposal loop, proposal_only mode, local Ollama (qwen3:8b)
- Task classification: `planning_only` / `measurement_task` / `implementation_task`
- Codex task generation: measurement prompt, planning prompt, implementation prompt
- Quality signal tracking and scoring
- Post-implementation review via git diff
- Memory retrieval via embeddings + keyword match
- Full V2 loop validated: night_shift â†’ classify â†’ prompt â†’ execute â†’ review â†’ commit
- **V3 â€” Safe Patch generation**: `generate_safe_patch.py` classifies target files and creates a patch proposal in `internal/brain/patches/`
- **V3 â€” Safe Patch review**: `review_safe_patch.py` summarizes the latest patch candidate and recommends next action
- **V3.5 â€” Apply Approved Patch**: `apply_approved_patch.py` applies `brain_safe`/`docs_safe` patches with `--approve`; dry-run by default; refuses product/unsafe patches; requires `## Apply Instructions` section in patch file
- **V5 â€” Product Patch Proposal**: `generate_product_patch_proposal.py` selects best frontend candidate, writes structured proposal + copy-pasteable implementation prompt; `review_product_patch_proposal.py` summarises and recommends next action

- **V6 â€” Product Implementation Handoff Loop**: `generate_handoff_task.py` reads approved proposal, runs 9 safety gates, extracts read-only code context, classifies task, writes `outputs/handoff_task.md`; `review_handoff_task.py` reviews latest record and recommends next action

- **V7 â€” Real Product Benchmark Loop**: Design plan at `outputs/v7_design_plan.md` â€” 13-section benchmark architecture covering latency, RAM, WER, activation stability, first dictation. Phase 1 = manual sessions. Phase 2 = baseline lock + comparison scripts.

- **V7 Phase 1 â€” Manual Benchmark Recorder**: `add_benchmark_observation.py` (CLI recorder) + `review_benchmarks.py` (report generator). Both validated. First observation recorded (`total_dictation_latency_ms = 2400ms`, first_dictation, parakeet, windows_4060). Waiting for â‰¥5 observations per priority metric.

## What Does Not Exist Yet (deferred to Operating Mode)
- `correlate_content_business.py` â€” V9 Phase 2 script (not yet built)
- `compare_content_experiments.py` â€” V9 Phase 3 script (not yet designed)
- `lock_business_baseline.py` â€” V8 Phase 2 script (designed, not yet built)
- `fetch_business_metrics.py` â€” V8 Phase 2 automated pull script (designed, not yet built)
- `correlate_metrics.py` â€” V8 Phase 2 V7Ã—V8 correlation script (designed, not yet built)
- `data/business_baseline.jsonl` â€” V8 locked baseline (not yet created â€” needs real data first)
- `lock_benchmark_baseline.py` â€” V7 Phase 2 script (designed, not yet built)
- `compare_benchmarks.py` â€” V7 Phase 2 script (designed, not yet built)
- `benchmark_baseline.jsonl` â€” V7 locked baseline (not yet created)
- ~~`idle_background_transcription_diagnosis.md`~~ â€” **DONE 2026-04-26**: RC-1 (wake-word, NOT active: wake_word_enabled=false), RC-2 (stuck recording session, CONFIRMED). Next: investigate stop_transcription_action binding_id mismatch â†’ implement defensive sampler timeout.
- Post-fix `paste_latency_ms` benchmarks â€” â‰¥5 observations needed (founder task, after Slack/Teams/Word tests)
- Event tracking â€” no instrumentation in product code (separate task if V10 selects it)

---

## V3 Safety Classes

| Class | Meaning | Patch file created? |
|---|---|---|
| `brain_safe` | Only `internal/brain/` files | Yes â€” Markdown proposal |
| `docs_safe` | Only README/docs/markdown | Yes â€” Markdown proposal |
| `product_proposal_only` | Product code involved | Yes â€” TEXT ONLY, never auto-applied |
| `unsafe` | Forbidden scope detected | No â€” rejection logged |

Forbidden scope (always blocked in V3):
`backend/`, `src-tauri/`, `src/lib/auth/client.ts`, `src/lib/license/client.ts`, payment, billing, security, translation.json

---

## North Star Metric

`successful_dictations_per_active_user_per_week`
Activation event: `first_successful_dictation`
Current baseline: unknown â€” manual observation required

---

## Top Active Quality Risks

1. `activation_failed` retry button added â€” manual test pending (all 5 activation states) â€” MEDIUM
2. Auto-refresh loop (8 Ã— 2500ms) may exhaust before license propagates â€” MEDIUM (retry button now resets counter)
3. `isExpectedMissingLicenseMessage` may silently suppress real errors â€” MEDIUM

## Operating Contract

Future prompts may reference the contract instead of repeating safety rules:
> "Follow `internal/brain/memory/operating_contract.md`."

## Top Recommended Next Actions

1. **OM-1: Complete V12 Phase 5 â€” post-fix benchmarks** (founder â€” no Brain session, ~10 min):
   - Smoke tests DONE (21/21 PASS, 2026-04-27) â€” no more app tests needed
   - Record â‰¥5 post-fix `paste_latency_ms` observations:
     `python internal/brain/scripts/add_benchmark_observation.py --metric paste_latency_ms --value <ms> --unit ms --source manual_founder --notes "post-fix floor=150ms" --period 2026-W17`
   - Re-run agent after â‰¥5 observations â†’ upgrades from PROVISIONAL_KEEP to FULL_KEEP automatically

2. **OM-2: V10 weekly action run** (next Brain session after real data exists):
   - Run `generate_unified_report.py` â†’ review `weekly_action.md` â€” expect RAM or inference loop as next priority
   - This is the standard operating rhythm â€” not a new Brain version

2. **Record real content observations** (after each post â€” founder task):
   - After publishing: `python internal/brain/scripts/add_content_observation.py --platform <p> --content_type <t> --hook "<h>" --niche <n> --target_user "<u>" --cta "<c>" --period <YYYY-Www> --source manual_founder`
   - 24â€“72h later: add `--views`, `--likes`, `--saves`, `--lesson`, `--next_action` to same script with `--record_type performance_update`
   - Review: `python internal/brain/scripts/review_content_performance.py`
   - Snapshot: `python internal/brain/scripts/weekly_content_snapshot.py`

3. **Record real V8 business observations** (10-min weekly session â€” founder task):
   - Open Stripe â†’ record `mrr`, `paid_conversions`, `trial_starts`, `churned_users`, `refunds`
   - Open Supabase â†’ record `account_signups`, `activation_attempts`, `first_successful_dictations`
   - Open Vercel â†’ record `website_visitors`, `downloads`
   - Record each: `python internal/brain/scripts/add_business_observation.py --metric <m> --value <v> --unit <u> --source <s> --period <YYYY-Www>`
   - Review: `python internal/brain/scripts/review_business_metrics.py`

4. **V7 Track B â€” PATCH 1 SHIPPED (2026-04-26):**
   - `idle_background_transcription_diagnosis.md` written â€” RC-2 confirmed (stuck recording)
   - `idle_background_diagnosis_result.md` written â€” wake_word_enabled=false confirmed
   - `stuck_recording_patch_proposal.md` written â€” Option D approved (log first, timeout second)
   - Product commit `0820936`: logging-only diagnostic instrumentation in `transcribe.rs`
     - `stop_transcription_action` entry â†’ `info!`
     - binding_id mismatch guard â†’ `warn!` (silent drop now visible)
     - sampler: warns after 5 min running, logs exit with elapsed + chunk count
   - **Next action (founder):** Run Vocalype until issue reproduces â†’ inspect logs â†’
     confirm Path 2A (no stop sent) vs Path 2B (binding_id mismatch silent drop)
   - **After logs confirm cause:** Authorize Patch 2 (defensive sampler timeout, separate mission)
   - Wake-word silence gate (RC-1 Fix A) valid for future when wake_word_enabled=true

---

## Validated Safety Rules (do not remove)

- `allow_product_code_modifications: false` â€” Brain never writes product code directly
- Night Shift is `proposal_only` â€” cannot apply patches
- `FORBIDDEN_PATTERNS` blocks backend/, src-tauri/, auth/client.ts, license/client.ts
- Scope reduction enforces frontend-first before any implementation prompt
- Score < 25 or risk = high â†’ `planning_only` classification, no implementation
- `measurement_task` classification â†’ plan file only, no product code
- V3: `unsafe` safety class â†’ no patch file generated, rejection logged
- V3: `product_proposal_only` â†’ patch file is text only, never auto-applied
- V3.5: `--approve` required for any write; dry-run by default
- V3.5: requires `## Apply Instructions` section; refuses if missing
- V3.5: resolves and validates absolute path before any write
- `--no-verify` is never used on commits

---

## Model Setup

- CEO / Critic: qwen3:8b
- Coder: qwen2.5-coder:7b
- Embeddings: nomic-embed-text
- Fast: qwen3:4b (fallback: qwen3:8b)
- `keep_alive: 0` on all roles (models unloaded after each call)

---

## Key Files

| Purpose | File |
|---|---|
| Full V2 status report | outputs/v2_status_report.md |
| Activation measurement plan | outputs/measure_activation_failure_points.md |
| Latest Codex task | outputs/codex_task.md |
| Approved task candidates | data/approved_task_candidates.jsonl |
| Safe patch candidates | data/safe_patch_candidates.jsonl |
| Safe patch report | outputs/safe_patch_report.md |
| Apply patch report | outputs/apply_patch_report.md |
| Applied patches log | data/applied_patches.jsonl |
| Product patch proposal | outputs/product_patch_proposal_report.md |
| Product proposals log | data/product_patch_proposals.jsonl |
| V6 design plan | outputs/v6_design_plan.md |
| V6 handoff task | outputs/handoff_task.md |
| V6 handoff tasks log | data/handoff_tasks.jsonl |
| V7 design plan | outputs/v7_design_plan.md |
| V7 benchmark observations | data/benchmark_observations.jsonl |
| V7 benchmark report | outputs/benchmark_report.md |
| V7 bottleneck hypothesis | outputs/v7_bottleneck_hypothesis.md |
| V7 pipeline logs search report | outputs/pipeline_logs_search_report.md |
| V7 paste investigation proposal | outputs/product_patch_proposal_report.md |
| V7 final status report | outputs/v7_final_status_report.md |
| V7 closure report + V8 entry | outputs/v7_closure_report.md |
| V8 design plan | outputs/v8_design_plan.md |
| V8 business observations | data/business_observations.jsonl |
| V8 business metrics report | outputs/business_report.md |
| V8 business baseline (pending) | data/business_baseline.jsonl |
| V8C missing metrics protocol | outputs/v8_missing_metrics_protocol.md |
| V8D weekly business snapshot | outputs/weekly_business_snapshot.md |
| V8 closure report | outputs/v8_closure_report.md |
| **V9 design plan** | **outputs/v9_design_plan.md** |
| V9 content observations | data/content_observations.jsonl |
| V9 content report | outputs/content_report.md |
| V9 weekly content snapshot | outputs/weekly_content_snapshot.md |
| V9 closure report | outputs/v9_closure_report.md |
| **V10 design plan** | **outputs/v10_design_plan.md** |
| V10 unified weekly report | outputs/unified_weekly_report.md |
| V10 weekly action | outputs/weekly_action.md |
| **V10 closure report** | **outputs/v10_closure_report.md** |
| **V11 design plan** | **outputs/v11_design_plan.md** |
| **V11 mission package** | **outputs/v11_mission_package.md** |
| V11 mission package report | outputs/v11_mission_package_report.md |
| V11 execution log | data/v11_execution_log.jsonl |
| **V11 closure report** | **outputs/v11_closure_report.md** |
| Idle background diagnosis | outputs/idle_background_transcription_diagnosis.md |
| Idle background diagnosis result | outputs/idle_background_diagnosis_result.md |
| RC-2 stuck recording patch proposal | outputs/stuck_recording_patch_proposal.md |
| Paste mechanism diagnosis | outputs/paste_mechanism_diagnosis.md |
| Paste utils diagnosis | outputs/paste_utils_diagnosis.md |
| **V12 design plan** | **outputs/v12_design_plan.md** |
| **V12 paste proposal** | **outputs/handoff_task.md** |
| **V12 experiment result** | **outputs/v12_experiment_result.md** |
| **V12 closure report** | **outputs/v12_closure_report.md** |
| Patch proposal files | patches/ |
| Quality signals | data/quality_observations.jsonl |
| Quality report | outputs/quality_report.md |
| Implementation review | outputs/implementation_review.md |
| Wins | memory/wins.md |
| Mistakes | memory/mistakes.md |
| Lessons learned | memory/lessons_learned.md |
| **Operating contract** | **memory/operating_contract.md** |
| Brain config | config/brain.config.json |
