import { Router } from 'express';
import { isDate, isWebUrl } from './campaigns.js';

const MAX_CSV_CHARS = 200_000;
const MAX_ROWS = 2_000;
const SLATE_HEADERS = [
  'term',
  'stage',
  'program',
  'residency',
  'geography',
  'source',
  'count',
  'prior_year_count',
  'goal',
];
const SUNY_SOURCE_URL = 'https://data.ny.gov/Education/Headcount-Enrollment-by-Student-Level-and-Student-/4fyc-bf8i';
const SUNY_API_URL = 'https://data.ny.gov/resource/4fyc-bf8i.json';
const SUNY_SOURCE_LABEL = 'SUNY System Administration, Office of Institutional Research';
const SUNY_FIELDS = [
  'year',
  'term',
  'college_or_institution_type',
  'college_or_institution_name',
  'undergraduate_full_time',
  'undergraduate_part_time',
  'graduate_full_time',
  'graduate_part_time',
];

export const officialDataSources = [
  {
    title: 'SUNY Institutional Research',
    description: 'Campus and system enrollment, completion, and institutional data.',
    url: 'https://system.suny.edu/institutional-research/resources/',
  },
  {
    title: 'IPEDS Data Center',
    description: 'Federal enrollment, admissions, completion, finance, and staffing data.',
    url: 'https://nces.ed.gov/ipeds/datacenter/',
  },
  {
    title: 'College Scorecard',
    description: 'Institution and field-of-study costs, completion, debt, and earnings.',
    url: 'https://collegescorecard.ed.gov/data/',
  },
  {
    title: 'New York labor data',
    description: 'State and regional occupations, wages, projections, and jobs.',
    url: 'https://dol.ny.gov/labor-data',
  },
  {
    title: 'Bureau of Labor Statistics',
    description: 'National and regional employment, occupation, wage, and price data.',
    url: 'https://www.bls.gov/data/',
  },
  {
    title: 'U.S. Census data',
    description: 'Population, education, income, workforce, and geographic profiles.',
    url: 'https://data.census.gov/',
  },
];

