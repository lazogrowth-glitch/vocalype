import os
import time
import logging
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)

# =========================
# CONFIG
# =========================

NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY")
BASE_URL = os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")

if not NVIDIA_API_KEY:
    raise RuntimeError(
        "Missing NVIDIA_API_KEY. Create a .env file with NVIDIA_API_KEY=nvapi-..."
    )

# Classement actuel pour ton cas :
# robot agentique / code / benchmark / amélioration Vocalype
MODEL_LIST: List[str] = [
    # 1. Best first choice for autonomous engineering loops
    "z-ai/glm-5.1",

    # 2. Strong dedicated coding / repo-editing model
    "qwen/qwen3-coder-480b-a35b-instruct",

    # 3. Heavy reasoning model, strong but may be slower
    "deepseek-ai/deepseek-v4-pro",

    # 4. Strong coding / reasoning / office-work model
    "minimaxai/minimax-m2.7",

    # 5. Fast fallback when heavy models are slow or rate-limited
    "deepseek-ai/deepseek-v4-flash",

    # 6. Stable NVIDIA backup for agents / code / long context
    "nvidia/nemotron-3-super-120b-a12b",
]

RETRYABLE_STATUS_CODES = {408, 409, 429, 500, 502, 503, 504}
NON_RETRYABLE_STATUS_CODES = {400, 401, 403, 404, 422}

DEFAULT_TIMEOUT = httpx.Timeout(
    timeout=120.0,
    connect=20.0,
    read=120.0,
    write=30.0,
)

app = FastAPI(title="NVIDIA Fallback Proxy")


# =========================
# HELPERS
# =========================

def get_headers() -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {NVIDIA_API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def clean_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Garde seulement les champs OpenAI-compatible utiles.
    On enlève le model envoyé par le client parce que ce proxy contrôle le fallback.
    """
    cleaned = dict(payload)
    cleaned.pop("model", None)

    allowed_keys = {
        "messages",
        "temperature",
        "top_p",
        "max_tokens",
        "stream",
        "tools",
        "tool_choice",
        "response_format",
        "stop",
        "presence_penalty",
        "frequency_penalty",
        "seed",
    }

    return {key: value for key, value in cleaned.items() if key in allowed_keys}


def short_error_text(text: str, limit: int = 700) -> str:
    text = text.replace("\n", " ").strip()
    return text[:limit]


async def call_nvidia_json(
    client: httpx.AsyncClient,
    payload: Dict[str, Any],
    model: str,
) -> Dict[str, Any]:
    url = f"{BASE_URL}/chat/completions"

    model_payload = {
        **payload,
        "model": model,
        "stream": False,
    }

    started_at = time.time()

    response = await client.post(
        url,
        headers=get_headers(),
        json=model_payload,
    )

    elapsed = round(time.time() - started_at, 2)

    if response.status_code == 200:
        logging.info(f"SUCCESS | model={model} | elapsed={elapsed}s")
        return response.json()

    detail = short_error_text(response.text)

    logging.warning(
        f"FAILED | model={model} | status={response.status_code} | "
        f"elapsed={elapsed}s | error={detail}"
    )

    raise HTTPException(status_code=response.status_code, detail=detail)


async def stream_nvidia_response(
    payload: Dict[str, Any],
    model: str,
):
    """
    Stream raw SSE response from NVIDIA to the client.

    Important:
    Une fois que le streaming commence, on ne peut pas fallback proprement
    au milieu du stream. Donc si ce modèle accepte la connexion, il stream.
    """
    url = f"{BASE_URL}/chat/completions"

    model_payload = {
        **payload,
        "model": model,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        async with client.stream(
            "POST",
            url,
            headers=get_headers(),
            json=model_payload,
        ) as response:
            if response.status_code != 200:
                body = await response.aread()
                detail = short_error_text(body.decode("utf-8", errors="ignore"))
                raise HTTPException(status_code=response.status_code, detail=detail)

            async for chunk in response.aiter_bytes():
                yield chunk


# =========================
# ROUTES
# =========================

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "base_url": BASE_URL,
        "model_count": len(MODEL_LIST),
        "models": MODEL_LIST,
    }


@app.get("/v1/models")
async def list_models():
    return {
        "object": "list",
        "data": [
            {
                "id": model,
                "object": "model",
                "owned_by": "nvidia",
            }
            for model in MODEL_LIST
        ],
    }


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    raw_payload = await request.json()
    payload = clean_payload(raw_payload)

    if "messages" not in payload or not isinstance(payload["messages"], list):
        raise HTTPException(
            status_code=400,
            detail="Missing or invalid 'messages' field.",
        )

    stream = bool(raw_payload.get("stream", False))
    last_error: Optional[HTTPException] = None

    # =========================
    # STREAMING MODE
    # =========================
    # Note: streaming fallback is limited because once a stream starts,
    # you cannot switch model mid-response.
    if stream:
        for model in MODEL_LIST:
            try:
                logging.info(f"STREAM TRY | model={model}")
                return StreamingResponse(
                    stream_nvidia_response(payload, model),
                    media_type="text/event-stream",
                )
            except HTTPException as e:
                last_error = e
                logging.warning(
                    f"STREAM FAILED | model={model} | status={e.status_code}"
                )

                if e.status_code in RETRYABLE_STATUS_CODES:
                    continue

                if e.status_code in NON_RETRYABLE_STATUS_CODES:
                    continue

                continue

        raise last_error or HTTPException(
            status_code=500,
            detail="All streaming models failed.",
        )

    # =========================
    # NORMAL JSON MODE
    # =========================
    async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
        for model in MODEL_LIST:
            try:
                logging.info(f"TRY | model={model}")
                result = await call_nvidia_json(client, payload, model)
                return JSONResponse(content=result)

            except HTTPException as e:
                last_error = e

                if e.status_code in RETRYABLE_STATUS_CODES:
                    logging.info(
                        f"RETRYABLE ERROR | model={model} | status={e.status_code} | trying next model"
                    )
                    continue

                if e.status_code in NON_RETRYABLE_STATUS_CODES:
                    logging.info(
                        f"NON-RETRYABLE FOR THIS MODEL | model={model} | status={e.status_code} | skipping"
                    )
                    continue

                logging.info(
                    f"UNKNOWN ERROR STATUS | model={model} | status={e.status_code} | trying next model"
                )
                continue

            except Exception as e:
                logging.exception(f"EXCEPTION | model={model}")
                last_error = HTTPException(status_code=500, detail=str(e))
                continue

    raise last_error or HTTPException(
        status_code=500,
        detail="All models failed.",
    )


# =========================
# DEV SERVER
# =========================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "nvidia_fallback_proxy:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )
