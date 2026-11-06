// Section buttons use the editor ids (`admin:<action>:<section>:<field>`, see setupHub/editor.js and setupHub/voiceEditor.js);
// retired setup-view-* ids are still routed there for panels that are open in Discord.
const interactionIds = {
  SETUP_VIEW_HOME_ID: 'setup-view-home',
  SETUP_VIEW_PLAYER_TOOLS_ID: 'setup-view-player-tools',
  REACTION_EDITOR_OPEN_ID: 'reaction-editor-open',
  MOD_RELEASES_ALL_ID: 'mod-releases-all'
};

module.exports = { interactionIds };
