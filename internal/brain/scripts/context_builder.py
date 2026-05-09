from __future__ import annotations

from brain import read_text
from retrieve_context import retrieve_context


def build_context(query: str, max_chunks: int = 5) -> str:
    try:
        context_rules = read_text("memory/context_rules.md").strip()
    except FileNotFoundError:
        context_rules = "Context rules file missing. Confidence is low until rules are restored."

    chunks = retrieve_context(query, top_k=max_chunks)
    lines = [
        "CONTEXT RULES:",
        context_rules,
        "",
        "RELEVANT VOCALYPE MEMORY:",
    ]

    if chunks:
        for index, chunk in enumerate(chunks, start=1):
            lines.extend(
                [
                    f"[{index}] file: {chunk.get('file_path', '')}",
                    f"heading: {chunk.get('heading', '')}",
                    f"content: {chunk.get('chunk_text', '')}",
                    "",
                ]
            )
    else:
        lines.extend(
            [
                "No relevant Vocalype memory retrieved.",
                "",
            ]
        )

    lines.extend(
        [
            "INSTRUCTION:",
            "Use only retrieved Vocalype facts for product-specific claims.",
            "Use general knowledge only for reasoning patterns.",
            "If evidence is missing, say confidence is low.",
            "Cite which memory files were used.",
            "Return metric, validation test, risk, and next step.",
        ]
    )
    return "\n".join(lines).strip() + "\n"
