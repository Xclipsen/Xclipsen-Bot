# Xclipsen Bot Documentation

## Overview

Xclipsen Bot is a Discord bot centered around Hypixel SkyBlock utilities and guild administration. It combines live mayor tracking, event reminders, player lookup commands, moderation helpers, reaction roles, GitHub mod update tracking, and an optional Minecraft IRC bridge backend in one project.

The bot is designed to be configured primarily through Discord via `/setup`, while a small set of environment variables controls tokens, defaults, and integrations.

## Main Feature Areas

### 1. Mayor Alerts

- Polls the Hypixel SkyBlock election endpoint on a fixed interval.
- Detects the current mayor and election state.
- Posts and maintains a single status embed with the active mayor and perks.
- While Jerry is mayor, adds a `🔄 Perkpocalypse` field with the current rotation mayor, its perks, the next switches and the full order.
- Mayor, minister, candidate and Perkpocalypse names get the mayor's head as application emoji (see [Application Emojis](#application-emojis)).
- Can ping a configured role when the Election Booth opens.
- Can ping a configured role when a new mayor becomes active.

### 2. Event Calendar and Reminders

- Tracks recurring SkyBlock events such as Dark Auction and seasonal events.
- Sends one reminder message when an event becomes active.
- Deletes the reminder again after the event window ends.
- Supports one shared event channel plus per-event ping roles.
- Feeds the same event data into the mayor/status embed calendar view: two compact lines per event (item icon, name and next start or end, then the exact window and its length).
- Reminder pings show the event's item icon in the text and as embed thumbnail; the embed title has no emoji and the message sent to the Minecraft bridge keeps the Unicode emoji.
- `Jerry's Perkpocalypse` (role `Jerry Rotation`) is only shown and pinged during Jerry's term: every 6-hour rotation slot is a separate window, so each switch pings once and names the mayor whose perks are now active. Slots struck out on the wiki are not pinged.

Important: most event windows are currently calculated locally from the SkyBlock calendar model, not fetched from a single official Hypixel events endpoint.

### 3. Player Tools

- `/uuid` for Mojang UUID lookup.
- `/namehistory` for current and previous Minecraft names.
- `/cata` and `/catacombs` (same command) for a dungeon overview via the official Hypixel API.
- `/trophyfishing` for Trophy Fish progress and fish lookup info.
- `/trophyfrogs` for Trophy Frog progress and frog lookup info.
- `/pest` and `/pests` (same command) for the most valuable Garden pest per kill.
- `/setfarmingstats`, `/pestfarmingprofits` and `/lastpestfarmingprofits` for a pest farming profit-per-hour estimate.
- `/season` and `/harvestfeast` for the current Harvest Feast crops.
- `/hideonleaf` for the Hideonleaf leaderboard reported by the Xclipsen mod.
- `/itememoji` for posting mapped SkyBlock item emojis.
- `/gif` for converting an uploaded image or video, or a Twitter/X video, into a GIF.

If a Discord user has a linked Minecraft account, `/uuid`, `/namehistory`, `/cata`, `/catacombs`, `/trophyfishing`, `/trophyfrogs`, and the name-based `/shitter` subcommands use the linked (preferred) username when the player/name argument is omitted.

### 4. Linking and IRC Bridge

- Links live in the Xclipsen mod backend (`MOD_BACKEND_URL`), not in the bot's `data/` files.
- `/link username:<ign>` verifies the account through Hypixel: the `Discord` field in the player's Hypixel social menu must match the Discord username running the command (needs `HYPIXEL_API_KEY`).
- After verification the bot shows a short-lived mod link code; the player finishes the link in Minecraft with `/irc link <code>`.
- Event ping preferences are stored per linked user.
- The optional bridge backend (`IRC_BRIDGE_*`) exposes HTTP endpoints used by the Fabric IRC client mod and relays messages between Discord and Minecraft; linked users can receive event messages through it.

### 5. Mod Update Tracking

- Tracks public GitHub releases for configured repositories.
- Posts updates into a configured Discord channel.
- Can optionally ping a Discord role for new releases.
- Channel, role and repositories are managed under `/setup` → Mod Updates.

