const LINK_EVENT_CHOICES = {
  spiderRain: "Spider's Den Rain",
  spiderThunder: "Spider's Den Thunder",
  darkAuction: 'Dark Auction',
  jerrysWorkshop: "Jerry's Workshop",
  seasonOfJerry: 'Season of Jerry',
  newYearCelebration: 'New Year Celebration',
  bankInterest: 'Bank Interest',
  hoppitysHunt: "Hoppity's Hunt",
  travelingZoo: 'Traveling Zoo',
  spookyFishing: 'Spooky Fishing',
  spookyFestival: 'Spooky Festival'
};

function createLinkingFeature({ store }) {
  async function handleLinkCommand(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    if (subcommand === 'start') {
      const usernames = parseMinecraftUsernames(interaction.options.getString('usernames', true));
      if (usernames.length === 0) {
        await interaction.reply({ content: 'Add at least one valid Minecraft username.', ephemeral: true });
        return;
      }

      const result = store.startBridgeLink(userId, usernames);
      if (!result.ok) {
        await interaction.reply({ content: result.error, ephemeral: true });
        return;
      }

      store.setBridgeLinkedAccount(userId, {
        discordUsername: interaction.user.username,
        discordDisplayName: interaction.user.globalName || interaction.user.username
      });

      await interaction.reply({
        content: `Link code: \`${result.code}\`\nUse \`/link ${result.code}\` in Minecraft within 10 minutes.\nPending usernames: ${result.pendingMinecraftUsernames.join(', ')}`,
        ephemeral: true
      });
      return;
    }

    if (subcommand === 'status') {
      store.setBridgeLinkedAccount(userId, {
        discordUsername: interaction.user.username,
        discordDisplayName: interaction.user.globalName || interaction.user.username
      });
      const account = store.getBridgeLinkedAccount(userId);
      await interaction.reply({
        content: formatLinkStatus(account),
        ephemeral: true
      });
      return;
    }

    if (subcommand === 'unlink') {
      store.removeBridgeLinkedAccount(userId);
      await interaction.reply({ content: 'Link removed.', ephemeral: true });
      return;
    }

    if (subcommand === 'add') {
      store.setBridgeLinkedAccount(userId, {
        discordUsername: interaction.user.username,
        discordDisplayName: interaction.user.globalName || interaction.user.username
      });
      const usernames = parseMinecraftUsernames(interaction.options.getString('usernames', true));
      const result = store.addBridgeMinecraftUsernames(userId, usernames);
      await interaction.reply({ content: result.ok ? `Saved usernames: ${result.account.minecraftUsernames.join(', ')}` : result.error, ephemeral: true });
      return;
    }

    if (subcommand === 'remove') {
      store.setBridgeLinkedAccount(userId, {
        discordUsername: interaction.user.username,
        discordDisplayName: interaction.user.globalName || interaction.user.username
      });
      const result = store.removeBridgeMinecraftUsername(userId, interaction.options.getString('username', true));
      await interaction.reply({ content: result.ok ? `Remaining usernames: ${result.account.minecraftUsernames.join(', ') || 'none'}` : result.error, ephemeral: true });
      return;
    }

    if (subcommand === 'event') {
      store.setBridgeLinkedAccount(userId, {
        discordUsername: interaction.user.username,
        discordDisplayName: interaction.user.globalName || interaction.user.username
      });
      const eventKey = interaction.options.getString('event', true);
      const enabled = interaction.options.getBoolean('enabled', true);
      const result = store.setBridgeEventPreference(userId, eventKey, enabled);
      await interaction.reply({
        content: result.ok ? `${LINK_EVENT_CHOICES[eventKey] || eventKey} is now ${enabled ? 'enabled' : 'disabled'}.` : result.error,
        ephemeral: true
      });
    }
  }

  return {
    handleLinkCommand
  };
}

function parseMinecraftUsernames(value) {
  return [...new Set(String(value || '')
    .split(/[,\n]/)
    .map((entry) => String(entry || '').trim())
    .filter((entry) => /^[A-Za-z0-9_]{3,16}$/.test(entry)))];
}

function formatLinkStatus(account) {
  if (!account || account.minecraftUsernames.length === 0) {
    return 'Not linked yet. Use `/link start` on Discord and `/link CODE` in Minecraft.';
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

module.exports = { createLinkingFeature };
