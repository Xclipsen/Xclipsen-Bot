# Hypixel Mayor Discord Bot

A Discord bot that checks the Hypixel SkyBlock election API, pings a configured role for election and mayor changes, and keeps a single status embed updated with the current mayor and active perks.

Detailed project documentation lives in `docs/BOT_DOCUMENTATION.md`.

## Features

- Polls `https://api.hypixel.net/v2/resources/skyblock/election` on a fixed interval.
- Detects the currently active SkyBlock mayor.
- Can ping a configured role when the Election Booth opens.
- Can ping a configured role when a new mayor becomes active.
- Posts a status embed with the current mayor and perks.
- While Jerry is mayor, shows the current Perkpocalypse rotation mayor, its perks and the next switches in the status embed and event calendar, and pings the optional `Jerry Rotation` role at each 6-hour switch.
- Replaces the previous ping message whenever a new alert is sent.
- Edits the existing status embed instead of sending a new one every time.
- Includes an in-Discord `/setup` hub with sections for the event calendar, mayor alerts, mining events, SkyBlock weather, mod update tracking with optional role pings, reaction roles, shitter permissions, and bot access.
- Sends event calendar reminders (Dark Auction, seasonal events, Feasts) with per-event ping roles.
- Pings mining event roles (Dwarven Mines and Crystal Hollows, from Soopy's `chevents` feed) and keeps a live mining event dashboard.
- Pings Mild and EXTREME SkyBlock weather roles and keeps a live weather dashboard in `#skyblock-weather`.
- Supports Discord-configurable reaction roles via `/reactionrole`.
- Includes `/help` for a grouped command overview with examples.
- Includes `/cata` (also available as `/catacombs`) for a quick dungeon overview lookup, with linked-account fallback when no player is provided.
- Includes `/trophyfishing` for a Trophy Fish overview with per-fish info about location and catch chance, with linked-account fallback when no player is provided.
- Includes `/trophyfrogs` for a Trophy Frog overview with unlocked-tier progress and per-frog requirement info, with linked-account fallback when no player is provided.
- Includes `/pest` (also available as `/pests`) to rank Garden pests by coins per kill with NPC or live Bazaar prices.
- Includes `/setfarmingstats`, `/pestfarmingprofits`, and `/lastpestfarmingprofits` for a pest farming profit-per-hour calculator.
- Includes `/season` and `/harvestfeast` for the current Harvest Feast crops.
- Includes `/hideonleaf` for the Hideonleaf leaderboard reported by the Xclipsen mod.
- Includes `/itememoji` to post SkyBlock item emojis from Altpapier's emoji dataset.
- Includes `/uuid` to fetch a player's Minecraft UUID from their IGN, with linked-account fallback when no player is provided.
- Includes `/namehistory` to show a player's known Minecraft name history, with linked-account fallback when no player is provided.
- Includes `/link` to verify Minecraft usernames through the Hypixel Discord social link and manage event pings for the Minecraft mod.
- Includes `/gif` to convert an uploaded image into a GIF.
- Includes `/tts` to read messages aloud in a voice channel with a local text-to-speech service (no cloud API).
- Includes `/music` to play YouTube videos and lofi / chill radio stations in a voice channel, controlled from a `#voice` channel with a live control panel.
- Includes `/shitter add`, `/shitter query`, `/shitter remove`, and `/shitter list` for a guild-local IGN watchlist with reasons and optional screenshots, with linked-account fallback when no IGN is provided.
- Persists booth state, tracked message IDs, and per-user farming stats in `data/state.json`.
- Stores server configuration in `data/config.json`.
- Stores shitter list entries in `data/shitter-list.json`.
- Can optionally expose a built-in HTTP IRC bridge server for the Fabric client mod.

## Setup

1. Create a bot in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Make sure the bot can send messages in your target channel.
3. Invite the bot to your server.
4. Copy `.env.example` to `.env`.
5. Fill in your token and optional defaults.
6. In Discord, run `/setup`, open **Mayor Alerts**, and pick the calendar/mayor channel and the mayor ping role.
7. Open **Mod Updates** to manage tracked GitHub repos. New servers start with `https://github.com/odtheking/Odin` prefilled.
8. Use the **Booth ping** and **Mayor ping** buttons in Mayor Alerts to choose whether Election Booth and mayor change alerts ping the role in that server.
9. Use **Rebuild posts** in a section any time you want to re-create its bot posts, such as the mayor status embed.

## Configuration

All variables are read in `src/config/env.js`; `.env.example` is a template.

- `DISCORD_TOKEN` - bot token from the Discord Developer Portal (required)
- `HYPIXEL_API_KEY` - required for `/cata`, `/catacombs`, `/trophyfishing`, `/trophyfrogs`, and `/link username:`; the election and Bazaar data used by mayor alerts and `/pest` need no key
- `IRC_BRIDGE_ENABLED` - enable the built-in HTTP IRC bridge server for the Fabric mod
- `IRC_BRIDGE_HOST` / `IRC_BRIDGE_PORT` - listen address for the IRC bridge server
- `IRC_BRIDGE_AUTH_TOKEN` - shared secret used by the Minecraft mod; the bridge stays off without a real token
- `IRC_BRIDGE_CHANNEL_ID` - Discord channel used for the bridge (falls back to `DISCORD_CHANNEL_ID`)
- `IRC_BRIDGE_MAX_BUFFERED_MESSAGES` - how many recent Discord/IRC messages the backend keeps for clients
- `MOD_BACKEND_URL` - standalone Xclipsen Mod backend URL, defaults to `https://api.xclipsen.de`
- `MOD_BACKEND_AUTH_TOKEN` - token used by the bot when reading/writing mod backend links and stats (falls back to `IRC_BRIDGE_AUTH_TOKEN`)
- `GITHUB_TOKEN` - optional GitHub token for higher rate limits on mod update checks
- `CRAFTY_API_KEY` - optional Bearer token for the Crafty.gg name history fallback
- `MAGICK_PATH` - optional path to the ImageMagick binary used by `/gif` (default `magick`)
- `TTS_URL` - base URL of the text-to-speech service; set by `docker-compose.yml`, `/tts` is disabled without it
- `TTS_ROLE_NAME` - role that may use `/tts`, created by the bot when missing (default `TTS`)
- `TTS_MAX_QUEUE` / `TTS_MAX_CHARS` - queued lines per server and characters read per message (defaults `10` / `300`)
- `MUSIC_CHANNEL_NAME` - text channel for `/music` and its control panel, set up once per server by the bot (default `voice`)
- `MUSIC_ROLE_NAME` - role that sees that channel, created once per server by the bot (default `Voice`, needs Manage Roles)
- `YTDLP_PATH` - path to the yt-dlp binary used by `/music play` (default `yt-dlp`; the Docker image ships it)
- `DISCORD_CHANNEL_ID` - optional legacy default channel for first-time setup
- `DISCORD_ROLE_ID` - optional legacy default role for first-time setup
- `ADMIN_USER_IDS` - optional comma-separated Discord user IDs that can always use admin bot commands
- `CHECK_INTERVAL_MINUTES` - interval for election and mayor checks
- `MOD_UPDATE_CHECK_MINUTES` - interval for GitHub mod update checks
- `STATUS_UPDATE_MINUTES` - interval for status embed updates
- `SKYBLOCK_ITEM_EMOJIS_ENABLED` - set to `false` to disable the SkyBlock item emoji lookup feature
- `SKYBLOCK_ITEM_EMOJI_HASH_URL` / `SKYBLOCK_ITEM_EMOJI_DATA_URL` - optional override URLs for the Altpapier emoji mapping files
- `MOCK_MODE` - if `true`, the bot always loads `data/mock-election.json` instead of the live API
- `EMOJI_*` - optional custom emojis for mayors, for example `<:diaz:123...>`
- `VOTE_BAR_FILLED_EMOJI` / `VOTE_BAR_EMPTY_EMOJI` - optional custom emojis for the mayor vote bar chart
- The HTTP User-Agent and the `data/` file paths (including `data/namehistory-cache.json`) are fixed in `src/config/env.js`.
- Mod update tracking reads public GitHub release data for repos you add in `/setup -> Mod Updates` and can post new releases into a configured channel with an optional role ping
- If your server already has emojis named like `diaz`, `cole`, or `mayor_diaz`, the bot can detect them automatically.
- The bot now needs permission to manage roles if you use reaction roles.

```env
DISCORD_TOKEN=your_discord_bot_token
IRC_BRIDGE_ENABLED=true
IRC_BRIDGE_HOST=0.0.0.0
IRC_BRIDGE_PORT=8765
IRC_BRIDGE_AUTH_TOKEN=change-me
IRC_BRIDGE_CHANNEL_ID=123456789012345678
IRC_BRIDGE_MAX_BUFFERED_MESSAGES=250
GITHUB_TOKEN=your_github_token
HYPIXEL_API_KEY=your_hypixel_api_key
DISCORD_CHANNEL_ID=123456789012345678
DISCORD_ROLE_ID=123456789012345678
ADMIN_USER_IDS=885542911511515146
CHECK_INTERVAL_MINUTES=5
MOD_UPDATE_CHECK_MINUTES=60
STATUS_UPDATE_MINUTES=30
SKYBLOCK_ITEM_EMOJIS_ENABLED=true
MOCK_MODE=false
EMOJI_DIAZ=<:diaz:123456789012345678>
VOTE_BAR_FILLED_EMOJI=<:barfill:123456789012345678>
VOTE_BAR_EMPTY_EMOJI=<:barempty:123456789012345678>
```

## Run Locally

```bash
npm install
npm start
```

## Tests

```bash
DISCORD_TOKEN=test-token npm run check
```

This syntax-checks every file in `src/`, `scripts/`, and `test/` and runs the `node --test` suite in `test/*.test.js` without network access. The Docker image keeps `test/` and `scripts/`, so the same command works inside the container.

- Use `/help` in Discord for a quick overview of public commands and examples.
- If you enable the IRC bridge, the bot also needs the `GuildMessages` and `MessageContent` intents.

## Project Structure

- `src/index.js` wires the client, features, and events together.
- `src/config/` contains environment loading, slash commands, help texts, interaction IDs, and the event/mining/weather definitions.
- `src/features/` contains one module per feature (mayor alerts, event calendar and reminders, mining events, weather, mod updates, setup hub, reaction roles, linking and the IRC bridge, player lookups, pest calculators, shitter list); see `docs/BOT_DOCUMENTATION.md` for the full list.
- `src/storage/store.js` reads, normalizes, and writes `data/config.json`, `data/state.json`, and `data/shitter-list.json`.
- `src/utils/` contains shared helpers: `hypixelApi.js` (cached Hypixel Bazaar, election, and profile requests), SkyBlock time, Mojang lookups, the mod backend client, emojis, and image rendering.
- `scripts/setup-weather.js` provisions the weather channel once from the command line.
- `test/` contains the `node --test` suite.

After the bot is online, run `/setup` in your Discord server and fill in:

- the channel ID where updates should be posted
- the role ID that should be pinged for election and mayor changes
- whether election-open alerts and mayor-change alerts should ping that role

Only members with `Manage Server` or a whitelisted `ADMIN_USER_IDS` entry can use the setup hub.

## Reaction Roles

- Use `/reactionrole add` with a channel, message ID, role, and emoji.
- Or open `/setup -> Reaction Roles` and manage bindings from the interactive panel.
- You can optionally set `required_role` so only members with that role can use the reaction to get the target role.
- Use `/reactionrole remove` to delete a binding.
- Use `/reactionrole list` to see all current bindings for the server.
- When someone adds the configured reaction, the bot gives the role.
- When they remove the reaction, the bot removes the role.
- The bot needs `Manage Roles`, and the target role must be lower than the bot's top role.

## Linked Minecraft Accounts

- Use `/link username:<ign>` to verify a Minecraft account through Hypixel Social Media and receive a short-lived code for `/irc link <code>` in Minecraft.
- The player's Hypixel `Discord` social link must match the Discord username running the command.
- This feature requires `HYPIXEL_API_KEY`.
- Links created by the old Minecraft code flow are treated as legacy and must be re-verified with `/link username:<ign>`.
- `/link` without options shows your status; `/link remove:<ign>` removes one username, `/link event:<event> enabled:<true|false>` toggles an event ping for your Minecraft client, and `/link unlink:true` deletes the whole link.
- Links are stored in the mod backend (`MOD_BACKEND_URL`), not in `data/`.
- If you leave the name field empty on supported commands, the bot uses your linked Minecraft username.

## Shitter List

- Use `/shitter add [name:<ign>] reason:<text>` to add or update an entry.
- `/shitter add` also accepts up to 5 optional screenshot image attachments.
- IGNs are validated like Minecraft names: 3-16 characters, letters, numbers, and `_` only.
- Multiple active entries can be stored for the same IGN, and `/shitter query` lets you select which one to view.
- The bot automatically stores the current date and time for each entry.
- Use `/shitter query [name:<ign>]` to check whether an IGN is listed.
- Use `/shitter remove [name:<ign>]` to mark all active entries for that IGN as removed while keeping history.
- Use `/shitter list` to show unique names for the server and select one from a menu.
- In `/setup -> Shitter List`, you can block specific Discord user IDs, block roles, or require allowed roles for adding/removing shitter entries.

## Minecraft UUID Lookup

- Use `/uuid [player:<ign>]` to fetch a player's current Mojang UUID.
- The bot returns both the raw UUID and dashed UUID form.
- `/uuid` also shows a Stuffy-style UUID percentile and leaderboard position.
- This command uses the official Mojang API and does not require a Hypixel API key.

## SkyBlock Item Emojis

- Use `/itememoji item:<SKYBLOCK_ID>` to post a mapped item emoji in the current channel.
- Add `enchanted:true` if you want the enchanted variant when one exists.
- The command posts a normal channel message instead of a slash-command response because the upstream emoji dataset no longer works reliably inside interaction responses.
- By default the bot loads the mapping data from `Altpapier/Skyblock-Item-Emojis` version 3 on demand.
- Credit for the dataset stays with [Altpapier/Skyblock-Item-Emojis](https://github.com/Altpapier/Skyblock-Item-Emojis).

## Application Emojis (event icons and mayor heads)

- The event calendar, event reminders, mining event pings and dashboard, weather posts, reaction-role panels, `/cata` and the mayor status show SkyBlock item icons and mayor heads as Discord **application emojis** (owned by the bot, usable in every server and in interaction replies).
- The icons live in `assets/app-emojis/` with `manifest.json` (emoji name → file and source). On every start the bot fetches its application emojis and uploads only the ones that are missing; existing or other emojis are never deleted or replaced. The first start uploads all of them (56 at the moment), which can take a minute.
- Until the upload is done, or if Discord rejects it, the bot keeps showing the Unicode emojis. Discord does not render custom emojis in embed titles, field names and footers, so those carry no emoji and the icon is shown as thumbnail or at the start of the text; the Minecraft bridge keeps the Unicode emojis.
- The role panels react with the item icons. On start the bot rebuilds every event, mining and weather panel whose reactions still use other emojis (only once all icons are loaded); members react once more on the new panel, their roles are kept.
- A guild emoji named like a mayor (`diaz`, `mayor_diaz`) or an `EMOJI_*` setting still takes priority over the head emoji.
- Item icons come from [Altpapier/Skyblock-Item-Emojis](https://github.com/Altpapier/Skyblock-Item-Emojis) (textures mostly from FurfSky Reborn), mayor heads from [mc-heads.net](https://mc-heads.net/) renders. To add an icon, see `assets/app-emojis/README.md`.

## Minecraft Name History

- Use `/namehistory [player:<ign>]` to show a player's known username history.
- The bot shows the current name, UUID, and each known previous name.
- Mojang resolves the current username and UUID. History comes from Laby.net, with the [Crafty.gg API](https://crafty.gg/public-api) as a fallback on lookup failure; each history response must match the Mojang UUID.
- History is cached for 24 hours from the successful fetch. Provider failures preserve cached names and display a stale-data notice; without cached history, the command reports that history is unavailable.
- Dates marked `approx.` are not confirmed change times. Hidden names are omitted, and long lists show an omitted-name count.
- A valid empty or hidden response does not trigger a fallback or restore names from an older cache.
- `CRAFTY_API_KEY` optionally supplies a Bearer token for Crafty. Public requests worked without a token during testing; the API documentation lists Bearer authentication. The bot honors `Retry-After` on rate limits.

## Pest Calculators

- `/pest fortune:<amount> sell_method:<Instasell|Sell Order|NPC Sell>` (or `/pests`) ranks all pests by estimated coins per kill. Bazaar methods use live prices for guaranteed drops; rare drops stay on the calibrated NPC estimate.
- `/setfarmingstats` saves your Bonus Pest Chance, Pest Shard level (+2% rare drops per level), and reforge; Cropeetle and Rarefinder levels are optional and only shown back.
- `/pestfarmingprofits` estimates crop, pest, and bait profit per hour for a bait, vinyl, crop, Farming Fortune, plot count, and sell method; `/lastpestfarmingprofits` reruns the last setup with current prices.
- Both commands share one pest valuation and a 60-second Hypixel Bazaar/election cache, and check whether Finnegan's Pest Eradicator perk is active.

## Media Tools

- Use `/gif media:<image>` to convert an uploaded image into a GIF file.

## Text-to-Speech

- On start the bot creates a `TTS` role in every server (needs the Manage Roles permission) and stores its ID. Give that role to everyone who may use TTS; server managers can always use it.
- `/tts join` joins your voice channel. The bot then reads messages from the channel where you ran the command and from the voice channel's own chat, but only from TTS role members who are in that voice channel. Before a new speaker it says "<name> sagt: …".
- The bot stays in the channel until whoever ran `/tts join` leaves (or moves); then it leaves too. `/tts leave` makes it leave earlier.
- `/tts say text:<text>` reads one text aloud; `/tts voice voice:<name>` (admins) picks the server voice.
- Speech comes from `tts-service/`, a separate container running Piper (`thorsten`, default) and Kyutai Pocket TTS (`juergen`) on the CPU. Custom Piper voices go into `tts-voices/` as `<id>.onnx` + `<id>.onnx.json`.

## Music and Radio

- On its first start in a server the bot sets up a `#voice` text channel (`MUSIC_CHANNEL_NAME`; it reuses one with that name, else creates it, which needs Manage Channels). This happens once: if an admin later clears the control channel in `/setup` or deletes it, it stays unset until a channel is picked in `/setup`, and `/music` says it is not set up. The bot's own `#voice` channel is hidden from `@everyone` and only visible to the `Voice` role (`MUSIC_ROLE_NAME`, created once like the TTS role, changeable in `/setup`); a channel an admin picks with another name keeps its own permissions. It keeps one control panel message there: now playing (title, source, requester, length or live), queue with its total length, loop mode, volume, current radio station, an overview of the `/music`, `/playlist` and `/tts` commands, buttons for pause/resume, skip, stop, shuffle, loop (off → track → queue), volume -10/+10 and the queue, a Continue button while nothing plays and a stopped session can be continued, a radio station picker and a picker for the public playlists of the server (most recently played first). The panel updates itself and is posted again if someone deletes it (only when Discord reports it as deleted, so a temporary error never leaves a duplicate).
- `/music` and `/playlist` only work in that channel. Anyone can use `/music` from a voice channel: `play query:<YouTube link or search>`, `playnext query:<…>` (plays right after the current track), `radio station:<name>`, `continue`, `skip`, `stop`, `pause`, `resume`, `queue` (pages of 10 with position, title, length, requester and the total length), `shuffle`, `clear`, `remove position:<n>`, `move from:<n> to:<n>`, `loop mode:<off|track|queue>`, `nowplaying`, `volume level:<0-100>`.
- What changes the music is announced publicly in the channel, e.g. "🎵 **Max** added **Title** (3:45) — position 4" (play, playnext, radio, continue, skip, stop, shuffle, clear, loop, playing a playlist, and changes to public playlists). These messages never mention anyone and contain no links. Errors, permission messages and lookups (`queue`, `nowplaying`, `show`, `list`) are only visible to you.
- Once nothing plays any more (the queue finished, `stop`, or the bot left) and nothing starts again for 30 seconds, the bot deletes every message in that channel except the panel (also chat written while nothing plays, and once on start-up), so the panel is on top again. It needs Manage Messages there (the bot's own channel grants it); messages younger than 14 days are bulk deleted, older ones one by one, failures are ignored. If messages older and newer than the panel survive, the panel is posted again so it is the newest message. Other channels are never touched.
- `/music continue` (or the panel's Continue button) picks up the last session that was stopped or ended because the owner left or the bot was disconnected: it joins your voice channel, restores the queue and loop mode and continues the YouTube track where it was (ffmpeg `-ss`); radio simply starts again live. The snapshot is kept in `data/music-resume.json` for 24 hours (so it survives a restart) and is used up by `continue`; a queue that simply finished leaves nothing to continue, and new playback only replaces the snapshot when it is interrupted itself.
- Without a voice session the bot joins your voice channel and leaves when you leave (the same shared session as `/tts`; `/tts leave` makes it leave earlier). While it is in another voice channel, `play` and `radio` are refused. Playback controls, volume and panel buttons need you in the bot's voice channel; server managers and `ADMIN_USER_IDS` can always use them. While the bot is not in a voice channel, only they can change the stored volume.
- The queue holds up to 50 tracks, or up to 100 when playlists (or `continue`) fill it; a playlist stops at that limit and says how many tracks were left out. Loop `track` repeats the current track, `queue` puts every finished track back at the end; a track that fails or ends within 3 seconds is not repeated, so broken videos cannot loop forever. Videos longer than 3 hours are refused unless they are live. `play` takes a single video (links to playlists or channels are refused) and looks up one track per server at a time, at most three across all servers; otherwise it asks you to try again in a moment. A radio station replaces the queue, and `play` during radio replaces the station.
- TTS lines interrupt music: tracks pause and continue afterwards, radio and live streams keep running underneath.
- YouTube audio comes from [yt-dlp](https://github.com/yt-dlp/yt-dlp) (against YouTube's terms of service, and it breaks when YouTube changes something; the image pins a release in `YTDLP_VERSION`; bump it and rebuild to update yt-dlp). Radio streams are read by ffmpeg, which reconnects when a stream drops and may only use http(s).
- Built-in stations are in `src/features/music/stations.js`; admins can add more stations (`music.stations` in the server config) through `/setup`. Custom station URLs must point to a public host: localhost, single-label names (like the `tts` service), and private, loopback, link-local or CGNAT addresses are refused when saving and again when playing (then also after a DNS lookup).

### Playlists

- Everyone builds their own playlists with `/playlist`: `create name`, `add name [query]` (a YouTube link or search; without query the track that is playing), `remove name position`, `rename name new_name`, `delete name`, `visibility name mode:<public|private>`, `show name [user]`, `list [user]`, `play name [user] [shuffle]` (queues it and joins your voice channel like `/music play`), `save name` (saves the current track and queue; replaces your playlist of that name), `import name url:<YouTube playlist link>` (up to 100 videos in one yt-dlp `--flat-playlist` lookup, under the same lookup limits as `play`; adds to your playlist of that name or creates it) and `copy user name [new_name]` (copies someone's public playlist into a private one of yours).
- Playlists belong to one member of a server and are private by default: only the owner sees, plays and changes them. Public playlists can be listed, shown and played by everyone in the music channel and appear in the panel picker, but only the owner, server managers (Manage Server) and `ADMIN_USER_IDS` can change or delete them; managers also see private ones. Names are unique per owner (case-insensitive, 1–50 characters). A name means your own playlist; add `user:` for someone else's public one. Name autocomplete shows your own playlists first, then public ones as "Name — by Owner".
- Limits: 25 playlists per member and server, 200 tracks per playlist. Only single YouTube videos are saved (title, URL, length, live flag), never radio stations. `/playlist list` shows your playlists plus the public ones; `list user:<member>` shows that member's public playlists (all of them for the owner and managers).
- Playlists live in `data/playlists.json`: `{ "guilds": { "<guildId>": [{ "id", "name", "ownerId", "visibility", "createdAt", "updatedAt", "lastUsedAt", "tracks": [{ "title", "url", "duration", "isLive" }] }] } }`. Like the other data files it is written atomically, and the bot refuses to start if it is not valid JSON.

## Help

- Use `/help` to open the full command guide.
- Use `/help section:<name>` to jump straight to `Getting Started`, `Player Tools`, `Moderation`, or `Admin Tools`.

## Testing Scenarios

- Use `/simulate custom mayor:<name> perk_count:<number>` to generate a random perk set for a selected mayor.
- `/simulate custom` also accepts `booth_open:true/false`.
- `/simulate clear` switches the bot back to the live API.
- If you want the whole bot to stay in local test mode after restart, set `MOCK_MODE=true` and edit `data/mock-election.json`.

## Docker Compose

```bash
docker compose up -d --build
```

- `docker-compose.yml` publishes the IRC bridge port (host `8767` to container `8765`) for the Minecraft mod.
- `docs/`, root Markdown files, `.env`, `.env.example`, `data/`, and `tts-service/` are excluded from the bot image.
- The `tts` service builds `tts-service/`, is only reachable from the bot (`http://tts:5000`), and is limited to 3 CPUs and 3 GB RAM. Model downloads are kept in the `tts-models` volume.
- The bot image installs the official standalone yt-dlp build for musl (checked against the release checksums), pinned by `YTDLP_VERSION` in the `Dockerfile`; bump it or build with `--build-arg YTDLP_VERSION=latest` to update.
- The bot runs as the unprivileged `node` user (uid 1000), so the host's `data/` directory must be writable by uid 1000; it is limited to 1 GB RAM.

- The bot loads its token and optional legacy defaults from `.env`.
- `./data` is mounted to `/app/data` so server config, the stored status message ID, and booth state survive restarts.
- View logs with `docker compose logs -f`.
- Stop the bot with `docker compose down`.

## Notes

- The election and Bazaar endpoints do not require a Hypixel API key; SkyBlock profiles and player lookups do.
- The bot uses the `Guilds`, `GuildMembers`, `GuildMessages`, `GuildMessageReactions`, and `MessageContent` intents (reaction roles, the IRC bridge, and message-based features).
- Slash commands are registered per server when the bot starts or joins a new guild; restart the bot after changing command definitions.
- For custom emojis, upload them to your Discord server and paste the full emoji tag into `.env`.
- As an alternative, you can simply name your server emojis `diaz`, `cole`, `foxy`, or `mayor_diaz` and the bot will try to resolve them automatically.

## Harvest Feast crop commands

- `/season` shows the four current in-season crops and the rotation countdown.
- `/harvestfeast` also shows the SkyBlock month and upcoming reported crop rotations.
- Uses the public EliteSkyBlock Harvest Feast API, also used by SkyHanni, without an API key. Community data may lag behind the game; missing, incomplete or stale current data is marked unavailable.
- Responses are cached for 60 seconds; requests time out after 8 seconds and failures have a 15-second retry cooldown.
- Reference: https://github.com/hannibal002/SkyHanni/blob/beta/src/main/java/at/hannibal2/skyhanni/features/event/harvestfeast/HarvestFeastManager.kt

## Admin overview and setup

`/setup` provides native channel, role and user selectors, module resets with confirmation, and rebuilding of bot posts. Users or roles can be delegated guild-local bot-manager access under Bot Access; granting access and managing reaction-role bindings remain restricted to Manage Server or existing privileged bot users. Target-channel setup does not require the operator to send messages there, but the bot must have the required permissions.

The Reaction Roles editor creates a new panel or accepts a link to an existing message. Bindings, long admin lists, repositories, shitter names and per-player entries can be browsed on multiple pages. Add/remove operations preserve entries beyond Discord's 25-selection limit.

Event-role panels share the mayor/calendar channel, appear above the tracked status posts and are pinned when the bot has Pin Messages permission. Mining panels are built before their tracked posts. Startup restores missing or misplaced panels while retaining correctly ordered existing panels.

## SkyBlock Weather

The weather channel contains a pinned reaction-role panel (🌦️ Mild Weather, ⛈️ Extreme Weather) followed by a compact live dashboard with the current weather, the next Mild and EXTREME windows and the next four windows. An island menu under the dashboard lets anyone pick an island; the bot answers privately with an image of that island's Mild and EXTREME in-game tooltips (rendered once per island, with a plain-text fallback if rendering fails). The schedule is calculated locally: weather is assumed every hour from XX:35 to XX:55, and every 3rd window is EXTREME (02:35, 05:35, … 23:35 UTC). When a window starts, the matching role is pinged with a short list of each island's weather; the ping is deleted when the window ends. Island stats come from in-game tooltips for the Garden, Lotus Atoll, Glacite Tunnels, The End and Moonglade Marsh, and from the wiki for the other islands.

Setup: `/setup` → **Weather** → **Create new channel** (`#skyblock-weather`, placed in the category of the other bot channels) or choose an existing channel. Missing roles are reused by name or created when the bot has Manage Roles; then the panel is pinned and the dashboard posted. **Rebuild posts** repairs both, and `/test weather tier:<Mild|EXTREME>` sends a test ping. Every **Create new channel** action in `/setup` places the new channel next to the existing bot channels.

For one-time provisioning from the server, stop the bot first (both processes would write `data/config.json`), then run `node scripts/setup-weather.js <guildId> [--category <name>]`.

Grand Feast and Harvest Feast reminders show confirmed current and upcoming crops. Each changed crop set triggers a fresh reminder with the configured event role. Persistent crop state avoids duplicate pings after restarts, reordered API responses or outages.

## Jerry's Perkpocalypse rotation

While Jerry is mayor, his Perkpocalypse activates all perks of one other mayor (Aatrox, Cole, Diana, Finnegan, Marina, Paul) every 6 hours; Finnegan's Grand Feast is never included. The Hypixel API does not expose the rotation, so the bot reads the order for the current term from the wiki page `https://hypixelskyblock.minecraft.wiki/w/Candidate_Jerry/Perkpocalypse/Year_<year>?action=raw`. Failed lookups are retried after 15 minutes, a complete order is re-read every 6 hours, and the last order is kept in `data/state.json` for restarts without wiki access. Slot times follow the wiki: the term starts on Late Spring 27, 00:00 SkyBlock time, and the last slot is shortened by the term end.

The status embed gets a `🔄 Perkpocalypse` field (current mayor and perks, end of the slot, next three mayors, full order), and the event calendar shows `Jerry's Perkpocalypse` only during Jerry's term. Each switch is its own event window, so the `Jerry Rotation` role (choose it under `/setup` → Event Calendar, or use Auto-create event roles there) is pinged once per switch with the active mayor's perks; the ping is deleted when the slot ends. Slots the wiki strikes out are skipped. Until the order is published, only the switch times are shown and pings say that a new mayor's perks are active. Perk texts are hardcoded from the wiki (checked 2026-10-21) and must be updated if Hypixel changes them.
