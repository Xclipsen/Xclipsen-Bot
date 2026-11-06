// Calendar events: labels, ping roles and the data their schedules are computed from.
// Pure data so the store can normalize per-event settings without loading feature code;
// src/features/eventCalendar.js adds the schedule functions. Keys and labels are also used by
// the Minecraft bridge, so they must not change.
//
// icon: application emoji (assets/app-emojis) for Discord messages and reaction-role panels;
// emoji: Unicode emoji for the Minecraft bridge and the fallback while the icon is not loaded.
//
// Schedule data:
//   weather: island weather tier whose windows the event follows
//   yearly:  { month, day, days } — once a year from that SkyBlock date (day is 1-based)
//   yearOf:  SkyBlock year remainder (mod 12) of a "Year of the …" event, which lasts the whole year
//   feast:   { grand } — event that shows Harvest Feast crop rotations
const EVENT_CATALOG = [
  {
    key: 'spiderRain',
    label: "Spider's Den Rain",
    emoji: '🌧️',
    icon: 'sb_spider_rain',
    color: 0x5dade2,
    roleName: "Spider's Den Rain",
    roleAliases: ["spider's den rain", 'spiders den rain', 'spider rain', 'spider rain ping', 'spider rain role'],
    showEnd: true,
    weather: 'mild'
  },
  {
    key: 'spiderThunder',
    label: "Spider's Den Thunder",
    emoji: '🌩️',
    icon: 'sb_spider_thunder',
    color: 0x7f8c8d,
    roleName: "Spider's Den Thunder",
    roleAliases: ["spider's den thunder", 'spiders den thunder', 'spider thunder', 'spider thunder ping', 'spider thunder role'],
    showEnd: true,
    weather: 'extreme'
  },
  {
    key: 'darkAuction',
    label: 'Dark Auction',
    emoji: '💵',
    icon: 'sb_dark_auction',
    color: 0x27ae60,
    roleName: 'Dark Auction',
    roleAliases: ['dark auction', 'dark auction ping', 'dark auction role', 'darkauction', 'da'],
    showEnd: false
  },
  {
    key: 'jerrysWorkshop',
    label: "Jerry's Workshop",
    emoji: '☃️',
    icon: 'sb_jerrys_workshop',
    color: 0xeaf2f8,
    roleName: "Jerry's Workshop",
    roleAliases: ["jerry's workshop", 'jerrys workshop', 'jerry workshop', "jerry's workshop ping", "jerry's workshop role"],
    showEnd: true,
    yearly: { month: 'Late Winter', day: 1, days: 31 }
  },
  {
    key: 'seasonOfJerry',
    label: 'Season of Jerry',
    emoji: '🎁',
    icon: 'sb_season_of_jerry',
    color: 0xd6eaf8,
    roleName: 'Season of Jerry',
    roleAliases: ['season of jerry', 'season of jerry ping', 'season of jerry role'],
    showEnd: true,
    yearly: { month: 'Late Winter', day: 24, days: 3 }
  },
  {
    key: 'newYearCelebration',
    label: 'New Year Celebration',
    emoji: '🎂',
    icon: 'sb_new_year',
    color: 0xf5cba7,
    roleName: 'New Year Celebration',
    roleAliases: ['new year celebration', 'new year', 'new year celebration ping', 'new year role'],
    showEnd: true,
    yearly: { month: 'Late Winter', day: 29, days: 3 }
  },
  {
    key: 'bankInterest',
    label: 'Bank Interest',
    emoji: '💰',
    icon: 'sb_bank_interest',
    color: 0xf4d03f,
    roleName: 'Bank Interest',
    roleAliases: ['bank interest', 'bank interest ping', 'bank interest role', 'interest'],
    showEnd: false
  },
  {
    key: 'hoppitysHunt',
    label: "Hoppity's Hunt",
    emoji: '🐇',
    icon: 'sb_hoppitys_hunt',
    color: 0xe8daef,
    roleName: "Hoppity's Hunt",
    roleAliases: ["hoppity's hunt", 'hoppitys hunt', 'hoppity', "hoppity's hunt ping", "hoppity's hunt role"],
    showEnd: true,
    yearly: { month: 'Early Spring', day: 1, days: 93 }
  },
  {
    key: 'yearOfTheSeal',
    label: 'Year of the Seal',
    emoji: '🦭',
    icon: 'sb_year_of_the_seal',
    color: 0x48c9b0,
    roleName: 'Year of the Seal',
    roleAliases: [
      'year of the seal',
      'year of seal',
      'seal',
      'seal event',
      'seal ping',
      'year of the seal ping',
      'year of the seal role'
    ],
    showEnd: true,
    yearOf: 6
  },
  {
    key: 'yearOfTheWitch',
    label: 'Year of the Witch',
    emoji: '🧙',
    icon: 'sb_year_of_the_witch',
    color: 0x8e44ad,
    roleName: 'Year of the Witch',
    roleAliases: [
      'year of the witch',
      'year of witch',
      'witch',
      'witch event',
      'witch ping',
      'year of the witch ping',
      'year of the witch role'
    ],
    showEnd: true,
    yearOf: 8
  },
  {
    key: 'yearOfThePig',
    label: 'Year of the Pig',
    emoji: '🐷',
    icon: 'sb_year_of_the_pig',
    color: 0xf1948a,
    roleName: 'Year of the Pig',
    roleAliases: [
      'year of the pig',
      'year of pig',
      'pig',
      'pig event',
      'shiny pig',
      'shiny pigs',
      'shiny pig ping',
      'year of the pig ping',
      'year of the pig role'
    ],
    showEnd: true,
    yearOf: 11
  },
  {
    key: 'harvestFeast',
    label: 'Harvest Feast',
    emoji: '🥣',
    icon: 'sb_harvest_feast',
    color: 0xd35400,
    roleName: 'Harvest Feast',
    roleAliases: ['harvest feast', 'feast', 'harvest feast ping', 'feast ping', 'harvest feast role', 'feast role'],
    showEnd: true,
    yearly: { month: 'Early Autumn', day: 1, days: 93 },
    feast: { grand: false }
  },
  {
    key: 'grandFeast',
    label: 'Grand Feast',
    emoji: '🍞',
    icon: 'sb_grand_feast',
    color: 0xf1c40f,
    roleName: 'Grand Feast',
    roleAliases: ['grand feast', 'grand feast ping', 'grand feast role', 'grand bakery'],
    showInCalendar: false,
    showEnd: true,
    feast: { grand: true }
  },
  {
    key: 'jerryPerkpocalypse',
    label: "Jerry's Perkpocalypse",
    emoji: '🔄',
    icon: 'sb_perkpocalypse',
    color: 0xe91e63,
    roleName: 'Jerry Rotation',
    roleAliases: [
      'jerry rotation',
      'jerry rotation ping',
      'jerry rotation role',
      'perkpocalypse',
      'perkpocalypse ping',
      'jerry perkpocalypse',
      "jerry's perkpocalypse"
    ],
    showEnd: true
  },
  {
    key: 'travelingZoo',
    label: 'Traveling Zoo',
    emoji: '🐘',
    icon: 'sb_traveling_zoo',
    color: 0xa9dfbf,
    roleName: 'Traveling Zoo',
    roleAliases: ['traveling zoo', 'zoo', 'traveling zoo ping', 'traveling zoo role', 'zoo role'],
    showEnd: true
  },
  {
    key: 'spookyFishing',
    label: 'Spooky Fishing',
    emoji: '🐟',
    icon: 'sb_spooky_fishing',
    color: 0x9b59b6,
    roleName: 'Spooky Fishing',
    roleAliases: ['spooky fishing', 'fear mongerer', 'fear mongerer ping', 'spooky fishing role'],
    showEnd: true,
    yearly: { month: 'Autumn', day: 26, days: 9 }
  },
  {
    key: 'spookyFestival',
    label: 'Spooky Festival',
    emoji: '🎃',
    icon: 'sb_spooky_festival',
    color: 0xe67e22,
    roleName: 'Spooky Festival',
    roleAliases: ['spooky festival', 'spooky festival ping', 'spooky festival role', 'spooky'],
    showEnd: true,
    yearly: { month: 'Autumn', day: 29, days: 3 }
  },
  {
    key: 'cultOfTheFallenStar',
    label: 'Cult of the Fallen Star',
    emoji: '⭐',
    icon: 'sb_cult_fallen_star',
    color: 0x8e44ad,
    roleName: 'Cult of the Fallen Star',
    roleAliases: [
      'cult of the fallen star',
      'fallen star cult',
      'cult ping',
      'cult of the fallen star ping',
      'cult of the fallen star role'
    ],
    showEnd: true
  }
];

const FEAST_EVENT_KEYS = EVENT_CATALOG.filter((definition) => definition.feast).map((definition) => definition.key);

module.exports = { EVENT_CATALOG, FEAST_EVENT_KEYS };
