-- Migration 004: Exports + Outcomes
CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  report_version_id TEXT NOT NULL,
  export_type TEXT NOT NULL,
  template_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  html_storage_ref TEXT,
  pdf_storage_ref TEXT,
  checksum_html TEXT,
  checksum_pdf TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(report_version_id) REFERENCES report_versions(id)
);
CREATE INDEX IF NOT EXISTS idx_exports_rv_status ON exports(report_version_id, status);

CREATE TABLE IF NOT EXISTS export_events (
  id TEXT PRIMARY KEY,
  export_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(export_id) REFERENCES exports(id)
);
CREATE INDEX IF NOT EXISTS idx_export_events_export ON export_events(export_id, created_at);

CREATE TABLE IF NOT EXISTS report_outcomes (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  outcome_type TEXT NOT NULL,
  revenue_cents INTEGER,
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(report_id) REFERENCES reports(id)
);

CREATE TABLE IF NOT EXISTS comparables (
  id TEXT PRIMARY KEY,
  report_version_id TEXT NOT NULL,
  comparable_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(report_version_id) REFERENCES report_versions(id)
);

-- Saved searches
CREATE TABLE IF NOT EXISTS saved_searches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  query_json TEXT NOT NULL,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
