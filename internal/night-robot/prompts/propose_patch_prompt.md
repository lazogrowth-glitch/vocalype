## Task: Propose One Patch

You will receive:
- A failure analysis with a hypothesis
- Repo file contents
- Constraints (max files, max lines, forbidden paths)

Your job is to propose exactly one small patch.

## Required Output

Output a single JSON object. Nothing else before or after it.

```json
{
  "files_to_modify": ["path/to/file.rs"],
  "reason": "One sentence explaining why this file needs to change.",
  "expected_improvement": "One sentence: what metric improves and by how much.",
  "risk_level": "low",
  "commands_after": ["cargo build --release"],
  "rollback_plan": "git checkout -- path/to/file.rs",
  "unified_diff": "--- a/path/to/file.rs\n+++ b/path/to/file.rs\n@@ -10,6 +10,6 @@\n ..."
}
```

If you cannot produce a safe patch, output:
```json
{"skip": true, "reason": "Explanation of why no safe patch is possible right now."}
```

## Patch Rules

1. Only modify files related to: transcription, audio, VAD, chunking, STT model config,
   post-processing, latency, benchmarks.
2. Never modify forbidden paths.
3. Do not exceed max_patch_files or max_patch_lines.
4. The unified_diff must be git-apply compatible (standard unified diff format).
5. If the diff would break compilation or type checks, output skip instead.
6. Prefer adding measurement/logging over changing behavior if evidence is weak.
7. One hypothesis. One change. Not two.

## Diff Format Reminder

```
--- a/src-tauri/src/managers/transcription.rs
+++ b/src-tauri/src/managers/transcription.rs
@@ -42,7 +42,7 @@
     context around change
-    old line
+    new line
     context around change
```

The diff must start with `---` and must be valid for `git apply`.
