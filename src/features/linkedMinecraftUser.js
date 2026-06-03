async function resolveMinecraftUsernameOption({
  interaction,
  store,
  optionName,
  missingMessage
}) {
  const requestedUsername = interaction.options.getString(optionName, false)?.trim();
  if (requestedUsername) {
    return {
      username: requestedUsername,
      usedLinkedAccount: false
    };
  }

  const linkedAccount = await store.getBridgeLinkedAccount(interaction.user.id);
  const linkedUsername = linkedAccount?.preferredMinecraftUsername || linkedAccount?.minecraftUsernames?.[0] || null;
  if (linkedUsername) {
    return {
      username: linkedUsername,
      usedLinkedAccount: true
    };
  }

  if (linkedAccount?.requiresHypixelVerification && linkedAccount.minecraftUsernames.length > 0) {
    throw new Error(
      `Your existing Minecraft link was created with the old code system. Re-verify it with \`/link username:${linkedAccount.minecraftUsernames[0]}\`.`
    );
  }

  throw new Error(missingMessage);
}

function buildLinkedUsernameNotice(username) {
  return `Using linked username \`${username}\`.`;
}

module.exports = {
  buildLinkedUsernameNotice,
  resolveMinecraftUsernameOption
};
