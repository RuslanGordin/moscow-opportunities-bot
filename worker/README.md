# Cloudflare Worker

Production Worker: `moscow-opportunities-bot`  
Production D1: `moscow-opportunities-db`  
D1 binding: `DB`  
Telegram channel: `@moscow_opportunities`

## Files

- `src/index.js` — webhook, RSS/Atom ingestion, deterministic selection, editorial formatting and publication.
- `wrangler.toml` — existing Worker, D1 binding, environment variables and hourly Cron.
- `schema.sql` — reference schema only; do not execute against production.
- `test/worker.test.js` — automated tests.

## Selection policy

- Categories include work, IT, design, marketing, sales, internships, education, events, grants, business/projects, volunteering, rights/benefits, city initiatives and technology.
- Technical job families (including MLOps/DataOps, product/data analysts, QA and network engineering) are classified as IT before generic manager/specialist rules.
- Seniority is descriptive metadata, not an exclusion rule.
- Moscow/Moscow region opportunities are retained.
- A generic "можно удалённо" label does not override an explicit non-Moscow city. For a city-specific listing to be accepted as remote, the source must indicate unrestricted geography (for example, any region / anywhere in Russia).
- Unknown geography is rejected, except for the existing HSE announcement feed fallback.
- Freshness thresholds remain 35 days for jobs/internships, 45 days for events, and 60 days for education/grants.
- URL tracking parameters are removed and unique URLs are deduplicated.
- Legacy pending rows are processed in bounded pages; each D1 batch contains at most 50 statements, each with only three bound parameters.
- Scheduled failures are logged. `/collect` reports source errors and triage totals.

## Editorial output

Post formatting may expose facts present in the RSS title/summary: category, geography, experience level, salary and work format. Missing facts are omitted; the bot must not invent salary, benefits, company details or eligibility.

The bot does not currently fetch every original vacancy page to verify that a listing remains open. It cannot guarantee availability from RSS dates alone. Full-page validation / AI enrichment is a separate future capability and must fail closed when evidence is missing.

## Publication safety

- Collection/selection automatically approves suitable records; it does not publish to Telegram.
- `/publish ID` remains an explicit admin action.
- Atomic publication claims prevent concurrent duplicate sends.
- Do not change secrets, webhook, D1 schema, Worker settings or production resources as part of code-only work.
- Do not execute `schema.sql` on the existing production database.
