use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::Mutex;

// ── Category ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum AppContextCategory {
    /// Code editors, IDEs, terminals
    Code,
    /// Email clients and webmail
    Email,
    /// Chat / messaging apps
    Chat,
    /// Traditional document editors (Word, LibreOffice)
    Document,
    /// Notes and PKM apps (Notion, Obsidian, Logseq…)
    Notes,
    /// Web browsers (category refined further via window title)
    Browser,
    /// App not recognised — neutral behaviour
    Unknown,
}

impl AppContextCategory {
    /// Returns true when post-processing (filler removal, LLM) should be skipped.
    pub fn skip_post_processing(self) -> bool {
        matches!(self, AppContextCategory::Code)
    }
}

// ── Code language ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CodeLanguage {
    Rust,
    Python,
    JavaScript,
    TypeScript,
    Go,
    Java,
    CSharp,
    Cpp,
    Html,
    Css,
    Shell,
    Json,
    Toml,
    Yaml,
    Markdown,
}

impl CodeLanguage {
    pub fn as_str(self) -> &'static str {
        match self {
            CodeLanguage::Rust => "rust",
            CodeLanguage::Python => "python",
            CodeLanguage::JavaScript => "javascript",
            CodeLanguage::TypeScript => "typescript",
            CodeLanguage::Go => "go",
            CodeLanguage::Java => "java",
            CodeLanguage::CSharp => "csharp",
            CodeLanguage::Cpp => "cpp",
            CodeLanguage::Html => "html",
            CodeLanguage::Css => "css",
            CodeLanguage::Shell => "shell",
            CodeLanguage::Json => "json",
            CodeLanguage::Toml => "toml",
            CodeLanguage::Yaml => "yaml",
            CodeLanguage::Markdown => "markdown",
        }
    }
}

/// Infer the active coding language from the window title.
/// VS Code titles: "main.rs — vocalype", "index.tsx - project - Visual Studio Code"
/// Cursor titles: "Cursor — App.py"
pub fn detect_code_language(window_title: &str) -> Option<CodeLanguage> {
    // Extract all tokens that look like filenames (contain a dot)
    for token in window_title.split_whitespace() {
        let token = token.trim_matches(|c: char| !c.is_alphanumeric() && c != '.' && c != '_');
        if let Some(ext) = token.rsplit('.').next() {
            let lang = match ext.to_ascii_lowercase().as_str() {
                "rs" => Some(CodeLanguage::Rust),
                "py" | "pyw" | "pyi" => Some(CodeLanguage::Python),
                "js" | "mjs" | "cjs" => Some(CodeLanguage::JavaScript),
                "ts" | "tsx" | "mts" => Some(CodeLanguage::TypeScript),
                "jsx" => Some(CodeLanguage::JavaScript),
                "go" => Some(CodeLanguage::Go),
                "java" => Some(CodeLanguage::Java),
                "cs" => Some(CodeLanguage::CSharp),
                "cpp" | "cc" | "cxx" | "c" | "h" | "hpp" => Some(CodeLanguage::Cpp),
                "html" | "htm" => Some(CodeLanguage::Html),
                "css" | "scss" | "sass" | "less" => Some(CodeLanguage::Css),
                "sh" | "bash" | "zsh" | "fish" => Some(CodeLanguage::Shell),
                "json" | "jsonc" => Some(CodeLanguage::Json),
                "toml" => Some(CodeLanguage::Toml),
                "yaml" | "yml" => Some(CodeLanguage::Yaml),
                "md" | "mdx" => Some(CodeLanguage::Markdown),
                _ => None,
            };
            if lang.is_some() {
                return lang;
            }
        }
    }
    None
}

// ── Core context ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppTranscriptionContext {
    /// Stable process identifier: `.exe` filename on Windows (e.g. `"code.exe"`).
    pub process_name: Option<String>,
    /// Window title at capture time.
    pub window_title: Option<String>,
    pub category: AppContextCategory,
    /// Detected coding language (only set when category == Code).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code_language: Option<CodeLanguage>,
    pub detected_at_ms: u64,
}

impl AppTranscriptionContext {
    pub fn unknown(process_name: Option<String>, window_title: Option<String>) -> Self {
        Self {
            category: AppContextCategory::Unknown,
            process_name,
            window_title,
            code_language: None,
            detected_at_ms: crate::runtime_observability::now_ms(),
        }
    }
}

// ── Override & recent-apps types ──────────────────────────────────────────────

/// User-defined category override for a specific process.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AppContextOverride {
    /// Same key format as `AppTranscriptionContext::process_name`.
    pub process_name: String,
    pub category: AppContextCategory,
}

