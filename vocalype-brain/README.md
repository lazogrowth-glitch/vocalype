# Vocalype Brain

Vocalype Brain is a local operational intelligence system for improving one SaaS product: Vocalype.

It turns product observations, benchmark data, business metrics, and content performance into a weekly prioritised action — then generates a safe, scoped mission package ready to send to Claude, Codex, or Aider.

---

## ⚡ Mode Opérationnel — Construction V1–V12 terminée

**Le cerveau est construit. Il fonctionne maintenant en Mode Opérationnel.**

Utilise les lanceurs sur ton Bureau Windows. Tu n'as pas besoin de taper des commandes.

### Lanceurs Bureau (double-clique)

| Fichier | Ce que ça fait |
|---|---|
| **`Lancer Agent Vocalype Auto.bat`** | **Bouton principal intelligent** : cycle complet + classification auto + routage (local / DeepSeek / Claude) |
| `Lancer Vocalype Brain.bat` | Cycle manuel : rapport unifié + package mission + ouvre les deux fichiers |
| `Voir Action du Robot.bat` | Ouvre directement `weekly_action.md` — l'action prioritaire de la semaine |
| `Generer Mission Claude.bat` | Génère le package mission V11 et l'ouvre — prêt à coller dans Claude / Codex |
| `Enregistrer Resultat.bat` | Lance tous les scripts de review et ouvre les rapports |
| `Voir Rapports Vocalype Brain.bat` | Ouvre tous les rapports disponibles (benchmarks, business, contenu, résultats) |
| `Stop Vocalype Brain.bat` | Rappelle qu'il n'y a pas de daemon — ferme les fenêtres terminal manuellement |
| `Creer Context DeepSeek.bat` | Prépare `context_pack.md` manuellement pour DeepSeek ou Claude |

### Rythme hebdomadaire (Mode Opérationnel)

```
Lundi       : enregistrer métriques V8 (Stripe / Supabase / Vercel, 10 min)
Après post  : enregistrer observation V9 (contenu + performance 24-72h après)
N'importe quand : double-clic "Lancer Agent Vocalype Auto.bat"
                  -> classe l'action -> route vers le bon outil -> ouvre les rapports
Après exécution : "Enregistrer Résultat.bat" -> review + commit
```

### Agent Auto — Routage intelligent

"Lancer Agent Vocalype Auto" est le bouton principal. Il fait tout automatiquement :

1. Lance le cycle Brain (rapport unifié + package mission)
2. Lit `weekly_action.md` et classifie l'action
3. Route vers le bon outil :
   - **Routine / rapport** → outils locaux uniquement, rien ne quitte la machine
   - **Raisonnement long-contexte** → DeepSeek (si configuré et autorisé) ou instructions pour Claude manuel
   - **Implémentation produit sensible** → package mission Claude/Codex, jamais automatique

**Mode externe** (`VOCALYPE_BRAIN_EXTERNAL_MODE`) :
- `off` → jamais d'API externe, prépare `context_pack.md` seulement
- `confirm` → **(défaut)** prépare `context_pack.md` + instructions fondateur, n'appelle PAS l'API
- `auto` → appelle DeepSeek pour les tâches `long_reasoning` si `DEEPSEEK_API_KEY` est configuré

Le code produit n'est **jamais** modifié automatiquement par ce routeur.

### Ce que le cerveau N'EST PAS

Vocalype Brain n'est **pas** une ASI autonome, pas un CEO robot H24, pas un agent qui tourne en fond.

C'est un **système d'exploitation pour une boucle** :

```
mesurer → décider → mission → exécuter → analyser → apprendre
```

Chaque script se lance, fait son travail, et s'arrête. Tu restes aux commandes.

### Routage des modèles

