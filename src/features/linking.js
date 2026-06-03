const { EVENT_DEFINITIONS } = require('./eventCalendar');

const HYPIXEL_PLAYER_URL = 'https://api.hypixel.net/v2/player';
const REQUEST_HEADERS = { 'User-Agent': 'hypixel-mayor-discord-bot/1.0.0' };

const LINK_EVENT_CHOICES = Object.fromEntries(
  EVENT_DEFINITIONS.map((definition) => [definition.key, definition.label])
);

function createLinkingFeature({ store, env, minecraft }) {
  async function handleLinkCommand(interaction) {
    const userId = interaction.user.id;
    const usernamesInput = interaction.options.getString('username', false);
    const removeInput = interaction.options.getString('remove', false);
    const eventKey = interaction.options.getString('event', false);
    const enabled = interaction.options.getBoolean('enabled', false);
    const unlink = interaction.options.getBoolean('unlink', false) === true;
    const selectedActions = [
      usernamesInput ? 'username' : null,
      removeInput ? 'remove' : null,
      eventKey || enabled !== null ? 'event' : null,
      unlink ? 'unlink' : null
    ].filter(Boolean);

    if (selectedActions.length > 1) {
      await interaction.reply({
        content: 'Use only one `/link` action at a time: `username`, `remove`, `event`+`enabled`, or `unlink:true`.',
        ephemeral: true
      });
      return;
    }

    if (usernamesInput) {
      await interaction.deferReply({ ephemeral: true });

      const usernames = parseMinecraftUsernames(usernamesInput);
      if (usernames.length === 0) {
        await interaction.editReply({ content: 'Add at least one valid Minecraft username.' });
        return;
      }

      const verification = await verifyMinecraftUsernamesForDiscord(interaction, usernames);
      if (!verification.ok) {
        await interaction.editReply({ content: verification.error });
        return;
      }

      const result = await store.linkVerifiedBridgeMinecraftUsernames(
        userId,
        verification.usernames,
        getDiscordAccountMetadata(interaction)
      );

      await interaction.editReply({
        content: result.ok
          ? `Linked usernames: ${result.account.minecraftUsernames.join(', ')}`
          : result.error
      });
      return;
    }

    if (unlink) {
      await store.removeBridgeLinkedAccount(userId);
      await interaction.reply({ content: 'Link removed.', ephemeral: true });
      return;
    }

    if (removeInput) {
      const result = await store.removeBridgeMinecraftUsername(userId, removeInput);
      await interaction.reply({ content: result.ok ? `Remaining usernames: ${result.account.minecraftUsernames.join(', ') || 'none'}` : result.error, ephemeral: true });
      return;
    }

    if (eventKey || enabled !== null) {
      if (!eventKey || enabled === null) {
        await interaction.reply({
          content: 'Set both `event` and `enabled` to toggle an event ping.',
          ephemeral: true
        });
        return;
      }

      const account = await store.getBridgeLinkedAccount(userId);
      if (account?.requiresHypixelVerification) {
        await interaction.reply({
          content: formatLegacyLinkMessage(account),
          ephemeral: true
        });
        return;
      }

      const result = await store.setBridgeEventPreference(userId, eventKey, enabled);
      await interaction.reply({
        content: result.ok ? `${LINK_EVENT_CHOICES[eventKey] || eventKey} is now ${enabled ? 'enabled' : 'disabled'}.` : result.error,
        ephemeral: true
      });
      return;
    }

    const account = await store.getBridgeLinkedAccount(userId);
    await interaction.reply({
      content: formatLinkStatus(account),
      ephemeral: true
    });
  }

  async function verifyMinecraftUsernamesForDiscord(interaction, usernames) {
    if (!env?.HYPIXEL_API_KEY) {
      return {
        ok: false,
        error: 'Hypixel API verification is not configured. Set `HYPIXEL_API_KEY` before using `/link username:<ign>`.'
      };
    }

    const verifiedUsernames = [];
    const failures = [];

    for (const username of usernames) {
      try {
        const profile = await minecraft.resolvePlayerProfile(username);
        const hypixelPlayer = await fetchHypixelPlayer(profile.uuid);
        const linkedDiscord = extractHypixelDiscordUsername(hypixelPlayer);

        if (!linkedDiscord) {
          failures.push(`${profile.name}: no Discord account is set in Hypixel Social Media.`);
          continue;
        }

        if (!doesHypixelDiscordMatchUser(linkedDiscord, interaction.user)) {
          failures.push(`${profile.name}: Hypixel has \`${linkedDiscord}\`, but your Discord is \`${formatDiscordUserForLink(interaction.user)}\`.`);
          continue;
        }

        verifiedUsernames.push(profile.name);
      } catch (error) {
        failures.push(`${username}: ${error.message}`);
      }
    }

    if (failures.length > 0) {
      return {
        ok: false,
        error: [
          'Could not verify every Minecraft username through Hypixel.',
          ...failures,
          'Set your Discord in Hypixel Social Media to your current Discord username, then try again.'
        ].join('\n')
      };
    }

    return { ok: true, usernames: verifiedUsernames };
  }

  async function fetchHypixelPlayer(uuid) {
    const url = new URL(HYPIXEL_PLAYER_URL);
    url.searchParams.set('uuid', String(uuid || '').replace(/-/g, ''));

    const response = await fetch(url, {
      headers: {
        ...REQUEST_HEADERS,
        'API-Key': env.HYPIXEL_API_KEY
      }
    });

    if (response.status === 403) {
      throw new Error('Hypixel API key is invalid or not allowed.');
    }

    if (response.status === 429) {
      throw new Error('Hypixel API rate limit reached. Try again later.');
    }

    if (!response.ok) {
      throw new Error(`Hypixel player lookup failed (${response.status}).`);
    }

    const data = await response.json();
    if (!data.success) {
      throw new Error('Hypixel player lookup did not succeed.');
    }

    if (!data.player) {
      throw new Error('No Hypixel player data found.');
    }

    return data.player;
  }

  return {
    handleLinkCommand
  };
}

