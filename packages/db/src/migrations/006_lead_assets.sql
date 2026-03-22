-- Migration 006: Lead asset exports
ALTER TABLE exports ADD COLUMN permit_id TEXT;
ALTER TABLE exports ADD COLUMN asset_type TEXT;
ALTER TABLE exports ADD COLUMN asset_format TEXT;
ALTER TABLE exports ADD COLUMN storage_ref TEXT;
ALTER TABLE exports ADD COLUMN content_type TEXT;
ALTER TABLE exports ADD COLUMN file_name TEXT;
ALTER TABLE exports ADD COLUMN metadata_json TEXT;

CREATE INDEX IF NOT EXISTS idx_exports_permit_assets ON exports(permit_id, export_type, created_at);
