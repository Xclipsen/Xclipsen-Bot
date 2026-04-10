# Xclipsen Bot Documentation

## Overview

Xclipsen Bot is a Discord bot centered around Hypixel SkyBlock utilities and guild administration. It combines live mayor tracking, event reminders, player lookup commands, moderation helpers, reaction roles, GitHub mod update tracking, and an optional Minecraft IRC bridge backend in one project.

The bot is designed to be configured primarily through Discord via `/setup`, while a small set of environment variables controls tokens, defaults, and integrations.

## Main Feature Areas

### 1. Mayor Alerts

- Polls the Hypixel SkyBlock election endpoint on a fixed interval.
- Detects the current mayor and election state.
- Posts and maintains a single status embed with the active mayor and perks.
- Can ping a configured role when the Election Booth opens.
- Can ping a configured role when a new mayor becomes active.

### 2. Event Calendar and Reminders

- Tracks recurring SkyBlock events such as Dark Auction and seasonal events.
- Sends one reminder message when an event becomes active.
- Deletes the reminder again after the event window ends.
- Supports one shared event channel plus per-event ping roles.
- Feeds the same event data into the mayor/status embed calendar view.

Important: most event windows are currently calculated locally from the SkyBlock calendar model, not fetched from a single official Hypixel events endpoint.

### 3. Player Tools

- `/uuid` for Mojang UUID lookup.
- `/namehistory` for current and previous Minecraft names.
- `/cata` and `/catacombs` for dungeon overview via the official Hypixel API.
- `/trophyfishing` for Trophy Fish progress and fish lookup info.
- `/itememoji` for posting mapped SkyBlock item emojis.
- `/gif` for converting an uploaded image into a GIF.

If a Discord user has linked a Minecraft account, `/cata` and `/catacombs` can use the linked username automatically when no `player` argument is provided.

### 4. Linking and IRC Bridge

- Users can link one or more Minecraft usernames to their Discord account.
- The linking flow starts in Discord and is completed in Minecraft with a short-lived code.
- Event preferences can be stored per linked user.
- The optional bridge backend exposes HTTP endpoints used by the Fabric IRC client mod.
- Linked users can receive event messages through the bridge.

### 5. Mod Update Tracking

- Tracks public GitHub releases for configured repositories.
- Posts updates into a configured Discord channel.
- Can optionally ping a Discord role for new releases.
- Includes setup and refresh actions in the Discord setup hub.

### 6. Reaction Roles

- Supports message-based reaction role bindings.
- Can be configured through slash commands or the setup hub.
- Supports optional prerequisite roles.

### 7. Shitter List

- Guild-local watchlist for Minecraft IGNs.
- Stores reasons and up to 5 screenshots per entry.
- Supports add, query, remove, and list flows.
- Includes guild-level permission controls for who may manage entries.

### 8. Testing and Simulation

- `/simulate custom` creates local election test states.
- `/simulate clear` switches back to live API data.
- `MOCK_MODE=true` forces startup in mock-election mode.

## Commands

This section describes the bot commands in more detail, including what each command does and which options it accepts.

### General Commands

#### `/help [section]`

Shows the in-Discord command guide.

- `section` is optional.
- Valid sections are the grouped help categories such as `getting-started`, `player-tools`, `moderation`, and `admin-tools`.

Example:

```text
/help section:player-tools
```

#### `/setup`

Opens the interactive setup hub for the current server.

- Intended for server administrators or users who pass the bot's setup access checks.
- Used to configure mayor alerts, event reminders, mod updates, reaction roles, and shitter permissions.

Example:

```text
/setup
```

### Player Commands

#### `/uuid player:<ign>`

Looks up a Minecraft player's UUID using Mojang.

- `player` is required.
- Returns compact and dashed UUID forms.
- Also shows the UUID percentile/ranking output used by this bot.

Example:

```text
/uuid player:Xclipsen
```

#### `/namehistory player:<ign>`

Shows the current Minecraft name and known historical names.

- `player` is required.
- Uses Mojang for the current account and NameMC scraping for history.

Example:

```text
/namehistory player:Xclipsen
```

#### `/gif media:<image>`

Converts an uploaded image into a GIF.

- `media` is required.
- Expects an image attachment.

Example:

```text
/gif media:<upload>
```

#### `/cata [player:<ign>] [profile:<name>]`

Shows the catacombs overview for a player.

- `player` is optional.
- If `player` is omitted, the bot uses the caller's linked Minecraft username when available.
- `profile` is optional.
- If `profile` is omitted, the bot uses the currently selected Hypixel SkyBlock profile.
- Includes `Basic Info` and `Boss Collections` view buttons in the response.

Example:

```text
/cata
/cata player:Xclipsen
/cata player:Xclipsen profile:Cucumber
```

#### `/catacombs [player:<ign>] [profile:<name>]`

Alias of `/cata`.

- Supports the same options and behavior as `/cata`.

Example:

```text
/catacombs player:Xclipsen profile:Cucumber
```

#### `/itememoji item:<skyblock_id> [enchanted:true|false]`

Posts a SkyBlock item emoji image into the current channel.

