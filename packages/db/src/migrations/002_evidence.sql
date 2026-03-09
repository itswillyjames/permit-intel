-- Migration 002: Evidence + Claims
CREATE TABLE IF NOT EXISTS evidence_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  title TEXT,
  retrieved_at TEXT NOT NULL,
  hash TEXT NOT NULL,
  storage_ref TEXT,
  mime_type TEXT,
  bytes_len INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_hash ON evidence_items(hash);
CREATE INDEX IF NOT EXISTS idx_evidence_status ON evidence_items(status);

CREATE TABLE IF NOT EXISTS evidence_links (
  id TEXT PRIMARY KEY,
  evidence_id TEXT NOT NULL,
  link_type TEXT NOT NULL,
  link_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(evidence_id) REFERENCES evidence_items(id)
);
CREATE INDEX IF NOT EXISTS idx_evidence_links_type_id ON evidence_links(link_type, link_id);
CREATE INDEX IF NOT EXISTS idx_evidence_links_evidence ON evidence_links(evidence_id);

CREATE TABLE IF NOT EXISTS derived_claims (
  id TEXT PRIMARY KEY,
  report_version_id TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  claim_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(report_version_id) REFERENCES report_versions(id)
);
CREATE INDEX IF NOT EXISTS idx_derived_claims_rv ON derived_claims(report_version_id);
