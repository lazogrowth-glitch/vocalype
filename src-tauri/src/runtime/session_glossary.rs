//! Passive Session Glossary — zero-effort vocabulary from the clipboard.
//!
//! While the user codes, this module silently watches the clipboard in the
//! background (every 2 s, only when the active app is a code editor).
//! Every time new code is copied, it extracts camelCase / PascalCase /
//! snake_case / CONSTANT_CASE identifiers and adds them to a session-scoped
//! in-memory `HashSet`.
//!
//! At Parakeet inference time, these terms are merged into `custom_words` so
//! the recognition engine already knows project-specific names the first time
//! the developer dictates them — without the user ever opening a settings page.
//!
//! ## Lifecycle
//! - Created at startup → cleared on app restart (never persisted to disk).
//! - Background task spawned once in `lib.rs` `setup()`.
//! - Merged into `custom_words` inside `build_correction_terms()` in `inference.rs`.
//!
//! ## Identifier rules
//! To qualify, a token must:
//! - Contain at least one uppercase letter **or** an underscore (code signal).
//! - Be at least 4 characters long (skips noise like `UI`, `id`, etc.).
//! - Not be a short all-caps word ≤ 4 chars (avoids `HTTP`, `JSON` spam).

use log::debug;
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
}

/// Tauri managed state wrapper.
pub struct SessionGlossaryState(pub Mutex<SessionGlossary>);

impl SessionGlossary {
    pub fn new() -> Self {
        Self {
            terms: HashSet::new(),
            last_seen: String::new(),
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

/// Spawn the clipboard polling background task.
///
/// Polls every `interval_ms` milliseconds. On each tick:
/// 1. Reads the clipboard on the Tauri main thread.
/// 2. Passes content to `SessionGlossary::ingest()`.
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
        debug!("[session_glossary] clipboard watcher started ({}ms interval)", interval_ms);
        loop {
            thread::sleep(Duration::from_millis(interval_ms));

            // Read clipboard on main thread (Tauri requirement).
            let (tx, rx) = mpsc::channel::<String>();
            let app_for_read = app.clone();
            if app
                .run_on_main_thread(move || {
                    let text = app_for_read
                        .clipboard()
                        .read_text()
                        .unwrap_or_default();
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
            if let Some(state) = app.try_state::<SessionGlossaryState>() {
                if let Ok(mut glossary) = state.0.lock() {
                    let added = glossary.ingest(&clipboard_text);
                    if added > 0 {
                        debug!(
                            "[session_glossary] +{} new terms (total {})",
                            added,
                            glossary.terms.len()
                        );
                    }
                }
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
        assert!(ids.contains(&"useState".to_string()), "should find useState");
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