- `item` is required.
- The option supports autocomplete suggestions.
- `enchanted` is optional and requests the enchanted variant when available.
- If an exact match is not found, the bot suggests similar item IDs.

Example:

```text
/itememoji item:HYPERION enchanted:true
```

#### `/trophyfishing [player:<ign>] [profile:<name>]`

Shows a Trophy Fish overview for a player.

- `player` is optional.
- If `player` is omitted, the bot uses the caller's linked Minecraft username when available.
- `profile` is optional.
- If `profile` is omitted, the bot uses the currently selected Hypixel SkyBlock profile.
- The response includes a fish selection menu that shows chance, location, and requirement details for each Trophy Fish.

Example:

```text
/trophyfishing
/trophyfishing player:Xclipsen
/trophyfishing player:Xclipsen profile:Cucumber
```

### Linking Commands

#### `/link start usernames:<name1,name2>`

Starts the Discord-to-Minecraft link flow.

- `usernames` is required.
- Accepts one or more comma-separated Minecraft usernames.
- Returns a temporary link code to complete in Minecraft.

Example:

```text
/link start usernames:Xclipsen,AltName
```

#### `/link status`

Shows the current link state for the caller.

- Displays linked usernames, link date, enabled event pings, and pending link code information if present.

Example:

```text
/link status
```

#### `/link add usernames:<name1,name2>`

Adds more Minecraft usernames to an existing link.

- `usernames` is required.
- The caller must already be linked.

Example:

```text
/link add usernames:AltName,IronmanAlt
```

#### `/link remove username:<name>`

Removes one linked Minecraft username from the caller's account.

- `username` is required.

Example:

```text
/link remove username:AltName
```

#### `/link event event:<event> enabled:<true|false>`

Enables or disables one backend event ping for the linked Minecraft account.

- `event` is required.
- `enabled` is required.
- Valid event choices come from the bot's tracked SkyBlock event reminder keys.

Example:

```text
/link event event:darkAuction enabled:false
```

#### `/unlink`

Deletes the caller's full backend link and all linked Minecraft usernames.

Example:

```text
/unlink
```

### Moderation Commands

#### `/shitter add name:<ign> reason:<text> [screenshot...]`

Adds or updates a shitter list entry.

- `name` is required.
- `reason` is required.
- Up to 5 screenshot attachments may be included.

Example:

```text
/shitter add name:Example reason:Scam evidence
```

#### `/shitter query name:<ign>`

Checks whether an IGN is currently listed.

- `name` is required.

Example:

```text
/shitter query name:Example
```

#### `/shitter remove name:<ign>`

Marks active entries for an IGN as removed while preserving history.

- `name` is required.

Example:

```text
/shitter remove name:Example
```

#### `/shitter list`

Lists unique shitter names for the current guild and opens the follow-up selection flow.

Example:

```text
/shitter list
```

### Reaction Role Commands

#### `/reactionrole add channel:<channel> message_id:<id> role:<role> emoji:<emoji> [required_role:<role>]`

Adds a reaction role binding to a message.

- `channel`, `message_id`, `role`, and `emoji` are required.
- `required_role` is optional.

Example:

```text
/reactionrole add channel:#roles message_id:123 role:@Member emoji:✅
```

#### `/reactionrole remove channel:<channel> message_id:<id> emoji:<emoji>`

Removes one reaction role binding from a message.

- `channel`, `message_id`, and `emoji` are required.

Example:

```text
/reactionrole remove channel:#roles message_id:123 emoji:✅
```

#### `/reactionrole list`

Lists all configured reaction role bindings for the current guild.

Example:

```text
/reactionrole list
```

#### `/reactionrole purge [channel:<channel>] [message_id:<id>]`

Deletes reaction role bindings in bulk.

- With no options, purges all bindings in the current guild.
- With `channel`, scopes the purge to one channel.
- With both `channel` and `message_id`, scopes the purge to one message.

Example:

```text
/reactionrole purge channel:#roles message_id:123
```

### Admin and Testing Commands

#### `/simulate custom mayor:<key> perk_count:<1-5> [booth_open:true|false]`

Creates a local simulated election state.

- `mayor` is required.
- `perk_count` is required.
- `booth_open` is optional.

Example:

```text
/simulate custom mayor:diaz perk_count:3 booth_open:true
```

#### `/simulate clear`

Clears the current simulated election state and returns the bot to live data.

Example:

```text
/simulate clear
```

#### `/test event event:<key>`

Sends a test reminder for one configured event through Discord and the IRC bridge.

- `event` is required.

Example:

```text
/test event event:darkAuction
```

## Setup Flow

### Environment Setup

1. Copy `.env.example` to `.env`.
2. Set `DISCORD_TOKEN`.
3. Set optional integrations such as `HYPIXEL_API_KEY`, `GITHUB_TOKEN`, and IRC bridge values.
4. Start the bot with `npm start` or Docker Compose.

### Discord Setup

After the bot joins a server:

1. Run `/setup`.
2. Open `Discord`.
3. Configure the feature sections you need:
   - Mayor Alerts
   - Event Calendar
   - Mod Updates
   - Reaction Roles
   - Shitter List

