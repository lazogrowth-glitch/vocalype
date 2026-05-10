# Vocalype

Vocalype is a desktop speech-to-text application built with Tauri, Rust, React, and TypeScript.

## Repository Map

- `src/`: React frontend, UI state, hooks, and browser-facing utilities
- `src-tauri/`: Tauri app, Rust runtime, native integrations, vendored Rust crates, and eval tooling
- `backend/`: small Python service and admin/security helpers
- `assets/`: repo-managed media such as sponsor assets
- `docs/`: engineering, product, release, and security documentation
- `scripts/`: local developer automation grouped by purpose
- `internal/`: founder/ops workflows, audit artifacts, and autonomous tooling
- `tests/`: Playwright end-to-end coverage
- `public/`: static web assets
- `release/`: release metadata and checklists

## Common Commands

```bash
bun install
bun run dev:frontend
bun run tauri:build
bun run check:translations
bun run eval:parakeet
```

## Development

```bash
bun install
bun run tauri dev
bun run tauri build
```

## Model Setup

```bash
mkdir -p src-tauri/resources/models
curl -o src-tauri/resources/models/silero_vad_v4.onnx https://downloads.vocalype.com/models/silero_vad_v4.onnx
```

## CLI

```bash
vocalype --toggle-transcription
vocalype --toggle-post-process
vocalype --cancel
vocalype --start-hidden
vocalype --no-tray
vocalype --debug
```

On macOS, the bundled binary can be launched directly:

```bash
/Applications/Vocalype.app/Contents/MacOS/Vocalype --toggle-transcription
```

## Manual Model Installation

Typical app data directories:

- macOS: `~/Library/Application Support/com.vocalype.desktop/`
- Windows: `%APPDATA%\com.vocalype.desktop\`
- Linux: `~/.config/com.vocalype.desktop/`

Create the models directory:

```bash
mkdir -p "{app_data_dir}/models"
```

Model downloads:

- Small: `https://downloads.vocalype.com/models/ggml-small.bin`
- Medium: `https://downloads.vocalype.com/models/whisper-medium-q4_1.bin`
- Turbo: `https://downloads.vocalype.com/models/ggml-large-v3-turbo.bin`
- Large: `https://downloads.vocalype.com/models/ggml-large-v3-q5_0.bin`
- Parakeet V2: `https://downloads.vocalype.com/models/parakeet-v2-int8.tar.gz`
- Parakeet V3: `https://downloads.vocalype.com/models/parakeet-v3-int8.tar.gz`

## License

MIT. See [LICENSE](LICENSE).
