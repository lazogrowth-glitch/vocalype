use crate::managers::notes::{NoteEntry, NoteManager};
use crate::processing::post_processing::process_action;
use std::sync::Arc;
use tauri::AppHandle;
use tauri::State;

use crate::actions::note::{close_active_note, set_active_note as set_active_note_id};

#[tauri::command]
#[specta::specta]
pub fn get_notes(note_manager: State<Arc<NoteManager>>) -> Result<Vec<NoteEntry>, String> {
    note_manager.get_notes().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn create_note(
    title: String,
    content: String,
    note_manager: State<Arc<NoteManager>>,
) -> Result<NoteEntry, String> {
    note_manager
        .create_note(&title, &content)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn duplicate_note(id: i64, note_manager: State<Arc<NoteManager>>) -> Result<NoteEntry, String> {
    note_manager.duplicate_note(id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn update_note(
    id: i64,
    title: String,
    content: String,
    note_manager: State<Arc<NoteManager>>,
) -> Result<(), String> {
    note_manager
        .update_note(id, &title, &content)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn set_note_pinned(
    id: i64,
    pinned: bool,
    note_manager: State<Arc<NoteManager>>,
) -> Result<(), String> {
    note_manager
        .set_pinned(id, pinned)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn set_note_archived(
    id: i64,
    archived: bool,
    note_manager: State<Arc<NoteManager>>,
) -> Result<(), String> {
    note_manager
        .set_archived(id, archived)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn set_note_category(
    id: i64,
    category: String,
    note_manager: State<Arc<NoteManager>>,
) -> Result<(), String> {
    note_manager
        .set_category(id, &category)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_note(id: i64, note_manager: State<Arc<NoteManager>>) -> Result<(), String> {
    note_manager.delete_note(id).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn search_notes(
    query: String,
    note_manager: State<Arc<NoteManager>>,
) -> Result<Vec<NoteEntry>, String> {
    note_manager.search_notes(&query).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn export_note(
    id: i64,
    format: String,
    note_manager: State<Arc<NoteManager>>,
) -> Result<String, String> {
    let notes = note_manager.get_notes().map_err(|e| e.to_string())?;
    let note = notes
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "NOTE_NOT_FOUND".to_string())?;

    let title = if note.title.trim().is_empty() {
        "Sans titre".to_string()
    } else {
        note.title.trim().to_string()
    };
    let updated_at = chrono::DateTime::from_timestamp_millis(note.updated_at)
        .map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_default();
    let category_section_md = if note.category.trim().is_empty() {
        String::new()
    } else {
        format!("*Categorie : {}*\n\n", note.category.trim())
    };
    let category_section_txt = if note.category.trim().is_empty() {
        String::new()
    } else {
        format!("Categorie: {}\n\n", note.category.trim())
    };
    let summary_section_md = if note.summary.trim().is_empty() {
        String::new()
    } else {
        format!("## Resume\n\n{}\n\n", note.summary.trim())
    };
    let actions_section_md = if note.action_items.trim().is_empty() {
        String::new()
    } else {
        format!("## Actions\n\n{}\n\n", note.action_items.trim())
    };
    let summary_section_txt = if note.summary.trim().is_empty() {
        String::new()
    } else {
        format!("RESUME\n{}\n\n", note.summary.trim())
    };
    let actions_section_txt = if note.action_items.trim().is_empty() {
        String::new()
    } else {
        format!("ACTIONS\n{}\n\n", note.action_items.trim())
    };

    match format.as_str() {
        "md" => Ok(format!(
            "# {}\n\n*Derniere mise a jour : {}*\n\n{}{}{}{}\n",
            title,
            updated_at,
            category_section_md,
            summary_section_md,
            actions_section_md,
            note.content
        )),
        _ => Ok(format!(
            "{}\n{}\n\n{}{}{}{}\n",
            title,
            updated_at,
            category_section_txt,
            summary_section_txt,
            actions_section_txt,
            note.content
        )),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn summarize_note(
    app: AppHandle,
    id: i64,
    note_manager: State<'_, Arc<NoteManager>>,
) -> Result<String, String> {
    let notes = note_manager.get_notes().map_err(|e| e.to_string())?;
    let note = notes
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "NOTE_NOT_FOUND".to_string())?;

    let content = note.content.trim();
    if content.is_empty() {
        return Err("NOTE_EMPTY".to_string());
    }

    let settings = crate::settings::get_settings(&app);
    if settings.active_post_process_provider().is_none() {
        return Err("NO_AI_PROVIDER_CONFIGURED".to_string());
    }

    let prompt = if settings.selected_language.starts_with("fr") {
        "Resume le texte suivant en points clairs et actionnables. Garde uniquement l'essentiel. N'ajoute aucune introduction. ${output}"
    } else {
        "Summarize the following text into clear, actionable bullet points. Keep only the essential information. Do not add any introduction. ${output}"
    };

    let summary = process_action(&settings, content, prompt, None, None)
        .await
        .filter(|summary| !summary.trim().is_empty())
        .ok_or_else(|| "Failed to generate summary".to_string())?;

    note_manager
        .set_ai_fields(id, Some(summary.trim()), None)
        .map_err(|e| e.to_string())?;

    Ok(summary)
}

#[tauri::command]
#[specta::specta]
pub async fn extract_note_actions(
    app: AppHandle,
    id: i64,
    note_manager: State<'_, Arc<NoteManager>>,
) -> Result<String, String> {
    let notes = note_manager.get_notes().map_err(|e| e.to_string())?;
    let note = notes
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "NOTE_NOT_FOUND".to_string())?;

    let content = note.content.trim();
    if content.is_empty() {
        return Err("NOTE_EMPTY".to_string());
    }

    let settings = crate::settings::get_settings(&app);
    if settings.active_post_process_provider().is_none() {
        return Err("NO_AI_PROVIDER_CONFIGURED".to_string());
    }

    let prompt = if settings.selected_language.starts_with("fr") {
        "Extrait uniquement les actions, taches ou suivis implicites du texte suivant. Retourne une checklist concise en markdown avec une ligne par action. Si aucune action n'existe, retourne '- Aucune action claire'. ${output}"
    } else {
        "Extract only the actions, tasks, or follow-ups implied by the following text. Return a concise markdown checklist with one line per action. If there are no clear actions, return '- No clear actions'. ${output}"
    };

    let actions = process_action(&settings, content, prompt, None, None)
        .await
        .filter(|actions| !actions.trim().is_empty())
        .ok_or_else(|| "Failed to extract actions".to_string())?;

    note_manager
        .set_ai_fields(id, None, Some(actions.trim()))
        .map_err(|e| e.to_string())?;

    Ok(actions)
}

#[tauri::command]
#[specta::specta]
pub async fn generate_note_title(
    app: AppHandle,
    id: i64,
    note_manager: State<'_, Arc<NoteManager>>,
) -> Result<String, String> {
    let notes = note_manager.get_notes().map_err(|e| e.to_string())?;
    let note = notes
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "NOTE_NOT_FOUND".to_string())?;

    let content = note.content.trim();
    if content.is_empty() {
        return Err("NOTE_EMPTY".to_string());
    }

    let settings = crate::settings::get_settings(&app);
    if settings.active_post_process_provider().is_none() {
        return Err("NO_AI_PROVIDER_CONFIGURED".to_string());
    }

    let prompt = if settings.selected_language.starts_with("fr") {
        "Genere un titre tres court et clair pour cette note. Maximum 6 mots. Pas de guillemets, pas de ponctuation finale, retourne uniquement le titre. ${output}"
    } else {
        "Generate a very short and clear title for this note. Maximum 6 words. No quotes, no ending punctuation, return only the title. ${output}"
    };

    let title = process_action(&settings, content, prompt, None, None)
        .await
        .map(|value| {
            value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string()
        })
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Failed to generate title".to_string())?;

    note_manager
        .update_note(id, &title, &note.content)
        .map_err(|e| e.to_string())?;

    Ok(title)
}

#[tauri::command]
#[specta::specta]
pub fn close_note(_app: AppHandle) {
    close_active_note();
}

#[tauri::command]
#[specta::specta]
pub fn set_active_note(_app: AppHandle, id: Option<i64>) {
    set_active_note_id(id);
}
