const { EmbedBuilder, escapeMarkdown } = require('discord.js');
const { buildLinkedUsernameNotice, resolveMinecraftUsernameOption } = require('./linkedMinecraftUser');

const MAX_DESCRIPTION_LENGTH = 4095;
// Discord limits all embeds of one message to 6000 characters in total.
const MAX_MESSAGE_EMBED_LENGTH = 5900;
const MAX_OWNERS_LENGTH = 2400;
// Names shown around the looked-up name in another account's name chain.
const CHAIN_CONTEXT = 3;
// Title and footer of the name history embed (footer holds two source labels).
const EMBED_CHROME_LENGTH = 150;

function embedLength(embed) {
  const data = embed.toJSON();
  return [data.title, data.description, data.footer?.text].reduce((sum, text) => sum + (text?.length || 0), 0);
}

function createNameHistoryFeature({ minecraft, linkStore }) {
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

  function buildHistoryLines(pastNames, hasHiddenNames, markedName = null) {
    if (pastNames.length === 0) {
      return [hasHiddenNames
        ? 'No visible previous names available.'
        : 'No previous names recorded by this source.'];
    }

    return pastNames.map((entry, index) => {
      const changedAt = formatDate(entry.changedAt);
      const marker = markedName && entry.name.toLowerCase() === markedName.toLowerCase() ? '  <- searched' : '';

      if (changedAt) {
        return `${index + 1}. ${entry.name} (${entry.accurate === true ? '' : 'approx. '}${changedAt})${marker}`;
      }

      return `${index + 1}. ${entry.name}${marker}`;
    });
  }

  function appendHistoryLines(description, historyLines, maxLength = MAX_DESCRIPTION_LENGTH, noun = 'names', codeBlock = true) {
    const prefix = codeBlock ? `${description}\n\n\`\`\`text\n` : `${description}\n\n`;
    const suffix = codeBlock ? '\n```' : '';
    let visibleCount = 0;
    let linesLength = 0;

    for (const line of historyLines) {
      const nextLength = linesLength + (visibleCount > 0 ? 1 : 0) + line.length;
      const remaining = historyLines.length - visibleCount - 1;
      const omissionLength = remaining > 0 ? `\n... ${remaining} more ${noun} omitted.`.length : 0;
      if (prefix.length + nextLength + omissionLength + suffix.length > maxLength) {
        break;
      }

      linesLength = nextLength;
      visibleCount += 1;
    }

    const visibleLines = historyLines.slice(0, visibleCount);
    if (visibleCount < historyLines.length) {
      visibleLines.push(`... ${historyLines.length - visibleCount} more ${noun} omitted.`);
    }

    return `${prefix}${visibleLines.join('\n')}${suffix}`;
  }

  function formatPeriod(period) {
    const from = formatDate(period.from);
    const to = period.current ? 'now' : formatDate(period.to);
    const approx = period.accurate ? '' : 'approx. ';
    return `${from ? `${approx}${from}` : 'first name'} – ${to === 'now' || !to ? (to || 'unknown') : `${approx}${to}`}`;
  }

  // The account's names in order, with the looked-up name in bold.
  function buildNameChain(profile, searchedName) {
    const key = searchedName.toLowerCase();
    const names = [...profile.history]
      .filter((entry) => !entry.censored && entry.name !== '-')
      .sort((left, right) => (Date.parse(left.changedAt) || 0) - (Date.parse(right.changedAt) || 0))
      .map((entry) => entry.name);
    if (!names.some((name) => name.toLowerCase() === profile.name.toLowerCase())) {
      names.push(profile.name);
    }
    const first = names.findIndex((name) => name.toLowerCase() === key);
    const last = names.findLastIndex((name) => name.toLowerCase() === key);
    const start = first < 0 ? 0 : Math.max(0, first - CHAIN_CONTEXT);
    const end = last < 0 ? names.length : Math.min(names.length, last + CHAIN_CONTEXT + 1);
    const parts = names.slice(start, end).map((name) => (name.toLowerCase() === key
      ? `**${escapeMarkdown(name)}**` : escapeMarkdown(name)));
    return `${start > 0 ? '… → ' : ''}${parts.join(' → ')}${end < names.length ? ' → …' : ''}`;
  }

  function buildOwnerLines(nameOwners) {
    return nameOwners.owners.map((owner, index) => {
      const lines = [`**${index + 1}. ${escapeMarkdown(owner.name)}** · \`${minecraft.formatUuid(owner.uuid)}\``];
      if (owner.periods?.length) {
        lines.push(`Had **${escapeMarkdown(nameOwners.name)}**: ${owner.periods.map(formatPeriod).join(', ')}`);
      } else if (formatDate(owner.changedAt)) {
        lines.push(`Had **${escapeMarkdown(nameOwners.name)}**: from approx. ${formatDate(owner.changedAt)}`);
      } else {
        lines.push(`Had **${escapeMarkdown(nameOwners.name)}**: date unknown`);
      }
      if (owner.profile) {
        lines.push(buildNameChain(owner.profile, nameOwners.name));
      }
      return lines.join('\n');
    });
  }

  // Other accounts that have used the looked-up name. Kept short enough that
  // both embeds together stay below Discord's 6000 character message limit.
  function buildNameOwnersEmbed(nameOwners, { unclaimed = false } = {}) {
    const count = nameOwners.owners.length;
    const intro = unclaimed
      ? [`\`${nameOwners.name}\` is not used by any account right now.`, `Previous Owners: \`${count}\``]
      : [`Other Accounts: \`${count}\``];
    if (count > 0 && !unclaimed) {
      intro[0] += ' (newest first)';
    }
    if (nameOwners.status === 'unavailable') {
      intro.push('', 'Owner lookup is temporarily unavailable; showing only locally known accounts.');
    }
    const description = count > 0
      ? appendHistoryLines(intro.join('\n'), buildOwnerLines(nameOwners), unclaimed ? MAX_DESCRIPTION_LENGTH : MAX_OWNERS_LENGTH, 'accounts', false)
      : `${intro.join('\n')}\n\nNo other accounts are known to have used this name.`;

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(unclaimed ? `Name History: ${nameOwners.name}`
        : `${nameOwners.former ? 'Other accounts' : 'Everyone'} who used ${nameOwners.name}`)
      .setDescription(description)
      .setFooter({ text: 'Accounts from Crafty.gg and cached name histories' });
    if (unclaimed) {
      embed.setTimestamp();
    }
    return embed;
  }

  function buildNameHistoryEmbed(profile, maxDescriptionLength = MAX_DESCRIPTION_LENGTH) {
    const pastNames = getPastNames(profile);
    const hasHiddenNames = profile.history.some((entry) => entry?.censored || entry?.name === '-');
    const historyUnavailable = profile.historyStatus === 'unavailable';
    const meta = [
      `Past Names: \`${historyUnavailable ? 'Unknown' : pastNames.length}\``,
      `History Source: \`${getHistorySourceText(profile)}\``
    ];

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

    const formerNotice = profile.formerName
      ? [`**${escapeMarkdown(profile.formerName)}** is a former name of **${escapeMarkdown(profile.name)}**${
        profile.formerNamePeriods?.length ? ` (${profile.formerNamePeriods.map(formatPeriod).join(', ')})` : ''}.`, '']
      : [];
    let description = [
      ...formerNotice,
      `${profile.profileStale ? 'Last Known Name' : 'Current Name'}: \`${profile.name}\``,
      `UUID: \`${minecraft.formatUuid(profile.uuid)}\``,
      ...meta,
      ...(notices.length > 0 ? ['', ...notices] : [])
    ].join('\n');
    if (!historyUnavailable) {
      description = appendHistoryLines(description, buildHistoryLines(pastNames, hasHiddenNames, profile.formerName), maxDescriptionLength);
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
        linkStore,
        optionName: 'player'
      });

      const profile = await minecraft.fetchNameHistory(username);
      if (profile.unclaimed) {
        await interaction.editReply({ embeds: [buildNameOwnersEmbed(profile.nameOwners, { unclaimed: true })] });
        return;
      }
      const ownersEmbed = profile.nameOwners ? buildNameOwnersEmbed(profile.nameOwners) : null;
      const ownersLength = ownersEmbed ? embedLength(ownersEmbed) : 0;
      const historyEmbed = buildNameHistoryEmbed(profile,
        Math.min(MAX_DESCRIPTION_LENGTH, MAX_MESSAGE_EMBED_LENGTH - ownersLength - EMBED_CHROME_LENGTH));
      await interaction.editReply({
        content: usedLinkedAccount ? buildLinkedUsernameNotice(profile.name) : undefined,
        embeds: ownersEmbed ? [historyEmbed, ownersEmbed] : [historyEmbed]
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
