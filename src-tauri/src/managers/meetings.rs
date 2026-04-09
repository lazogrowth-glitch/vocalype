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
        "CREATE TABLE IF NOT EXISTS meetings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT '',
        app_name TEXT NOT NULL DEFAULT '',
        transcript TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        is_pinned INTEGER NOT NULL DEFAULT 0,
        is_archived INTEGER NOT NULL DEFAULT 0,
        summary TEXT NOT NULL DEFAULT '',
        action_items TEXT NOT NULL DEFAULT '',
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
];

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct MeetingSegmentEntry {
    pub id: i64,
    pub meeting_id: i64,
    pub timestamp_ms: i64,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Type)]
pub struct MeetingEntry {
    pub id: i64,
    pub title: String,
    pub app_name: String,
    pub transcript: String,
    pub category: String,
    pub is_pinned: bool,
    pub is_archived: bool,
    pub summary: String,
    pub action_items: String,
    pub segments: Vec<MeetingSegmentEntry>,
    pub created_at: i64,
    pub updated_at: i64,
}

pub struct MeetingManager {
    db_path: PathBuf,
}

impl MeetingManager {
    pub fn new(app_handle: &AppHandle) -> Result<Self> {
        let app_data_dir = app_handle.path().app_data_dir()?;
        let db_path = app_data_dir.join("meetings.db");

        let manager = Self { db_path };
        manager.init_database()?;
        Ok(manager)
    }

    fn init_database(&self) -> Result<()> {
        info!("Initializing meetings database at {:?}", self.db_path);
        let mut conn = Connection::open(&self.db_path)?;
        let migrations = Migrations::new(MIGRATIONS.to_vec());

        #[cfg(debug_assertions)]
        migrations.validate().expect("Invalid meetings migrations");

        migrations.to_latest(&mut conn)?;
        debug!("Meetings database initialized");
        Ok(())
    }

    fn open(&self) -> Result<Connection> {
        Ok(Connection::open(&self.db_path)?)
    }

    fn load_segments(conn: &Connection, meeting_id: i64) -> Result<Vec<MeetingSegmentEntry>> {
        let mut stmt = conn.prepare(
            "SELECT id, meeting_id, timestamp_ms, content
             FROM meeting_segments
             WHERE meeting_id = ?1
             ORDER BY timestamp_ms ASC, id ASC",
        )?;
        let segments = stmt
            .query_map(params![meeting_id], |row| {
                Ok(MeetingSegmentEntry {
                    id: row.get(0)?,
                    meeting_id: row.get(1)?,
                    timestamp_ms: row.get(2)?,
                    content: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(segments)
    }

    pub fn get_meetings(&self) -> Result<Vec<MeetingEntry>> {
        let conn = self.open()?;
        let mut stmt = conn.prepare(
            "SELECT id, title, app_name, transcript, category, is_pinned, is_archived, summary, action_items, created_at, updated_at FROM meetings ORDER BY is_archived ASC, is_pinned DESC, updated_at DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)? != 0,
                    row.get::<_, i64>(6)? != 0,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, i64>(10)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut entries = Vec::with_capacity(rows.len());
        for (
            id,
            title,
            app_name,
            transcript,
            category,
            is_pinned,
            is_archived,
            summary,
            action_items,
            created_at,
            updated_at,
        ) in rows
        {
            entries.push(MeetingEntry {
                id,
                title,
                app_name,
                transcript,
                category,
                is_pinned,
                is_archived,
                summary,
                action_items,
                segments: Self::load_segments(&conn, id)?,
                created_at,
                updated_at,
            });
        }
        Ok(entries)
    }

    pub fn create_meeting(&self, title: &str, app_name: &str) -> Result<MeetingEntry> {
        let conn = self.open()?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO meetings (title, app_name, transcript, created_at, updated_at) VALUES (?1, ?2, '', ?3, ?4)",
            params![title, app_name, now, now],
        )?;
        let id = conn.last_insert_rowid();
        Ok(MeetingEntry {
            id,
            title: title.to_string(),
            app_name: app_name.to_string(),
            transcript: String::new(),
            category: String::new(),
            is_pinned: false,
            is_archived: false,
            summary: String::new(),
            action_items: String::new(),
            segments: Vec::new(),
            created_at: now,
            updated_at: now,
        })
    }

    pub fn duplicate_meeting(&self, id: i64) -> Result<MeetingEntry> {
        let conn = self.open()?;
        let source_segments = Self::load_segments(&conn, id)?;
        let mut stmt = conn.prepare(
            "SELECT title, app_name, transcript, category, summary, action_items FROM meetings WHERE id = ?1 LIMIT 1",
        )?;
        let (title, app_name, transcript, category, summary, action_items): (
            String,
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
                row.get(5)?,
            ))
        })?;

        let duplicated_title = if title.trim().is_empty() {
            "Reunion (copie)".to_string()
        } else {
            format!("{} (copie)", title.trim())
        };

        let mut duplicated = self.create_meeting(&duplicated_title, &app_name)?;
        self.update_meeting(duplicated.id, &duplicated_title, &transcript)?;
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
        for source_segment in &source_segments {
            conn.execute(
                "INSERT INTO meeting_segments (meeting_id, timestamp_ms, content) VALUES (?1, ?2, ?3)",
                params![duplicated.id, source_segment.timestamp_ms, source_segment.content],
            )?;
        }
        duplicated.transcript = transcript;
        duplicated.category = category;
        duplicated.summary = summary;
        duplicated.action_items = action_items;
        duplicated.segments = Self::load_segments(&conn, duplicated.id)?;
        Ok(duplicated)
    }

    pub fn append_segment(
        &self,
        id: i64,
        segment: &str,
        timestamp_ms: i64,
    ) -> Result<MeetingSegmentEntry> {
        let conn = self.open()?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE meetings SET transcript = transcript || ?1, updated_at = ?2 WHERE id = ?3",
            params![segment, now, id],
        )?;
        conn.execute(
            "INSERT INTO meeting_segments (meeting_id, timestamp_ms, content) VALUES (?1, ?2, ?3)",
            params![id, timestamp_ms, segment],
        )?;
        let segment_id = conn.last_insert_rowid();
        Ok(MeetingSegmentEntry {
            id: segment_id,
            meeting_id: id,
            timestamp_ms,
            content: segment.to_string(),
        })
    }

