const { ActionRowBuilder, EmbedBuilder, MessageFlags, PermissionsBitField, StringSelectMenuBuilder } = require('discord.js');

const SHITTER_YES_COLOR = 0xc0392b;
const SHITTER_NO_COLOR = 0x2ecc71;
const IGN_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const SHITTER_PLAYER_SELECT_PREFIX = 'shitter-player-select:';
const SHITTER_ENTRY_SELECT_PREFIX = 'shitter-entry-select:';

function buildEntryEmbed({ ign, status, reason = null, createdAt = null, screenshotUrl = null, screenshotName = null }) {
  const isListed = status === 'yes';
  const embed = new EmbedBuilder()
    .setColor(isListed ? SHITTER_YES_COLOR : SHITTER_NO_COLOR)
    .setTitle(`Shitter Check: ${ign}`)
    .addFields({ name: 'Shitter status', value: status, inline: true });

  if (reason) {
    embed.addFields({ name: 'Reason', value: reason.slice(0, 1024), inline: false });
  }

  if (createdAt) {
    embed.addFields({ name: 'Geshittet am', value: formatTimestamp(createdAt), inline: true });
  }

  if (screenshotUrl) {
    embed.addFields({
      name: 'Screenshot',
      value: `[${screenshotName || 'Anhang offnen'}](${screenshotUrl})`,
      inline: false
    });
    embed.setImage(screenshotUrl);
  }

  return embed;
}

function buildNoEntryEmbed({ ign, wasShitterInThePast = false }) {
  const embed = new EmbedBuilder()
    .setColor(SHITTER_NO_COLOR)
    .setTitle(`Shitter Check: ${ign}`)
    .addFields({ name: 'Shitter status', value: 'no', inline: true });

  if (wasShitterInThePast) {
    embed.setFooter({ text: 'was shitter in the past' });
  }

  return embed;
}

