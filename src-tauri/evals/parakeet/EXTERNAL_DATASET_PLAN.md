# External Dataset Plan

Reminder for future work: before scaling the external ASR benchmark, ask whether
we need to buy storage.

## Current Decision

Do not buy a disk immediately. First run small external benchmark samples with
the importer:

- LibriSpeech test-clean / test-other
- FLEURS small sample for en, fr, es, pt, hi
- Common Voice small sample for en, fr, es, pt, hi

Expected space for phase 1: about 20-50 GB free.

## When To Buy

Buy storage if we move from smoke tests to a serious benchmark with hundreds or
thousands of clips per language.

Recommended purchase:

- Minimum: reliable 2 TB external SSD
- Better: reliable 4 TB external SSD
- Avoid suspicious ultra-cheap 2 TB drives from unknown brands

Good brand families to consider:

- Crucial X9 / X10
- Samsung T7 / T9
- SanDisk Extreme Portable SSD
- WD / Seagate / Toshiba if choosing a cheaper HDD

## Suggested Disk Layout

```text
D:\VocalypeDatasets\
  raw\
    common_voice\
    librispeech\
    fleurs\
  prepared\
    common_voice_smoke\
    librispeech_test_clean\
    fleurs_smoke\
  reports\
```

## Benchmark Rule

Use external datasets as holdout data. Do not keep a correction just because it
makes the local 70-audio benchmark perfect. Keep changes only when they improve
or do not regress:

- the local Vocalype pack
- a fresh external sample
- the main user-language distribution: English first, then Spanish, French,
  Portuguese, Hindi