### 6. Reaction Roles

- Supports message-based reaction role bindings.
- Can be configured through slash commands or the setup hub.
- Supports optional prerequisite roles.

### 7. Shitter List

- Guild-local watchlist for Minecraft IGNs.
- Stores reasons and up to 5 screenshots per entry.
- Supports add, query, remove, and list flows.
- Includes guild-level permission controls for who may manage entries.

### 8. SkyBlock Weather

- Keeps a pinned Mild/EXTREME reaction-role panel and a live dashboard in one weather channel (default `#skyblock-weather`).
- The dashboard shows the current weather, the next Mild and EXTREME windows and the next four windows.
- An island menu under the dashboard (open to everyone) replies privately with an image of that island's Mild and EXTREME weather tooltips, styled like the in-game tooltip. Images are rendered once per island per process; if rendering fails, the stats are sent as text.
- Pings the matching role when a weather window starts (one short line per island with its weather name) and deletes the ping when it ends.

Important: the schedule is calculated locally, not fetched from Hypixel. Weather is assumed every hour from XX:35 to XX:55, with every 3rd window EXTREME (02:35, 05:35, … 23:35 UTC).

### 9. Mining Events

- Reads the running Dwarven Mines and Crystal Hollows events (Gone with the Wind, 2x Powder, Better Together, Goblin Raid, Mining Raffle, Mithril Gourmand) from Soopy's `chevents` feed.
- Keeps a live dashboard of running events in the mining events channel and pings the per-event role when an event starts; pings are removed when the event ends.
- The dashboard lists the events per island with item icons; pings show the island icon and the event's item icon as thumbnail (Better Together uses the party hat).
- Channel, roles and the role panel are configured under `/setup` → Mining Events.

### 10. Testing and Simulation

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
- Used to configure mayor alerts, event reminders, mining events, SkyBlock weather, mod updates, reaction roles, and shitter permissions.

Example:

```text
/setup
```

### Player Commands

#### `/uuid [player:<ign>]`

Looks up a Minecraft player's UUID using Mojang.

- `player` is optional.
- If `player` is omitted, the bot uses the caller's linked (preferred) Minecraft username when available.
- Returns compact and dashed UUID forms.
- Also shows the UUID percentile/ranking output used by this bot.

Example:

```text
/uuid
/uuid player:Xclipsen
```

#### `/namehistory [player:<ign>]`

Shows the current Minecraft name and known historical names.

- `player` is optional.
- If `player` is omitted, the bot uses the caller's linked (preferred) Minecraft username when available.
- Provide the player's current username. Mojang resolves the account before any cached history is used.
- Uses Laby.net for history, with Crafty.gg as a fallback when the lookup fails. Provider UUIDs must match Mojang.
- History is cached for 24 hours after a successful fetch. Failures preserve existing history and show a cache notice; no cached history produces an explicit unavailable message.
- `approx.` marks uncertain change dates. Hidden entries are omitted, and long histories are shortened with an omitted-name count.
- A valid empty or hidden response does not trigger a fallback or restore names from an older cache.
- Optional `CRAFTY_API_KEY` configures Crafty's Bearer token. Rate-limited providers are paused according to `Retry-After` (60 seconds when absent or invalid).

Example:

```text
/namehistory
/namehistory player:Xclipsen
```

#### `/gif media:<image|video>` or `/gif link:<twitter link>`

Converts an uploaded image or video, or the video of a Twitter/X post, into a GIF.

- Use exactly one of `media` or `link`.
- `media` expects an image or a video attachment (MP4, MOV, WebM, MKV).
- `link` expects a post on twitter.com or x.com (fxtwitter/vxtwitter/fixupx links work too). The bot downloads the post's first video or Twitter GIF with yt-dlp (at most 100 MB); private or age-restricted posts do not work.
- Videos are converted with ffmpeg, cut to the first 30 seconds and shrunk step by step (frame rate, width, colors) until the GIF fits the server's upload limit.

Example:

```text
/gif media:<upload>
/gif link:https://x.com/user/status/123
```

#### `/cata [player:<ign>] [profile:<name>]`

Shows the catacombs overview for a player.

