import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Schema migrations. Append new migrations; never edit a shipped one.
 * Tables follow the product's core entities.
 */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    email TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE meetings (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    owner_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    platform TEXT NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'live',
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    time_zone TEXT,
    series_key TEXT,
    is_sample INTEGER NOT NULL DEFAULT 0,
    organizer_email TEXT,
    shared_with_attendees INTEGER NOT NULL DEFAULT 0,
    processing_stage TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX meetings_owner ON meetings(tenant_id, owner_id, started_at DESC);
  CREATE INDEX meetings_series ON meetings(tenant_id, series_key, started_at);
  CREATE TABLE participants (
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'required',
    PRIMARY KEY (meeting_id, position)
  );
  CREATE TABLE speakers (
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    speaker_id TEXT NOT NULL,
    label TEXT NOT NULL,
    name TEXT,
    PRIMARY KEY (meeting_id, speaker_id)
  );
  CREATE TABLE transcript_segments (
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    speaker_id TEXT NOT NULL,
    text TEXT NOT NULL,
    channel TEXT,
    PRIMARY KEY (meeting_id, id)
  );
  CREATE INDEX segments_time ON transcript_segments(meeting_id, start_ms);
  CREATE TABLE screen_notes (
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    at_ms INTEGER NOT NULL,
    text TEXT NOT NULL,
    window_title TEXT
  );
  CREATE TABLE notes (
    meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
    tldr TEXT NOT NULL,
    warnings_json TEXT NOT NULL,
    engine_json TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    transcript_hash TEXT NOT NULL
  );
  CREATE TABLE topics (
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    id TEXT NOT NULL, position INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, evidence_json TEXT NOT NULL,
    PRIMARY KEY (meeting_id, id)
  );
  CREATE TABLE decisions (
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    id TEXT NOT NULL, position INTEGER NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, evidence_json TEXT NOT NULL,
    PRIMARY KEY (meeting_id, id)
  );
  CREATE TABLE action_items (
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    position INTEGER NOT NULL,
    task TEXT NOT NULL,
    owner TEXT,
    deadline_json TEXT,
    due_date TEXT,
    priority TEXT NOT NULL,
    confidence TEXT NOT NULL,
    needs_review INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    evidence_json TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'ai',
    edited INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (meeting_id, id)
  );
  CREATE INDEX action_items_owner ON action_items(owner, status);
  CREATE INDEX action_items_due ON action_items(due_date);
  CREATE TABLE open_questions (
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    id TEXT NOT NULL, position INTEGER NOT NULL, question TEXT NOT NULL, evidence_json TEXT NOT NULL,
    PRIMARY KEY (meeting_id, id)
  );
  CREATE TABLE risks (
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    id TEXT NOT NULL, position INTEGER NOT NULL, text TEXT NOT NULL, evidence_json TEXT NOT NULL,
    PRIMARY KEY (meeting_id, id)
  );
  CREATE TABLE email_drafts (
    meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    to_json TEXT NOT NULL,
    warnings_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    edited INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    next_attempt_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    actor_id TEXT,
    action TEXT NOT NULL,
    meeting_id TEXT,
    detail TEXT
  );
  CREATE TABLE ai_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE VIRTUAL TABLE search_index USING fts5(
    meeting_id UNINDEXED, kind UNINDEXED, ref UNINDEXED, start_ms UNINDEXED, text,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  `,
];

export type Db = DatabaseSync;

/** Open (or create) the database, apply migrations, and lock down file permissions. */
export function openDatabase(file: string): Db {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const fresh = file === ':memory:' || !existsSync(file);
  const db = new DatabaseSync(file);
  db.exec(
    'PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;',
  );
  migrate(db);
  if (fresh && file !== ':memory:' && process.platform !== 'win32') {
    try {
      chmodSync(file, 0o600);
    } catch {
      // Best effort; the folder is already private to the user.
    }
  }
  return db;
}

export function migrate(db: Db): number {
  const current = Number(
    (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
  );
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return MIGRATIONS.length;
}

/** Run `fn` in a transaction. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
