# Vocalype vs OpenWhispr — Gap Analysis

**Date:** 2026-03-22
**Purpose:** Identify feature gaps between Vocalype and OpenWhispr, ranked by business and user impact, with concrete implementation guidance grounded in the current Vocalype architecture.

---

## Summary Table

| # | Feature Gap | Priority | Effort |
|---|-------------|----------|--------|
| 1 | AI Agent Mode | HIGH | XL |
| 2 | Notes System | HIGH | XL |
| 3 | Meeting Transcription | HIGH | XL |
| 4 | Multiple Cloud Transcription Providers | MEDIUM | L |
| 5 | Auto-Learn Dictionary | MEDIUM | M |
| 6 | Audio File Upload + Transcription UI | MEDIUM | M |
| 7 | Local LLM Agent (llama.cpp) | MEDIUM | L |
| 8 | Referral System | MEDIUM | M |
| 9 | Account System Enhancements (Stripe tiers, usage tracking) | MEDIUM | L |
| 10 | Auto-Pause Media | LOW | S |
| 11 | Command Palette (Cmd+K) | LOW | M |
| 12 | Draggable Floating Panel | LOW | S |
| 13 | Three Hotkey Slots | LOW | S |
| 14 | Globe / Fn Key Support (macOS) | LOW | S |
| 15 | AI Actions on Transcription (discoverable UI) | LOW | S |

---

## HIGH Priority Gaps

---

### 1. AI Agent Mode

**Priority:** HIGH
**Effort:** XL

#### Current State in Vocalype

Vocalype has a post-processing LLM pipeline (`src-tauri/src/processing/post_processing.rs`) and an `LlmTextProvider` trait (`src-tauri/src/llm/mod.rs`) routing to OpenAI-compatible, Anthropic, and Gemini endpoints. This pipeline operates one-shot: transcription in, processed text out. There is no conversational state, no dedicated chat window, and no voice-activation layer that strips a wake word before pasting.

The `shortcut/handler.rs` handles a single recording hotkey. The overlay window (`src/overlay/`, `src-tauri/src/platform/overlay.rs`) is a fixed-size recording status bar; it does not accept user input or display streamed AI output.

#### What OpenWhispr Does

- A separate glassmorphism chat overlay window toggled by a dedicated `AGENT_KEY` hotkey.
- Real-time streaming AI responses via OpenAI, Anthropic, Gemini, Groq, and local llama.cpp.
- Persistent, resumable conversation history stored alongside transcription history.
- User-configurable agent name and system prompt.
- Voice-command activation: saying "Hey [AgentName]..." triggers agent mode instead of dictation paste.
- The agent name prefix is stripped from the dictation output before it reaches the chat.

#### Implementation Approach

**Rust backend:**

- Add `AgentConversation` struct to `src-tauri/src/managers/` (new file `agent.rs`): holds `Vec<Message>` with role/content, persisted to a `agent_history.db` SQLite table alongside the existing `history.db`.
- Extend `src-tauri/src/settings/shortcuts.rs` `ShortcutBinding` — the struct already supports arbitrary IDs; add a second binding with id `"agent"`.
- Add streaming support to `src-tauri/src/llm/llm_client.rs`: implement SSE/chunked-response reading and emit incremental tokens via a Tauri event (`agent-token`).
- Add wake-word detection in `src-tauri/src/runtime/transcription_coordinator.rs`: after transcription, check if text begins with the configured agent name (case-insensitive prefix match), strip it, and route to the agent manager instead of paste.
- New Tauri commands in `src-tauri/src/commands/` (new file `agent.rs`): `send_agent_message`, `get_agent_history`, `clear_agent_history`, `set_agent_config`.

**Frontend:**

- New Tauri window `agent_overlay` (separate from `recording_overlay`) created in `src-tauri/src/platform/` (new file `agent_overlay.rs`), using `tauri-nspanel` on macOS and `WebviewWindowBuilder` elsewhere. Window should be transparent, `always_on_top`, non-activating.
- New React root `src/agent/` with `AgentOverlay.tsx`: glassmorphism styled chat bubble list, a text input, and a streaming token renderer listening to `agent-token` events.
- Settings UI additions in `src/components/settings/` for agent name, system prompt, and model selection.
- i18n keys for all user-facing strings.

