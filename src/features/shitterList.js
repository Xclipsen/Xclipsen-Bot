const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder } = require('discord.js');
const { buildLinkedUsernameNotice, resolveMinecraftUsernameOption } = require('./linkedMinecraftUser');

const SHITTER_YES_COLOR = 0xc0392b;
const SHITTER_NO_COLOR = 0x2ecc71;
const IGN_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const SHITTER_PLAYER_SELECT_PREFIX = 'shitter-player-select:';
const SHITTER_ENTRY_SELECT_PREFIX = 'shitter-entry-select:';

function addScreenshotFields(embed, screenshots) {
  if (screenshots.length === 0) {
    return embed;
  }

  embed.addFields({
    name: screenshots.length === 1 ? 'Screenshot' : 'Screenshots',
    value: screenshots
      .map((screenshot, index) => `${index + 1}. [${screenshot.name || `Anhang ${index + 1}`}](${screenshot.url})`)
      .join('\n')
      .slice(0, 1024),
    inline: false
  });
  embed.setImage(screenshots[0].url);

  return embed;
}

function formatAddedByUser(userId) {
  return userId ? `<@${userId}>` : 'Unknown';
}

function buildEntryEmbed({ ign, status, reason = null, createdAt = null, screenshots = [], addedByUserId = null }) {
  const isListed = status === 'yes';
  const embed = new EmbedBuilder()
    .setColor(isListed ? SHITTER_YES_COLOR : SHITTER_NO_COLOR)
    .setTitle(`Shitter Check: ${ign}`)
    .addFields({ name: 'Shitter status', value: status, inline: true });

  if (reason) {
    embed.addFields({ name: reason.length > 1024 ? 'Reason (preview — Full details below)' : 'Reason', value: reason.slice(0, 1024), inline: false });
  }

  if (createdAt) {
    embed.addFields({ name: 'Added at', value: formatTimestamp(createdAt), inline: true });
  }

  if (isListed) {
    embed.addFields({ name: 'Added by', value: formatAddedByUser(addedByUserId), inline: true });
  }

  return addScreenshotFields(embed, screenshots);
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
    name: entry.reason.length > 1024 ? 'Reason (preview — Full details below)' : 'Reason',
    value: entry.reason.slice(0, 1024),
    inline: false
  });
  embed.addFields(
    { name: 'Added at', value: formatTimestamp(entry.createdAt), inline: true },
    { name: 'Added by', value: formatAddedByUser(entry.addedByUserId), inline: true }
  );

  if (entryCount > 1) {
    embed.setFooter({ text: `Showing selected entry of ${entryCount}` });
  }

  return addScreenshotFields(embed, entry.screenshots);
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

