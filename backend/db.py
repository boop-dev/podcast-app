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

Storage backends
----------------
The database layer talks to SQLite through the libSQL client
(`libsql-client` on PyPI), which speaks the SQLite dialect, so the
SQL, schema, table names and `?` placeholders are unchanged from the
original stdlib sqlite3 version.

Where the data lives depends on the environment:

- ``TURSO_DATABASE_URL`` set: the client connects to that Turso
  (hosted libSQL) database, authenticated with
  ``TURSO_AUTH_TOKEN``. This is the deployed setup: Render's free
  tier wipes local files on every redeploy, restart and spin-down,
  so the data has to live outside the instance.
- ``TURSO_DATABASE_URL`` unset: the client opens a local SQLite
  file (``file:<path>``), so local development works exactly as
  before. ``PODCAST_DB`` still overrides the file location.

One code path either way: both backends are libsql clients, and the
thin Connection/Cursor wrappers below present the sqlite3-style
interface the rest of the app already uses (execute / fetchone /
fetchall / rowcount / commit / close), so app.py is untouched.

One behaviour difference to know about: libsql autocommits every
statement (each execute is its own transaction unless you open an
explicit transaction), so commit() below is a no-op. A multi-statement
write such as subscribe-then-insert-episodes is therefore not atomic
against Turso the way it was against a local SQLite file; in practice
the statements are simple inserts that already succeeded at parse
time, so the window is negligible for a single-user app.
"""

import os

import libsql_client

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


class Cursor:
    """sqlite3-cursor-shaped view of a libsql ResultSet.

    Rows are plain dicts, so the rest of the app can keep doing
    row["column"] and dict(row) exactly as before.
    """

    def __init__(self, result):
        self._rows = [row.asdict() for row in result.rows]
        self._index = 0
        self.rowcount = result.rows_affected

    def fetchone(self):
        if self._index >= len(self._rows):
            return None
        row = self._rows[self._index]
        self._index += 1
        return row

    def fetchall(self):
        rows = self._rows[self._index:]
        self._index = len(self._rows)
        return rows


class Connection:
    """sqlite3-connection-shaped wrapper around a libsql client."""

    def __init__(self, client):
        self._client = client

    def execute(self, sql, params=()):
        return Cursor(self._client.execute(sql, list(params)))

    def executescript(self, sql):
        statements = [stmt.strip() for stmt in sql.split(";") if stmt.strip()]
        self._client.batch(statements)

    def commit(self):
        # libsql autocommits each statement; nothing to do here.
        return None

    def close(self):
        self._client.close()


def connect():
    turso_url = os.environ.get("TURSO_DATABASE_URL", "").strip()
    if turso_url:
        token = os.environ.get("TURSO_AUTH_TOKEN", "").strip() or None
        client = libsql_client.create_client_sync(turso_url, auth_token=token)
        conn = Connection(client)
        # Foreign keys are enforced by sqld; journal_mode is meaningless
        # over HTTP. Ask anyway, but never let a remote PRAGMA failure
        # stop the app from starting.
        try:
            conn.execute("PRAGMA foreign_keys = ON")
        except Exception:
            pass
    else:
        path = os.path.abspath(get_db_path())
        client = libsql_client.create_client_sync("file:" + path)
        conn = Connection(client)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    return conn
