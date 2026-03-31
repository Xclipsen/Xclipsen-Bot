const { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const { EVENT_DEFINITIONS, getCalendarEntries, formatCalendarEntry } = require('../eventCalendar');

const MAYOR_CANDIDATE_SELECT_ID = 'mayor-candidate-select';

function createMayorAlertEmbeds({ env, skyblock }) {
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

  function addCandidateFields(embed, currentElection, selectedMayorName) {
    const candidates = Array.isArray(currentElection?.candidates) ? currentElection.candidates : [];
    if (candidates.length === 0) {
      return;
    }

    const sortedCandidates = candidates
      .map((candidate) => ({
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

    embed.addFields({
      name: 'Election Candidates',
      value: sortedCandidates
        .slice(0, 5)
        .map((candidate) => {
          const isSelected = String(candidate.name).toLowerCase() === String(selectedMayorName || '').toLowerCase();
          if (candidate.votes === null) {
            return `**${isSelected ? `>> ${candidate.name}` : candidate.name}**\nNo vote data`;
          }

          const voteShare = formatVoteShare(candidate.votes, totalVotes);
          return `**${isSelected ? `>> ${candidate.name}` : candidate.name}**\n${buildVoteBar(candidate.votes, maxVotes)} ${formatCompactVoteCount(candidate.votes)}${voteShare ? ` | ${voteShare}` : ''}`;
        })
        .join('\n'),
      inline: false
    });
  }

  function getCandidateProfiles(currentElection) {
    const candidates = Array.isArray(currentElection?.candidates) ? currentElection.candidates : [];

    return candidates
      .map((candidate) => normalizeCandidateProfile(candidate))
      .filter(Boolean)
      .sort((left, right) => {
        if (right.votes !== null && left.votes !== null && right.votes !== left.votes) {
          return right.votes - left.votes;
        }
        return left.name.localeCompare(right.name);
      });
  }

  function createCandidateSelectComponents(currentElection) {
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
            candidateProfiles.slice(0, 25).map((profile) => ({
              label: profile.name,
              value: profile.key,
              description: `Show ${profile.name}'s perk list`
            }))
          )
      )
    ];
  }

  function createCandidatePerkEmbed(candidateProfile, emoji = '👤') {
    const perks = Array.isArray(candidateProfile?.perks) ? candidateProfile.perks : [];
    const ministerPerk = candidateProfile?.ministerPerk || null;

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`${emoji} ${candidateProfile?.name || 'Candidate'} Perks`)
      .setDescription(
        `If elected mayor, all listed perks become active. If elected minister, only the marked minister perk becomes active.\n\n${
        perks.length > 0
          ? perks.map((perk) => `- **${perk.name}**: ${skyblock.stripMinecraftFormatting(perk.description)}`).join('\n')
          : 'No perk data from API for this candidate.'
        }`
      );

    if (ministerPerk) {
      embed.addFields({
        name: 'Minister Perk',
        value: `**${ministerPerk.name}**: ${skyblock.stripMinecraftFormatting(ministerPerk.description)}`,
        inline: false
      });
    }

    return embed;
  }

  function getMayorHeadUrl(mayor) {
    return env.MAYOR_HEADS[String(mayor.key || '').toLowerCase()] || null;
  }

  function getMayorSkinLink(mayor) {
    return env.MAYOR_SKIN_LINKS[String(mayor.key || '').toLowerCase()] || null;
  }

  function createEventCalendarEmbed() {
    const calendarEntries = getCalendarEntries(Date.now())
      .sort((left, right) => (
        EVENT_DEFINITIONS.findIndex((definition) => definition.key === left.key) -
        EVENT_DEFINITIONS.findIndex((definition) => definition.key === right.key)
      ));

    return new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle('Event Calendar')
      .setDescription(calendarEntries.map((entry) => formatCalendarEntry(entry)).join('\n\n') || 'No event data found.')
      .setFooter({ text: 'Shows the current or next window for each tracked event.' })
      .setTimestamp();
  }

  function createMayorEmbed(title, emoji, mayor, boothOpen, currentElection = null) {
    const skyBlockDate = skyblock.formatSkyBlockDate(title === 'SkyBlock Status Update' ? env.STATUS_UPDATE_MINUTES : env.CHECK_INTERVAL_MINUTES);
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`${emoji} ${title}`)
      .addFields(
        { name: 'Mayor', value: `${mayor.name} (${mayor.key})`, inline: true },
        {
          name: 'Minister',
          value: mayor.minister
            ? `${mayor.minister.name} - ${skyblock.stripMinecraftFormatting(mayor.minister.perk.name)}`
            : 'None',
          inline: true
        },
        { name: 'Election Booth', value: boothOpen ? 'Open' : 'Closed', inline: true },
        { name: boothOpen ? 'Election Ends' : 'Next Election Opens', value: skyblock.getElectionTimingLine(boothOpen), inline: false },
        { name: 'Perks', value: formatMayorPerks(mayor), inline: false }
      )
      .setFooter({ text: `SkyBlock Date: ${skyBlockDate}` })
      .setTimestamp();

    addCandidateFields(embed, currentElection, mayor.name);

    const skinLink = getMayorSkinLink(mayor);
    if (skinLink) {
      embed.addFields({ name: 'Skin', value: `[View mayor skin](${skinLink})`, inline: false });
    }

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

module.exports = { createMayorAlertEmbeds };
