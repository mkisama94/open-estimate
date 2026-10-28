CREATE TABLE IF NOT EXISTS public_estimate_results (
 public_result_id TEXT PRIMARY KEY,
 operation_id TEXT UNIQUE NOT NULL,
 fingerprint TEXT NOT NULL,
 result_hash TEXT NOT NULL,
 result_json TEXT,
 proof_json TEXT,
 withdrawal_token_hash TEXT NOT NULL,
 published_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('PUBLISHED','WITHDRAWN','EXPIRED')),
 withdrawn_at INTEGER
);
CREATE INDEX IF NOT EXISTS public_estimate_expiry ON public_estimate_results(state,expires_at);
