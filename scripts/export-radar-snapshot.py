#!/usr/bin/env python3
"""Export the local studio SQLite data into Brandy OS import JSON."""

from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def iso(value: Any) -> str | None:
    if not value:
        return None
    text = str(value).strip().replace(" ", "T")
    if text.endswith("Z") or "+" in text[10:]:
        return text
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.isoformat().replace("+00:00", "Z")


def rows(connection: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    exists = connection.execute("select 1 from sqlite_master where type='table' and name=?", (table,)).fetchone()
    return [dict(row) for row in connection.execute(f"select * from {table}")] if exists else []


def parse_json(value: Any) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return value


def build_snapshot(connection: sqlite3.Connection) -> dict[str, Any]:
    source_rows = rows(connection, "source_content")
    source_by_ref = {str(row.get("ref")): str(row["source_id"]) for row in source_rows if row.get("ref")}
    sources = [{
        "id": str(row["source_id"]),
        "title": row.get("title") or row.get("ref") or str(row["source_id"]),
        "description": row.get("transcript") or "",
        "status": row.get("status") or "대기",
        "sourceUrl": row.get("url") or (f"https://youtu.be/{row['youtube_id']}" if row.get("youtube_id") else None),
        "publishedAt": iso(row.get("created_at")),
        "metadata": {"ref": row.get("ref"), "youtubeId": row.get("youtube_id"), "duration": row.get("duration")},
    } for row in source_rows]

    derivatives = [{
        "id": str(row["deriv_id"]),
        "sourceId": str(row["source_id"]),
        "title": row.get("title") or f"{row.get('platform') or '파생'} 콘텐츠",
        "body": row.get("body") or "",
        "platform": row.get("platform") or "threads",
        "format": row.get("platform") or "",
        "status": row.get("state") or "검토대기",
        "sourceUrl": row.get("asset_url"),
        "scheduledAt": iso(row.get("scheduled_at")),
        "metadata": {"aiScore": row.get("ai_score"), "review": parse_json(row.get("review")), "note": row.get("note"), "legacyVersion": row.get("version")},
    } for row in rows(connection, "derivative_content")]

    metrics = []
    for row in rows(connection, "kpi_snapshots"):
        source_id = source_by_ref.get(str(row.get("ref")))
        metrics.append({
            "id": f"kpi:{row.get('ref')}",
            **({"sourceId": source_id} if source_id else {}),
            "title": row.get("title") or row.get("ref") or "영상 성과",
            "platform": "YouTube",
            "views": float(row.get("views") or 0),
            "ctr": float(row.get("ctr_manual") or 0),
            "retention": float(row.get("avp") or 0),
            "conversions": 0,
            "measuredAt": iso(row.get("fetched_at")),
            "sourceUrl": f"https://youtu.be/{row['youtube_id']}" if row.get("youtube_id") else None,
            "metadata": {"averageViewDuration": row.get("avg_dur"), "likes": row.get("likes"), "comments": row.get("comments"), "traffic": parse_json(row.get("traffic"))},
        })
    return {"version": 1, "sources": sources, "derivatives": derivatives, "metrics": metrics}


def main() -> None:
    parser = argparse.ArgumentParser(description="Export radar.db for Brandy OS")
    parser.add_argument("database", type=Path, help="Path to radar.db")
    parser.add_argument("--output", type=Path, default=Path("brandy-content-snapshot.json"))
    args = parser.parse_args()
    if not args.database.is_file():
        parser.error(f"database not found: {args.database}")
    connection = sqlite3.connect(args.database)
    connection.row_factory = sqlite3.Row
    try:
        snapshot = build_snapshot(connection)
    finally:
        connection.close()
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"saved {len(snapshot['sources'])} sources, {len(snapshot['derivatives'])} derivatives, {len(snapshot['metrics'])} metrics -> {args.output}")


if __name__ == "__main__":
    main()
