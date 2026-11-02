# Cloudflare Worker source

This directory contains the Worker source supplied by the project owner, plus a Wrangler configuration template and D1 schema reference.

**This is a source-control copy only. It has not been deployed to Cloudflare.**

## Existing production resources

- Worker: `moscow-opportunities-bot`
- D1 database: `moscow-opportunities-db`
- D1 binding: `DB`
- Telegram channel: `@moscow_opportunities`

## Files

- `src/index.js` — Telegram webhook, RSS collection, moderation commands and scheduled collection.
- `schema.sql` — reference D1 schema; compare it with the live database before any migration.
- `wrangler.toml` — Wrangler configuration template. The D1 database ID is deliberately a placeholder.

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

1. Compare this source with the currently deployed Worker.
2. Confirm the exact ID and schema of the existing D1 database.
3. Replace the placeholder database ID only after that verification.
4. Test against a separate staging Worker and staging database.
5. Verify webhook configuration and scheduled collection before considering production deployment.

The scheduled handler collects RSS items into the pending queue. Publishing remains a manual admin action using `/approve ID` and `/publish ID`.
