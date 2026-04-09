use anyhow::Result;
use log::{debug, info};
use rusqlite::{params, Connection};
use rusqlite_migration::{Migrations, M};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

static MIGRATIONS: &[M] = &[
    M::up(
        "CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        is_pinned INTEGER NOT NULL DEFAULT 0,
        is_archived INTEGER NOT NULL DEFAULT 0,
        summary TEXT NOT NULL DEFAULT '',
        action_items TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );",
    ),
    M::up("ALTER TABLE notes ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;"),
    M::up("ALTER TABLE notes ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;"),
    M::up("ALTER TABLE notes ADD COLUMN summary TEXT NOT NULL DEFAULT '';"),
    M::up("ALTER TABLE notes ADD COLUMN action_items TEXT NOT NULL DEFAULT '';"),
    M::up("ALTER TABLE notes ADD COLUMN category TEXT NOT NULL DEFAULT '';"),
];

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct NoteEntry {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub category: String,
    pub is_pinned: bool,
    pub is_archived: bool,
    pub summary: String,
    pub action_items: String,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct NoteManager {
    db_path: PathBuf,
}

impl NoteManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        let app_data_dir = app_handle.path().app_data_dir()?;
        let db_path = app_data_dir.join("notes.db");

        let manager = Self { db_path };
        manager.init_database()?;
        Ok(manager)
    }

    fn init_database(&self) -> Result<()> {
        info!("Initializing notes database at {:?}", self.db_path);
        let mut conn = Connection::open(&self.db_path)?;
        let migrations = Migrations::new(MIGRATIONS.to_vec());

        #[cfg(debug_assertions)]
        migrations.validate().expect("Invalid notes migrations");

        migrations.to_latest(&mut conn)?;
        debug!("Notes database initialized");
        Ok(())
    }

    fn open(&self) -> Result<Connection> {
        Ok(Connection::open(&self.db_path)?)
    }

    pub fn get_notes(&self) -> Result<Vec<NoteEntry>> {
        let conn = self.open()?;
        let mut stmt = conn.prepare(
            "SELECT id, title, content, category, is_pinned, is_archived, summary, action_items, created_at, updated_at FROM notes ORDER BY is_archived ASC, is_pinned DESC, updated_at DESC",
        )?;
        let entries = stmt
            .query_map([], |row| {
                Ok(NoteEntry {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    content: row.get(2)?,
                    category: row.get(3)?,
                    is_pinned: row.get::<_, i64>(4)? != 0,
                    is_archived: row.get::<_, i64>(5)? != 0,
                    summary: row.get(6)?,
                    action_items: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    pub fn create_note(&self, title: &str, content: &str) -> Result<NoteEntry> {
        let conn = self.open()?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO notes (title, content, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![title, content, now, now],
        )?;
        let id = conn.last_insert_rowid();
        Ok(NoteEntry {
            id,
            title: title.to_string(),
            content: content.to_string(),
            category: String::new(),
            is_pinned: false,
            is_archived: false,
            summary: String::new(),
            action_items: String::new(),
            created_at: now,
            updated_at: now,
        })
    }

    pub fn duplicate_note(&self, id: i64) -> Result<NoteEntry> {
        let conn = self.open()?;
        let mut stmt =
            conn.prepare("SELECT title, content, category, summary, action_items FROM notes WHERE id = ?1 LIMIT 1")?;
        let (title, content, category, summary, action_items): (
            String,
            String,
            String,
            String,
            String,
        ) = stmt.query_row(params![id], |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        })?;

        let duplicated_title = if title.trim().is_empty() {
            "Copie".to_string()
        } else {
            format!("{} (copie)", title.trim())
        };

        let duplicated = self.create_note(&duplicated_title, &content)?;
        self.set_category(duplicated.id, &category)?;
        self.set_ai_fields(
            duplicated.id,
            if summary.trim().is_empty() {
                None
            } else {
                Some(summary.as_str())
            },
            if action_items.trim().is_empty() {
                None
            } else {
                Some(action_items.as_str())
            },
        )?;
        let mut duplicated = duplicated;
        duplicated.category = category;
        duplicated.summary = summary;
        duplicated.action_items = action_items;
        Ok(duplicated)
    }

    pub fn update_note(&self, id: i64, title: &str, content: &str) -> Result<()> {
        let conn = self.open()?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE notes SET title = ?1, content = ?2, updated_at = ?3 WHERE id = ?4",
            params![title, content, now, id],
        )?;
        Ok(())
    }

    pub fn append_segment(&self, id: i64, segment: &str) -> Result<()> {
        let conn = self.open()?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE notes SET content = content || ?1, updated_at = ?2 WHERE id = ?3",
            params![segment, now, id],
        )?;
        Ok(())
    }

    pub fn delete_note(&self, id: i64) -> Result<()> {
        let conn = self.open()?;
        conn.execute("DELETE FROM notes WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn search_notes(&self, query: &str) -> Result<Vec<NoteEntry>> {
        let conn = self.open()?;
        let pattern = format!("%{}%", query);
        let mut stmt = conn.prepare(
            "SELECT id, title, content, category, is_pinned, is_archived, summary, action_items, created_at, updated_at FROM notes
             WHERE title LIKE ?1 OR content LIKE ?1 OR category LIKE ?1 OR summary LIKE ?1 OR action_items LIKE ?1
             ORDER BY is_archived ASC, is_pinned DESC, updated_at DESC",
        )?;
        let entries = stmt
            .query_map(params![pattern], |row| {
                Ok(NoteEntry {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    content: row.get(2)?,
                    category: row.get(3)?,
                    is_pinned: row.get::<_, i64>(4)? != 0,
                    is_archived: row.get::<_, i64>(5)? != 0,
                    summary: row.get(6)?,
                    action_items: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    pub fn set_category(&self, id: i64, category: &str) -> Result<()> {
        let conn = self.open()?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE notes SET category = ?1, updated_at = ?2 WHERE id = ?3",
            params![category.trim(), now, id],
        )?;
        Ok(())
    }

    pub fn set_pinned(&self, id: i64, pinned: bool) -> Result<()> {
        let conn = self.open()?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE notes SET is_pinned = ?1, updated_at = ?2 WHERE id = ?3",
            params![if pinned { 1 } else { 0 }, now, id],
        )?;
        Ok(())
    }

    pub fn set_archived(&self, id: i64, archived: bool) -> Result<()> {
        let conn = self.open()?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE notes SET is_archived = ?1, updated_at = ?2 WHERE id = ?3",
            params![if archived { 1 } else { 0 }, now, id],
        )?;
        Ok(())
    }

    pub fn set_ai_fields(
        &self,
        id: i64,
        summary: Option<&str>,
        action_items: Option<&str>,
    ) -> Result<()> {
        let conn = self.open()?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE notes
             SET summary = COALESCE(?1, summary),
                 action_items = COALESCE(?2, action_items),
                 updated_at = ?3
             WHERE id = ?4",
            params![summary, action_items, now, id],
        )?;
        Ok(())
    }
}
