# Mission Codex — Implement Approved Vocalype Task

Task title: Measure activation failure points

Original proposal summary:
List each activation step and record where users hesitate, fail, or need support.

Why it matters:
Metric activation_success_rate currently has baseline unknown and target >95%.

Worktree warning:
Warning: the current git worktree already contains unrelated product changes. Review those first or keep the next task narrowly scoped. Example changed files: src/components/onboarding/FirstRunDownload.tsx, src/hooks/useAuthFlow.test.ts, src/lib/userFacingErrors.ts, src/lib/userFacingErrors.test.ts.

Approved scope:
- src/components/auth/AuthPortal.tsx
- src/hooks/useAuthFlow.ts
- src/App.tsx

Forbidden scope:
- backend/app.py
- src-tauri/src/security/secret_store.rs
- src-tauri/src/lib.rs
- src/lib/auth/client.ts
- src/lib/license/client.ts
- payment or billing logic
- auth logic
- license validation logic
- Rust dictation runtime
- translation files

Files to inspect:
- src/components/auth/AuthPortal.tsx
- src/hooks/useAuthFlow.ts
- src/App.tsx

Implementation constraints:
- keep the change small and measurable
- inspect frontend first
- do not touch backend/auth/payment/security/Rust unless a concrete frontend limitation proves it is required
- no new dependencies
- if current repo changes create risk, warn before expanding product scope

Validation commands:
- npm run lint
- python vocalype-brain/scripts/review_quality.py

Manual test plan:
- 1. Run the described baseline measurement on the current build.
- 2. Confirm the metric, baseline, and target are recorded clearly.
- 3. Verify the next decision is obvious from the report.

Rollback plan:
- revert only the touched approved files
- remove the change if the validation test or manual test gets worse

Safety rules:
- do not modify product code outside the approved scope
- do not apply unrelated patches
- do not deploy
- do not delete files
- do not loosen safety rules

Critic review:
The task narrowly focuses on frontend clarity, aligning with past successes. However, the warning about unrelated worktree changes suggests potential scope creep if not carefully managed. The lessons learned emphasize frontend-first approach, which is good, but the mistake log highlights the need to strictly avoid suggesting backend/auth/Rust files unless absolutely necessary.

What to report after implementation:
- every file changed
- commands run and whether they passed
- exact copy/UI/report changes made
- manual test results
- remaining risks or limitations

Scope reduction note:
Reduced scope to frontend-first work because past results show UI clarity tasks should avoid backend, auth, payment, security, and Rust files unless a concrete limitation proves they are required.
