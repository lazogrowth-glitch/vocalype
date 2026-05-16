use anyhow::Result;
use log::{debug, info, warn};
use rusqlite::{params, Connection};
use rusqlite_migration::{Migrations, M};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const UNIFIED_DB_NAME: &str = "meetings.db";
const LEGACY_NOTES_DB_NAME: &str = "notes.db";
const NOTE_KIND: &str = "note";

static MIGRATIONS: &[M] = &[
    M::up(
        "CREATE TABLE IF NOT EXISTS meetings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT '',
        app_name TEXT NOT NULL DEFAULT '',
        transcript TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );",
    ),
    M::up("ALTER TABLE meetings ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;"),
    M::up("ALTER TABLE meetings ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;"),
    M::up("ALTER TABLE meetings ADD COLUMN summary TEXT NOT NULL DEFAULT '';"),
    M::up("ALTER TABLE meetings ADD COLUMN action_items TEXT NOT NULL DEFAULT '';"),
    M::up("ALTER TABLE meetings ADD COLUMN category TEXT NOT NULL DEFAULT '';"),
    M::up(
        "CREATE TABLE IF NOT EXISTS meeting_segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        meeting_id INTEGER NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );",
    ),
    M::up("ALTER TABLE meetings ADD COLUMN kind TEXT NOT NULL DEFAULT 'meeting';"),
    M::up("ALTER TABLE meeting_segments ADD COLUMN speaker TEXT NOT NULL DEFAULT '';"),
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
    legacy_db_path: PathBuf,
}

