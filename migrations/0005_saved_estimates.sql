CREATE TABLE saved_estimates (
 estimate_id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 result_json TEXT NOT NULL,
 result_hash TEXT NOT NULL,
 saved_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 UNIQUE(owner_id,result_hash)
);
CREATE INDEX saved_estimates_owner ON saved_estimates(owner_id,expires_at);
CREATE INDEX saved_estimates_expiry ON saved_estimates(expires_at);
