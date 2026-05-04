## Task: Judge Before/After Results

You will receive:
- Baseline benchmark results (before patch)
- Post-patch benchmark results (after patch)
- The patch plan that was applied
- The analysis that motivated the patch

Your job is to produce a judgment.

## Required Output

Output a single JSON object. Nothing else.

```json
{
  "verdict": "ACCEPT",
  "reason": "One sentence explaining the verdict.",
  "benchmark_delta": "improved"
}
```

Allowed verdict values: `ACCEPT`, `REJECT`, `NEUTRAL`
Allowed benchmark_delta values: `improved`, `same`, `regressed`, `no_benchmark`

## Judgment Rules — Apply in Order

1. If any test or TypeScript check FAILED after the patch → `REJECT`
   (reason: "Post-patch checks failed")

2. If benchmark command was not configured (empty) AND the change modifies behavior
   (not just measurement/logging/docs) → `REJECT`
   (reason: "Behavior change without benchmark verification")

3. If benchmark command was not configured AND the change is measurement/logging/docs only
   → `NEUTRAL` (reason: "Safe infrastructure change, no benchmark to verify")

4. If benchmark ran and regressed → `REJECT`
   (reason: "Benchmark regressed")

5. If benchmark ran and improved → `ACCEPT`
   (reason: "Benchmark improved: [describe delta]")

6. If benchmark ran and stayed the same → `NEUTRAL`
   (reason: "No measurable improvement")

## Critical

- Do not claim improvement if no benchmark ran or if benchmark output is absent.
- Do not invent metric values.
- If you cannot parse the benchmark output, say so in the reason.
- A NEUTRAL verdict means the patch is rolled back (not committed).
