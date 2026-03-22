# CLAUDE.md

This repository contains Vocalype, a Tauri desktop speech-to-text application.

## Development

```bash
bun install
bun run tauri dev
bun run tauri build
bun run lint
bun run format
```

## Model Setup

```bash
mkdir -p src-tauri/resources/models
curl -o src-tauri/resources/models/silero_vad_v4.onnx https://downloads.vocalype.com/models/silero_vad_v4.onnx
```

## Architecture

- `src-tauri/src/lib.rs`: Tauri bootstrap, managers, tray, commands.
- `src-tauri/src/managers/`: audio, model, transcription, history.
- `src/`: React settings UI, onboarding, stores, translations.
- `src/overlay/`: recording overlay window.

## Notes

- Use i18n for user-facing strings.
- Run `cargo fmt` and frontend formatting before shipping.
- CLI flags are defined in `src-tauri/src/cli.rs`.
