import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS boards (
  id               TEXT PRIMARY KEY,
  creator_key_hash TEXT NOT NULL,
  mode             TEXT NOT NULL CHECK (mode IN ('cards', 'shared')),
  title            TEXT NOT NULL,
  items            TEXT NOT NULL,            -- JSON array of strings
  size             INTEGER NOT NULL,
  free             INTEGER NOT NULL,
  free_text        TEXT NOT NULL,
  rev              INTEGER NOT NULL DEFAULT 1, -- bumps whenever card text changes
  shared_card      TEXT,                     -- JSON cells, 'shared' mode only
  shared_marks     INTEGER NOT NULL DEFAULT 0,
  shared_by        TEXT,                     -- JSON: player id that marked each cell, or null
  created_at       INTEGER NOT NULL,
  last_active      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS boards_last_active ON boards (last_active);

CREATE TABLE IF NOT EXISTS players (
  board_id   TEXT NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL,
  card       TEXT,                           -- JSON cells, 'cards' mode only
  marks      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (board_id, id)
);
`;

export function openDb(file = ':memory:') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 3000');
  db.exec(SCHEMA);
  return db;
}
