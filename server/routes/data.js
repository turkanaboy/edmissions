import { Router } from 'express';

const MAX_SLATE_BYTES = 1_000_000;
const MAX_SLATE_ROWS = 1_000;
const MAX_SLATE_COLUMNS = 50;
const MAX_SLATE_REDIRECTS = 3;
const SLATE_HOST_SUFFIXES = ['delhi.edu', 'technolutions.net'];
const PERSON_LEVEL_COLUMNS = new Set(['id', 'guid', 'name']);
const PERSON_LEVEL_COLUMN = /(^|_)(email|e_mail|student_?id|person_?id|record_?id|first_?name|last_?name|full_?name|preferred_?name|birth_?date|date_?of_?birth|dob|phone(?:_?number)?|mobile|(?:street|mailing|home)_?address)(_|$)/;
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

export function normalizeSlateEndpoint(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('Slate web service URL is invalid');
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const allowed = SLATE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  if (url.protocol !== 'https:' || !allowed || url.username || url.password) {
    throw new Error('Slate web service URL must use HTTPS on a SUNY Delhi or Technolutions host');
  }
  return url;
}

function assertAggregateColumns(columns) {
  if (!columns.length || columns.length > MAX_SLATE_COLUMNS) {
    throw new Error(`Slate response must contain between 1 and ${MAX_SLATE_COLUMNS} columns`);
  }
  if (columns.some((column) => {
    const header = normalizeHeader(column);
    return PERSON_LEVEL_COLUMNS.has(header) || PERSON_LEVEL_COLUMN.test(header);
  })) {
    throw new Error('Slate response must be aggregate-only; remove person-level columns from the query');
  }
}

const cellText = (value) => {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
};

function tableFromJson(value) {
  const rows = Array.isArray(value)
    ? value
    : ['rows', 'data', 'results'].map((key) => value?.[key]).find(Array.isArray);
  if (!rows) throw new Error('Slate JSON response must contain an array of rows');
  if (rows.length > MAX_SLATE_ROWS) {
    throw new Error(`Slate query must return ${MAX_SLATE_ROWS} rows or fewer`);
  }
  if (!rows.length) {
    const columns = Array.isArray(value?.columns) ? value.columns.map(String) : [];
    if (columns.length) assertAggregateColumns(columns);
    return { columns, rows: [] };
  }
  if (rows.every(Array.isArray)) {
    const width = Math.max(...rows.map((row) => row.length));
    const columns = Array.isArray(value?.columns) && value.columns.length === width
      ? value.columns.map(String)
      : Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
    assertAggregateColumns(columns);
    return { columns, rows: rows.map((row) => columns.map((_, index) => cellText(row[index]))) };
  }
  if (!rows.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
    throw new Error('Slate JSON rows must be objects or arrays');
  }
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  assertAggregateColumns(columns);
  return { columns, rows: rows.map((row) => columns.map((column) => cellText(row[column]))) };
}

function tableFromCsv(text) {
  const parsed = parseCsv(text);
  if (!parsed.length) throw new Error('Slate returned an empty table');
  const columns = parsed[0].map((column, index) => String(column || '').trim() || `Column ${index + 1}`);
  assertAggregateColumns(columns);
  const rows = parsed.slice(1);
  if (rows.length > MAX_SLATE_ROWS) throw new Error(`Slate query must return ${MAX_SLATE_ROWS} rows or fewer`);
  if (rows.some((row) => row.length !== columns.length)) throw new Error('Slate CSV rows have inconsistent columns');
  return { columns, rows: rows.map((row) => row.map(cellText)) };
}

function parseSlateTable(text, contentType) {
  const trimmed = text.trim();
  if (/html|xml/i.test(contentType) || trimmed.startsWith('<')) {
    throw new Error('Slate web service must return JSON or CSV, not HTML or XML');
  }
  if (/json/i.test(contentType) || /^[\[{]/.test(trimmed)) {
    try {
      return tableFromJson(JSON.parse(trimmed));
    } catch (error) {
      if (error.message.startsWith('Slate ')) throw error;
      throw new Error('Slate returned invalid JSON');
    }
  }
  return tableFromCsv(text);
}

async function readLimitedText(response) {
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_SLATE_BYTES) throw new Error('Slate response must be 1 MB or smaller');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_SLATE_BYTES) {
      await reader.cancel();
      throw new Error('Slate response must be 1 MB or smaller');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function fetchSlateTable(endpoint, redirects = 0) {
  const url = normalizeSlateEndpoint(endpoint);
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json, text/csv;q=0.9, text/plain;q=0.8' },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('Slate web service could not be reached');
  }
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirects >= MAX_SLATE_REDIRECTS) throw new Error('Slate web service redirected too many times');
    const location = response.headers.get('location');
    if (!location) throw new Error('Slate web service returned an invalid redirect');
    await response.body?.cancel();
    return fetchSlateTable(new URL(location, url), redirects + 1);
  }
  if (!response.ok) throw new Error(`Slate web service returned HTTP ${response.status}`);
  const table = parseSlateTable(
    await readLimitedText(response),
    response.headers.get('content-type') || ''
  );
  return {
    ...table,
    row_count: table.rows.length,
    retrieved_at: new Date().toISOString(),
  };
}

const snapshotRecord = (row) => row ? { ...row, id: Number(row.id) } : null;

const latestSnapshot = (db, kind) =>
  snapshotRecord(db.prepare('SELECT * FROM data_snapshots WHERE kind = ? ORDER BY id DESC LIMIT 1').get(kind));

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

function sunyBundle(db) {
  const snapshot = latestSnapshot(db, 'suny_enrollment');
  return {
    snapshot,
    cards: sunyCards(db, snapshot),
  };
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
    return { ...sunyBundle(db), skipped: true, stale: false };
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
    return { ...sunyBundle(db), skipped: false, stale: false };
  } catch (error) {
    if (!latest) throw error;
    db.prepare("UPDATE data_snapshots SET status = 'stale' WHERE id = ?").run(latest.id);
    return {
      ...sunyBundle(db),
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
      suny: sunyBundle(db),
      sources: officialDataSources,
    });
  });

  router.post('/slate/fetch', async (req, res) => {
    let endpoint;
    try {
      endpoint = normalizeSlateEndpoint(req.body?.url);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
    try {
      res.json(await fetchSlateTable(endpoint));
    } catch (error) {
      const message = error.message.startsWith('Slate ')
        ? error.message
        : 'Slate web service could not be read';
      res.status(502).json({ error: message });
    }
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
