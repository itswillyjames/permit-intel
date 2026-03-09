#!/usr/bin/env node
/**
 * Seed script using Node.js built-in SQLite (node:sqlite, Node 22+).
 * Run: node scripts/seed.js
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash, randomUUID } from 'crypto';

const __dir = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH ?? join(__dir, '../.dev/local.db');
mkdirSync(dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

// Run migrations
const migrationsDir = join(__dir, '../packages/db/src/migrations');
db.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
const appliedRows = db.prepare('SELECT name FROM _migrations').all();
const applied = new Set(appliedRows.map(r => r.name));
const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
for (const file of files) {
  if (applied.has(file)) { console.log(`  skip migration: ${file}`); continue; }
  // Skip CREATE VIEW — SQLite handles this fine but some view refs may not exist yet
  db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
  db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
  console.log(`  migrated: ${file}`);
}

// Load fixtures
const fixtures = JSON.parse(readFileSync(join(__dir, 'fixtures/golden-records.json'), 'utf8'));

// Prequal engine (inline)
function runPrequal(p) {
  const excludeWorkTypes = ['electric', 'plumbing', 'sign', 'demolition', 'fence', 'sidewalk', 'curb'];
  const boostWorkTypes = ['commercial', 'mixed use', 'industrial', 'new construction', 'addition', 'renovation'];
  const cityWeights = { chicago: 1.0, seattle: 1.1, denver: 1.0 };
  const reasons = [];
  let score = 0.5;
  if (!p.valuation || p.valuation < 100000) {
    reasons.push(`Valuation below $100k threshold`);
    score -= 0.3;
  } else {
    score += Math.min(p.valuation / 5_000_000, 1) * 0.25;
    reasons.push(`Valuation $${p.valuation.toLocaleString()}`);
  }
  const wl = (p.work_type ?? '').toLowerCase();
  if (excludeWorkTypes.some(t => wl.includes(t))) { score -= 0.4; reasons.push(`Excluded: ${p.work_type}`); }
  if (boostWorkTypes.some(t => wl.includes(t))) { score += 0.15; reasons.push(`High-value: ${p.work_type}`); }
  const desc = (p.description_raw ?? '').toLowerCase();
  if (desc.length > 50) { score += 0.05; reasons.push('Description present'); }
  const kw = ['office','retail','warehouse','hotel','restaurant','mixed use','industrial','medical'];
  const hits = kw.filter(k => desc.includes(k)).length;
  if (hits > 0) { score += hits * 0.04; reasons.push(`Keywords: ${hits}`); }
  score *= cityWeights[p.city] ?? 1.0;
  score = Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
  const status = score >= 0.65 ? 'shortlisted' : score <= 0.2 ? 'rejected' : 'prequalified';
  return { score, reasons, status };
}

let inserted = 0, skipped = 0;
for (const f of fixtures) {
  const pq = runPrequal(f);
  const id = randomUUID();
  const now = new Date().toISOString();

  // Check if already exists
  const existing = db.prepare('SELECT id FROM permits WHERE city = ? AND source_permit_id = ?').get(f.city, f.source_permit_id);
  if (existing) { skipped++; console.log(`  skip ${f.city}/${f.source_permit_id}`); continue; }

  db.prepare(`INSERT INTO permits (id, city, source_permit_id, filed_date, issued_date, address_raw, address_norm,
    work_type, description_raw, valuation, applicant_raw, contractor_raw, owner_raw,
    status, prequal_score, prequal_reasons_json, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, f.city, f.source_permit_id ?? null, f.filed_date ?? null, f.issued_date ?? null,
      f.address_raw ?? null, f.address_norm ?? null, f.work_type ?? null,
      f.description_raw ?? null, f.valuation ?? null, f.applicant_raw ?? null,
      f.contractor_raw ?? null, f.owner_raw ?? null,
      pq.status, pq.score, JSON.stringify(pq.reasons), now, now);

  const hash = createHash('sha256').update(JSON.stringify(f)).digest('hex');
  db.prepare(`INSERT INTO permit_sources (id, permit_id, source_name, source_url, raw_payload_json, retrieved_at, hash)
    VALUES (?,?,?,?,?,?,?)`)
    .run(randomUUID(), id, 'golden_fixture', null, JSON.stringify(f), now, hash);

  inserted++;
  console.log(`  ✓ ${f.city}/${f.source_permit_id} → ${pq.status} (${(pq.score*100).toFixed(0)}%)`);
}

console.log(`\nSeed complete: ${inserted} inserted, ${skipped} skipped.`);
db.close();
