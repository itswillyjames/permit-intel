#!/usr/bin/env node
/**
 * Local migration runner using better-sqlite3.
 * In production, use wrangler d1 migrations apply.
 */
import { createRequire } from 'module';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const __dir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dir, '../src/migrations');
const dbPath = process.env.DB_PATH ?? join(__dir, '../../../.dev/local.db');

// Ensure dev directory exists
import { mkdirSync } from 'fs';
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
)`);

const applied = new Set(
  db.prepare('SELECT name FROM _migrations').all().map((r) => r.name),
);

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

for (const file of files) {
  if (applied.has(file)) {
    console.log(`  skip ${file}`);
    continue;
  }
  const sql = readFileSync(join(migrationsDir, file), 'utf8');
  db.exec(sql);
  db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
  console.log(`  applied ${file}`);
}

console.log('Migrations complete.');
db.close();
