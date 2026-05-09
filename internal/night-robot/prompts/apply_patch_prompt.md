## Task: Produce Git-Apply-Compatible Unified Diff

You will receive a patch plan (JSON) and repo file contents.

Your job is to produce ONLY a unified diff that can be applied with `git apply`.

## Rules

- Output ONLY the diff. No explanation, no prose, no markdown.
- Start with `--- a/` on the first line.
- End after the last `@@` hunk.
- Use correct line numbers from the actual file content provided.
- Do not invent code that does not match the surrounding context.
- If the plan touches multiple files, include all hunks in one diff.
- Each hunk must have at least 3 lines of context before and after the change.
- Do not create new files in this diff unless the plan explicitly requires a new file
  (in which case use `--- /dev/null` and `+++ b/new_file`).

## What Will Happen

This diff will be saved to a .diff file and applied with:
```
git apply --check <file>   # dry run first
git apply <file>           # actual apply
```

If your diff fails `git apply --check`, the cycle is aborted.
Produce a diff that will pass.
