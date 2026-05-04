#!/usr/bin/env python3
"""Vocalype Night Robot — Autonomous transcription improvement agent.

Usage:
  python vocalype-night-robot/scripts/night_robot.py status
  python vocalype-night-robot/scripts/night_robot.py benchmark
  python vocalype-night-robot/scripts/night_robot.py plan
  python vocalype-night-robot/scripts/night_robot.py run --cycles 3
  python vocalype-night-robot/scripts/night_robot.py run --cycles 10 --max-files 3 --max-lines 150
  python vocalype-night-robot/scripts/night_robot.py rollback-last
"""

import argparse
import json
import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

# Add scripts dir to import path
_SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_SCRIPTS_DIR))

from benchmark_runner import BenchmarkRunner
from llm_client import LLMClient
from memory_store import MemoryStore
from patch_applier import PatchApplier
from patch_planner import PatchPlanner
from repo_guard import RepoGuard
from repo_scanner import RepoScanner
from result_judge import ResultJudge
from utils import run_command, setup_logging, timestamp

_ROBOT_DIR = _SCRIPTS_DIR.parent
_REPO_ROOT = _ROBOT_DIR.parent
_CONFIG_PATH = _ROBOT_DIR / "config" / "robot_config.json"
_DATA_DIR = _ROBOT_DIR / "data"
_PROMPTS_DIR = _ROBOT_DIR / "prompts"


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def load_config() -> dict:
    if not _CONFIG_PATH.exists():
        raise FileNotFoundError(
            f"Config not found: {_CONFIG_PATH}\n"
            "Run from the repo root: python vocalype-night-robot/scripts/night_robot.py ..."
        )
    return json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Git helpers
# ---------------------------------------------------------------------------

def git_status(repo_root: Path) -> Dict:
    _, dirty_out, _ = run_command("git status --porcelain", cwd=repo_root)
    _, branch, _ = run_command("git branch --show-current", cwd=repo_root)
    _, last_commit, _ = run_command("git log -1 --oneline", cwd=repo_root)
    return {
        "is_dirty": bool(dirty_out.strip()),
        "dirty_files": dirty_out.strip(),
        "branch": branch.strip(),
        "last_commit": last_commit.strip(),
    }


def create_experiment_branch(repo_root: Path, prefix: str) -> str:
    branch = f"{prefix}-{timestamp()}"
    code, _, stderr = run_command(f"git checkout -b {branch}", cwd=repo_root)
    if code != 0:
        raise RuntimeError(f"Failed to create branch '{branch}': {stderr.strip()}")
    logging.info(f"Created branch: {branch}")
    return branch


def save_report(lines: List[str], cycle_num: int) -> Path:
    reports_dir = _DATA_DIR / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    path = reports_dir / f"{timestamp()}_cycle_{cycle_num}_report.md"
    path.write_text("\n".join(lines), encoding="utf-8")
    logging.info(f"Report saved: {path.name}")
    return path


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_status(args: argparse.Namespace, config: dict) -> None:
    setup_logging()
    gs = git_status(_REPO_ROOT)
    memory = MemoryStore(_DATA_DIR / "memory")
    recent = memory.load_recent(1)
    reports = sorted((_DATA_DIR / "reports").glob("*.md"), reverse=True)

    print("\n=== Vocalype Night Robot — Status ===")
    print(f"  Branch      : {gs['branch']}")
    print(f"  Git status  : {'DIRTY' if gs['is_dirty'] else 'clean'}")
    print(f"  Proxy URL   : {config['proxy_url']}")
    print(f"  Config      : {_CONFIG_PATH}")
    print(f"  Last report : {reports[0].name if reports else 'none'}")
    if recent:
        last = recent[0]
        print(
            f"  Last change : Cycle {last.get('cycle')} — "
            f"{last.get('verdict')} — {str(last.get('saved_at', ''))[:10]}"
        )
    else:
        print("  Last change : none")

    llm = LLMClient(config["proxy_url"])
    reachable = llm.ping()
    print(f"  Proxy ping  : {'OK' if reachable else 'UNREACHABLE — start nvidia_fallback_proxy.py'}")
    print()


def cmd_benchmark(args: argparse.Namespace, config: dict) -> None:
    setup_logging()
    runner = BenchmarkRunner(config, _REPO_ROOT, _DATA_DIR)
    results = runner.run_all("manual")
    print("\n" + runner.format_summary(results))


