"""Flask backend for the podcast app.

Endpoints (all JSON unless noted):
  GET  /api/health                          - liveness check
  GET  /api/search?q=...                    - search Apple Podcasts (free, no key)
  POST /api/subscribe   {feedUrl}           - subscribe, fetch + parse the RSS feed
  GET  /api/shows                           - list subscriptions
  GET  /api/shows/<id>/episodes            - episode list for a show, newest first
  POST /api/shows/<id>/refresh             - re-fetch the feed, add new episodes
  DELETE /api/shows/<id>                   - unsubscribe (deletes show + episodes)
  GET  /api/episodes/<id>/position         - saved playback position
  POST /api/episodes/<id>/position {position} - save playback position
  GET  /api/queue                          - Up Next list, in order
  POST /api/queue {episodeId}              - add an episode to the queue
  DELETE /api/queue/<episodeId>            - remove from the queue
  POST /api/queue/reorder {episodeIds}     - set the queue order
  GET  /api/downloads                      - downloaded episode ids
  POST /api/downloads {episodeId}          - mark an episode downloaded
  DELETE /api/downloads/<episodeId>        - unmark an episode
  GET  /api/audio?url=...                  - range-aware audio proxy (lets the
                                             player seek; avoids CORS issues)
  GET  /api/opml                           - OPML export of subscriptions

When the frontend has been built (frontend/dist exists) this app also
serves it, so `python app.py` alone runs the whole app.
"""

import os
import time
from xml.etree.ElementTree import Element, SubElement, tostring

import feedparser
import requests
from flask import Flask, Response, g, jsonify, request, send_from_directory

import db as store

ITUNES_SEARCH_URL = "https://itunes.apple.com/search"

FRONTEND_DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "dist")

app = Flask(__name__, static_folder=FRONTEND_DIST, static_url_path="")


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def get_db():
    if "db" not in g:
        g.db = store.connect()
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def row_to_dict(row):
    return dict(row) if row is not None else None


