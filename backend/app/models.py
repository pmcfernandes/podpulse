from typing import Optional
from sqlmodel import SQLModel, Field


class Podcast(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    artist: Optional[str] = None
    genre: Optional[str] = None
    rss_url: Optional[str] = None
    image_url: Optional[str] = None
    itunes_id: Optional[int] = None
    date: int
    suspended: Optional[int] = 0
    __tablename__ = "podcasts"


class PodcastItem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    podcast_id: int
    track_id:  Optional[int] = None
    guid: Optional[str] = None
    title: str
    desc: Optional[str] = None
    keywords: Optional[str] = None
    author: Optional[str] = None
    media_url: Optional[str] = None
    image_url: Optional[str] = None
    publish_date: Optional[str] = None
    filename: Optional[str] = None
    downloaded: Optional[int] = 0
    watched: Optional[int] = 0
    __tablename__  = "podcasts_items"

class FavoriteEpisode(SQLModel, table=True):
    """Store favorite episodes by external track id (e.g. iTunes trackId)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    track_id: int
    added_at: int
    note: Optional[str] = None
    __tablename__ = "favorites_episodes"
