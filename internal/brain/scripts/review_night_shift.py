from __future__ import annotations

from brain import ensure_brain_structure, read_jsonl, read_text


def main() -> None:
    ensure_brain_structure()
    runs = read_jsonl("data/night_shift_runs.jsonl")
    patches = read_jsonl("data/proposed_patches.jsonl")
    report = read_text("outputs/night_shift_report.md")

    latest_runs = runs[-5:]
    latest_patches = patches[-5:]

    print("1. What happened overnight")
    if latest_runs:
        print(f"- Night Shift completed {len(latest_runs)} recent logged cycles.")
        print(f"- Focus areas: {', '.join(run['focus_area'] for run in latest_runs)}")
    else:
        print("- No Night Shift cycles found.")

    print("\n2. Best proposal")
    if latest_runs:
        best = max(latest_runs, key=lambda item: item.get("priority_score", 0))
        print(f"- {best['focus_area']} | score {best['priority_score']} | {best['proposed_solution']}")
    else:
        print("- None")

    print("\n3. Highest-risk proposal")
    risk_rank = {"low": 1, "medium": 2, "high": 3}
    if latest_runs:
        highest_risk = max(latest_runs, key=lambda item: risk_rank.get(item.get("risk", "low"), 1))
        print(f"- {highest_risk['focus_area']} | risk {highest_risk['risk']} | {highest_risk['problem_found']}")
    else:
        print("- None")

    print("\n4. Proposed patches")
    if latest_patches:
        for patch in latest_patches:
            print(f"- {patch['title']} | type {patch['patch_type']} | targets {', '.join(patch['target_files'])}")
    else:
        print("- None")

    print("\n5. What should be approved")
    if latest_runs:
        for run in latest_runs:
            if run.get("risk") == "low" and run.get("priority_score", 0) >= 60:
                print(f"- Review and approve implementation planning for {run['focus_area']}")
    else:
        print("- Nothing yet")

    print("\n6. What should be rejected")
    rejected = [run for run in latest_runs if run.get("risk") == "high" and run.get("confidence") == "low"]
    if rejected:
        for run in rejected:
            print(f"- Reject for now: {run['focus_area']}")
    else:
        print("- No immediate rejections suggested")

    print("\n7. Suggested next command")
    if latest_runs:
        print("- python internal/brain/scripts/orchestrator.py ask \"Which Night Shift proposal should I approve first?\"")
    else:
        print("- python internal/brain/scripts/night_shift.py")

    print("\nReport excerpt:")
    excerpt = "\n".join(report.splitlines()[:12])
    print(excerpt)


if __name__ == "__main__":
    main()
