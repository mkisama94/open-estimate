-- Written only by the trusted browser approval flow, never by the public JSON API.
-- Store hashes of opaque receipt IDs, not bearer values, input models or metadata.
CREATE TABLE web_approval_grants (
  grant_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN('prepare_certificate_preview','issue_and_publish','withdraw_publication')),
  binding_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  trusted_channel TEXT NOT NULL CHECK(trusted_channel='WEB_USER_CONFIRMATION_V1')
);
CREATE INDEX web_approval_grants_expiry ON web_approval_grants(expires_at);
