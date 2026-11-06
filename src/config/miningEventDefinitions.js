// Mining events reported by Soopy's chevents feed, one ping role per event and island.
// Pure data so the store can normalize per-event settings without loading feature code.
const ISLAND_LABELS = {
  DWARVEN_MINES: 'Dwarven Mines',
  CRYSTAL_HOLLOWS: 'Crystal Hollows'
};

// Application emojis (assets/app-emojis) for the islands; ISLAND_EMOJIS are the Unicode fallbacks.
const ISLAND_ICONS = {
  DWARVEN_MINES: 'mine_dwarven_mines',
  CRYSTAL_HOLLOWS: 'mine_crystal_hollows'
};

const ISLAND_EMOJIS = {
  DWARVEN_MINES: '⛏️',
  CRYSTAL_HOLLOWS: '💎'
};

const ISLAND_KEY_SUFFIXES = {
  DWARVEN_MINES: 'Dwarven',
  CRYSTAL_HOLLOWS: 'Crystal'
};

// icon: application emoji (assets/app-emojis) for messages and reaction-role panels;
// emoji: Unicode fallback while the icon is not loaded.
// Runs in both Dwarven Mines and Crystal Hollows.
const SHARED_MINING_EVENTS = [
  { key: 'gwtw', label: 'Gone with the Wind', emoji: '💨', icon: 'mine_gone_with_the_wind', color: 0x3498db, soopyKey: 'GONE_WITH_THE_WIND' },
  { key: 'doublePowder', label: '2x Powder', emoji: '⚡', icon: 'mine_double_powder', color: 0x1abc9c, soopyKey: 'DOUBLE_POWDER' },
  { key: 'betterTogether', label: 'Better Together', emoji: '🎭', icon: 'mine_better_together', color: 0xaf7ac5, soopyKey: 'BETTER_TOGETHER' }
];

// Dwarven Mines only.
const DWARVEN_ONLY_MINING_EVENTS = [
  { key: 'goblinRaid', label: 'Goblin Raid', emoji: '⚔️', icon: 'mine_goblin_raid', color: 0xe74c3c, soopyKey: 'GOBLIN_RAID' },
  { key: 'raffle', label: 'Mining Raffle', emoji: '🎟️', icon: 'mine_raffle', color: 0xf1c40f, soopyKey: 'RAFFLE' },
  { key: 'mithrilGourmand', label: 'Mithril Gourmand', emoji: '🍽️', icon: 'mine_mithril_gourmand', color: 0x16a085, soopyKey: 'MITHRIL_GOURMAND' }
];

function buildRoleAliases(label, islandLabel) {
  const base = label.toLowerCase();
  const variants = [base, `${base} ping`, `${base} role`];

  if (islandLabel) {
    const suffixed = `${base} ${islandLabel.toLowerCase()}`;
    variants.push(suffixed, `${suffixed} ping`, `${suffixed} role`);
  }

  return [...new Set(variants)];
}

const MINING_EVENT_DEFINITIONS = [
  ...SHARED_MINING_EVENTS.flatMap((event) => Object.keys(ISLAND_LABELS).map((island) => {
    const islandLabel = ISLAND_LABELS[island];
    return {
      key: `${event.key}${ISLAND_KEY_SUFFIXES[island]}`,
      label: event.label,
      emoji: event.emoji,
      icon: event.icon,
      color: event.color,
      island,
      soopyKey: event.soopyKey,
      roleName: `${event.label} (${islandLabel})`,
      roleAliases: buildRoleAliases(event.label, islandLabel)
    };
  })),
  ...DWARVEN_ONLY_MINING_EVENTS.map((event) => ({
    key: event.key,
    label: event.label,
    emoji: event.emoji,
    icon: event.icon,
    color: event.color,
    island: 'DWARVEN_MINES',
    soopyKey: event.soopyKey,
    roleName: event.label,
    roleAliases: buildRoleAliases(event.label, null)
  }))
];

const MINING_EVENT_DEFINITION_MAP = Object.fromEntries(
  MINING_EVENT_DEFINITIONS.map((definition) => [definition.key, definition])
);

function getMiningEventDefinitionsForIsland(island) {
  return MINING_EVENT_DEFINITIONS.filter((definition) => definition.island === island);
}

module.exports = {
  ISLAND_EMOJIS,
  ISLAND_ICONS,
  ISLAND_LABELS,
  MINING_EVENT_DEFINITIONS,
  MINING_EVENT_DEFINITION_MAP,
  getMiningEventDefinitionsForIsland
};