function getDiscordAccountMetadata(interaction) {
  return {
    discordUsername: interaction.user.username,
    discordDisplayName: interaction.user.globalName || interaction.user.username
  };
}

function parseMinecraftUsernames(value) {
  return [...new Set(String(value || '')
    .split(/[,\n]/)
    .map((entry) => String(entry || '').trim())
    .filter((entry) => /^[A-Za-z0-9_]{3,16}$/.test(entry)))];
}

function extractHypixelDiscordUsername(player) {
  const value = player?.socialMedia?.links?.DISCORD;
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeDiscordUsername(value) {
  return String(value || '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

function getDiscordUserLinkCandidates(user) {
  return [...new Set([
    user.username,
    user.tag,
    user.discriminator && user.discriminator !== '0' ? `${user.username}#${user.discriminator}` : null
  ]
    .map(normalizeDiscordUsername)
    .filter(Boolean))];
}

function doesHypixelDiscordMatchUser(hypixelDiscord, user) {
  const normalizedHypixelDiscord = normalizeDiscordUsername(hypixelDiscord);
  return getDiscordUserLinkCandidates(user).includes(normalizedHypixelDiscord);
}

function formatDiscordUserForLink(user) {
  if (user.discriminator && user.discriminator !== '0') {
    return `${user.username}#${user.discriminator}`;
  }

  return user.username || user.tag || 'unknown';
}

function formatLinkStatus(account) {
  if (!account || account.minecraftUsernames.length === 0) {
    return 'Not linked yet. Set your Discord in Hypixel Social Media, then use `/link username:<ign>`.';
  }

  if (account.requiresHypixelVerification) {
    return formatLegacyLinkMessage(account);
  }

  const enabledEvents = Object.entries(account.eventPreferences || {})
    .filter(([, enabled]) => enabled)
    .map(([eventKey]) => LINK_EVENT_CHOICES[eventKey] || eventKey);

  return [
    `Linked usernames: ${account.minecraftUsernames.join(', ')}`,
    `Linked since: ${account.linkedAt ? `<t:${Math.floor(account.linkedAt / 1000)}:f>` : 'unknown'}`,
    `Enabled event pings: ${enabledEvents.join(', ') || 'none'}`,
    account.linkCode ? `Pending code: \`${account.linkCode}\`` : null,
    account.pendingMinecraftUsernames?.length ? `Pending usernames: ${account.pendingMinecraftUsernames.join(', ')}` : null
  ].filter(Boolean).join('\n');
}

function formatLegacyLinkMessage(account) {
  const username = account?.minecraftUsernames?.[0] || '<ign>';
  return [
    'Your existing Minecraft link was created with the old code system and must be re-verified through Hypixel.',
    account?.minecraftUsernames?.length ? `Legacy usernames: ${account.minecraftUsernames.join(', ')}` : null,
    `Use \`/link username:${username}\` after setting your Discord in Hypixel Social Media.`
  ].filter(Boolean).join('\n');
}

module.exports = { createLinkingFeature };
