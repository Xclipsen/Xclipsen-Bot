// Island weather tiers with their ping roles; the window math lives in src/utils/skyblockTime.js.
// Pure data so the store can normalize per-tier settings without loading feature code.
// icon: application emoji (assets/app-emojis); emoji: Unicode fallback while it is not loaded.
const WEATHER_ROLE_DEFINITIONS = [
  {
    key: 'mild',
    label: 'Mild Weather',
    emoji: '🌦️',
    icon: 'weather_mild',
    roleName: 'Mild Weather',
    roleAliases: ['mild weather', 'mild weather ping', 'mild weather pings', 'mild weather role', 'weather mild', 'mild weather alert']
  },
  {
    key: 'extreme',
    label: 'EXTREME Weather',
    emoji: '⛈️',
    icon: 'weather_extreme',
    roleName: 'Extreme Weather',
    roleAliases: ['extreme weather', 'extreme weather ping', 'extreme weather pings', 'extreme weather role', 'weather extreme', 'extreme weather alert']
  }
];

module.exports = { WEATHER_ROLE_DEFINITIONS };