// Entries come from the store, which always normalizes `screenshots` to an array.
function createShitterListFeature({ store, linkStore, accessControl, pagedLists }) {
  function normalizeIgn(value) {
    return String(value || '').trim().toLowerCase();
  }

  async function replyEphemeral(interaction, content) {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }

  async function ensureInGuild(interaction) {
    if (interaction.inGuild()) {
      return true;
    }

    await replyEphemeral(interaction, 'Dieser Command kann nur auf einem Server genutzt werden.');
    return false;
  }

  // Shared guard for add/query/remove; replies itself and returns null when the command must stop.
  async function resolveCommandIgn(interaction, manageAction = null) {
    if (!(await ensureInGuild(interaction))) {
      return null;
    }

    const deniedReason = manageAction ? getManageDeniedReason(interaction, manageAction) : null;
    if (deniedReason) {
      await replyEphemeral(interaction, deniedReason);
      return null;
    }

    let resolved;
    try {
      resolved = await resolveMinecraftUsernameOption({ interaction, linkStore, optionName: 'name' });
    } catch (error) {
      await replyEphemeral(interaction, error.message);
      return null;
    }

    const ign = resolved.username.trim();
    if (!isValidIgn(ign)) {
      await replyEphemeral(interaction, 'IGN muss 3 bis 16 Zeichen lang sein und darf nur Buchstaben, Zahlen oder Unterstriche enthalten.');
      return null;
    }

    return { ign, usedLinkedAccount: resolved.usedLinkedAccount };
  }

  function buildReplyContent(content, ign, usedLinkedAccount) {
    return [
      usedLinkedAccount ? buildLinkedUsernameNotice(ign) : null,
      content
    ].filter(Boolean).join('\n') || undefined;
  }

  function isValidIgn(value) {
    return IGN_PATTERN.test(String(value || '').trim());
  }

  // Server managers, privileged users and bot managers are never restricted, like in the other access checks.
  function getManageDeniedReason(interaction, action) {
    if (accessControl.hasAccess(interaction)) {
      return null;
    }

    const permissions = store.getGuildConfig(interaction.guildId).shitterPermissions;
    const memberRoles = interaction.member?.roles;
    const memberRoleIds = new Set(Array.isArray(memberRoles) ? memberRoles : memberRoles?.cache?.keys?.() || []);

    if (permissions.blockedUserIds.includes(String(interaction.user.id))) {
      return `You are blocked from ${action} shitter entries in this server.`;
    }

    if (permissions.blockedRoleIds.some((roleId) => memberRoleIds.has(roleId))) {
      return `One of your roles is blocked from ${action} shitter entries in this server.`;
    }

    if (permissions.allowedRoleIds.length > 0 && !permissions.allowedRoleIds.some((roleId) => memberRoleIds.has(roleId))) {
      return `You need one of the allowed roles for ${action} shitter entries in this server.`;
    }

    return null;
  }

  function getEntries(guildId) {
    return store.getShitterEntries(guildId)
      .slice()
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }

  function getActiveEntries(guildId) {
    return getEntries(guildId).filter((entry) => !entry.removedAt);
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

  function createPlayerSelectComponents({ guildId, userId, selectedIgn = null, page = null }) {
    const allEntries = getUniqueIgnEntries(guildId);
    page = page ?? Math.max(0, Math.floor(allEntries.findIndex(e => e.normalizedIgn === selectedIgn) / 15));
    page = Math.max(0, Math.min(Math.ceil(allEntries.length / 15) - 1, page));
    const uniqueEntries = allEntries.slice(page * 15, (page + 1) * 15);
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
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`shitter-list-page:${userId}:${page - 1}`).setLabel('Previous names').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(`shitter-list-page:${userId}:${page + 1}`).setLabel('Next names').setStyle(ButtonStyle.Secondary).setDisabled((page + 1) * 15 >= allEntries.length)
      )
    ];
  }

  function createEntrySelectComponents({ userId, ign, entries, selectedCreatedAt = null }) {
    if (!entries.length) return [];
    const page = Math.max(0, Math.floor(entries.findIndex(e => e.createdAt === selectedCreatedAt) / 15));
    const selected = entries.find(e => e.createdAt === selectedCreatedAt) || entries[page * 15];

    return [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${SHITTER_ENTRY_SELECT_PREFIX}${userId}:${normalizeIgn(ign)}`)
          .setPlaceholder('Select an entry')
          .addOptions(
            entries.slice(page * 15, (page + 1) * 15).map((entry, index) => ({
              label: `${page * 15 + index + 1}. ${formatTimestamp(entry.createdAt)}`.slice(0, 100),
              value: entry.createdAt,
              description: entry.reason.slice(0, 100),
              default: entry.createdAt === selectedCreatedAt
            }))
          )
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`shitter-entry-page:${userId}:${normalizeIgn(ign)}:${page - 1}`).setLabel('Previous entries').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
        new ButtonBuilder().setCustomId(`shitter-entry-page:${userId}:${normalizeIgn(ign)}:${page + 1}`).setLabel('Next entries').setStyle(ButtonStyle.Secondary).setDisabled((page + 1) * 15 >= entries.length),
        new ButtonBuilder().setCustomId(`shitter-full:${userId}:${normalizeIgn(ign)}:${selected.createdAt}`).setLabel('Full details').setStyle(ButtonStyle.Secondary)
      )
    ];
  }

  function buildListEmbed(guildId, page = 0) {
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
        .slice(page * 15, (page + 1) * 15)
        .map((entry, index) => (
          `${page * 15 + index + 1}. **${entry.ign}** - ${getActiveEntriesByIgn(guildId, entry.ign).length} active entr${getActiveEntriesByIgn(guildId, entry.ign).length === 1 ? 'y' : 'ies'} - added by ${formatAddedByUser(entry.addedByUserId)}`
        ))
        .join('\n')
    );

    embed.setFooter({ text: `Page ${page + 1}/${Math.max(1, Math.ceil(entries.length / 15))} • ${entries.length} names` });

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
    const resolved = await resolveCommandIgn(interaction, 'adding');
    if (!resolved) {
      return;
    }

    const { ign, usedLinkedAccount } = resolved;
    const reason = interaction.options.getString('reason', true).trim();
    const attachments = ['screenshot', 'screenshot_2', 'screenshot_3', 'screenshot_4', 'screenshot_5']
      .map((name) => interaction.options.getAttachment(name))
      .filter(Boolean);

    if (!reason) {
      await replyEphemeral(interaction, 'Reason darf nicht leer sein.');
      return;
    }

    if (attachments.some((attachment) => !String(attachment.contentType || '').startsWith('image/'))) {
      await replyEphemeral(interaction, 'Alle Screenshots mussen Bilder sein.');
      return;
    }

    const screenshots = attachments.map((attachment) => ({ url: attachment.url, name: attachment.name || null }));

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
      screenshots,
      addedByUserId: interaction.user.id,
      removedByUserId: null
    });

    store.setShitterEntries(interaction.guildId, nextEntries);

    await interaction.reply({
      content: buildReplyContent(`IGN \`${ign}\` wurde zur Shitter-Liste hinzugefugt.`, ign, usedLinkedAccount),
      embeds: [buildEntryEmbed({
        ign,
        status: 'yes',
        reason,
        createdAt: now,
        addedByUserId: interaction.user.id,
        screenshots
      })],
      components: createEntrySelectComponents({ userId: interaction.user.id, ign, entries: getActiveEntriesByIgn(interaction.guildId, ign), selectedCreatedAt: now }),
      flags: MessageFlags.Ephemeral
    });
  }

  async function handleShitterQueryCommand(interaction) {
    const resolved = await resolveCommandIgn(interaction);
    if (!resolved) {
      return;
    }

    const { ign, usedLinkedAccount } = resolved;

    const entries = getActiveEntriesByIgn(interaction.guildId, ign);

    if (entries.length === 0) {
      await interaction.reply({
        content: buildReplyContent(null, ign, usedLinkedAccount),
        embeds: [buildNoEntryEmbed({ ign, wasShitterInThePast: hadPastEntries(interaction.guildId, ign) })],
        allowedMentions: { parse: [] }
      });
      return;
    }

    await interaction.reply({
      content: buildReplyContent(null, ign, usedLinkedAccount),
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
    const resolved = await resolveCommandIgn(interaction, 'removing');
    if (!resolved) {
      return;
    }

    const { ign, usedLinkedAccount } = resolved;

    const normalizedIgn = normalizeIgn(ign);
    const existingEntries = store.getShitterEntries(interaction.guildId);
    const activeEntries = existingEntries.filter((entry) => entry.normalizedIgn === normalizedIgn && !entry.removedAt);

    if (activeEntries.length === 0) {
      await interaction.reply({
        content: buildReplyContent(null, ign, usedLinkedAccount),
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
      content: buildReplyContent(null, ign, usedLinkedAccount),
      embeds: [buildNoEntryEmbed({ ign, wasShitterInThePast: true })],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    });
  }

  async function handleShitterListCommand(interaction) {
    if (!(await ensureInGuild(interaction))) {
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
    async handlePagination(interaction) {
      if (!['shitter-list-page:', 'shitter-entry-page:', 'shitter-full:'].some(prefix => interaction.customId?.startsWith(prefix))) return false;
      const [action, owner, part, ...rest] = interaction.customId.split(':');
      if (owner !== interaction.user.id || !interaction.inGuild()) {
        await interaction.reply({ content: 'Open your own shitter list to browse it.', flags: MessageFlags.Ephemeral });
        return true;
      }
      if (action === 'shitter-list-page') {
        const total = getUniqueIgnEntries(interaction.guildId).length;
        const page = Math.max(0, Math.min(Math.max(0, Math.ceil(total / 15) - 1), Number(part) || 0));
        await interaction.update({ embeds: [buildListEmbed(interaction.guildId, page)], components: createPlayerSelectComponents({ guildId: interaction.guildId, userId: owner, page }), allowedMentions: { parse: [] } });
      } else {
        const entries = getActiveEntriesByIgn(interaction.guildId, part);
        const entry = action === 'shitter-full' ? entries.find(e => e.createdAt === rest.join(':')) : entries[Math.max(0, Math.min(Math.max(0, Math.ceil(entries.length / 15) - 1), Number(rest[0]) || 0)) * 15];
        if (!entry) { await interaction.reply({ content: 'This entry no longer exists.', flags: MessageFlags.Ephemeral }); return true; }
        if (action === 'shitter-full') {
          await pagedLists.open(interaction, { title: `Shitter Check: ${entry.ign}`, lines: [`Added: ${formatTimestamp(entry.createdAt)} by ${formatAddedByUser(entry.addedByUserId)}`, `Reason: ${entry.reason}`, ...entry.screenshots.map((image, index) => `${index + 1}. [Screenshot](${image.url})`)], update: false });
        } else {
          await interaction.update({ embeds: [buildQueryEmbed({ ign: entry.ign, entry, entryCount: entries.length })], components: [...createPlayerSelectComponents({ guildId: interaction.guildId, userId: owner, selectedIgn: part }), ...createEntrySelectComponents({ userId: owner, ign: part, entries, selectedCreatedAt: entry.createdAt })], allowedMentions: { parse: [] } });
        }
      }
      return true;
    },
    handleShitterCommand,
    handleShitterPlayerSelect,
    handleShitterEntrySelect
  };
}

module.exports = { createShitterListFeature };