impl NoteManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        let app_data_dir = app_handle.path().app_data_dir()?;
        let db_path = app_data_dir.join(UNIFIED_DB_NAME);
        let legacy_db_path = app_data_dir.join(LEGACY_NOTES_DB_NAME);

        let manager = Self {
            db_path,
            legacy_db_path,
        };
        manager.init_database()?;
        manager.import_legacy_notes_if_needed()?;
        Ok(manager)
    }

    fn init_database(&self) -> Result<()> {
        info!("Initializing unified notes database at {:?}", self.db_path);
        let mut conn = Connection::open(&self.db_path)?;
        let migrations = Migrations::new(MIGRATIONS.to_vec());

        #[cfg(debug_assertions)]
        migrations
            .validate()
            .expect("Invalid unified notes migrations");

        self.reconcile_migration_version(&conn)?;
        migrations.to_latest(&mut conn)?;
        debug!("Unified notes database initialized");
        Ok(())
    }

    fn reconcile_migration_version(&self, conn: &Connection) -> Result<()> {
        let current_version: i32 =
            conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        let inferred_version = Self::infer_schema_version(conn)?;
        if inferred_version > current_version {
            info!(
                "Reconciling unified notes migration version from {} to {} based on existing schema",
                current_version, inferred_version
            );
            conn.pragma_update(None, "user_version", inferred_version)?;
        }
        Ok(())
    }

    fn infer_schema_version(conn: &Connection) -> Result<i32> {
        if !Self::table_exists(conn, "meetings")? {
            return Ok(0);
        }

        let version = if Self::column_exists(conn, "meetings", "kind")? {
            8
        } else if Self::table_exists(conn, "meeting_segments")? {
            7
        } else if Self::column_exists(conn, "meetings", "category")? {
            6
        } else if Self::column_exists(conn, "meetings", "action_items")? {
            5
        } else if Self::column_exists(conn, "meetings", "summary")? {
            4
        } else if Self::column_exists(conn, "meetings", "is_archived")? {
            3
        } else if Self::column_exists(conn, "meetings", "is_pinned")? {
            2
        } else {
            1
        };

        Ok(version)
    }

    fn table_exists(conn: &Connection, table: &str) -> Result<bool> {
        Ok(conn.query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name = ?1",
            params![table],
            |row| row.get(0),
        )?)
    }

    fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
        let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
        let columns = stmt.query_map([], |row| row.get::<_, String>(1))?;
        for existing in columns {
            if existing? == column {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn open(&self) -> Result<Connection> {
        Ok(Connection::open(&self.db_path)?)
    }

    fn import_legacy_notes_if_needed(&self) -> Result<()> {
        if !self.legacy_db_path.exists() {
            return Ok(());
        }

        if self.legacy_db_path == self.db_path {
            return Ok(());
        }

        let legacy_conn = Connection::open(&self.legacy_db_path)?;
        if !Self::table_exists(&legacy_conn, "notes")? {
            self.mark_legacy_db_imported()?;
            return Ok(());
        }

        let legacy_count: i64 =
            legacy_conn.query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))?;
        if legacy_count == 0 {
            self.mark_legacy_db_imported()?;
            return Ok(());
        }

        let unified_conn = self.open()?;
        let existing_count: i64 = unified_conn.query_row(
            "SELECT COUNT(*) FROM meetings WHERE kind = ?1",
            params![NOTE_KIND],
            |row| row.get(0),
        )?;

        if existing_count >= legacy_count {
            info!(
                "Legacy notes appear already imported (existing={}, legacy={}); archiving legacy notes DB",
                existing_count, legacy_count
            );
            self.mark_legacy_db_imported()?;
            return Ok(());
        }

        info!(
            "Importing {} legacy notes from {:?} into {:?}",
            legacy_count, self.legacy_db_path, self.db_path
        );

        let mut stmt = legacy_conn.prepare(
            "SELECT title, content, category, is_pinned, is_archived, summary, action_items, created_at, updated_at
             FROM notes
             ORDER BY created_at ASC, id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, i64>(8)?,
            ))
        })?;

        let mut conn = self.open()?;
        let tx = conn.transaction()?;
        for row in rows {
            let (
                title,
                content,
                category,
                is_pinned,
                is_archived,
                summary,
                action_items,
                created_at,
                updated_at,
            ) = row?;

            tx.execute(
                "INSERT INTO meetings (
                    title, app_name, transcript, category, is_pinned, is_archived,
                    summary, action_items, created_at, updated_at, kind
                 ) VALUES (?1, '', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    title,
                    content,
                    category,
                    is_pinned,
                    is_archived,
                    summary,
                    action_items,
                    created_at,
                    updated_at,
                    NOTE_KIND
                ],
            )?;
        }
        tx.commit()?;

        self.mark_legacy_db_imported()?;
        Ok(())
    }

    fn mark_legacy_db_imported(&self) -> Result<()> {
        if !self.legacy_db_path.exists() {
            return Ok(());
        }

        let archived_path = self.legacy_db_path.with_extension("db.imported-backup");
        match fs::rename(&self.legacy_db_path, &archived_path) {
            Ok(()) => {
                info!(
                    "Archived legacy notes DB from {:?} to {:?}",
                    self.legacy_db_path, archived_path
                );
            }
            Err(err) => {
                warn!(
                    "Failed to archive legacy notes DB {:?}: {}",
                    self.legacy_db_path, err
                );
            }
        }
        Ok(())
    }

    fn map_row_to_note(row: &rusqlite::Row<'_>) -> rusqlite::Result<NoteEntry> {
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
    }

    pub fn get_notes(&self) -> Result<Vec<NoteEntry>> {
        let conn = self.open()?;
        let mut stmt = conn.prepare(
            "SELECT id, title, transcript, category, is_pinned, is_archived, summary, action_items, created_at, updated_at
             FROM meetings
             WHERE kind = ?1
             ORDER BY is_archived ASC, is_pinned DESC, updated_at DESC",
        )?;
        let entries = stmt
            .query_map(params![NOTE_KIND], Self::map_row_to_note)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    pub fn create_note(&self, title: &str, content: &str) -> Result<NoteEntry> {
        let conn = self.open()?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO meetings (title, app_name, transcript, created_at, updated_at, kind)
             VALUES (?1, '', ?2, ?3, ?4, ?5)",
            params![title, content, now, now, NOTE_KIND],
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
        let mut stmt = conn.prepare(
            "SELECT title, transcript, category, summary, action_items
             FROM meetings
             WHERE id = ?1 AND kind = ?2
             LIMIT 1",
        )?;
        let (title, content, category, summary, action_items): (
            String,
            String,
            String,
            String,
            String,
        ) = stmt.query_row(params![id, NOTE_KIND], |row| {
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
            "UPDATE meetings
             SET title = ?1, transcript = ?2, updated_at = ?3
             WHERE id = ?4 AND kind = ?5",
            params![title, content, now, id, NOTE_KIND],
        )?;
        Ok(())
    }

    pub fn append_segment(&self, id: i64, segment: &str) -> Result<()> {
        let conn = self.open()?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE meetings
             SET transcript = transcript || ?1, updated_at = ?2
             WHERE id = ?3 AND kind = ?4",
            params![segment, now, id, NOTE_KIND],
        )?;
        Ok(())
    }

    pub fn delete_note(&self, id: i64) -> Result<()> {
        let conn = self.open()?;
        conn.execute(
            "DELETE FROM meetings WHERE id = ?1 AND kind = ?2",
            params![id, NOTE_KIND],
        )?;
        Ok(())
    }

    pub fn search_notes(&self, query: &str) -> Result<Vec<NoteEntry>> {
        let conn = self.open()?;
        let pattern = format!("%{}%", query);
        let mut stmt = conn.prepare(
            "SELECT id, title, transcript, category, is_pinned, is_archived, summary, action_items, created_at, updated_at
             FROM meetings
             WHERE kind = ?1
               AND (title LIKE ?2 OR transcript LIKE ?2 OR category LIKE ?2 OR summary LIKE ?2 OR action_items LIKE ?2)
             ORDER BY is_archived ASC, is_pinned DESC, updated_at DESC",
        )?;
        let entries = stmt
            .query_map(params![NOTE_KIND, pattern], Self::map_row_to_note)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    pub fn set_category(&self, id: i64, category: &str) -> Result<()> {
        let conn = self.open()?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE meetings SET category = ?1, updated_at = ?2 WHERE id = ?3 AND kind = ?4",
            params![category.trim(), now, id, NOTE_KIND],
        )?;
        Ok(())
    }

    pub fn set_pinned(&self, id: i64, pinned: bool) -> Result<()> {
        let conn = self.open()?;
        conn.execute(
            "UPDATE meetings SET is_pinned = ?1 WHERE id = ?2 AND kind = ?3",
            params![if pinned { 1 } else { 0 }, id, NOTE_KIND],
        )?;
        Ok(())
    }

    pub fn set_archived(&self, id: i64, archived: bool) -> Result<()> {
        let conn = self.open()?;
        conn.execute(
            "UPDATE meetings SET is_archived = ?1 WHERE id = ?2 AND kind = ?3",
            params![if archived { 1 } else { 0 }, id, NOTE_KIND],
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
            "UPDATE meetings
             SET summary = COALESCE(?1, summary),
                 action_items = COALESCE(?2, action_items),
                 updated_at = ?3
             WHERE id = ?4 AND kind = ?5",
            params![summary, action_items, now, id, NOTE_KIND],
        )?;
        Ok(())
    }
}

#[allow(dead_code)]
fn _assert_path_stable(path: &Path) -> bool {
    path.exists()
}
