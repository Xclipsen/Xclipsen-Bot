require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js');

const REQUIRED_ENV_VARS = [
  'DISCORD_TOKEN',
  'DISCORD_CHANNEL_ID',
  'DISCORD_ROLE_ID'
];

for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const DISCORD_ROLE_ID = process.env.DISCORD_ROLE_ID;
const CHECK_INTERVAL_MINUTES = Math.max(
  1,
  Number.parseInt(process.env.CHECK_INTERVAL_MINUTES || '5', 10)
);
const STATUS_UPDATE_MINUTES = Math.max(
  1,
  Number.parseInt(process.env.STATUS_UPDATE_MINUTES || '30', 10)
);
const ELECTION_URL = 'https://api.hypixel.net/v2/resources/skyblock/election';
const SKYBLOCK_EPOCH_SECONDS = 1560275700;
const SKYBLOCK_DAY_SECONDS = 20 * 60;
const SKYBLOCK_YEAR_DAYS = 372;
const SKYBLOCK_YEAR_SECONDS = SKYBLOCK_DAY_SECONDS * SKYBLOCK_YEAR_DAYS;
const ELECTION_OPEN_START_DAY = 181;
const ELECTION_CLOSE_DAY = 88;
const STATE_FILE_PATH = path.join(__dirname, '..', 'data', 'state.json');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const MAYOR_HEADS = {
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
};

const MAYOR_SKIN_LINKS = {
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
};

const MAYOR_EMOJIS = {
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
};

let lastMayorKey = null;
let lastElectionId = null;
let initializedMayorState = false;
let electionBoothState = loadState();
const resolvedMayorEmojiCache = new Map();

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      boothOpen: null
    };
  }
}

function saveState() {
  fs.mkdirSync(path.dirname(STATE_FILE_PATH), { recursive: true });
  fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(electionBoothState, null, 2));
}

