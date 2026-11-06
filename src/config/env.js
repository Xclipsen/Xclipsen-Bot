require('dotenv').config();

const path = require('node:path');

const REQUIRED_ENV_VARS = ['DISCORD_TOKEN'];

for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const env = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  IRC_BRIDGE_ENABLED: process.env.IRC_BRIDGE_ENABLED === 'true',
  IRC_BRIDGE_HOST: process.env.IRC_BRIDGE_HOST || '0.0.0.0',
  IRC_BRIDGE_PORT: Math.max(1, Number.parseInt(process.env.IRC_BRIDGE_PORT || '8765', 10)),
  IRC_BRIDGE_AUTH_TOKEN: process.env.IRC_BRIDGE_AUTH_TOKEN || null,
  IRC_BRIDGE_CHANNEL_ID: process.env.IRC_BRIDGE_CHANNEL_ID || process.env.DISCORD_CHANNEL_ID || null,
  IRC_BRIDGE_MAX_BUFFERED_MESSAGES: Math.max(10, Number.parseInt(process.env.IRC_BRIDGE_MAX_BUFFERED_MESSAGES || '250', 10)),
  MOD_BACKEND_URL: process.env.MOD_BACKEND_URL || 'https://api.xclipsen.de',
  MOD_BACKEND_AUTH_TOKEN: process.env.MOD_BACKEND_AUTH_TOKEN || process.env.IRC_BRIDGE_AUTH_TOKEN || null,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || null,
  HYPIXEL_API_KEY: process.env.HYPIXEL_API_KEY || null,
  CRAFTY_API_KEY: process.env.CRAFTY_API_KEY || '',
  MAGICK_PATH: process.env.MAGICK_PATH || null,
  // Base URL of the tts-service container; /tts is disabled without it.
  TTS_URL: (process.env.TTS_URL || '').replace(/\/+$/, '') || null,
  TTS_ROLE_NAME: process.env.TTS_ROLE_NAME || 'TTS',
  TTS_MAX_QUEUE: Math.max(1, Number.parseInt(process.env.TTS_MAX_QUEUE || '10', 10)),
  TTS_MAX_CHARS: Math.max(20, Number.parseInt(process.env.TTS_MAX_CHARS || '300', 10)),
  // Text channel with the music control panel; created when missing (needs Manage Channels).
  MUSIC_CHANNEL_NAME: process.env.MUSIC_CHANNEL_NAME || 'voice',
  // Only members with this role see the music channel; the bot creates it once (needs Manage Roles).
  MUSIC_ROLE_NAME: process.env.MUSIC_ROLE_NAME || 'Voice',
  YTDLP_PATH: process.env.YTDLP_PATH || 'yt-dlp',
  USER_AGENT: 'hypixel-mayor-discord-bot/1.0.0',
  DEFAULT_DISCORD_CHANNEL_ID: process.env.DISCORD_CHANNEL_ID || null,
  DEFAULT_DISCORD_ROLE_ID: process.env.DISCORD_ROLE_ID || null,
  PRIVILEGED_USER_IDS: new Set([
    '885542911511515146',
    ...String(process.env.ADMIN_USER_IDS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  ]),
  MOCK_MODE: process.env.MOCK_MODE === 'true',
  CHECK_INTERVAL_MINUTES: Math.max(1, Number.parseInt(process.env.CHECK_INTERVAL_MINUTES || '5', 10)),
  MOD_UPDATE_CHECK_MINUTES: Math.max(5, Number.parseInt(process.env.MOD_UPDATE_CHECK_MINUTES || '60', 10)),
  STATUS_UPDATE_MINUTES: Math.max(1, Number.parseInt(process.env.STATUS_UPDATE_MINUTES || '30', 10)),
  SKYBLOCK_ITEM_EMOJIS_ENABLED: process.env.SKYBLOCK_ITEM_EMOJIS_ENABLED !== 'false',
  SKYBLOCK_ITEM_EMOJI_HASH_URL: process.env.SKYBLOCK_ITEM_EMOJI_HASH_URL || 'https://raw.githubusercontent.com/Altpapier/Skyblock-Item-Emojis/main/v3/itemHash.json',
  SKYBLOCK_ITEM_EMOJI_DATA_URL: process.env.SKYBLOCK_ITEM_EMOJI_DATA_URL || 'https://raw.githubusercontent.com/Altpapier/Skyblock-Item-Emojis/main/v3/emojis.json',
  ELECTION_URL: 'https://api.hypixel.net/v2/resources/skyblock/election',
  CONFIG_FILE_PATH: path.join(__dirname, '..', '..', 'data', 'config.json'),
  SHITTER_FILE_PATH: path.join(__dirname, '..', '..', 'data', 'shitter-list.json'),
  STATE_FILE_PATH: path.join(__dirname, '..', '..', 'data', 'state.json'),
  MOCK_DATA_FILE_PATH: path.join(__dirname, '..', '..', 'data', 'mock-election.json'),
  NAMEHISTORY_CACHE_FILE_PATH: path.join(__dirname, '..', '..', 'data', 'namehistory-cache.json'),
  // Isometric heads from the in-game NPC skin textures (skyblock.matdoes.dev NPC list);
  // Jerry is a villager, so he uses Mojang's MHF_Villager head.
  MAYOR_HEADS: Object.fromEntries(Object.entries({
    aatrox: 'c1bdf505bb8c0f1f3365a03032de1931663ff71c57e022558de312b8f1b5c445',
    cole: '16422de08848952d1cbead66bbbad6f07191bdcc952f3d1036aeb0c22938f39b',
    diana: '83cc1cf672a4b2540be346ead79ac2d9ed19d95b6075bf95be0b6d0da61377be',
    diaz: '9cf4737cd444b590545734a6408cbe23c182f4283f167a3e3c09532ccbef17f9',
    finnegan: 'e7747fbee9fb39be39b00d3d483eb2f88b4bae82417ab5cb1b1aa930dd7b6689',
    foxy: '3485a717fa0f51d7fadc66a5d5e9853905bef914e3b2848a2f128e63d2db87',
    marina: '807fc9bee8d3344e840e4031a37249a4c3c87fc80cf16432cc5c2153d1f9c53d',
    paul: '1b59c43d8dbccfd7ec6e6394b6304b70d4ed315add0494ee77c733f41818c73a',
    derpy: 'f450d12692886c47b078a38f4d492acfe61216e2d0237ab82433409b3046b464',
    jerry: 'MHF_Villager',
    scorpius: '8f26fa0c47536e78e337257d898af8b1ebc87c0894503375234035ff2c7ef8f0',
    seraphine: 'cd654531816ec7200a6a461d7a03c2dadf31f449a591c85f3b31cb2a83dd7366'
  }).map(([mayor, skin]) => [mayor, `https://mc-heads.net/head/${skin}/256`])),
  MAYOR_EMOJIS: {
    aatrox: process.env.EMOJI_AATROX || '⚔️',
    cole: process.env.EMOJI_COLE || '⛏️',
    diana: process.env.EMOJI_DIANA || '🏹',
    diaz: process.env.EMOJI_DIAZ || '💰',
    finnegan: process.env.EMOJI_FINNEGAN || '🌾',
    foxy: process.env.EMOJI_FOXY || '🎪',
    marina: process.env.EMOJI_MARINA || '🌊',
    paul: process.env.EMOJI_PAUL || '🗝️',
    derpy: process.env.EMOJI_DERPY || '🤪',
    jerry: process.env.EMOJI_JERRY || '🧨',
    scorpius: process.env.EMOJI_SCORPIUS || '🦂',
    seraphine: process.env.EMOJI_SERAPHINE || '🗳️'
  },
  VOTE_BAR_FILLED_EMOJI: process.env.VOTE_BAR_FILLED_EMOJI || '█',
  VOTE_BAR_EMPTY_EMOJI: process.env.VOTE_BAR_EMPTY_EMOJI || '░'
};

module.exports = { env };
