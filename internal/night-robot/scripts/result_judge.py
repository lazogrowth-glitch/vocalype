import json
import logging
import re
from pathlib import Path
from typing import Optional

from llm_client import LLMClient


def _load_prompt(prompts_dir: Path, name: str) -> str:
    path = prompts_dir / name
    return path.read_text(encoding="utf-8") if path.exists() else ""


def _extract_json(text: str) -> Optional[dict]:
    clean = re.sub(r"```(?:json)?\s*", "", text)
    clean = clean.replace("```", "")
    match = re.search(r"\{.*\}", clean, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group())
    except json.JSONDecodeError:
        return None


def _slim(result: dict, max_output: int = 800) -> dict:
    """Return a slimmed result dict safe to include in a prompt."""
    slim = {"label": result.get("label"), "all_pass": result.get("all_pass")}
    for key in ["typescript_check", "test", "benchmark", "transcription_benchmark"]:
        r = result.get(key)
        if not r:
            continue
        slim[key] = {
            "status": r.get("status"),
            "stdout": r.get("stdout", "")[-max_output:],
            "stderr": r.get("stderr", "")[-500:],
        }
    return slim


class ResultJudge:
    def __init__(self, llm: LLMClient, prompts_dir: Path):
        self.llm = llm
        self.prompts_dir = prompts_dir

    def judge(
        self,
        baseline: dict,
        after: dict,
        plan: dict,
        analysis: str,
        has_real_benchmark: bool = False,
    ) -> dict:
        # Hard rule: post-patch test failure → immediate reject
        if not after.get("all_pass", True):
            return {
                "verdict": "REJECT",
                "reason": "Post-patch checks failed (test or TypeScript error).",
                "benchmark_delta": "no_benchmark",
                "llm_reasoning": "",
            }

        system = (
            _load_prompt(self.prompts_dir, "system_prompt.md")
            + "\n\n"
            + _load_prompt(self.prompts_dir, "judge_result_prompt.md")
        )

        slim_baseline = json.dumps(_slim(baseline), indent=2)
        slim_after = json.dumps(_slim(after), indent=2)
        slim_plan = json.dumps(
            {k: v for k, v in plan.items() if k != "unified_diff"},
            indent=2,
        )

        user = (
            f"## Baseline Results\n{slim_baseline}\n\n"
            f"## After-Patch Results\n{slim_after}\n\n"
            f"## Patch Plan\n{slim_plan}\n\n"
            f"## Analysis\n{analysis[:800]}\n\n"
            f"## Context\nhas_real_benchmark: {has_real_benchmark}\n\n"
            "Judge the change. Output JSON only."
        )

        response = self.llm.chat(system, user)
        parsed = _extract_json(response)

        if parsed:
            parsed["llm_reasoning"] = response
            return parsed

        logging.warning("Could not parse judge response — defaulting to REJECT")
        return {
            "verdict": "REJECT",
            "reason": "Could not parse judge LLM response.",
            "benchmark_delta": "no_benchmark",
            "llm_reasoning": response,
        }

    def get_reflection(self, cycle_data: dict) -> str:
        system = (
            _load_prompt(self.prompts_dir, "system_prompt.md")
            + "\n\n"
            + _load_prompt(self.prompts_dir, "reflection_prompt.md")
        )
        slim = {
            k: v
            for k, v in cycle_data.items()
            if k not in ("baseline", "after", "plan")
        }
        user = (
            f"## Cycle Summary\n{json.dumps(slim, indent=2, default=str)}\n\n"
            "Write 2-3 sentences: one specific lesson learned."
        )
        return self.llm.chat(system, user)
