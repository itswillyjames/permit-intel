-- Migration 001: Core tables
-- Permits
CREATE TABLE IF NOT EXISTS permits (
  id TEXT PRIMARY KEY,
  city TEXT NOT NULL,
  source_permit_id TEXT NOT NULL,
  filed_date TEXT,
  issued_date TEXT,
  address_raw TEXT,
  address_norm TEXT,
  work_type TEXT,
  description_raw TEXT,
  valuation INTEGER,
  applicant_raw TEXT,
  contractor_raw TEXT,
  owner_raw TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  prequal_score REAL DEFAULT 0,
  prequal_reasons_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(city, source_permit_id)
);
CREATE INDEX IF NOT EXISTS idx_permits_city_filed ON permits(city, filed_date);
CREATE INDEX IF NOT EXISTS idx_permits_status_score ON permits(status, prequal_score);
CREATE INDEX IF NOT EXISTS idx_permits_addr_norm ON permits(address_norm);

CREATE TABLE IF NOT EXISTS permit_sources (
  id TEXT PRIMARY KEY,
  permit_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT,
  raw_payload_json TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  hash TEXT NOT NULL,
  FOREIGN KEY(permit_id) REFERENCES permits(id)
);

CREATE TABLE IF NOT EXISTS permit_events (
  id TEXT PRIMARY KEY,
  permit_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(permit_id) REFERENCES permits(id)
);
CREATE INDEX IF NOT EXISTS idx_permit_events_permit ON permit_events(permit_id, created_at);

-- Reports
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  permit_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  active_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(permit_id) REFERENCES permits(id)
);
CREATE INDEX IF NOT EXISTS idx_reports_status_updated ON reports(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_reports_permit ON reports(permit_id);

CREATE TABLE IF NOT EXISTS report_versions (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(report_id, version),
  FOREIGN KEY(report_id) REFERENCES reports(id)
);
CREATE INDEX IF NOT EXISTS idx_report_versions_report ON report_versions(report_id, version);

CREATE TABLE IF NOT EXISTS report_events (
  id TEXT PRIMARY KEY,
  report_version_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(report_version_id) REFERENCES report_versions(id)
);
CREATE INDEX IF NOT EXISTS idx_report_events_rv ON report_events(report_version_id, created_at);

-- Stages
CREATE TABLE IF NOT EXISTS stage_attempts (
  id TEXT PRIMARY KEY,
  report_version_id TEXT NOT NULL,
  stage_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  idempotency_key TEXT NOT NULL,
  provider TEXT,
  model_id TEXT,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  input_hash TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error_class TEXT,
  error_message TEXT,
  metrics_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(report_version_id, stage_name, idempotency_key),
  FOREIGN KEY(report_version_id) REFERENCES report_versions(id)
);
CREATE INDEX IF NOT EXISTS idx_stage_attempts_rv_stage ON stage_attempts(report_version_id, stage_name);
CREATE INDEX IF NOT EXISTS idx_stage_attempts_status ON stage_attempts(status);

CREATE TABLE IF NOT EXISTS stage_outputs (
  id TEXT PRIMARY KEY,
  stage_attempt_id TEXT NOT NULL,
  output_json TEXT NOT NULL,
  output_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(stage_attempt_id) REFERENCES stage_attempts(id)
);

CREATE TABLE IF NOT EXISTS stage_events (
  id TEXT PRIMARY KEY,
  stage_attempt_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(stage_attempt_id) REFERENCES stage_attempts(id)
);
CREATE INDEX IF NOT EXISTS idx_stage_events_attempt ON stage_events(stage_attempt_id, created_at);