const normalizeHeader = (value) =>
  String(value || '').replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s-]+/g, '_');

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        closedQuote = true;
      } else {
        field += char;
      }
      continue;
    }
    if (closedQuote && ![',', '\r', '\n'].includes(char)) {
      if (/\s/.test(char)) continue;
      throw new Error('CSV has characters after a closing quote');
    }
    if (char === '"') {
      if (field) throw new Error('CSV quote must begin a field');
      quoted = true;
      closedQuote = false;
    } else if (char === ',') {
      row.push(field);
      field = '';
      closedQuote = false;
    } else if (char === '\n') {
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = '';
      closedQuote = false;
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (quoted) throw new Error('CSV has an unclosed quote');
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

const textField = (value, label) => {
  const text = String(value || '').trim();
  if (!text || text.length > 300) throw new Error(`${label} is required and must be 300 characters or less`);
  return text;
};

const aggregateNumber = (value, label, optional = false) => {
  const text = String(value ?? '').trim();
  if (optional && !text) return null;
  if (!/^\d+$/.test(text)) throw new Error(`${label} must be a nonnegative whole number`);
  const number = Number(text);
  if (!Number.isSafeInteger(number)) throw new Error(`${label} is too large`);
  return number;
};

export function parseSlateCsv(csv) {
  if (typeof csv !== 'string' || !csv.trim()) throw new Error('Choose a CSV file to import');
  if (Buffer.byteLength(csv, 'utf8') > MAX_CSV_CHARS) throw new Error('CSV must be 200 KB or smaller');
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error('CSV needs a header and at least one data row');
  if (rows.length - 1 > MAX_ROWS) throw new Error(`CSV cannot exceed ${MAX_ROWS} aggregate rows`);

  const headers = rows[0].map(normalizeHeader);
  if (headers.some((header) => /(^|_)(email|e_mail|student_id|studentid|first_name|last_name|full_name|name|birth_date|dob|phone|address)(_|$)/.test(header))) {
    throw new Error('CSV appears to contain personally identifiable information');
  }
  if (new Set(headers).size !== headers.length
    || headers.length !== SLATE_HEADERS.length
    || SLATE_HEADERS.some((header) => !headers.includes(header))) {
    throw new Error(`CSV headers must be exactly: ${SLATE_HEADERS.join(', ')}`);
  }

  return rows.slice(1).map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${index + 2} has the wrong number of columns`);
    const value = Object.fromEntries(headers.map((header, column) => [header, values[column]]));
    return {
      term: textField(value.term, `Row ${index + 2} term`),
      stage: textField(value.stage, `Row ${index + 2} stage`),
      program: textField(value.program, `Row ${index + 2} program`),
      residency: textField(value.residency, `Row ${index + 2} residency`),
      geography: textField(value.geography, `Row ${index + 2} geography`),
      source: textField(value.source, `Row ${index + 2} source`),
      count: aggregateNumber(value.count, `Row ${index + 2} count`),
      prior_year_count: aggregateNumber(value.prior_year_count, `Row ${index + 2} prior_year_count`, true),
      goal: aggregateNumber(value.goal, `Row ${index + 2} goal`, true),
    };
  });
}

const snapshotRecord = (row) => row ? { ...row, id: Number(row.id) } : null;

const latestSnapshot = (db, kind) =>
  snapshotRecord(db.prepare('SELECT * FROM data_snapshots WHERE kind = ? ORDER BY id DESC LIMIT 1').get(kind));

function slateCards(db, snapshot) {
  if (!snapshot) return [];
  return db.prepare(
    `SELECT term, stage, SUM(count) AS count, SUM(prior_year_count) AS prior_year_count, SUM(goal) AS goal
     FROM data_points WHERE snapshot_id = ? GROUP BY term, stage ORDER BY term DESC, stage`
  ).all(snapshot.id).map((point) => {
    const dimensions = `Term: ${point.term}; stage: ${point.stage}; summed across program, residency, geography, and source`;
    return {
      title: `${point.stage} · ${point.term}`,
      count: Number(point.count),
      prior_year_count: point.prior_year_count === null ? null : Number(point.prior_year_count),
      goal: point.goal === null ? null : Number(point.goal),
      source_context: {
        title: `${point.stage} · ${point.term}`,
        publisher: snapshot.source_label,
        published_at: snapshot.as_of,
        url: snapshot.source_url,
        excerpt: `${Number(point.count).toLocaleString()} records in this aggregate Slate snapshot.`,
        lane: 'campus',
        dataset: snapshot.label,
        measure: point.stage,
        term: point.term,
        dimensions,
        as_of: snapshot.as_of,
        source_label: snapshot.source_label,
      },
    };
  });
}

function sunyCards(db, snapshot) {
  if (!snapshot) return [];
  const rows = db.prepare(
    `SELECT year, term, measure, count FROM data_points
     WHERE snapshot_id = ? ORDER BY measure, year DESC`
  ).all(snapshot.id);
  const measures = new Map();
  for (const row of rows) {
    if (!measures.has(row.measure)) measures.set(row.measure, []);
    measures.get(row.measure).push(row);
  }
  return [...measures.entries()].map(([measure, points]) => {
    const current = points[0];
    const previous = points[1];
    const period = `${current.term} ${current.year}`.trim();
    return {
      title: measure,
      count: Number(current.count),
      prior_year_count: previous ? Number(previous.count) : null,
      goal: null,
      source_context: {
        title: `${measure} · SUNY Delhi`,
        publisher: snapshot.source_label,
        published_at: snapshot.refreshed_at,
        url: snapshot.source_url,
        excerpt: `${Number(current.count).toLocaleString()} students in ${period}.`,
        lane: 'suny',
        dataset: snapshot.label,
        measure,
        institution: 'SUNY Delhi',
        year: String(current.year),
        term: current.term,
        dimensions: 'Institution × student level × load',
        as_of: period,
        source_label: snapshot.source_label,
      },
    };
  });
}

function bundle(db, kind) {
  const snapshot = latestSnapshot(db, kind);
  return {
    snapshot,
    cards: kind === 'slate' ? slateCards(db, snapshot) : sunyCards(db, snapshot),
  };
}

function insertSlateSnapshot(db, metadata, rows) {
  db.exec('BEGIN');
  try {
    const info = db.prepare(
      `INSERT INTO data_snapshots (kind, label, as_of, source_label, source_url, refreshed_at)
       VALUES ('slate', ?, ?, ?, ?, ?)`
    ).run(metadata.label, metadata.as_of, metadata.source_label, metadata.source_url, new Date().toISOString());
    const insert = db.prepare(
      `INSERT INTO data_points
       (snapshot_id, term, stage, program, residency, geography, source, count, prior_year_count, goal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of rows) {
      insert.run(
        info.lastInsertRowid,
        row.term,
        row.stage,
        row.program,
        row.residency,
        row.geography,
        row.source,
        row.count,
        row.prior_year_count,
        row.goal
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function parseSunyRows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('SUNY returned no enrollment rows');
  for (const row of rows) {
    if (!row || SUNY_FIELDS.some((field) => !Object.hasOwn(row, field))) {
      throw new Error('SUNY enrollment columns changed');
    }
  }
  const delhi = rows.filter((row) => String(row.college_or_institution_name).toLowerCase().includes('delhi'));
  if (!delhi.length) throw new Error('SUNY returned no Delhi rows');
  return delhi.map((row) => {
    const year = aggregateNumber(row.year, 'SUNY year');
    if (year < 2000 || year > 2100) throw new Error('SUNY year is invalid');
    const institution = textField(row.college_or_institution_name, 'SUNY institution');
    const term = textField(row.term, 'SUNY term');
    const undergraduate = aggregateNumber(row.undergraduate_full_time, 'SUNY undergraduate full-time')
      + aggregateNumber(row.undergraduate_part_time, 'SUNY undergraduate part-time');
    const graduate = aggregateNumber(row.graduate_full_time, 'SUNY graduate full-time')
      + aggregateNumber(row.graduate_part_time, 'SUNY graduate part-time');
    return {
      year,
      term,
      institution,
      measures: [
        ['Total enrollment', undergraduate + graduate],
        ['Undergraduate enrollment', undergraduate],
        ['Graduate enrollment', graduate],
      ],
    };
  });
}

function insertSunySnapshot(db, rows, refreshedAt) {
  const latest = rows.toSorted((a, b) => b.year - a.year)[0];
  db.exec('BEGIN');
  try {
    const info = db.prepare(
      `INSERT INTO data_snapshots
       (kind, label, as_of, source_label, source_url, status, refreshed_at)
       VALUES ('suny_enrollment', ?, ?, ?, ?, 'fresh', ?)`
    ).run(
      'SUNY campus headcount enrollment',
      `${latest.term} ${latest.year}`.trim(),
      SUNY_SOURCE_LABEL,
      SUNY_SOURCE_URL,
      refreshedAt
    );
    const insert = db.prepare(
      `INSERT INTO data_points (snapshot_id, term, count, year, institution, measure)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const row of rows) {
      for (const [measure, count] of row.measures) {
        insert.run(info.lastInsertRowid, row.term, count, row.year, row.institution, measure);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function refreshSunyEnrollment(db, now = new Date()) {
  const latest = latestSnapshot(db, 'suny_enrollment');
  if (latest?.status === 'fresh' && Date.parse(latest.refreshed_at) >= now.valueOf() - 86_400_000) {
    return { ...bundle(db, 'suny_enrollment'), skipped: true, stale: false };
  }
  try {
    const url = new URL(SUNY_API_URL);
    url.searchParams.set('$select', SUNY_FIELDS.join(','));
    url.searchParams.set('$where', "lower(college_or_institution_name) like '%delhi%'");
    url.searchParams.set('$order', 'year asc');
    url.searchParams.set('$limit', '100');
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`SUNY returned HTTP ${response.status}`);
    const rows = parseSunyRows(await response.json());
    const refreshedAt = now.toISOString();
    insertSunySnapshot(db, rows, refreshedAt);
    return { ...bundle(db, 'suny_enrollment'), skipped: false, stale: false };
  } catch (error) {
    if (!latest) throw error;
    db.prepare("UPDATE data_snapshots SET status = 'stale' WHERE id = ?").run(latest.id);
    return {
      ...bundle(db, 'suny_enrollment'),
      skipped: false,
      stale: true,
      warning: 'Refresh failed; showing the last saved SUNY snapshot.',
    };
  }
}

export function dataRoutes() {
  const router = Router();

  router.get('/', (req, res) => {
    const db = req.app.locals.db;
    res.json({
      slate: bundle(db, 'slate'),
      suny: bundle(db, 'suny_enrollment'),
      sources: officialDataSources,
    });
  });

  router.post('/slate', (req, res) => {
    const label = String(req.body?.label || 'Slate aggregate snapshot').trim();
    const asOf = String(req.body?.as_of || '').trim();
    const sourceLabel = String(req.body?.source_label || 'Slate aggregate export').trim();
    const sourceUrl = String(req.body?.source_url || '').trim();
    if (!label || label.length > 200 || !sourceLabel || sourceLabel.length > 200) {
      return res.status(400).json({ error: 'Snapshot and source labels are required and must be 200 characters or less' });
    }
    if (!isDate(asOf)) return res.status(400).json({ error: 'As-of date must be a valid date' });
    if (sourceUrl && !isWebUrl(sourceUrl)) return res.status(400).json({ error: 'Source URL must use http or https' });
    let rows;
    try {
      rows = parseSlateCsv(req.body?.csv);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    insertSlateSnapshot(req.app.locals.db, {
      label,
      as_of: asOf,
      source_label: sourceLabel,
      source_url: sourceUrl,
    }, rows);
    res.status(201).json(bundle(req.app.locals.db, 'slate'));
  });

  router.post('/suny/refresh', async (req, res) => {
    try {
      res.json(await refreshSunyEnrollment(req.app.locals.db));
    } catch (error) {
      res.status(502).json({ error: 'SUNY data could not be refreshed' });
    }
  });

  return router;
}