**Files to create:**
- `src-tauri/src/managers/agent.rs`
- `src-tauri/src/commands/agent.rs`
- `src-tauri/src/platform/agent_overlay.rs`
- `src/agent/main.tsx`
- `src/agent/AgentOverlay.tsx`
- `src/agent/index.html`
- `src/components/settings/agent/AgentSettings.tsx`

**Files to modify:**
- `src-tauri/src/managers/mod.rs` — register `AgentManager`
- `src-tauri/src/settings/shortcuts.rs` — add agent binding
- `src-tauri/src/llm/llm_client.rs` — add streaming path
- `src-tauri/src/runtime/transcription_coordinator.rs` — wake-word routing
- `src-tauri/src/lib.rs` — register commands, create window on startup
- `src-tauri/tauri.conf.json` — declare new window

---

### 2. Notes System

**Priority:** HIGH
**Effort:** XL

#### Current State in Vocalype

Vocalype stores transcription history in `history.db` (SQLite via `rusqlite`, managed by `src-tauri/src/managers/history.rs`). Entries have a title, raw transcription, post-processed text, and a WAV file reference. There is no free-form notes editor, no folder organization, no full-text search across notes, no rich-text editing, and no inline dictation widget inside a note document.

The history UI (`src/components/settings/history/HistorySettings.tsx`) is a read-only list.

#### What OpenWhispr Does

- SQLite with FTS5 virtual table for full-text search across note content.
- Tiptap rich-text editor embedded in the notes view.
- Folder hierarchy with drag-and-drop reordering.
- Cmd+K command palette that searches both notes and transcription history simultaneously.
- An inline dictation widget that can be triggered from within an open note.
- Audio file upload that transcribes and creates a note automatically.
- AI action templates applied to note content.
- Optional cloud sync.

#### Implementation Approach

**Rust backend:**

- New SQLite database `notes.db` (separate from `history.db` to avoid migration entanglement). Schema: `notes(id, folder_id, title, content_json, created_at, updated_at)`, `folders(id, parent_id, name, position)`. Add FTS5 virtual table `notes_fts(content)` with triggers keeping it in sync.
- New manager `src-tauri/src/managers/notes.rs` with CRUD + FTS search methods.
- New commands file `src-tauri/src/commands/notes.rs`: `create_note`, `update_note`, `delete_note`, `get_note`, `list_notes`, `search_notes`, `create_folder`, `move_note`, `reorder_folders`.
- Reuse existing `src-tauri/src/commands/transcription.rs` audio-file transcription path for the "upload audio → create note" flow.

**Frontend:**

- New top-level route/section `Notes` in `src/App.tsx`.
- `src/components/notes/NotesLayout.tsx` — sidebar with folder tree + note list, main pane with editor.
- Tiptap editor integration (`@tiptap/react`, `@tiptap/starter-kit`) in `src/components/notes/NoteEditor.tsx`.
- Folder drag-and-drop via `@dnd-kit/core`.
- Inline dictation widget: a small button inside the editor toolbar that triggers the existing `start_recording` Tauri command and inserts resulting text at cursor position.
- Command palette component `src/components/ui/CommandPalette.tsx` (see gap 11 for reuse).

**Files to create:**
- `src-tauri/src/managers/notes.rs`
- `src-tauri/src/commands/notes.rs`
- `src/components/notes/NotesLayout.tsx`
- `src/components/notes/NoteEditor.tsx`
- `src/components/notes/FolderTree.tsx`

**Files to modify:**
- `src-tauri/src/managers/mod.rs` — register `NotesManager`
- `src-tauri/src/lib.rs` — register note commands
- `src/App.tsx` — add Notes route

---

### 3. Meeting Transcription

**Priority:** HIGH
**Effort:** XL

#### Current State in Vocalype

Vocalype records from a selected microphone using a push-to-talk or VAD mode (`src-tauri/src/audio_toolkit/`, `src-tauri/src/managers/audio.rs`). Transcription runs locally (Whisper) or via an OpenAI-compatible cloud endpoint. There is no calendar integration, no meeting process detection, no system audio loopback capture, no WebSocket-based real-time transcription, and no concept of a "meeting" as a distinct entity.

#### What OpenWhispr Does

- Google Calendar OAuth 2.0 PKCE flow to fetch upcoming meetings.
- Process monitoring on macOS/Windows to detect when Zoom, Teams, or FaceTime is running.
- Audio analysis (VAD + presence of two distinct speakers) as a secondary detection signal.
- Live transcription using the OpenAI Realtime API over WebSocket with incremental transcript events.
- Meeting transcripts saved as notes with speaker-labeled segments.
- Upcoming meetings shown in a sidebar.
- Dedicated meeting hotkey (third `ShortcutBinding` slot).

