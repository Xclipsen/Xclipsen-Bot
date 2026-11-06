const { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const { getCalendarEntries, formatCalendarDescription } = require('../eventCalendar');
const { formatPerkpocalypseField, getPerkpocalypseStateWith } = require('../jerryRotation');
const { NO_APP_EMOJIS } = require('../../utils/appEmojis');

const MAYOR_CANDIDATE_SELECT_ID = 'mayor-candidate-select';
const MINISTER_PERK_MARKER = '✯';
// ./data.js also recognises status posts by this title.
const STATUS_UPDATE_TITLE = 'SkyBlock Status Update';
const DEFAULT_MAYOR_EMOJI = '👤';

const CUSTOM_EMOJI_PATTERN = /^<(a?):([^:>]+):(\d+)>$/;

function isCustomEmojiToken(value) {
  return CUSTOM_EMOJI_PATTERN.test(String(value || ''));
}

// Component emoji object ({ id, name, animated }) of a custom emoji token, or null.
function toComponentEmoji(value) {
  const match = String(value || '').match(CUSTOM_EMOJI_PATTERN);
  return match ? { id: match[3], name: match[2], animated: match[1] === 'a' } : null;
}

// The API key is the mayor's role (e.g. 'slayer' for Aatrox), so names come first.
function getMayorLookupKeys(mayor) {
  return [...new Set([mayor?.name, mayor?.key]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean))];
}

// Application emoji of the mayor's head (assets/app-emojis, `mayor_<name>`), or null.
function getMayorAppEmoji(appEmojis, mayor) {
  const emojiName = getMayorLookupKeys(mayor)
    .map((key) => `mayor_${key.replace(/[^a-z0-9_]/g, '')}`)
    .find((name) => appEmojis.has(name));
  return emojiName ? appEmojis.get(emojiName) : null;
}

// Unicode emoji of a mayor for places that do not render custom emojis (embed titles).
function getMayorUnicodeEmoji(env, mayor) {
  const configured = getMayorLookupKeys(mayor).map((key) => env.MAYOR_EMOJIS[key]).find(Boolean);
  return configured && !isCustomEmojiToken(configured) ? configured : DEFAULT_MAYOR_EMOJI;
}

