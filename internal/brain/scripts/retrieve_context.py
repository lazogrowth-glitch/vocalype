from __future__ import annotations

import sys
from typing import Any

from brain import BRAIN_ROOT, read_jsonl


INDEX_PATH = BRAIN_ROOT / "data" / "memory_index.jsonl"


def _tokenize(text: str) -> list[str]:
    tokens: list[str] = []
    current = []
    for char in text.lower():
        if char.isalnum() or char in {"_", "-"}:
            current.append(char)
        else:
            if current:
                tokens.append("".join(current))
                current = []
    if current:
        tokens.append("".join(current))
    return [token for token in tokens if len(token) >= 3]


def _score_chunk(query_tokens: set[str], chunk: dict[str, Any]) -> int:
    score = 0
    keywords = {str(item).lower() for item in chunk.get("keywords", [])}
    heading_tokens = set(_tokenize(str(chunk.get("heading", ""))))
    text_tokens = set(_tokenize(str(chunk.get("chunk_text", ""))))
    path_tokens = set(_tokenize(str(chunk.get("file_path", ""))))

    for token in query_tokens:
        if token in keywords:
            score += 5
        if token in heading_tokens:
            score += 4
        if token in path_tokens:
            score += 3
        if token in text_tokens:
            score += 2
    return score


def retrieve_context(query: str, top_k: int = 5) -> list[dict[str, Any]]:
    if not INDEX_PATH.exists() or not INDEX_PATH.read_text(encoding="utf-8").strip():
        return []

    query_tokens = set(_tokenize(query))
    if not query_tokens:
        return []

    rows = read_jsonl(INDEX_PATH)
    scored: list[tuple[int, dict[str, Any]]] = []
    for row in rows:
        score = _score_chunk(query_tokens, row)
        if score > 0:
            scored.append((score, row))

    scored.sort(
        key=lambda item: (
            -item[0],
            str(item[1].get("file_path", "")),
            str(item[1].get("heading", "")),
        )
    )

    results: list[dict[str, Any]] = []
    for score, row in scored[:top_k]:
        item = dict(row)
        item["score"] = score
        results.append(item)
    return results


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit('Usage: python internal/brain/scripts/retrieve_context.py "license activation problem"')

    query = " ".join(sys.argv[1:]).strip()
    if not INDEX_PATH.exists() or not INDEX_PATH.read_text(encoding="utf-8").strip():
        print("Memory index not found. Run: python internal/brain/scripts/index_memory.py")
        return

    results = retrieve_context(query)
    if not results:
        print(f'No relevant context found for "{query}".')
        return

    print(f'Query: "{query}"')
    print("")
    for idx, item in enumerate(results, start=1):
        print(f"[{idx}] score: {item['score']}")
        print(f"file: {item.get('file_path', '')}")
        print(f"heading: {item.get('heading', '')}")
        print(f"content: {item.get('chunk_text', '')}")
        print("")


if __name__ == "__main__":
    main()