async function fetchElectionData() {
  const response = await fetch(ELECTION_URL, {
    headers: {
      'User-Agent': 'hypixel-mayor-discord-bot/1.0.0'
    }
  });

  if (!response.ok) {
    throw new Error(`Hypixel API responded with ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  if (!data.success || !data.mayor) {
    throw new Error('Hypixel API response did not contain mayor data.');
  }

  return data;
}

async function getTargetChannel() {
  const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);

  if (!channel || !channel.isTextBased()) {
    throw new Error('Configured Discord channel is not a text channel.');
  }

  return channel;
}

function formatMayorPerks(mayor) {
  const perks = Array.isArray(mayor.perks) ? mayor.perks : [];

  if (!perks.length) {
    return '- No perks found';
  }

  return perks
    .map((perk) => `- **${perk.name}**: ${stripMinecraftFormatting(perk.description)}`)
    .join('\n');
}

function stripMinecraftFormatting(text) {
  return String(text || '').replace(/§./g, '');
}

function toDiscordTimestamp(timestamp, style = 'f') {
  return `<t:${Math.floor(timestamp / 1000)}:${style}>`;
}

function getElectionSchedule(now = Date.now()) {
  const unixSeconds = now / 1000;
  const secondsSinceEpoch = unixSeconds - SKYBLOCK_EPOCH_SECONDS;
  const yearPositionSeconds = ((secondsSinceEpoch % SKYBLOCK_YEAR_SECONDS) + SKYBLOCK_YEAR_SECONDS) % SKYBLOCK_YEAR_SECONDS;
  const openStartSeconds = ELECTION_OPEN_START_DAY * SKYBLOCK_DAY_SECONDS;
  const closeSeconds = ELECTION_CLOSE_DAY * SKYBLOCK_DAY_SECONDS;
  const boothOpen = yearPositionSeconds >= openStartSeconds || yearPositionSeconds < closeSeconds;

  let nextTransitionSeconds;

  if (boothOpen) {
    nextTransitionSeconds = yearPositionSeconds < closeSeconds
      ? closeSeconds
      : SKYBLOCK_YEAR_SECONDS + closeSeconds;
  } else {
    nextTransitionSeconds = openStartSeconds;
  }

  const secondsUntilTransition = nextTransitionSeconds - yearPositionSeconds;

  return {
    boothOpen,
    nextTransitionAt: now + (secondsUntilTransition * 1000)
  };
}

function getElectionTimingLines(isOpen) {
  const schedule = getElectionSchedule();
  const targetTimestamp = schedule.nextTransitionAt;

  if (isOpen) {
    return [
      `Election ends: ${toDiscordTimestamp(targetTimestamp)} (${toDiscordTimestamp(targetTimestamp, 'R')})`
    ];
  }

  return [
    `Next election opens: ${toDiscordTimestamp(targetTimestamp)} (${toDiscordTimestamp(targetTimestamp, 'R')})`
  ];
}

function compactMayorPerks(mayor) {
  const perks = Array.isArray(mayor.perks) ? mayor.perks : [];

  if (!perks.length) {
    return 'No perks found';
  }

  return perks.map((perk) => stripMinecraftFormatting(perk.name)).join(' | ');
}

function buildMayorHeaderLines(mayor) {
  const ministerLine = mayor.minister
    ? `Minister: **${mayor.minister.name}** - ${stripMinecraftFormatting(mayor.minister.perk.name)}`
    : null;

  return [
    `**Current Mayor**: ${mayor.name} (${mayor.key})`,
    `**Election Booth**: ${electionBoothState.boothOpen === true ? 'Open' : 'Closed'}`,
    ...getElectionTimingLines(electionBoothState.boothOpen === true),
    `**Active Perks**: ${compactMayorPerks(mayor)}`,
    ministerLine
  ].filter(Boolean);
}

async function sendRolePing(text) {
  const channel = await getTargetChannel();

  await channel.send({
    content: [`<@&${DISCORD_ROLE_ID}>`, text].join('\n'),
    allowedMentions: {
      roles: [DISCORD_ROLE_ID]
    }
  });
}

async function sendRolePingEmbed(content, embed) {
  const channel = await getTargetChannel();

  await channel.send({
    content: [`<@&${DISCORD_ROLE_ID}>`, content].join('\n'),
    embeds: [embed],
    allowedMentions: {
      roles: [DISCORD_ROLE_ID]
    }
  });
}

function getMayorHeadUrl(mayor) {
  return MAYOR_HEADS[String(mayor.key || '').toLowerCase()] || null;
}

function getMayorSkinLink(mayor) {
  return MAYOR_SKIN_LINKS[String(mayor.key || '').toLowerCase()] || null;
}

async function getMayorEmoji(mayor) {
  const mayorKey = String(mayor.key || '').toLowerCase();
  const mayorName = String(mayor.name || '').toLowerCase();
  const lookupKeys = [mayorName, mayorKey].filter(Boolean);

  for (const lookupKey of lookupKeys) {
    if (resolvedMayorEmojiCache.has(lookupKey)) {
      return resolvedMayorEmojiCache.get(lookupKey);
    }
  }

  const configuredEmoji = MAYOR_EMOJIS[mayorName] || MAYOR_EMOJIS[mayorKey];
  if (configuredEmoji && configuredEmoji.startsWith('<')) {
    for (const lookupKey of lookupKeys) {
      resolvedMayorEmojiCache.set(lookupKey, configuredEmoji);
    }
    return configuredEmoji;
  }

  try {
    const channel = await getTargetChannel();
    if ('guild' in channel && channel.guild) {
      await channel.guild.emojis.fetch();

      const matchingEmoji = channel.guild.emojis.cache.find((emoji) => {
        const normalizedName = String(emoji.name || '').toLowerCase();
        return lookupKeys.some((lookupKey) => (
          normalizedName === lookupKey ||
          normalizedName === `mayor_${lookupKey}` ||
          normalizedName === `mayor${lookupKey}`
        ));
      });

      if (matchingEmoji) {
        const formattedEmoji = matchingEmoji.toString();
        for (const lookupKey of lookupKeys) {
          resolvedMayorEmojiCache.set(lookupKey, formattedEmoji);
        }
        return formattedEmoji;
      }

      console.log(
        `No custom emoji found for ${lookupKeys.join(', ')}; checked ${channel.guild.emojis.cache.size} guild emojis`
      );
    }
  } catch (error) {
    console.error(`Could not resolve custom emoji for ${lookupKeys.join(', ')}:`, error);
  }

  return configuredEmoji || '👤';
}

function createMayorEmbed(title, emoji, mayor) {
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`${emoji} ${title}`)
    .addFields(
      {
        name: 'Mayor',
        value: `${mayor.name} (${mayor.key})`,
        inline: true
      },
      {
        name: 'Election Booth',
        value: electionBoothState.boothOpen === true ? 'Open' : 'Closed',
        inline: true
      },
      {
        name: electionBoothState.boothOpen === true ? 'Election Ends' : 'Next Election Opens',
        value: getElectionTimingLines(electionBoothState.boothOpen === true)[0],
        inline: false
      },
      {
        name: 'Active Perks',
        value: compactMayorPerks(mayor),
        inline: false
      },
      {
        name: 'Perk Details',
        value: formatMayorPerks(mayor),
        inline: false
      }
    )
    .setTimestamp();

  if (mayor.minister) {
    embed.addFields({
      name: 'Minister',
      value: `${mayor.minister.name} - ${stripMinecraftFormatting(mayor.minister.perk.name)}`,
      inline: false
    });
  }

  const skinLink = getMayorSkinLink(mayor);
  if (skinLink) {
    embed.addFields({
      name: 'Skin',
      value: `[View mayor skin](${skinLink})`,
      inline: false
    });
  }

  const headUrl = getMayorHeadUrl(mayor);
  if (headUrl) {
    embed.setThumbnail(headUrl);
  }

  return embed;
}

async function sendMayorChangePing(mayor) {
  const mayorEmoji = await getMayorEmoji(mayor);
  await sendRolePingEmbed(
    `${mayorEmoji} A new mayor has been elected.`,
    createMayorEmbed('New SkyBlock Mayor', mayorEmoji, mayor)
  );
}

async function sendElectionPing(currentElection) {
  const candidateNames = Array.isArray(currentElection.candidates)
    ? currentElection.candidates.map((candidate) => candidate.name).join(', ')
    : 'Unknown candidates';

  await sendRolePing(
    [
      ':ballot_box: **Election Booth Open**',
      `Candidates: **${candidateNames}**`,
      ...getElectionTimingLines(true)
    ].join('\n')
  );
}

async function sendElectionClosedPing() {
  await sendRolePing(
    [
      ':lock: **Election Booth Closed**',
      ...getElectionTimingLines(false)
    ].join('\n')
  );
}

async function sendMayorStatusUpdate(mayor) {
  const channel = await getTargetChannel();
  const mayorEmoji = await getMayorEmoji(mayor);

  await channel.send({
    content: `${mayorEmoji} Current SkyBlock mayor update.`,
    embeds: [createMayorEmbed('SkyBlock Status Update', mayorEmoji, mayor)]
  });
}

async function checkElectionState() {
  try {
    const data = await fetchElectionData();
    const mayor = data.mayor;
    const currentElection = data.current || null;
    const currentMayorKey = String(mayor.key || '').toLowerCase();
    const schedule = getElectionSchedule();
    const boothOpen = schedule.boothOpen;
    const currentElectionId = currentElection
      ? String(currentElection.year || data.lastUpdated || 'current-election')
      : null;

    if (electionBoothState.boothOpen !== boothOpen) {
      electionBoothState = {
        boothOpen,
        boothChangedAt: Date.now()
      };
      saveState();

      if (boothOpen && currentElection) {
        console.log('Election booth is now open');
        await sendElectionPing(currentElection);
      }

      if (!boothOpen) {
        console.log('Election booth is now closed');
        await sendElectionClosedPing();
      }
    }

    if (currentElectionId && currentElectionId !== lastElectionId) {
      lastElectionId = currentElectionId;
      console.log(`Election cycle detected: ${currentElectionId}`);
    }

    if (!initializedMayorState) {
      initializedMayorState = true;
      lastMayorKey = currentMayorKey;
      console.log(`Initial mayor state set to ${mayor.name} (${currentMayorKey})`);
      return;
    }

    if (currentMayorKey !== lastMayorKey) {
      lastMayorKey = currentMayorKey;
      console.log(`Current mayor changed to ${mayor.name} (${currentMayorKey})`);
      await sendMayorChangePing(mayor);
    }
  } catch (error) {
    console.error('Election state check failed:', error);
  }
}

async function sendScheduledStatusUpdate() {
  try {
    const data = await fetchElectionData();
    const mayor = data.mayor;
    await sendMayorStatusUpdate(mayor);
    console.log(`Status update sent for mayor ${mayor.name}`);
  } catch (error) {
    console.error('Status update failed:', error);
  }
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  await checkElectionState();
  await sendScheduledStatusUpdate();
  setInterval(checkElectionState, CHECK_INTERVAL_MINUTES * 60 * 1000);
  setInterval(sendScheduledStatusUpdate, STATUS_UPDATE_MINUTES * 60 * 1000);
});

client.login(DISCORD_TOKEN);