def cmd_plan(args: argparse.Namespace, config: dict) -> None:
    setup_logging()
    llm = LLMClient(config["proxy_url"], config["temperature"], config["max_tokens"])
    guard = RepoGuard(config, _REPO_ROOT)
    scanner = RepoScanner(_REPO_ROOT, guard)
    runner = BenchmarkRunner(config, _REPO_ROOT, _DATA_DIR)
    memory = MemoryStore(_DATA_DIR / "memory")
    planner = PatchPlanner(llm, _PROMPTS_DIR, config)

    print("Scanning repo...")
    scan = scanner.scan(max_files=25)
    repo_ctx = scanner.format_for_prompt(scan)
    print(f"  Found {scan['total_found']} transcription-related files.")

    print("Running baseline benchmarks...")
    baseline = runner.run_all("plan-baseline")
    bench_summary = runner.format_summary(baseline)
    print(bench_summary)

    print("\nAsking LLM to analyze...")
    recent = memory.load_recent(5)
    mem_ctx = memory.format_for_prompt(recent)
    analysis = planner.analyze_failures(repo_ctx, bench_summary, mem_ctx)
    print("\n=== Analysis ===")
    print(analysis)

    print("\n=== Proposing patch (plan only, no changes applied) ===")
    plan = planner.propose_patch(analysis, repo_ctx)
    print(json.dumps(plan, indent=2))


def cmd_rollback_last(args: argparse.Namespace, config: dict) -> None:
    setup_logging()
    code, log, _ = run_command(
        'git log --oneline --grep="robot: improve transcription" -1',
        cwd=_REPO_ROOT,
    )
    if not log.strip():
        print("No robot commit found to roll back.")
        return

    commit_hash = log.strip().split()[0]
    commit_msg = log.strip()
    print(f"Found robot commit: {commit_msg}")
    print(f"Reverting: git revert {commit_hash} --no-edit")

    code, stdout, stderr = run_command(
        f"git revert {commit_hash} --no-edit",
        cwd=_REPO_ROOT,
    )
    if code == 0:
        print("Rollback successful.")
    else:
        print(f"Rollback failed:\n{stderr.strip()}")


# ---------------------------------------------------------------------------
# Cycle
# ---------------------------------------------------------------------------