def parse_duration(value):
    """itunes:duration comes as seconds, 'MM:SS', or 'HH:MM:SS'."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    try:
        parts = [int(p) for p in str(value).split(":")]
    except ValueError:
        return None
    seconds = 0
    for part in parts:
        seconds = seconds * 60 + part
    return seconds


def parse_pub_date(entry):
    """Return an ISO date string, or None if the feed has no usable date."""
    parsed = entry.get("published_parsed") or entry.get("updated_parsed")
    if not parsed:
        return None
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", parsed)


def find_audio_url(entry):
    """First audio enclosure wins. Falls back to the entry link if it is audio."""
    for enclosure in entry.get("enclosures", []):
        if enclosure.get("type", "").startswith("audio"):
            return enclosure.get("href")
    link = entry.get("link", "")
    if link.endswith((".mp3", ".m4a", ".ogg", ".wav")):
        return link
    return None


def parse_feed(feed_url):
    """Fetch an RSS feed and return (show_dict, [episode_dict, ...]).

    Raises ValueError on a bad feed and requests.RequestException on
    network problems, so the caller can turn them into a 400/502.
    """
    parsed = feedparser.parse(feed_url)
    if parsed.bozo and not parsed.entries:
        raise ValueError(f"Could not parse feed: {feed_url}")

    feed = parsed.feed
    image = None
    if getattr(feed, "image", None):
        image = feed.image.get("href")
    if not image:
        image = feed.get("itunes_image")

    show = {
        "feed_url": feed_url,
        "title": feed.get("title", feed_url),
        "author": feed.get("author"),
        "description": feed.get("description") or feed.get("subtitle"),
        "image_url": image,
    }

    episodes = []
    for entry in parsed.entries:
        audio_url = find_audio_url(entry)
        if not audio_url:
            continue  # skip entries with no playable audio
        episodes.append(
            {
                "guid": entry.get("id") or entry.get("link") or audio_url,
                "title": entry.get("title", "Untitled episode"),
                "description": entry.get("description") or entry.get("summary"),
                "audio_url": audio_url,
                "duration_seconds": parse_duration(entry.get("itunes_duration")),
                "pub_date": parse_pub_date(entry),
                "image_url": entry.get("itunes_image"),
            }
        )
    return show, episodes


def store_show_and_episodes(show, episodes):
    """Insert a show and its episodes (new episodes only). Returns the show row."""
    conn = get_db()
    cur = conn.execute(
        """INSERT INTO shows (feed_url, title, author, description, image_url)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(feed_url) DO UPDATE SET
             title=excluded.title, author=excluded.author,
             description=excluded.description, image_url=excluded.image_url
           RETURNING *""",
        (show["feed_url"], show["title"], show["author"], show["description"], show["image_url"]),
    )
    show_row = cur.fetchone()
    for ep in episodes:
        conn.execute(
            """INSERT INTO episodes
               (show_id, guid, title, description, audio_url, duration_seconds, pub_date, image_url)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(guid) DO NOTHING""",
            (
                show_row["id"],
                ep["guid"],
                ep["title"],
                ep["description"],
                ep["audio_url"],
                ep["duration_seconds"],
                ep["pub_date"],
                ep["image_url"],
            ),
        )
    conn.commit()
    return row_to_dict(show_row)


def episode_with_state(row):
    """An episode row plus its saved position, queue and download state."""
    ep = row_to_dict(row)
    conn = get_db()
    pos = conn.execute(
        "SELECT position_seconds, completed FROM positions WHERE episode_id = ?", (ep["id"],)
    ).fetchone()
    ep["position_seconds"] = pos["position_seconds"] if pos else 0
    ep["completed"] = bool(pos["completed"]) if pos else False
    ep["in_queue"] = (
        conn.execute("SELECT 1 FROM queue WHERE episode_id = ?", (ep["id"],)).fetchone() is not None
    )
    ep["downloaded"] = (
        conn.execute("SELECT 1 FROM downloads WHERE episode_id = ?", (ep["id"],)).fetchone()
        is not None
    )
    return ep


# ---------------------------------------------------------------------------
# health + search
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/api/search")
def search():
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"error": "missing ?q="}), 400
    try:
        resp = requests.get(
            ITUNES_SEARCH_URL,
            params={"media": "podcast", "term": query, "limit": 20},
            timeout=10,
        )
        resp.raise_for_status()
    except requests.RequestException as exc:
        return jsonify({"error": f"Apple Search API failed: {exc}"}), 502
    results = []
    for item in resp.json().get("results", []):
        feed_url = item.get("feedUrl")
        if not feed_url:
            continue
        results.append(
            {
                "collectionName": item.get("collectionName"),
                "artistName": item.get("artistName"),
                "artworkUrl": item.get("artworkUrl600") or item.get("artworkUrl100"),
                "feedUrl": feed_url,
                "trackCount": item.get("trackCount"),
            }
        )
    return jsonify({"results": results})


# ---------------------------------------------------------------------------
# subscriptions
# ---------------------------------------------------------------------------

@app.post("/api/subscribe")
def subscribe():
    data = request.get_json(silent=True) or {}
    feed_url = (data.get("feedUrl") or "").strip()
    if not feed_url:
        return jsonify({"error": "feedUrl is required"}), 400
    try:
        show, episodes = parse_feed(feed_url)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except requests.RequestException as exc:
        return jsonify({"error": f"could not fetch feed: {exc}"}), 502
    show_row = store_show_and_episodes(show, episodes)
    show_row["episode_count"] = len(episodes)
    return jsonify(show_row), 201


@app.get("/api/shows")
def list_shows():
    conn = get_db()
    rows = conn.execute(
        """SELECT s.*, COUNT(e.id) AS episode_count
           FROM shows s LEFT JOIN episodes e ON e.show_id = s.id
           GROUP BY s.id ORDER BY s.title"""
    ).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.get("/api/shows/<int:show_id>/episodes")
def list_episodes(show_id):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM episodes WHERE show_id = ? ORDER BY pub_date DESC, id DESC",
        (show_id,),
    ).fetchall()
    return jsonify([episode_with_state(r) for r in rows])


@app.post("/api/shows/<int:show_id>/refresh")
def refresh_show(show_id):
    conn = get_db()
    show = conn.execute("SELECT * FROM shows WHERE id = ?", (show_id,)).fetchone()
    if show is None:
        return jsonify({"error": "show not found"}), 404
    try:
        parsed_show, episodes = parse_feed(show["feed_url"])
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except requests.RequestException as exc:
        return jsonify({"error": f"could not fetch feed: {exc}"}), 502
    before = conn.execute("SELECT COUNT(*) AS n FROM episodes WHERE show_id = ?", (show_id,)).fetchone()["n"]
    store_show_and_episodes(parsed_show, episodes)
    after = conn.execute("SELECT COUNT(*) AS n FROM episodes WHERE show_id = ?", (show_id,)).fetchone()["n"]
    return jsonify({"show_id": show_id, "new_episodes": after - before})


@app.delete("/api/shows/<int:show_id>")
def delete_show(show_id):
    conn = get_db()
    cur = conn.execute("DELETE FROM shows WHERE id = ?", (show_id,))
    conn.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "show not found"}), 404
    return jsonify({"deleted": show_id})


# ---------------------------------------------------------------------------
# playback positions
# ---------------------------------------------------------------------------

@app.get("/api/episodes/<int:episode_id>/position")
def get_position(episode_id):
    conn = get_db()
    pos = conn.execute(
        "SELECT position_seconds, completed FROM positions WHERE episode_id = ?", (episode_id,)
    ).fetchone()
    if pos is None:
        return jsonify({"position_seconds": 0, "completed": False})
    return jsonify({"position_seconds": pos["position_seconds"], "completed": bool(pos["completed"])})


@app.post("/api/episodes/<int:episode_id>/position")
def save_position(episode_id):
    data = request.get_json(silent=True) or {}
    position = float(data.get("position", 0))
    duration = data.get("duration")
    completed = bool(data.get("completed", False))
    if duration and position >= duration - 10:
        completed = True
        position = 0  # finished: start from the top next time
    conn = get_db()
    conn.execute(
        """INSERT INTO positions (episode_id, position_seconds, completed, updated_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(episode_id) DO UPDATE SET
             position_seconds=excluded.position_seconds,
             completed=excluded.completed, updated_at=datetime('now')""",
        (episode_id, max(position, 0), int(completed)),
    )
    conn.commit()
    return jsonify({"position_seconds": position, "completed": completed})


# ---------------------------------------------------------------------------
# queue (Up Next)
# ---------------------------------------------------------------------------

@app.get("/api/queue")
def list_queue():
    conn = get_db()
    rows = conn.execute(
        """SELECT e.* FROM queue q JOIN episodes e ON e.id = q.episode_id
           ORDER BY q.id"""
    ).fetchall()
    return jsonify([episode_with_state(r) for r in rows])


@app.post("/api/queue")
def add_to_queue():
    data = request.get_json(silent=True) or {}
    episode_id = data.get("episodeId")
    if not episode_id:
        return jsonify({"error": "episodeId is required"}), 400
    conn = get_db()
    if conn.execute("SELECT 1 FROM episodes WHERE id = ?", (episode_id,)).fetchone() is None:
        return jsonify({"error": "episode not found"}), 404
    conn.execute("INSERT OR IGNORE INTO queue (episode_id) VALUES (?)", (episode_id,))
    conn.commit()
    return jsonify({"queued": episode_id}), 201


@app.delete("/api/queue/<int:episode_id>")
def remove_from_queue(episode_id):
    conn = get_db()
    conn.execute("DELETE FROM queue WHERE episode_id = ?", (episode_id,))
    conn.commit()
    return jsonify({"removed": episode_id})


@app.post("/api/queue/reorder")
def reorder_queue():
    data = request.get_json(silent=True) or {}
    episode_ids = data.get("episodeIds") or []
    conn = get_db()
    conn.execute("DELETE FROM queue")
    for episode_id in episode_ids:
        conn.execute("INSERT OR IGNORE INTO queue (episode_id) VALUES (?)", (episode_id,))
    conn.commit()
    return jsonify({"episodeIds": episode_ids})


# ---------------------------------------------------------------------------
# downloads (offline)
# ---------------------------------------------------------------------------

@app.get("/api/downloads")
def list_downloads():
    conn = get_db()
    rows = conn.execute("SELECT episode_id FROM downloads").fetchall()
    return jsonify([r["episode_id"] for r in rows])


@app.post("/api/downloads")
def mark_downloaded():
    data = request.get_json(silent=True) or {}
    episode_id = data.get("episodeId")
    if not episode_id:
        return jsonify({"error": "episodeId is required"}), 400
    conn = get_db()
    conn.execute("INSERT OR IGNORE INTO downloads (episode_id) VALUES (?)", (episode_id,))
    conn.commit()
    return jsonify({"downloaded": episode_id}), 201


@app.delete("/api/downloads/<int:episode_id>")
def unmark_downloaded(episode_id):
    conn = get_db()
    conn.execute("DELETE FROM downloads WHERE episode_id = ?", (episode_id,))
    conn.commit()
    return jsonify({"removed": episode_id})


# ---------------------------------------------------------------------------
# audio proxy (range-aware, so seeking works and CORS is not an issue)
# ---------------------------------------------------------------------------

@app.get("/api/audio")
def audio_proxy():
    url = request.args.get("url", "")
    if not url.startswith(("http://", "https://")):
        return jsonify({"error": "a valid http(s) url is required"}), 400

    headers = {"User-Agent": "podcast-app/1.0"}
    if request.headers.get("Range"):
        headers["Range"] = request.headers["Range"]
    try:
        upstream = requests.get(url, headers=headers, stream=True, timeout=(5, 120))
    except requests.RequestException as exc:
        return jsonify({"error": f"could not fetch audio: {exc}"}), 502

    response_headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": upstream.headers.get("Content-Type", "audio/mpeg"),
    }
    for name in ("Content-Length", "Content-Range"):
        if name in upstream.headers:
            response_headers[name] = upstream.headers[name]

    return Response(
        upstream.iter_content(chunk_size=64 * 1024),
        status=upstream.status_code,
        headers=response_headers,
        direct_passthrough=True,
    )


# ---------------------------------------------------------------------------
# OPML export
# ---------------------------------------------------------------------------

@app.get("/api/opml")
def export_opml():
    conn = get_db()
    shows = conn.execute("SELECT title, feed_url FROM shows ORDER BY title").fetchall()
    opml = Element("opml", {"version": "1.0"})
    head = SubElement(opml, "head")
    SubElement(head, "title").text = "Podcast App subscriptions"
    body = SubElement(opml, "body")
    for show in shows:
        SubElement(
            body,
            "outline",
            {
                "type": "rss",
                "text": show["title"],
                "title": show["title"],
                "xmlUrl": show["feed_url"],
            },
        )
    xml = b'<?xml version="1.0" encoding="UTF-8"?>\n' + tostring(opml, encoding="utf-8")
    return Response(
        xml,
        mimetype="text/x-opml",
        headers={"Content-Disposition": 'attachment; filename="podcast-subscriptions.opml"'},
    )


# ---------------------------------------------------------------------------
# serve the built frontend, if it exists
# ---------------------------------------------------------------------------

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if path.startswith("api/"):
        return jsonify({"error": "not found"}), 404
    if app.static_folder and os.path.exists(os.path.join(app.static_folder, path)) and path:
        return send_from_directory(app.static_folder, path)
    index = os.path.join(app.static_folder, "index.html") if app.static_folder else ""
    if os.path.exists(index):
        return send_from_directory(app.static_folder, "index.html")
    return jsonify({"status": "ok", "message": "API running. Build the frontend to serve the app."})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG", "0") == "1")
