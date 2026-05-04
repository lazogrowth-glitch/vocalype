## Task: Analyze Transcription Failures

You will receive:
- Benchmark results (pass/fail, stdout, stderr)
- Previous lessons from memory
- Relevant repo file contents

Your job is to produce a structured failure analysis.

## Required Output Format

```
### Failure Mode
[One sentence: what is going wrong and when]

### Evidence
[Bullet list: specific file names, line numbers, variable names, log output, metric values]
[Do NOT invent evidence. If you have none, say "No benchmark output available."]

### Hypothesis
[One sentence: what change might fix this and why]

### Testable Prediction
[One sentence: what will measurably improve if the hypothesis is correct]

### Risk Assessment
[low / medium / high — and why]
```

## Constraints

- Focus only on transcription-related failures.
- If no benchmark data is available, acknowledge it explicitly.
- Do not propose the same fix that already appears in memory as failed.
- Be specific. Vague answers like "improve audio processing" are not acceptable.
- If you cannot identify a specific failure mode from available evidence, say:
  "Insufficient evidence to identify a specific failure mode. Recommend adding measurement first."
