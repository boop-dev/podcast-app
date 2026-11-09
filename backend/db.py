"""SQLite storage for the podcast app.

Everything is local. No accounts, no tracking, no analytics.

Tables:
  shows      - one row per subscribed podcast
  episodes   - one row per episode, linked to a show
  positions  - last playback position per episode (resume where you left off)
  queue      - the Up Next list, kept in order
  downloads  - episodes saved for offline listening. The audio bytes live
               in the PWA Cache Storage on the device; this table is just
               the record of which episodes were downloaded.
"""

import os
import sqlite3

SCHEMA = """
CREATE TABLE IF NOT EXISTS shows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feed_url TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    author TEXT,
    description TEXT,
    image_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
    guid TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT,
    audio_url TEXT NOT NULL,
    duration_seconds INTEGER,
    pub_date TEXT,
    image_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS positions (
    episode_id INTEGER PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
    position_seconds REAL NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL UNIQUE REFERENCES episodes(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS downloads (
    episode_id INTEGER PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
    downloaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def get_db_path():
    """Database file. Override with PODCAST_DB, useful for tests."""
    return os.environ.get("PODCAST_DB") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "podcasts.db"
    )


def connect():
    conn = sqlite3.connect(get_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    return conn
