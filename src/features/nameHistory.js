const { EmbedBuilder } = require('discord.js');
const { buildLinkedUsernameNotice, resolveMinecraftUsernameOption } = require('./linkedMinecraftUser');

const MAX_DESCRIPTION_LENGTH = 4095;

function createNameHistoryFeature({ minecraft, store }) {
  function getHistorySourceText(profile) {
    return profile.historySourceLabel || 'Unknown';
  }

  function formatDate(value) {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC'
    }).format(date);
  }

  function getPastNames(profile) {
    const currentName = String(profile.name || '').trim().toLowerCase();
    const seen = new Set();

    return [...profile.history]
      .sort((left, right) => {
        const leftTime = Date.parse(left?.changedAt) || 0;
        const rightTime = Date.parse(right?.changedAt) || 0;
        return rightTime - leftTime;
      })
      .filter((entry) => {
        const normalizedName = String(entry?.name || '').trim().toLowerCase();
        if (entry?.censored || !/^[a-z0-9_]{1,16}$/.test(normalizedName)
          || normalizedName === currentName || seen.has(normalizedName)) {
          return false;
        }

        seen.add(normalizedName);
        return true;
      });
  }

  function buildHistoryLines(pastNames, hasHiddenNames) {
    if (pastNames.length === 0) {
      return [hasHiddenNames
        ? 'No visible previous names available.'
        : 'No previous names recorded by this source.'];
    }

    return pastNames.map((entry, index) => {
      const changedAt = formatDate(entry.changedAt);

      if (changedAt) {
        return `${index + 1}. ${entry.name} (${entry.accurate === true ? '' : 'approx. '}${changedAt})`;
      }

      return `${index + 1}. ${entry.name}`;
    });
  }

  function appendHistoryLines(description, historyLines) {
    const prefix = `${description}\n\n\`\`\`text\n`;
    const suffix = '\n```';
    let visibleCount = 0;
    let linesLength = 0;

    for (const line of historyLines) {
      const nextLength = linesLength + (visibleCount > 0 ? 1 : 0) + line.length;
      const remaining = historyLines.length - visibleCount - 1;
      const omissionLength = remaining > 0 ? `\n... ${remaining} more names omitted.`.length : 0;
      if (prefix.length + nextLength + omissionLength + suffix.length > MAX_DESCRIPTION_LENGTH) {
        break;
      }

      linesLength = nextLength;
      visibleCount += 1;
    }

    const visibleLines = historyLines.slice(0, visibleCount);
    if (visibleCount < historyLines.length) {
      visibleLines.push(`... ${historyLines.length - visibleCount} more names omitted.`);
    }

    return `${prefix}${visibleLines.join('\n')}${suffix}`;
  }

  function buildNameHistoryEmbed(profile) {
    const pastNames = getPastNames(profile);
    const hasHiddenNames = profile.history.some((entry) => entry?.censored || entry?.name === '-');
    const historyUnavailable = profile.historyStatus === 'unavailable';
    const createdAt = formatDate(profile.createdAt);
    const meta = [
      `Past Names: \`${historyUnavailable ? 'Unknown' : pastNames.length}\``,
      `History Source: \`${getHistorySourceText(profile)}\``
    ];

    if (createdAt) {
      meta.push(`Account Created: \`${createdAt}\``);
    }

    const fetchedAt = profile.fetchedAt ? new Date(profile.fetchedAt).getTime() : NaN;
    if (!historyUnavailable && Number.isFinite(fetchedAt)) {
      meta.push(`History Fetched: <t:${Math.floor(fetchedAt / 1000)}:f>`);
    }

    const notices = [];
    if (profile.profileStale) {
      notices.push('Current profile could not be refreshed; showing the last known name.');
    }
    if (historyUnavailable) {
      notices.push('Name history is temporarily unavailable. Previous names could not be checked.');
    } else if (profile.historyStatus === 'stale') {
      notices.push('History refresh failed; showing cached names.');
    }
    if (!historyUnavailable && hasHiddenNames) {
      notices.push('Some names are hidden by the source.');
    }

    let description = [
      `${profile.profileStale ? 'Last Known Name' : 'Current Name'}: \`${profile.name}\``,
      `UUID: \`${minecraft.formatUuid(profile.uuid)}\``,
      ...meta,
      ...(notices.length > 0 ? ['', ...notices] : [])
    ].join('\n');
    if (!historyUnavailable) {
      description = appendHistoryLines(description, buildHistoryLines(pastNames, hasHiddenNames));
    }

    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Name History')
      .setThumbnail(`https://mc-heads.net/avatar/${encodeURIComponent(profile.uuid)}/256`)
      .setDescription(description)
      .setFooter({
        text: `${profile.profileStale ? 'Cached Minecraft profile' : 'Current profile from Mojang'} | History: ${getHistorySourceText(profile)}`
      })
      .setTimestamp();
  }

  async function handleNameHistoryCommand(interaction) {
    await interaction.deferReply();

    try {
      const { username, usedLinkedAccount } = await resolveMinecraftUsernameOption({
        interaction,
        store,
        optionName: 'player',
        missingMessage: 'No player provided and no linked Minecraft username found. Use `/link username:<ign>` first or pass `player:`.'
      });

      const player = username;
      const profile = await minecraft.fetchNameHistory(player);
      await interaction.editReply({
        content: usedLinkedAccount ? buildLinkedUsernameNotice(profile.name) : undefined,
        embeds: [buildNameHistoryEmbed(profile)]
      });
    } catch (error) {
      await interaction.editReply({
        content: error?.body?.description || error?.message || 'Failed to fetch name history.'
      });
    }
  }

  return {
    handleNameHistoryCommand
  };
}

module.exports = { createNameHistoryFeature };
