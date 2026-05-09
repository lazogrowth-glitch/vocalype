import json
import logging
from typing import List

import httpx


class LLMClient:
    def __init__(self, proxy_url: str, temperature: float = 0.15, max_tokens: int = 6000):
        self.proxy_url = proxy_url
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout = httpx.Timeout(timeout=180.0, connect=20.0, read=180.0, write=30.0)

    def chat(self, system: str, user: str) -> str:
        messages: List[dict] = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        payload = {
            "messages": messages,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
        }

        logging.info(f"LLM call → {self.proxy_url}")

        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(self.proxy_url, json=payload)

        if response.status_code != 200:
            raise RuntimeError(
                f"LLM proxy error {response.status_code}: {response.text[:500]}"
            )

        data = response.json()
        content = data["choices"][0]["message"]["content"]
        logging.info(f"LLM response received ({len(content)} chars)")
        return content

    def ping(self) -> bool:
        """Check if the proxy is reachable."""
        base = self.proxy_url.replace("/v1/chat/completions", "")
        try:
            with httpx.Client(timeout=httpx.Timeout(5.0)) as client:
                r = client.get(f"{base}/health")
            return r.status_code == 200
        except Exception:
            return False
