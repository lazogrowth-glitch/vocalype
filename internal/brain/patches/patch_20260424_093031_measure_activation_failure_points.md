# Safe Patch

Title: Measure activation failure points
Safety class: brain_safe
Task type: measurement_task
Manual approval required: Yes (review before applying)

Target files:
- (none â€” Brain/docs files only)

## Reason

Selected because it directly improves Vocalype, scores well, has a clear validation path, and avoids repeating the last implementation lesson.

## Proposed Changes

Patch is `brain_safe`. Changes are limited to non-product files.
Review the target files listed above before applying.

## Exact Implementation Prompt

```
# Mission Codex â€” Measurement Plan Task

Task type: measurement_task

Task title: Measure activation failure points

Goal:
Create a measurement plan for: Measure activation failure points

Do NOT modify product code.

Create: internal/brain/outputs/measure_activation_failure_points.md

Include in the plan:
1. Activation flow steps (all states a user passes through from install to first use)
2. Where users may hesitate or fail (friction points, confusing states, error conditions)
3. Existing files likely involved (inspect only, do not modify)
4. Proposed metrics (e.g. activation_success_rate, steps_to_first_dictation)
5. Events that could be tracked later (once a plan is approved by founder)
6. Manual observation checklist (what to verify without any code changes)
7. Minimal future implementation options (ranked by risk and impact)
8. Risks (what could go wrong with each approach)
9. Recommendation for whether instrumentation is needed and what type

Allowed:
- inspect frontend/auth flow files
- inspect existing hooks/components
- write the measurement plan inside internal/brain/outputs/ as internal/brain/outputs/measure_activation_failure_points.md

Forbidden:
- no product code changes
- no backend changes
- no auth behavior changes
- no license behavior changes
- no new analytics implementation yet
- no event tracking implementation yet

Validation:
- File created: internal/brain/outputs/measure_activation_failure_points.md
- All 9 sections present
- No product code was modified

Safety rules:
- do not apply patches
- do not deploy
- do not delete files
- do not loosen safety rules

Critic review:
The task narrowly focuses on frontend activation steps without addressing backend or Rust components, which may limit its impact. However, the scope reduction aligns with past lessons that UI clarity tasks should prioritize frontend-only work. The risk remains low, and the validation test for activation_success_rate is appropriate. The task avoids sensitive areas like auth and payment, which is a positive constraint. The critic_review should emphasize the trade-off between focused frontend work and potential missed backend issues, while acknowledging the safety of avoiding sensitive systems.

Scope note:
Reduced scope to frontend-first work because past results show UI clarity tasks should avoid backend, auth, payment, security, and Rust files unless a concrete limitation proves they are required.
```

## Validation Plan

The task narrowly focuses on frontend activation steps without addressing backend or Rust components, which may limit its impact. However, the scope reduction aligns with past lessons that UI clarity tasks should prioritize frontend-only work. The risk remains low, and the validation test for activation_success_rate is appropriate. The task avoids sensitive areas like auth and payment, which is a positive constraint. The critic_review should emphasize the trade-off between focused frontend work and potential missed backend issues, while acknowledging the safety of avoiding sensitive systems.

## Risks

- Changes are limited to Brain/docs files.
- No product behavior is affected.
- Revert with `git checkout -- <file>` if needed.

## Rollback Plan

```
git checkout -- <changed files>
```

## Safety Rules

- Do not apply patches to backend/, src-tauri/, auth/client.ts, license/client.ts
- Do not modify payment, billing, or security logic
- Do not modify Rust runtime
- Do not auto-commit
- Do not use --no-verify
- Do not deploy
- Manual approval required before any product file is touched