| Modèle | Tâches | Données envoyées |
|---|---|---|
| **Ollama local** (qwen3:8b, qwen2.5-coder:7b) | Rapports, résumés, priorités, génération missions | Rien ne quitte ta machine |
| **DeepSeek Flash** (si `DEEPSEEK_API_KEY` configuré) | Raisonnement long-contexte, analyse multi-fichiers | Seulement `context_pack.md` (mémoire Brain uniquement) |
| **Claude / Codex / Aider** | Implémentation produit sensible — Rust, auth, paiement | Seulement `v11_mission_package.md` — toujours copié/collé manuellement |

Le cerveau génère le package mission. Toi, tu choisis quel modèle l'exécute.

**Clés API :** jamais commises dans git. Configure `DEEPSEEK_API_KEY` comme variable d'environnement Windows ou dans un `.env` local exclu du dépôt. Vérifie avec `Creer Context DeepSeek.bat`.

```bash
# Vérifier la configuration DeepSeek
python vocalype-brain/scripts/check_deepseek_setup.py

# Construire le pack de contexte pour modèle externe
python vocalype-brain/scripts/build_context_pack.py

# Recommandation de routage
python vocalype-brain/scripts/model_route_decision.py --task-type long_reasoning
```

---

## What It Is Not

Vocalype Brain is not a general AI or autonomous ASI.

It is a local operational intelligence system designed to compound improvements for one SaaS product: Vocalype.

The goal is weekly execution, not abstract intelligence.

It does not require paid APIs. The core uses Markdown, JSON, JSONL, and standard-library Python scripts.

## Core Rule

Every recommendation must be measurable and directly improve Vocalype.

Each useful action should include:

- Problem
- Why it matters
- Expected business impact
- Difficulty
- Files or areas affected
- Proposed action
- Validation test
- Metric to measure
- Priority score

Ideas that do not improve Vocalype product, models, UX, distribution, revenue, trust, or retention should be rejected.

## Daily Usage

Run from the Vocalype repo root:

```bash
python vocalype-brain/scripts/daily.py
```

This scores `vocalype-brain/data/actions.jsonl`, selects the top 5 actions, and writes:

```txt
vocalype-brain/outputs/daily_actions.md
```

Use that report to choose the day's execution focus. Do not work on more than 5 Brain actions per day.

## Add Feedback

```bash
python vocalype-brain/scripts/add_feedback.py "User says the license activation is confusing"
```

This appends a classified item to:

```txt
vocalype-brain/data/feedback.jsonl
```

The script uses simple keyword logic. Repeated feedback should become an action or experiment.

## Add Experiments

Run:

```bash
python vocalype-brain/scripts/add_experiment.py
```

The script asks for:

- Experiment name
- Hypothesis
- Change
- Metric
- Start date
- End date
- Success condition

It appends to:

```txt
vocalype-brain/data/experiments.jsonl
```

Review experiments with:

```bash
python vocalype-brain/scripts/review_experiments.py
```

This writes:

```txt
vocalype-brain/outputs/weekly_review.md
```

## Generate Content Ideas

```bash
python vocalype-brain/scripts/generate_content_ideas.py
```

This generates at least 50 demo-based ideas for TikTok, Reels, YouTube Shorts, X, and LinkedIn.

Output:

```txt
vocalype-brain/outputs/growth_report.md
```

Prioritize content where the viewer sees Vocalype turning speech into text inside a real app.

## Use Model Benchmarks

```bash
python vocalype-brain/scripts/model_benchmark_template.py
```

This creates:

```txt
vocalype-brain/outputs/model_report.md
vocalype-brain/data/benchmarks.jsonl
```

Manually fill in benchmark rows with actual output, latency, RAM, CPU, GPU, WER estimate, and notes.

Use the same microphone, test sentence, and machine conditions when comparing models.

## Score Actions

```bash
python vocalype-brain/scripts/score_actions.py
```

Scoring uses:

```txt
vocalype-brain/config/scoring.config.json
```

Formula:

```txt
priority_score = impact_weight + urgency_bonus - difficulty_penalty
```

Bonuses:

- First successful dictation: +25
- Payment conversion: +20
- Distribution: +15