/// Entry in the "recently detected apps" list (last N dictation sessions).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RecentAppEntry {
    pub process_name: String,
    pub window_title: Option<String>,
    pub category: AppContextCategory,
    pub detected_at_ms: u64,
}

const MAX_RECENT_APPS: usize = 5;

// ── Snapshot (per-session state held in Tauri state) ──────────────────────────

#[derive(Debug, Default)]
pub struct ActiveAppContextSnapshot {
    /// Active context per binding key (set at recording start, cleared at stop).
    active_by_binding: HashMap<String, AppTranscriptionContext>,
    /// Last context that reached the post-processing stage.
    last_transcription_app_context: Option<AppTranscriptionContext>,
    /// Rolling window of the last MAX_RECENT_APPS unique apps used.
    recent_apps: VecDeque<RecentAppEntry>,
    /// User-defined overrides: process_name (lowercase) → forced category.
    overrides: HashMap<String, AppContextCategory>,
}

impl ActiveAppContextSnapshot {
    // ── Binding lifecycle ──────────────────────────────────────────────────────

    pub fn set_active_context(&mut self, binding_id: &str, mut context: AppTranscriptionContext) {
        self.apply_overrides(&mut context);
        self.active_by_binding
            .insert(binding_id.to_string(), context);
    }

    pub fn clear_active_context(&mut self, binding_id: &str) {
        self.active_by_binding.remove(binding_id);
    }

    pub fn active_context_for_binding(&self, binding_id: &str) -> Option<AppTranscriptionContext> {
        self.active_by_binding.get(binding_id).cloned()
    }

    // ── Post-transcription tracking ────────────────────────────────────────────

    pub fn set_last_transcription_context(&mut self, context: AppTranscriptionContext) {
        self.push_recent_app(&context);
        self.last_transcription_app_context = Some(context);
    }

    pub fn last_transcription_context(&self) -> Option<AppTranscriptionContext> {
        self.last_transcription_app_context.clone()
    }

    // ── Recent apps ────────────────────────────────────────────────────────────

    fn push_recent_app(&mut self, ctx: &AppTranscriptionContext) {
        let process_name = match ctx.process_name.as_deref() {
            Some(name) if !name.is_empty() => name.to_string(),
            _ => return,
        };

        // Deduplicate: remove existing entry for the same process.
        self.recent_apps.retain(|e| e.process_name != process_name);

        self.recent_apps.push_front(RecentAppEntry {
            process_name,
            window_title: ctx.window_title.clone(),
            category: ctx.category,
            detected_at_ms: ctx.detected_at_ms,
        });

        while self.recent_apps.len() > MAX_RECENT_APPS {
            self.recent_apps.pop_back();
        }
    }

    pub fn recent_apps(&self) -> Vec<RecentAppEntry> {
        self.recent_apps.iter().cloned().collect()
    }

    // ── Per-app overrides ──────────────────────────────────────────────────────

    /// Set a user-defined category for `process_name` (case-insensitive key).
    pub fn set_override(&mut self, process_name: &str, category: AppContextCategory) {
        self.overrides
            .insert(process_name.trim().to_ascii_lowercase(), category);
    }

    pub fn remove_override(&mut self, process_name: &str) {
        self.overrides
            .remove(&process_name.trim().to_ascii_lowercase());
    }

    pub fn list_overrides(&self) -> Vec<AppContextOverride> {
        self.overrides
            .iter()
            .map(|(name, &category)| AppContextOverride {
                process_name: name.clone(),
                category,
            })
            .collect()
    }

    /// Apply user-defined overrides to a freshly detected context (mutates in place).
    pub fn apply_overrides(&self, ctx: &mut AppTranscriptionContext) {
        if let Some(name) = ctx.process_name.as_deref() {
            let key = name.to_ascii_lowercase();
            if let Some(&override_cat) = self.overrides.get(&key) {
                ctx.category = override_cat;
            }
        }
    }
}

/// Tauri managed state for the app context snapshot.
pub struct ActiveAppContextState(pub Mutex<ActiveAppContextSnapshot>);

// ── Classification ─────────────────────────────────────────────────────────────

