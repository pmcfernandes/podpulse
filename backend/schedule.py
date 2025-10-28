"""Simple scheduler script to download undownloaded podcast episode media files.

Usage:
    python schedule.py [--limit N] [--dry-run]

This script locates PodcastItem rows where `downloaded` is falsy and `media_url` is set,
downloads the media to a `downloads/` folder next to the database, sets `filename` and
`downloaded=1`, and commits the changes. It does basic filename sanitization and
streams the download to avoid using too much memory.
"""
from __future__ import annotations
from pathlib import Path
from typing import Optional
from app.db import init_engine, get_db_path
from app.repository import Repository
from app.models import Podcast as PodcastModel,  PodcastItem as PodcastItemModel
from sqlmodel import Session, select, desc
from datetime import datetime
import argparse
import logging
import re
import sys
import httpx
import feedparser
import time

LOG = logging.getLogger("podpulse.schedule")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def safe_filename(name: str) -> str:
    """Create a filesystem-safe filename from a string.

    Keeps alphanumerics, dot, dash and underscore. Collapses whitespace.
    """
    name = re.sub(r"\s+", "-", name.strip())
    name = re.sub(r"[^A-Za-z0-9.\-_]", "", name)
    return name[:240]


def download_one(client: httpx.Client, url: str, dest: Path, chunk_size: int = 32_768) -> None:
  with httpx.Client(follow_redirects=True) as client:
      with client.stream("GET", url, timeout=60.0) as resp:
          resp.raise_for_status()
          with dest.open("wb") as fh:
              for chunk in resp.iter_bytes(chunk_size=chunk_size):
                  if chunk:
                      fh.write(chunk)


def update_rss_items(engine,  repo: Repository):
    with Session(engine) as s:
      stmt = select(PodcastModel).where((PodcastModel.rss_url.is_not(None)) & (PodcastModel.suspended == 0))
      podcasts = s.exec(stmt).all()
      for p in podcasts:
        rss_url = p.rss_url

        # download and parse the RSS feed to populate initial episodes
        if not rss_url.startswith("http"):
          if not os.path.exists(rss_url):
            raise Exception("RSS URL is not valid")

        feed = feedparser.parse(rss_url)
        LOG.info("Fetched feed with %d entries", len(feed.entries))

        for entry in feed.entries:
          published_date = entry.published_parsed
          _time = datetime(published_date.tm_year, published_date.tm_mon, published_date.tm_mday).timestamp()
          track_id = int(_time * 1000)

          stmt = select(PodcastItemModel).where((PodcastItemModel.podcast_id == p.id) & (PodcastItemModel.track_id == track_id))
          existing = s.exec(stmt).first()

          if existing:
            continue

          item = PodcastItemModel(
            podcast_id=p.id,
            track_id=int(_time * 1000),
            guid=entry.get("id") or entry.get("guid") or "",
            title=entry.get("title", "No title"),
            desc=entry.get("description") or "",
            keywords=entry.get("itunes_keywords"),
            author=entry.get("author") or entry.get("itunes_author") or None,
            media_url=entry.enclosures[0].get("href") if entry.enclosures else None,
            image_url=entry.get("itunes_image", {}).get("href") or p.image_url,
            publish_date=_time,
            filename=None,
            downloaded=0,
            watched=0,
        )
        repo.add_podcast_item_if_not_exists(item)


def run(limit: Optional[int] = None, dry_run: bool = False) -> int:
    base = Path(__file__).resolve().parent
    engine = init_engine(base / "podpulse.db")
    repo = Repository(engine)
    update_rss_items(engine, repo)

    downloads_dir = base / "downloads"
    downloads_dir.mkdir(parents=True, exist_ok=True)

    updated = 0
    with Session(engine) as s:
        stmt = select(PodcastItemModel).where((PodcastItemModel.downloaded == 0) | (PodcastItemModel.downloaded.is_(None))).order_by(desc(PodcastItemModel.id))
        items = s.exec(stmt).all()
        LOG.info("Found %d undownloaded items", len(items))
        for it in items:
            if limit is not None and updated >= limit:
                break
            if not it.media_url:
                LOG.info("Skipping item id=%s track_id=%s: no media_url", it.id, it.track_id)
                continue

            # Derive a filename: <podcastid>-<trackid>-<safe_title>.<ext>
            ext = Path(it.media_url.split("?")[0]).suffix or ".mp3"
            title_part = safe_filename(it.title or f"track-{it.track_id}")
            fname = f"pod{it.podcast_id}-trk{it.track_id}-{title_part}{ext}"
            dest = downloads_dir / fname

            LOG.info("Downloading item id=%s track_id=%s to %s", it.id, it.track_id, dest)
            if dry_run:
                LOG.info("Dry-run: would download %s", it.media_url)
                it.filename = str(dest.name)
                it.downloaded = 0
                continue

            try:
                with httpx.Client() as client:
                    download_one(client, it.media_url, dest)
                # update DB row
                it.filename = str(dest.name)
                it.downloaded = 1
                s.add(it)
                s.commit()
                updated += 1
                LOG.info("Downloaded and updated item id=%s", it.id)
            except Exception as exc:  # pragma: no cover - network errors / filesystem
                LOG.exception("Failed to download %s: %s", it.media_url, exc)
                # don't mark as downloaded; continue with next item

    LOG.info("Run complete. %d items downloaded/updated.", updated)
    return updated


def main(argv=None):
    ap = argparse.ArgumentParser(description="Download undownloaded podcast episodes")
    ap.add_argument("--limit", type=int, help="Maximum number of episodes to download in this run")
    ap.add_argument("--dry-run", action="store_true", help="Do not actually download files; just log actions and set filenames locally")
    args = ap.parse_args(argv)
    try:
        run(limit=args.limit, dry_run=args.dry_run)
    except Exception:
        LOG.exception("Schedule run failed")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
