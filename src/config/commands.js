const { SlashCommandBuilder } = require('discord.js');
const { getHelpSectionChoices } = require('./help');
const { simulatedMayors } = require('./simulationData');
const { EVENT_DEFINITIONS } = require('../features/eventCalendar');
const { PESTS, INSTA_SELL, SELL_ORDER, NPC_SELL } = require('../features/bestPest');
const { BAITS, CROPS, REFORGE_OPTIONS } = require('../features/pestFarmingProfit');

const helpCommand = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show grouped command help and examples.')
  .addStringOption((option) => option
    .setName('section')
    .setDescription('Optional help category to open directly')
    .setRequired(false)
    .addChoices(...getHelpSectionChoices()));

const setupCommand = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Open the setup hub for this server.');

const simulateCommand = new SlashCommandBuilder()
  .setName('simulate')
  .setDescription('Simulate election states for testing.')
  .addSubcommand((subcommand) => subcommand
    .setName('custom')
    .setDescription('Simulate a mayor with a random perk set.')
    .addStringOption((option) => option
      .setName('mayor')
      .setDescription('Mayor to simulate')
      .setRequired(true)
      .addChoices(...simulatedMayors.map((mayor) => ({ name: mayor.name, value: mayor.key }))))
    .addIntegerOption((option) => option
      .setName('perk_count')
      .setDescription('How many random perks to assign')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(5))
    .addBooleanOption((option) => option
      .setName('booth_open')
      .setDescription('Whether the election booth should be open')
      .setRequired(false)))
  .addSubcommand((subcommand) => subcommand
    .setName('clear')
    .setDescription('Clear the current simulation and use the real API again.'));

