import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'edmissions.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      link TEXT NOT NULL UNIQUE,
      excerpt TEXT NOT NULL DEFAULT '',
      published_at TEXT,
      score INTEGER NOT NULL DEFAULT 0,
      starred INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY,
      body TEXT NOT NULL,
      summary TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      article_id INTEGER REFERENCES articles(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      text TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS campaign_templates (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      html_body TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS campus_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      audience TEXT NOT NULL DEFAULT '',
      voice TEXT NOT NULL DEFAULT '',
      facts TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('brief', 'generated')),
      purpose TEXT NOT NULL,
      cta TEXT NOT NULL,
      cta_link TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      format TEXT NOT NULL DEFAULT 'text',
      output TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Existing installs predate these two additive fields.
  if (!db.prepare('PRAGMA table_info(campaign_templates)').all().some((c) => c.name === 'html_body')) {
    db.exec("ALTER TABLE campaign_templates ADD COLUMN html_body TEXT NOT NULL DEFAULT ''");
  }
  if (!db.prepare('PRAGMA table_info(campaigns)').all().some((c) => c.name === 'format')) {
    db.exec("ALTER TABLE campaigns ADD COLUMN format TEXT NOT NULL DEFAULT 'text'");
  }
  return db;
}
