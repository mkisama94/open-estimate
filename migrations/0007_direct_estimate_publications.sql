-- Numeric results only. The authenticated owner and operation bind retries.
CREATE TABLE IF NOT EXISTS estimate_publications (
  owner_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(owner_id, operation_id)
);
CREATE INDEX IF NOT EXISTS estimate_publications_expiry ON estimate_publications(expires_at);
CREATE INDEX IF NOT EXISTS estimate_publications_rate ON estimate_publications(owner_id, created_at);