## Setup Hub Sections

### Mayor Alerts

- Main update channel
- Main ping role
- Election booth ping toggle
- Mayor change ping toggle
- Manual status refresh

### Event Calendar

- Shared reminder channel
- Role-message channel
- Per-event role mapping
- Quick setup for creating missing event roles
- Rebuild of the event reaction-role panel

### Mod Updates

- Release channel
- Optional ping role
- Tracked repositories list
- Manual refresh and test actions

### Reaction Roles

- Add bindings
- Remove bindings
- Purge bindings globally or by scope
- List current bindings

### Shitter List

- Blocked Discord user IDs
- Blocked role IDs
- Allowed role IDs for managing entries

## Environment Variables

### Required

- `DISCORD_TOKEN`

### Optional Integrations

- `HYPIXEL_API_KEY`: required for `/cata` and `/catacombs`
- `GITHUB_TOKEN`: improves GitHub release rate limits
- `IRC_BRIDGE_ENABLED`
- `IRC_BRIDGE_HOST`
- `IRC_BRIDGE_PORT`
- `IRC_BRIDGE_AUTH_TOKEN`
- `IRC_BRIDGE_CHANNEL_ID`
- `IRC_BRIDGE_MAX_BUFFERED_MESSAGES`

### Optional Defaults

- `DISCORD_CHANNEL_ID`
- `DISCORD_ROLE_ID`
- `ADMIN_USER_IDS`

### Polling and Runtime

- `CHECK_INTERVAL_MINUTES`
- `MOD_UPDATE_CHECK_MINUTES`
- `STATUS_UPDATE_MINUTES`
- `MOCK_MODE`

### Emoji and Item Emoji Overrides

- `EMOJI_*`
- `VOTE_BAR_FILLED_EMOJI`
- `VOTE_BAR_EMPTY_EMOJI`
- `SKYBLOCK_ITEM_EMOJIS_ENABLED`
- `SKYBLOCK_ITEM_EMOJI_HASH_URL`
- `SKYBLOCK_ITEM_EMOJI_DATA_URL`

## Data Storage

The bot persists data in the local `data/` directory:

- `data/config.json`: per-guild configuration
- `data/state.json`: runtime state such as status message IDs and event reminder message IDs
- `data/shitter-list.json`: guild-local shitter list entries
- `data/mock-election.json`: local mock data for simulation mode

`.env` is intentionally local-only and should not be committed.

## Runtime Architecture

### Main Entry Point

- `src/index.js` creates the Discord client, wires features together, registers commands, and starts recurring checks.

### Config

- `src/config/` holds command definitions, environment loading, help content, and interaction IDs.

### Features

- `src/features/mayorAlerts/`: mayor polling, alerting, status rendering
- `src/features/eventReminders.js`: event reminder sending and cleanup
- `src/features/eventCalendar.js`: recurring SkyBlock event scheduling model
- `src/features/modUpdates.js`: GitHub release tracking
- `src/features/reactionRoles.js`: reaction role runtime
- `src/features/setupHub/`: interactive Discord setup UI
- `src/features/linking.js`: Discord-side link management
- `src/features/minecraft/`: bridge backend and Minecraft-side integrations
- `src/features/catacombs.js`, `playerUuid.js`, `nameHistory.js`, `itemEmoji.js`, `gif.js`: player utility commands
- `src/features/shitterList.js`: moderation/watchlist logic

### Persistence

- `src/storage/store.js` normalizes, reads, and writes guild config and runtime state.

### Shared Utilities

- `src/utils/` contains Mojang/Hypixel helpers, emoji utilities, image helpers, and SkyBlock time helpers.

## External Services and APIs

- Discord API via `discord.js`
- Hypixel API for mayor data and catacombs profile lookups
- Mojang API for UUID/profile lookup
- GitHub releases API for mod update tracking
- NameMC scraping for name history
- Altpapier SkyBlock Item Emojis dataset for item emoji lookup

## Permissions and Intents

The bot uses these Discord intents:

- `Guilds`
- `GuildMembers`
- `GuildMessages`
- `GuildMessageReactions`
- `MessageContent`

Depending on enabled features, the bot may also need these guild permissions:

- Send Messages
- Embed Links
- Manage Messages
- Manage Roles
- Read Message History
- Add Reactions

## Running the Bot

### Local

```bash
npm install
npm start
```

### Docker

```bash
docker compose up -d --build
```

Useful commands:

- `docker compose logs -f`
- `docker compose down`

## Operational Notes

- Slash commands are registered per guild on startup and when the bot joins a new guild.
- Restart the bot after changing `.env` or command definitions.
- The event calendar is partly based on local schedule calculation, so future maintenance may be needed if Hypixel changes event timing.
- If `HYPIXEL_API_KEY` is missing, catacombs lookups will fail but mayor polling can still work.
- The project may contain user-local data and secrets in `.env` and `data/`; treat those files carefully.

## Suggested Maintenance Tasks

- Rotate API tokens if they were ever exposed.
- Keep tracked GitHub repositories current.
- Review role IDs and channel IDs after major server changes.
- Periodically validate that calculated event timings still match live SkyBlock behavior.
