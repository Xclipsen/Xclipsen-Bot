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
        command: '/cata [player:<ign>] [profile:<name>]',
        description: 'Show a catacombs overview for a player, with selectable views like Basic Info and Boss Collections.',
        example: '/cata'
      },
      {
        command: '/catacombs [player:<ign>] [profile:<name>]',
        description: 'Alias of /cata for the same catacombs lookup, including linked-account, selected-profile, and view selection support.',
        example: '/catacombs'
      },
      {
        command: '/itememoji item:<skyblock_id>',
        description: 'Post a mapped SkyBlock item emoji as a normal channel message.',
        example: '/itememoji item:HYPERION enchanted:true'
      },
      {
        command: '/trophyfishing [player:<ign>] [profile:<name>]',
        description: 'Show a Trophy Fish overview with a fish info selector for locations and chances.',
        example: '/trophyfishing'
      },
      {
        command: '/pest fortune:<amount> sell_method:NPC Sell',
        description: 'Estimate which Garden pest is worth the most per kill for your Farming Fortune, with Instasell, Sell Order, or NPC Sell.',
        example: '/pest fortune:2500 sell_method:NPC Sell'
      },
      {
        command: '/pests fortune:<amount> sell_method:Instasell',
        description: 'Alias of /pest for the same pest profit estimate.',
        example: '/pests fortune:2500 sell_method:Instasell'
      },
      {
        command: '/setfarmingstats bonus_pest_chance:<value> pest_shard_level:<value> cropeetle_level:<value> rarefinder_level:<value> reforge:<name>',
        description: 'Save your pest farming stats for the profit calculator.',
        example: '/setfarmingstats bonus_pest_chance:497 pest_shard_level:10 cropeetle_level:10 rarefinder_level:10 reforge:Bountiful'
      },
      {
        command: '/pestfarmingprofits bait:<name> vinyl:<pest> crop:<crop> fortune:<amount> plots:<count> sell_method:<method>',
        description: 'Calculate pest farming profit per hour with your saved farming stats and live market costs.',
        example: '/pestfarmingprofits bait:Plant Matter (Slug + Locust) vinyl:Slug crop:Wheat fortune:2500 plots:2 sell_method:NPC Sell'
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
