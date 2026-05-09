from __future__ import annotations

import json
from typing import Any

from brain import load_json
from local_llm import (
    FALLBACK_MESSAGE,
    _ollama_request,
    call_local_llm,
    is_ollama_available,
    list_ollama_models,
)


DEFAULT_ROLE_MODELS: dict[str, dict[str, Any]] = {
    "ceo": {
        "provider": "ollama",
        "model": "qwen3:8b",
        "temperature": 0.2,
        "keep_alive": "0",
    },
    "coder": {
        "provider": "ollama",
        "model": "qwen2.5-coder:7b",
        "temperature": 0.1,
        "keep_alive": "0",
    },
    "critic": {
        "provider": "ollama",
        "model": "qwen3:8b",
        "temperature": 0.1,
        "keep_alive": "0",
    },
    "embeddings": {
        "provider": "ollama",
        "model": "nomic-embed-text",
        "keep_alive": "0",
    },
    "fast": {
        "provider": "ollama",
        "model": "qwen3:4b",
        "fallback_model": "qwen3:8b",
        "temperature": 0.1,
        "keep_alive": "0",
    },
}


def _config() -> dict[str, Any]:
    try:
        return load_json("config/brain.config.json")
    except FileNotFoundError:
        return {}


def available_models() -> list[str]:
    return list_ollama_models()


def _find_installed_model(requested_model: str, installed: list[str]) -> str | None:
    if requested_model in installed:
        return requested_model
    if ":" not in requested_model:
        tagged = f"{requested_model}:latest"
        if tagged in installed:
            return tagged
        base_name = requested_model
        for candidate in installed:
            if candidate == base_name or candidate.startswith(f"{base_name}:"):
                return candidate
    return None


def _default_ceo_model(config: dict[str, Any]) -> str:
    llm_config = config.get("local_llm", {})
    models_config = config.get("models", {})
    return str(
        models_config.get("ceo", {}).get("model")
        or llm_config.get("main_model")
        or llm_config.get("model")
        or DEFAULT_ROLE_MODELS["ceo"]["model"]
    )


def get_model_for_role(role: str) -> dict[str, Any]:
    config = _config()
    models_config = config.get("models", {})
    role_key = role if role in DEFAULT_ROLE_MODELS else "ceo"

    resolved = dict(DEFAULT_ROLE_MODELS.get(role_key, DEFAULT_ROLE_MODELS["ceo"]))
    resolved.update(models_config.get(role_key, {}))

    installed = available_models()
    selected_model = str(resolved.get("model", _default_ceo_model(config)))
    fallback_model = str(resolved.get("fallback_model") or _default_ceo_model(config))
    installed_selected = _find_installed_model(selected_model, installed)
    installed_fallback = _find_installed_model(fallback_model, installed)

    if installed_selected:
        resolved["resolved_model"] = installed_selected
        resolved["fallback_used"] = False
    elif installed_fallback:
        resolved["resolved_model"] = installed_fallback
        resolved["fallback_used"] = True
        resolved["fallback_reason"] = f"Requested model '{selected_model}' is not installed."
    else:
        resolved["resolved_model"] = fallback_model
        resolved["fallback_used"] = True
        resolved["fallback_reason"] = (
            f"Requested model '{selected_model}' is not installed and fallback model '{fallback_model}' is also unavailable."
        )

    resolved["role"] = role_key
    return resolved


def call_model_for_role(
    role: str,
    prompt: str,
    system: str | None = None,
    schema: dict[str, Any] | None = None,
) -> str:
    config = _config()
    llm_config = config.get("local_llm", {})
    if not llm_config.get("enabled", True):
        return "Local LLM disabled in config. Vocalype Brain will use template-based fallback logic."

    if not is_ollama_available():
        return FALLBACK_MESSAGE

    model_config = get_model_for_role(role)
    provider = str(model_config.get("provider", "ollama"))
    if provider != "ollama":
        return f"Unsupported local LLM provider '{provider}' for role '{role}'."

    return call_local_llm(
        prompt,
        system=system,
        schema=schema,
        model=str(model_config.get("resolved_model", _default_ceo_model(config))),
        keep_alive=model_config.get("keep_alive", "0"),
    )


def validate_model_setup() -> dict[str, Any]:
    config = _config()
    installed = available_models()
    roles: dict[str, Any] = {}
    for role in DEFAULT_ROLE_MODELS:
        resolved = get_model_for_role(role)
        roles[role] = {
            "requested_model": resolved.get("model"),
            "resolved_model": resolved.get("resolved_model"),
            "fallback_model": resolved.get("fallback_model"),
            "fallback_used": resolved.get("fallback_used", False),
            "keep_alive": resolved.get("keep_alive", "0"),
            "available": resolved.get("resolved_model") in installed,
        }
        if resolved.get("fallback_reason"):
            roles[role]["fallback_reason"] = resolved["fallback_reason"]
    return {
        "provider": config.get("local_llm", {}).get("provider", "ollama"),
        "ollama_available": is_ollama_available(),
        "available_models": installed,
        "roles": roles,
    }


def unload_model(model_name: str) -> bool:
    if not model_name or not is_ollama_available():
        return False
    try:
        _ollama_request(
            "/api/generate",
            payload={
                "model": model_name,
                "prompt": "",
                "stream": False,
                "keep_alive": 0,
            },
            timeout=20,
        )
    except Exception:
        return False
    return True


def main() -> None:
    summary = validate_model_setup()
    print("Vocalype Brain model router")
    print(json.dumps(summary, indent=2))

    if not summary["ollama_available"]:
        print(FALLBACK_MESSAGE)
        return

    for role in ("ceo", "coder", "critic"):
        resolved_model = str(summary["roles"][role]["resolved_model"])
        response = call_model_for_role(role, f"Reply with exactly: {role} route ok.")
        print(f"{role}: {resolved_model}")
        print(response)


if __name__ == "__main__":
    main()
