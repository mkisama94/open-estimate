-- Preserve existing approvals while distinguishing numeric-only Web consent.
CREATE TABLE preview_transfer_consents_next (
 transfer_id TEXT PRIMARY KEY REFERENCES preview_transfers(transfer_id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN ('prepare_certificate_preview','prepare_estimate_preview')),
 binding_hash TEXT NOT NULL, approved_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
INSERT INTO preview_transfer_consents_next SELECT * FROM preview_transfer_consents;
DROP TABLE preview_transfer_consents;
ALTER TABLE preview_transfer_consents_next RENAME TO preview_transfer_consents;
