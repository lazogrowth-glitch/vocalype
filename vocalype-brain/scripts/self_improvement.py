from __future__ import annotations

import json
from datetime import date
from typing import Any

from brain import ensure_brain_structure, load_json, load_memory_files, read_jsonl, read_text, write_text
from local_llm import FALLBACK_MESSAGE
from model_router import call_model_for_role
from tools import append_jsonl_tool


ALLOWED_TARGET_PREFIXES = (
    "agents/",
    "memory/",
    "config/scoring.config.json",
    "outputs/",
    "schemas/",
)

BLOCKED_TARGETS = {
    "config/brain.config.json",
    "memory/founder_rules.md",
}


PROPOSAL_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "required": [
            "title",
            "target_file",
            "current_problem",
            "proposed_change",
            "expected_benefit",
            "risk",
            "validation_test",
        ],
        "properties": {
            "title": {"type": "string"},
            "target_file": {"type": "string"},
            "current_problem": {"type": "string"},
            "proposed_change": {"type": "string"},
            "expected_benefit": {"type": "string"},
            "risk": {"type": "string"},
            "validation_test": {"type": "string"},
        },
    },
}


def _is_safe_target(target_file: str) -> bool:
    normalized = target_file.replace("\\", "/").strip()
    if normalized.startswith("vocalype-brain/"):
        normalized = normalized[len("vocalype-brain/") :]
    if normalized in BLOCKED_TARGETS:
        return False
    return any(normalized.startswith(prefix) for prefix in ALLOWED_TARGET_PREFIXES)


def _fallback_proposals() -> list[dict[str, Any]]:
    today = date.today().isoformat()
    return [
        {
            "date": today,
            "title": "Add result fields to action reviews",
            "target_file": "memory/experiments.md",
            "current_problem": "Actions and experiments can be created without a later result review.",
            "proposed_change": "Add a weekly reminder to record result, metric movement, and next decision for each completed experiment.",
            "expected_benefit": "Improves learning quality and prevents repeated unmeasured work.",
            "risk": "low",
            "validation_test": "Next weekly review includes result and decision fields for each completed experiment.",
            "status": "proposed",
        },
        {
            "date": today,
            "title": "Strengthen growth hook scoring",
            "target_file": "memory/growth_playbook.md",
            "current_problem": "Growth ideas can be generated without an explicit demo strength score.",
            "proposed_change": "Add a rule that each content idea must show the app, name the target user, and track view-to-download click rate.",
            "expected_benefit": "Keeps distribution focused on product demos instead of generic founder content.",
            "risk": "low",
            "validation_test": "Generated growth reports include demo scene and metric for every idea.",
            "status": "proposed",
        },
        {
            "date": today,
            "title": "Add benchmark decision threshold",
            "target_file": "memory/model_playbook.md",
            "current_problem": "Model recommendations can compare metrics without a minimum improvement threshold.",
            "proposed_change": "Require at least 15 percent latency improvement or 10 percent WER improvement before changing a default model.",
            "expected_benefit": "Prevents churn from tiny benchmark differences.",
            "risk": "low",
            "validation_test": "Next model recommendation cites the threshold it passed.",
            "status": "proposed",
        },
    ]


def _parse_proposals(text: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return []
    if isinstance(parsed, dict):
        parsed = parsed.get("proposals", [])
    if not isinstance(parsed, list):
        return []
    proposals: list[dict[str, Any]] = []
    for item in parsed:
        if isinstance(item, dict):
            proposals.append(item)
    return proposals


def _normalize_proposals(proposals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    today = date.today().isoformat()
    normalized: list[dict[str, Any]] = []
    for proposal in proposals:
        item = {
            "date": proposal.get("date", today),
            "title": str(proposal.get("title", "")).strip(),
            "target_file": str(proposal.get("target_file", "")).strip(),
            "current_problem": str(proposal.get("current_problem", "")).strip(),
            "proposed_change": str(proposal.get("proposed_change", "")).strip(),
            "expected_benefit": str(proposal.get("expected_benefit", "")).strip(),
            "risk": str(proposal.get("risk", "medium")).strip().lower(),
            "validation_test": str(proposal.get("validation_test", "")).strip(),
            "status": "proposed",
        }
        if item["risk"] not in {"low", "medium", "high"}:
            item["risk"] = "medium"
        if not _is_safe_target(item["target_file"]):
            item["risk"] = "high"
            item["status"] = "blocked_unsafe_target"
        if all(item[key] for key in ["title", "target_file", "current_problem", "proposed_change", "expected_benefit", "validation_test"]):
            normalized.append(item)
    return normalized


def _proposal_markdown(proposals: list[dict[str, Any]]) -> str:
    lines = [
        "# Vocalype Brain - Improvement Proposals",
        "",
        f"Date: {date.today().isoformat()}",
        "",
    ]
    for index, proposal in enumerate(proposals, start=1):
        lines.extend(
            [
                f"## {index}. {proposal['title']}",
                "",
                f"Target file: {proposal['target_file']}",
                f"Risk: {proposal['risk']}",
                f"Status: {proposal['status']}",
                "",
                f"Current weakness: {proposal['current_problem']}",
                f"Proposed change: {proposal['proposed_change']}",
                f"Expected benefit: {proposal['expected_benefit']}",
                f"Validation test: {proposal['validation_test']}",
                "",
            ]
        )
    if not proposals:
        lines.append("No safe measurable improvement proposals generated.")
    return "\n".join(lines).rstrip() + "\n"


def generate_improvement_proposals() -> list[dict[str, Any]]:
    ensure_brain_structure()
    memory = load_memory_files()
    wins = memory.get("wins", "")
    mistakes = memory.get("mistakes", "")
    actions = read_jsonl("data/actions.jsonl")[-25:]
    experiments = read_jsonl("data/experiments.jsonl")[-25:]
    system = read_text("agents/self_improvement_agent.md")
    prompt = "\n\n".join(
        [
            "Generate 3 to 5 safe improvement proposals for Vocalype Brain.",
            "Do not modify Vocalype product code.",
            "Do not change safety settings, founder focus rules, or human approval defaults.",
            f"Wins:\n{wins}",
            f"Mistakes:\n{mistakes}",
            f"Recent actions:\n{json.dumps(actions, indent=2)}",
            f"Recent experiments:\n{json.dumps(experiments, indent=2)}",
        ]
    )
    response = call_model_for_role("critic", prompt, system=system, schema=PROPOSAL_SCHEMA)
    proposals = _parse_proposals(response)
    if not proposals or FALLBACK_MESSAGE in response:
        proposals = _fallback_proposals()
    normalized = _normalize_proposals(proposals)
    for proposal in normalized:
        append_jsonl_tool("data/self_improvements.jsonl", proposal)
    write_text("outputs/improvement_proposals.md", _proposal_markdown(normalized))
    return normalized


def main() -> None:
    proposals = generate_improvement_proposals()
    config = load_json("config/brain.config.json")
    auto_apply = bool(config.get("safety", {}).get("allow_self_improvement_auto_apply", False))
    print(f"Generated {len(proposals)} improvement proposals.")
    if not auto_apply:
        print("Auto-apply is disabled by default. Review vocalype-brain/outputs/improvement_proposals.md manually.")


if __name__ == "__main__":
    main()
