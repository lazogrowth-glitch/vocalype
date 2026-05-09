from pathlib import Path
from typing import List, Tuple


# These patterns are always forbidden regardless of config.
_HARDCODED_FORBIDDEN = [
    ".env",
    "secret",
    "payment",
    ".git/",
    "node_modules/",
    "target/",
    "dist/",
]

# These are forbidden unless explicitly listed in allowed_focus_keywords.
_SENSITIVE_PATTERNS = ["license", "auth"]


class RepoGuard:
    def __init__(self, config: dict, repo_root: Path):
        self.forbidden_paths: List[str] = config.get("forbidden_paths", [])
        self.focus_keywords: List[str] = [
            k.lower() for k in config.get("allowed_focus_keywords", [])
        ]
        self.repo_root = repo_root

    def _normalize(self, path: str) -> str:
        return path.lower().replace("\\", "/")

    def is_forbidden(self, file_path: str) -> bool:
        p = self._normalize(file_path)

        for pattern in _HARDCODED_FORBIDDEN:
            if pattern in p:
                return True

        for pattern in _SENSITIVE_PATTERNS:
            if pattern in p:
                return True

        for forbidden in self.forbidden_paths:
            if self._normalize(forbidden) in p:
                return True

        return False

    def is_transcription_related(self, file_path: str) -> bool:
        p = self._normalize(file_path)
        return any(kw in p for kw in self.focus_keywords)

    def validate_patch_files(self, files: List[str]) -> Tuple[bool, List[str]]:
        violations = [f for f in files if self.is_forbidden(f)]
        return len(violations) == 0, violations