def run_single_cycle(
    cycle_num: int,
    config: dict,
    llm: LLMClient,
    guard: RepoGuard,
    scanner: RepoScanner,
    runner: BenchmarkRunner,
    planner: PatchPlanner,
    applier: PatchApplier,
    judge: ResultJudge,
    memory: MemoryStore,
    max_files: int,
    max_lines: int,
) -> Dict:
    sep = "=" * 60
    logging.info(f"\n{sep}\nCYCLE {cycle_num} START\n{sep}")

    report: List[str] = [
        f"# Night Robot — Cycle {cycle_num}",
        f"**Date**: {datetime.now().isoformat()}",
        f"**Repo**: {_REPO_ROOT}",
    ]
    cycle_data: Dict = {"cycle": cycle_num}

    # ── 1. Scan ──────────────────────────────────────────────────────────────
    logging.info("Scanning repo...")
    scan = scanner.scan(max_files=max_files * 8)
    repo_ctx = scanner.format_for_prompt(scan)
    report.append(
        f"\n## Repo Scan\n{scan['total_found']} transcription-related files found."
    )

    # ── 2. Baseline ──────────────────────────────────────────────────────────
    logging.info("Running baseline benchmarks...")
    baseline = runner.run_all(f"cycle_{cycle_num}_baseline")
    bench_summary = runner.format_summary(baseline)
    report.append(f"\n## Baseline\n{bench_summary}")
    cycle_data["baseline"] = baseline

    # ── 3. Analyze ───────────────────────────────────────────────────────────
    logging.info("Analyzing failures...")
    recent = memory.load_recent(5)
    mem_ctx = memory.format_for_prompt(recent)
    analysis = planner.analyze_failures(repo_ctx, bench_summary, mem_ctx)
    report.append(f"\n## Analysis\n{analysis}")
    cycle_data["analysis"] = analysis[:500]

    # ── 4. Propose ───────────────────────────────────────────────────────────
    logging.info("Proposing patch...")
    plan = planner.propose_patch(analysis, repo_ctx)
    report.append(f"\n## Patch Plan\n```json\n{json.dumps(plan, indent=2)}\n```")
    cycle_data["plan"] = plan

    if plan.get("skip"):
        reason = plan.get("reason", "")
        logging.info(f"Skipping cycle: {reason}")
        report.append(f"\n## Result\n**SKIPPED**: {reason}")
        verdict = "SKIPPED"
        cycle_data["verdict"] = verdict
        save_report(report, cycle_num)
        memory.save_lesson({
            **cycle_data,
            "hypothesis": analysis[:200],
            "files_touched": [],
            "lesson": f"Skipped: {reason}",
        })
        return cycle_data

    # ── 5. Guard check ───────────────────────────────────────────────────────
    files = plan.get("files_to_modify", [])
    ok, violations = guard.validate_patch_files(files)
    if not ok:
        msg = f"Forbidden files in patch plan: {violations}"
        logging.warning(msg)
        report.append(f"\n## Result\n**REJECTED (GUARD)**: {msg}")
        cycle_data["verdict"] = "REJECTED_GUARD"
        save_report(report, cycle_num)
        memory.save_lesson({
            **cycle_data,
            "hypothesis": analysis[:200],
            "files_touched": [],
            "lesson": f"Guard rejected forbidden files: {violations}",
        })
        return cycle_data

    if len(files) > max_files:
        msg = f"Plan touches {len(files)} files, limit is {max_files}"
        logging.warning(msg)
        report.append(f"\n## Result\n**REJECTED (SIZE)**: {msg}")
        cycle_data["verdict"] = "REJECTED_SIZE"
        save_report(report, cycle_num)
        return cycle_data

    # ── 6. Get diff ──────────────────────────────────────────────────────────
    diff = plan.get("unified_diff", "").strip()
    if len(diff) < 20:
        logging.info("No usable diff in plan — asking LLM to produce one...")
        diff = planner.produce_diff(plan, repo_ctx)

    changed_lines = [
        l for l in diff.splitlines()
        if l.startswith("+") or l.startswith("-")
        if not l.startswith("---") and not l.startswith("+++")
    ]
    if len(changed_lines) > max_lines:
        msg = f"Diff has {len(changed_lines)} changed lines, limit is {max_lines}"
        logging.warning(msg)
        report.append(f"\n## Result\n**REJECTED (LINES)**: {msg}")
        cycle_data["verdict"] = "REJECTED_SIZE"
        save_report(report, cycle_num)
        return cycle_data

    report.append(
        f"\n## Diff\n```diff\n{diff[:3000]}\n```"
        + ("" if len(diff) <= 3000 else "\n... [diff truncated in report]")
    )

    # ── 7. Apply ─────────────────────────────────────────────────────────────
    logging.info("Applying patch...")
    applied, apply_msg = applier.apply(diff, cycle_num)
    report.append(
        f"\n## Patch Application\n{'Applied OK' if applied else f'FAILED: {apply_msg}'}"
    )
    cycle_data["patch_applied"] = applied

    if not applied:
        logging.warning(f"Patch failed: {apply_msg}")
        cycle_data["verdict"] = "PATCH_FAILED"
        save_report(report, cycle_num)
        memory.save_lesson({
            **cycle_data,
            "hypothesis": analysis[:200],
            "files_touched": files,
            "lesson": f"Patch failed to apply: {apply_msg[:250]}",
        })
        return cycle_data

    # ── 8. Post-patch checks ─────────────────────────────────────────────────
    logging.info("Running post-patch checks...")
    after = runner.run_all(f"cycle_{cycle_num}_after")
    after_summary = runner.format_summary(after)
    report.append(f"\n## Post-Patch Results\n{after_summary}")
    cycle_data["after"] = after

    # ── 9. Judge ─────────────────────────────────────────────────────────────
    logging.info("Judging result...")
    judgment = judge.judge(
        baseline,
        after,
        plan,
        analysis,
        has_real_benchmark=runner.has_any_real_benchmark(),
    )
    verdict = judgment.get("verdict", "REJECT")
    reason = judgment.get("reason", "")
    report.append(f"\n## Judgment\n**{verdict}**: {reason}")
    if judgment.get("llm_reasoning"):
        report.append(f"\n<details><summary>LLM reasoning</summary>\n\n{judgment['llm_reasoning']}\n\n</details>")
    cycle_data["verdict"] = verdict
    cycle_data["judgment"] = {k: v for k, v in judgment.items() if k != "llm_reasoning"}

    # ── 10. Accept or rollback ────────────────────────────────────────────────
    if verdict == "ACCEPT":
        logging.info("ACCEPTED — committing...")
        for f in files:
            run_command(f'git add "{f}"', cwd=_REPO_ROOT)
        commit_msg = f"robot: improve transcription cycle {cycle_num}"
        code, _, stderr = run_command(
            f'git commit -m "{commit_msg}"',
            cwd=_REPO_ROOT,
        )
        if code == 0:
            report.append(f"\n## Commit\n`{commit_msg}`")
            logging.info(f"Committed: {commit_msg}")
        else:
            report.append(f"\n## Commit\nFailed: {stderr.strip()}")
            logging.error(f"Commit failed: {stderr.strip()}")
    else:
        logging.info(f"{verdict} — rolling back {files}...")
        applier.rollback_files(files)
        report.append(
            f"\n## Rollback\n"
            f"Rolled back files: {', '.join(files) or 'none'}\n\n"
            f"Manual rollback: `git checkout -- {' '.join(files)}`"
        )

    # ── 11. Reflection ────────────────────────────────────────────────────────
    logging.info("Writing lesson...")
    reflection = judge.get_reflection(cycle_data)
    report.append(f"\n## Lesson Learned\n{reflection}")
    cycle_data["lesson_raw"] = reflection

    # ── 12. Memory ────────────────────────────────────────────────────────────
    memory.save_lesson({
        **cycle_data,
        "hypothesis": analysis[:200],
        "files_touched": files,
        "lesson": reflection,
    })

    save_report(report, cycle_num)
    return cycle_data


