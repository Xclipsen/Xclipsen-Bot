const { SlashCommandBuilder } = require('discord.js');

const setupCommand = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Open the setup hub for this server.');

const simulateCommand = new SlashCommandBuilder()
  .setName('simulate')
  .setDescription('Simulate election states for testing.')
  .addStringOption((option) => option
    .setName('scenario')
    .setDescription('Scenario to apply')
    .setRequired(true)
    .addChoices(
      { name: 'booth-open', value: 'booth-open' },
      { name: 'booth-closed', value: 'booth-closed' },
      { name: 'mayor-diaz', value: 'mayor-diaz' },
      { name: 'mayor-paul', value: 'mayor-paul' },
      { name: 'clear', value: 'clear' }
    ));

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

const shitterAddCommand = new SlashCommandBuilder()
  .setName('shitteradd')
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
    .setRequired(false));

const shitterQueryCommand = new SlashCommandBuilder()
  .setName('shitterquery')
  .setDescription('Check whether an IGN is on the shitter list.')
  .addStringOption((option) => option
    .setName('name')
    .setDescription('Minecraft IGN')
    .setRequired(true));

const commands = [
  setupCommand,
  simulateCommand,
  reactionRoleCommand,
  cataCommand,
  catacombsCommand,
  shitterAddCommand,
  shitterQueryCommand
];

module.exports = {
  commands,
  commandNames: {
    setup: 'setup',
    simulate: 'simulate',
    reactionRole: 'reactionrole',
    cata: 'cata',
    catacombs: 'catacombs',
    shitterAdd: 'shitteradd',
    shitterQuery: 'shitterquery'
  }
};
