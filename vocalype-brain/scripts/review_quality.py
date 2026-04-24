from __future__ import annotations

from collections import Counter

from brain import ensure_brain_structure, read_jsonl, read_text


def main() -> None:
    ensure_brain_structure()
    report = read_text("outputs/quality_report.md")
    observations = read_jsonl("data/quality_observations.jsonl")
    metrics = read_jsonl("data/performance_metrics.jsonl")

    print("1. Most serious quality problem")
    if observations:
        ranked = {"low": 1, "medium": 2, "high": 3, "critical": 4}
        top = max(observations, key=lambda item: ranked.get(str(item.get("severity", "low")), 1))
        print(f"- {top.get('category', 'unknown')}: {top.get('observation', '')}")
    else:
        print("- No quality observations yet")

    print("\n2. Best next action")
    action_line = next((line for line in report.splitlines() if line.startswith("### 1. ")), None)
    print(f"- {action_line[6:] if action_line else 'Run the quality loop after adding observations'}")

    print("\n3. Metrics missing")
    suggested = [str(row.get("suggested_metric", "")) for row in observations if row.get("suggested_metric")]
    existing = {str(row.get('metric', '')) for row in metrics}
    missing = [metric for metric in suggested if metric not in existing]
    if missing:
        for metric in sorted(set(missing)):
            print(f"- {metric}")
    else:
        print("- No obvious missing metrics from current observations")

    print("\n4. What should be measured next")
    counts = Counter(str(row.get("category", "unknown")) for row in observations)
    if counts:
        category, _ = counts.most_common(1)[0]
        print(f"- Measure the main open category next: {category}")
    else:
        print("- Measure first-run dictation latency and activation success rate")

    print("\n5. Suggested next command")
    print('- python vocalype-brain/scripts/add_quality_observation.py "Describe the next quality issue you notice"')


if __name__ == "__main__":
    main()