/// Classify a Windows process filename (e.g. `"code.exe"`) into a category.
pub fn classify_process_name(process_name: &str) -> AppContextCategory {
    match process_name.trim().to_ascii_lowercase().as_str() {
        // ── Code editors / IDEs / terminals
        "code.exe"
        | "cursor.exe"
        | "windsurf.exe"
        | "codium.exe"
        | "devenv.exe"
        | "rider64.exe"
        | "clion64.exe"
        | "idea64.exe"
        | "pycharm64.exe"
        | "goland64.exe"
        | "webstorm64.exe"
        | "zed.exe"
        | "sublime_text.exe"
        | "notepad++.exe"
        | "vim.exe"
        | "nvim.exe"
        | "helix.exe"
        | "emacs.exe"
        | "wt.exe"        // Windows Terminal
        | "cmd.exe"
        | "powershell.exe"
        | "pwsh.exe" => AppContextCategory::Code,

        // ── Email clients
        "outlook.exe" | "thunderbird.exe" | "mailbird.exe" | "postbox.exe" => {
            AppContextCategory::Email
        }

        // ── Chat / messaging
        "slack.exe"
        | "discord.exe"
        | "teams.exe"
        | "telegram.exe"
        | "signal.exe"
        | "whatsapp.exe"
        | "skype.exe"
        | "mattermost.exe"
        | "element.exe"
        | "zulip.exe" => AppContextCategory::Chat,

        // ── Notes & PKM
        "notion.exe"
        | "obsidian.exe"
        | "logseq.exe"
        | "bear.exe"
        | "craft.exe"
        | "typora.exe"
        | "joplin.exe"
        | "standardnotes.exe" => AppContextCategory::Notes,

        // ── Traditional document editors
        "winword.exe"
        | "excel.exe"
        | "powerpnt.exe"
        | "soffice.exe"
        | "libreoffice.exe"
        | "abiword.exe"
        | "wordpad.exe" => AppContextCategory::Document,

        // ── Browsers
        "chrome.exe"
        | "msedge.exe"
        | "firefox.exe"
        | "brave.exe"
        | "opera.exe"
        | "vivaldi.exe"
        | "iexplore.exe"
        | "arc.exe" => AppContextCategory::Browser,

        _ => AppContextCategory::Unknown,
    }
}

/// For a `Browser`-category process, inspect the window title to infer a more
/// specific category (webmail → Email, web chat → Chat, etc.).
/// Returns `None` to keep `Browser` if no pattern matches.
pub fn refine_browser_category(window_title: &str) -> Option<AppContextCategory> {
    let t = window_title.to_ascii_lowercase();

    // ── Webmail
    if t.contains("gmail")
        || t.contains("mail.google")
        || (t.contains("outlook") && (t.contains("mail") || t.contains("inbox")))
        || t.contains("yahoo mail")
        || t.contains("proton mail")
        || t.contains("protonmail")
        || t.contains("fastmail")
        || t.contains("zoho mail")
        || t.contains("- mail -")
    {
        return Some(AppContextCategory::Email);
    }

    // ── Web chat
    if t.contains("slack")
        || t.contains("discord")
        || (t.contains("teams") && t.contains("microsoft"))
        || t.contains("messenger")
        || t.contains("whatsapp")
        || t.contains("telegram")
        || t.contains("element")
    {
        return Some(AppContextCategory::Chat);
    }

    // ── Web notes / docs
    if t.contains("notion")
        || t.contains("obsidian")
        || t.contains("google docs")
        || t.contains("docs.google")
        || t.contains("confluence")
        || t.contains("coda.io")
    {
        return Some(AppContextCategory::Notes);
    }

    // ── Recruiting / ATS / CRM
    if t.contains("linkedin recruiter")
        || t.contains("linkedin.com/talent")
        || t.contains("bullhorn")
        || t.contains("vincere")
        || t.contains("recruitcrm")
        || t.contains("recruit crm")
        || t.contains("greenhouse")
        || t.contains("lever.co")
        || t.contains("workable")
        || t.contains("smartrecruiters")
        || t.contains("jobadder")
        || t.contains("pcrecruiter")
        || t.contains("crelate")
        || t.contains("zoho recruit")
        || t.contains("loxo")
        || t.contains("recruitee")
        || t.contains("teamtailor")
    {
        return Some(AppContextCategory::Notes);
    }

    // ── Developer tooling in browser
    if t.contains("github")
        || t.contains("gitlab")
        || t.contains("stackoverflow")
        || t.contains("stack overflow")
        || t.contains("localhost")
        || t.contains("127.0.0.1")
        || t.contains("vercel")
        || t.ends_with(":3000")
        || t.ends_with(":8080")
        || t.ends_with(":5173") // vite
        || t.ends_with(":4321")
    // astro
    {
        return Some(AppContextCategory::Code);
    }

    None
}

