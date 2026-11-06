// Runs advisor questions against the live model and public APIs. Costs real API credits.
// Automated checks catch structure only: a person still has to judge the advice.
//   node --env-file=.env scripts/advisor-eval.mjs              run every case
//   node --env-file=.env scripts/advisor-eval.mjs subway quote run the named cases
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { campusContext } from '../server/routes/campaigns.js';
import { findUnsourcedFigures } from '../server/public-data.js';

const SECTIONS = ['Verdict', 'Who this reaches', 'Evidence', 'Unknowns', 'Break-even', 'Cheaper test', 'What would change'];

// Add real questions from the Delhi user here as they arrive.
const CASES = [
  {
    name: 'subway',
    question: 'In my budget people are proposing a subway ad in NYC for the nursing program.',
    sections: SECTIONS,
    publishers: ['SUNY Delhi', 'Bureau of Labor Statistics', 'IPEDS'],
    mentions: [/BSN.in.10/, /digitalads\/nursing-online/],
    read: 'Splits campus from online offerings; treats RN counts as a universe; applies BSN in 10; asks for the quote; says Delhi pipeline data was unavailable; proposes a cheaper test with a threshold.',
  },
  {
    name: 'quote',
    question: 'People are proposing a subway ad in NYC for nursing. The quote is $60,000 for four weeks. Should I fund it?',
    sections: SECTIONS,
    publishers: ['SUNY Delhi', 'Bureau of Labor Statistics'],
    read: 'Shows break-even enrollments with the arithmetic, a labeled tuition input, and any assumptions.',
  },
  {
    name: 'campus',
    question: 'Should we fund regional radio and school counselor outreach in the Southern Tier for the campus nursing AAS?',
    sections: SECTIONS,
    publishers: ['SUNY Delhi', 'Department of Labor'],
    read: 'Should treat this audience differently from the subway case, and note that Delaware County has no county-level occupational data.',
  },
  {
    name: 'online',
    question: 'Should we run a targeted LinkedIn campaign at working RNs in NYC for the online RN-to-BSN?',
    sections: SECTIONS,
    publishers: ['SUNY Delhi', 'Bureau of Labor Statistics'],
    read: 'Verdict should be more favorable than a broad subway buy, with the exemption for RNs licensed by June 18, 2020 narrowing the audience.',
  },
  {
    name: 'unmapped',
    question: 'Should we buy a billboard in Buffalo for the welding program?',
    sections: [],
    publishers: [],
    read: 'Says welding and Buffalo have no mapped data, labels its reasoning as general, and shows no invented figures.',
  },
];

const names = process.argv.slice(2);
const selected = names.length ? CASES.filter((item) => names.includes(item.name)) : CASES;
if (!selected.length) {
  console.error(`No matching cases. Choose from: ${CASES.map((item) => item.name).join(', ')}`);
  process.exit(2);
}
if (!process.env.EDMISSIONS_OPENAPI_KEY) {
  console.error('EDMISSIONS_OPENAPI_KEY is not set. Run with: node --env-file=.env scripts/advisor-eval.mjs');
  process.exit(2);
}

process.env.EDMISSIONS_DATA_DIR = mkdtempSync(join(tmpdir(), 'edm-eval-'));
const { locals } = createApp();
const { ai, db } = locals;
const campus = campusContext(db);
let failures = 0;

for (const item of selected) {
  console.log(`\n${'='.repeat(78)}\n${item.name}: ${item.question}\n${'='.repeat(78)}`);
  const started = Date.now();
  try {
    const { answer, evidence, sourceText } = await ai.researchAnswer(item.question, [], campus);
    const missingSections = item.sections.filter((section) => !answer.includes(section));
    const missingPublishers = item.publishers.filter((publisher) => !evidence.some((source) => source.publisher.includes(publisher)));
    const missingMentions = (item.mentions || []).filter((pattern) => !pattern.test(answer));
    const flagged = findUnsourcedFigures(answer, [sourceText, item.question, campus]);

    console.log(`${answer}\n\n--- ${evidence.length} sources, ${Math.round((Date.now() - started) / 1000)}s`);
    for (const source of evidence) {
      console.log(`  ${source.label}: ${source.value} (${source.geography}, ${source.period}) ${source.publisher}${source.stale ? ' STALE' : ''}`);
    }
    console.log(`--- Flagged figures to review: ${flagged.join(', ') || 'none'}`);
    console.log(`--- Read for: ${item.read}`);
    if (missingSections.length) console.log(`--- FAIL missing sections: ${missingSections.join(', ')}`);
    if (missingPublishers.length) console.log(`--- FAIL missing sources: ${missingPublishers.join(', ')}`);
    if (missingMentions.length) console.log(`--- FAIL missing mentions: ${missingMentions.join(', ')}`);
    if (missingSections.length || missingPublishers.length || missingMentions.length) failures += 1;
  } catch (error) {
    failures += 1;
    console.log(`--- FAIL ${error.name}: ${error.status || ''} ${error.message}`);
  }
}

console.log(`\n${selected.length - failures} of ${selected.length} passed structure checks.`);
process.exit(failures ? 1 : 0);
