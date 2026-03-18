# Hypixel Mayor Discord Bot

A Discord bot that checks the Hypixel SkyBlock election API, pings a configured role for election and mayor changes, and keeps a single status embed updated with the current mayor and active perks.

## Features

- Polls `https://api.hypixel.net/v2/resources/skyblock/election` on a fixed interval.
- Detects the currently active SkyBlock mayor.
- Pings a configured role when the Election Booth opens.
- Pings a configured role when a new mayor becomes active.
- Posts a status embed with the current mayor and perks.
- Edits the existing status embed instead of sending a new one every time.
- Persists booth state and the status message ID in `data/state.json`.

## Setup

1. Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Make sure the bot can send messages in your target channel.
3. Invite the bot to your server.
4. Copy `.env.example` to `.env`.
5. Fill in your real values.

## Configuration

- `DISCORD_TOKEN` - bot token from the Discord Developer Portal
- `DISCORD_CHANNEL_ID` - channel where the bot should post updates
- `DISCORD_ROLE_ID` - role to ping for election and mayor changes
- `CHECK_INTERVAL_MINUTES` - interval for election and mayor checks
- `STATUS_UPDATE_MINUTES` - interval for status embed updates
- `EMOJI_*` - optional custom emojis for mayors, for example `<:diaz:123...>`
- If your server already has emojis named like `diaz`, `cole`, or `mayor_diaz`, the bot can detect them automatically.

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CHANNEL_ID=123456789012345678
DISCORD_ROLE_ID=123456789012345678
CHECK_INTERVAL_MINUTES=5
STATUS_UPDATE_MINUTES=30
EMOJI_DIAZ=<:diaz:123456789012345678>
```

## Run Locally

```bash
npm install
npm start
```

## Docker Compose

```bash
docker compose up -d --build
```

- The bot loads its configuration from `.env`.
- `./data` is mounted to `/app/data` so the stored status message ID and booth state survive restarts.
- View logs with `docker compose logs -f`.
- Stop the bot with `docker compose down`.

## Notes

- This election endpoint currently does not require a Hypixel API key.
- If you want to use other Hypixel endpoints later, you can extend the bot with an API key.
- The bot only needs the `Guilds` intent because it does not read messages.
- For custom emojis, upload them to your Discord server and paste the full emoji tag into `.env`.
- As an alternative, you can simply name your server emojis `diaz`, `cole`, `foxy`, or `mayor_diaz` and the bot will try to resolve them automatically.