Penalties:

- Not measurable: -50
- Unrelated to Vocalype: score 0 and rejected

## Local LLM Orchestrator

Vocalype Brain can optionally use a local Ollama model as a controlled assistant.

It still works without Ollama. If Ollama is unavailable, the scripts fall back to template-based logic and do not crash.

Default config:

```txt
vocalype-brain/config/brain.config.json
```

The default local setup is:

```txt
Main brain: qwen3:8b
Code brain: qwen2.5-coder:7b
Embeddings: nomic-embed-text
```

Install them with:

```bash
ollama pull qwen3:8b
ollama pull qwen2.5-coder:7b
ollama pull nomic-embed-text
```

You can change them in `local_llm.main_model`, `local_llm.code_model`, and `local_llm.embedding_model`.

## Multi-model routing

Vocalype Brain can route different tasks to different local models without trying to keep every model loaded at once.

Roles:

- `ceo`: strategic reasoning, prioritization, daily decisions, Night Shift proposals
- `coder`: code analysis, diff review, Codex task generation, implementation review
- `critic`: scope review, safety review, risk detection, sensitive-file detection
- `embeddings`: memory retrieval and future semantic search
- `fast`: quick classification, triage, and simple summaries

Default role mapping:

- `ceo` -> `qwen3:8b`
- `coder` -> `qwen2.5-coder:7b`
- `critic` -> `qwen3:8b`
- `embeddings` -> `nomic-embed-text`
- `fast` -> `qwen3:4b`, with fallback to `qwen3:8b`

Why models are not all loaded at once:

- smaller VRAM footprint
- cleaner role separation
- less chance of keeping multiple heavy models resident by accident
- easier fallback when a specialty model is missing

The router uses `keep_alive: 0` so Ollama can unload models instead of keeping several heavy models warm by default.

Pull models with:

```bash
ollama pull qwen3:8b
ollama pull qwen2.5-coder:7b
ollama pull nomic-embed-text
ollama pull qwen3:4b
```

Validate the setup with:

```bash
python vocalype-brain/scripts/model_router.py
```

Run from repo root:

```bash
python vocalype-brain/scripts/orchestrator.py daily
python vocalype-brain/scripts/orchestrator.py ask "What should we improve today in Vocalype?"
python vocalype-brain/scripts/orchestrator.py growth
python vocalype-brain/scripts/orchestrator.py product
python vocalype-brain/scripts/orchestrator.py self-improve
```

Modes:

- `daily`: proposes safe daily actions, scores actions, and writes `outputs/daily_actions.md`.
- `ask`: answers founder questions using Brain memory and rejects unrelated distractions.
- `growth`: generates demo-led content ideas using the growth playbook.
- `product`: proposes measurable product improvement actions and appends them to `data/actions.jsonl`.
- `self-improve`: proposes safe improvements to Brain prompts, playbooks, reports, templates, and memory.

## Context Specialization

Vocalype Brain is not retrained or fine-tuned.

The model keeps its general reasoning ability, but Vocalype-specific facts should come from retrieved Brain memory, repo inspection, metrics, or user-provided data.

This keeps prompts smaller, reduces hallucinations, and helps the local model behave like a Vocalype specialist instead of a generic chatbot.

Context workflow:

1. Index Brain memory into lightweight chunks.
2. Retrieve only the most relevant chunks for the current question.
3. Build a compact context block before the local LLM call.
4. Ask the model to cite memory files used and state confidence.

Run:

```bash
python vocalype-brain/scripts/index_memory.py
python vocalype-brain/scripts/retrieve_context.py "license activation"
python vocalype-brain/scripts/orchestrator.py ask "What should I improve today?"
```

Key rules:

- The model can use general knowledge for reasoning support.
- Product-specific claims about Vocalype should come from retrieved evidence.
- If no evidence was retrieved, confidence should be low.
- Retrieve concise relevant context, not the entire memory folder.

## Night Shift Mode

