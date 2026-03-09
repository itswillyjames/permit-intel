-- Migration 003: Entity graph + merge ledger
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  city TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(canonical_name);
CREATE INDEX IF NOT EXISTS idx_entities_status ON entities(status);

CREATE TABLE IF NOT EXISTS entity_aliases (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  alias_norm TEXT NOT NULL,
  source_evidence_id TEXT,
  address_norm TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(entity_id) REFERENCES entities(id)
);
CREATE INDEX IF NOT EXISTS idx_entity_alias_norm ON entity_aliases(alias_norm);
CREATE INDEX IF NOT EXISTS idx_entity_alias_entity ON entity_aliases(entity_id);

CREATE TABLE IF NOT EXISTS entity_identifiers (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  id_type TEXT NOT NULL,
  id_value TEXT NOT NULL,
  source_evidence_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(id_type, id_value),
  FOREIGN KEY(entity_id) REFERENCES entities(id)
);
CREATE INDEX IF NOT EXISTS idx_entity_ident_entity ON entity_identifiers(entity_id);

CREATE TABLE IF NOT EXISTS entity_links (
  id TEXT PRIMARY KEY,
  from_entity_id TEXT NOT NULL,
  to_entity_id TEXT NOT NULL,
  link_type TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence_ids_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_entity_links_from ON entity_links(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_links_to ON entity_links(to_entity_id);

CREATE TABLE IF NOT EXISTS merge_ledger (
  id TEXT PRIMARY KEY,
  winner_entity_id TEXT NOT NULL,
  merged_entity_id TEXT NOT NULL,
  rule TEXT NOT NULL,
  confidence REAL NOT NULL,
  operator_decision TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_merge_winner ON merge_ledger(winner_entity_id);
CREATE INDEX IF NOT EXISTS idx_merge_merged ON merge_ledger(merged_entity_id);

CREATE TABLE IF NOT EXISTS unmerge_ledger (
  id TEXT PRIMARY KEY,
  merge_ledger_id TEXT NOT NULL,
  operator_note TEXT,
  diff_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(merge_ledger_id) REFERENCES merge_ledger(id)
);

CREATE TABLE IF NOT EXISTS operator_locks (
  id TEXT PRIMARY KEY,
  lock_type TEXT NOT NULL,
  lock_id TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(lock_type, lock_id)
);

-- Match suggestions (for operator review queue)
CREATE TABLE IF NOT EXISTS entity_match_suggestions (
  id TEXT PRIMARY KEY,
  entity_a_id TEXT NOT NULL,
  entity_b_id TEXT NOT NULL,
  match_tier TEXT NOT NULL,
  rule TEXT NOT NULL,
  confidence REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  operator_decision TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entity_a_id, entity_b_id)
);
CREATE INDEX IF NOT EXISTS idx_match_suggestions_status ON entity_match_suggestions(status);
