const helpSections = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    summary: 'Core setup and server configuration commands.',
    commands: [
      {
        command: '/help [section]',
        description: 'Show the bot command guide with grouped examples.',
        example: '/help section:player-tools'
      },
      {
        command: '/setup',
        description: 'Open the setup hub for mayor alerts, mod update tracking, reaction roles, and shitter permissions.',
        example: '/setup',
        adminOnly: true
      },
      {
        command: '/reactionrole add',
        description: 'Add a reaction role binding to a target message.',
        example: '/reactionrole add channel:#roles message_id:123 role:@Member emoji:<emoji>',
        adminOnly: true
      },
      {
        command: '/reactionrole list',
        description: 'List all configured reaction role bindings for this server.',
        example: '/reactionrole list',
        adminOnly: true
      },
      {
        command: '/reactionrole purge',
        description: 'Delete reaction role bindings globally or for one channel/message.',
        example: '/reactionrole purge channel:#roles message_id:123',
        adminOnly: true
      }
    ]
  },
  {
    id: 'player-tools',
    label: 'Player Tools',
    summary: 'Minecraft lookups and quick media utilities anyone can use.',
    commands: [
      {
        command: '/uuid player:<ign>',
        description: 'Look up a Mojang UUID and percentile-style UUID ranking.',
        example: '/uuid player:Xclipsen'
      },
      {
        command: '/namehistory player:<ign>',
        description: 'Show the current Minecraft name plus known previous names.',
        example: '/namehistory player:Xclipsen'
      },
      {
        command: '/gif media:<image>',
        description: 'Convert an uploaded image into a GIF file.',
        example: '/gif media:<upload>'
      },
      {
        command: '/cata player:<ign>',
        description: 'Show a catacombs overview for a player.',
        example: '/cata player:Xclipsen'
      },
      {
        command: '/catacombs player:<ign>',
        description: 'Alias of /cata for the same catacombs lookup.',
        example: '/catacombs player:Xclipsen'
      },
      {
        command: '/itememoji item:<skyblock_id>',
        description: 'Post a mapped SkyBlock item emoji as a normal channel message.',
        example: '/itememoji item:HYPERION enchanted:true'
      },
      {
        command: '/link start usernames:<name1,name2>',
        description: 'Create a backend link code and finish the link in Minecraft with /link CODE.',
        example: '/link start usernames:Xclipsen,AltName'
      },
      {
        command: '/link event event:<event> enabled:<true|false>',
        description: 'Toggle one backend event ping for your linked Minecraft client.',
        example: '/link event event:darkAuction enabled:false'
      }
    ]
  },
  {
    id: 'moderation',
    label: 'Moderation',
    summary: 'Guild-local moderation and watchlist tools.',
    commands: [
      {
        command: '/shitter add name:<ign> reason:<text>',
        description: 'Add or update a shitter entry with optional screenshots.',
        example: '/shitter add name:Example reason:Scam evidence'
      },
      {
        command: '/shitter query name:<ign>',
        description: 'Check whether an IGN is listed in this server.',
        example: '/shitter query name:Example'
      },
      {
        command: '/shitter remove name:<ign>',
        description: 'Mark active entries for an IGN as removed while keeping history.',
        example: '/shitter remove name:Example'
      },
      {
        command: '/shitter list',
        description: 'Browse unique listed names for this server.',
        example: '/shitter list'
      }
    ]
  },
  {
    id: 'admin-tools',
    label: 'Admin Tools',
    summary: 'Restricted testing and server-management tools.',
    commands: [
      {
        command: '/simulate custom',
        description: 'Simulate mayor or election states for local testing.',
        example: '/simulate custom mayor:diaz perk_count:3 booth_open:true',
        adminOnly: true
      },
      {
        command: '/simulate clear',
        description: 'Switch the bot back to live election data.',
        example: '/simulate clear',
        adminOnly: true
      },
      {
        command: '/test event event:<name>',
        description: 'Send one event reminder test through Discord and the IRC bridge.',
        example: '/test event event:darkAuction',
        adminOnly: true
      }
    ]
  }
];

function getHelpSectionChoices() {
  return helpSections.map((section) => ({
    name: section.label,
    value: section.id
  }));
}

function getHelpSectionById(sectionId) {
  return helpSections.find((section) => section.id === sectionId) || null;
}

module.exports = {
  helpSections,
  getHelpSectionById,
  getHelpSectionChoices
};
