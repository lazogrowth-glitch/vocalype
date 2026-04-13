#!/usr/bin/env python3
"""Build Vocalype Parakeet eval manifests from external ASR datasets.

The script intentionally samples a bounded subset. Keep large corpora outside git,
convert only the clips you want to evaluate, then feed the generated manifest to
`cargo run --example parakeet_pipeline_eval`.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import random
import shutil
import subprocess
import sys
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT_ROOT = REPO_ROOT / "src-tauri" / "evals" / "parakeet" / "external"
SAMPLE_RATE = 16_000


@dataclass(frozen=True)
class Candidate:
    dataset: str
    language: str
    source_audio: Path | None
    reference_text: str
    source_id: str
    scenario: str
    tags: list[str]
    accent: str | None = None
    duration_bucket: str | None = None
    audio_array: object | None = None
    audio_sampling_rate: int | None = None


def main() -> int:
    args = parse_args()
    out_dir = args.output_dir
    audio_dir = out_dir / "audio"
    manifest_path = out_dir / args.manifest_name
    audio_dir.mkdir(parents=True, exist_ok=True)

    candidates = list(load_candidates(args))
    sampled = sample_candidates(candidates, args.max_per_language, args.seed)
    if not sampled:
        raise SystemExit("No samples matched the requested dataset/language filters.")

    manifest_samples = []
    for index, candidate in enumerate(sampled, start=1):
        sample_id = stable_sample_id(candidate, index)
        wav_path = audio_dir / f"{sample_id}.wav"
        write_candidate_audio(candidate, wav_path)
        manifest_samples.append(
            {
                "sample_id": sample_id,
                "scenario": candidate.scenario,
                "audio_path": f"audio/{wav_path.name}",
                "reference_text": candidate.reference_text,
                "language": candidate.language,
                "accent": candidate.accent,
                "noise_level": None,
                "mic_type": "unknown",
                "duration_bucket": candidate.duration_bucket,
                "speech_rate": "normal",
                "tags": candidate.tags,
            }
        )

    manifest = {
        "version": 1,
        "samples": manifest_samples,
        "metadata": {
            "dataset": args.dataset,
            "source_dir": str(args.source_dir) if args.source_dir else None,
            "languages": args.languages,
            "max_per_language": args.max_per_language,
            "seed": args.seed,
        },
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(manifest_samples)} samples to {manifest_path}")
    print(f"Audio written to {audio_dir}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare external ASR samples for Vocalype Parakeet evals."
    )
    parser.add_argument(
        "--dataset",
        choices=["common_voice", "librispeech", "fleurs"],
        required=True,
        help="External dataset adapter to use.",
    )
    parser.add_argument(
        "--source-dir",
        type=Path,
        help="Local dataset root. Required for common_voice and librispeech.",
    )
    parser.add_argument(
        "--languages",
        nargs="+",
        default=["en", "fr"],
        help="Language codes to include. Examples: en fr es pt hi.",
    )
    parser.add_argument(
        "--max-per-language",
        type=int,
        default=25,
        help="Maximum sampled clips per language.",
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUT_ROOT / "current",
        help="Output folder that will contain audio/ and the manifest.",
    )
    parser.add_argument(
        "--manifest-name",
        default="dataset_manifest_external.json",
        help="Manifest file name inside output-dir.",
    )
    parser.add_argument(
        "--fleurs-configs",
        nargs="*",
        help="Optional explicit Hugging Face FLEURS configs, e.g. en_us fr_fr hi_in.",
    )
    parser.add_argument(
        "--fleurs-split",
        default="test",
        choices=["train", "validation", "test"],
        help="FLEURS split to sample.",
    )
    return parser.parse_args()


def load_candidates(args: argparse.Namespace) -> Iterable[Candidate]:
    languages = {normalize_language(language) for language in args.languages}
    if args.dataset in {"common_voice", "librispeech"} and not args.source_dir:
        raise SystemExit(f"--source-dir is required for {args.dataset}")

    if args.dataset == "common_voice":
        yield from load_common_voice(args.source_dir, languages)
    elif args.dataset == "librispeech":
        yield from load_librispeech(args.source_dir, languages)
    elif args.dataset == "fleurs":
        yield from load_fleurs(args, languages)


def load_common_voice(source_dir: Path, languages: set[str]) -> Iterable[Candidate]:
    roots = discover_common_voice_roots(source_dir)
    for language, root in roots:
        if normalize_language(language) not in languages:
            continue
        tsv_path = first_existing(root, ["validated.tsv", "test.tsv", "dev.tsv"])
        clips_dir = root / "clips"
        if not tsv_path or not clips_dir.exists():
            continue
        with tsv_path.open("r", encoding="utf-8", newline="") as handle:
            reader = csv.DictReader(handle, delimiter="\t")
            for row in reader:
                sentence = (row.get("sentence") or "").strip()
                clip_path = row.get("path") or ""
                if not sentence or not clip_path:
                    continue
                audio_path = clips_dir / clip_path
                if not audio_path.exists():
                    continue
                yield Candidate(
                    dataset="common_voice",
                    language=normalize_language(language),
                    source_audio=audio_path,
                    reference_text=sentence,
                    source_id=clip_path,
                    scenario=f"common_voice_{normalize_language(language)}",
                    tags=["external", "common_voice", "validated"],
                    accent=(row.get("accents") or None),
                    duration_bucket=None,
                )


def discover_common_voice_roots(source_dir: Path) -> list[tuple[str, Path]]:
    if (source_dir / "validated.tsv").exists() and (source_dir / "clips").exists():
        return [(infer_language_from_path(source_dir), source_dir)]
    roots = []
    for child in source_dir.iterdir():
        if child.is_dir() and (child / "validated.tsv").exists() and (child / "clips").exists():
            roots.append((infer_language_from_path(child), child))
    return roots


def load_librispeech(source_dir: Path, languages: set[str]) -> Iterable[Candidate]:
    if "en" not in languages:
        return
    scenario = infer_librispeech_scenario(source_dir)
    condition_tag = scenario.removeprefix("librispeech_")
    for transcript_path in sorted(source_dir.rglob("*.trans.txt")):
        with transcript_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                utterance_id, _, text = line.partition(" ")
                audio_path = transcript_path.parent / f"{utterance_id}.flac"
                if not audio_path.exists():
                    audio_path = transcript_path.parent / f"{utterance_id}.wav"
                if not audio_path.exists():
                    continue
                yield Candidate(
                    dataset="librispeech",
                    language="en",
                    source_audio=audio_path,
                    reference_text=text.strip(),
                    source_id=utterance_id,
                    scenario=scenario,
                    tags=["external", "librispeech", "read_speech", condition_tag],
                )


def infer_librispeech_scenario(source_dir: Path) -> str:
    parts = {part.lower() for part in source_dir.parts}
    name = source_dir.name.lower()
    if "test-other" in parts or "dev-other" in parts or "train-other-500" in parts or "other" in name:
        return "librispeech_other"
    return "librispeech_clean"


def load_fleurs(args: argparse.Namespace, languages: set[str]) -> Iterable[Candidate]:
    try:
        from datasets import Audio, load_dataset
    except ImportError as exc:
        raise SystemExit(
            "FLEURS import requires the optional Python package `datasets`. "
            "Install it with: python -m pip install datasets"
        ) from exc

    configs = args.fleurs_configs or [default_fleurs_config(language) for language in languages]
    for config in configs:
        language = normalize_language(config)
        if language not in languages:
            continue
        dataset = load_dataset(
            "google/fleurs",
            config,
            split=args.fleurs_split,
            trust_remote_code=True,
        )
        dataset = dataset.cast_column("audio", Audio(sampling_rate=SAMPLE_RATE))
        for row in dataset:
            transcription = (row.get("transcription") or row.get("raw_transcription") or "").strip()
            if not transcription:
                continue
            audio = row["audio"]
            yield Candidate(
                dataset="fleurs",
                language=language,
                source_audio=Path(audio["path"]) if audio.get("path") else None,
                reference_text=transcription,
                source_id=str(row.get("id", audio.get("path", "fleurs"))),
                scenario=f"fleurs_{language}",
                tags=["external", "fleurs", "read_speech", args.fleurs_split],
                audio_array=audio["array"],
                audio_sampling_rate=int(audio["sampling_rate"]),
            )


def sample_candidates(candidates: list[Candidate], max_per_language: int, seed: int) -> list[Candidate]:
    by_language: dict[str, list[Candidate]] = {}
    for candidate in candidates:
        by_language.setdefault(candidate.language, []).append(candidate)

    rng = random.Random(seed)
    sampled: list[Candidate] = []
    for language in sorted(by_language):
        rows = by_language[language]
        rng.shuffle(rows)
        sampled.extend(rows[:max_per_language])
    return sampled


def write_candidate_audio(candidate: Candidate, wav_path: Path) -> None:
    if candidate.audio_array is not None:
        write_float_wav(candidate.audio_array, wav_path)
        return
    if not candidate.source_audio:
        raise RuntimeError(f"No source audio for {candidate.source_id}")
    convert_audio(candidate.source_audio, wav_path)


def convert_audio(source: Path, destination: Path) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("ffmpeg is required to convert external dataset audio to 16kHz mono WAV.")
    command = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(source),
        "-ar",
        str(SAMPLE_RATE),
        "-ac",
        "1",
        str(destination),
    ]
    subprocess.run(command, check=True)


def write_float_wav(samples: object, destination: Path) -> None:
    frames = bytearray()
    for sample in samples:
        clipped = max(-1.0, min(1.0, float(sample)))
        value = int(clipped * 32767.0)
        frames.extend(value.to_bytes(2, byteorder="little", signed=True))
    with wave.open(str(destination), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(bytes(frames))


def stable_sample_id(candidate: Candidate, index: int) -> str:
    digest = hashlib.sha1(candidate.source_id.encode("utf-8")).hexdigest()[:10]
    safe_dataset = safe_token(candidate.dataset)
    safe_language = safe_token(candidate.language)
    return f"{safe_dataset}_{safe_language}_{index:04d}_{digest}"


def normalize_language(language: str) -> str:
    lowered = language.lower().replace("-", "_")
    return lowered.split("_")[0]


def default_fleurs_config(language: str) -> str:
    return {
        "en": "en_us",
        "fr": "fr_fr",
        "es": "es_419",
        "pt": "pt_br",
        "hi": "hi_in",
    }.get(normalize_language(language), language)


def infer_language_from_path(path: Path) -> str:
    name = path.name.lower()
    for token in ["en", "fr", "es", "pt", "hi"]:
        if name == token or name.startswith(f"{token}_") or name.startswith(f"{token}-"):
            return token
    return name.split("_")[0].split("-")[0]


def first_existing(root: Path, names: list[str]) -> Path | None:
    for name in names:
        path = root / name
        if path.exists():
            return path
    return None


def safe_token(value: str) -> str:
    return "".join(ch if ch.isalnum() else "_" for ch in value.lower()).strip("_") or "sample"


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"Audio conversion failed: {exc}") from exc
