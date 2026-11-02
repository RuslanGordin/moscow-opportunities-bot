# Cloudflare Worker migration copy

Reconstructed, version-controlled implementation for the existing moscow-opportunities-bot.

**Not deployed. Do not connect to production until compared with the live Worker and existing D1 binding verified.**

- src/index.js: Telegram webhook, RSS collection, moderation, scheduled collection.
- schema.sql: reference schema for D1.
- wrangler.toml: config template; database ID is intentionally a placeholder.

Existing resources:
- Worker: moscow-opportunities-bot
- D1: moscow-opportunities-db
- Binding: DB
- Channel: @moscow_opportunities

Encrypted secrets required in Cloudflare: BOT_TOKEN, WEBHOOK_SECRET, SETUP_SECRET.
Variables: CHANNEL_ID, ADMIN_IDS.

Known behavior preserved: /myid, /start, /help, /collect, /queue, /approve, /reject, /publish, /feeds, /addfeed, /stats; /health, authenticated /setup, /telegram webhook, hourly scheduled collection.

Improvements: event/open-day classification takes priority over IT keywords; exact repeated titles from the last 45 days are skipped; items are never auto-published and remain pending for manual approval.

Before deployment: compare live source, confirm exact D1 schema and database ID, test in staging, then configure the production build.
