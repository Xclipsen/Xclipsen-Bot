const { EmbedBuilder } = require('discord.js');

const { env } = require('../config/env');
const { EVENT_DEFINITION_MAP } = require('./eventCalendar');
const { MONTH_MS, SKYBLOCK_MONTHS, skyBlockYearAt, yearPositionAt, yearStartAt } = require('../utils/skyblockTime');

const API_URL = 'https://api.eliteskyblock.com/harvest-feast/current';
const CROPS = new Set(['Wheat', 'Carrot', 'Potato', 'Pumpkin', 'Melon', 'Mushroom', 'Cocoa Beans', 'Sugar Cane', 'Cactus', 'Nether Wart', 'Sunflower', 'Moonflower', 'Wild Rose']);

// Like SkyHanni's SkyBlockTime, which EliteSkyBlock data uses: the displayed year and a 1-based month.
function skyblockDate(now) {
  const month = Math.floor(yearPositionAt(now) / MONTH_MS) + 1;
  return { year: skyBlockYearAt(now), month, end: yearStartAt(now) + month * MONTH_MS };
}

function resolveFeast(data, now) {
  const date = skyblockDate(now);
  const unavailable = { ...date, available: false };
  if (!data || data.complete !== true || !Number.isInteger(data.year) || !Number.isInteger(data.month)
    || data.year !== date.year || data.month < date.month - 1 || data.month > date.month
    || !Array.isArray(data.current) || data.current.length !== 4 || new Set(data.current).size !== 4
    || !data.current.every(crop => CROPS.has(crop)) || !data.next || typeof data.next !== 'object'
    || Array.isArray(data.next) || typeof data.isGrandFeast !== 'boolean') return unavailable;
  if (!data.isGrandFeast && (date.month < 7 || date.month > 9)) return unavailable;

  const groups = new Map();
  for (const [crop, seconds] of Object.entries(data.next)) {
    if (seconds === null) continue;
    if (!CROPS.has(crop) || !Number.isSafeInteger(seconds) || seconds <= 0) return unavailable;
    const at = seconds * 1000;
    if (!groups.has(at)) groups.set(at, []);
    groups.get(at).push(crop);
  }
  const rotations = [...groups].sort((a, b) => a[0] - b[0]);
  const active = rotations.filter(([at]) => at <= now).at(-1);
  // A previous month's current list must never be presented as today's crops.
  if (!active && data.month !== date.month) return unavailable;
  if (active && (active[1].length !== 4 || active[0] < date.end - MONTH_MS)) return unavailable;
  const upcoming = rotations.filter(([at]) => at > now);
  return {
    ...date, available: true, grand: data.isGrandFeast,
    crops: active ? active[1] : data.current,
    until: Math.min(upcoming[0]?.[0] ?? date.end, date.end),
    upcoming
  };
}

function createHarvestFeastFeature({ fetchImpl = fetch, now = Date.now } = {}) {
  let cached = null;
  let expires = 0;
  let pending = null;
  async function load() {
    if (now() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetchImpl(API_URL, { headers: { 'User-Agent': env.USER_AGENT }, signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('Feast API unavailable');
        cached = await response.json();
        expires = now() + 60_000;
        return cached;
      } catch {
        cached = null;
        expires = now() + 15_000;
        return null;
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  async function handleCommand(interaction) {
    await interaction.deferReply();
    const feast = resolveFeast(await load(), now());
    const stamp = ms => `<t:${Math.floor(ms / 1000)}:R>`;
    const embed = new EmbedBuilder()
      .setColor(feast.available ? 0x65b741 : 0xe0a526)
      .setTitle(interaction.commandName === 'season' ? 'In-season crops' : 'Harvest Feast')
      .setFooter({ text: 'EliteSkyBlock • Community data, also used by SkyHanni' });
    if (feast.available) {
      embed.setDescription(`**${feast.grand ? 'Grand Feast' : 'Harvest Feast'}**\n${feast.crops.map(crop => `• ${crop}`).join('\n')}\n\nIn season until ${stamp(feast.until)} (<t:${Math.floor(feast.until / 1000)}:t>).`);
      if (interaction.commandName === 'harvestfeast') {
        embed.addFields({ name: 'SkyBlock date', value: `${SKYBLOCK_MONTHS[feast.month - 1]}, Year ${feast.year}` });
        embed.addFields({ name: 'Upcoming crops', value: feast.upcoming.length
          ? feast.upcoming.map(([at, crops]) => `${stamp(at)}: ${crops.join(', ')}`).join('\n')
          : 'No further rotations reported yet.' });
      }
    } else {
      embed.setDescription('No confirmed current crops available. Community data may be missing or outdated, or the feast may be inactive.\n\nOpen Ted → All Crops in SkyHanni and share the feast data to help update the source.');
      const regular = EVENT_DEFINITION_MAP.harvestFeast.getSchedule(now());
      embed.addFields({ name: 'Regular Harvest Feast', value: regular.isActive
        ? `Autumn window active; ends ${stamp(regular.windowEndAt)}.`
        : `Next autumn window starts ${stamp(regular.windowStartAt)}.` });
      embed.addFields({ name: 'Grand Feast', value: 'May extend the event outside autumn; current status is not confirmed.' });
    }
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  }
  return { handleCommand, getCurrent: async () => resolveFeast(await load(), now()) };
}

module.exports = { createHarvestFeastFeature, resolveFeast, skyblockDate, API_URL };