- `player` is optional.
- If `player` is omitted, the bot uses the caller's linked (preferred) Minecraft username when available.
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
- If `player` is omitted, the bot uses the caller's linked (preferred) Minecraft username when available.
- `profile` is optional.
- If `profile` is omitted, the bot uses the currently selected Hypixel SkyBlock profile.
- The response includes a fish selection menu that shows chance, location, and requirement details for each Trophy Fish.

Example:

```text
/trophyfishing
/trophyfishing player:Xclipsen
/trophyfishing player:Xclipsen profile:Cucumber
```

#### `/trophyfrogs [player:<ign>] [profile:<name>]`

Shows a Trophy Frog overview for a player.

- `player` is optional.
- If `player` is omitted, the bot uses the caller's linked (preferred) Minecraft username when available.
- `profile` is optional.
- If `profile` is omitted, the bot uses the currently selected Hypixel SkyBlock profile.
- The response includes a frog selection menu that shows chance, location, requirement, and pity details for each Trophy Frog.
- The official Hypixel API currently exposes total frog catches plus unlocked tiers, but not full per-frog catch totals.

Example:

```text
/trophyfrogs
/trophyfrogs player:Xclipsen
/trophyfrogs player:Xclipsen profile:Cucumber
```

Profile choice for `/cata`, `/trophyfishing` and `/trophyfrogs`: a requested `profile` first, then the profile Hypixel marks as selected, then (only if none is marked) the profile with the most Catacombs XP for `/cata` or the first profile for the trophy commands. Profile data is cached for 60 seconds. The view buttons and info menus carry the player and profile in their IDs, so they keep working after a bot restart; buttons from older bot versions ask you to run the command again.

#### `/pest fortune:<amount> sell_method:<Instasell|Sell Order|NPC Sell>`

Ranks all Garden pests by estimated coins per kill.

