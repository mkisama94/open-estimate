-- New certificate database. No numeric model, nonce or source columns.
PRAGMA foreign_keys = ON;
CREATE TABLE issuance_policy (id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL CHECK(enabled IN(0,1)), status_generation TEXT NOT NULL);
CREATE TABLE signing_keys (key_id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN('ACTIVE','RETIRED','REVOKED')), definition_json TEXT NOT NULL);
CREATE TABLE certificate_previews (preview_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, draft_json TEXT, draft_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, consumed_receipt TEXT UNIQUE);
CREATE INDEX certificate_previews_owner ON certificate_previews(owner_id,created_at);
CREATE TABLE approval_receipts (one_time_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, operation TEXT NOT NULL, draft_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, trusted_channel TEXT NOT NULL, consumed_receipt TEXT NOT NULL UNIQUE);
CREATE TABLE certificates (certificate_id TEXT PRIMARY KEY, signed_object_hash TEXT NOT NULL, key_id TEXT NOT NULL REFERENCES signing_keys(key_id), issued_at TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('ACTIVE','REVOKED')), status_generation TEXT NOT NULL, reason_code TEXT);
CREATE TABLE publications (share_id TEXT PRIMARY KEY, certificate_id TEXT NOT NULL UNIQUE REFERENCES certificates(certificate_id), owner_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('PUBLIC','WITHDRAWN')), published_at TEXT NOT NULL);
CREATE TABLE publication_contents (share_id TEXT PRIMARY KEY REFERENCES publications(share_id), envelope_json TEXT NOT NULL);
CREATE TABLE issuance_receipts (receipt_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, fingerprint TEXT NOT NULL, certificate_id TEXT NOT NULL REFERENCES certificates(certificate_id), share_id TEXT NOT NULL REFERENCES publications(share_id), created_at INTEGER NOT NULL, UNIQUE(owner_id,idempotency_key));
CREATE INDEX issuance_receipts_owner ON issuance_receipts(owner_id,created_at);
CREATE TABLE audit_events (event_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, target_id TEXT NOT NULL, event_code TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE operation_guards (operation_id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
