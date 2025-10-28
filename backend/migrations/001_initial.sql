-- Indexes for faster lookups by podcast_id
CREATE INDEX idx_podcasts_items_podcast_id ON podcasts_items(podcast_id);
CREATE INDEX idx_favorites_podcasts_podcast_id ON favorites_episodes(track_id);
