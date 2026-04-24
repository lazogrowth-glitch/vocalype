# Vocalype Brain — Safe Patch Report

Date: 2026-04-24T09:30:31

## Latest Patch Candidate

- Title: Measure activation failure points
- Safety class: brain_safe
- Task type: measurement_task
- Status: generated
- Manual approval required: Yes
- Target files: none
- Reason: No product files targeted. Task is planning or measurement only; changes are limited to vocalype-brain/ outputs.

## Patch File

- vocalype-brain/patches/patch_20260424_093031_measure_activation_failure_points.md

## Next Action

1. Review the patch file.
2. Apply manually if the change is correct.
3. Run validation commands listed in the patch file.
4. Commit only Brain/docs files after review.

## Safety Rules (always active)

- No product code is modified by this script
- No patch is applied automatically
- Manual approval required before any product file is touched
- Forbidden scope: backend/, src-tauri/, auth/client.ts, license/client.ts, payment, billing, security, translation.json
