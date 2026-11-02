# Cloudflare Worker source

This directory contains the Worker source supplied by the project owner, plus a Wrangler configuration and a D1 schema reference.

**This is a source-control copy only. It has not been deployed to Cloudflare.**

## Existing production resources

- Worker: `moscow-opportunities-bot`
- D1 database: `moscow-opportunities-db`
- D1 binding: `DB`
- Telegram channel: `@moscow_opportunities`

## Files

- `src/index.js` — Telegram webhook, RSS collection, moderation commands and scheduled collection. Open-day announcements are classified as events; clearly senior/middle/lead roles and roles explicitly requiring 2+ years of experience are filtered out; approval and publication also re-check older queued items; `/publish` uses an atomic D1 claim to prevent concurrent duplicate sends.
- `schema.sql` — reference D1 schema checked against the existing production application tables and indexes on 2026-11-02. It is not a migration to run against the existing database.
- `wrangler.toml` — Wrangler configuration referencing the existing D1 database ID.

## Configuration

The Worker expects these encrypted secrets in Cloudflare:

- `BOT_TOKEN`
- `WEBHOOK_SECRET`
- `SETUP_SECRET`

It also expects the following variables:

- `CHANNEL_ID`
- `ADMIN_IDS`

Never commit bot tokens or other secrets.

## Safety before deployment

1. The source was supplied by the project owner as a copy of the current Worker editor code; this repository copy has not been independently compared with a fresh Cloudflare export.
2. The D1 application tables and indexes were checked read-only against `schema.sql`; no production database changes were made.
3. Test against a separate staging Worker and staging database before deploying any code.
4. Verify webhook configuration, secrets, and scheduled collection before considering production deployment.

The scheduled handler collects RSS items into the pending queue. Publishing remains a manual admin action using `/approve ID` and `/publish ID`.


## Student-audience filtering

The collector skips clearly experienced vacancies (for example, `#senior`, middle/lead roles, or explicit requirements of two or more years of experience). The approval and publish commands also re-check older queued records so an already-collected senior vacancy cannot slip through. Ambiguous vacancies remain in the manual review queue rather than being automatically discarded.
