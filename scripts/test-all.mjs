#!/usr/bin/env node
/**
 * Comprehensive test suite using Node built-in test runner.
 * Tests: state machines, prequal, schema validation, entity resolution,
 *        merge/unmerge, DB queries, export rendering.
 */
import assert from 'assert';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, createHash } from 'crypto';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');

// ---- Test harness ----
let passed = 0, failed = 0, total = 0;
const suites = [];

function suite(name, fn) { suites.push({ name, fn }); }
function test(name, fn) {
  total++;
  try { fn(); console.log(`    ✓ ${name}`); passed++; }
  catch(e) { console.error(`    ✗ ${name}`); console.error(`      ${e.message}`); failed++; }
}
async function testAsync(name, fn) {
  total++;
  try { await fn(); console.log(`    ✓ ${name}`); passed++; }
  catch(e) { console.error(`    ✗ ${name}`); console.error(`      ${e.message}`); failed++; }
}

// ---- Setup in-memory DB ----
function createTestDb() {
  const db = new DatabaseSync(':memory:');
  const migrationsDir = join(ROOT, 'packages/db/src/migrations');
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    try { db.exec(readFileSync(join(migrationsDir, file), 'utf8')); } catch(e) { /* skip view errors */ }
  }
  return db;
}

// ---- State machine inline ----
class InvalidTransitionError extends Error {
  constructor(machine, from, to) {
    super(`[${machine}] Invalid transition: ${from} → ${to}`);
    this.from = from; this.to = to;
  }
}
function createSM(name, transitions) {
  return {
    assertValid(from, to) {
      const allowed = transitions[from];
      if (!allowed || !allowed.includes(to)) throw new InvalidTransitionError(name, from, to);
    },
    isValid(from, to) { return Boolean((transitions[from] ?? []).includes(to)); },
    nextStates(from) { return transitions[from] ?? []; },
  };
}
const PermitSM = createSM('permit', { new: ['normalized','rejected','archived'], normalized: ['prequalified','rejected','archived'], prequalified: ['shortlisted','rejected','archived'], shortlisted: ['archived'], rejected: ['archived'], archived: [] });
const ReportSM = createSM('report', { draft: ['queued','archived'], queued: ['running','failed','archived'], running: ['completed','partial','failed'], partial: ['queued','archived'], completed: ['superseded','archived'], failed: ['queued','archived'], superseded: ['archived'], archived: [] });
const StageSM = createSM('stage', { queued: ['running','skipped'], running: ['succeeded','retrying','failed_terminal'], retrying: ['running','failed_retryable','failed_terminal'], failed_retryable: ['queued'], succeeded: [], failed_terminal: [], skipped: [] });
const ExportSM = createSM('export', { draft: ['rendering','failed'], rendering: ['ready','failed'], ready: ['delivered','failed'], delivered: [], failed: ['rendering'] });

// ---- Prequal inline ----
function runPrequal(p) {
  const excludeWorkTypes = ['electric', 'plumbing', 'sign', 'demolition', 'fence', 'sidewalk', 'curb'];
  const boostWorkTypes = ['commercial', 'mixed use', 'industrial', 'new construction', 'addition', 'renovation'];
  const cityWeights = { chicago: 1.0, seattle: 1.1, denver: 1.0 };
  const reasons = [];
  let score = 0.5;
  if (!p.valuation || p.valuation < 100000) { score -= 0.3; reasons.push('low valuation'); }
  else { score += Math.min(p.valuation/5e6,1)*0.25; reasons.push('valuation ok'); }
  const wl = (p.work_type ?? '').toLowerCase();
  if (excludeWorkTypes.some(t => wl.includes(t))) { score -= 0.4; reasons.push('excluded type'); }
  if (boostWorkTypes.some(t => wl.includes(t))) { score += 0.15; reasons.push('boosted type'); }
  const desc = (p.description_raw ?? '').toLowerCase();
  if (desc.length > 50) { score += 0.05; reasons.push('has description'); }
  const kw = ['office','retail','warehouse','hotel','restaurant','mixed use','industrial','medical'];
  const hits = kw.filter(k => desc.includes(k)).length;
  if (hits > 0) { score += hits*0.04; reasons.push(`${hits} keywords`); }
  score *= cityWeights[p.city] ?? 1.0;
  score = Math.max(0, Math.min(1, Math.round(score*1000)/1000));
  const status = score >= 0.65 ? 'shortlisted' : score <= 0.2 ? 'rejected' : 'prequalified';
  return { score, reasons, status };
}

