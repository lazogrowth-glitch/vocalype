# Vocalype Night Robot

Autonomous engineering agent that improves transcription quality through
measurement-driven, reversible changes.

## What it does

Each cycle:
1. Scans the repo for transcription-related files
2. Runs baseline benchmarks
3. Asks the LLM to identify one failure mode and one hypothesis
4. Proposes one small patch (max 3 files, 150 lines)
5. Validates the patch against forbidden-path rules
6. Applies the patch with `git apply`
7. Runs post-patch checks
8. Judges before/after — accepts only if tests pass and benchmark improves
9. Commits if accepted, rolls back if rejected
10. Saves a lesson to persistent memory

## Requirements

```
pip install httpx
```

The NVIDIA fallback proxy must be running:
```
python nvidia_fallback_proxy.py
```

## Commands

```bash
# Check status
python vocalype-night-robot/scripts/night_robot.py status

# Run benchmarks only (no LLM, no changes)
python vocalype-night-robot/scripts/night_robot.py benchmark

# Plan only — analyze and propose, no changes applied
python vocalype-night-robot/scripts/night_robot.py plan

# Run 3 autonomous improvement cycles
python vocalype-night-robot/scripts/night_robot.py run --cycles 3

# Run 10 cycles with strict size limits
python vocalype-night-robot/scripts/night_robot.py run --cycles 10 --max-files 3 --max-lines 150

# Roll back the last accepted robot commit
python vocalype-night-robot/scripts/night_robot.py rollback-last
```

## Configuration

Edit `vocalype-night-robot/config/robot_config.json`.

Key settings:

| Key | Default | Description |
|-----|---------|-------------|
| `proxy_url` | `http://127.0.0.1:8000/v1/chat/completions` | LLM proxy endpoint |
| `temperature` | `0.15` | LLM temperature (low = deterministic) |
| `max_patch_files` | `3` | Max files per patch |
| `max_patch_lines` | `150` | Max changed lines per patch |
| `commands.typescript_check` | `npx tsc --noEmit` | TypeScript check command |
| `commands.benchmark` | `""` | Benchmark command (empty = skipped) |
| `commands.transcription_benchmark` | `""` | STT-specific benchmark command |

### Adding a benchmark

Set `commands.transcription_benchmark` to a script that exits 0 on success
and prints a score to stdout. Example:

```json
"commands": {
  "typescript_check": "npx tsc --noEmit",
  "transcription_benchmark": "python scripts/run_wer_benchmark.py"
}
```

Without a real benchmark, the robot will only accept measurement/logging/
docs/infrastructure changes — it will reject behavior changes.

## Safety rules

The robot will never touch:
- `.env`, `.env.local`, `.env.production`
- Any file with `secret`, `auth`, `payment`, `license` in the path
- `node_modules/`, `target/`, `dist/`, `.git/`
- `src-tauri/src/security/`

It only modifies files that contain at least one of:
`transcription`, `stt`, `speech`, `audio`, `chunk`, `buffer`,
`vad`, `silence`, `whisper`, `parakeet`, `moonshine`, `sensevoice`,
`postprocess`, `latency`, `benchmark`

## Outputs

| Path | Contents |
|------|----------|
| `data/reports/` | One Markdown report per cycle |
| `data/patches/` | Every proposed diff saved as `.diff` |
| `data/runs/` | Raw benchmark JSON for every run |
| `data/memory/lessons.jsonl` | Persistent lessons across sessions |

## Folder structure

```
vocalype-night-robot/
  config/
    robot_config.json
  data/
    runs/          ← benchmark JSON
    memory/        ← lessons.jsonl
    reports/       ← per-cycle Markdown reports
    patches/       ← proposed diffs
  prompts/
    system_prompt.md
    analyze_failure_prompt.md
    propose_patch_prompt.md
    apply_patch_prompt.md
    judge_result_prompt.md
    reflection_prompt.md
  scripts/
    night_robot.py       ← main entry point
    llm_client.py        ← httpx LLM caller
    repo_guard.py        ← forbidden path enforcement
    repo_scanner.py      ← transcription file discovery
    benchmark_runner.py  ← command runner + result saver
    patch_planner.py     ← LLM analysis + proposal
    patch_applier.py     ← git apply wrapper
    result_judge.py      ← before/after comparison
    memory_store.py      ← lessons.jsonl CRUD
    utils.py             ← timestamp, run_command, logging
```
