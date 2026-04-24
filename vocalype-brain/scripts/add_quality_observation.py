from __future__ import annotations

import sys
from datetime import datetime

from brain import append_jsonl, ensure_brain_structure


def classify_observation(text: str) -> tuple[str, str, str]:
    lowered = text.lower()
    if any(term in lowered for term in ["slow", "latency", "delay", "lag", "first run"]):
        return "latency", "high" if "slow" in lowered or "lag" in lowered else "medium", "dictation_latency_ms"
    if any(term in lowered for term in ["ram", "memory usage", "memory", "usage high"]):
        return "ram", "high" if "high" in lowered else "medium", "ram_usage_mb"
    if any(term in lowered for term in ["crash", "freeze", "stopped working"]):
        return "crash", "critical", "crash_free_sessions_rate"
    if any(term in lowered for term in ["license", "activation", "subscription", "billing"]):
        return "activation", "high", "activation_success_rate"
    if any(term in lowered for term in ["onboarding", "first run", "welcome", "setup"]):
        return "onboarding", "medium", "first_dictation_success_rate"
    if any(term in lowered for term in ["wrong", "transcription", "accuracy", "dictation bad"]):
        return "transcription", "high", "transcription_accuracy_rate"
    if any(term in lowered for term in ["permission", "microphone", "accessibility"]):
        return "permissions", "high", "permission_setup_success_rate"
    if any(term in lowered for term in ["model", "preset", "settings"]):
        return "model_settings", "medium", "model_setting_change_success_rate"
    return "unknown", "medium", "quality_signal_count"


def main() -> None:
    ensure_brain_structure()
    if len(sys.argv) < 2:
        raise SystemExit('Usage: python vocalype-brain/scripts/add_quality_observation.py "Dictation feels slow on first run"')
    observation = " ".join(sys.argv[1:]).strip()
    category, severity, metric = classify_observation(observation)
    row = {
        "date": datetime.now().replace(microsecond=0).isoformat(),
        "source": "manual",
        "observation": observation,
        "category": category,
        "severity": severity,
        "suggested_metric": metric,
        "status": "open",
    }
    append_jsonl("data/quality_observations.jsonl", row)
    print(f"Added quality observation in category '{category}' with severity '{severity}'.")


if __name__ == "__main__":
    main()
