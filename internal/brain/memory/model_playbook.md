# Model Playbook

Vocalype model decisions must be benchmarked.

Do not change defaults based on vibes.

Evaluate models by user mode:

- Normal user mode: balanced latency and accuracy
- Developer mode: code terms, punctuation, identifiers
- French mode: French casual and professional speech
- Low-end PC mode: RAM, CPU, startup time
- Privacy mode: local-only reliability
- Fastest mode: lowest usable latency
- Best accuracy mode: lowest WER estimate

Core benchmark metrics:

- median_transcription_latency_ms
- wer_estimate
- ram_mb
- cpu_percent
- gpu_percent
- startup_time_ms
- exact_match_rate for code-sensitive tests

Recommendation rule:

A model change must improve a target metric without reducing first successful dictation.
