// One-time provisioning: the bot itself creates/configures the SkyBlock weather channel, roles, panel and dashboard.
// Run only while the main bot is stopped; both processes would otherwise write data/config.json and data/state.json.
// Reads DISCORD_TOKEN from the environment or ./.env (same as src/index.js).
// Usage: node scripts/setup-weather.js <guildId> [--category <name>]
const { ChannelType, Client, Events, GatewayIntentBits } = require('discord.js');

const { env } = require('../src/config/env');
const { createStore } = require('../src/storage/store');
const { createAccessControl } = require('../src/features/accessControl');
const { createPagedLists } = require('../src/features/pagedLists');
const { createReactionRoleService } = require('../src/features/reactionRoles');
const { createWeatherService } = require('../src/features/weather');

const USAGE = 'Usage: node scripts/setup-weather.js <guildId> [--category <name>]';
const args = process.argv.slice(2);
let guildId = null;
let categoryName = null;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--category') {
    categoryName = args[index + 1] || '';
    index += 1;
  } else if (!guildId) {
    guildId = args[index];
  } else {
    guildId = '';
  }
}
if (!/^\d{16,20}$/.test(guildId || '') || categoryName === '') {
  console.error(USAGE);
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMessageReactions] });
const store = createStore({
  configFilePath: env.CONFIG_FILE_PATH,
  shitterFilePath: env.SHITTER_FILE_PATH,
  stateFilePath: env.STATE_FILE_PATH
});
const accessControl = createAccessControl(env.PRIVILEGED_USER_IDS, store);
const reactionRoles = createReactionRoleService({ pagedLists: createPagedLists(), client, store, ensureServerAccess: accessControl.ensureServerAccess });
const weather = createWeatherService({ client, store, reactionRoles });

async function run() {
  const guild = await client.guilds.fetch(guildId);
  let parentId;
  if (categoryName) {
    const channels = await guild.channels.fetch();
    const category = [...channels.values()].find(channel => channel?.type === ChannelType.GuildCategory && channel.name.toLowerCase() === categoryName.toLowerCase());
    if (!category) throw new Error(`Category "${categoryName}" not found in ${guild.name}.`);
    parentId = category.id;
  }
  const result = await weather.runQuickSetup(guild, { parentId });
  const parent = result.channel.parentId ? await guild.channels.fetch(result.channel.parentId).catch(() => null) : null;
  console.log(`Server: ${guild.name} (${guild.id})`);
  console.log(`Channel: #${result.channel.name} (${result.channel.id})`);
  console.log(`Category: ${parent ? `${parent.name} (${parent.id})` : 'none'}`);
  if (parentId && result.channel.parentId !== parentId) console.log(`Note: an existing channel was reused outside "${categoryName}"; move it manually if needed.`);
  console.log(`Roles: mild=${result.roles.mild || 'none'} extreme=${result.roles.extreme || 'none'} (${result.createdCount} created)`);
  for (const warning of result.warnings || []) console.log(`Warning: ${warning}`);
}

client.once(Events.ClientReady, async () => {
  let exitCode = 0;
  try {
    await run();
  } catch (error) {
    console.error(`Weather setup failed: ${error.message}`);
    exitCode = 1;
  }
  await client.destroy();
  process.exit(exitCode);
});

client.login(env.DISCORD_TOKEN).catch((error) => {
  console.error(`Discord login failed: ${error.message}`);
  client.destroy();
  process.exit(1);
});
