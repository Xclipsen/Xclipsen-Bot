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
        description: 'Open the setup hub for mayor alerts, event calendar, mining events, SkyBlock weather, mod update tracking, reaction roles, and shitter permissions.',
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
        command: '/season',
        description: 'Show the four current in-season crops and their remaining time.',
        example: '/season'
      },
      {
        command: '/harvestfeast',
        description: 'Show current Feast crops and upcoming rotations from EliteSkyBlock.',
        example: '/harvestfeast'
      },
      {
        command: '/uuid [player:<ign>]',
        description: 'Look up a Mojang UUID and percentile-style UUID ranking, or use your linked IGN.',
        example: '/uuid'
      },
      {
        command: '/namehistory [player:<ign>]',
        description: 'Show the current Minecraft name plus known previous names, or use your linked IGN.',
        example: '/namehistory'
      },
      {
        command: '/gif media:<image>',
        description: 'Convert an uploaded image into a GIF file.',
        example: '/gif media:<upload>'
      },
      {
        command: '/tts join | leave | say text:<text>',
        description: 'Read messages aloud in your voice channel. Needs the TTS role; only members in the voice channel are read, and the bot leaves when whoever ran /tts join leaves.',
        example: '/tts join'
      },
      {
        command: '/tts voice voice:<name>',
        description: 'Choose the TTS voice for this server.',
        example: '/tts voice voice:thorsten',
        adminOnly: true
      },
      {
        command: '/cata [player:<ign>] [profile:<name>]',
        description: 'Show a catacombs overview for a player, with selectable views like Basic Info and Boss Collections. Also available as /catacombs.',
        example: '/cata'
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
        command: '/trophyfrogs [player:<ign>] [profile:<name>]',
        description: 'Show a Trophy Frog overview with unlocked-tier progress and a frog info selector.',
        example: '/trophyfrogs'
      },
      {
        command: '/pest fortune:<amount> sell_method:<method>',
        description: 'Estimate which Garden pest is worth the most per kill for your Farming Fortune, with Instasell, Sell Order, or NPC Sell. Also available as /pests.',
        example: '/pest fortune:2500 sell_method:NPC Sell'
      },
      {
        command: '/setfarmingstats bonus_pest_chance:<value> pest_shard_level:<value> reforge:<name> [cropeetle_level:<value>] [rarefinder_level:<value>]',
        description: 'Save your pest farming stats for the profit calculator. Cropeetle and Rarefinder levels are optional and only shown back.',
        example: '/setfarmingstats bonus_pest_chance:497 pest_shard_level:10 reforge:Bountiful'
      },
      {
        command: '/pestfarmingprofits bait:<name> vinyl:<pest> crop:<crop> fortune:<amount> [pest_fortune:<amount>] plots:<count> sell_method:<method>',
        description: 'Calculate pest farming profit per hour with your saved farming stats and live market costs.',
        example: '/pestfarmingprofits bait:Plant Matter (Slug + Locust) vinyl:Slug crop:Wheat fortune:2900 pest_fortune:2600 plots:2 sell_method:NPC Sell'
      },
      {
        command: '/lastpestfarmingprofits',
        description: 'Recalculate your most recently used pest farming setup with current prices and mayor state.',
        example: '/lastpestfarmingprofits'
      },
      {
        command: '/link username:<ign>',
        description: 'Verify an account through Hypixel and receive a short-lived code for `/irc link` in Minecraft.',
        example: '/link username:Xclipsen'
      },
      {
        command: '/link event:<event> enabled:<true|false>',
        description: 'Toggle one backend event ping for your linked Minecraft client.',
        example: '/link event:darkAuction enabled:false'
      },
      {
        command: '/link [remove:<ign>] [unlink:true]',
        description: 'Show your link status, remove one linked username, or delete the whole link.',
        example: '/link remove:AltName'
      },
      {
        command: '/hideonleaf',
        description: 'Show the Hideonleaf leaderboard for kills, shards, coins, and coins per hour.',
        example: '/hideonleaf'
      }
    ]
  },
  {
    id: 'moderation',
    label: 'Moderation',
    summary: 'Guild-local moderation and watchlist tools.',
    commands: [
      {
        command: '/shitter add [name:<ign>] reason:<text>',
        description: 'Add or update a shitter entry with optional screenshots, or use your linked IGN.',
        example: '/shitter add reason:Scam evidence'
      },
      {
        command: '/shitter query [name:<ign>]',
        description: 'Check whether an IGN is listed in this server, or use your linked IGN.',
        example: '/shitter query'
      },
      {
        command: '/shitter remove [name:<ign>]',
        description: 'Mark active entries for an IGN as removed while keeping history, or use your linked IGN.',
        example: '/shitter remove'
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
      },
      {
        command: '/test miningevent event:<name>',
        description: 'Send one mining event test ping to the configured mining events channel.',
        example: '/test miningevent event:raffle',
        adminOnly: true
      },
      {
        command: '/test weather tier:<Mild|EXTREME>',
        description: 'Send one SkyBlock weather test ping. Set up the channel, roles, pinned role panel and live dashboard (with its island menu) under /setup → Weather.',
        example: '/test weather tier:EXTREME',
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
