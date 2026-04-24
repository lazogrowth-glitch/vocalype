from __future__ import annotations

from datetime import date

from brain import ensure_brain_structure, save_actions, write_text, read_jsonl, append_jsonl


TESTS = [
    ("French casual speech", "Je veux dicter un courriel rapidement sans envoyer ma voix dans le cloud."),
    ("English casual speech", "I want to write this email without touching my keyboard."),
    ("Code dictation", "Create a function called parse user input and return the cleaned text."),
    ("Long paragraph dictation", "Vocalype should help me capture a complete paragraph, keep punctuation readable, and paste it into any app."),
    ("Fast speech", "This is a quick test to see whether the model can follow me when I speak faster than usual."),
    ("Noisy background", "I am speaking with background noise and still need accurate transcription."),
    ("Punctuation", "Add a comma after hello, then a period after world, then start a new line."),
    ("Commands", "Paste the text into the active window and keep the original capitalization."),
    ("Low-end PC performance", "This test measures whether dictation remains usable on a slow laptop."),
    ("Startup time", "Measure how long the model takes before the first dictation is ready."),
]

MODELS = ["Whisper", "Parakeet", "Moonshine", "SenseVoice"]


def benchmark_row(model: str, category: str, sentence: str) -> dict:
    return {
        "model_name": model,
        "test_category": category,
        "test_sentence": sentence,
        "expected_text": sentence,
        "actual_text": "",
        "latency_ms": None,
        "ram_mb": None,
        "cpu_percent": None,
        "gpu_percent": None,
        "wer_estimate": None,
        "notes": "",
    }


def main() -> None:
    ensure_brain_structure()
    existing = read_jsonl("data/benchmarks.jsonl")
    if not existing:
        for model in MODELS:
            for category, sentence in TESTS:
                append_jsonl("data/benchmarks.jsonl", benchmark_row(model, category, sentence))

    lines = [
        "# Vocalype Brain - Model Benchmark Report",
        "",
        f"Date: {date.today().isoformat()}",
        "",
        "## Purpose",
        "",
        "Use this template to compare speech-to-text models manually without paid APIs.",
        "",
        "## Metrics",
        "",
        "- latency_ms",
        "- ram_mb",
        "- cpu_percent",
        "- gpu_percent",
        "- wer_estimate",
        "- notes",
        "",
        "## Test Categories",
        "",
    ]
    for category, sentence in TESTS:
        lines.extend([f"### {category}", "", f"Expected text: {sentence}", ""])

    lines.extend(
        [
            "## Manual Benchmark Instructions",
            "",
            "1. Choose one model and one test category.",
            "2. Dictate the expected sentence using the same microphone and environment.",
            "3. Paste the actual output into `data/benchmarks.jsonl`.",
            "4. Record latency, RAM, CPU, GPU, WER estimate, and notes.",
            "5. Compare models by user mode: normal, developer, French, low-end PC, privacy, fastest, best accuracy.",
            "",
            "## Recommendation Rule",
            "",
            "Do not change the default model unless it improves the target metric without hurting first successful dictation.",
        ]
    )
    write_text("outputs/model_report.md", "\n".join(lines).rstrip() + "\n")
    print("Generated vocalype-brain/outputs/model_report.md and benchmark JSONL template")


if __name__ == "__main__":
    main()
