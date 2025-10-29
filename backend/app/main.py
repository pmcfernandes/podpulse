from typing import List, Optional
from time import time
from datetime import datetime
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from .db import init_db_and_engine
from .repository import Repository
from .models import Podcast as PodcastModel, PodcastItem as PodcastItemModel,  FavoriteEpisode as FavoriteEpisodeModel
from pydantic import BaseModel
from fastapi import Query
import httpx
import feedparser
import logging
import os
from pathlib import Path
import re

LOG = logging.getLogger("podpulse.fastapi")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# initialize sqlite DB and engine
engine = init_db_and_engine()
repo = Repository(engine)

# create the API FastAPI instance (we'll mount it under /api)
api = FastAPI(title="PodPulse Backend API", version="0.1.0")

# Allow all origins for local dev; tighten this in production
api.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# Root app will serve the frontend static files at `/` and mount the API under `/api`
app = FastAPI(title="PodPulse")
# serve static assets under /static and an index at /
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/api", api)


@app.get("/", include_in_schema=False)
def read_index():
    """Serve the SPA index.html at root."""
    return FileResponse("static/index.html")


class PodcastIn(BaseModel):
    itunes_id: int
    title: str
    artist: Optional[str] = None
    genre: Optional[str] = None
    rss_url: str
    image_url: Optional[str] = None


class FavoriteEpisodeIn(BaseModel):
    note: Optional[str] = None

@api.post("/podcasts", response_model=PodcastModel)
def create_podcast(payload: PodcastIn):
    """Check if a podcast with the given iTunes id exists; if not, insert it.

    Returns the Podcast record as JSON.
    """
    itunes_id = payload.itunes_id
    existing = repo.get_podcast_by_itunes_id(itunes_id)
    if existing:
        return existing

    p = PodcastModel(
        title=payload.title or "",
        artist=payload.artist,
        genre=payload.genre,
        rss_url=payload.rss_url,
        image_url=payload.image_url,
        itunes_id=payload.itunes_id,
        date=int(time()),
        suspended=0,
    )
    created = repo.create_podcast(p)

    # download and parse the RSS feed to populate initial episodes
    if not payload.rss_url.startswith("http"):
      if not os.path.exists(payload.rss_url):
          raise HTTPException(status_code=400, detail="RSS URL is not valid")

    feed = feedparser.parse(payload.rss_url)
    LOG.info("Fetched feed with %d entries", len(feed.entries))

    for entry in feed.entries:
        published_date = entry.published_parsed
        _time = datetime(published_date.tm_year, published_date.tm_mon, published_date.tm_mday).timestamp()

        item = PodcastItemModel(
            podcast_id=created.id,
            track_id=int(_time * 1000),
            guid=entry.get("id") or entry.get("guid") or "",
            title=entry.get("title", "No title"),
            desc=entry.get("description") or "",
            keywords=entry.get("itunes_keywords"),
            author=entry.get("author") or None,
            media_url=entry.enclosures[0].get("href") if entry.enclosures else None,
            image_url=entry.get("itunes_image", {}).get("href") or created.image_url,
            publish_date=_time,
            filename=None,
            downloaded=0,
            watched=0,
        )
        repo.add_podcast_item_if_not_exists(item)

    return created


@api.get("/podcasts")
def list_podcasts():
    """Return all podcast records from the database, including trackCount."""
    pods = repo.list_podcasts()
    out = []
    ids = [p.id for p in pods if p.id is not None]
    counts = repo.count_items_for_podcast_ids(ids)
    for p in pods:
        d = p.dict() if hasattr(p, 'dict') else p.__dict__
        d_out = {
            'id': d.get('id'),
            'title': d.get('title'),
            'artist': d.get('artist'),
            'genre': d.get('genre'),
            'rss_url': d.get('rss_url'),
            'image_url': d.get('image_url'),
            'itunes_id': d.get('itunes_id'),
            'date': d.get('date'),
            'suspended': d.get('suspended'),
            'trackCount': counts.get(p.id, 0),
        }
        out.append(d_out)
    return out


