import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'edmissions.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      link TEXT NOT NULL UNIQUE,
      excerpt TEXT NOT NULL DEFAULT '',
      published_at TEXT,
      score INTEGER NOT NULL DEFAULT 0,
      starred INTEGER NOT NULL DEFAULT 0,
      lane TEXT NOT NULL DEFAULT 'national',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY,
      body TEXT NOT NULL,
      summary TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      article_id INTEGER REFERENCES articles(id),
      source_context TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      text TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      source_context TEXT NOT NULL DEFAULT '{}',
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
      audience TEXT NOT NULL DEFAULT '',
      audience_lane TEXT NOT NULL DEFAULT '',
      audience_notes TEXT NOT NULL DEFAULT '',
      sender TEXT NOT NULL DEFAULT '',
      channel TEXT NOT NULL DEFAULT '',
      deadline TEXT NOT NULL DEFAULT '',
      source_context TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS brief_selections (
      id INTEGER PRIMARY KEY,
      body TEXT NOT NULL DEFAULT '',
      source_context TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS feed_status (
      source TEXT PRIMARY KEY,
      lane TEXT NOT NULL DEFAULT 'national',
      ok INTEGER NOT NULL DEFAULT 1,
      error TEXT NOT NULL DEFAULT '',
      checked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS enrollment_moments (
      id INTEGER PRIMARY KEY,
      seed_key TEXT UNIQUE,
      name TEXT NOT NULL,
      moment_date TEXT NOT NULL,
      audience TEXT NOT NULL DEFAULT '',
      lead_days INTEGER NOT NULL DEFAULT 0,
      channels TEXT NOT NULL DEFAULT '[]',
      notes TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      verified_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS data_snapshots (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('slate', 'suny_enrollment')),
      label TEXT NOT NULL,
      as_of TEXT NOT NULL,
      source_label TEXT NOT NULL,
      source_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'fresh' CHECK (status IN ('fresh', 'stale')),
      refreshed_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS data_points (
      id INTEGER PRIMARY KEY,
      snapshot_id INTEGER NOT NULL REFERENCES data_snapshots(id) ON DELETE CASCADE,
      term TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT '',
      program TEXT NOT NULL DEFAULT '',
      residency TEXT NOT NULL DEFAULT '',
      geography TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      count INTEGER NOT NULL CHECK (count >= 0),
      prior_year_count INTEGER CHECK (prior_year_count >= 0),
      goal INTEGER CHECK (goal >= 0),
      year INTEGER,
      institution TEXT NOT NULL DEFAULT '',
      measure TEXT NOT NULL DEFAULT ''
    );
  `);
  const addColumns = (table, additions) => {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
    for (const [name, definition] of Object.entries(additions)) {
      if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  };
  // Existing installs predate these additive fields.
  if (!db.prepare('PRAGMA table_info(campaign_templates)').all().some((c) => c.name === 'html_body')) {
    db.exec("ALTER TABLE campaign_templates ADD COLUMN html_body TEXT NOT NULL DEFAULT ''");
  }
  addColumns('articles', { lane: "TEXT NOT NULL DEFAULT 'national'" });
  addColumns('notes', { source_context: "TEXT NOT NULL DEFAULT '{}'" });
  addColumns('tasks', { source_context: "TEXT NOT NULL DEFAULT '{}'" });
  addColumns('campaigns', {
    format: "TEXT NOT NULL DEFAULT 'text'",
    audience: "TEXT NOT NULL DEFAULT ''",
    audience_lane: "TEXT NOT NULL DEFAULT ''",
    audience_notes: "TEXT NOT NULL DEFAULT ''",
    sender: "TEXT NOT NULL DEFAULT ''",
    channel: "TEXT NOT NULL DEFAULT ''",
    deadline: "TEXT NOT NULL DEFAULT ''",
    source_context: "TEXT NOT NULL DEFAULT '{}'",
  });
  return db;
}
