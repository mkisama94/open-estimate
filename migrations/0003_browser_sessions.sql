-- No ID/access tokens, email addresses, raw session IDs or PKCE verifiers.
CREATE TABLE browser_login_transactions (
  state_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX browser_login_transactions_expiry ON browser_login_transactions(expires_at);
CREATE TABLE browser_sessions (
  session_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX browser_sessions_expiry ON browser_sessions(expires_at);
