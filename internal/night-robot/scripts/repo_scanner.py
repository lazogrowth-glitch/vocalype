from pathlib import Path
from typing import Dict, List, Tuple

from repo_guard import RepoGuard

_SKIP_DIRS = {"node_modules", "target", "dist", ".git", "__pycache__"}
_EXTENSIONS = {".rs", ".ts", ".tsx", ".js", ".py", ".toml", ".json", ".md"}
_MAX_SNIPPET_LINES = 120
_TAIL_LINES = 20


class RepoScanner:
    def __init__(self, repo_root: Path, guard: RepoGuard, max_file_size_kb: int = 150):
        self.repo_root = repo_root
        self.guard = guard
        self.max_file_size_kb = max_file_size_kb

    def scan(self, max_files: int = 25) -> Dict:
        candidates: List[Tuple[str, float, Path]] = []

        for path in self.repo_root.rglob("*"):
            if not path.is_file():
                continue
            if any(skip in path.parts for skip in _SKIP_DIRS):
                continue
            if path.suffix not in _EXTENSIONS:
                continue

            rel = path.relative_to(self.repo_root).as_posix()

            if self.guard.is_forbidden(rel):
                continue
            if not self.guard.is_transcription_related(rel):
                continue

            size_kb = path.stat().st_size / 1024
            candidates.append((rel, size_kb, path))

        candidates.sort(key=lambda x: x[1])

        result: Dict = {
            "files": [],
            "total_found": len(candidates),
            "snippets": {},
        }

        for rel, size_kb, path in candidates[:max_files]:
            result["files"].append({"path": rel, "size_kb": round(size_kb, 1)})

            if size_kb > self.max_file_size_kb:
                result["snippets"][rel] = f"[file too large to include: {size_kb:.0f} KB]"
                continue

            try:
                content = path.read_text(encoding="utf-8", errors="ignore")
                lines = content.splitlines()
                if len(lines) > _MAX_SNIPPET_LINES:
                    kept = lines[:(_MAX_SNIPPET_LINES - _TAIL_LINES)]
                    omitted = len(lines) - _MAX_SNIPPET_LINES
                    tail = lines[-_TAIL_LINES:]
                    snippet = (
                        "\n".join(kept)
                        + f"\n\n... ({omitted} lines omitted) ...\n\n"
                        + "\n".join(tail)
                    )
                else:
                    snippet = content
                result["snippets"][rel] = snippet
            except Exception as exc:
                result["snippets"][rel] = f"[could not read: {exc}]"

        return result

    def format_for_prompt(self, scan_result: Dict, max_chars: int = 10000) -> str:
        lines = [
            f"## Repo Scan — {scan_result['total_found']} transcription-related files\n"
        ]
        for f in scan_result["files"]:
            lines.append(f"- {f['path']} ({f['size_kb']} KB)")

        lines.append("\n## File Contents\n")
        total = 0

        for rel, content in scan_result["snippets"].items():
            if total >= max_chars:
                lines.append(f"\n### {rel}\n[context limit reached — omitted]")
                continue

            remaining = max_chars - total
            if len(content) > remaining:
                content = content[:remaining] + "\n... [truncated]"

            lines.append(f"\n### {rel}\n```\n{content}\n```")
            total += len(content)

        return "\n".join(lines)