# ---------------------------------------------------------------------------
# run command
# ---------------------------------------------------------------------------

def cmd_run(args: argparse.Namespace, config: dict) -> None:
    setup_logging()

    if args.max_files:
        config["max_patch_files"] = args.max_files
    if args.max_lines:
        config["max_patch_lines"] = args.max_lines

    max_files: int = config.get("max_patch_files", 3)
    max_lines: int = config.get("max_patch_lines", 150)

    # Proxy reachability check
    llm = LLMClient(config["proxy_url"], config["temperature"], config["max_tokens"])
    if not llm.ping():
        print(
            f"ERROR: LLM proxy unreachable at {config['proxy_url']}\n"
            "Start it with: python nvidia_fallback_proxy.py"
        )
        sys.exit(1)

    # Git state check
    gs = git_status(_REPO_ROOT)
    if gs["is_dirty"] and not args.allow_dirty:
        print(
            "ERROR: Working tree is dirty. Commit or stash changes first,\n"
            "       or pass --allow-dirty to override.\n\n"
            f"Dirty files:\n{gs['dirty_files']}"
        )
        sys.exit(1)

    # Create experiment branch
    branch = create_experiment_branch(_REPO_ROOT, config["branch_prefix"])

    # Build components (shared across all cycles)
    guard = RepoGuard(config, _REPO_ROOT)
    scanner = RepoScanner(_REPO_ROOT, guard)
    runner = BenchmarkRunner(config, _REPO_ROOT, _DATA_DIR)
    planner = PatchPlanner(llm, _PROMPTS_DIR, config)
    applier = PatchApplier(_REPO_ROOT, _DATA_DIR / "patches")
    judge = ResultJudge(llm, _PROMPTS_DIR)
    memory = MemoryStore(_DATA_DIR / "memory")

    print(f"\nStarting {args.cycles} cycle(s) on branch: {branch}")
    print(f"Proxy : {config['proxy_url']}")
    print(f"Limits: max_files={max_files}, max_lines={max_lines}\n")

    results: List[Dict] = []
    for i in range(1, args.cycles + 1):
        try:
            result = run_single_cycle(
                cycle_num=i,
                config=config,
                llm=llm,
                guard=guard,
                scanner=scanner,
                runner=runner,
                planner=planner,
                applier=applier,
                judge=judge,
                memory=memory,
                max_files=max_files,
                max_lines=max_lines,
            )
        except KeyboardInterrupt:
            print("\nInterrupted by user.")
            break
        except Exception as exc:
            logging.exception(f"Cycle {i} crashed: {exc}")
            result = {"cycle": i, "verdict": f"CRASH: {exc}"}

        results.append(result)
        logging.info(f"Cycle {i} done — verdict: {result.get('verdict', '?')}")

    print(f"\n{'='*50}")
    print(f"Run complete — {len(results)} cycle(s)")
    print(f"{'='*50}")
    for r in results:
        print(f"  Cycle {r['cycle']:>2}: {r.get('verdict', '?')}")
    print()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Vocalype Night Robot — autonomous transcription improvement agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", metavar="COMMAND")

    sub.add_parser("status", help="Show robot status and last run")
    sub.add_parser("benchmark", help="Run configured benchmarks and save results")
    sub.add_parser("plan", help="Analyze repo and propose a patch (no changes applied)")
    sub.add_parser("rollback-last", help="Revert the last accepted robot commit")

    run_p = sub.add_parser("run", help="Run autonomous cycles")
    run_p.add_argument("--cycles", type=int, default=1, metavar="N",
                       help="Number of improvement cycles to run (default: 1)")
    run_p.add_argument("--max-files", type=int, default=None, metavar="N",
                       help="Max files per patch (overrides config)")
    run_p.add_argument("--max-lines", type=int, default=None, metavar="N",
                       help="Max changed lines per patch (overrides config)")
    run_p.add_argument("--allow-dirty", action="store_true",
                       help="Run even if working tree has uncommitted changes")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    config = load_config()

    {
        "status": cmd_status,
        "benchmark": cmd_benchmark,
        "plan": cmd_plan,
        "run": cmd_run,
        "rollback-last": cmd_rollback_last,
    }[args.command](args, config)


if __name__ == "__main__":
    main()
