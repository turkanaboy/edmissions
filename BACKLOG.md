# EDMissions Product Backlog

Updated: July 30, 2026

This backlog keeps EDMissions focused as a personal communications dashboard for SUNY Delhi. Items are ordered by usefulness and dependency, not by implementation size.

## Accepted

### P0 — Campaign Preflight

**Status:** Approved

Add a final check before a campaign is copied or exported. It should flag:

- Missing audience, call to action, deadline, sender, or channel
- Unsupported claims and missing source links
- Obvious placeholder text
- Tone or length mismatches for the selected channel
- Accessibility concerns in supplied HTML

**Implementation boundary:** Start with deterministic checks against the campaign fields and generated text. Do not add a second AI call unless simple checks prove insufficient.

**Proof:** A campaign with a known missing field shows a useful warning; a complete campaign can proceed without friction.

### P0 — Signal Feeds and “Use This” Workbench

**Status:** Approved

Expand the current news feed into four ranked source lanes:

1. **SUNY Delhi:** official newsroom and other reliable `delhi.edu` updates
2. **Local and regional:** Delaware County official news plus selected surrounding-area publishers
3. **SUNY system:** official SUNY news releases
4. **National higher education:** the existing feeds

Default ranking should favor recent SUNY Delhi, regional, and SUNY system signals. National stories remain available but should not crowd out local relevance.

Every signal should preserve its title, publisher, publication date, URL, excerpt, and source lane. “Use This” opens a shared workbench with these actions:

- Start a campaign with the source and key facts attached
- Ask the Research Hub about the signal
- Save it to notes
- Create a task
- Add it to the AVP Brief

**Implementation boundary:** Use a native RSS feed where one exists. Otherwise, parse only a stable public listing or use a site-restricted news feed. Do not scrape full article bodies.

**Proof:** At least one fresh item from each configured lane appears with correct provenance, and every action carries the source into its destination.

### P1 — Audience Lanes

**Status:** Approved

Let the same campaign idea be shaped for reusable audience lanes such as:

- Prospective students
- Parents and families
- School counselors
- Adult learners
- Accepted students
- Deposited students
- Current students
- Campus partners

Each lane should supply a small set of communication defaults—priorities, tone, useful proof points, and likely calls to action—while keeping every field editable.

**Implementation boundary:** Store the lanes in the existing content configuration. Do not build an audience-management system.

**Proof:** Switching lanes updates the campaign guidance without overwriting the user’s manually edited copy.

### P1 — Enrollment Moments

**Status:** Approved

Add a compact planning view for recurring enrollment moments: application pushes, accepted-student communication, FAFSA and aid reminders, deposit periods, orientation, move-in, and melt prevention.

Each moment should show the intended audience, recommended lead time, suggested channels, and a direct action to start a campaign.

**Implementation boundary:** Begin with editable seeded moments and native date fields. Do not build a calendar service or external synchronization.

**Proof:** A moment can seed a correctly dated campaign, and manual changes persist.

### P1 — AVP Brief

**Status:** Approved

Create a concise, printable briefing view for AVP Nazely that brings together:

- Important recent SUNY Delhi, regional, and SUNY signals
- Active campaign work and approaching enrollment moments
- Saved research takeaways
- Open tasks and decisions
- Selected Data Command Center indicators when available

Items added through “Use This” should retain their source links. The brief should support quick review, printing, and copying into another document.

**Implementation boundary:** Compose existing dashboard data into a brief. Do not add a publishing workflow or document-management system.

**Proof:** The brief can be assembled from live dashboard items without retyping and prints cleanly.

## Discovery Approved

### Data Command Center

The first version should answer useful enrollment questions without becoming a second CRM or a full business-intelligence platform.

#### Recommended first views

1. **Slate Funnel Snapshot**
   Aggregate counts by term, funnel stage, program, residency, geography, and source, with prior-year and goal comparisons.

2. **Program Opportunity**
   Connect SUNY Delhi programs to New York occupational demand, projected openings, wages, and typical education requirements.

3. **Market Opportunity**
   Show relevant county and regional demographics, educational attainment, migration, high-school origin, and adult-learner indicators.

4. **Outcomes and Benchmarks**
   Compare enrollment, completion, awards, cost, debt, and earnings with selected peer institutions.

5. **Enrollment Environment**
   Surface a small set of external indicators that can be sent to Research, a campaign, or the AVP Brief through the same “Use This” action.

#### Slate pilot

Start with a manually uploaded aggregate CSV from a saved Slate query. Use counts only—no names, email addresses, student IDs, birth dates, application narratives, or row-level student records.

Do not connect directly to Slate until the aggregate pilot is demonstrably useful and SUNY Delhi has approved credentials, data retention, access controls, and a FERPA review. Slate supports later expansion through exports, scheduled file transfers, web services, and APIs.

#### Public data candidates

- SUNY Open NY: campus enrollment, graduation rates, awards, and first-time undergraduate origins
- SUNY System Administration: Fast Facts, campus fact sheets, transfer flows, GradWages, and institutional research dashboards
- IPEDS: enrollment, completions, graduation, finance, aid, and peer comparison data
- College Scorecard: institution and field-of-study costs, debt, completion, and earnings
- New York State Department of Labor: occupational projections, annual openings, wages, and regional labor-market data
- U.S. Bureau of Labor Statistics: labor force, employment, wage, and industry series
- U.S. Census Bureau and ACS: population, age, attainment, income, migration, and county-level context

**Decision gate:** Validate the questions and the aggregate Slate export before choosing charts, scheduled ingestion, or a direct integration.

## Not Planned

### Event Follow-up Kit

Skipped at the user’s request. Revisit only if event follow-up becomes a repeated workflow.

## Suggested Delivery Order

1. Campaign Preflight
2. Source lanes and the shared “Use This” data handoff
3. Audience Lanes
4. Enrollment Moments
5. AVP Brief
6. Data Command Center aggregate pilot

## Official References

- [SUNY Delhi Newsroom](https://www.delhi.edu/marcomm/newsroom.php)
- [Delaware County notices and press releases](https://www.delcony.gov/posts/notices/)
- [SUNY News](https://www.suny.edu/suny-news/)
- [Slate integrations](https://technolutions.com/integrations)
- [Slate querying and reporting](https://technolutions.com/student-success/querying-reporting)
- [SUNY Open NY enrollment data](https://data.ny.gov/Education/Headcount-Enrollment-by-Student-Level-and-Student-/4fyc-bf8i)
- [SUNY institutional research resources](https://system.suny.edu/institutional-research/resources/)
- [IPEDS data tools](https://nces.ed.gov/ipeds/use-the-data/usethedata)
- [College Scorecard data](https://collegescorecard.ed.gov/data/)
- [New York employment projections](https://dol.ny.gov/employment-projections)
- [BLS public data API](https://www.bls.gov/audience/developers.htm)
- [Census data APIs](https://www.census.gov/data/developers/guidance/api-user-guide.Available_Data.html)
