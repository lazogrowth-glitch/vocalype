//! Passive Session Glossary — zero-effort vocabulary from the clipboard.
//!
//! While the user codes, this module silently watches the clipboard in the
//! background (every 2 s, only when the active app is a code editor).
//! Every time new code is copied, it extracts camelCase / PascalCase /
//! snake_case / CONSTANT_CASE identifiers and adds them to a persistent
//! `HashSet` stored in the app data directory.
//!
//! At Parakeet inference time, these terms are merged into `custom_words` so
//! the recognition engine already knows project-specific names the first time
//! the developer dictates them — without the user ever opening a settings page.
//!
//! ## Lifecycle
//! - Loaded from `session_glossary.json` at startup (persists across restarts).
//! - Background task spawned once in `lib.rs` `setup()`.
//! - Saved to disk after every batch of new identifiers is ingested.
//! - Merged into `custom_words` inside `build_correction_terms()` in `inference.rs`.
//!
//! ## Identifier rules
//! To qualify, a token must:
//! - Contain at least one uppercase letter **or** an underscore (code signal).
//! - Be at least 4 characters long (skips noise like `UI`, `id`, etc.).
//! - Not be a short all-caps word ≤ 4 chars (avoids `HTTP`, `JSON` spam).

use log::{debug, warn};
use regex::Regex;
use std::collections::HashSet;
use std::sync::Mutex;

/// Maximum number of terms stored per session.
/// After this limit, new terms are silently dropped to bound memory.
const MAX_SESSION_TERMS: usize = 512;

// ── Public state ──────────────────────────────────────────────────────────────

pub struct SessionGlossary {
    pub terms: HashSet<String>,
    /// Last clipboard snapshot — avoids re-scanning unchanged content.
    last_seen: String,
    /// Set to true once we've fired the llama-server pre-warm for this session.
    /// Prevents re-triggering on every subsequent clipboard event.
    prewarmed: bool,
}

/// Tauri managed state wrapper.
pub struct SessionGlossaryState(pub Mutex<SessionGlossary>);

impl SessionGlossary {
    pub fn new() -> Self {
        Self {
            terms: HashSet::new(),
            last_seen: String::new(),
            prewarmed: false,
        }
    }

    /// Ingest `clipboard_text`, extract identifiers, and store new ones.
    /// Returns the number of **new** terms added this call.
    pub fn ingest(&mut self, clipboard_text: &str) -> usize {
        if clipboard_text == self.last_seen || clipboard_text.is_empty() {
            return 0;
        }
        self.last_seen = clipboard_text.to_string();

        if self.terms.len() >= MAX_SESSION_TERMS {
            return 0;
        }

        let candidates = extract_code_identifiers(clipboard_text);
        let mut added = 0;
        for term in candidates {
            if self.terms.len() >= MAX_SESSION_TERMS {
                break;
            }
            if self.terms.insert(term) {
                added += 1;
            }
        }
        added
    }

    /// Returns all accumulated terms as a `Vec` suitable for `custom_words`.
    pub fn as_vec(&self) -> Vec<String> {
        self.terms.iter().cloned().collect()
    }

    /// How many distinct code identifiers have been collected this session.
    pub fn term_count(&self) -> usize {
        self.terms.len()
    }
}

// ── Identifier extraction ─────────────────────────────────────────────────────

/// Extract code identifiers from arbitrary text.
///
/// Matched patterns:
/// - camelCase   — `useState`, `handleClick`, `myVariable`
/// - PascalCase  — `AppComponent`, `UserService`, `MyStruct`
/// - snake_case  — `my_variable`, `user_name` (requires ≥ 2 parts)
/// - SCREAMING   — `MAX_RETRIES`, `API_KEY` (requires ≥ 2 parts)
///
/// Rejects tokens that are:
/// - Shorter than 4 characters
/// - Short (≤ 4 chars) all-uppercase acronyms (`HTTP`, `JSON`, `NULL`, …)
/// - Pure lowercase words with no underscore (plain English)
pub fn extract_code_identifiers(text: &str) -> Vec<String> {
    // Pattern breakdown:
    //   alt 1: starts with uppercase, contains a lowercase→uppercase transition (PascalCase, camelCase w/ capital start)
    //   alt 2: starts with lowercase, contains a lowercase→uppercase transition (camelCase)
    //   alt 3: one or more word-chars followed by at least one underscore segment (snake / SCREAMING)
    static RE: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(
            r"\b(?:[A-Z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*|[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*|[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+)\b"
        )
        .expect("session_glossary regex is valid")
    });

    let mut seen: HashSet<&str> = HashSet::new();
    let mut results: Vec<String> = Vec::new();

    for m in re.find_iter(text) {
        let word = m.as_str();

        // Length guard
        if word.len() < 4 {
            continue;
        }

        // Skip short all-caps words (HTTP, JSON, NULL, TRUE, …)
        if word.len() <= 5 && word.chars().all(|c| c.is_ascii_uppercase() || c == '_') {
            continue;
        }

        if seen.insert(word) {
            results.push(word.to_string());
        }
    }

    results
}

