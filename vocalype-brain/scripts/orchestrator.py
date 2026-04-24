from __future__ import annotations

import json
import sys
from datetime import date
from typing import Any

from brain import ensure_brain_structure, load_memory_files, read_jsonl, read_text, write_text
from context_builder import build_context
from generate_content_ideas import TARGET_USERS, make_idea
from local_llm import FALLBACK_MESSAGE
from model_router import call_model_for_role
from self_improvement import generate_improvement_proposals
from tools import generate_daily_report_tool, read_actions, save_action, score_actions_tool


ACTION_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "required": [
            "agent",
            "title",
            "problem",
            "why_it_matters",
            "expected_impact",
            "difficulty",
            "area",
            "action",
            "validation_test",
            "metric",
        ],
    },
}


def _memory_context(limit_per_file: int = 1800) -> str:
    memory = load_memory_files()
    chunks = []
    for name, content in sorted(memory.items()):
        chunks.append(f"## {name}\n{content[:limit_per_file]}")
    return "\n\n".join(chunks)


def _contextual_prompt(query: str, task_instruction: str) -> str:
    return f"{build_context(query)}\n{task_instruction}"


def _parse_json_list(text: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return []
    if isinstance(parsed, dict):
        parsed = parsed.get("actions", parsed.get("ideas", parsed.get("items", [])))
    if not isinstance(parsed, list):
        return []
    return [item for item in parsed if isinstance(item, dict)]


def _fallback_product_actions() -> list[dict[str, Any]]:
    return [
        {
            "agent": "product_agent",
            "title": "Map first successful dictation blockers",
            "problem": "The activation path may contain unknown permission, model, or paste friction.",
            "why_it_matters": "First successful dictation is Vocalype's most important activation event.",
            "expected_impact": "critical",
            "difficulty": "medium",
            "urgency": "critical",
            "area": "onboarding, dictation, permissions",
            "suggested_files": [],
            "action": "Run a clean-install activation audit and record every step before first dictation.",
            "validation_test": "New profile reaches first successful dictation in under 3 minutes.",
            "metric": "first_dictation_success_rate",
        },
        {
            "agent": "product_agent",
            "title": "Rewrite activation failure copy",
            "problem": "License or login failures can leave users stuck.",
            "why_it_matters": "Activation confusion creates refund risk and support load.",
            "expected_impact": "high",
            "difficulty": "easy",
            "urgency": "high",
            "area": "license flow, activation, error messages",
            "suggested_files": [],
            "action": "Add cause, fix, and support path to every activation error.",
            "validation_test": "Trigger each activation failure and confirm the next step is obvious.",
            "metric": "activation_support_tickets_per_100_users",
        },
    ]


def _fallback_growth_report() -> str:
    ideas = []
    templates = [
        "I replaced typing with Vocalype for 24 hours.",
        "I wrote a {target} workflow without touching my keyboard.",
        "Offline voice typing for {target} is underrated.",
        "This is how {target} can speak text into any app.",
        "Most people type. I use Vocalype to speak and paste anywhere.",
    ]
    index = 0
    for target in TARGET_USERS:
        for template in templates:
            hook = template.format(target=target)
            base = make_idea(index, target, "This app turns your voice into text anywhere.")
            base["hook"] = hook
            ideas.append(base)
            index += 1
    lines = ["# Vocalype Brain - Growth Report", "", f"Date: {date.today().isoformat()}", "", "## Local Orchestrator Ideas", ""]
    for number, idea in enumerate(ideas, start=1):
        lines.extend(
            [
                f"### {number}. {idea['hook']}",
                "",
                f"Platform: {idea['platform']}",
                f"Target user: {idea['target_user']}",
                f"Demo scene: {idea['demo_scene']}",
                f"CTA: {idea['cta']}",
                f"Metric to track: {idea['metric']}",
                "",
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


def run_daily() -> None:
    ensure_brain_structure()
    system = read_text("agents/focus_guard_agent.md") + "\n\n" + read_text("agents/critic_agent.md")
    query = "daily Vocalype priorities activation first dictation conversion distribution"
    prompt = _contextual_prompt(
        query,
        (
            "Using the retrieved Vocalype context and current actions, propose up to 3 additional measurable actions for today. "
            "Only propose actions that directly improve Vocalype product, models, UX, distribution, revenue, trust, or retention. "
            "For each action, keep it measurable. Also include memory_files_used and confidence_level for each action if possible.\n\n"
            f"Current actions:\n{json.dumps(read_actions()[-20:], indent=2)}"
        ),
    )
    response = call_model_for_role("ceo", prompt, system=system, schema=ACTION_SCHEMA)
    proposed = _parse_json_list(response)
    used_llm = bool(proposed and FALLBACK_MESSAGE not in response)
    if proposed and FALLBACK_MESSAGE not in response:
        for action in proposed[:3]:
            save_action(action)
    score_actions_tool()
    generate_daily_report_tool()
    mode = "Ollama proposals" if used_llm else "template/scored-action fallback"
    print(f"Generated daily report using {mode}: vocalype-brain/outputs/daily_actions.md")


def run_ask(question: str) -> None:
    ensure_brain_structure()
    focus_terms = [
        "vocalype",
        "dictation",
        "speech",
        "voice",
        "saas",
        "model",
        "growth",
        "pricing",
        "activation",
        "user",
        "improve",
        "today",
        "brain",
    ]
    if not any(term in question.lower() for term in focus_terms):
        print("Decision: DELAY or REJECT. This does not directly improve Vocalype right now.")
        print("Better action: Ask a Vocalype-specific product, model, growth, revenue, trust, or retention question.")
        return
    system = read_text("agents/focus_guard_agent.md")
    prompt = _contextual_prompt(
        question,
        (
            "Answer this founder question using retrieved Vocalype memory. Be direct and measurable. "
            "Cite memory files used and end with Confidence: low, medium, or high.\n\n"
            f"Question: {question}"
        ),
    )
    response = call_model_for_role("ceo", prompt, system=system)
    if FALLBACK_MESSAGE in response:
        print(response)
        print("Fallback answer: Focus on first successful dictation, activation clarity, demo-led distribution, and measurable conversion metrics.")
    else:
        print(response)


def run_growth() -> None:
    ensure_brain_structure()
    system = read_text("agents/growth_agent.md")
    query = "distribution content ideas demo hooks growth channels"
    prompt = _contextual_prompt(
        query,
        (
            "Generate 20 demo-based Vocalype content ideas. Include platform, target_user, hook, demo_scene, CTA, metric, "
            "memory_files_used, and confidence_level. Avoid generic startup content."
        ),
    )
    response = call_model_for_role("ceo", prompt, system=system)
    if FALLBACK_MESSAGE in response:
        report = _fallback_growth_report()
    else:
        report = "# Vocalype Brain - Growth Report\n\n" + f"Date: {date.today().isoformat()}\n\n" + response.strip() + "\n"
    write_text("outputs/growth_report.md", report)
    print("Generated vocalype-brain/outputs/growth_report.md")


def run_product() -> None:
    ensure_brain_structure()
    system = read_text("agents/product_agent.md") + "\n\n" + read_text("agents/critic_agent.md")
    query = "product improvements first successful dictation license activation onboarding permissions errors"
    prompt = _contextual_prompt(
        query,
        (
            "Generate 3 measurable product improvement actions for Vocalype. "
            "Prioritize first successful dictation, activation/license issues, onboarding, permissions, model selection UX, and errors. "
            "Also include memory_files_used and confidence_level where possible."
        ),
    )
    response = call_model_for_role("ceo", prompt, system=system, schema=ACTION_SCHEMA)
    actions = _parse_json_list(response)
    if not actions or FALLBACK_MESSAGE in response:
        actions = _fallback_product_actions()
    for action in actions[:5]:
        save_action(action)
    score_actions_tool()
    print(f"Saved {min(len(actions), 5)} product actions to vocalype-brain/data/actions.jsonl")


def run_self_improve() -> None:
    proposals = generate_improvement_proposals()
    print(f"Generated {len(proposals)} self-improvement proposals: vocalype-brain/outputs/improvement_proposals.md")


def main() -> None:
    ensure_brain_structure()
    if len(sys.argv) < 2:
        raise SystemExit(
            "Usage: python vocalype-brain/scripts/orchestrator.py "
            "daily | ask \"question\" | growth | product | self-improve"
        )
    command = sys.argv[1].strip().lower()
    if command == "daily":
        run_daily()
    elif command == "ask":
        if len(sys.argv) < 3:
            raise SystemExit('Usage: python vocalype-brain/scripts/orchestrator.py ask "What should we improve today?"')
        run_ask(" ".join(sys.argv[2:]))
    elif command == "growth":
        run_growth()
    elif command == "product":
        run_product()
    elif command == "self-improve":
        run_self_improve()
    else:
        raise SystemExit(f"Unknown command: {command}")


if __name__ == "__main__":
    main()
