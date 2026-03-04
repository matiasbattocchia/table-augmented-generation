CREATE TABLE IF NOT EXISTS row_hashes (
  vector_id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