function buildQueryEmbed({ ign, entry, entryCount }) {
  const embed = new EmbedBuilder()
    .setColor(SHITTER_YES_COLOR)
    .setTitle(`Shitter Check: ${ign}`)
    .addFields(
      { name: 'Shitter status', value: 'yes', inline: true },
      { name: 'Entries', value: String(entryCount), inline: true }
    );

  embed.addFields({
    name: 'Reason',
    value: entry.reason.slice(0, 1024),
    inline: false
  });
  embed.addFields({ name: 'Geshittet am', value: formatTimestamp(entry.createdAt), inline: true });

  if (entryCount > 1) {
    embed.setFooter({ text: `Showing selected entry of ${entryCount}` });
  }

  if (entry.screenshotUrl) {
    embed.addFields({
      name: 'Screenshot',
      value: `[${entry.screenshotName || 'Anhang offnen'}](${entry.screenshotUrl})`,
      inline: false
    });
    embed.setImage(entry.screenshotUrl);
  }

  return embed;
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function createShitterListFeature({ store, ensureSetupAccess }) {
  function normalizeIgn(value) {
    return String(value || '').trim().toLowerCase();
  }

  function isValidIgn(value) {
    return IGN_PATTERN.test(String(value || '').trim());
  }

  function canManageShitterEntries(interaction) {
    const config = store.getGuildConfig(interaction.guildId);
    const permissions = config.shitterPermissions;
    const userId = String(interaction.user.id);
    const memberRoleIds = new Set(interaction.member?.roles?.cache?.keys?.() || []);

    if (interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild)) {
      return { allowed: true, reason: null };
    }

    if (permissions.blockedUserIds.includes(userId)) {
      return { allowed: false, reason: 'You are blocked from adding shitter entries in this server.' };
    }

    if (permissions.blockedRoleIds.some((roleId) => memberRoleIds.has(roleId))) {
      return { allowed: false, reason: 'One of your roles is blocked from adding shitter entries in this server.' };
    }

    if (permissions.allowedRoleIds.length > 0 && !permissions.allowedRoleIds.some((roleId) => memberRoleIds.has(roleId))) {
      return { allowed: false, reason: 'You need one of the allowed roles to add shitter entries in this server.' };
    }

    return { allowed: true, reason: null };
  }

  function getEntries(guildId) {
    return store.getShitterEntries(guildId)
      .slice()
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }

  function getActiveEntries(guildId) {
    return getEntries(guildId).filter((entry) => !entry.removedAt);
  }

  function getEntry(guildId, ign) {
    return getEntriesByIgn(guildId, ign)[0] || null;
  }

  function getEntriesByIgn(guildId, ign) {
    const normalizedIgn = normalizeIgn(ign);
    return getEntries(guildId).filter((entry) => entry.normalizedIgn === normalizedIgn);
  }

  function getActiveEntriesByIgn(guildId, ign) {
    const normalizedIgn = normalizeIgn(ign);
    return getActiveEntries(guildId).filter((entry) => entry.normalizedIgn === normalizedIgn);
  }

  function hadPastEntries(guildId, ign) {
    return getEntriesByIgn(guildId, ign).length > 0;
  }

  function getUniqueIgnEntries(guildId) {
    const uniqueEntries = new Map();

    for (const entry of getActiveEntries(guildId)) {
      if (!uniqueEntries.has(entry.normalizedIgn)) {
        uniqueEntries.set(entry.normalizedIgn, entry);
      }
    }

    return [...uniqueEntries.values()];
  }

  function createPlayerSelectComponents({ guildId, userId, selectedIgn = null }) {
    const uniqueEntries = getUniqueIgnEntries(guildId).slice(0, 25);
    if (uniqueEntries.length === 0) {
      return [];
    }

    return [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${SHITTER_PLAYER_SELECT_PREFIX}${userId}`)
          .setPlaceholder('Select an IGN')
          .addOptions(
            uniqueEntries.map((entry) => ({
              label: entry.ign,
              value: entry.normalizedIgn,
              description: `${getActiveEntriesByIgn(guildId, entry.ign).length} active entr${getActiveEntriesByIgn(guildId, entry.ign).length === 1 ? 'y' : 'ies'}`,
              default: entry.normalizedIgn === selectedIgn
            }))
          )
      )
    ];
  }

  function createEntrySelectComponents({ userId, ign, entries, selectedCreatedAt = null }) {
    if (entries.length <= 1) {
      return [];
    }

    return [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${SHITTER_ENTRY_SELECT_PREFIX}${userId}:${normalizeIgn(ign)}`)
          .setPlaceholder('Select an entry')
          .addOptions(
            entries.slice(0, 25).map((entry, index) => ({
              label: `${index + 1}. ${formatTimestamp(entry.createdAt)}`.slice(0, 100),
              value: entry.createdAt,
              description: entry.reason.slice(0, 100),
              default: entry.createdAt === selectedCreatedAt
            }))
          )
      )
    ];
  }

  function buildListEmbed(guildId) {
    const entries = getUniqueIgnEntries(guildId);
    const embed = new EmbedBuilder()
      .setColor(SHITTER_YES_COLOR)
      .setTitle('Shitter List');

    if (entries.length === 0) {
      embed.setDescription('No entries yet.');
      return embed;
    }

    embed.setDescription(
      entries
        .slice(0, 25)
        .map((entry, index) => `${index + 1}. **${entry.ign}** - ${getActiveEntriesByIgn(guildId, entry.ign).length} active entr${getActiveEntriesByIgn(guildId, entry.ign).length === 1 ? 'y' : 'ies'}`)
        .join('\n')
    );

    if (getUniqueIgnEntries(guildId).length > 25) {
      embed.setFooter({ text: `Showing 25 of ${getUniqueIgnEntries(guildId).length} names` });
    } else {
      embed.setFooter({ text: 'Pick a name from the menu below.' });
    }

    return embed;
  }

  async function handleShitterCommand(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'add') {
      await handleShitterAddCommand(interaction);
      return;
    }

    if (subcommand === 'query') {
      await handleShitterQueryCommand(interaction);
      return;
    }

    if (subcommand === 'remove') {
      await handleShitterRemoveCommand(interaction);
      return;
    }

    if (subcommand === 'list') {
      await handleShitterListCommand(interaction);
    }
  }

  async function handleShitterAddCommand(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'Dieser Command kann nur auf einem Server genutzt werden.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const permissionCheck = canManageShitterEntries(interaction);
    if (!permissionCheck.allowed) {
      await interaction.reply({
        content: permissionCheck.reason,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const ign = interaction.options.getString('name', true).trim();
    const reason = interaction.options.getString('reason', true).trim();
    const screenshot = interaction.options.getAttachment('screenshot');

    if (!ign) {
      await interaction.reply({
        content: 'IGN darf nicht leer sein.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!isValidIgn(ign)) {
      await interaction.reply({
        content: 'IGN muss 3 bis 16 Zeichen lang sein und darf nur Buchstaben, Zahlen oder Unterstriche enthalten.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!reason) {
      await interaction.reply({
        content: 'Reason darf nicht leer sein.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (screenshot && !String(screenshot.contentType || '').startsWith('image/')) {
      await interaction.reply({
        content: 'Der Screenshot muss ein Bild sein.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const normalizedIgn = normalizeIgn(ign);
    const existingEntries = store.getShitterEntries(interaction.guildId);
    const now = new Date().toISOString();
    const nextEntries = existingEntries.slice();

    nextEntries.push({
      ign,
      normalizedIgn,
      reason,
      createdAt: now,
      removedAt: null,
      screenshotUrl: screenshot?.url || null,
      screenshotName: screenshot?.name || null,
      addedByUserId: interaction.user.id,
      removedByUserId: null
    });

    store.setShitterEntries(interaction.guildId, nextEntries);

    await interaction.reply({
      content: `IGN \`${ign}\` wurde zur Shitter-Liste hinzugefugt.`,
      embeds: [buildEntryEmbed({
        ign,
        status: 'yes',
        reason,
        createdAt: now,
        screenshotUrl: screenshot?.url || null,
        screenshotName: screenshot?.name || null
      })],
      flags: MessageFlags.Ephemeral
    });
  }

  async function handleShitterQueryCommand(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'Dieser Command kann nur auf einem Server genutzt werden.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const ign = interaction.options.getString('name', true).trim();
    if (!isValidIgn(ign)) {
      await interaction.reply({
        content: 'IGN muss 3 bis 16 Zeichen lang sein und darf nur Buchstaben, Zahlen oder Unterstriche enthalten.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const entries = getActiveEntriesByIgn(interaction.guildId, ign);

    if (entries.length === 0) {
      await interaction.reply({
        embeds: [buildNoEntryEmbed({ ign, wasShitterInThePast: hadPastEntries(interaction.guildId, ign) })],
        allowedMentions: { parse: [] }
      });
      return;
    }

    await interaction.reply({
      embeds: [buildQueryEmbed({ ign: entries[0].ign, entry: entries[0], entryCount: entries.length })],
      components: createEntrySelectComponents({
        userId: interaction.user.id,
        ign: entries[0].ign,
        entries,
        selectedCreatedAt: entries[0].createdAt
      }),
      allowedMentions: { parse: [] }
    });
  }

  async function handleShitterRemoveCommand(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'Dieser Command kann nur auf einem Server genutzt werden.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const permissionCheck = canManageShitterEntries(interaction);
    if (!permissionCheck.allowed) {
      await interaction.reply({
        content: permissionCheck.reason,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const ign = interaction.options.getString('name', true).trim();
    if (!isValidIgn(ign)) {
      await interaction.reply({
        content: 'IGN muss 3 bis 16 Zeichen lang sein und darf nur Buchstaben, Zahlen oder Unterstriche enthalten.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const normalizedIgn = normalizeIgn(ign);
    const existingEntries = store.getShitterEntries(interaction.guildId);
    const activeEntries = existingEntries.filter((entry) => entry.normalizedIgn === normalizedIgn && !entry.removedAt);

    if (activeEntries.length === 0) {
      await interaction.reply({
        embeds: [buildNoEntryEmbed({ ign, wasShitterInThePast: hadPastEntries(interaction.guildId, ign) })],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
      });
      return;
    }

    const removedAt = new Date().toISOString();
    const nextEntries = existingEntries.map((entry) => (
      entry.normalizedIgn === normalizedIgn && !entry.removedAt
        ? {
          ...entry,
          removedAt,
          removedByUserId: interaction.user.id
        }
        : entry
    ));

    store.setShitterEntries(interaction.guildId, nextEntries);

    await interaction.reply({
      embeds: [buildNoEntryEmbed({ ign, wasShitterInThePast: true })],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    });
  }

  async function handleShitterListCommand(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: 'Dieser Command kann nur auf einem Server genutzt werden.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.reply({
      embeds: [buildListEmbed(interaction.guildId)],
      components: createPlayerSelectComponents({ guildId: interaction.guildId, userId: interaction.user.id }),
      allowedMentions: { parse: [] }
    });
  }

  async function handleShitterPlayerSelect(interaction) {
    if (!interaction.customId.startsWith(SHITTER_PLAYER_SELECT_PREFIX)) {
      return false;
    }

    const ownerId = interaction.customId.slice(SHITTER_PLAYER_SELECT_PREFIX.length);
    if (ownerId !== interaction.user.id) {
      await interaction.reply({
        content: 'This selector belongs to someone else. Run the command yourself.',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const selectedIgn = interaction.values[0];
    const entry = getUniqueIgnEntries(interaction.guildId).find((item) => item.normalizedIgn === selectedIgn);
    const entries = entry ? getActiveEntriesByIgn(interaction.guildId, entry.ign) : [];

    if (entries.length === 0) {
      await interaction.update({
        embeds: [buildListEmbed(interaction.guildId)],
        components: createPlayerSelectComponents({ guildId: interaction.guildId, userId: interaction.user.id })
      });
      return true;
    }

    await interaction.update({
      embeds: [buildQueryEmbed({ ign: entries[0].ign, entry: entries[0], entryCount: entries.length })],
      components: [
        ...createPlayerSelectComponents({ guildId: interaction.guildId, userId: interaction.user.id, selectedIgn }),
        ...createEntrySelectComponents({
          userId: interaction.user.id,
          ign: entries[0].ign,
          entries,
          selectedCreatedAt: entries[0].createdAt
        })
      ]
    });

    return true;
  }

  async function handleShitterEntrySelect(interaction) {
    if (!interaction.customId.startsWith(SHITTER_ENTRY_SELECT_PREFIX)) {
      return false;
    }

    const payload = interaction.customId.slice(SHITTER_ENTRY_SELECT_PREFIX.length);
    const separatorIndex = payload.indexOf(':');
    const ownerId = separatorIndex >= 0 ? payload.slice(0, separatorIndex) : '';
    const normalizedIgn = separatorIndex >= 0 ? payload.slice(separatorIndex + 1) : '';

    if (ownerId !== interaction.user.id) {
      await interaction.reply({
        content: 'This selector belongs to someone else. Run the command yourself.',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    const entries = getActiveEntries(interaction.guildId).filter((entry) => entry.normalizedIgn === normalizedIgn);
    const selectedCreatedAt = interaction.values[0];
    const selectedEntry = entries.find((entry) => entry.createdAt === selectedCreatedAt) || entries[0];

    if (!selectedEntry) {
      await interaction.reply({
        content: 'That entry no longer exists.',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    await interaction.update({
      embeds: [buildQueryEmbed({ ign: selectedEntry.ign, entry: selectedEntry, entryCount: entries.length })],
      components: [
        ...createPlayerSelectComponents({ guildId: interaction.guildId, userId: interaction.user.id, selectedIgn: normalizedIgn }),
        ...createEntrySelectComponents({
          userId: interaction.user.id,
          ign: selectedEntry.ign,
          entries,
          selectedCreatedAt: selectedEntry.createdAt
        })
      ]
    });

    return true;
  }

  return {
    handleShitterCommand,
    handleShitterPlayerSelect,
    handleShitterEntrySelect,
    handleShitterAddCommand,
    handleShitterQueryCommand,
    handleShitterRemoveCommand,
    handleShitterListCommand,
    getEntries,
    getEntriesByIgn,
    getEntry
  };
}

module.exports = { createShitterListFeature };
