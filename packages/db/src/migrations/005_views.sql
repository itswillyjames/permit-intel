-- Migration 005: Read projection views
CREATE VIEW IF NOT EXISTS permit_search_view AS
SELECT
  p.id,
  p.city,
  p.source_permit_id,
  p.filed_date,
  p.issued_date,
  p.address_norm,
  p.work_type,
  p.valuation,
  p.status,
  p.prequal_score,
  p.prequal_reasons_json,
  p.applicant_raw,
  p.contractor_raw,
  p.owner_raw,
  r.id AS report_id,
  r.status AS report_status,
  r.active_version_id
FROM permits p
LEFT JOIN reports r ON r.permit_id = p.id;

CREATE VIEW IF NOT EXISTS entity_activity_view AS
SELECT
  e.id AS entity_id,
  e.canonical_name,
  e.entity_type,
  e.city,
  e.status,
  COUNT(DISTINCT el.link_id) AS permit_count,
  MAX(el.created_at) AS last_seen_at
FROM entities e
LEFT JOIN evidence_links el ON el.link_id = e.id AND el.link_type = 'entity'
GROUP BY e.id;

CREATE VIEW IF NOT EXISTS lead_pipeline_view AS
SELECT
  p.id,
  p.city,
  p.address_norm,
  p.work_type,
  p.valuation,
  p.prequal_score,
  p.filed_date,
  r.status AS report_status,
  rv.status AS version_status
FROM permits p
LEFT JOIN reports r ON r.permit_id = p.id
LEFT JOIN report_versions rv ON rv.id = r.active_version_id
WHERE p.status IN ('shortlisted', 'prequalified');

CREATE VIEW IF NOT EXISTS contact_directory_view AS
SELECT
  e.id AS entity_id,
  e.canonical_name,
  e.entity_type,
  ea.alias,
  ea.email,
  ea.phone,
  ea.website,
  ea.address_norm
FROM entities e
JOIN entity_aliases ea ON ea.entity_id = e.id
WHERE ea.email IS NOT NULL OR ea.phone IS NOT NULL;