#### Implementation Approach

**Rust backend:**

- OAuth PKCE helper in `src-tauri/src/security/` (new file `oauth.rs`): generate verifier/challenge, open browser, handle redirect on a local HTTP server (e.g., `tiny_http`), exchange code for tokens, store refresh token via existing `src-tauri/src/security/secret_store.rs`.
- Google Calendar API client in `src-tauri/src/managers/` (new file `calendar.rs`): fetch `events.list` for the next 24 h.
- Process monitor in `src-tauri/src/platform/` (new file `process_monitor.rs`): poll `sysinfo` crate for Zoom/Teams/FaceTime process presence; emit `meeting-app-detected` Tauri event.
- WebSocket transcription client in `src-tauri/src/managers/transcription/` (new file `realtime.rs`): connect to `wss://api.openai.com/v1/realtime`, send audio chunks, receive delta events, emit `meeting-transcript-delta` to the frontend.
- System audio loopback capture: on macOS use `ScreenCaptureKit` via Swift helper or `coreaudio-sys`; on Windows use WASAPI loopback via existing `cpal` device enumeration (loopback device ID). This is the highest-risk sub-task.
- New meeting commands in `src-tauri/src/commands/` (new file `meetings.rs`): `start_meeting_transcription`, `stop_meeting_transcription`, `get_upcoming_meetings`, `get_meeting_transcript`.
- Extend `src-tauri/src/settings/shortcuts.rs` with a third binding id `"meeting"`.

**Frontend:**

- New `src/components/meetings/` section with `MeetingsSidebar.tsx` (upcoming meeting list), `MeetingTranscriptView.tsx` (live delta rendering).
- Settings panel for Calendar OAuth connect/disconnect.
- i18n strings for all meeting-related UI.

**Files to create:**
- `src-tauri/src/security/oauth.rs`
- `src-tauri/src/managers/calendar.rs`
- `src-tauri/src/platform/process_monitor.rs`
- `src-tauri/src/managers/transcription/realtime.rs`
- `src-tauri/src/commands/meetings.rs`
- `src/components/meetings/MeetingsSidebar.tsx`
- `src/components/meetings/MeetingTranscriptView.tsx`

**Files to modify:**
- `src-tauri/src/settings/shortcuts.rs` — third hotkey slot
- `src-tauri/src/lib.rs` — register commands and process monitor startup
- `src-tauri/Cargo.toml` — add `tiny_http`, `sysinfo`, `tokio-tungstenite`

---

## MEDIUM Priority Gaps

---

### 4. Multiple Cloud Transcription Providers

**Priority:** MEDIUM
**Effort:** L

#### Current State in Vocalype

Cloud transcription is routed through a single OpenAI-compatible HTTP endpoint. The `PostProcessProvider` struct (`src-tauri/src/settings/mod.rs`) and `llm_client.rs` handle LLM post-processing providers, but the speech-to-text path in `src-tauri/src/managers/transcription/` and `inference.rs` has no equivalent provider abstraction. There is no native support for Groq's Whisper endpoint, AssemblyAI streaming, Deepgram streaming, or Mistral Voxtral.

#### What OpenWhispr Does

- Groq (`api.groq.com/openai/v1/audio/transcriptions`) for ultra-fast batch inference.
- AssemblyAI with streaming WebSocket transcription.
- Deepgram with streaming WebSocket transcription.
- Mistral Voxtral endpoint.
- OpenWhispr Cloud (own service, free tier + Pro subscription).
- Custom endpoint field for any OpenAI-compatible STT API.

#### Implementation Approach

- Define a `CloudSttProvider` struct in `src-tauri/src/settings/mod.rs` mirroring `PostProcessProvider`: `id`, `label`, `base_url`, `transcriptions_path`, `api_key_name`, `supports_streaming`.
- Add a `CloudSttProviderManager` or extend the existing transcription manager in `src-tauri/src/managers/transcription/mod.rs` to branch on the selected provider.
- Groq and Mistral Voxtral use the OpenAI audio transcriptions REST format — minimal extra code needed beyond a base URL swap and model name mapping.
- AssemblyAI and Deepgram require WebSocket clients: add `src-tauri/src/managers/transcription/assemblyai.rs` and `deepgram.rs` each implementing a shared `StreamingSttClient` trait.
- Store provider API keys via `src-tauri/src/security/secret_store.rs`.
- Frontend: extend `src/components/settings/models/ModelsSettings.tsx` with a cloud STT provider picker and key input, reusing the pattern already established for LLM post-processing providers.