Night Shift is the first controlled autonomous work loop for Vocalype Brain.

Run:

```bash
python vocalype-brain/scripts/night_shift.py
python vocalype-brain/scripts/review_night_shift.py
```

What it does:

- runs a limited number of cycles
- builds retrieved context before each cycle
- inspects Brain memory and safe repo files in read-only mode
- proposes measurable improvements
- scores them
- logs cycle results to JSONL
- creates proposed patch records as text only
- writes a morning report

What it does not do:

- modify product code directly
- deploy anything
- delete files
- run arbitrary shell commands
- spend money
- publish content
- loosen safety settings

Default config:

```json
"night_shift": {
  "enabled": true,
  "max_cycles": 5,
  "max_runtime_minutes": 60,
  "mode": "proposal_only",
  "allow_product_code_writes": false,
  "allow_patch_files": true,
  "allow_tests": false
}
```

Outputs:

- `vocalype-brain/data/night_shift_runs.jsonl`
- `vocalype-brain/data/proposed_patches.jsonl`
- `vocalype-brain/outputs/night_shift_report.md`

## Performance And Quality Loop

Vocalype Brain can also track product quality signals without modifying product code.

Run:

```bash
python vocalype-brain/scripts/add_quality_observation.py "Dictation feels slow on first run"
python vocalype-brain/scripts/performance_quality_loop.py
python vocalype-brain/scripts/review_quality.py
```

Files used:

- `vocalype-brain/memory/quality_playbook.md`
- `vocalype-brain/data/quality_observations.jsonl`
- `vocalype-brain/data/performance_metrics.jsonl`
- `vocalype-brain/outputs/quality_report.md`

This loop helps turn fuzzy quality complaints into:

- a metric
- a baseline
- a target
- a validation method
- a next step

It does not add instrumentation yet. It only creates the measurement structure and reporting loop.

## Post-Implementation Review Loop

Vocalype Brain can review what was actually implemented and turn that into reusable lessons.

Run:

```bash
python vocalype-brain/scripts/review_implementation.py
python vocalype-brain/scripts/review_results.py
```

Manual result entry:

```bash
python vocalype-brain/scripts/record_result.py
```

Files used:

- `vocalype-brain/data/results.jsonl`
- `vocalype-brain/outputs/implementation_review.md`
- `vocalype-brain/outputs/results_report.md`
- `vocalype-brain/memory/lessons_learned.md`
- `vocalype-brain/memory/wins.md`
- `vocalype-brain/memory/mistakes.md`

Safety:

- reads git status and git diff only
- does not commit
- does not reset
- does not checkout
- does not modify product code
- writes only inside `vocalype-brain`

## Approved Task Executor

V2 can turn Night Shift proposals into a narrower, ready-to-send Codex prompt.

Run:

```bash
python vocalype-brain/scripts/create_codex_task.py
```

Outputs:

- `vocalype-brain/outputs/codex_task.md`
- `vocalype-brain/data/approved_task_candidates.jsonl`

How it works:

- reads recent Night Shift proposals and proposed patches
- reads results, lessons, wins, mistakes, founder rules, and the latest quality report when present
- classifies each proposal into one of three task types before generating the prompt
- prefers low-risk, high-impact tasks with clear validation
- reduces scope when V1 lessons show the original proposal was too broad
- prefers frontend-only scope first for UI clarity work
- warns when the current git worktree already contains unrelated product changes
- uses the `coder` model to draft the task prompt and the `critic` model to review scope and safety when local routing is available
- falls back to deterministic prompt generation when Ollama or the routed model is unavailable

Task types:

- `planning_only` — vague, high-risk, or no concrete behavior change. Generates a clarification prompt only. No product code modifications.
- `measurement_task` — proposal intent is to measure, track, observe, or map failure points. Generates a measurement plan prompt. No product code modifications yet.
- `implementation_task` — concrete code or UI behavior change with clear approved scope, validation test, and low/medium risk.