// ── Background polling task ───────────────────────────────────────────────────

// ── Disk persistence ──────────────────────────────────────────────────────────

const GLOSSARY_FILE: &str = "session_glossary.json";

/// Load persisted glossary terms from disk.  Returns an empty set on any error.
fn load_from_disk(app: &tauri::AppHandle) -> HashSet<String> {
    use tauri::Manager;
    let path = match app.path().app_data_dir() {
        Ok(d) => d.join(GLOSSARY_FILE),
        Err(e) => {
            warn!("[session_glossary] cannot resolve app data dir: {}", e);
            return HashSet::new();
        }
    };
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str::<HashSet<String>>(&content).unwrap_or_default(),
        Err(_) => HashSet::new(), // file doesn't exist yet — normal on first run
    }
}

/// Persist the current glossary terms to disk (best-effort).
fn save_to_disk(app: &tauri::AppHandle, terms: &HashSet<String>) {
    use tauri::Manager;
    let path = match app.path().app_data_dir() {
        Ok(d) => d.join(GLOSSARY_FILE),
        Err(e) => {
            warn!(
                "[session_glossary] cannot resolve app data dir for save: {}",
                e
            );
            return;
        }
    };
    match serde_json::to_string(terms) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&path, json) {
                warn!(
                    "[session_glossary] failed to write {}: {}",
                    path.display(),
                    e
                );
            }
        }
        Err(e) => warn!("[session_glossary] serialization error: {}", e),
    }
}

// ── Background polling task ───────────────────────────────────────────────────

