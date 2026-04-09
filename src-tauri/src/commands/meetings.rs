use crate::managers::meetings::{MeetingEntry, MeetingManager};
use crate::platform::process_monitor::detect_meeting_app;
use crate::processing::post_processing::process_action;
use std::sync::Arc;
use tauri::{AppHandle, State};

#[derive(Clone, serde::Serialize, specta::Type)]
pub struct MeetingChapter {
    pub start_ms: i64,
    pub end_ms: i64,
    pub label: String,
    pub preview: String,
}

fn build_meeting_chapters(meeting: &MeetingEntry) -> Vec<MeetingChapter> {
    if meeting.segments.is_empty() {
        return Vec::new();
    }

    let mut chapters = Vec::new();
    let mut current = Vec::new();

    let flush = |current: &mut Vec<crate::managers::meetings::MeetingSegmentEntry>,
                 chapters: &mut Vec<MeetingChapter>| {
        if current.is_empty() {
            return;
        }
        let preview = current
            .iter()
            .map(|segment| segment.content.trim())
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        let label = preview
            .split_whitespace()
            .take(6)
            .collect::<Vec<_>>()
            .join(" ");
        chapters.push(MeetingChapter {
            start_ms: current
                .first()
                .map(|segment| segment.timestamp_ms)
                .unwrap_or_default(),
            end_ms: current
                .last()
                .map(|segment| segment.timestamp_ms)
                .unwrap_or_default(),
            label: if label.is_empty() {
                "Chapitre".to_string()
            } else {
                label
            },
            preview,
        });
        current.clear();
    };

    for segment in &meeting.segments {
        if current.is_empty() {
            current.push(segment.clone());
            continue;
        }

        let previous = current.last().expect("current not empty");
        let current_preview_len = current
            .iter()
            .map(|entry| entry.content.trim().len())
            .sum::<usize>();
        let should_split = (segment.timestamp_ms - previous.timestamp_ms) > 90_000
            || current.len() >= 4
            || current_preview_len > 260;

        if should_split {
            flush(&mut current, &mut chapters);
        }
        current.push(segment.clone());
    }

    flush(&mut current, &mut chapters);
    chapters
}

fn format_chapter_clock(timestamp_ms: i64, base_ms: i64) -> String {
    let delta_secs = ((timestamp_ms - base_ms).max(0)) / 1000;
    let minutes = delta_secs / 60;
    let seconds = delta_secs % 60;
    format!("{minutes:02}:{seconds:02}")
}

// Re-export so frontend can manage the active meeting session explicitly.
use crate::actions::meeting::{close_active_meeting, set_active_meeting as set_active_meeting_id};

