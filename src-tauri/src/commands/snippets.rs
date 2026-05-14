use crate::settings::{get_settings, write_settings, VoiceSnippet};
use rand::Rng;
use tauri::AppHandle;

const MAX_TRIGGER_LEN: usize = 200;
const MAX_EXPANSION_LEN: usize = 10_000;
const WORKSPACE_MANAGED_SNIPPET_PREFIX: &str = "workspace:";

fn validate_snippet_fields(trigger: &str, expansion: &str) -> Result<(), String> {
    if trigger.is_empty() {
        return Err("Trigger cannot be empty".to_string());
    }
    if trigger.len() > MAX_TRIGGER_LEN {
        return Err(format!(
            "Trigger too long ({} chars, max {})",
            trigger.len(),
            MAX_TRIGGER_LEN
        ));
    }
    if expansion.is_empty() {
        return Err("Expansion cannot be empty".to_string());
    }
    if expansion.len() > MAX_EXPANSION_LEN {
        return Err(format!(
            "Expansion too long ({} chars, max {})",
            expansion.len(),
            MAX_EXPANSION_LEN
        ));
    }
    Ok(())
}

fn new_snippet_id() -> String {
    let mut rng = rand::thread_rng();
    format!("snip_{:016x}", rng.gen::<u64>())
}

fn is_workspace_managed_snippet_id(id: &str) -> bool {
    id.starts_with(WORKSPACE_MANAGED_SNIPPET_PREFIX)
}

#[tauri::command]
#[specta::specta]
pub fn get_voice_snippets(app: AppHandle) -> Vec<VoiceSnippet> {
    get_settings(&app).voice_snippets
}

#[tauri::command]
#[specta::specta]
pub fn add_voice_snippet(
    app: AppHandle,
    trigger: String,
    expansion: String,
) -> Result<VoiceSnippet, String> {
    let trigger = trigger.trim().to_string();
    let expansion = expansion.trim().to_string();

    validate_snippet_fields(&trigger, &expansion)?;

    let mut settings = get_settings(&app);

    // Duplicate trigger check
    if settings
        .voice_snippets
        .iter()
        .any(|s| s.trigger.trim().to_lowercase() == trigger.to_lowercase())
    {
        return Err(format!(
            "A snippet with trigger '{}' already exists",
            trigger
        ));
    }

    let snippet = VoiceSnippet {
        id: new_snippet_id(),
        trigger,
        expansion,
    };

    settings.voice_snippets.push(snippet.clone());
    write_settings(&app, settings);

    Ok(snippet)
}

#[tauri::command]
#[specta::specta]
pub fn remove_voice_snippet(app: AppHandle, id: String) -> Result<(), String> {
    let mut settings = get_settings(&app);
    let before = settings.voice_snippets.len();
    settings.voice_snippets.retain(|s| s.id != id);
    if settings.voice_snippets.len() == before {
        return Err(format!("Snippet not found: {}", id));
    }
    write_settings(&app, settings);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn update_voice_snippet(
    app: AppHandle,
    id: String,
    trigger: String,
    expansion: String,
) -> Result<(), String> {
    let trigger = trigger.trim().to_string();
    let expansion = expansion.trim().to_string();

    validate_snippet_fields(&trigger, &expansion)?;

    let mut settings = get_settings(&app);

    // Duplicate trigger check (excluding current snippet)
    if settings
        .voice_snippets
        .iter()
        .any(|s| s.id != id && s.trigger.trim().to_lowercase() == trigger.to_lowercase())
    {
        return Err(format!(
            "A snippet with trigger '{}' already exists",
            trigger
        ));
    }

    let snippet = settings
        .voice_snippets
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| format!("Snippet not found: {}", id))?;

    snippet.trigger = trigger;
    snippet.expansion = expansion;
    write_settings(&app, settings);

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn sync_workspace_voice_snippets(
    app: AppHandle,
    snippets: Vec<VoiceSnippet>,
) -> Result<(), String> {
    let mut dedupe_ids = std::collections::HashSet::new();
    let mut dedupe_triggers = std::collections::HashSet::new();

    let mut managed_snippets = Vec::with_capacity(snippets.len());
    for snippet in snippets {
        let trigger = snippet.trigger.trim().to_string();
        let expansion = snippet.expansion.trim().to_string();
        validate_snippet_fields(&trigger, &expansion)?;

        if !is_workspace_managed_snippet_id(&snippet.id) {
            return Err(format!(
                "Workspace-managed snippet ids must start with '{}'",
                WORKSPACE_MANAGED_SNIPPET_PREFIX
            ));
        }

        if !dedupe_ids.insert(snippet.id.clone()) {
            return Err(format!("Duplicate workspace snippet id '{}'", snippet.id));
        }

        let normalized_trigger = trigger.to_lowercase();
        if !dedupe_triggers.insert(normalized_trigger) {
            return Err(format!(
                "Duplicate workspace snippet trigger '{}'",
                trigger
            ));
        }

        managed_snippets.push(VoiceSnippet {
            id: snippet.id,
            trigger,
            expansion,
        });
    }

    let mut settings = get_settings(&app);
    let mut local_snippets = settings
        .voice_snippets
        .into_iter()
        .filter(|snippet| !is_workspace_managed_snippet_id(&snippet.id))
        .collect::<Vec<_>>();

    local_snippets.extend(managed_snippets);
    settings.voice_snippets = local_snippets;
    write_settings(&app, settings);

    Ok(())
}