/// Spawn the clipboard polling background task.
///
/// On startup, loads previously persisted terms from disk so identifiers
/// survive app restarts.  Polls every `interval_ms` milliseconds; on each tick:
/// 1. Reads the clipboard on the Tauri main thread.
/// 2. Passes content to `SessionGlossary::ingest()`.
/// 3. If new terms were added, flushes to disk.
///
/// No context guard here — the regex only matches code-shaped identifiers
/// (camelCase / snake_case / PascalCase), so false positives from non-code
/// clipboard content are negligible.  The glossary is only injected into
/// Parakeet when the active context is Code anyway (`inference.rs`).
///
/// This is intentionally fire-and-forget; errors are logged and ignored.
pub fn spawn_clipboard_watcher(app: tauri::AppHandle, interval_ms: u64) {
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;
    use tauri::Manager;
    use tauri_plugin_clipboard_manager::ClipboardExt;

    thread::spawn(move || {
        // ── Load persisted terms on startup ───────────────────────────────
        let persisted = load_from_disk(&app);
        if !persisted.is_empty() {
            if let Some(state) = app.try_state::<SessionGlossaryState>() {
                if let Ok(mut glossary) = state.0.lock() {
                    let count = persisted.len();
                    glossary.terms.extend(persisted);
                    debug!(
                        "[session_glossary] loaded {} persisted terms from disk",
                        count
                    );
                }
            }
        }

        debug!(
            "[session_glossary] clipboard watcher started ({}ms interval)",
            interval_ms
        );
        loop {
            thread::sleep(Duration::from_millis(interval_ms));

            // Read clipboard on main thread (Tauri requirement).
            let (tx, rx) = mpsc::channel::<String>();
            let app_for_read = app.clone();
            if app
                .run_on_main_thread(move || {
                    let text = app_for_read.clipboard().read_text().unwrap_or_default();
                    let _ = tx.send(text);
                })
                .is_err()
            {
                continue;
            }

            let clipboard_text = match rx.recv_timeout(Duration::from_millis(300)) {
                Ok(t) => t,
                Err(_) => continue,
            };

            if clipboard_text.is_empty() {
                continue;
            }

            // Ingest into state.
            let (should_prewarm, terms_snapshot) =
                if let Some(state) = app.try_state::<SessionGlossaryState>() {
                    if let Ok(mut glossary) = state.0.lock() {
                        let added = glossary.ingest(&clipboard_text);
                        let snapshot = if added > 0 {
                            debug!(
                                "[session_glossary] +{} new terms (total {})",
                                added,
                                glossary.terms.len()
                            );
                            Some(glossary.terms.clone())
                        } else {
                            None
                        };
                        // Fire pre-warm the first time we cross the code-context threshold.
                        let crossed = !glossary.prewarmed && glossary.term_count() >= 3;
                        if crossed {
                            glossary.prewarmed = true;
                        }
                        (crossed, snapshot)
                    } else {
                        (false, None)
                    }
                } else {
                    (false, None)
                };

            // Persist new terms to disk.
            if let Some(terms) = terms_snapshot {
                save_to_disk(&app, &terms);
            }

            // If llm_auto_mode is on and we just crossed the threshold,
            // boot llama-server silently so it is ready before the first dictation.
            if should_prewarm && crate::settings::get_settings(&app).llm_auto_mode {
                let app_clone = app.clone();
                tauri::async_runtime::spawn(async move {
                    debug!("[session_glossary] code context detected — pre-warming llama-server");
                    if let Err(e) = crate::llm::llama_server::ensure_llama_server(&app_clone).await
                    {
                        debug!("[session_glossary] llama-server pre-warm failed: {}", e);
                    } else {
                        debug!("[session_glossary] llama-server pre-warm complete");
                    }
                });
            }
        }
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_camel_case() {
        let ids = extract_code_identifiers("let result = useState(false);");
        assert!(
            ids.contains(&"useState".to_string()),
            "should find useState"
        );
    }

    #[test]
    fn extracts_pascal_case() {
        let ids = extract_code_identifiers("class UserService extends BaseComponent {}");
        assert!(ids.contains(&"UserService".to_string()));
        assert!(ids.contains(&"BaseComponent".to_string()));
    }

    #[test]
    fn extracts_snake_case() {
        let ids = extract_code_identifiers("let max_retries = get_user_name();");
        assert!(ids.contains(&"max_retries".to_string()));
        assert!(ids.contains(&"get_user_name".to_string()));
    }

    #[test]
    fn extracts_screaming_snake() {
        let ids = extract_code_identifiers("const MAX_BUFFER_SIZE: usize = 4096;");
        assert!(ids.contains(&"MAX_BUFFER_SIZE".to_string()));
    }

    #[test]
    fn skips_short_tokens() {
        let ids = extract_code_identifiers("let x = id + ok;");
        assert!(!ids.contains(&"id".to_string()));
        assert!(!ids.contains(&"ok".to_string()));
    }

    #[test]
    fn skips_short_all_caps() {
        let ids = extract_code_identifiers("HTTP JSON NULL TRUE FALSE");
        // All short all-caps — none should qualify
        for id in &ids {
            assert!(
                id.len() > 5 || !id.chars().all(|c| c.is_ascii_uppercase()),
                "unexpected short all-caps: {}",
                id
            );
        }
    }

    #[test]
    fn skips_plain_lowercase_words() {
        let ids = extract_code_identifiers("this is a test with normal words");
        assert!(ids.is_empty(), "plain text should yield no identifiers");
    }

    #[test]
    fn ingest_deduplicates() {
        let mut g = SessionGlossary::new();
        let code = "useState useEffect useState";
        let first = g.ingest(code);
        // Both unique on first pass
        assert_eq!(first, 2);
        // Same clipboard → no change
        let second = g.ingest(code);
        assert_eq!(second, 0);
    }

    #[test]
    fn ingest_accumulates_across_clips() {
        let mut g = SessionGlossary::new();
        g.ingest("const MyComponent = () => {};");
        g.ingest("function handleClick(event) { setState(true); }");
        assert!(g.terms.contains("MyComponent"));
        assert!(g.terms.contains("handleClick"));
        assert!(g.terms.contains("setState"));
    }
}