- `fortune` (Farming Fortune) and `sell_method` are required.
- `/pests` is the same command under a second name.
- NPC Sell uses the calibrated pest drop formulas; Instasell/Sell Order replace the guaranteed drops with live Bazaar prices (Slug's red and brown enchanted mushrooms count as one pooled drop, i.e. their average).
- Uses the pest shard level saved with `/setfarmingstats` (+2% rare drops per level) and shows whether Finnegan's Pest Eradicator perk is active (as mayor or minister perk).

Example:

```text
/pest fortune:2500 sell_method:NPC Sell
```

#### `/setfarmingstats bonus_pest_chance:<value> pest_shard_level:<0-10> reforge:<Blessed|Bountiful> [cropeetle_level:<0-10>] [rarefinder_level:<0-20>]`

Saves your pest farming stats for the profit calculator (stored per Discord user in `data/state.json`).

- `bonus_pest_chance`, `pest_shard_level` and `reforge` are required and used in the calculation.
- `cropeetle_level` and `rarefinder_level` are optional and only shown back; they are not part of the calculation. Omitting them keeps the saved value.

Example:

```text
/setfarmingstats bonus_pest_chance:497 pest_shard_level:10 reforge:Bountiful
```

#### `/pestfarmingprofits bait:<bait> vinyl:<pest> crop:<crop> fortune:<amount> plots:<1-25> sell_method:<method> [pest_fortune:<amount>]`

Estimates pest farming profit per hour from crops, pests and bait cost, using your saved farming stats, live Bazaar prices and the current mayor.

- `pest_fortune` defaults to `fortune - 300`.
- Saves the setup for `/lastpestfarmingprofits`.

Example:

```text
/pestfarmingprofits bait:Plant Matter (Slug + Locust) vinyl:Slug crop:Wheat fortune:2900 plots:2 sell_method:NPC Sell
```

#### `/lastpestfarmingprofits`

Recalculates your last `/pestfarmingprofits` setup with current prices and mayor state.

#### `/season` and `/harvestfeast`

Show the current Harvest Feast in-season crops (`/season`) plus the SkyBlock month and upcoming rotations (`/harvestfeast`), from the public EliteSkyBlock API.

#### `/hideonleaf`

Shows the Hideonleaf leaderboard (kills, shards, coins, coins per hour) from the stats the Xclipsen mod reports to the mod backend.

### Linking Commands

`/link` is a single command with flat options; use one action per call.

#### `/link`

Without options, shows your link status: linked usernames, link date, enabled event pings and pending usernames.

#### `/link username:<ign>`

Verifies a Minecraft account and issues a mod link code.

- Set the `Discord` field in your Hypixel social menu (Profile → Social Media → Discord) to your current Discord username first.
- The bot checks that field through the Hypixel API (`HYPIXEL_API_KEY` required) and replies with a short-lived code.
- Run `/irc link <code>` in Minecraft before the code expires.
- Links made with the old code-only flow must be re-verified this way.

#### `/link remove:<ign>`

Removes one Minecraft username from your link.

#### `/link event:<event> enabled:<true|false>`

Enables or disables one event ping for your linked Minecraft client. Both options are required; the choices are the event reminder keys.

#### `/link unlink:true`

Deletes your backend link and all linked Minecraft usernames.

Example:

```text
/link username:Xclipsen
/link event:darkAuction enabled:false
/link unlink:true
```

### Moderation Commands

#### `/shitter add [name:<ign>] reason:<text> [screenshot...]`

Adds or updates a shitter list entry.

- `name` is optional.
- If `name` is omitted, the bot uses the caller's linked (preferred) Minecraft username when available.
- `reason` is required.
- Up to 5 screenshot attachments may be included.

Example:

```text
/shitter add reason:Scam evidence
/shitter add name:Example reason:Scam evidence
```

#### `/shitter query [name:<ign>]`

Checks whether an IGN is currently listed.

- `name` is optional.
- If `name` is omitted, the bot uses the caller's linked (preferred) Minecraft username when available.

Example:

```text
/shitter query
/shitter query name:Example
```

#### `/shitter remove [name:<ign>]`

Marks active entries for an IGN as removed while preserving history.

- `name` is optional.
- If `name` is omitted, the bot uses the caller's linked (preferred) Minecraft username when available.

Example:

```text
/shitter remove
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

#### `/test miningevent event:<event>`

Sends one mining event test ping to the configured mining events channel.

- `event` is required.

Example:

```text
/test miningevent event:raffle
```

#### `/test weather tier:<Mild|EXTREME>`

Sends one test weather ping to the configured weather channel.

- `tier` is required.

Example:

```text
/test weather tier:EXTREME
```

## Setup Flow

### Environment Setup

1. Copy `.env.example` to `.env`.
2. Set `DISCORD_TOKEN`.
3. Set optional integrations such as `HYPIXEL_API_KEY`, `GITHUB_TOKEN`, and IRC bridge values.
4. Start the bot with `npm start` or Docker Compose.

### Discord Setup

After the bot joins a server, run `/setup`. The admin overview has one button per section; each section has channel/role selectors, **Create new channel**, **Rebuild posts** (where the section owns bot posts), **Reset section** and a way back to the overview. Members with `Manage Server`, users in `ADMIN_USER_IDS` and delegated bot managers can use it; access grants and reaction-role bindings stay restricted to the first two.

## Setup Hub Sections

### Event Calendar

- Calendar / mayor channel (shared with Mayor Alerts)
- One ping role per event, plus **Auto-create event roles**
- The event role panel is pinned above the tracked status posts

### Mayor Alerts

- Calendar / mayor channel and mayor ping role
- **Booth ping** and **Mayor ping** toggles
- **Rebuild posts** re-creates the role panel and the mayor status post

### Mining Events

- Event channel and one ping role per mining event and island, plus **Auto-create event roles**
- Role panel and live dashboard

### SkyBlock Weather

- Weather channel: choose one or use Create new channel (placed in the category of the other bot channels)
- Mild and EXTREME ping roles, reused by name or created automatically when missing
- Rebuild posts for the pinned role panel and live dashboard
- Reset clears the settings and bot posts but keeps Discord channels and roles

One-time provisioning without the setup UI: stop the bot, then run `node scripts/setup-weather.js <guildId> [--category <name>]`. The bot must be stopped because both processes write `data/config.json`.

### Mod Updates

- Release channel and optional ping role
- **Add repositories**, **Remove repositories** and **View all** for the tracked GitHub repositories
- **Rebuild posts** re-sends the release status message

### Reaction Roles

- Browse, add and remove bindings; create a new panel or bind to an existing message by link

### Shitter List

- Allowed roles, blocked roles and blocked users for adding/removing entries

### Bot Access

- Delegated bot manager users and roles

## Environment Variables

The full list is in `src/config/env.js`; `.env.example` contains a template.

### Required

- `DISCORD_TOKEN`

### Optional Integrations

- `HYPIXEL_API_KEY`: required for `/cata`, `/catacombs`, `/trophyfishing`, `/trophyfrogs` and `/link username:` (the election and Bazaar endpoints work without it)
- `GITHUB_TOKEN`: improves GitHub release rate limits
- `MOD_BACKEND_URL`: Xclipsen mod backend (links, `/hideonleaf` stats), default `https://api.xclipsen.de`
- `MOD_BACKEND_AUTH_TOKEN`: token for the mod backend, falls back to `IRC_BRIDGE_AUTH_TOKEN`
- `CRAFTY_API_KEY`: optional Bearer token for the Crafty.gg name history fallback
- `MAGICK_PATH`: ImageMagick binary for image uploads to `/gif`, default `magick` (the Docker image installs ImageMagick)
- `IRC_BRIDGE_ENABLED`, `IRC_BRIDGE_HOST`, `IRC_BRIDGE_PORT`, `IRC_BRIDGE_AUTH_TOKEN` (the bridge stays off without a real token), `IRC_BRIDGE_CHANNEL_ID` (falls back to `DISCORD_CHANNEL_ID`), `IRC_BRIDGE_MAX_BUFFERED_MESSAGES`

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

The HTTP `User-Agent` (`env.USER_AGENT`) and the data file paths are fixed in `src/config/env.js`, not read from the environment.

## Application Emojis

Event item icons and mayor heads are uploaded as Discord application emojis from `assets/app-emojis/` (`manifest.json`). `src/utils/appEmojis.js` fetches the application's emojis when the bot is ready, uploads only missing manifest entries and never deletes others; the first scheduled checks wait at most a minute for it. Until then, or if fetching or uploading fails (logged once), every lookup returns the Unicode fallback. Custom emojis are only used in message content, embed descriptions, field values, select-option emojis and reactions, where Discord renders them. Role panels (events incl. the Mayor Alerts role, mining, weather) react with the icons; `ensurePanels` on start rebuilds a panel whose stored bindings still use other emojis, but only when every icon of that panel is loaded, so a failed upload never switches a panel back to Unicode. Credits and how to add an icon: `assets/app-emojis/README.md`.

## Data Storage

The bot persists data in the local `data/` directory:

- `data/config.json`: per-guild configuration
- `data/state.json`: runtime state such as status message IDs and event reminder message IDs
- `data/shitter-list.json`: guild-local shitter list entries
- `data/mock-election.json`: local mock data for simulation mode
- `data/namehistory-cache.json`: cached name histories (`NAMEHISTORY_CACHE_FILE_PATH`)

Minecraft links and Hideonleaf stats are stored in the mod backend, not in `data/`.

`.env` is intentionally local-only and should not be committed.

## Runtime Architecture

### Main Entry Point

- `src/index.js` creates the Discord client, wires features together, registers commands, and starts recurring checks.

### Config

- `src/config/` holds command definitions, environment loading, help content, interaction IDs, and the pure event/mining/weather definitions (`eventDefinitions.js`, `miningEventDefinitions.js`, `weatherDefinitions.js`) that both the features and the store use.

### Features

- `src/features/mayorAlerts/`: mayor polling, alerting, status rendering
- `src/features/jerryRotation.js`: Jerry's Perkpocalypse rotation from the wiki
- `src/features/eventReminders.js`: event reminder sending and cleanup
- `src/features/eventCalendar.js`: event schedules built from `src/config/eventDefinitions.js`
- `src/features/harvestFeast.js`: `/season`, `/harvestfeast` and the Feast crop data for reminders
- `src/features/miningEvents.js`: mining event pings and dashboard
- `src/features/weather.js`: SkyBlock weather pings, dashboard, island tooltip menu and role panel
- `src/features/modUpdates.js`: GitHub release tracking
- `src/features/reactionRoles.js`: reaction role runtime
- `src/features/setupHub/`: interactive Discord setup UI (overview, section editor, reaction role editor, role panels)
- `src/features/linking.js`, `linkedMinecraftUser.js`: `/link` and the linked-username fallback
- `src/features/minecraft/ircBridge.js`: HTTP bridge backend for the Minecraft mod
- `src/features/catacombs.js`, `trophyFishing.js`: Hypixel profile lookups
- `src/features/bestPest.js`, `pestFarmingProfit.js`: `/pest` and the pest farming calculator (one shared pest valuation)
- `src/features/playerUuid.js`, `nameHistory.js`, `itemEmoji.js`, `gif.js`, `hideonleaf.js`: other player commands
- `src/features/shitterList.js`, `accessControl.js`: moderation/watchlist logic and access checks
- `src/features/help.js`, `pagedLists.js`, `simulation.js`: `/help`, paged list views, `/simulate`

### Persistence

- `src/storage/store.js` normalizes, reads, and writes guild config and runtime state.

### Shared Utilities

- `src/utils/` contains Mojang helpers, the mod backend client (`modBackend.js`), emoji utilities, image helpers, and SkyBlock time helpers (`skyblockTime.js`: calendar constants, year math and the island weather windows shared by the calendar and the weather feature).
- `src/utils/hypixelApi.js` is the one place that calls the Hypixel SkyBlock API: Bazaar, election and profiles with a shared 60-second cache (the mayor checker always fetches fresh election data and refreshes that cache), plus the shared profile selection.

## External Services and APIs

- Discord API via `discord.js`
- Hypixel API for mayor data, Bazaar prices, SkyBlock profiles and `/link` verification
- Soopy `chevents` feed for mining events, EliteSkyBlock for Harvest Feast crops, the Hypixel SkyBlock wiki for Jerry's rotation
- Xclipsen mod backend for links and Hideonleaf stats
- Mojang API for UUID/profile lookup
- GitHub releases API for mod update tracking
- Laby.net name history with Crafty.gg API fallback
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

The image contains `test/` and `scripts/`, so `npm run check` and the scripts can run inside the container. `docs/`, root Markdown files and `.env.example` are not copied into the image. `docker-compose.yml` publishes the IRC bridge port (`8767` on the host to `8765` in the container) for the Minecraft mod.

### Tests

```bash
DISCORD_TOKEN=test-token npm run check
```

`npm run check` syntax-checks every file in `src/`, `scripts/` and `test/` and runs `node --test` on `test/*.test.js`. The tests use fake Discord objects and fixed API fixtures (no network). `test/helpers.js` provides a store on temporary files; `test/fixtures/` holds recorded outputs of the pest and SkyBlock profile commands.

## Operational Notes

- Slash commands are registered per guild on startup and when the bot joins a new guild.
- Restart the bot after changing `.env` or command definitions.
- The event calendar is partly based on local schedule calculation, so future maintenance may be needed if Hypixel changes event timing.
- The SkyBlock weather schedule is also calculated locally (XX:35–XX:55, EXTREME at 02:35, 05:35, … 23:35 UTC); verify it in-game after Hypixel updates.
- The Jerry Perkpocalypse order comes from the community wiki (`Candidate_Jerry/Perkpocalypse/Year_<year>`), not from Hypixel. It is retried every 15 minutes while missing, re-read every 6 hours and persisted in `data/state.json`. The rotation perk texts in `src/features/jerryRotation.js` are hardcoded (checked 2026-10-21).
- If `HYPIXEL_API_KEY` is missing, `/cata`, the trophy commands and `/link username:` fail, but mayor polling, `/pest` and the farming calculator still work.
- The project may contain user-local data and secrets in `.env` and `data/`; treat those files carefully.

## Suggested Maintenance Tasks

- Rotate API tokens if they were ever exposed.
- Keep tracked GitHub repositories current.
- Review role IDs and channel IDs after major server changes.
- Periodically validate that calculated event timings still match live SkyBlock behavior.