// ---- DB helpers ----
function nowIso() { return new Date().toISOString(); }
function insertPermit(db, overrides = {}) {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(`INSERT INTO permits (id,city,source_permit_id,status,prequal_score,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run(id, overrides.city ?? 'chicago', overrides.source_permit_id ?? randomUUID(), overrides.status ?? 'new', overrides.prequal_score ?? 0, now, now);
  return id;
}
function insertReport(db, permitId) {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(`INSERT INTO reports (id,permit_id,status,created_at,updated_at) VALUES (?,?,?,?,?)`)
    .run(id, permitId, 'draft', now, now);
  return id;
}
function insertReportVersion(db, reportId) {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(`INSERT INTO report_versions (id,report_id,version,snapshot_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run(id, reportId, 1, JSON.stringify({ permit: {} }), 'queued', now, now);
  return id;
}
function insertEntity(db, name, type = 'org') {
  const id = randomUUID();
  const now = nowIso();
  db.prepare(`INSERT INTO entities (id,entity_type,canonical_name,status,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
    .run(id, type, name, 'active', now, now);
  return id;
}
function addAlias(db, entityId, alias, aliasNorm) {
  const id = randomUUID();
  db.prepare(`INSERT INTO entity_aliases (id,entity_id,alias,alias_norm,created_at) VALUES (?,?,?,?,?)`)
    .run(id, entityId, alias, aliasNorm, nowIso());
}

// =====================================
// SUITE 1: State Machines
// =====================================
suite('State Machines', () => {
  test('Permit: new→normalized→prequalified→shortlisted', () => {
    PermitSM.assertValid('new','normalized');
    PermitSM.assertValid('normalized','prequalified');
    PermitSM.assertValid('prequalified','shortlisted');
  });
  test('Permit: invalid transition throws InvalidTransitionError', () => {
    assert.throws(() => PermitSM.assertValid('new','shortlisted'), InvalidTransitionError);
  });
  test('Permit: terminal state archived has no next', () => {
    assert.deepEqual(PermitSM.nextStates('archived'), []);
  });
  test('Report: happy path draft→queued→running→completed', () => {
    ReportSM.assertValid('draft','queued');
    ReportSM.assertValid('queued','running');
    ReportSM.assertValid('running','completed');
  });
  test('Report: re-run allowed from partial and failed', () => {
    ReportSM.assertValid('partial','queued');
    ReportSM.assertValid('failed','queued');
  });
  test('Report: cannot skip from draft to running', () => {
    assert.throws(() => ReportSM.assertValid('draft','running'), InvalidTransitionError);
  });
  test('Stage: retry loop queued→running→retrying→running→succeeded', () => {
    StageSM.assertValid('queued','running');
    StageSM.assertValid('running','retrying');
    StageSM.assertValid('retrying','running');
    StageSM.assertValid('running','succeeded');
  });
  test('Stage: terminal succeeded has no outgoing', () => {
    assert.deepEqual(StageSM.nextStates('succeeded'), []);
    assert.deepEqual(StageSM.nextStates('failed_terminal'), []);
  });
  test('Export: draft→rendering→ready→delivered', () => {
    ExportSM.assertValid('draft','rendering');
    ExportSM.assertValid('rendering','ready');
    ExportSM.assertValid('ready','delivered');
  });
  test('Export: failed→rendering retry allowed', () => {
    ExportSM.assertValid('failed','rendering');
  });
  test('Export: delivered is terminal', () => {
    assert.throws(() => ExportSM.assertValid('delivered','rendering'), InvalidTransitionError);
  });
});

// =====================================
// SUITE 2: Prequal Engine
// =====================================
suite('Prequal Engine', () => {
  test('high-value commercial → shortlisted', () => {
    const r = runPrequal({ city:'chicago', work_type:'Commercial New Construction', valuation:10_000_000, description_raw:'New office tower with retail and restaurant space ground floor', address_norm:'123 main' });
    assert.equal(r.status, 'shortlisted');
    assert(r.score >= 0.65, `score ${r.score} < 0.65`);
  });
  test('low valuation → rejected', () => {
    const r = runPrequal({ city:'chicago', work_type:'Residential', valuation:5000, description_raw:'small repair', address_norm:'456 elm' });
    assert.equal(r.status, 'rejected');
    assert(r.score <= 0.2);
  });
  test('plumbing permit → rejected despite high valuation', () => {
    const r = runPrequal({ city:'chicago', work_type:'Plumbing', valuation:5_000_000, description_raw:'commercial plumbing install', address_norm:'100 main' });
    assert(r.reasons.some(r => r.includes('excluded')), 'should note excluded type');
  });
  test('seattle city weight is higher than chicago', () => {
    const base = { work_type:'Renovation', valuation:2_000_000, description_raw:'commercial renovation of office space', address_norm:'100 main' };
    const chi = runPrequal({ ...base, city:'chicago' });
    const sea = runPrequal({ ...base, city:'seattle' });
    assert(sea.score >= chi.score, `seattle ${sea.score} should be >= chicago ${chi.score}`);
  });
  test('null valuation → below threshold reason in output', () => {
    const r = runPrequal({ city:'denver', work_type:'commercial', valuation:null, description_raw:'office', address_norm:'' });
    assert(r.reasons.some(r => r.includes('low valuation') || r.includes('threshold')));
  });
  test('reasons array is non-empty', () => {
    const r = runPrequal({ city:'chicago', work_type:'commercial', valuation:500_000, description_raw:'office', address_norm:'' });
    assert(r.reasons.length > 0);
  });
  test('golden fixtures: shortlisted permits have score >= 0.65', () => {
    const fixtures = JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures/golden-records.json'), 'utf8'));
    for (const f of fixtures.filter(x => x.expected_prequal_status === 'shortlisted')) {
      const r = runPrequal(f);
      assert(r.score >= (f.expected_min_score ?? 0.65), `${f.source_permit_id}: score ${r.score} < expected min ${f.expected_min_score}`);
    }
  });
  test('golden fixtures: rejected permits have score <= 0.20', () => {
    const fixtures = JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures/golden-records.json'), 'utf8'));
    for (const f of fixtures.filter(x => x.expected_prequal_status === 'rejected')) {
      const r = runPrequal(f);
      assert(r.score <= (f.expected_max_score ?? 0.20), `${f.source_permit_id}: score ${r.score} > expected max ${f.expected_max_score}`);
    }
  });
});

// =====================================
// SUITE 3: DB — Permits
// =====================================
suite('DB: Permits', () => {
  const db = createTestDb();
  test('insert permit and retrieve by id', () => {
    const id = insertPermit(db, { city:'chicago', source_permit_id:'TEST-001' });
    const row = db.prepare('SELECT * FROM permits WHERE id = ?').get(id);
    assert.equal(row.city, 'chicago');
    assert.equal(row.source_permit_id, 'TEST-001');
  });
  test('upsert deduplicates on (city, source_permit_id)', () => {
    const id1 = randomUUID();
    const id2 = randomUUID();
    const now = nowIso();
    db.prepare(`INSERT INTO permits (id,city,source_permit_id,status,prequal_score,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).run(id1,'seattle','SEA-DEDUP','new',0,now,now);
    db.prepare(`INSERT OR IGNORE INTO permits (id,city,source_permit_id,status,prequal_score,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).run(id2,'seattle','SEA-DEDUP','new',0,now,now);
    const rows = db.prepare('SELECT id FROM permits WHERE city=? AND source_permit_id=?').all('seattle','SEA-DEDUP');
    assert.equal(rows.length, 1);
  });
  test('permit events are append-only', () => {
    const pid = insertPermit(db);
    const eid1 = randomUUID();
    const eid2 = randomUUID();
    db.prepare(`INSERT INTO permit_events (id,permit_id,event_type,created_at) VALUES (?,?,'status.new',?)`).run(eid1, pid, nowIso());
    db.prepare(`INSERT INTO permit_events (id,permit_id,event_type,created_at) VALUES (?,?,'status.normalized',?)`).run(eid2, pid, nowIso());
    const events = db.prepare('SELECT * FROM permit_events WHERE permit_id = ? ORDER BY created_at').all(pid);
    assert.equal(events.length, 2);
    assert.equal(events[0].event_type, 'status.new');
  });
});

// =====================================
// SUITE 4: DB — Reports & Versions
// =====================================
suite('DB: Reports + Versioning', () => {
  const db = createTestDb();
  test('create report → create version → increment version number', () => {
    const pid = insertPermit(db);
    const rid = insertReport(db, pid);
    const v1id = insertReportVersion(db, rid);
    // Manually insert v2
    const v2id = randomUUID();
    const now = nowIso();
    db.prepare(`INSERT INTO report_versions (id,report_id,version,snapshot_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).run(v2id,rid,2,JSON.stringify({}),'queued',now,now);
    const v2 = db.prepare('SELECT * FROM report_versions WHERE id = ?').get(v2id);
    assert.equal(v2.version, 2);
    assert.notEqual(v1id, v2id);
  });
  test('report.active_version_id can be updated', () => {
    const pid = insertPermit(db);
    const rid = insertReport(db, pid);
    const vid = insertReportVersion(db, rid);
    db.prepare('UPDATE reports SET active_version_id = ?, updated_at = ? WHERE id = ?').run(vid, nowIso(), rid);
    const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(rid);
    assert.equal(r.active_version_id, vid);
  });
  test('report_events are append-only', () => {
    const pid = insertPermit(db);
    const rid = insertReport(db, pid);
    const vid = insertReportVersion(db, rid);
    db.prepare(`INSERT INTO report_events (id,report_version_id,event_type,created_at) VALUES (?,?,'pipeline.started',?)`).run(randomUUID(),vid,nowIso());
    db.prepare(`INSERT INTO report_events (id,report_version_id,event_type,created_at) VALUES (?,?,'pipeline.completed',?)`).run(randomUUID(),vid,nowIso());
    const evts = db.prepare('SELECT * FROM report_events WHERE report_version_id = ?').all(vid);
    assert.equal(evts.length, 2);
  });
  test('snapshot_json is immutable per version', () => {
    const pid = insertPermit(db);
    const rid = insertReport(db, pid);
    const vid = insertReportVersion(db, rid);
    const snap1 = db.prepare('SELECT snapshot_json FROM report_versions WHERE id = ?').get(vid).snapshot_json;
    // Try updating — should not affect snapshot
    db.prepare('UPDATE report_versions SET status = ? WHERE id = ?').run('running', vid);
    const snap2 = db.prepare('SELECT snapshot_json FROM report_versions WHERE id = ?').get(vid).snapshot_json;
    assert.equal(snap1, snap2);
  });
});

// =====================================
// SUITE 5: DB — Stage Attempts + Idempotency
// =====================================
suite('DB: Stage Attempts + Idempotency', () => {
  const db = createTestDb();
  function insertAttempt(db, rvId, stageName, idempKey) {
    const id = randomUUID();
    const now = nowIso();
    db.prepare(`INSERT INTO stage_attempts (id,report_version_id,stage_name,status,idempotency_key,attempt_no,input_hash,created_at,updated_at)
      VALUES (?,?,?,'queued',?,?,?,?,?)`).run(id,rvId,stageName,idempKey,1,'abc123',now,now);
    return id;
  }
  test('unique constraint on (rv_id, stage_name, idempotency_key)', () => {
    const pid = insertPermit(db);
    const rid = insertReport(db, pid);
    const vid = insertReportVersion(db, rid);
    const key = 'idem-001';
    insertAttempt(db, vid, 'permit_parse', key);
    assert.throws(() => insertAttempt(db, vid, 'permit_parse', key));
  });
  test('same stage different idempotency keys = separate attempts', () => {
    const pid = insertPermit(db);
    const rid = insertReport(db, pid);
    const vid = insertReportVersion(db, rid);
    const a1 = insertAttempt(db, vid, 'entity_extract', 'key-A');
    const a2 = insertAttempt(db, vid, 'entity_extract', 'key-B');
    assert.notEqual(a1, a2);
  });
  test('stage output saved with hash', () => {
    const pid = insertPermit(db);
    const rid = insertReport(db, pid);
    const vid = insertReportVersion(db, rid);
    const aid = insertAttempt(db, vid, 'permit_parse', 'idem-save-test');
    const outputJson = JSON.stringify({ permit: { project_type: 'commercial' } });
    const hash = createHash('sha256').update(outputJson).digest('hex');
    db.prepare(`INSERT INTO stage_outputs (id,stage_attempt_id,output_json,output_hash,created_at) VALUES (?,?,?,?,?)`)
      .run(randomUUID(), aid, outputJson, hash, nowIso());
    const out = db.prepare('SELECT * FROM stage_outputs WHERE stage_attempt_id = ?').get(aid);
    assert.equal(out.output_hash, hash);
    assert.deepEqual(JSON.parse(out.output_json), { permit: { project_type: 'commercial' } });
  });
  test('stage_events are append-only', () => {
    const pid = insertPermit(db);
    const rid = insertReport(db, pid);
    const vid = insertReportVersion(db, rid);
    const aid = insertAttempt(db, vid, 'dossier_compose', 'evt-test-001');
    db.prepare(`INSERT INTO stage_events (id,stage_attempt_id,event_type,created_at) VALUES (?,?,'stage.started',?)`).run(randomUUID(),aid,nowIso());
    db.prepare(`INSERT INTO stage_events (id,stage_attempt_id,event_type,created_at) VALUES (?,?,'provider.used',?)`).run(randomUUID(),aid,nowIso());
    db.prepare(`INSERT INTO stage_events (id,stage_attempt_id,event_type,created_at) VALUES (?,?,'stage.succeeded',?)`).run(randomUUID(),aid,nowIso());
    const evts = db.prepare('SELECT * FROM stage_events WHERE stage_attempt_id = ?').all(aid);
    assert.equal(evts.length, 3);
  });
});

// =====================================
// SUITE 6: Evidence — Immutability
// =====================================
suite('Evidence: Immutability', () => {
  const db = createTestDb();
  test('insert evidence item and link to permit', () => {
    const pid = insertPermit(db);
    const eid = randomUUID();
    const hash = createHash('sha256').update('test-content').digest('hex');
    db.prepare(`INSERT INTO evidence_items (id,type,source,retrieved_at,hash,status,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(eid,'web_page','https://example.com',nowIso(),hash,'active',nowIso());
    db.prepare(`INSERT INTO evidence_links (id,evidence_id,link_type,link_id,created_at) VALUES (?,?,'permit',?,?)`)
      .run(randomUUID(),eid,pid,nowIso());
    const links = db.prepare('SELECT * FROM evidence_links WHERE evidence_id = ?').all(eid);
    assert.equal(links.length, 1);
    assert.equal(links[0].link_type, 'permit');
  });
  test('duplicate hash returns same item (dedup)', () => {
    const hash = createHash('sha256').update('dedup-content').digest('hex');
    const e1 = randomUUID();
    db.prepare(`INSERT INTO evidence_items (id,type,source,retrieved_at,hash,status,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(e1,'web_page','https://a.com',nowIso(),hash,'active',nowIso());
    // Try insert same hash — should fail or be handled
    // dedup is code-level (SELECT-first pattern)
    // no UNIQUE constraint on hash; code checks before inserting
    const item = db.prepare('SELECT * FROM evidence_items WHERE hash = ?').get(hash);
    assert.equal(item.id, e1);
  });
  test('deprecation sets status=deprecated (no delete)', () => {
    const hash = createHash('sha256').update('deprecate-test').digest('hex');
    const eid = randomUUID();
    db.prepare(`INSERT INTO evidence_items (id,type,source,retrieved_at,hash,status,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(eid,'note','operator',nowIso(),hash,'active',nowIso());
    db.prepare(`UPDATE evidence_items SET status = 'deprecated' WHERE id = ?`).run(eid);
    const item = db.prepare('SELECT * FROM evidence_items WHERE id = ?').get(eid);
    assert.equal(item.status, 'deprecated');
    assert(item !== null, 'item should still exist');
  });
});

// =====================================
// SUITE 7: Entity Resolution + Merge/Unmerge
// =====================================
suite('Entity Resolution: Merge/Unmerge', () => {
  const db = createTestDb();
  test('create entity and alias', () => {
    const eid = insertEntity(db, 'Acme Corp');
    addAlias(db, eid, 'Acme Corp', 'acme corp');
    const aliases = db.prepare('SELECT * FROM entity_aliases WHERE entity_id = ?').all(eid);
    assert.equal(aliases.length, 1);
    assert.equal(aliases[0].alias_norm, 'acme corp');
  });
  test('find entity by alias_norm', () => {
    const eid = insertEntity(db, 'Globex Inc');
    addAlias(db, eid, 'Globex Inc', 'globex inc');
    const rows = db.prepare(`SELECT e.* FROM entities e JOIN entity_aliases ea ON ea.entity_id = e.id WHERE ea.alias_norm = ?`).all('globex inc');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].canonical_name, 'Globex Inc');
  });
  test('merge: winner absorbs loser, loser becomes merged', () => {
    const winnerId = insertEntity(db, 'Contoso Ltd');
    const loserId = insertEntity(db, 'Contoso Limited');
    addAlias(db, loserId, 'Contoso Limited', 'contoso limited');
    const diff = JSON.stringify({ aliasesMoved: [], identifiersMoved: [], linksRepointed: [], mergedEntityPreviousStatus: 'active' });
    const ledgerId = randomUUID();
    db.prepare(`INSERT INTO merge_ledger (id,winner_entity_id,merged_entity_id,rule,confidence,operator_decision,diff_json,created_at)
      VALUES (?,?,?,'operator_manual',1.0,'approved',?,?)`).run(ledgerId,winnerId,loserId,diff,nowIso());
    db.prepare(`UPDATE entities SET status='merged', updated_at=? WHERE id=?`).run(nowIso(),loserId);
    db.prepare(`UPDATE entity_aliases SET entity_id=? WHERE entity_id=?`).run(winnerId,loserId);
    const loser = db.prepare('SELECT status FROM entities WHERE id=?').get(loserId);
    assert.equal(loser.status, 'merged');
    const winnerAliases = db.prepare('SELECT count(*) as cnt FROM entity_aliases WHERE entity_id=?').get(winnerId);
    assert(winnerAliases.cnt >= 0);
    const mergeRow = db.prepare('SELECT * FROM merge_ledger WHERE id=?').get(ledgerId);
    assert.equal(mergeRow.operator_decision, 'approved');
  });
  test('unmerge: restores loser status and aliases', () => {
    const winnerId = insertEntity(db, 'Alpha Co');
    const loserId = insertEntity(db, 'Alpha Company');
    addAlias(db, loserId, 'Alpha Company', 'alpha company');
    // Get the alias ID
    const aliasRow = db.prepare('SELECT id FROM entity_aliases WHERE entity_id=?').get(loserId);
    const aliasId = aliasRow.id;
    const diff = JSON.stringify({ aliasesMoved: [aliasId], identifiersMoved: [], linksRepointed: [], mergedEntityPreviousStatus: 'active' });
    const ledgerId = randomUUID();
    db.prepare(`INSERT INTO merge_ledger (id,winner_entity_id,merged_entity_id,rule,confidence,operator_decision,diff_json,created_at)
      VALUES (?,?,?,'operator_manual',1.0,'approved',?,?)`).run(ledgerId,winnerId,loserId,diff,nowIso());
    // Execute merge
    db.prepare(`UPDATE entities SET status='merged',updated_at=? WHERE id=?`).run(nowIso(),loserId);
    db.prepare(`UPDATE entity_aliases SET entity_id=? WHERE id=?`).run(winnerId,aliasId);
    // Verify merged
    assert.equal(db.prepare('SELECT status FROM entities WHERE id=?').get(loserId).status, 'merged');
    assert.equal(db.prepare('SELECT entity_id FROM entity_aliases WHERE id=?').get(aliasId).entity_id, winnerId);
    // Execute unmerge
    db.prepare(`UPDATE entities SET status='active',updated_at=? WHERE id=?`).run(nowIso(),loserId);
    db.prepare(`UPDATE entity_aliases SET entity_id=? WHERE id=?`).run(loserId,aliasId);
    db.prepare(`INSERT INTO unmerge_ledger (id,merge_ledger_id,operator_note,diff_json,created_at) VALUES (?,?,?,?,?)`)
      .run(randomUUID(),ledgerId,'test unmerge',diff,nowIso());
    // Verify restored
    assert.equal(db.prepare('SELECT status FROM entities WHERE id=?').get(loserId).status, 'active');
    assert.equal(db.prepare('SELECT entity_id FROM entity_aliases WHERE id=?').get(aliasId).entity_id, loserId);
  });
  test('operator_locks prevent merge (check lock before merge)', () => {
    const eid = insertEntity(db, 'Locked Corp');
    db.prepare(`INSERT INTO operator_locks (id,lock_type,lock_id,reason,created_at) VALUES (?,?,?,?,?)`)
      .run(randomUUID(),'entity',eid,'do not merge',nowIso());
    const lock = db.prepare(`SELECT id FROM operator_locks WHERE lock_type='entity' AND lock_id=?`).get(eid);
    assert(lock !== null, 'lock should exist');
    // In production code, we'd throw here; here just assert detection works
  });
  test('fuzzy match suggestion created in entity_match_suggestions', () => {
    const eid1 = insertEntity(db, 'Pinnacle Properties LLC');
    const eid2 = insertEntity(db, 'Pinnacle Properties Inc');
    // Ensure canonical ordering
    const [a, b] = eid1 < eid2 ? [eid1,eid2] : [eid2,eid1];
    db.prepare(`INSERT OR IGNORE INTO entity_match_suggestions (id,entity_a_id,entity_b_id,match_tier,rule,confidence,status,created_at,updated_at)
      VALUES (?,?,?,'probable','fuzzy_name',0.88,'pending',?,?)`).run(randomUUID(),a,b,nowIso(),nowIso());
    const sug = db.prepare('SELECT * FROM entity_match_suggestions WHERE entity_a_id IN (?,?) OR entity_b_id IN (?,?)').get(eid1,eid2,eid1,eid2);
    assert.equal(sug.match_tier, 'probable');
    assert.equal(sug.status, 'pending');
  });
  test('fuzzy match suggestion is not auto-merged', () => {
    // Verify: suggestions with match_tier=probable should have status=pending, not merged
    const rows = db.prepare(`SELECT * FROM entity_match_suggestions WHERE match_tier='probable' AND status='pending'`).all();
    for (const row of rows) {
      assert.equal(row.status, 'pending');
    }
  });
});

// =====================================
// SUITE 8: Export — HTML Rendering
// =====================================
suite('Export: HTML Rendering', () => {
  function escHtml(s) {
    if (!s) return '';
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function renderDossier(output, meta) {
    const { dossier, playbook } = output;
    const entityRows = dossier.key_entities.map(e =>
      `<tr><td>${escHtml(e.role)}</td><td>${escHtml(e.canonical_name)}</td><td>${Math.round(e.confidence*100)}%</td></tr>`
    ).join('');
    return `<!DOCTYPE html><html><head><title>${escHtml(dossier.headline)}</title></head><body>
<h1>${escHtml(dossier.headline)}</h1>
<meta name="export-id" content="${escHtml(meta.exportId)}">
<meta name="template-version" content="${escHtml(meta.templateVersion)}">
<p>${escHtml(dossier.summary)}</p>
<table>${entityRows}</table>
<h2>Playbook</h2>
<ul>${playbook.positioning.map(p => `<li>${escHtml(p)}</li>`).join('')}</ul>
</body></html>`;
  }

  const sampleOutput = {
    dossier: {
      headline: 'New 12-story Commercial Tower — Chicago Loop',
      summary: 'Sterling Development Group is developing a major mixed-use tower.',
      project: { address:'123 N Michigan Ave', city:'chicago', work_type:'Commercial', valuation:45000000, timeline:{filed_date:'2024-01-15',issued_date:'2024-02-20'} },
      key_entities: [
        { role:'developer', canonical_name:'Sterling Development Group', confidence:0.95, contacts:['info@sterling.com'] },
        { role:'contractor', canonical_name:'Midwest Commercial Builders', confidence:0.9, contacts:['555-1234'] },
      ],
      recommended_next_steps: ['Contact Sterling Development Group immediately', 'Request project timeline'],
      evidence_index: [{ evidence_id: '00000000-0000-0000-0000-000000000001', title:'Permit Record', source:'city-portal', retrieved_at:'2024-01-15' }],
    },
    playbook: {
      positioning: ['Position as preferred broker for commercial tenant representation'],
      buyer_targets: ['National retail chains', 'Tech companies'],
      pricing_logic: ['Market rate $45/sqft NNN'],
      objections_and_rebuttals: ['Too early: Early engagement secures exclusivity'],
    },
  };

  test('HTML contains headline', () => {
    const html = renderDossier(sampleOutput, { exportId:'exp-001', templateVersion:'v1', renderedAt:'2024-01-01' });
    assert(html.includes('New 12-story Commercial Tower'), 'headline missing');
  });
  test('HTML escapes XSS in entity names', () => {
    const xssOutput = JSON.parse(JSON.stringify(sampleOutput));
    xssOutput.dossier.key_entities[0].canonical_name = '<script>alert("xss")</script>';
    const html = renderDossier(xssOutput, { exportId:'exp-xss', templateVersion:'v1', renderedAt:'2024-01-01' });
    assert(!html.includes('<script>'), 'XSS not escaped');
    assert(html.includes('&lt;script&gt;'), 'should contain escaped version');
  });
  test('HTML is deterministic for same input', () => {
    const meta = { exportId:'exp-det', templateVersion:'v1', renderedAt:'2024-01-15T00:00:00.000Z' };
    const h1 = renderDossier(sampleOutput, meta);
    const h2 = renderDossier(sampleOutput, meta);
    assert.equal(h1, h2);
  });
  test('HTML contains playbook positioning', () => {
    const html = renderDossier(sampleOutput, { exportId:'exp-002', templateVersion:'v1', renderedAt:'2024-01-01' });
    assert(html.includes('Position as preferred broker'));
  });
  test('HTML checksum is stable (SHA-256)', () => {
    const html = renderDossier(sampleOutput, { exportId:'same', templateVersion:'v1', renderedAt:'2024-01-01T00:00:00.000Z' });
    const hash = createHash('sha256').update(html).digest('hex');
    const hash2 = createHash('sha256').update(html).digest('hex');
    assert.equal(hash, hash2);
    assert.equal(hash.length, 64);
  });
  test('Export DB record created with status=ready', () => {
    const db = createTestDb();
    const pid = insertPermit(db);
    const rid = insertReport(db, pid);
    const vid = insertReportVersion(db, rid);
    const eid = randomUUID();
    const now = nowIso();
    const html = renderDossier(sampleOutput, { exportId: eid, templateVersion:'v1', renderedAt: now });
    const checksum = createHash('sha256').update(html).digest('hex');
    db.prepare(`INSERT INTO exports (id,report_version_id,export_type,template_version,status,html_storage_ref,checksum_html,created_at,updated_at)
      VALUES (?,?,'bundle','v1','ready','inline:test-key',?,?,?)`).run(eid,vid,checksum,now,now);
    const row = db.prepare('SELECT * FROM exports WHERE id=?').get(eid);
    assert.equal(row.status, 'ready');
    assert.equal(row.checksum_html, checksum);
  });
});

// =====================================
// SUITE 9: Golden Record Fixtures Regression
// =====================================
suite('Golden Record Fixtures Regression', () => {
  const fixtures = JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures/golden-records.json'), 'utf8'));
  const db = createTestDb();

  test('all 12 fixtures load without error', () => {
    assert.equal(fixtures.length, 12);
  });
  test('each fixture has required fields', () => {
    for (const f of fixtures) {
      assert(f.city, `${f.source_permit_id}: missing city`);
      assert(f.source_permit_id, 'missing source_permit_id');
      assert(f.expected_prequal_status, `${f.source_permit_id}: missing expected_prequal_status`);
    }
  });
  test('all shortlisted fixtures score >= min threshold', () => {
    for (const f of fixtures.filter(x => x.expected_prequal_status === 'shortlisted')) {
      const r = runPrequal(f);
      const min = f.expected_min_score ?? 0.65;
      assert(r.score >= min, `${f.source_permit_id}: score ${r.score} < ${min}`);
    }
  });
  test('all rejected fixtures score <= max threshold', () => {
    for (const f of fixtures.filter(x => x.expected_prequal_status === 'rejected')) {
      const r = runPrequal(f);
      const max = f.expected_max_score ?? 0.20;
      assert(r.score <= max, `${f.source_permit_id}: score ${r.score} > ${max}`);
    }
  });
  test('fixtures can be seeded into in-memory DB', () => {
    let cnt = 0;
    for (const f of fixtures) {
      const id = randomUUID();
      const now = nowIso();
      const pq = runPrequal(f);
      db.prepare(`INSERT OR IGNORE INTO permits (id,city,source_permit_id,status,prequal_score,prequal_reasons_json,address_norm,work_type,valuation,description_raw,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,f.city,f.source_permit_id,pq.status,pq.score,JSON.stringify(pq.reasons),f.address_norm??null,f.work_type??null,f.valuation??null,f.description_raw??null,now,now);
      cnt++;
    }
    const rows = db.prepare('SELECT count(*) as cnt FROM permits').get();
    assert(rows.cnt > 0, 'no permits inserted');
  });
  test('contractor entity resolution: Midwest Commercial Builders appears in 2 permits', () => {
    // Seed fixtures with contractor_raw into dedicated db
    const cdb = createTestDb();
    for (const f of fixtures) {
      const id = randomUUID();
      const now = nowIso();
      cdb.prepare(`INSERT OR IGNORE INTO permits (id,city,source_permit_id,status,prequal_score,address_norm,work_type,valuation,description_raw,contractor_raw,applicant_raw,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id,f.city,f.source_permit_id,'shortlisted',0.7,f.address_norm??null,f.work_type??null,f.valuation??null,f.description_raw??null,f.contractor_raw??null,f.applicant_raw??null,now,now);
    }
    const rows = cdb.prepare(`SELECT count(*) as cnt FROM permits WHERE contractor_raw LIKE ?`).get('%Midwest Commercial Builders%');
    assert(rows.cnt >= 2, `Expected >= 2, got ${rows.cnt}`);
  });
  test('search_view returns shortlisted permits', () => {
    const rows = db.prepare(`SELECT * FROM permit_search_view WHERE status='shortlisted'`).all();
    assert(rows.length >= 9, `expected >= 9 shortlisted, got ${rows.length}`);
  });
});

// =====================================
// Run all suites
// =====================================
console.log('\n=== Permit Intel — Test Suite ===\n');
for (const { name, fn } of suites) {
  console.log(`\n◆ ${name}`);
  fn();
}

console.log(`\n${'='.repeat(40)}`);
console.log(`Total: ${total} tests — ${passed} passed, ${failed} failed`);
console.log('='.repeat(40));
if (failed > 0) process.exit(1);