// ── Platform implementation ───────────────────────────────────────────────────

/// Detect the app that currently has (or just had) focus.
/// Must complete in < 5 ms — no blocking I/O, no spawning.
#[cfg(target_os = "windows")]
pub fn detect_current_app_context() -> AppTranscriptionContext {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::Win32::Foundation::{CloseHandle, HWND};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_NATIVE,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    };

    fn get_window_title(hwnd: HWND) -> Option<String> {
        unsafe {
            let len = GetWindowTextLengthW(hwnd);
            if len <= 0 {
                return None;
            }
            let mut buffer = vec![0u16; len as usize + 1];
            let copied = GetWindowTextW(hwnd, &mut buffer);
            if copied <= 0 {
                return None;
            }
            Some(String::from_utf16_lossy(&buffer[..copied as usize]))
        }
    }

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return AppTranscriptionContext::unknown(None, None);
        }

        let window_title = get_window_title(hwnd);

        let mut process_id = 0u32;
        let _thread_id = GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        if process_id == 0 {
            return AppTranscriptionContext::unknown(None, window_title);
        }

        let process_handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id)
        {
            Ok(handle) => handle,
            Err(_) => return AppTranscriptionContext::unknown(None, window_title),
        };

        let mut buffer = vec![0u16; 1024];
        let mut len = buffer.len() as u32;
        let result = QueryFullProcessImageNameW(
            process_handle,
            PROCESS_NAME_NATIVE,
            windows::core::PWSTR(buffer.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(process_handle);

        if result.is_err() || len == 0 {
            return AppTranscriptionContext::unknown(None, window_title);
        }

        let path = OsString::from_wide(&buffer[..len as usize]);
        let process_name = Path::new(&path)
            .file_name()
            .map(|name| name.to_string_lossy().to_ascii_lowercase());

        let mut category = process_name
            .as_deref()
            .map(classify_process_name)
            .unwrap_or(AppContextCategory::Unknown);

        // For browsers, inspect the window title for webmail / web-chat patterns.
        if category == AppContextCategory::Browser {
            if let Some(refined) = window_title.as_deref().and_then(refine_browser_category) {
                category = refined;
            }
        }

        let code_language = if category == AppContextCategory::Code {
            window_title.as_deref().and_then(detect_code_language)
        } else {
            None
        };

        AppTranscriptionContext {
            process_name,
            window_title,
            category,
            code_language,
            detected_at_ms: crate::runtime_observability::now_ms(),
        }
    }
}

