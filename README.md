# PodPulse — Podcast Downloader & Player

This repository contains a small podcast manager: a React + Vite frontend and a FastAPI backend that stores podcasts and episodes in SQLite. It includes a global audio player, saved podcasts, favorites, watched state, and server-side helpers for downloading media.

## Features

- Search iTunes (proxied via the backend) and save podcasts to the server
- Persist podcasts and episode metadata in SQLite
- Favorites and watched (listened) state persisted server-side
- Global audio player with play/pause/seek and "hide on stop"
- Single-episode download endpoint and a scheduler script to batch downloads

## Running the project (development)

Backend

1. Create a Python virtualenv and install dependencies:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

2. Start the FastAPI backend (dev):

```powershell
uvicorn app.main:app --reload --port 8000
```

Frontend

1. Install dependencies and start the Vite dev server:

```powershell
cd frontend
npm install
npm run dev
```

The frontend uses `src/lib/api.js` to pick the backend base URL in development.

## Important API endpoints

- `GET /api/podcasts` — list saved podcasts (includes `trackCount`)
- `POST /api/podcasts` — add a podcast (RSS/lookup + items saved)
- `GET /api/podcasts/{podcast_id}` — podcast details + episodes
- `GET /api/itunes/search?q=...` — proxied iTunes search
- `GET /api/itunes/lookup?id=...` — proxied iTunes lookup
- `GET /api/episodes/favorites` — list favorite entries; includes `items` (PodcastItem rows)
- `POST /api/episodes/{track_id}/favorite` — add a favorite
- `DELETE /api/episodes/{track_id}/favorite` — remove a favorite
- `POST /api/episodes/{track_id}/watched` — mark episode(s) with that external track id as watched
- `DELETE /api/episodes/{track_id}/watched` — unmark watched
- `POST /api/episodes/{item_id}/download` — download a single PodcastItem to `downloads/` (matches schedule.py behavior)

## Developer notes

- Database models live in `podPulseBackend/app/models.py`.
- Use functions in `podPulseBackend/app/repository.py` for DB access (CRUD, mark downloaded, set filename).
- See `podPulseBackend/schedule.py` for the canonical filename pattern and streaming logic used when storing downloaded media.

## UX & Implementation notes

- Global player: `AudioPlayerContext` + `useAudioPlayer()` provide play/stop/seek; `stop()` clears the `currentTrack` to hide the player.
- `PodcastSearch` saves podcasts via `POST /api/podcasts` and uses per-item saving indicators to avoid global loading UX issues.
- `Favorites` loads data from `/api/episodes/favorites` and normalizes `items` into episode rows, using optimistic UI on remove.

Contributions welcome — open issues or PRs with improvements.
