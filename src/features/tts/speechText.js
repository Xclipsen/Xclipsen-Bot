// Turns a Discord message into text the TTS service can read aloud.
// The service expands numbers and chat abbreviations; this only removes Discord markup.

const DEFAULT_MAX_LENGTH = 300;

function truncateAtWord(text, maxLength) {
  if (text.length <= maxLength) {
    return text;
  }

  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trim()} und so weiter`;
}

function toSpeechText(content, {
  resolveUser = () => null,
  resolveChannel = () => null,
  resolveRole = () => null,
  maxLength = DEFAULT_MAX_LENGTH
} = {}) {
  let text = String(content || '');

  text = text
    .replace(/```[\s\S]*?```/g, ' Codeblock ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\|\|[\s\S]*?\|\|/g, ' Spoiler ')
    .replace(/<@!?(\d+)>/g, (_, id) => ` ${resolveUser(id) || 'jemand'} `)
    .replace(/<#(\d+)>/g, (_, id) => ` ${resolveChannel(id) || 'ein Kanal'} `)
    .replace(/<@&(\d+)>/g, (_, id) => ` ${resolveRole(id) || 'eine Rolle'} `)
    .replace(/@(everyone|here)\b/g, ' alle ')
    .replace(/<a?:\w+:\d+>/g, ' ')
    .replace(/<t:-?\d+(?::[a-zA-Z])?>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' Link ')
    .replace(/\p{Extended_Pictographic}(‍\p{Extended_Pictographic}|️)*/gu, ' ')
    .replace(/^\s*(>+|#{1,3}|-#)\s+/gm, '')
    .replace(/[*_~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return truncateAtWord(text, maxLength);
}

// Display names such as "xX_Pro_Xx" or "Max 🔥" become "xX Pro Xx" and "Max".
function toSpeakerName(name) {
  return toSpeechText(name, { maxLength: 40 }).replace(/[|\\/[\]{}<>]+/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = { toSpeechText, toSpeakerName };