The `task_type` field is written to both `codex_task.md` and `approved_task_candidates.jsonl`.

Safety:

- does not modify product code
- does not apply patches
- does not auto-approve high-risk work
- measurement and planning proposals never become implementation tasks
- generates a clarification/planning prompt when the available proposals are too risky or too vague

## V3 Safe Patch Mode

V3 allows Brain to prepare safe patch proposals without modifying product code automatically.

Every patch is a Markdown proposal file. No patch is applied automatically. Founder approval is always required before product files are touched.

Run:

```bash
python vocalype-brain/scripts/generate_safe_patch.py
python vocalype-brain/scripts/review_safe_patch.py
```

Outputs:

- `vocalype-brain/patches/patch_YYYYMMDD_HHMMSS_<slug>.md` — patch proposal file
- `vocalype-brain/outputs/safe_patch_report.md` — latest patch summary
- `vocalype-brain/data/safe_patch_candidates.jsonl` — full patch history

Safety classes:

| Class | Meaning | Auto-apply? |
|---|---|---|
| `brain_safe` | Only `vocalype-brain/` files targeted | No |
| `docs_safe` | Only README/docs/markdown files | No |
| `product_proposal_only` | Product code involved | **Never** |
| `unsafe` | Forbidden scope detected | No patch generated |

How it works:

- reads `codex_task.md` and `approved_task_candidates.jsonl` to identify the current task
- classifies the target files into a safety class
- if `brain_safe` or `docs_safe`: generates a patch proposal file in `vocalype-brain/patches/`
- if `product_proposal_only`: generates a text-only proposal — no product file is written
- if `unsafe`: logs the rejection reason and writes no patch file
- appends a record to `safe_patch_candidates.jsonl`
- writes a summary to `safe_patch_report.md`

Forbidden scope (always blocked):

- `backend/`
- `src-tauri/`
- `src/lib/auth/client.ts`
- `src/lib/license/client.ts`
- payment, billing, security logic
- Rust runtime
- translation files

Safety:

- does not modify product code
- does not apply patches automatically
- does not commit automatically
- does not use `--no-verify`
- does not deploy
- writes only to `vocalype-brain/`

## V3.5 Apply Approved Patch Mode

V3.5 adds a controlled approval step that can apply `brain_safe` or `docs_safe` patches after explicit founder approval.

**This is NOT product-code autonomy.** Only Brain memory/docs/output files may be written. Product code is never touched.

Run:

```bash
# Dry run (default — no files modified)
python vocalype-brain/scripts/apply_approved_patch.py

# Apply (requires explicit flag)
python vocalype-brain/scripts/apply_approved_patch.py --approve
```

Outputs:

- `vocalype-brain/outputs/apply_patch_report.md` — apply result
- `vocalype-brain/data/applied_patches.jsonl` — application history

How it works:

- reads the latest `safe_patch_candidates.jsonl` entry and its patch file
- in dry-run mode: prints a full summary of what would happen, touches nothing
- in `--approve` mode: applies only if `safety_class` is `brain_safe` or `docs_safe`
- refuses `product_proposal_only` and `unsafe` patches unconditionally
- requires an explicit `## Apply Instructions` section in the patch file with `target_file:`, `operation:`, and `content:` fields
- if no Apply Instructions section exists, refuses and says manual implementation required
- validates target file against an allowlist before writing
- logs every attempt (dry-run and apply) to `applied_patches.jsonl`

Apply Instructions format (add to a patch file to make it applyable):

```markdown
## Apply Instructions

target_file: vocalype-brain/memory/some_file.md
operation: append
content:
- New line to append
- Another line
```

Supported operations: `append`, `create`.

Allowed target files:

- anything inside `vocalype-brain/`
- `README` files
- `docs/` files
- `CHANGELOG`, `CONTRIBUTING`

Forbidden target files (always blocked, even with `--approve`):

