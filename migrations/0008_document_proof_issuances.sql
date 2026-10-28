-- Independent anonymous issuance. No document/model/identity retention; no automatic purge.
CREATE TABLE IF NOT EXISTS document_proof_issuances (
 operation_id TEXT PRIMARY KEY,
 fingerprint TEXT NOT NULL,
 proof_id TEXT NOT NULL UNIQUE,
 proof_json TEXT NOT NULL,
 issued_at INTEGER NOT NULL,
 state TEXT NOT NULL CHECK (state IN ('ISSUED'))
);
CREATE INDEX IF NOT EXISTS document_proof_issued_at ON document_proof_issuances(issued_at);
CREATE TABLE IF NOT EXISTS document_proof_guards (
 operation_id TEXT PRIMARY KEY,
 allowed INTEGER NOT NULL CHECK (allowed=1)
);
