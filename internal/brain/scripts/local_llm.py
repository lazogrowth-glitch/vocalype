from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from brain import load_json


OLLAMA_BASE_URL = "http://127.0.0.1:11434"
FALLBACK_MESSAGE = (
    "Local LLM unavailable. Ollama is not running or no local model responded. "
    "Vocalype Brain will use template-based fallback logic."
)


def _config() -> dict[str, Any]:
    try:
        return load_json("config/brain.config.json")
    except FileNotFoundError:
        return {}


def _ollama_request(path: str, payload: dict[str, Any] | None = None, timeout: int = 8) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{OLLAMA_BASE_URL}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="GET" if payload is None else "POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def is_ollama_available() -> bool:
    try:
        _ollama_request("/api/tags", timeout=3)
        return True
    except (OSError, urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return False


def list_ollama_models() -> list[str]:
    try:
        data = _ollama_request("/api/tags", timeout=5)
    except (OSError, urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return []
    return [model.get("name", "") for model in data.get("models", []) if model.get("name")]


def call_local_llm(
    prompt: str,
    system: str | None = None,
    schema: dict[str, Any] | None = None,
    *,
    model: str | None = None,
    keep_alive: str | int | None = None,
) -> str:
    config = _config()
    llm_config = config.get("local_llm", {})
    if not llm_config.get("enabled", True):
        return "Local LLM disabled in config. Vocalype Brain will use template-based fallback logic."

    provider = llm_config.get("provider", "ollama")
    if provider != "ollama":
        return f"Unsupported local LLM provider '{provider}'. Vocalype Brain supports Ollama in V1."

    if not is_ollama_available():
        return FALLBACK_MESSAGE

    selected_model = model or llm_config.get("main_model") or llm_config.get("model", "qwen3:8b")
    temperature = float(llm_config.get("temperature", 0.2))
    full_prompt = prompt
    if schema:
        full_prompt = (
            f"{prompt}\n\nReturn only valid JSON matching this schema shape. "
            f"Do not include markdown fences.\nSchema:\n{json.dumps(schema, indent=2)}"
        )

    payload: dict[str, Any] = {
        "model": selected_model,
        "prompt": full_prompt,
        "system": system or "",
        "stream": False,
        "options": {"temperature": temperature},
    }
    if schema:
        payload["format"] = "json"
    if keep_alive is not None:
        payload["keep_alive"] = keep_alive

    try:
        data = _ollama_request("/api/generate", payload=payload, timeout=120)
    except urllib.error.HTTPError as exc:
        return f"{FALLBACK_MESSAGE} Ollama returned HTTP {exc.code} for model '{selected_model}'."
    except (OSError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        return f"{FALLBACK_MESSAGE} Details: {exc}"

    return str(data.get("response", "")).strip() or FALLBACK_MESSAGE


def call_local_llm_for_role(
    role: str,
    prompt: str,
    system: str | None = None,
    schema: dict[str, Any] | None = None,
) -> str:
    try:
        from model_router import call_model_for_role
    except ImportError:
        return call_local_llm(prompt, system=system, schema=schema)
    return call_model_for_role(role, prompt, system=system, schema=schema)