**Files to create:**
- `src-tauri/src/managers/transcription/assemblyai.rs`
- `src-tauri/src/managers/transcription/deepgram.rs`

**Files to modify:**
- `src-tauri/src/settings/mod.rs` — `CloudSttProvider` struct
- `src-tauri/src/managers/transcription/mod.rs` — provider routing
- `src-tauri/src/managers/transcription/inference.rs` — hook provider selection
- `src/components/settings/models/ModelsSettings.tsx` — provider UI

---

### 5. Auto-Learn Dictionary

**Priority:** MEDIUM
**Effort:** M

#### Current State in Vocalype

`src-tauri/src/processing/dictionary.rs` provides a fully functional static dictionary: user-defined `from → to` replacements applied via pre-compiled regexes. The `DictionaryManager` supports add, remove, update, clear. There is no mechanism to observe what text the user edits after paste, and no way for the dictionary to evolve from those observations.

#### What OpenWhispr Does

- Monitors the clipboard (or the target application's text) for changes made by the user shortly after a dictation paste.
- Diffs the original transcription against the user's edited version using a word-level diff algorithm.
- Identifies substitution patterns (original word → corrected word) and auto-adds them to the dictionary, with a configurable confidence threshold.

#### Implementation Approach

- Add a post-paste clipboard watcher in `src-tauri/src/actions/paste.rs`: after pasting, store the pasted text in a short-lived `PendingCorrection` struct with a timestamp.
- In a background task (tokio `interval`), re-read the clipboard after a configurable delay (e.g., 5–15 seconds). If content differs from what was pasted and the edit distance is below a threshold (already configurable via `src-tauri/src/settings/debug/WordCorrectionThreshold` in the frontend), compute a word-level diff using the `similar` crate.
- Map single-word or short-phrase substitutions to `DictionaryEntry` candidates. If a candidate appears more than N times (configurable), call `DictionaryManager::add`.
- Surface learned corrections in `src/components/settings/dictionary/DictionarySettings.tsx` with a "Learned" badge and per-entry delete.
- Add a toggle in `src/components/settings/AdaptiveVocabularyToggle.tsx` (already exists for adaptive vocabulary) or a new `AutoLearnDictionaryToggle.tsx`.

**Files to create:**
- `src/components/settings/AutoLearnDictionaryToggle.tsx`

**Files to modify:**
- `src-tauri/src/actions/paste.rs` — post-paste watcher
- `src-tauri/src/processing/dictionary.rs` — `auto_learn` method
- `src-tauri/Cargo.toml` — add `similar` crate
- `src/components/settings/dictionary/DictionarySettings.tsx` — learned badge

---

### 6. Audio File Upload and Transcription UI

**Priority:** MEDIUM
**Effort:** M

#### Current State in Vocalype

`src-tauri/src/managers/history.rs` already has `save_file_transcription()` which stores an external-file transcription with a `file::` prefix. The `src-tauri/src/commands/transcription.rs` likely has a path for transcribing audio files (confirmed by the `file::` convention in history). However, the frontend has no dedicated UI for this: no file picker, no progress indicator, and no "create note from transcription" action.

#### What OpenWhispr Does

- Dedicated "Upload Audio" button/section in the main UI.
- Accepts common audio formats (mp3, m4a, wav, ogg, flac).
- Shows a transcription progress indicator.
- On completion, presents the result with options: copy, save to history, or create a note.

#### Implementation Approach

- Add an `upload_and_transcribe` Tauri command in `src-tauri/src/commands/transcription.rs`: accept a file path, read audio, run through the existing transcription pipeline (`src-tauri/src/managers/transcription/`), return result via event or command return value.
- Frontend: add `src/components/settings/AudioFileUpload.tsx` (or a modal) with a drag-and-drop zone using the existing `<file-dialog>` Tauri API. Wire to `upload_and_transcribe`. Show a progress spinner and the resulting transcript with copy/save/create-note actions.
- Reuse `src-tauri/src/managers/history.rs` `save_file_transcription()` for the save path.
- If Notes system (gap 2) is implemented, wire the "Create Note" button to `create_note` with the transcription as content.

**Files to create:**
- `src/components/settings/AudioFileUpload.tsx`

**Files to modify:**
- `src-tauri/src/commands/transcription.rs` — `upload_and_transcribe` command
- `src/App.tsx` or relevant settings section — add upload entry point

---

### 7. Local LLM Agent (llama.cpp)

**Priority:** MEDIUM
**Effort:** L

#### Current State in Vocalype

The `LlmTextProvider` trait in `src-tauri/src/llm/mod.rs` is designed to be extensible. The comment "Future: Claude, Mistral, etc." is present. All current providers are cloud APIs. There is no local inference path for LLM (Whisper local inference exists, but that is ASR, not LLM).

#### What OpenWhispr Does

- Embeds or manages a `llama.cpp` server process as a sidecar.
- Supports Vulkan GPU backend for cross-platform GPU acceleration.
- Runs models: Qwen, LLaMA, Mistral, Gemma.
- Exposes the llama.cpp server's OpenAI-compatible `/v1/chat/completions` endpoint to the existing agent and post-processing pipelines.

#### Implementation Approach

- Bundle a `llama-server` binary as a Tauri sidecar (`src-tauri/tauri.conf.json` `externalBin`). Provide builds for macOS (Metal), Windows (Vulkan/CPU), Linux (Vulkan/CPU).
- Add `src-tauri/src/managers/local_llm.rs`: start/stop the sidecar process, manage the port, expose a `base_url()` that points to `http://127.0.0.1:{port}`.
- Register `LocalLlmProvider` implementing `LlmTextProvider` by routing through the existing OpenAI-compatible path in `llm_client.rs` with the sidecar's base URL.
- Add model download and management commands in a new `src-tauri/src/commands/local_llm.rs`: download GGUF from Hugging Face, track progress, list installed models.
- Frontend: new settings section `src/components/settings/models/LocalLlmSettings.tsx` for model selection, download, and server start/stop toggle.

**Files to create:**
- `src-tauri/src/managers/local_llm.rs`
- `src-tauri/src/commands/local_llm.rs`
- `src/components/settings/models/LocalLlmSettings.tsx`

**Files to modify:**
- `src-tauri/src/llm/mod.rs` — register `LocalLlmProvider`
- `src-tauri/tauri.conf.json` — sidecar declaration
- `src-tauri/Cargo.toml` — if process management lib needed

---

### 8. Referral System

**Priority:** MEDIUM
**Effort:** M

#### Current State in Vocalype

The `src/components/settings/about/AboutSettings.tsx` and the auth portal reference `vocalype.com`. There is no referral tracking, no shareable link generation, and no mechanism to grant Pro access via referral conversions. The existing `src-tauri/src/security/license.rs` handles license validation but not referral codes.

#### What OpenWhispr Does

- Referral dashboard embedded in the app showing link, referral count, and earned months.
- Shareable referral cards (image generation or pre-made templates).
- Backend: each referral code tied to an account; on Pro upgrade via referral, both referrer and referee receive Pro months.

#### Implementation Approach

- Backend (outside app scope): extend the `vocalype.com` account API with referral endpoints: `GET /referral/code`, `GET /referral/stats`, `POST /referral/redeem`.
- In-app: add `src/components/settings/ReferralSettings.tsx` that calls these endpoints via the existing authenticated HTTP client (same one used for license checks in `src-tauri/src/security/license.rs`).
- Referral card: generate a shareable URL (`https://vocalype.com/r/{code}`) and copy to clipboard. A static card image can be pre-designed and opened in the browser.
- Gate the referral section behind a logged-in state.

**Files to create:**
- `src/components/settings/ReferralSettings.tsx`

**Files to modify:**
- `src/components/settings/about/AboutSettings.tsx` — link to referral section
- `src-tauri/src/security/license.rs` — fetch and cache referral stats alongside license data

---

### 9. Account System Enhancements

**Priority:** MEDIUM
**Effort:** L

#### Current State in Vocalype

License validation exists in `src-tauri/src/security/license.rs` and `secrets.rs`. The `src/components/onboarding/TrialWelcomeModal.tsx` and `src/components/ui/FeatureGateHint.tsx` suggest a trial/feature-gate model is partially in place. Usage stats are tracked locally in `src-tauri/src/managers/history.rs` (`count_recent_transcriptions`, `get_stats`). There is no Stripe integration, no server-side subscription tier enforcement, and no in-app upgrade prompt triggered by usage limits.

#### What OpenWhispr Does

- Stripe Checkout integration for subscription upgrades (Free, Pro tiers).
- Server-side usage tracking: words transcribed per week, with a weekly limit on the free tier.
- In-app upgrade prompt when the weekly limit is approached or reached.
- Usage meter visible in settings.

#### Implementation Approach

- Backend: add Stripe Checkout session creation endpoint to `vocalype.com` API; webhook handler for `checkout.session.completed` to upgrade the account tier.
- In-app: add `upgrade_subscription` Tauri command in `src-tauri/src/commands/app_context.rs` (or new `billing.rs`): calls the backend to create a Checkout session URL, opens it in the default browser.
- Extend `src/components/ui/FeatureGateHint.tsx` with an "Upgrade" CTA that invokes the command.
- Usage meter: the local word count from `get_stats` (already in history manager) can be surfaced in `src/components/settings/stats/StatsSettings.tsx`. For server-side enforcement, poll `GET /account/usage` on startup and cache.
- Add `src/components/settings/billing/BillingSettings.tsx` showing current tier, usage, and upgrade/manage buttons.

**Files to create:**
- `src-tauri/src/commands/billing.rs`
- `src/components/settings/billing/BillingSettings.tsx`

**Files to modify:**
- `src-tauri/src/lib.rs` — register billing commands
- `src/components/ui/FeatureGateHint.tsx` — upgrade CTA
- `src/components/settings/stats/StatsSettings.tsx` — usage meter

---

## LOW Priority Gaps

---

### 10. Auto-Pause Media

**Priority:** LOW
**Effort:** S

#### Current State in Vocalype

`src/components/settings/MuteWhileRecording.tsx` and the corresponding backend mute the system output device during recording. This is distinct from pausing a media player application.

#### What OpenWhispr Does

Sends a media `pause` command to Spotify or Apple Music when recording starts, then resumes playback when recording ends.

#### Implementation Approach

- macOS: use AppleScript (`osascript`) via `std::process::Command` to send `tell application "Spotify" to pause` / `play` and the same for Music.app. Wrap in `src-tauri/src/platform/media_control.rs` (new file).
- Windows: use the Win32 `SendMessage` API or the `GlobalSystemMediaTransportControlsSession` WinRT API to send pause/play media commands. This can be done from Rust via the `windows` crate already present in `Cargo.toml` (used in `platform/overlay.rs`).
- Add `pause_media_while_recording: bool` field to `AppSettings` and a toggle in `src/components/settings/MuteWhileRecording.tsx` or a new adjacent component.
- Hook into `src-tauri/src/actions/transcribe.rs` at recording start/stop.

**Files to create:**
- `src-tauri/src/platform/media_control.rs`
- `src/components/settings/PauseMediaToggle.tsx`

**Files to modify:**
- `src-tauri/src/actions/transcribe.rs` — call media pause/resume
- `src-tauri/src/platform/mod.rs` — expose `media_control`

---

### 11. Command Palette (Cmd+K)

**Priority:** LOW
**Effort:** M

#### Current State in Vocalype

There is no global search or command palette. History is browsable in a list view only. Navigation between settings sections requires clicking sidebar items.

#### What OpenWhispr Does

Cmd+K opens a floating palette that searches notes content, transcription history text, and provides quick-access shortcuts to settings sections. Results are ranked by recency and FTS relevance.

#### Implementation Approach

- Create `src/components/ui/CommandPalette.tsx`: a modal with a text input, debounced search, and a keyboard-navigable result list.
- Wire to existing Tauri commands: `get_history_entries` (paginated) for history search; `search_notes` (once gap 2 is built) for notes; a static list of settings routes for navigation actions.
- The existing `history.db` already supports SQLite `LIKE` queries; add a dedicated `search_history(query: String)` command in `src-tauri/src/commands/history.rs` using `LIKE '%' || ?1 || '%'` or a simple FTS5 virtual table added as a migration.
- Register the Cmd+K global shortcut in `src-tauri/src/shortcut/handler.rs` to emit a `toggle-command-palette` event; the frontend listens and shows/hides the component.
- This component is also a dependency of the Notes system (gap 2).

**Files to create:**
- `src/components/ui/CommandPalette.tsx`

**Files to modify:**
- `src-tauri/src/commands/history.rs` — `search_history` command
- `src-tauri/src/shortcut/handler.rs` — Cmd+K binding
- `src/App.tsx` — mount `CommandPalette` globally

---

### 12. Draggable Floating Panel

**Priority:** LOW
**Effort:** S

#### Current State in Vocalype

The overlay position is computed from monitor geometry in `src-tauri/src/platform/overlay.rs` (`calculate_overlay_position`) and stored as a fixed enum (`OverlayPosition::Top | Bottom | None`) in `AppSettings`. The user can choose top or bottom but cannot drag the overlay to an arbitrary position. The position is not remembered per-monitor.

#### What OpenWhispr Does

- The overlay panel is draggable by the user to any position on the screen.
- The last position is persisted and restored on next launch.
- On multi-monitor setups, the panel follows the cursor to the active monitor.

#### Implementation Approach

- In the overlay frontend (`src/overlay/RecordingOverlay.tsx`): add a `mousedown` drag handler that calls `window.__TAURI__.window.getCurrent().startDragging()` (Tauri's built-in drag API).
- On drag end, read the window position via `window.__TAURI__.window.getCurrent().outerPosition()` and emit a `overlay-position-saved` event to the backend.
- In the backend, add an `overlay_custom_x: Option<f64>` and `overlay_custom_y: Option<f64>` field to `AppSettings` (`src-tauri/src/settings/mod.rs`). When these are set, `calculate_overlay_position` returns them directly instead of computing from monitor bounds.
- The existing `OverlayPosition::None` enum value can be repurposed or extended with a `Custom` variant.
- The "follows cursor" multi-monitor behavior is already partially in place: `get_monitor_with_cursor` in `overlay.rs` finds the right monitor. Restore custom position relative to that monitor by storing an offset from monitor origin rather than absolute coordinates.

**Files to modify:**
- `src/overlay/RecordingOverlay.tsx` — drag handler
- `src-tauri/src/platform/overlay.rs` — restore custom position
- `src-tauri/src/settings/mod.rs` — `overlay_custom_x/y` fields
- `src-tauri/src/settings/ui.rs` — extend `OverlayPosition`

---

### 13. Three Hotkey Slots

**Priority:** LOW
**Effort:** S

#### Current State in Vocalype

`src-tauri/src/settings/shortcuts.rs` defines `ShortcutBinding` with an `id`, `name`, `description`, `default_binding`, and `current_binding`. The `src-tauri/src/shortcut/handler.rs` registers the active binding. Currently only one primary dictation hotkey is in use. The struct is generic enough to support multiple bindings.

#### What OpenWhispr Does

Three distinct hotkey slots: dictation key, agent key, meeting key. Each independently configurable.

#### Implementation Approach

- The data model already supports this. The primary work is in `src-tauri/src/shortcut/handler.rs`: register all active bindings at startup and on settings change, dispatching to the appropriate action (transcribe, toggle agent, start meeting) based on which binding was triggered.
- Add default bindings for `"agent"` and `"meeting"` in the settings defaults (e.g., no default binding, requiring user to set them).
- Extend `src/components/settings/GlobalShortcutInput.tsx` or `NativeShortcutCaptureInput.tsx` to render all three slots in a list, each independently editable.
- Gate the agent and meeting hotkeys behind feature flags until those features are built (gaps 1 and 3).

**Files to modify:**
- `src-tauri/src/shortcut/handler.rs` — multi-binding dispatch
- `src-tauri/src/settings/shortcuts.rs` — default bindings for agent/meeting
- `src/components/settings/GlobalShortcutInput.tsx` — render all slots

---

### 14. Globe / Fn Key Support (macOS)

**Priority:** LOW
**Effort:** S

#### Current State in Vocalype

Global shortcuts are registered via `src-tauri/src/shortcut/` using Tauri's shortcut API and a native capture helper (`native_shortcut_capture.rs`). The Globe key on Apple Silicon Macs is not a standard HID key and requires an Input Monitoring permission or a native Swift/Obj-C helper to intercept.

#### What OpenWhispr Does

A Swift native helper process that monitors `CGEvent` for the Globe key press without requiring Input Monitoring permission (uses a different API surface available to accessibility-authorized apps).

#### Implementation Approach

- Add a Swift sidecar helper `vocalype-globe-helper` in `src-tauri/` (Swift Package or single-file executable). It uses `NSEvent.addGlobalMonitorForEvents(matching: .keyDown)` with the Globe key virtual key code, then communicates the event to the main process via a Unix socket or stdout pipe.
- Declare the sidecar in `tauri.conf.json` `externalBin`.
- In `src-tauri/src/shortcut/handler.rs`, on macOS, also listen on the sidecar's IPC channel and fire the same action as the primary hotkey when the Globe key event arrives.
- Add Globe key as a selectable option in the shortcut capture UI (`src/components/settings/NativeShortcutCaptureInput.tsx`), rendered as "Globe (fn)" on macOS.

**Files to create:**
- `src-tauri/helpers/globe-key/main.swift` (Swift sidecar)

**Files to modify:**
- `src-tauri/src/shortcut/handler.rs` — Globe key IPC listener (macOS only)
- `src-tauri/tauri.conf.json` — sidecar declaration
- `src/components/settings/NativeShortcutCaptureInput.tsx` — Globe key display

---

### 15. AI Actions on Transcription (Discoverable UI)

**Priority:** LOW
**Effort:** S

#### Current State in Vocalype

`src-tauri/src/settings/mod.rs` defines `PostProcessAction` with `key`, `name`, `prompt`, `model`, `provider_id`. The `src-tauri/src/processing/post_processing.rs` `process_action()` function applies a named action. Actions are triggered by holding a numeric key during recording (action key overlay in `src/overlay/RecordingOverlay.tsx`). This mechanism works but is not discoverable: users must know to hold a number key and must configure actions in settings beforehand.

#### What OpenWhispr Does

An action picker UI (similar to a context menu or quick-action popover) that appears after transcription with the list of configured AI action templates. Clicking any action applies it to the current transcription. Actions are also accessible from within history entries.

#### Implementation Approach

- After a transcription completes, emit an event (`transcription-complete`) from `src-tauri/src/actions/transcribe.rs` with the entry ID.
- In the overlay (`src/overlay/RecordingOverlay.tsx`) or in the history view, show a compact action picker popover listing all `PostProcessAction` entries by name. Clicking one calls the existing `apply_action_to_history_entry` Tauri command (or equivalent).
- In the history view (`src/components/settings/history/HistorySettings.tsx`), add an "Apply AI Action" dropdown per entry — this is minimal UI work since the backend `process_action` already exists.
- The settings UI for configuring action templates (`src/components/settings/post-processing/PostProcessingSettings.tsx`) can be improved with better onboarding copy pointing users to the action picker.

**Files to modify:**
- `src/overlay/RecordingOverlay.tsx` — post-transcription action picker popover
- `src/components/settings/history/HistorySettings.tsx` — per-entry action dropdown
- `src/components/settings/post-processing/PostProcessingSettings.tsx` — improved discoverability copy

---

## Architectural Notes

### Database Strategy

Vocalype already uses `rusqlite` with migration tracking via `user_version` pragma (see `src-tauri/src/managers/history.rs`). New features (notes, agent history, meeting transcripts) should each use separate SQLite files in the app data directory to avoid migration complexity and allow independent retention policies. The existing migration pattern (`rusqlite_migration::Migrations`) should be reused.

### LLM Provider Extension Pattern

The `LlmTextProvider` trait in `src-tauri/src/llm/mod.rs` is the correct extension point for new AI providers (Groq, local llama.cpp, etc.). New providers should implement this trait, and `text_provider_for()` should be extended to construct them from settings. This ensures post-processing, AI actions, and the agent mode all benefit from new providers without duplicating routing logic.

### Hotkey Architecture

The `ShortcutBinding` struct and the shortcut handler already support multiple named bindings by design. Gaps 1, 3, and 13 all require registering additional bindings. The recommended order of implementation is: add the three-slot infrastructure (gap 13, S effort) first, then build agent (gap 1) and meeting (gap 3) features against it.

### i18n

Per `CLAUDE.md`, all user-facing strings must use the i18n system. Each new feature must add its keys to the translation files in `src/` before shipping. French strings visible in `src-tauri/src/processing/dictionary.rs` (error messages) should also be migrated to use the i18n system or at minimum moved to the frontend error display layer.

### Security Considerations

- OAuth tokens (Calendar, Stripe) must be stored via `src-tauri/src/security/secret_store.rs`, not in plain `AppSettings`.
- The local llama.cpp sidecar should be code-signed on macOS and Windows to avoid OS quarantine warnings.
- Any new SQLite databases storing user content (notes, agent history) should be considered for encryption at rest using SQLCipher if a Pro/enterprise tier is introduced.