@api.get("/podcasts/{podcast_id}")
def get_podcast_detail(podcast_id: int):
    """Return a single podcast and its episodes (items).

    If the podcast is not found, return 404.
    """
    p = repo.get_podcast(podcast_id)
    if not p:
        raise HTTPException(status_code=404, detail="Podcast not found")

    # fetch items for the podcast
    items = repo.list_items_for_podcast(podcast_id)
    items_out = []
    for it in items:
        items_out.append(it.dict() if hasattr(it, 'dict') else it.__dict__)

    # convert Podcast model to primitive dict
    d = p.dict() if hasattr(p, 'dict') else p.__dict__
    dd = {
        'id': d.get('id'),
        'title': d.get('title'),
        'artist': d.get('artist'),
        'genre': d.get('genre'),
        'rss_url': d.get('rss_url'),
        'image_url': d.get('image_url'),
        'itunes_id': d.get('itunes_id'),
        'date': d.get('date'),
        'suspended': d.get('suspended'),
        'trackCount': len(items_out),
    }

    d_out = {
        'podcast': dd,
        'items': items_out,
    }

    return d_out


@api.patch("/podcasts/{podcast_id}/suspend", response_model=PodcastModel)
def suspend_podcast(podcast_id: int):
    """Mark a podcast as suspended (suspended=1). Returns the updated Podcast."""
    p = repo.suspend_podcast(podcast_id, suspended=1)
    if not p:
        raise HTTPException(status_code=404, detail="Podcast not found")
    return p


@api.patch("/podcasts/{podcast_id}/continue", response_model=PodcastModel)
def continue_podcast(podcast_id: int):
    """Clear the suspended flag for a podcast (suspended=0). Returns the updated Podcast."""
    p = repo.suspend_podcast(podcast_id, suspended=0)
    if not p:
        raise HTTPException(status_code=404, detail="Podcast not found")
    return p


@api.delete("/podcasts/{podcast_id}", status_code=204)
def delete_podcast(podcast_id: int):
    """Delete a podcast and all its items and favorites."""
    ok = repo.delete_podcast_and_related(podcast_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Podcast not found")
    return None


@api.get("/podcasts/{podcast_id}/episodes")
def list_podcast_items(podcast_id: int):
    """Return all items (episodes) for a given podcast id."""
    items = repo.list_items_for_podcast(podcast_id)
    return items


@api.get("/itunes/search")
async def itunes_search(q: str = Query(..., min_length=1), limit: int = Query(25, ge=1, le=200)):
    """Proxy endpoint to search iTunes for podcasts.

    Returns the JSON response from the iTunes Search API. This exists to avoid
    CORS issues in development and to centralize any required transformations.
    """
    params = {
        "term": q,
        "media": "podcast",
        "entity": "podcast",
        "limit": limit,
    }
    url = "https://itunes.apple.com/search"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
            raw = data.get("results", []) if isinstance(data, dict) else []
            simplified = []
            for r in raw:
                # Map to a compact shape the frontend expects
                simplified.append({
                    "collectionId": r.get("collectionId"),
                    "collectionName": r.get("collectionName"),
                    "artistName": r.get("artistName"),
                    "artworkUrl60": r.get("artworkUrl60") or r.get("artworkUrl600"),
                    "artworkUrl100": r.get("artworkUrl100") or r.get("artworkUrl600"),
                    "artworkUrl600": r.get("artworkUrl600"),
                    "feedUrl": r.get("feedUrl"),
                    "trackCount": r.get("trackCount"),
                    "primaryGenreName": r.get("primaryGenreName"),
                    "genres": r.get("genres") if isinstance(r.get("genres"), list) else [],
                })
            return {"resultCount": len(simplified), "results": simplified}
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=str(exc))
    except Exception as exc:  # pragma: no cover - network error
        raise HTTPException(status_code=502, detail=str(exc))



@api.get("/itunes/lookup")
async def itunes_lookup(id: str = Query(..., min_length=1), entity: Optional[str] = None, limit: Optional[int] = None):
    """Proxy to iTunes lookup endpoint. Accepts comma-separated ids.

    Example: /api/itunes/lookup?id=123,456
    """
    params = { 'id': id }
    if entity:
        params['entity'] = entity
    if limit:
        params['limit'] = limit

    url = "https://itunes.apple.com/lookup"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=str(exc))
    except Exception as exc:  # pragma: no cover - network error
        raise HTTPException(status_code=502, detail=str(exc))


