CREATE TABLE IF NOT EXISTS estimate_proof_issuances (
 operation_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, proof_id TEXT UNIQUE NOT NULL,
 proof_json TEXT NOT NULL, issued_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS estimate_proof_issued_at ON estimate_proof_issuances(issued_at);
CREATE TABLE IF NOT EXISTS estimate_proof_guards (operation_id TEXT PRIMARY KEY, allowed INTEGER NOT NULL CHECK(allowed=1));
