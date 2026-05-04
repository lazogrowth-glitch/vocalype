import json
import logging
import re
from pathlib import Path
from typing import Optional

from llm_client import LLMClient


def _load_prompt(prompts_dir: Path, name: str) -> str:
    path = prompts_dir / name
    if path.exists():
        return path.read_text(encoding="utf-8")
    logging.warning(f"Prompt not found: {path}")
    return ""


def _extract_json(text: str) -> Optional[dict]:
    # Strip markdown code fences
    clean = re.sub(r"```(?:json)?\s*", "", text)
    clean = clean.replace("```", "")

    match = re.search(r"\{.*\}", clean, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group())
    except json.JSONDecodeError:
        return None


class PatchPlanner:
    def __init__(self, llm: LLMClient, prompts_dir: Path, config: dict):
        self.llm = llm
        self.prompts_dir = prompts_dir
        self.config = config

    def analyze_failures(
        self, repo_context: str, benchmark_summary: str, memory_context: str
    ) -> str:
        system = (
            _load_prompt(self.prompts_dir, "system_prompt.md")
            + "\n\n"
            + _load_prompt(self.prompts_dir, "analyze_failure_prompt.md")
        )
        user = (
            f"## Benchmark Results\n{benchmark_summary}\n\n"
            f"## Memory / Previous Lessons\n{memory_context}\n\n"
            f"## Repo Context\n{repo_context}\n\n"
            "Analyze the transcription failures. "
            "Identify one likely failure mode and one testable hypothesis."
        )
        return self.llm.chat(system, user)

    def propose_patch(self, analysis: str, repo_context: str) -> dict:
        system = (
            _load_prompt(self.prompts_dir, "system_prompt.md")
            + "\n\n"
            + _load_prompt(self.prompts_dir, "propose_patch_prompt.md")
        )
        constraints = (
            f"## Constraints\n"
            f"- max_patch_files: {self.config.get('max_patch_files', 3)}\n"
            f"- max_patch_lines: {self.config.get('max_patch_lines', 150)}\n"
            f"- forbidden_paths: {json.dumps(self.config.get('forbidden_paths', []))}\n"
            f"- allowed_focus_keywords: {json.dumps(self.config.get('allowed_focus_keywords', []))}\n"
        )
        user = (
            f"## Analysis\n{analysis}\n\n"
            f"{constraints}\n\n"
            f"## Repo Context\n{repo_context}\n\n"
            "Propose exactly one small patch. Output the JSON object only."
        )
        response = self.llm.chat(system, user)
        parsed = _extract_json(response)
        if parsed is not None:
            return parsed
        return {
            "skip": True,
            "reason": f"Could not parse LLM proposal. Raw: {response[:400]}",
        }

    def produce_diff(self, plan: dict, repo_context: str) -> str:
        system = (
            _load_prompt(self.prompts_dir, "system_prompt.md")
            + "\n\n"
            + _load_prompt(self.prompts_dir, "apply_patch_prompt.md")
        )
        user = (
            f"## Patch Plan\n{json.dumps(plan, indent=2)}\n\n"
            f"## Repo Context\n{repo_context}\n\n"
            "Produce ONLY a git-apply-compatible unified diff. "
            "Start with --- on line 1. No prose."
        )
        return self.llm.chat(system, user)
