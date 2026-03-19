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
  HYPIXEL_API_KEY: process.env.HYPIXEL_API_KEY || null,
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
  STATUS_UPDATE_MINUTES: Math.max(1, Number.parseInt(process.env.STATUS_UPDATE_MINUTES || '30', 10)),
  ELECTION_URL: 'https://api.hypixel.net/v2/resources/skyblock/election',
  SKYBLOCK_EPOCH_SECONDS: 1560275700,
  SKYBLOCK_DAY_SECONDS: 20 * 60,
  SKYBLOCK_YEAR_SECONDS: 20 * 60 * 372,
  ELECTION_OPEN_START_DAY: 181,
  ELECTION_CLOSE_DAY: 88,
  CONFIG_FILE_PATH: path.join(__dirname, '..', '..', 'data', 'config.json'),
  SHITTER_FILE_PATH: path.join(__dirname, '..', '..', 'data', 'shitter-list.json'),
  STATE_FILE_PATH: path.join(__dirname, '..', '..', 'data', 'state.json'),
  MOCK_DATA_FILE_PATH: path.join(__dirname, '..', '..', 'data', 'mock-election.json'),
  MAYOR_HEADS: {
    aatrox: 'https://mc-heads.net/avatar/AatroxSB/256',
    cole: 'https://mc-heads.net/avatar/ColeSB/256',
    diana: 'https://mc-heads.net/avatar/DianaSB/256',
    diaz: 'https://mc-heads.net/avatar/DiazSB/256',
    finnegan: 'https://mc-heads.net/avatar/FinneganSB/256',
    foxy: 'https://mc-heads.net/avatar/FoxySB/256',
    marina: 'https://mc-heads.net/avatar/MarinaSB/256',
    paul: 'https://mc-heads.net/avatar/PaulSB/256',
    derpy: 'https://mc-heads.net/avatar/DerpySB/256',
    jerry: 'https://mc-heads.net/avatar/CandidateJerry/256',
    scorpius: 'https://mc-heads.net/avatar/ScorpiusSB/256'
  },
  MAYOR_SKIN_LINKS: {
    aatrox: 'https://www.minecraftskins.com/skin/21660682/hypixel-skyblock-mayor-aatrox-npc/',
    cole: 'https://www.minecraftskins.com/skin/21660659/hypixel-skyblock-mayor-cole-npc/',
    diana: 'https://www.minecraftskins.com/skin/21660676/hypixel-skyblock-mayor-diana-npc/',
    diaz: 'https://www.minecraftskins.com/skin/21660663/hypixel-skyblock-mayor-diaz-npc/',
    finnegan: 'https://www.minecraftskins.com/skin/21719341/mayor-finnegan/',
    foxy: 'https://www.minecraftskins.com/skin/21660666/hypixel-skyblock-mayor-foxy-npc/',
    marina: 'https://www.minecraftskins.com/skin/21660684/hypixel-skyblock-mayor-marina-npc/',
    paul: 'https://www.minecraftskins.com/skin/21660667/hypixel-skyblock-mayor-paul-npc/',
    jerry: 'https://www.minecraftskins.com/skin/21660687/hypixel-skyblock-mayor-jerry-npc/',
    scorpius: 'https://www.minecraftskins.com/skin/21660693/hypixel-skyblock-mayor-scorpius-npc/',
    seraphine: 'https://www.minecraftskins.com/skin/21660694/hypixel-skyblock-mayor-seraphine-npc/'
  },
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
  VOTE_BAR_EMPTY_EMOJI: process.env.VOTE_BAR_EMPTY_EMOJI || '░',
  SKYBLOCK_MONTHS: [
    'Early Spring',
    'Spring',
    'Late Spring',
    'Early Summer',
    'Summer',
    'Late Summer',
    'Early Autumn',
    'Autumn',
    'Late Autumn',
    'Early Winter',
    'Winter',
    'Late Winter'
  ]
};

module.exports = { env };
