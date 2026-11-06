import { readLimitedText } from './routes/data.js';

const TTL_MS = 7 * 86_400_000;
const FETCH_TIMEOUT_MS = 15_000;
const IPEDS_YEAR = 2023; // the Urban Institute API returned HTTP 500 for 2024 on 2026-11-05
const ACS_YEAR = 2023;
const TOP_COMPETITORS = 15;
const MAX_RESPONSE_BYTES = 5_000_000; // the statewide IPEDS directory alone is about 1 MB
const ASSOCIATE_LEVEL = 4;
const BACHELOR_LEVEL = 7;

const BLS = { publisher: 'U.S. Bureau of Labor Statistics, OEWS', url: 'https://www.bls.gov/oes/' };
const CENSUS = { publisher: 'U.S. Census Bureau, ACS 5-year', url: 'https://www.census.gov/programs-surveys/acs' };
const SUNY = {
  publisher: 'SUNY via Open NY',
  url: 'https://data.ny.gov/Education/SUNY-First-Time-Undergraduates-by-NYS-County-Begin/d83q-xbce',
};
const IPEDS = {
  publisher: 'IPEDS via Urban Institute Education Data Portal',
  url: 'https://educationdata.urban.org/documentation/colleges.html',
};

const count = (value) => Number(value).toLocaleString('en-US');
const dollars = (value) => `$${Math.round(Number(value)).toLocaleString('en-US')}`;