/// Non-Windows — silent fallback, no crash.
#[cfg(not(target_os = "windows"))]
pub fn detect_current_app_context() -> AppTranscriptionContext {
    AppTranscriptionContext::unknown(None, None)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Process name classification ────────────────────────────────────────────

    #[test]
    fn classifies_known_windows_process_names() {
        assert_eq!(classify_process_name("code.exe"), AppContextCategory::Code);
        assert_eq!(
            classify_process_name("cursor.exe"),
            AppContextCategory::Code
        );
        assert_eq!(classify_process_name("wt.exe"), AppContextCategory::Code);
        assert_eq!(
            classify_process_name("outlook.exe"),
            AppContextCategory::Email
        );
        assert_eq!(classify_process_name("slack.exe"), AppContextCategory::Chat);
        assert_eq!(
            classify_process_name("obsidian.exe"),
            AppContextCategory::Notes
        );
        assert_eq!(
            classify_process_name("notion.exe"),
            AppContextCategory::Notes
        );
        assert_eq!(
            classify_process_name("winword.exe"),
            AppContextCategory::Document
        );
        assert_eq!(
            classify_process_name("firefox.exe"),
            AppContextCategory::Browser
        );
    }

    #[test]
    fn unknown_process_falls_back_to_unknown() {
        assert_eq!(
            classify_process_name("totally-unknown.exe"),
            AppContextCategory::Unknown
        );
        assert_eq!(classify_process_name(""), AppContextCategory::Unknown);
    }

    #[test]
    fn classification_is_case_insensitive() {
        assert_eq!(classify_process_name("CODE.EXE"), AppContextCategory::Code);
        assert_eq!(classify_process_name("Slack.exe"), AppContextCategory::Chat);
    }

    // ── Browser title refinement ───────────────────────────────────────────────

    #[test]
    fn browser_title_gmail_refines_to_email() {
        assert_eq!(
            refine_browser_category("Inbox - Gmail - Google Chrome"),
            Some(AppContextCategory::Email)
        );
    }

    #[test]
    fn browser_title_outlook_mail_refines_to_email() {
        assert_eq!(
            refine_browser_category("Mail - Outlook"),
            Some(AppContextCategory::Email)
        );
    }

    #[test]
    fn browser_title_slack_refines_to_chat() {
        assert_eq!(
            refine_browser_category("general | Slack"),
            Some(AppContextCategory::Chat)
        );
    }

    #[test]
    fn browser_title_notion_refines_to_notes() {
        assert_eq!(
            refine_browser_category("My Notes – Notion"),
            Some(AppContextCategory::Notes)
        );
    }

    #[test]
    fn browser_title_github_refines_to_code() {
        assert_eq!(
            refine_browser_category("Pull Requests · github"),
            Some(AppContextCategory::Code)
        );
    }

    #[test]
    fn browser_title_generic_returns_none() {
        assert_eq!(
            refine_browser_category("Wikipedia – The Free Encyclopedia"),
            None
        );
    }

    // ── AppContextCategory helpers ─────────────────────────────────────────────

    #[test]
    fn code_category_skips_post_processing() {
        assert!(AppContextCategory::Code.skip_post_processing());
        assert!(!AppContextCategory::Email.skip_post_processing());
        assert!(!AppContextCategory::Chat.skip_post_processing());
        assert!(!AppContextCategory::Notes.skip_post_processing());
        assert!(!AppContextCategory::Unknown.skip_post_processing());
    }

    // ── ActiveAppContextSnapshot ───────────────────────────────────────────────

    #[test]
    fn recent_apps_deduplicated_and_capped() {
        let mut snapshot = ActiveAppContextSnapshot::default();

        for i in 0..7u64 {
            let ctx = AppTranscriptionContext {
                process_name: Some(format!("app{}.exe", i % 3)), // 3 unique names
                window_title: None,
                category: AppContextCategory::Unknown,
                code_language: None,
                detected_at_ms: i * 1000,
            };
            snapshot.set_last_transcription_context(ctx);
        }

        let recent = snapshot.recent_apps();
        assert!(recent.len() <= MAX_RECENT_APPS);
        let names: Vec<_> = recent.iter().map(|e| &e.process_name).collect();
        let unique: std::collections::HashSet<_> = names.iter().collect();
        assert_eq!(names.len(), unique.len());
    }

    #[test]
    fn override_changes_category() {
        let mut snapshot = ActiveAppContextSnapshot::default();
        snapshot.set_override("notion.exe", AppContextCategory::Document);

        let mut ctx = AppTranscriptionContext {
            process_name: Some("notion.exe".to_string()),
            window_title: None,
            category: AppContextCategory::Notes,
            code_language: None,
            detected_at_ms: 0,
        };
        snapshot.apply_overrides(&mut ctx);
        assert_eq!(ctx.category, AppContextCategory::Document);
    }

    #[test]
    fn override_is_case_insensitive() {
        let mut snapshot = ActiveAppContextSnapshot::default();
        snapshot.set_override("Slack.exe", AppContextCategory::Document);

        let mut ctx = AppTranscriptionContext {
            process_name: Some("slack.exe".to_string()),
            window_title: None,
            category: AppContextCategory::Chat,
            code_language: None,
            detected_at_ms: 0,
        };
        snapshot.apply_overrides(&mut ctx);
        assert_eq!(ctx.category, AppContextCategory::Document);
    }

    #[test]
    fn remove_override_leaves_detected_category() {
        let mut snapshot = ActiveAppContextSnapshot::default();
        snapshot.set_override("obsidian.exe", AppContextCategory::Code);
        snapshot.remove_override("obsidian.exe");

        let mut ctx = AppTranscriptionContext {
            process_name: Some("obsidian.exe".to_string()),
            window_title: None,
            category: AppContextCategory::Notes,
            code_language: None,
            detected_at_ms: 0,
        };
        snapshot.apply_overrides(&mut ctx);
        assert_eq!(ctx.category, AppContextCategory::Notes);
    }

    #[test]
    fn unknown_context_builder_preserves_optional_fields() {
        let ctx = AppTranscriptionContext::unknown(None, None);
        assert_eq!(ctx.category, AppContextCategory::Unknown);
        assert!(ctx.process_name.is_none());
        assert!(ctx.window_title.is_none());
    }

    #[test]
    fn detection_failure_fallback_does_not_panic() {
        let ctx = AppTranscriptionContext::unknown(None, Some("fallback title".to_string()));
        assert_eq!(ctx.category, AppContextCategory::Unknown);
        assert_eq!(ctx.window_title.as_deref(), Some("fallback title"));
    }
}