// getMayorFetchedAt: when the shown election data was fetched, so a cached mayor from the
// previous term does not show term-bound events.
// appEmojis: item icons for the calendar and mayor heads (src/utils/appEmojis.js); Unicode fallbacks without it.
function createMayorAlertEmbeds({ env, skyblock, jerryRotation = null, now = Date.now, getMayorFetchedAt = () => null, appEmojis = NO_APP_EMOJIS }) {
  // Head emoji shown in front of mayor names in field values; '' keeps the plain name.
  function getDefaultMayorIcon(mayor) {
    return getMayorAppEmoji(appEmojis, mayor) || '';
  }

  function withMayorIcon(mayorIcon, mayor, text) {
    const icon = mayorIcon(mayor);
    return icon ? `${icon} ${text}` : text;
  }

  function normalizeCandidateProfile(candidate) {
    const perks = Array.isArray(candidate?.perks) && candidate.perks.length > 0
      ? candidate.perks.map((perk) => ({
        name: perk.name,
        description: perk.description,
        minister: Boolean(perk.minister)
      }))
      : [];

    return {
      key: candidate?.key || String(candidate?.name || '').trim().toLowerCase(),
      name: candidate?.name || 'Unknown',
      perks,
      ministerPerk: perks.find((perk) => perk.minister) || null,
      votes: getCandidateVoteCount(candidate)
    };
  }

  function formatMayorPerks(mayor) {
    const perks = Array.isArray(mayor.perks) ? mayor.perks : [];
    if (!perks.length) {
      return '- No perks found';
    }

    return perks
      .map((perk) => `- **${perk.name}**: ${skyblock.stripMinecraftFormatting(perk.description)}`)
      .join('\n');
  }

  function formatPerkLine(perk, prefix = null) {
    if (!perk) {
      return null;
    }

    const label = prefix ? `${prefix} ` : '';
    return `${label}**${perk.name}**: ${skyblock.stripMinecraftFormatting(perk.description)}`;
  }

  function getCandidateVoteCount(candidate) {
    const value = Number(candidate?.votes);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function formatCompactVoteCount(value) {
    const number = Number(value || 0);
    if (number >= 1000000) {
      return `${Math.round(number / 1000000)}m`;
    }
    if (number >= 1000) {
      return `${Math.round(number / 1000)}k`;
    }
    return String(number);
  }

  function formatVoteShare(value, totalVotes) {
    if (!totalVotes || totalVotes <= 0) {
      return null;
    }

    return `${Math.round((value / totalVotes) * 100)}%`;
  }

  function compactCustomEmojiToken(value, fallbackName) {
    const match = String(value || '').match(/^<(a?):[^:>]+:(\d+)>$/);
    if (!match) {
      return value;
    }

    return match[1] === 'a'
      ? `<a:${fallbackName}:${match[2]}>`
      : `<:${fallbackName}:${match[2]}>`;
  }

  function buildVoteBar(value, maxValue, length = 5) {
    const filledEmoji = compactCustomEmojiToken(env.VOTE_BAR_FILLED_EMOJI, 'f');
    const emptyEmoji = compactCustomEmojiToken(env.VOTE_BAR_EMPTY_EMOJI, 'e');

    if (!maxValue || maxValue <= 0) {
      return emptyEmoji.repeat(length);
    }

    const filled = Math.max(1, Math.round((value / maxValue) * length));
    return `${filledEmoji.repeat(Math.min(length, filled))}${emptyEmoji.repeat(Math.max(0, length - filled))}`;
  }

  function addCandidateFields(embed, currentElection, minister = null, mayorIcon = getDefaultMayorIcon) {
    const candidates = Array.isArray(currentElection?.candidates) ? currentElection.candidates : [];
    if (candidates.length === 0) {
      return;
    }

    const sortedCandidates = candidates
      .map((candidate) => ({
        key: candidate.key,
        name: candidate.name || 'Unknown',
        votes: getCandidateVoteCount(candidate)
      }))
      .sort((left, right) => {
        if (right.votes !== null && left.votes !== null && right.votes !== left.votes) {
          return right.votes - left.votes;
        }
        if (right.votes !== null) {
          return 1;
        }
        if (left.votes !== null) {
          return -1;
        }
        return left.name.localeCompare(right.name);
      });

    const maxVotes = sortedCandidates.reduce((highest, candidate) => Math.max(highest, candidate.votes || 0), 0);
    const totalVotes = sortedCandidates.reduce((sum, candidate) => sum + (candidate.votes || 0), 0);
    const ministerPerkPreview = minister?.perk
      ? [
        `${MINISTER_PERK_MARKER} **${skyblock.stripMinecraftFormatting(minister.perk.name)}**`,
        skyblock.stripMinecraftFormatting(minister.perk.description)
      ].filter(Boolean)
      : [];

    embed.addFields({
      name: 'Election Candidates',
      value: [
        ...ministerPerkPreview,
        ...(
          ministerPerkPreview.length > 0
            ? ['']
            : []
        ),
        ...sortedCandidates
        .slice(0, 5)
        .map((candidate) => {
          const name = withMayorIcon(mayorIcon, candidate, candidate.name);
          if (candidate.votes === null) {
            return `${name}\nNo vote data`;
          }

          const voteShare = formatVoteShare(candidate.votes, totalVotes);
          return `${name}\n${buildVoteBar(candidate.votes, maxVotes)} ${formatCompactVoteCount(candidate.votes)}${voteShare ? ` | ${voteShare}` : ''}`;
        })
      ].join('\n'),
      inline: false
    });
  }

  function getCandidateProfiles(currentElection) {
    const candidates = Array.isArray(currentElection?.candidates) ? currentElection.candidates : [];

    return candidates
      .map((candidate) => normalizeCandidateProfile(candidate))
      .sort((left, right) => {
        if (right.votes !== null && left.votes !== null && right.votes !== left.votes) {
          return right.votes - left.votes;
        }
        return left.name.localeCompare(right.name);
      });
  }

  // Select options take the head as their own emoji (labels do not render custom emojis).
  function createCandidateSelectComponents(currentElection, mayorIcon = getDefaultMayorIcon) {
    const candidateProfiles = getCandidateProfiles(currentElection);
    if (candidateProfiles.length === 0) {
      return [];
    }

    return [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(MAYOR_CANDIDATE_SELECT_ID)
          .setPlaceholder('View candidate perks')
          .addOptions(
            candidateProfiles.slice(0, 25).map((profile) => {
              const emoji = toComponentEmoji(mayorIcon(profile));
              return {
                label: profile.name,
                value: profile.key,
                description: `Show ${profile.name}'s perk list`,
                ...(emoji ? { emoji } : {})
              };
            })
          )
      )
    ];
  }

  function createCandidatePerkEmbed(candidateProfile, emoji = DEFAULT_MAYOR_EMOJI) {
    const perks = Array.isArray(candidateProfile?.perks) ? candidateProfile.perks : [];
    const titleEmoji = isCustomEmojiToken(emoji) ? getMayorUnicodeEmoji(env, candidateProfile) : emoji;

    return new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`${titleEmoji} ${candidateProfile?.name || 'Candidate'} Perks`)
      .setDescription(
        `If elected mayor, all listed perks become active. If elected minister, only the marked minister perk becomes active.\n\n${
        perks.length > 0
          ? perks
            .map((perk) => formatPerkLine(perk, perk.minister ? MINISTER_PERK_MARKER : '•'))
            .join('\n')
          : 'No perk data from API for this candidate.'
        }`
      );
  }

  function getMayorHeadUrl(mayor) {
    return getMayorLookupKeys(mayor).map((key) => env.MAYOR_HEADS[key]).find(Boolean) || null;
  }

  function createEventCalendarEmbed(mayor = null) {
    const calendarEntries = getCalendarEntries(now(), { mayor, mayorFetchedAt: getMayorFetchedAt(), jerryRotation });

    return new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle('Event Calendar')
      .setDescription(formatCalendarDescription(calendarEntries, { getIcon: (entry) => appEmojis.get(entry.icon, entry.emoji) }))
      .setFooter({ text: 'Shows the current or next window for each tracked event.' })
      .setTimestamp();
  }

  function getPerkpocalypseField(mayor, mayorIcon) {
    return formatPerkpocalypseField(
      getPerkpocalypseStateWith(jerryRotation, now(), mayor, { mayorFetchedAt: getMayorFetchedAt() }),
      { mayorIcon: (name) => mayorIcon({ name }) }
    );
  }

  // emoji: the mayor's emoji. A custom one (guild or head emoji) goes in front of the name in the
  // Mayor field, a Unicode one into the title, which does not render custom emojis.
  // options.mayorIcon(mayor) gives the custom head emoji for mayor names ('' for none).
  function createMayorEmbed(emoji, mayor, boothOpen, currentElection = null, { mayorIcon = getDefaultMayorIcon } = {}) {
    const skyBlockDate = skyblock.formatSkyBlockDate(env.STATUS_UPDATE_MINUTES);
    const titleEmoji = isCustomEmojiToken(emoji) ? getMayorUnicodeEmoji(env, mayor) : emoji;
    const mayorFieldIcon = isCustomEmojiToken(emoji) ? emoji : mayorIcon(mayor);
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`${titleEmoji} ${STATUS_UPDATE_TITLE}`)
      .addFields(
        { name: 'Mayor', value: withMayorIcon(() => mayorFieldIcon, mayor, `${mayor.name} (${mayor.key})`), inline: true },
        {
          name: 'Minister',
          value: mayor.minister
            ? `${withMayorIcon(mayorIcon, mayor.minister, mayor.minister.name)} - ${skyblock.stripMinecraftFormatting(mayor.minister.perk.name)}`
            : 'None',
          inline: true
        },
        { name: 'Election Booth', value: boothOpen ? 'Open' : 'Closed', inline: true },
        { name: boothOpen ? 'Election Ends' : 'Next Election Opens', value: skyblock.getElectionTimingLine(boothOpen), inline: false },
        { name: 'Perks', value: formatMayorPerks(mayor), inline: false }
      )
      .setFooter({ text: `SkyBlock Date: ${skyBlockDate}` })
      .setTimestamp();

    const perkpocalypseField = getPerkpocalypseField(mayor, mayorIcon);
    if (perkpocalypseField) {
      embed.addFields(perkpocalypseField);
    }

    addCandidateFields(embed, currentElection, mayor.minister, mayorIcon);

    const headUrl = getMayorHeadUrl(mayor);
    if (headUrl) {
      embed.setThumbnail(headUrl);
    }

    return embed;
  }

  return {
    createEventCalendarEmbed,
    createMayorEmbed,
    createCandidateSelectComponents,
    createCandidatePerkEmbed,
    getCandidateProfiles,
    MAYOR_CANDIDATE_SELECT_ID
  };
}

module.exports = {
  createMayorAlertEmbeds,
  getMayorAppEmoji,
  getMayorLookupKeys,
  getMayorUnicodeEmoji,
  isCustomEmojiToken,
  DEFAULT_MAYOR_EMOJI,
  STATUS_UPDATE_TITLE
};
