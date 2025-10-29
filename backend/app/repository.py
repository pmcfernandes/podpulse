from typing import List, Optional
from sqlmodel import Session, select
from sqlalchemy import func
from .models import Podcast, PodcastItem, FavoriteEpisode
from time import time

class Repository:
    def __init__(self, engine):
        self.engine = engine

    # Podcasts
    def list_podcasts(self) -> List[Podcast]:
        with Session(self.engine) as s:
            return s.exec(select(Podcast)).all()

    def get_podcast(self, podcast_id: int) -> Optional[Podcast]:
        with Session(self.engine) as s:
            return s.get(Podcast, podcast_id)

    def get_podcast_by_itunes_id(self, itunes_id: int) -> Optional[Podcast]:
        """Return a Podcast matching the given iTunes collection id (itunes_id).

        Returns None if no match is found.
        """
        with Session(self.engine) as s:
            stmt = select(Podcast).where(Podcast.itunes_id == itunes_id)
            return s.exec(stmt).first()

    def create_podcast(self, p: Podcast) -> Podcast:
        with Session(self.engine) as s:
            s.add(p)
            s.commit()
            s.refresh(p)
            return p

    def suspend_podcast(self, podcast_id: int, suspended: int = 1) -> Optional[Podcast]:
        """Mark a podcast as suspended (1) or active (0). Returns the Podcast or None."""
        with Session(self.engine) as s:
            p = s.get(Podcast, podcast_id)
            if not p:
                return None
            p.suspended = 1 if suspended else 0
            s.add(p)
            s.commit()
            s.refresh(p)
            return p

    def delete_podcast_and_related(self, podcast_id: int) -> bool:
        """Delete a podcast and all its items and favorite episode links.

        FavoriteEpisode entries are matched by track_id: any FavoriteEpisode with a
        track_id that appears on a PodcastItem for this podcast will be removed.

        Returns True if any rows were deleted.
        """
        deleted_any = False
        with Session(self.engine) as s:
            # collect items for the podcast
            items = s.exec(select(PodcastItem).where(PodcastItem.podcast_id == podcast_id)).all()
            track_ids = [it.track_id for it in items if it.track_id is not None]

            # delete podcast items
            for it in items:
                s.delete(it)
                deleted_any = True

            # delete favorite episode rows that reference any of these track_ids
            if track_ids:
                favs = s.exec(select(FavoriteEpisode).where(FavoriteEpisode.track_id.in_(track_ids))).all()
                for f in favs:
                    s.delete(f)
                    deleted_any = True

            # finally delete the podcast row itself
            p = s.get(Podcast, podcast_id)
            if p:
                s.delete(p)
                deleted_any = True

            if deleted_any:
                s.commit()
            return deleted_any

    def remove_favorite_episodes_for_podcast(self, podcast_id: int) -> int:
        """Remove FavoriteEpisode rows that correspond to PodcastItem rows for the given podcast_id.

        Returns the number of FavoriteEpisode rows deleted.
        """
        with Session(self.engine) as s:
            items = s.exec(select(PodcastItem.track_id).where(PodcastItem.podcast_id == podcast_id)).all()
            # normalize to list of ints
            track_ids = [int(t[0] if isinstance(t, (list, tuple)) else t) for t in items if t]
            if not track_ids:
                return 0
            favs = s.exec(select(FavoriteEpisode).where(FavoriteEpisode.track_id.in_(track_ids))).all()
            count = 0
            for f in favs:
                s.delete(f)
                count += 1
            if count:
                s.commit()
            return count

    def list_items_for_podcast(self, podcast_id: int) -> List[PodcastItem]:
        """Return all PodcastItem rows for the given podcast_id."""
        with Session(self.engine) as s:
            stmt = select(PodcastItem).where(PodcastItem.podcast_id == podcast_id)
            return s.exec(stmt).all()

    def list_items(self, podcast_id: Optional[int] = None, order: str = 'desc', limit: Optional[int] = None) -> List[PodcastItem]:
        """Return PodcastItem rows optionally filtered by podcast_id and ordered by publish_date.

        order may be 'asc' or 'desc' (case-insensitive). Default is 'desc' (latest first).
        limit, when provided, restricts the number of returned rows (e.g. top N).
        """
        with Session(self.engine) as s:
            stmt = select(PodcastItem)
            if podcast_id is not None:
                stmt = stmt.where(PodcastItem.podcast_id == podcast_id)
            if str(order).lower() == 'asc':
                stmt = stmt.order_by(PodcastItem.publish_date.asc())
            else:
                stmt = stmt.order_by(PodcastItem.publish_date.desc())
            if limit is not None:
                try:
                    stmt = stmt.limit(int(limit))
                except Exception:
                    # ignore invalid limit and return full set
                    pass
            return s.exec(stmt).all()

    def count_items_for_podcast(self, podcast_id: int) -> int:
        """Return the number of items for a given podcast_id."""
        with Session(self.engine) as s:
            stmt = select(func.count()).select_from(PodcastItem).where(PodcastItem.podcast_id == podcast_id)
            result = s.exec(stmt).one()
            # result may be a tuple; try to coerce to int
            try:
                return int(result)
            except Exception:
                try:
                    return int(result[0])
                except Exception:
                    return 0

    def count_items_for_podcast_ids(self, ids: List[int]) -> dict:
        """Return a mapping podcast_id -> count for the given list of podcast ids using a single GROUP BY query."""
        if not ids:
            return {}
        with Session(self.engine) as s:
            stmt = select(PodcastItem.podcast_id, func.count()).where(PodcastItem.podcast_id.in_(ids)).group_by(PodcastItem.podcast_id)
            rows = s.exec(stmt).all()
            result = {}
            for row in rows:
                # row is typically a tuple (podcast_id, count)
                try:
                    pid = int(row[0])
                    cnt = int(row[1])
                except Exception:
                    continue
                result[pid] = cnt
            return result

    def add_podcast_item_if_not_exists(self, item: PodcastItem) -> PodcastItem:
        """Add the given PodcastItem if no existing item with the same podcast_id and track_id exists.

        Returns the existing or newly created PodcastItem.
        """
        with Session(self.engine) as s:
            stmt = select(PodcastItem).where(
                (PodcastItem.podcast_id == item.podcast_id) &
                (PodcastItem.track_id == item.track_id)
            )
            existing = s.exec(stmt).first()
            if existing:
                return existing
            s.add(item)
            s.commit()
            s.refresh(item)
            return item

    # Single-item helpers (by primary key id)
    def get_item(self, item_id: int) -> Optional[PodcastItem]:
        """Return a PodcastItem by its primary key id."""
        with Session(self.engine) as s:
            return s.get(PodcastItem, item_id)

    # Favorite episodes
    def list_favorite_episodes(self) -> List[FavoriteEpisode]:
        with Session(self.engine) as s:
            return s.exec(select(FavoriteEpisode)).all()

    def list_items_by_track(self, track_id: int) -> List[PodcastItem]:
        """Return all PodcastItem rows that have the given external track_id."""
        with Session(self.engine) as s:
            stmt = select(PodcastItem).where(PodcastItem.track_id == track_id)
            return s.exec(stmt).all()

    def add_favorite_episode(self, fav: FavoriteEpisode) -> FavoriteEpisode:
        with Session(self.engine) as s:
            s.add(fav)
            s.commit()
            s.refresh(fav)
            return fav

    def remove_favorite_episode(self, track_id: int) -> bool:
        with Session(self.engine) as s:
            stmt = select(FavoriteEpisode).where(FavoriteEpisode.track_id == track_id)
            f = s.exec(stmt).first()
            if f:
                s.delete(f)
                s.commit()
                return True
            return False

    # Single-item watched helpers (by DB primary key id)
    def mark_item_watched_by_id(self, item_id: int) -> int:
        """Set watched=1 for the PodcastItem with the given primary key id.

        Returns 1 if updated, 0 if not found.
        """
        with Session(self.engine) as s:
            it = s.get(PodcastItem, item_id)
            if not it:
                return 0
            it.watched = 1
            s.add(it)
            s.commit()
            return 1

    def unmark_item_watched_by_id(self, item_id: int) -> int:
        """Set watched=0 for the PodcastItem with the given primary key id.

        Returns 1 if updated, 0 if not found.
        """
        with Session(self.engine) as s:
            it = s.get(PodcastItem, item_id)
            if not it:
                return 0
            it.watched = 0
            s.add(it)
            s.commit()
            return 1

    def list_watched_track_ids(self, podcast_id: Optional[int] = None) -> List[int]:
        """Return a list of distinct track_id values for PodcastItem rows where watched=1.

        If podcast_id is provided, filter to that podcast only.
        """
        with Session(self.engine) as s:
            stmt = select(PodcastItem.track_id).where(PodcastItem.watched == 1)
            if podcast_id is not None:
                stmt = stmt.where(PodcastItem.podcast_id == podcast_id)
            stmt = stmt.group_by(PodcastItem.track_id)
            rows = s.exec(stmt).all()
            # rows may be list of single-element tuples or raw ints depending on SQLModel/SQLAlchemy
            ids = []
            for r in rows:
                try:
                    ids.append(int(r[0] if isinstance(r, (list, tuple)) else r))
                except Exception:
                    continue
            return ids



