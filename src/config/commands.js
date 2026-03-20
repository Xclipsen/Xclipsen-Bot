const { SlashCommandBuilder } = require('discord.js');
const { simulatedMayors } = require('./simulationData');

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
    .setDescription('List all configured reaction roles for this server.'));

const cataCommand = new SlashCommandBuilder()
  .setName('cata')
  .setDescription('Show a catacombs overview for a player.')
  .addStringOption((option) => option
    .setName('player')
    .setDescription('Minecraft username')
    .setRequired(true));

const catacombsCommand = new SlashCommandBuilder()
  .setName('catacombs')
  .setDescription('Show a catacombs overview for a player.')
  .addStringOption((option) => option
    .setName('player')
    .setDescription('Minecraft username')
    .setRequired(true));

const uuidCommand = new SlashCommandBuilder()
  .setName('uuid')
  .setDescription('Look up a Minecraft player UUID from an IGN.')
  .addStringOption((option) => option
    .setName('player')
    .setDescription('Minecraft username')
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

const commands = [
  setupCommand,
  simulateCommand,
  reactionRoleCommand,
  cataCommand,
  catacombsCommand,
  uuidCommand,
  shitterCommand
];

module.exports = {
  commands,
  commandNames: {
    setup: 'setup',
    simulate: 'simulate',
    reactionRole: 'reactionrole',
    cata: 'cata',
    catacombs: 'catacombs',
    uuid: 'uuid',
    shitter: 'shitter'
  }
};