    pub fn update_meeting(&self, id: i64, title: &str, transcript: &str) -> Result<()> {
        let conn = self.open()?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE meetings SET title = ?1, transcript = ?2, updated_at = ?3 WHERE id = ?4",
            params![title, transcript, now, id],
        )?;
        Ok(())
    }

    pub fn delete_meeting(&self, id: i64) -> Result<()> {
        let conn = self.open()?;
        conn.execute("DELETE FROM meetings WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn search_meetings(&self, query: &str) -> Result<Vec<MeetingEntry>> {
        let conn = self.open()?;
        let pattern = format!("%{}%", query);
        let mut stmt = conn.prepare(
            "SELECT id, title, app_name, transcript, category, is_pinned, is_archived, summary, action_items, created_at, updated_at FROM meetings
             WHERE title LIKE ?1 OR transcript LIKE ?1 OR category LIKE ?1 OR summary LIKE ?1 OR action_items LIKE ?1
             ORDER BY is_archived ASC, is_pinned DESC, updated_at DESC",
        )?;
        let rows = stmt
            .query_map(params![pattern], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)? != 0,
                    row.get::<_, i64>(6)? != 0,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, i64>(10)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let mut entries = Vec::with_capacity(rows.len());
        for (
            id,
            title,
            app_name,
            transcript,
            category,
            is_pinned,
            is_archived,
            summary,
            action_items,
            created_at,
            updated_at,
        ) in rows
        {
            entries.push(MeetingEntry {
                id,
                title,
                app_name,
                transcript,
                category,
                is_pinned,
                is_archived,
                summary,
                action_items,
                segments: Self::load_segments(&conn, id)?,
                created_at,
                updated_at,
            });
        }
        Ok(entries)
    }

    pub fn set_category(&self, id: i64, category: &str) -> Result<()> {
        let conn = self.open()?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE meetings SET category = ?1, updated_at = ?2 WHERE id = ?3",
            params![category.trim(), now, id],
        )?;
        Ok(())
    }

    pub fn set_pinned(&self, id: i64, pinned: bool) -> Result<()> {
        let conn = self.open()?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE meetings SET is_pinned = ?1, updated_at = ?2 WHERE id = ?3",
            params![if pinned { 1 } else { 0 }, now, id],
        )?;
        Ok(())
    }

    pub fn set_archived(&self, id: i64, archived: bool) -> Result<()> {
        let conn = self.open()?;
        let now = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "UPDATE meetings SET is_archived = ?1, updated_at = ?2 WHERE id = ?3",
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
            "UPDATE meetings
             SET summary = COALESCE(?1, summary),
                 action_items = COALESCE(?2, action_items),
                 updated_at = ?3
             WHERE id = ?4",
            params![summary, action_items, now, id],
        )?;
        Ok(())
    }
}
