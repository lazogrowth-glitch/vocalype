# Safe Patch

Title: Append V3.5 lesson to lessons_learned.md
Safety class: brain_safe
Task type: brain_improvement
Manual approval required: Yes (review before applying)

Target files:
- internal/brain/memory/lessons_learned.md

## Reason

V3.5 validated that the approved patch application gate correctly requires an
explicit --approve flag and refuses patches that have no structured Apply
Instructions section. This lesson should be recorded in Brain memory so future
task generation and patch proposals account for it.

## Proposed Changes

Patch is `brain_safe`. Changes are limited to internal/brain/ memory files.
Review the target file listed above before applying.

## Apply Instructions

target_file: internal/brain/memory/lessons_learned.md
operation: append
content:
- 2026-04-24 V3.5 lesson: Approved patch application must require explicit --approve and must refuse patches without Apply Instructions.

## Validation Plan

After applying:
1. Read internal/brain/memory/lessons_learned.md â€” confirm the new line is present.
2. Confirm no product code was modified (git status --short should show only internal/brain/ files).
3. Confirm applied_patches.jsonl has a new record with status: applied.

## Risks

- Changes are limited to Brain memory files.
- No product behavior is affected.
- Revert with `git checkout -- internal/brain/memory/lessons_learned.md` if needed.

## Rollback Plan

```
git checkout -- internal/brain/memory/lessons_learned.md
```

## Safety Rules

- Do not apply patches to backend/, src-tauri/, auth/client.ts, license/client.ts
- Do not modify payment, billing, or security logic
- Do not modify Rust runtime
- Do not auto-commit
- Do not use --no-verify
- Do not deploy
- Manual approval required before any product file is touched