const reactionRoleCommand = new SlashCommandBuilder()
  .setName('reactionrole')
  .setDescription('Configure reaction roles for a specific message.')
  .addSubcommand((subcommand) => subcommand
    .setName('add')
    .setDescription('Add a reaction role binding.')
    .addChannelOption((option) => option.setName('channel').setDescription('Channel containing the target message').setRequired(true))
    .addStringOption((option) => option.setName('message_id').setDescription('Target message ID').setRequired(true))
    .addRoleOption((option) => option.setName('role').setDescription('Role to assign when reacting').setRequired(true))
    .addStringOption((option) => option.setName('emoji').setDescription('Emoji to watch, e.g. ✅ or <:diaz:123>').setRequired(true))
    .addRoleOption((option) => option.setName('required_role').setDescription('Optional role required before this reaction can grant the target role').setRequired(false)))
  .addSubcommand((subcommand) => subcommand
    .setName('remove')
    .setDescription('Remove a reaction role binding.')
    .addChannelOption((option) => option.setName('channel').setDescription('Channel containing the target message').setRequired(true))
    .addStringOption((option) => option.setName('message_id').setDescription('Target message ID').setRequired(true))
    .addStringOption((option) => option.setName('emoji').setDescription('Emoji to remove from the binding').setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName('list')
    .setDescription('List all configured reaction roles for this server.'))
  .addSubcommand((subcommand) => subcommand
    .setName('purge')
    .setDescription('Purge reaction role bindings in this server, a channel, or one message.')
    .addChannelOption((option) => option.setName('channel').setDescription('Optional channel scope').setRequired(false))
    .addStringOption((option) => option.setName('message_id').setDescription('Optional message ID scope').setRequired(false)));

const cataCommand = new SlashCommandBuilder()
  .setName('cata')
  .setDescription('Show a catacombs overview for a player.')
  .addStringOption((option) => option
    .setName('player')
    .setDescription('Minecraft username, or leave empty to use your linked account')
    .setRequired(false))
  .addStringOption((option) => option
    .setName('profile')
    .setDescription('SkyBlock profile name, or leave empty to use the selected profile')
    .setRequired(false));

const catacombsCommand = new SlashCommandBuilder()
  .setName('catacombs')
  .setDescription('Show a catacombs overview for a player.')
  .addStringOption((option) => option
    .setName('player')
    .setDescription('Minecraft username, or leave empty to use your linked account')
    .setRequired(false))
  .addStringOption((option) => option
    .setName('profile')
    .setDescription('SkyBlock profile name, or leave empty to use the selected profile')
    .setRequired(false));

const itemEmojiCommand = new SlashCommandBuilder()
  .setName('itememoji')
  .setDescription('Post a SkyBlock item emoji into the current channel.')
  .addStringOption((option) => option
    .setName('item')
    .setDescription('SkyBlock custom item ID, for example HYPERION')
    .setRequired(true)
    .setAutocomplete(true))
  .addBooleanOption((option) => option
    .setName('enchanted')
    .setDescription('Use the enchanted emoji variant if available')
    .setRequired(false));

const trophyFishingCommand = new SlashCommandBuilder()
  .setName('trophyfishing')
  .setDescription('Show a Trophy Fish overview for a player.')
  .addStringOption((option) => option
    .setName('player')
    .setDescription('Minecraft username, or leave empty to use your linked account')
    .setRequired(false))
  .addStringOption((option) => option
    .setName('profile')
    .setDescription('SkyBlock profile name, or leave empty to use the selected profile')
    .setRequired(false));

function addPestOptions(command) {
  return command
    .addIntegerOption((option) => option
      .setName('fortune')
      .setDescription('Farming Fortune used for the pest profit estimate')
      .setRequired(true)
      .setMinValue(0))
    .addStringOption((option) => option
      .setName('sell_method')
      .setDescription('How to value pest drops')
      .setRequired(true)
      .addChoices(
        { name: 'Instasell', value: INSTA_SELL },
        { name: 'Sell Order', value: SELL_ORDER },
        { name: 'NPC Sell', value: NPC_SELL }
      ));
}

function addSellMethodOptions(option) {
  return option.addChoices(
    { name: 'Instasell', value: INSTA_SELL },
    { name: 'Sell Order', value: SELL_ORDER },
    { name: 'NPC Sell', value: NPC_SELL }
  );
}

const pestCommand = addPestOptions(new SlashCommandBuilder()
  .setName('pest')
  .setDescription('Show the best pest to farm for a given Farming Fortune.'));

const pestsCommand = addPestOptions(new SlashCommandBuilder()
  .setName('pests')
  .setDescription('Alias of /pest for the same pest profit estimate.'));

const setFarmingStatsCommand = new SlashCommandBuilder()
  .setName('setfarmingstats')
  .setDescription('Save your pest farming stats for the profit calculator.')
  .addIntegerOption((option) => option
    .setName('bonus_pest_chance')
    .setDescription('Your Bonus Pest Chance stat')
    .setRequired(true)
    .setMinValue(0)
    .setMaxValue(1000))
  .addIntegerOption((option) => option
    .setName('pest_shard_level')
    .setDescription('Your Pest Shard level')
    .setRequired(true)
    .setMinValue(0)
    .setMaxValue(10))
  .addIntegerOption((option) => option
    .setName('cropeetle_level')
    .setDescription('Your Cropeetle level')
    .setRequired(true)
    .setMinValue(0)
    .setMaxValue(10))
  .addIntegerOption((option) => option
    .setName('rarefinder_level')
    .setDescription('Your Rarefinder level')
    .setRequired(true)
    .setMinValue(0)
    .setMaxValue(20))
  .addStringOption((option) => option
    .setName('reforge')
    .setDescription('Your farming tool reforge')
    .setRequired(true)
    .addChoices(
      { name: REFORGE_OPTIONS.blessed.label, value: 'blessed' },
      { name: REFORGE_OPTIONS.bountiful.label, value: 'bountiful' }
    ));

const pestFarmingProfitsCommand = new SlashCommandBuilder()
  .setName('pestfarmingprofits')
  .setDescription('Calculate profit per hour from pest farming with baits and vinyls.')
  .addStringOption((option) => option
    .setName('bait')
    .setDescription('Which bait to use in the Sprayonator')
    .setRequired(true)
    .addChoices(...BAITS.map((bait) => ({ name: bait.label, value: bait.key }))))
  .addStringOption((option) => option
    .setName('vinyl')
    .setDescription('Which pest to boost with InfiniVacuum')
    .setRequired(true)
    .addChoices(...PESTS.map((pest) => ({ name: pest.label, value: pest.key }))))
  .addStringOption((option) => option
    .setName('crop')
    .setDescription('Which crop are you farming')
    .setRequired(true)
    .addChoices(...CROPS.map((crop) => ({ name: crop.label, value: crop.key }))))
  .addIntegerOption((option) => option
    .setName('fortune')
    .setDescription('Your farming fortune while farming')
    .setRequired(true)
    .setMinValue(0))
  .addIntegerOption((option) => option
    .setName('plots')
    .setDescription('How many plots your farm uses')
    .setRequired(true)
    .setMinValue(1)
    .setMaxValue(25))
  .addStringOption((option) => addSellMethodOptions(option
    .setName('sell_method')
    .setDescription('How to value crop and pest drops')
    .setRequired(true)));

const uuidCommand = new SlashCommandBuilder()
  .setName('uuid')
  .setDescription('Look up a Minecraft player UUID from an IGN.')
  .addStringOption((option) => option
    .setName('player')
    .setDescription('Minecraft username')
    .setRequired(true));

const nameHistoryCommand = new SlashCommandBuilder()
  .setName('namehistory')
  .setDescription('Look up a Minecraft player name history.')
  .addStringOption((option) => option
    .setName('player')
    .setDescription('Minecraft username')
    .setRequired(true));

const gifCommand = new SlashCommandBuilder()
  .setName('gif')
  .setDescription('Convert an uploaded image into a GIF.')
  .addAttachmentOption((option) => option
    .setName('media')
    .setDescription('Image to convert')
    .setRequired(true));

const shitterCommand = new SlashCommandBuilder()
  .setName('shitter')
  .setDescription('Manage and query the shitter list.')
  .addSubcommand((subcommand) => subcommand
    .setName('add')
    .setDescription('Add or update a shitter list entry.')
    .addStringOption((option) => option
      .setName('name')
      .setDescription('Minecraft IGN')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Why this IGN is on the list')
      .setRequired(true))
    .addAttachmentOption((option) => option
      .setName('screenshot')
      .setDescription('Optional screenshot proof')
      .setRequired(false))
    .addAttachmentOption((option) => option
      .setName('screenshot_2')
      .setDescription('Optional screenshot proof')
      .setRequired(false))
    .addAttachmentOption((option) => option
      .setName('screenshot_3')
      .setDescription('Optional screenshot proof')
      .setRequired(false))
    .addAttachmentOption((option) => option
      .setName('screenshot_4')
      .setDescription('Optional screenshot proof')
      .setRequired(false))
    .addAttachmentOption((option) => option
      .setName('screenshot_5')
      .setDescription('Optional screenshot proof')
      .setRequired(false)))
  .addSubcommand((subcommand) => subcommand
    .setName('query')
    .setDescription('Check whether an IGN is on the shitter list.')
    .addStringOption((option) => option
      .setName('name')
      .setDescription('Minecraft IGN')
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName('remove')
    .setDescription('Mark an IGN as no longer on the shitter list.')
    .addStringOption((option) => option
      .setName('name')
      .setDescription('Minecraft IGN')
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName('list')
    .setDescription('List all shitter entries for this server.'));

const linkEventChoices = EVENT_DEFINITIONS.map((definition) => ({
  name: definition.label,
  value: definition.key
}));

const testCommand = new SlashCommandBuilder()
  .setName('test')
  .setDescription('Send a test notification for one bot feature.')
  .addSubcommand((subcommand) => subcommand
    .setName('event')
    .setDescription('Send one event reminder test to Discord and IRC.')
    .addStringOption((option) => option
      .setName('event')
      .setDescription('Event reminder to test')
      .setRequired(true)
      .addChoices(...linkEventChoices)));

const linkCommand = new SlashCommandBuilder()
  .setName('link')
  .setDescription('Link your Discord account to one or more Minecraft usernames for the backend bridge.')
  .addSubcommand((subcommand) => subcommand
    .setName('start')
    .setDescription('Create a Minecraft link code for one or more usernames.')
    .addStringOption((option) => option
      .setName('usernames')
      .setDescription('Comma-separated Minecraft usernames to attach to this Discord account')
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName('status')
    .setDescription('Show your current backend link status.'))
  .addSubcommand((subcommand) => subcommand
    .setName('add')
    .setDescription('Add more Minecraft usernames after linking.')
    .addStringOption((option) => option
      .setName('usernames')
      .setDescription('Comma-separated Minecraft usernames')
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName('remove')
    .setDescription('Remove one Minecraft username from your link.')
    .addStringOption((option) => option
      .setName('username')
      .setDescription('Minecraft username to remove')
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName('event')
    .setDescription('Enable or disable one event ping for your linked backend account.')
    .addStringOption((option) => option
      .setName('event')
      .setDescription('Event to toggle')
      .setRequired(true)
      .addChoices(...linkEventChoices))
    .addBooleanOption((option) => option
      .setName('enabled')
      .setDescription('Whether this event should reach your Minecraft client')
      .setRequired(true)))
  .addSubcommand((subcommand) => subcommand
    .setName('unlink')
    .setDescription('Remove your backend link and all linked Minecraft usernames.'));

const commands = [
  helpCommand,
  setupCommand,
  simulateCommand,
  testCommand,
  reactionRoleCommand,
  cataCommand,
  catacombsCommand,
  itemEmojiCommand,
  trophyFishingCommand,
  pestCommand,
  pestsCommand,
  setFarmingStatsCommand,
  pestFarmingProfitsCommand,
  uuidCommand,
  nameHistoryCommand,
  gifCommand,
  shitterCommand,
  linkCommand
];

module.exports = {
  commands,
  commandNames: {
    help: 'help',
    setup: 'setup',
    simulate: 'simulate',
    test: 'test',
    reactionRole: 'reactionrole',
    cata: 'cata',
    catacombs: 'catacombs',
    itememoji: 'itememoji',
    trophyfishing: 'trophyfishing',
    pest: 'pest',
    pests: 'pests',
    setfarmingstats: 'setfarmingstats',
    pestfarmingprofits: 'pestfarmingprofits',
    uuid: 'uuid',
    namehistory: 'namehistory',
    gif: 'gif',
    shitter: 'shitter',
    link: 'link'
  }
};