- `src/`
- `src-tauri/`
- `backend/`
- paths containing: `auth`, `license`, `payment`, `security`, `runtime`, `secrets`, `.env`, `translation.json`

Safety:

- dry-run by default — `--approve` required for any write
- refuses `product_proposal_only` and `unsafe` patches
- refuses patches with no Apply Instructions
- resolves and checks the absolute path before writing
- no file deletion
- no auto-commit
- no `--no-verify`
- no deployment

## V5 Product Patch Proposal Mode

V5 allows Brain to prepare structured product-code change proposals with a copy-pasteable implementation prompt. Product code is never modified automatically. Founder approval is always required before sending the prompt to an implementation model.

Run:

```bash
python vocalype-brain/scripts/generate_product_patch_proposal.py
python vocalype-brain/scripts/review_product_patch_proposal.py
```

Outputs:

- `vocalype-brain/outputs/product_patch_proposal_report.md` — full proposal with implementation prompt
- `vocalype-brain/data/product_patch_proposals.jsonl` — proposal history

How it works:

- reads Night Shift runs, the measurement plan (if present), and approved task candidates
- filters out any proposals touching forbidden files (backend, src-tauri, auth/license clients, payment, Rust)
- prefers measurement plan recommendations over raw Night Shift runs (post-analysis is more precise)
- scores candidates by risk, impact, and validation clarity
- generates a structured proposal record and a markdown report
- the report's "Exact Prompt For Claude/Codex" section is ready to copy-paste to an implementation model but includes strict scope and safety constraints

Safety:

- does not modify product code
- does not apply patches
- does not edit src/, backend/, src-tauri/, or any auth/license/payment/security/Rust files
- `sensitive_files_involved` flag is set if any target file is in a sensitive path
- `manual_approval_required: true` on every record
- proposal must be reviewed by founder before being sent to an implementation model

## Local LLM Safety

The orchestrator is intentionally limited.

Hard rules:

- It cannot execute arbitrary shell commands.
- It cannot write outside `vocalype-brain`.
- It cannot modify Vocalype product code in autonomous mode.
- It cannot delete files.
- It cannot change safety config automatically.
- It cannot remove founder focus rules.
- It logs every safe tool call to `data/tool_calls.jsonl`.
- It must produce measurable actions.
- It must reject unrelated ideas.

Default safety config requires human approval:

```json
{
  "allow_code_writes": false,
  "allow_shell_commands": false,
  "allow_product_code_modifications": false,
  "require_human_approval": true
}
```

## Safe Tools

The safe tool layer lives in:

```txt
vocalype-brain/scripts/tools.py
```

Allowed tool behavior:

- Read and write only approved files in `memory/`
- Append only to approved JSONL files in `data/`
- Save scored actions
- Generate daily reports
- Add feedback
- Create experiments
- Propose a repo audit task

There is no arbitrary file write tool and no shell command tool.

## Self-Improvement

Run:

```bash
python vocalype-brain/scripts/self_improvement.py
```

This writes:

```txt
vocalype-brain/data/self_improvements.jsonl
vocalype-brain/outputs/improvement_proposals.md
```

Self-improvement can propose changes to prompts, playbooks, scoring, memory, report templates, and benchmark templates.

It cannot modify product code, remove focus rules, disable safety settings, or auto-apply high-risk changes.

## Extend Agents

Agent prompt files live in:

```txt
vocalype-brain/agents/
```

Edit these Markdown files when you want sharper instructions:

- `product_agent.md`
- `model_agent.md`
- `growth_agent.md`
- `saas_agent.md`
- `focus_guard_agent.md`
- `critic_agent.md`
- `self_improvement_agent.md`

Do not turn V1 into an autonomous multi-agent system. Keep prompts practical and manually usable.

## Keep Focus

Before adding an action, ask:

- Does this directly improve Vocalype?
- Can it improve activation, usage, trust, conversion, revenue, retention, or distribution?
- Can it be validated this week?
- Is the metric clear?

If the answer is no, delay or reject the idea.