async function fetchJson(fetchImpl, url, options = {}) {
  // The Urban Institute API returns 403 to Node's default user agent.
  const headers = { 'User-Agent': 'EDMissions/1.0', Accept: 'application/json', ...options.headers };
  const response = await fetchImpl(url, { ...options, headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return JSON.parse(await readLimitedText(response, MAX_RESPONSE_BYTES));
}

function parameterSchema(properties) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

// Every outward request comes from seeded IDs, so the model can't choose a URL or series.
export function createPublicData({ db, config, fetchImpl = (...args) => globalThis.fetch(...args), now = () => new Date() }) {
  const advisor = config.content?.advisor;
  if (!advisor) return null;

  const readCache = db.prepare('SELECT payload, retrieved_at FROM external_data WHERE key = ?');
  const writeCache = db.prepare(
    `INSERT INTO external_data (key, payload, retrieved_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, retrieved_at = excluded.retrieved_at`
  );

  // Returns null when a source has no fresh or saved value. Error detail is dropped
  // here on purpose: request URLs can carry an API key.
  const cached = async (key, load) => {
    const row = readCache.get(key);
    const timestamp = now();
    if (row && timestamp.valueOf() - Date.parse(row.retrieved_at) < TTL_MS) {
      return { data: JSON.parse(row.payload), retrieved_at: row.retrieved_at, stale: false };
    }
    try {
      const data = await load();
      const retrievedAt = timestamp.toISOString();
      writeCache.run(key, JSON.stringify(data), retrievedAt);
      return { data, retrieved_at: retrievedAt, stale: false };
    } catch {
      return row ? { data: JSON.parse(row.payload), retrieved_at: row.retrieved_at, stale: true } : null;
    }
  };

  const loadOews = async (areaCode, soc) => {
    const series = (datatype) => `OEU${areaCode}000000${soc}${datatype}`;
    const body = { seriesid: [series('01'), series('13')] };
    if (config.blsKey) body.registrationkey = config.blsKey;
    const version = config.blsKey ? 'v2' : 'v1';
    const result = await fetchJson(fetchImpl, `https://api.bls.gov/publicAPI/${version}/timeseries/data/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (result.status !== 'REQUEST_SUCCEEDED') throw new Error('BLS request was not processed');
    const latest = (seriesId) => {
      const point = result.Results?.series?.find((item) => item.seriesID === seriesId)?.data?.[0];
      return point && Number.isFinite(Number(point.value)) ? point : null;
    };
    const employment = latest(series('01'));
    const median = latest(series('13'));
    if (!employment && !median) throw new Error('BLS returned no data');
    return {
      year: employment?.year || median.year,
      employment: employment ? Number(employment.value) : null,
      median_wage: median ? Number(median.value) : null,
    };
  };

  const loadAcs = async (market) => {
    const male18to24 = ['007', '008', '009', '010'];
    const female18to24 = ['031', '032', '033', '034'];
    const youth = [...male18to24, ...female18to24].map((code) => `B01001_${code}E`);
    const bachelorsPlus = ['022', '023', '024', '025'].map((code) => `B15003_${code}E`);
    const url = new URL(`https://api.census.gov/data/${ACS_YEAR}/acs/acs5`);
    url.searchParams.set('get', ['B01003_001E', 'B15003_001E', ...youth, ...bachelorsPlus].join(','));
    if (market.counties.length) {
      url.searchParams.set('for', `county:${market.counties.map((county) => county.fips).join(',')}`);
      url.searchParams.set('in', 'state:36');
    } else {
      url.searchParams.set('for', 'state:36');
    }
    url.searchParams.set('key', config.censusKey);
    const [header, ...rows] = await fetchJson(fetchImpl, url);
    // Census marks unavailable estimates with null or large negative sentinels.
    const cell = (row, variable) => {
      const raw = row[header.indexOf(variable)];
      const value = Number(raw);
      if (raw === null || raw === undefined || !Number.isFinite(value) || value < 0) {
        throw new Error('Census returned an unavailable estimate');
      }
      return value;
    };
    const total = (variables) => rows.reduce(
      (sum, row) => sum + variables.reduce((inner, variable) => inner + cell(row, variable), 0),
      0
    );
    const adults = total(['B15003_001E']);
    const population = total(['B01003_001E']);
    if (!population) throw new Error('Census returned no data');
    return {
      population,
      age_18_to_24: total(youth),
      adults_25_plus_without_bachelors: adults - total(bachelorsPlus),
    };
  };

  const loadSunyOrigins = async (market) => {
    const url = new URL('https://data.ny.gov/resource/d83q-xbce.json');
    const names = market.counties.map((county) => `'${county.name}'`).join(',');
    url.searchParams.set('$select', 'term,county,attending_suny_technology_colleges,total_attending_suny_institutions');
    url.searchParams.set('$where', `county in(${names})`);
    url.searchParams.set('$order', 'term DESC');
    url.searchParams.set('$limit', String(market.counties.length));
    const rows = await fetchJson(fetchImpl, url);
    const latest = rows.filter((row) => row.term === rows[0]?.term);
    if (!latest.length) throw new Error('SUNY returned no rows');
    const sum = (field) => latest.reduce((total, row) => total + Number(row[field]), 0);
    return {
      term: latest[0].term,
      technology_colleges: sum('attending_suny_technology_colleges'),
      all_suny: sum('total_attending_suny_institutions'),
    };
  };

  const loadCompetitors = async (market, cip, homeUnitId) => {
    const base = 'https://educationdata.urban.org/api/v1/college-university/ipeds';
    const completions = await fetchJson(
      fetchImpl,
      `${base}/completions-cip-6/${IPEDS_YEAR}/?cipcode_6digit=${cip}&fips=36&race=99&sex=99&majornum=1`
    );
    const directoryUrls = market.counties.length
      ? market.counties.map((county) => `${base}/directory/${IPEDS_YEAR}/?county_fips=36${county.fips}`)
      : [`${base}/directory/${IPEDS_YEAR}/?fips=36`];
    const directories = await Promise.all(directoryUrls.map((url) => fetchJson(fetchImpl, url)));
    const names = new Map(directories.flatMap((page) => page.results.map((row) => [row.unitid, row.inst_name])));
    const institutions = new Map();
    const home = { associate: 0, bachelor: 0, other: 0 };
    for (const row of completions.results) {
      if (!(row.awards_6digit > 0)) continue;
      const level = row.award_level === ASSOCIATE_LEVEL ? 'associate' : row.award_level === BACHELOR_LEVEL ? 'bachelor' : 'other';
      if (row.unitid === homeUnitId) home[level] += row.awards_6digit;
      if (!names.has(row.unitid)) continue;
      const entry = institutions.get(row.unitid) || { name: names.get(row.unitid), associate: 0, bachelor: 0, other: 0 };
      entry[level] += row.awards_6digit;
      institutions.set(row.unitid, entry);
    }
    const ranked = [...institutions.values()]
      .map((entry) => ({ ...entry, total: entry.associate + entry.bachelor + entry.other }))
      .sort((a, b) => b.total - a.total);
    const sum = (field) => ranked.reduce((total, entry) => total + entry[field], 0);
    return {
      institutions: ranked.length,
      total: sum('total'),
      associate: sum('associate'),
      bachelor: sum('bachelor'),
      top: ranked.slice(0, TOP_COMPETITORS),
      home,
    };
  };

  const figure = (label, value, geography, period, source, retrievedAt, stale = false) => ({
    label,
    value,
    geography,
    period,
    publisher: source.publisher,
    url: source.url,
    retrieved_at: retrievedAt,
    stale,
  });

  const programs = Object.keys(advisor.programs);
  const markets = Object.keys(advisor.markets);
  const programParam = { type: 'string', enum: programs, description: 'Program with mapped data.' };
  const marketParam = { type: 'string', enum: markets, description: 'Market with mapped data.' };

  const tools = new Map(Object.entries({
    get_program_profile: {
      description: 'SUNY Delhi offerings for a program: modality, audience, licensure needs, start terms, official URLs, tuition, and relevant policy.',
      params: { program: programParam },
      async handler({ program }) {
        const profile = advisor.programs[program];
        const source = { publisher: 'SUNY Delhi', url: profile.tuition.url };
        return {
          output: {
            program: profile.label,
            offerings: profile.offerings,
            online_landing_page: profile.landing_page,
            tuition: profile.tuition,
            policy: profile.policy,
          },
          evidence: [
            figure(profile.tuition.label, profile.tuition.value, 'SUNY Delhi', 'Year not stated by source', source, profile.tuition.verified_at),
            figure(profile.policy.label, profile.policy.value, 'New York State', 'Current law', profile.policy, profile.policy.verified_at),
          ],
        };
      },
    },

    get_labor_market: {
      description: 'Occupation employment, median wage, and projected openings for a program in a market, with a geography note.',
      params: { program: programParam, market: marketParam },
      async handler({ program, market: marketId }) {
        const profile = advisor.programs[program];
        const market = advisor.markets[marketId];
        const { projections } = market;
        const projectionSource = {
          publisher: advisor.projectionsSource.publisher,
          url: marketId === 'statewide' ? advisor.projectionsSource.statewide_url : advisor.projectionsSource.regional_url,
        };
        const verified = advisor.projectionsSource.verified_at;
        const evidence = [
          figure(`${profile.soc_title} employment, start of projection`, count(projections.base), market.label, projections.period, projectionSource, verified),
          figure(`${profile.soc_title} employment, end of projection`, count(projections.projected), market.label, projections.period, projectionSource, verified),
          figure(`${profile.soc_title} annual average openings`, count(projections.annual_openings), market.label, projections.period, projectionSource, verified),
          figure(`${profile.soc_title} median annual wage`, dollars(projections.median_wage), market.label, advisor.projectionsSource.wage_year, projectionSource, verified),
        ];
        const unavailable = [];
        const oews = await cached(`oews:${market.oews_area}:${profile.soc}`, () => loadOews(market.oews_area, profile.soc));
        if (oews) {
          const { year, employment, median_wage: medianWage } = oews.data;
          if (employment !== null) evidence.push(figure(`${profile.soc_title} employment`, count(employment), market.oews_label, year, BLS, oews.retrieved_at, oews.stale));
          if (medianWage !== null) evidence.push(figure(`${profile.soc_title} median annual wage`, dollars(medianWage), market.oews_label, year, BLS, oews.retrieved_at, oews.stale));
        } else {
          unavailable.push(BLS.publisher);
        }
        return { output: { market: market.label, geography_note: market.note, figures: evidence, unavailable }, evidence };
      },
    },

    get_market_profile: {
      description: 'Population, age, and attainment for a market, plus first-time SUNY undergraduates from its counties.',
      params: { market: marketParam },
      async handler({ market: marketId }) {
        const market = advisor.markets[marketId];
        const evidence = [];
        const unavailable = [];
        const acs = config.censusKey ? await cached(`acs:${ACS_YEAR}:${marketId}`, () => loadAcs(market)) : null;
        if (acs) {
          const period = `${ACS_YEAR} 5-year`;
          const add = (label, value) => evidence.push(figure(label, count(value), market.label, period, CENSUS, acs.retrieved_at, acs.stale));
          add('Population', acs.data.population);
          add('Population age 18 to 24', acs.data.age_18_to_24);
          add('Adults 25 and over without a bachelor\'s degree', acs.data.adults_25_plus_without_bachelors);
        } else {
          unavailable.push(CENSUS.publisher);
        }
        if (market.counties.length) {
          const origins = await cached(`suny-origins:${marketId}`, () => loadSunyOrigins(market));
          if (origins) {
            const add = (label, value) => evidence.push(figure(label, count(value), market.label, origins.data.term, SUNY, origins.retrieved_at, origins.stale));
            add('First-time undergraduates entering SUNY technology colleges (sector, not Delhi alone)', origins.data.technology_colleges);
            add('First-time undergraduates entering all SUNY campuses', origins.data.all_suny);
          } else {
            unavailable.push(SUNY.publisher);
          }
        }
        return { output: { market: market.label, geography_note: market.note, figures: evidence, unavailable }, evidence };
      },
    },

    get_competitors: {
      description: 'Institutions located in a market that award credentials in a program, with award counts by level.',
      params: { program: programParam, market: marketParam },
      async handler({ program, market: marketId }) {
        const profile = advisor.programs[program];
        const market = advisor.markets[marketId];
        const result = await cached(`ipeds:${IPEDS_YEAR}:${profile.cip}:${marketId}`, () => loadCompetitors(market, profile.cip, advisor.ipeds_unitid));
        if (!result) return { output: { market: market.label, unavailable: [IPEDS.publisher] }, evidence: [] };
        const { data } = result;
        const add = (label, value, geography = market.label) => figure(label, count(value), geography, String(IPEDS_YEAR), IPEDS, result.retrieved_at, result.stale);
        const evidence = [
          add(`Institutions awarding ${profile.cip_title} credentials`, data.institutions),
          add(`${profile.cip_title} awards, all levels`, data.total),
          add(`${profile.cip_title} associate awards`, data.associate),
          add(`${profile.cip_title} bachelor's awards`, data.bachelor),
          add(`SUNY Delhi ${profile.cip_title} associate awards`, data.home.associate, 'SUNY Delhi'),
          add(`SUNY Delhi ${profile.cip_title} bachelor's awards`, data.home.bachelor, 'SUNY Delhi'),
        ];
        return {
          output: {
            market: market.label,
            note: 'Counts awards conferred in-state by institutions located in this market. Online programs based elsewhere also compete here and are not counted.',
            figures: evidence,
            top_institutions: data.top,
          },
          evidence,
        };
      },
    },
  }));

  return {
    definitions: [...tools].map(([name, tool]) => ({
      type: 'function',
      name,
      description: tool.description,
      parameters: parameterSchema(tool.params),
      strict: true,
    })),

    async run(name, args) {
      const tool = tools.get(name);
      if (!tool) return { output: { error: `Unknown tool ${name}` }, evidence: [] };
      if (tool.params.program && !programs.includes(args?.program)) {
        return { output: { unmapped: `No data is mapped for program "${args?.program}".` }, evidence: [] };
      }
      if (tool.params.market && !markets.includes(args?.market)) {
        return { output: { unmapped: `No data is mapped for market "${args?.market}".` }, evidence: [] };
      }
      try {
        return await tool.handler(args);
      } catch {
        return { output: { error: `${name} failed` }, evidence: [] };
      }
    },
  };
}

const AMOUNT = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const DOLLARS = new RegExp(String.raw`\$\s?(?:${AMOUNT})`, 'g');
const PERCENT = new RegExp(String.raw`(?:${AMOUNT})\s?%`, 'g');
const NUMBER = new RegExp(AMOUNT, 'g');
const FIGURE = new RegExp(String.raw`\$\s?(?:${AMOUNT})|(?:${AMOUNT})\s?%|(?<![\d.,$])(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{3,}(?:\.\d+)?)`, 'g');
const isYear = (text) => /^\d{4}$/.test(text) && Number(text) >= 1900 && Number(text) <= 2100;
const asNumber = (text) => Number(String(text).replace(/[^\d.]/g, ''));

function numbersIn(texts, pattern) {
  const found = new Set();
  for (const text of texts) {
    for (const match of String(text || '').match(pattern) || []) {
      const number = asNumber(match);
      found.add(number);
      found.add(Math.round(number));
    }
  }
  return found;
}

// A dollar figure or percentage must match the same unit in a source. A plain number can
// match any number, since sources may state a count or wage in either form.
// ponytail: exact-number match, so derived arithmetic and rounded figures get flagged too.
// The UI words this as "verify", never blocks; a claim-level check needs a second model pass.
export function findUnsourcedFigures(answer, sourceTexts) {
  const dollars = numbersIn(sourceTexts, DOLLARS);
  const percents = numbersIn(sourceTexts, PERCENT);
  const plain = numbersIn(sourceTexts, NUMBER);
  const isSourced = (text) => {
    const sourced = text.startsWith('$') ? dollars : text.endsWith('%') ? percents : plain;
    return sourced.has(asNumber(text));
  };
  const prose = String(answer).replace(/https?:\/\/\S+/g, ' ');
  const flagged = (prose.match(FIGURE) || []).filter((text) => !isYear(text) && !isSourced(text));
  return [...new Set(flagged.map((text) => text.trim()))];
}
