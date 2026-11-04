# Cloudflare Worker

Production Worker: `moscow-opportunities-bot`  
Production D1: `moscow-opportunities-db`  
Bindings: `DB` (D1), `AI` (Cloudflare Workers AI)  
Telegram channel: `@moscow_opportunities`

## AI-only moderation

- Every RSS/Atom item is classified by Cloudflare Workers AI using title, description and source metadata.
- The model decides whether the item is a real opportunity, selects its category, determines Moscow/remote/outside/unknown geography, and identifies explicit closure signals.
- No keyword classifier or human approval is used in the operational collection/publication path.
- Pending legacy records are re-evaluated by AI in batches of 20 per run. If AI is unavailable or returns invalid output, the record remains pending; a new item is skipped. Nothing is approved by a heuristic fallback.
- Before publication, AI checks the item again, the Worker fetches the original page, and AI checks the page text for relevance, geography and closure. Network errors or AI errors prevent publication.
- RSS and page content are untrusted input. The prompt explicitly tells the model not to follow instructions embedded in source content.
- AI decisions are probabilistic, not a guarantee. The original source link is retained.

## Publication limits

- At most one automatic post per collection run and three per UTC day.
- Only records discovered in the last 36 hours are eligible for automatic publication.
- Old approved records are not mass-published.
- There is no manual approve/reject/publish moderation path.
- Atomic publication claims prevent concurrent duplicate sends.

## Runtime

- `src/index.js` — Worker, RSS/Atom ingestion, AI moderation, formatting and Telegram.
- `wrangler.toml` — existing Worker, D1 and Workers AI bindings, hourly Cron.
- `schema.sql` — reference schema only; do not execute against production.
- `test/worker.test.js` — automated tests.

## Secrets

Cloudflare Worker Secrets: `BOT_TOKEN`, `WEBHOOK_SECRET`, `SETUP_SECRET`.  
No external AI API key is required; `env.AI` is provided by the Cloudflare Workers AI binding.

Never commit tokens, secrets, OAuth files or passwords. Do not change webhook secrets or recreate D1 as part of this change.
