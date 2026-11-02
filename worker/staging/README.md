# Cloudflare Worker staging environment

This directory contains configuration for an isolated staging Worker.

## Safety

- Worker name: `moscow-opportunities-bot-staging`
- D1 database name: `moscow-opportunities-staging`
- Do not reuse the production D1 database ID, bot token, webhook secret, setup secret, or Telegram channel.
- Create a separate Telegram bot and a private test channel.
- This configuration intentionally contains a placeholder D1 database ID and placeholder channel until staging resources are created.
- No deployment is performed by this repository configuration.

## Setup

1. Create a new D1 database named `moscow-opportunities-staging` in Cloudflare.
2. Copy its database ID into `wrangler.toml`, replacing the placeholder.
3. Create a separate Telegram bot with BotFather and add it as an administrator to a private test channel.
4. Replace the channel placeholder in `wrangler.toml` with the test channel username or ID.
5. Set staging-only encrypted secrets: `BOT_TOKEN`, `WEBHOOK_SECRET`, and `SETUP_SECRET`.
6. Apply `../schema.sql` to the new staging database only.
7. Deploy using this directory's Wrangler configuration only after checking the account and resource names.

Do not run staging setup commands from the production Worker directory or with production credentials.
