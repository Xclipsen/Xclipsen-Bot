# Hypixel Mayor Discord Bot

A Discord bot that checks the Hypixel SkyBlock election API, pings a configured role for election and mayor changes, and keeps a single status embed updated with the current mayor and active perks.

## Features

- Polls `https://api.hypixel.net/v2/resources/skyblock/election` on a fixed interval.
- Detects the currently active SkyBlock mayor.
- Pings a configured role when the Election Booth opens.
- Pings a configured role when a new mayor becomes active.
- Posts a status embed with the current mayor and perks.
- Replaces the previous ping message whenever a new alert is sent.
- Edits the existing status embed instead of sending a new one every time.
- Includes an in-Discord `/setup` hub with sections for mayor alerts and reaction roles.
- Supports Discord-configurable reaction roles via `/reactionrole`.
- Includes `/cata` and `/catacombs` for a quick dungeon overview lookup.
- Persists booth state and the status message ID in `data/state.json`.
- Stores server configuration in `data/config.json`.

## Setup

1. Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Make sure the bot can send messages in your target channel.
3. Invite the bot to your server.
4. Copy `.env.example` to `.env`.
5. Fill in your token and optional defaults.
6. In Discord, run `/setup`, open `Discord -> Mayor Alerts`, and enter the target channel ID and role ID.
7. Use `Discord -> Reload Status` any time you want to force-refresh the current mayor embed.

## Configuration

- `DISCORD_TOKEN` - bot token from the Discord Developer Portal
- `HYPIXEL_API_KEY` - required for `/cata` and `/catacombs` using the official Hypixel API
- `DISCORD_CHANNEL_ID` - optional legacy default channel for first-time setup
- `DISCORD_ROLE_ID` - optional legacy default role for first-time setup
- `ADMIN_USER_IDS` - optional comma-separated Discord user IDs that can always use admin bot commands
- `CHECK_INTERVAL_MINUTES` - interval for election and mayor checks
- `STATUS_UPDATE_MINUTES` - interval for status embed updates
- `MOCK_MODE` - if `true`, the bot always loads `data/mock-election.json` instead of the live API
- `EMOJI_*` - optional custom emojis for mayors, for example `<:diaz:123...>`
- If your server already has emojis named like `diaz`, `cole`, or `mayor_diaz`, the bot can detect them automatically.
- The bot now needs permission to manage roles if you use reaction roles.

```env
DISCORD_TOKEN=your_discord_bot_token
HYPIXEL_API_KEY=your_hypixel_api_key
DISCORD_CHANNEL_ID=123456789012345678
DISCORD_ROLE_ID=123456789012345678
ADMIN_USER_IDS=885542911511515146
CHECK_INTERVAL_MINUTES=5
STATUS_UPDATE_MINUTES=30
MOCK_MODE=false
EMOJI_DIAZ=<:diaz:123456789012345678>
```

## Run Locally

```bash
npm install
npm start
```

## Project Structure

- `src/index.js` wires the client and events together.
- `src/config/` contains environment loading, slash commands, and interaction IDs.
- `src/features/` contains setup, mayor alerts, access control, and reaction role logic.
- `src/storage/` contains the config/state store helpers.
- `src/utils/` contains shared SkyBlock time formatting helpers.

After the bot is online, run `/setup` in your Discord server and fill in:

- the channel ID where updates should be posted
- the role ID that should be pinged for election and mayor changes

Only members with `Manage Server` or a whitelisted `ADMIN_USER_IDS` entry can use the setup hub.

## Reaction Roles

- Use `/reactionrole add` with a channel, message ID, role, and emoji.
- Or open `/setup -> Discord -> Reaction Roles` and manage bindings from the interactive panel.
- You can optionally set `required_role` so only members with that role can use the reaction to get the target role.
- Use `/reactionrole remove` to delete a binding.
- Use `/reactionrole list` to see all current bindings for the server.
- When someone adds the configured reaction, the bot gives the role.
- When they remove the reaction, the bot removes the role.
- The bot needs `Manage Roles`, and the target role must be lower than the bot's top role.

## Testing Scenarios

- Use `/simulate` to force test states without waiting for the live Hypixel cycle.
- Built-in scenarios:
  - `booth-open`
  - `booth-closed`
  - `mayor-diaz`
  - `mayor-paul`
  - `clear`
- `clear` switches the bot back to the live API.
- Example mock payloads live in `data/mock-scenarios/`.
- If you want the whole bot to stay in local test mode after restart, set `MOCK_MODE=true` and edit `data/mock-election.json`.

## Docker Compose

```bash
docker compose up -d --build
```

- The bot loads its token and optional legacy defaults from `.env`.
- `./data` is mounted to `/app/data` so server config, the stored status message ID, and booth state survive restarts.
- View logs with `docker compose logs -f`.
- Stop the bot with `docker compose down`.

## Notes

- This election endpoint currently does not require a Hypixel API key.
- If you want to use other Hypixel endpoints later, you can extend the bot with an API key.
- The bot only needs the `Guilds` intent because it does not read messages.
- The `/setup` command is registered per server when the bot starts or joins a new guild.
- For custom emojis, upload them to your Discord server and paste the full emoji tag into `.env`.
- As an alternative, you can simply name your server emojis `diaz`, `cole`, `foxy`, or `mayor_diaz` and the bot will try to resolve them automatically.
