import { Router } from 'express';
import { isDate, isWebUrl } from './campaigns.js';

const CHANNELS = new Set(['email', 'sms', 'social', 'web', 'call', 'direct-mail', 'campus']);
const SEED_KEY = 'enrollment_moments_v1';

const parseChannels = (value) => {
  try {
    const parsed = Array.isArray(value) ? value : JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const verificationStale = (verifiedAt) => {
  if (!isDate(verifiedAt)) return true;
  return Date.now() - new Date(`${verifiedAt}T00:00:00Z`).valueOf() > 90 * 864e5;
};

export const momentRecord = (row) => row ? {
  ...row,
  channels: parseChannels(row.channels),
  verification_stale: verificationStale(row.verified_at),
} : null;

function validateMoment(body, res) {
  const moment = {
    name: String(body?.name || '').trim(),
    moment_date: String(body?.moment_date || '').trim(),
    audience: String(body?.audience || '').trim(),
    lead_days: Number(body?.lead_days),
    channels: parseChannels(body?.channels),
    notes: String(body?.notes || '').trim(),
    source_url: String(body?.source_url || '').trim(),
    verified_at: String(body?.verified_at || '').trim(),
  };
  if (!moment.name || !isDate(moment.moment_date)) {
    res.status(400).json({ error: 'Moment name and a valid date are required' });
    return null;
  }
  if (!Number.isInteger(moment.lead_days) || moment.lead_days < 0 || moment.lead_days > 365) {
    res.status(400).json({ error: 'Lead days must be between 0 and 365' });
    return null;
  }
  if (moment.channels.some((channel) => !CHANNELS.has(channel))) {
    res.status(400).json({ error: 'Moment channels are invalid' });
    return null;
  }
  if (moment.source_url && !isWebUrl(moment.source_url)) {
    res.status(400).json({ error: 'Source URL must use http or https' });
    return null;
  }
  if (moment.verified_at && !isDate(moment.verified_at)) {
    res.status(400).json({ error: 'Verification date is invalid' });
    return null;
  }
  if (moment.name.length > 500 || moment.audience.length > 500 || moment.notes.length > 4000 || moment.source_url.length > 2000) {
    res.status(400).json({ error: 'Moment fields are too long' });
    return null;
  }
  return moment;
}

export function seedMoments(db, config) {
  if (db.prepare('SELECT value FROM app_meta WHERE key = ?').get(SEED_KEY)) return;
  const insert = db.prepare(
    `INSERT INTO enrollment_moments
     (seed_key, name, moment_date, audience, lead_days, channels, notes, source_url, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.exec('BEGIN');
  try {
    for (const moment of config.content.enrollmentMoments || []) {
      insert.run(
        moment.seed_key,
        moment.name,
        moment.moment_date,
        moment.audience,
        moment.lead_days,
        JSON.stringify(moment.channels),
        moment.notes,
        moment.source_url,
        moment.verified_at
      );
    }
    db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?)').run(SEED_KEY, 'complete');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function momentRoutes() {
  const router = Router();

  router.get('/', (req, res) => {
    const db = req.app.locals.db;
    const upcoming = db.prepare(
      "SELECT * FROM enrollment_moments WHERE date(moment_date) >= date('now') ORDER BY date(moment_date), id"
    ).all().map(momentRecord);
    const past = db.prepare(
      "SELECT * FROM enrollment_moments WHERE date(moment_date) < date('now') ORDER BY date(moment_date) DESC, id DESC"
    ).all().map(momentRecord);
    res.json({ upcoming, past });
  });

  router.post('/', (req, res) => {
    const moment = validateMoment(req.body, res);
    if (!moment) return;
    const db = req.app.locals.db;
    const info = db.prepare(
      `INSERT INTO enrollment_moments
       (name, moment_date, audience, lead_days, channels, notes, source_url, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      moment.name,
      moment.moment_date,
      moment.audience,
      moment.lead_days,
      JSON.stringify(moment.channels),
      moment.notes,
      moment.source_url,
      moment.verified_at
    );
    res.status(201).json(momentRecord(db.prepare('SELECT * FROM enrollment_moments WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/:id', (req, res) => {
    const db = req.app.locals.db;
    const existing = db.prepare('SELECT * FROM enrollment_moments WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'No such enrollment moment' });
    const moment = validateMoment({
      ...existing,
      channels: parseChannels(existing.channels),
      ...req.body,
    }, res);
    if (!moment) return;
    db.prepare(
      `UPDATE enrollment_moments SET name = ?, moment_date = ?, audience = ?, lead_days = ?,
       channels = ?, notes = ?, source_url = ?, verified_at = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      moment.name,
      moment.moment_date,
      moment.audience,
      moment.lead_days,
      JSON.stringify(moment.channels),
      moment.notes,
      moment.source_url,
      moment.verified_at,
      req.params.id
    );
    res.json(momentRecord(db.prepare('SELECT * FROM enrollment_moments WHERE id = ?').get(req.params.id)));
  });

  router.delete('/:id', (req, res) => {
    const info = req.app.locals.db.prepare('DELETE FROM enrollment_moments WHERE id = ?').run(req.params.id);
    if (!Number(info.changes)) return res.status(404).json({ error: 'No such enrollment moment' });
    res.json({ ok: true });
  });

  return router;
}
