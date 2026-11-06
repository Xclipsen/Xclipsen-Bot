// `linkStore` is the mod backend client; Minecraft links are only stored there.
const HOW_TO_LINK = 'set your Discord in Hypixel (Profile → Social Media → Discord), then run `/link username:<ign>`';

function buildNotLinkedMessage(optionName) {
  return `No \`${optionName}:\` given and no linked Minecraft account found. Pass \`${optionName}:\`, or link your account: ${HOW_TO_LINK}.`;
}

async function resolveMinecraftUsernameOption({ interaction, linkStore, optionName }) {
  const requestedUsername = interaction.options.getString(optionName, false)?.trim();
  if (requestedUsername) {
    return {
      username: requestedUsername,
      usedLinkedAccount: false
    };
  }

  let linkedAccount;
  try {
    linkedAccount = await linkStore.getBridgeLinkedAccount(interaction.user.id);
  } catch (error) {
    console.warn(`Linked account lookup failed for ${interaction.user.id}:`, error.message);
    throw new Error(`Could not look up your linked Minecraft account right now. Pass \`${optionName}:\` or try again later.`);
  }

  const linkedUsernames = Array.isArray(linkedAccount?.minecraftUsernames) ? linkedAccount.minecraftUsernames : [];
  // The backend still flags links imported from the old code system until they are re-verified.
  if (linkedAccount?.requiresHypixelVerification && linkedUsernames.length > 0) {
    throw new Error(
      `Your existing Minecraft link was created with the old code system. Re-verify it: ${HOW_TO_LINK.replace('<ign>', linkedUsernames[0])}.`
    );
  }

  const linkedUsername = linkedAccount?.preferredMinecraftUsername || linkedUsernames[0] || null;
  if (linkedUsername) {
    return {
      username: linkedUsername,
      usedLinkedAccount: true
    };
  }

  throw new Error(buildNotLinkedMessage(optionName));
}

function buildLinkedUsernameNotice(username) {
  return `Using linked username \`${username}\`.`;
}

module.exports = {
  HOW_TO_LINK,
  buildLinkedUsernameNotice,
  resolveMinecraftUsernameOption
};
