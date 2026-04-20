function resolveMinecraftUsernameOption({
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

  const linkedUsername = store.getPreferredBridgeMinecraftUsername(interaction.user.id);
  if (linkedUsername) {
    return {
      username: linkedUsername,
      usedLinkedAccount: true
    };
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
