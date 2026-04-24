from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

from brain import BRAIN_ROOT, ensure_brain_structure


INDEX_PATH = BRAIN_ROOT / "data" / "memory_index.jsonl"
MEMORY_DIR = BRAIN_ROOT / "memory"
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
WORD_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9_-]{2,}")
STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "your",
    "have",
    "will",
    "should",
    "what",
    "when",
    "where",
    "which",
    "their",
    "about",
    "vocalype",
    "brain",
}


def _clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _extract_keywords(text: str, limit: int = 12) -> list[str]:
    counts: dict[str, int] = {}
    for match in WORD_RE.finditer(text.lower()):
        token = match.group(0)
        if token in STOPWORDS:
            continue
        counts[token] = counts.get(token, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [word for word, _ in ranked[:limit]]


def _finalize_chunk(file_path: Path, heading: str, lines: list[str]) -> list[dict[str, str | list[str]]]:
    text = _clean_text("\n".join(lines))
    if not text:
        return []

    chunks: list[dict[str, str | list[str]]] = []
    max_len = 900
    parts = text.split(". ")
    current = ""
    for part in parts:
        candidate = part if not current else f"{current}. {part}"
        if len(candidate) <= max_len:
            current = candidate
            continue
        if current:
            chunk_text = current.strip()
            chunks.append(
                {
                    "file_path": str(file_path.relative_to(BRAIN_ROOT)).replace("\\", "/"),
                    "heading": heading,
                    "chunk_text": chunk_text,
                    "keywords": _extract_keywords(f"{heading} {chunk_text}"),
                    "updated_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
                }
            )
        current = part

    if current.strip():
        chunk_text = current.strip()
        chunks.append(
            {
                "file_path": str(file_path.relative_to(BRAIN_ROOT)).replace("\\", "/"),
                "heading": heading,
                "chunk_text": chunk_text,
                "keywords": _extract_keywords(f"{heading} {chunk_text}"),
                "updated_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
            }
        )
    return chunks


def _chunk_markdown(file_path: Path, text: str) -> list[dict[str, str | list[str]]]:
    lines = text.splitlines()
    if not _clean_text(text):
        return []

    chunks: list[dict[str, str | list[str]]] = []
    current_heading = file_path.stem.replace("_", " ").title()
    current_lines: list[str] = []

    for line in lines:
        heading_match = HEADING_RE.match(line.strip())
        if heading_match:
            chunks.extend(_finalize_chunk(file_path, current_heading, current_lines))
            current_heading = heading_match.group(2).strip()
            current_lines = []
            continue
        current_lines.append(line)

    chunks.extend(_finalize_chunk(file_path, current_heading, current_lines))
    return chunks


def index_memory() -> list[dict[str, str | list[str]]]:
    ensure_brain_structure()
    if not MEMORY_DIR.exists():
        INDEX_PATH.write_text("", encoding="utf-8")
        return []

    rows: list[dict[str, str | list[str]]] = []
    for path in sorted(MEMORY_DIR.glob("*.md")):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        if not _clean_text(text):
            continue
        rows.extend(_chunk_markdown(path, text))

    INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    with INDEX_PATH.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    return rows


def main() -> None:
    rows = index_memory()
    print(f"Indexed {len(rows)} memory chunks into vocalype-brain/data/memory_index.jsonl")


if __name__ == "__main__":
    main()
