-- Short-lived preview-only permission. No model, nonce, metadata text, plaintext code or bearer secret.
CREATE TABLE preview_transfers (
 transfer_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
 client_secret_hash TEXT NOT NULL, binding_hash TEXT NOT NULL, input_commitment TEXT NOT NULL,
 metadata_hash TEXT NOT NULL, policy_version TEXT NOT NULL, code_hmac TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 state TEXT NOT NULL CHECK(state IN('PENDING','APPROVED','READY','DENIED','LOCKED','EXPIRED')),
 owner_id TEXT, created_at INTEGER NOT NULL, approved_at INTEGER, expires_at INTEGER NOT NULL,
 submit_expires_at INTEGER, preview_id TEXT UNIQUE, draft_hash TEXT, preview_expires_at INTEGER,
 next_poll_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX preview_transfers_expiry ON preview_transfers(expires_at);
CREATE INDEX preview_transfers_owner ON preview_transfers(owner_id,approved_at);
CREATE TABLE preview_transfer_consents (
 transfer_id TEXT PRIMARY KEY REFERENCES preview_transfers(transfer_id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL, operation TEXT NOT NULL CHECK(operation='prepare_certificate_preview'),
 binding_hash TEXT NOT NULL, approved_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