#[tauri::command]
#[specta::specta]
pub fn get_meetings(
    meeting_manager: State<Arc<MeetingManager>>,
) -> Result<Vec<MeetingEntry>, String> {
    meeting_manager.get_meetings().map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn create_meeting(
    meeting_manager: State<Arc<MeetingManager>>,
    title: String,
    app_name: String,
) -> Result<MeetingEntry, String> {
    meeting_manager
        .create_meeting(&title, &app_name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn duplicate_meeting(
    meeting_manager: State<Arc<MeetingManager>>,
    id: i64,
) -> Result<MeetingEntry, String> {
    meeting_manager
        .duplicate_meeting(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn update_meeting(
    meeting_manager: State<Arc<MeetingManager>>,
    id: i64,
    title: String,
    transcript: String,
) -> Result<(), String> {
    meeting_manager
        .update_meeting(id, &title, &transcript)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn set_meeting_pinned(
    meeting_manager: State<Arc<MeetingManager>>,
    id: i64,
    pinned: bool,
) -> Result<(), String> {
    meeting_manager
        .set_pinned(id, pinned)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn set_meeting_archived(
    meeting_manager: State<Arc<MeetingManager>>,
    id: i64,
    archived: bool,
) -> Result<(), String> {
    meeting_manager
        .set_archived(id, archived)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn set_meeting_category(
    meeting_manager: State<Arc<MeetingManager>>,
    id: i64,
    category: String,
) -> Result<(), String> {
    meeting_manager
        .set_category(id, &category)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn delete_meeting(meeting_manager: State<Arc<MeetingManager>>, id: i64) -> Result<(), String> {
    meeting_manager
        .delete_meeting(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn search_meetings(
    meeting_manager: State<Arc<MeetingManager>>,
    query: String,
) -> Result<Vec<MeetingEntry>, String> {
    meeting_manager
        .search_meetings(&query)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub fn export_meeting(
    meeting_manager: State<Arc<MeetingManager>>,
    id: i64,
    format: String,
) -> Result<String, String> {
    let meetings = meeting_manager.get_meetings().map_err(|e| e.to_string())?;
    let meeting = meetings
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "Reunion introuvable".to_string())?;

    let title = if meeting.title.trim().is_empty() {
        "Reunion".to_string()
    } else {
        meeting.title.trim().to_string()
    };
    let updated_at = chrono::DateTime::from_timestamp_millis(meeting.updated_at)
        .map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string())
        .unwrap_or_default();
    let app_name = meeting.app_name.trim();
    let category_section_md = if meeting.category.trim().is_empty() {
        String::new()
    } else {
        format!("*Categorie : {}*\n\n", meeting.category.trim())
    };
    let category_section_txt = if meeting.category.trim().is_empty() {
        String::new()
    } else {
        format!("Categorie: {}\n\n", meeting.category.trim())
    };
    let summary_section_md = if meeting.summary.trim().is_empty() {
        String::new()
    } else {
        format!("## Resume\n\n{}\n\n", meeting.summary.trim())
    };
    let actions_section_md = if meeting.action_items.trim().is_empty() {
        String::new()
    } else {
        format!("## Actions\n\n{}\n\n", meeting.action_items.trim())
    };
    let summary_section_txt = if meeting.summary.trim().is_empty() {
        String::new()
    } else {
        format!("RESUME\n{}\n\n", meeting.summary.trim())
    };
    let actions_section_txt = if meeting.action_items.trim().is_empty() {
        String::new()
    } else {
        format!("ACTIONS\n{}\n\n", meeting.action_items.trim())
    };
    let chapters = build_meeting_chapters(&meeting);
    let chapters_section_md = if chapters.is_empty() {
        String::new()
    } else {
        let base_ms = meeting
            .segments
            .first()
            .map(|segment| segment.timestamp_ms)
            .unwrap_or(meeting.created_at);
        let lines = chapters
            .iter()
            .map(|chapter| {
                format!(
                    "- **{}** {}  \n  {}",
                    format_chapter_clock(chapter.start_ms, base_ms),
                    chapter.label,
                    chapter.preview
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        format!("## Chapitres\n\n{}\n\n", lines)
    };
    let chapters_section_txt = if chapters.is_empty() {
        String::new()
    } else {
        let base_ms = meeting
            .segments
            .first()
            .map(|segment| segment.timestamp_ms)
            .unwrap_or(meeting.created_at);
        let lines = chapters
            .iter()
            .map(|chapter| {
                format!(
                    "[{}] {}\n{}\n",
                    format_chapter_clock(chapter.start_ms, base_ms),
                    chapter.label,
                    chapter.preview
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        format!("CHAPITRES\n{}\n\n", lines)
    };

    match format.as_str() {
        "md" => Ok(format!(
            "# {}\n\n*Derniere mise a jour : {}*\n\n*Application : {}*\n\n{}{}{}{}{}\n",
            title,
            updated_at,
            if app_name.is_empty() { "-" } else { app_name },
            category_section_md,
            chapters_section_md,
            summary_section_md,
            actions_section_md,
            meeting.transcript
        )),
        _ => Ok(format!(
            "{}\n{}\n{}\n\n{}{}{}{}{}\n",
            title,
            updated_at,
            if app_name.is_empty() { "-" } else { app_name },
            category_section_txt,
            chapters_section_txt,
            summary_section_txt,
            actions_section_txt,
            meeting.transcript
        )),
    }
}

#[tauri::command]
#[specta::specta]
pub async fn generate_meeting_chapter_titles(
    app: AppHandle,
    meeting_manager: State<'_, Arc<MeetingManager>>,
    id: i64,
) -> Result<Vec<String>, String> {
    let meetings = meeting_manager.get_meetings().map_err(|e| e.to_string())?;
    let meeting = meetings
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "Reunion introuvable".to_string())?;

    let chapters = build_meeting_chapters(&meeting);
    if chapters.is_empty() {
        return Ok(Vec::new());
    }

    let settings = crate::settings::get_settings(&app);
    if settings.active_post_process_provider().is_none() {
        return Err("Aucun fournisseur IA configure".to_string());
    }

    let source = chapters
        .iter()
        .enumerate()
        .map(|(index, chapter)| format!("{}. {}", index + 1, chapter.preview))
        .collect::<Vec<_>>()
        .join("\n");

    let prompt = if settings.selected_language.starts_with("fr") {
        "Pour chaque chapitre ci-dessous, genere un titre tres court et clair de 2 a 5 mots. Retourne exactement une ligne par chapitre, dans le meme ordre, sans numerotation, sans puces, sans ponctuation finale. ${output}"
    } else {
        "For each chapter below, generate a very short and clear 2-5 word title. Return exactly one line per chapter, in the same order, without numbering, bullets, or ending punctuation. ${output}"
    };

    let raw = process_action(&settings, &source, prompt, None, None)
        .await
        .ok_or_else(|| "Impossible de generer les titres de chapitres".to_string())?;

    let mut titles = raw
        .lines()
        .map(|line| {
            line.trim()
                .trim_start_matches(|c: char| c.is_numeric() || c == '.' || c == '-' || c == ')')
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string()
        })
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();

    if titles.len() < chapters.len() {
        titles.extend(
            chapters[titles.len()..]
                .iter()
                .map(|chapter| chapter.label.clone()),
        );
    } else if titles.len() > chapters.len() {
        titles.truncate(chapters.len());
    }

    Ok(titles)
}

#[tauri::command]
#[specta::specta]
pub async fn summarize_meeting(
    app: AppHandle,
    meeting_manager: State<'_, Arc<MeetingManager>>,
    id: i64,
) -> Result<String, String> {
    let meetings = meeting_manager.get_meetings().map_err(|e| e.to_string())?;
    let meeting = meetings
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "Reunion introuvable".to_string())?;

    let transcript = meeting.transcript.trim();
    if transcript.is_empty() {
        return Err("La reunion est vide".to_string());
    }

    let settings = crate::settings::get_settings(&app);
    if settings.active_post_process_provider().is_none() {
        return Err("Aucun fournisseur IA configure".to_string());
    }

    let prompt = if settings.selected_language.starts_with("fr") {
        "Resume cette reunion en points essentiels avec decisions, actions et informations importantes. Pas d'introduction. ${output}"
    } else {
        "Summarize this meeting into essential bullets with decisions, action items, and key information. No introduction. ${output}"
    };

    let summary = process_action(&settings, transcript, prompt, None, None)
        .await
        .filter(|summary| !summary.trim().is_empty())
        .ok_or_else(|| "Impossible de generer un resume".to_string())?;

    meeting_manager
        .set_ai_fields(id, Some(summary.trim()), None)
        .map_err(|e| e.to_string())?;

    Ok(summary)
}

#[tauri::command]
#[specta::specta]
pub async fn extract_meeting_actions(
    app: AppHandle,
    meeting_manager: State<'_, Arc<MeetingManager>>,
    id: i64,
) -> Result<String, String> {
    let meetings = meeting_manager.get_meetings().map_err(|e| e.to_string())?;
    let meeting = meetings
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "Reunion introuvable".to_string())?;

    let transcript = meeting.transcript.trim();
    if transcript.is_empty() {
        return Err("La reunion est vide".to_string());
    }

    let settings = crate::settings::get_settings(&app);
    if settings.active_post_process_provider().is_none() {
        return Err("Aucun fournisseur IA configure".to_string());
    }

    let prompt = if settings.selected_language.starts_with("fr") {
        "Extrait les decisions, actions et suivis concrets de cette reunion. Retourne uniquement une checklist markdown concise avec une ligne par action. Si aucune action n'est claire, retourne '- Aucune action claire'. ${output}"
    } else {
        "Extract the concrete decisions, action items, and follow-ups from this meeting. Return only a concise markdown checklist with one line per action. If no action is clear, return '- No clear actions'. ${output}"
    };

    let actions = process_action(&settings, transcript, prompt, None, None)
        .await
        .filter(|actions| !actions.trim().is_empty())
        .ok_or_else(|| "Impossible d'extraire les actions".to_string())?;

    meeting_manager
        .set_ai_fields(id, None, Some(actions.trim()))
        .map_err(|e| e.to_string())?;

    Ok(actions)
}

#[tauri::command]
#[specta::specta]
pub async fn generate_meeting_title(
    app: AppHandle,
    meeting_manager: State<'_, Arc<MeetingManager>>,
    id: i64,
) -> Result<String, String> {
    let meetings = meeting_manager.get_meetings().map_err(|e| e.to_string())?;
    let meeting = meetings
        .into_iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "Reunion introuvable".to_string())?;

    let transcript = meeting.transcript.trim();
    if transcript.is_empty() {
        return Err("La reunion est vide".to_string());
    }

    let settings = crate::settings::get_settings(&app);
    if settings.active_post_process_provider().is_none() {
        return Err("Aucun fournisseur IA configure".to_string());
    }

    let prompt = if settings.selected_language.starts_with("fr") {
        "Genere un titre tres court et clair pour cette reunion. Maximum 6 mots. Pas de guillemets, pas de ponctuation finale, retourne uniquement le titre. ${output}"
    } else {
        "Generate a very short and clear title for this meeting. Maximum 6 words. No quotes, no ending punctuation, return only the title. ${output}"
    };

    let title = process_action(&settings, transcript, prompt, None, None)
        .await
        .map(|value| {
            value
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string()
        })
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Impossible de generer un titre".to_string())?;

    meeting_manager
        .update_meeting(id, &title, &meeting.transcript)
        .map_err(|e| e.to_string())?;

    Ok(title)
}

/// Returns the name of the currently running meeting app, or `null` if none detected.
#[tauri::command]
#[specta::specta]
pub fn detect_active_meeting_app(_app: AppHandle) -> Option<String> {
    detect_meeting_app()
}

/// Close the active meeting so the next `meeting_key` press starts a fresh one.
#[tauri::command]
#[specta::specta]
pub fn close_meeting(_app: AppHandle) {
    close_active_meeting();
}

#[tauri::command]
#[specta::specta]
pub fn set_active_meeting(_app: AppHandle, id: Option<i64>) {
    set_active_meeting_id(id);
}