@api.get("/episodes/favorites")
def list_favorite_episodes():
    """Return all favorite episodes (stored track ids and metadata)."""
    favs = repo.list_favorite_episodes()
    out = []
    for f in favs:
        f_dict = f.dict() if hasattr(f, 'dict') else f.__dict__
        # attach any PodcastItem rows that match this external track_id
        items = repo.list_items_by_track(f.track_id)
        items_out = [it.dict() if hasattr(it, 'dict') else it.__dict__ for it in items]
        f_dict['items'] = items_out
        out.append(f_dict)
    return out

@api.post("/episodes/{item_id}/favorite")
def favorite_episode(item_id: int, payload: FavoriteEpisodeIn | None = None):
    """Mark an episode (by PodcastItem id) as favorite.

    The FavoriteEpisode model stores external `track_id` values, so we look up
    the PodcastItem by its primary key, extract its `track_id` and create the
    FavoriteEpisode entry using that value.
    """
    note = payload.note if payload else None

    item = repo.get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Podcast item not found")
    if item.track_id is None:
        raise HTTPException(status_code=400, detail="Podcast item has no external track id")

    fav = FavoriteEpisodeModel(
        track_id=item.track_id,
        added_at=time(),
        note=note
    )
    created = repo.add_favorite_episode(fav)
    return created


@api.delete("/episodes/{item_id}/favorite", status_code=204)
def unfavorite_episode(item_id: int):
    """Remove favorite mark for the given PodcastItem id.

    We resolve the PodcastItem to its external track_id and remove the
    FavoriteEpisode that references that track id.
    """
    item = repo.get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Podcast item not found")
    if item.track_id is None:
        raise HTTPException(status_code=404, detail="Favorite episode not found")

    ok = repo.remove_favorite_episode(item.track_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Favorite episode not found")
    return None


@api.get("/episodes/watched")
def list_watched_episodes(podcastId: Optional[int] = Query(None, alias='podcastId')):
    """Return a list of watched episode track ids.

    Optional query param `podcastId` can be provided to filter watched ids for a specific podcast.
    """
    ids = repo.list_watched_track_ids(podcastId)
    return { 'watched': ids }


@api.get("/episodes")
def list_episodes(podcastId: Optional[int] = Query(None, alias='podcastId'), order: Optional[str] = Query('desc'), limit: Optional[int] = Query(100)):
    """Return all episodes ordered by publish_date.

    Query params:
    - podcastId: optional podcast id to filter episodes
    - order: 'asc' or 'desc' (default 'desc')
    """
    items = repo.list_items(podcastId, order=order, limit=limit)
    return [it.dict() if hasattr(it, 'dict') else it.__dict__ for it in items]


@api.post("/episodes/{item_id}/watched")
def mark_episode_watched(item_id: int):
    """Mark a single PodcastItem (by DB id) as watched.

    Returns JSON with the number of items updated (1). If the item isn't
    found, returns 404.
    """
    updated = repo.mark_item_watched_by_id(item_id)
    if updated == 0:
        raise HTTPException(status_code=404, detail="No episodes found for item_id")
    return {"updated": updated}


@api.delete("/episodes/{item_id}/watched", status_code=204)
def unmark_episode_watched(item_id: int):
    """Unmark watched flag for a single PodcastItem (by DB id)."""
    updated = repo.unmark_item_watched_by_id(item_id)
    if updated == 0:
        raise HTTPException(status_code=404, detail="No episodes found for item_id")
    return None


@api.get("/episodes/{item_id}/download")
async def download_episode_item(item_id: int):
    """Download the media for a single PodcastItem identified by its DB primary key id.
    The file is read from the repository `downloads/` directory (next to the package).
    """
    item = repo.get_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Podcast item not found")
    if not item.filename:
        raise HTTPException(status_code=400, detail="Item has no media_url")

    base = Path(__file__).resolve().parent
    downloads_dir = base.parent.joinpath('downloads')
    dest = downloads_dir.joinpath(item.filename)
    if not dest.exists():
        raise HTTPException(status_code=404, detail="Downloaded file not found")

    return FileResponse(dest, filename=dest.name, media_type='application/octet-stream')

