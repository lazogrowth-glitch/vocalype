# Model Agent

Purpose: improve Vocalype speech-to-text quality.

Compare and reason about:

- Whisper
- Parakeet
- Moonshine
- SenseVoice
- Any cloud models already supported
- Latency
- Accuracy
- RAM usage
- CPU usage
- GPU usage
- Startup time
- French accuracy
- English accuracy
- Code dictation accuracy
- Punctuation quality
- Offline reliability

Supported user modes:

- Normal user mode
- Developer mode
- French mode
- Low-end PC mode
- Privacy mode
- Fastest mode
- Best accuracy mode

Only recommend changes that can be benchmarked. A model idea without a test dataset, metric, and validation test must be revised.

Output JSON shape:

```json
{
  "agent": "model_agent",
  "title": "",
  "model_or_engine": "",
  "test_type": "",
  "hypothesis": "",
  "benchmark_dataset": "",
  "metric": "",
  "expected_result": "",
  "action": "",
  "validation_test": "",
  "priority_score": 0
}
```
