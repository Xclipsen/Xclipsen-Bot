const assert = require('node:assert/strict');
const test = require('node:test');
const { AttachmentBuilder, ChannelType, MessageFlags, PermissionsBitField } = require('discord.js');

const {
  WEATHER_ROLE_DEFINITIONS,
  WEATHER_ISLANDS,
  WEATHER_CHANNEL_NAME,
  WEATHER_ISLAND_SELECT_ID,
  STAT_STYLES,
  getMinecraftTextWidth,
  wrapMinecraftText,
  buildWeatherTooltipLines,
  getWeatherWindow,
  getActiveWeatherWindow,
  getNextWeatherWindow,
  getUpcomingWeatherWindows,
  createWeatherService
} = require('../src/features/weather');
const { EVENT_DEFINITION_MAP } = require('../src/features/eventCalendar');
const { createReactionRoleService } = require('../src/features/reactionRoles');
const { createStore } = require('../src/storage/store');
const { createTempStore } = require('./helpers');

const BOT_ID = '900000000000000001';
const GUILD_ID = '100000000000000001';
const CATEGORY_ID = '200000000000000001';
const MINING_CHANNEL_ID = '300000000000000001';
const WEATHER_CHANNEL_ID = '300000000000000002';
const OTHER_CHANNEL_ID = '300000000000000003';
const MILD_ROLE_ID = '400000000000000001';
const EXTREME_ROLE_ID = '400000000000000002';
const UNRELATED_ROLE_ID = '400000000000000003';
const MOD_ROLE_ID = '400000000000000004';
const { Flags } = PermissionsBitField;

const at = (isoTimestamp) => Date.parse(isoTimestamp);
const unix = (timestampMs) => Math.floor(timestampMs / 1000);
const visible = (line) => line.replace(/§./g, '');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function createWeatherHarness(t) {
  const { paths, store } = createTempStore(t, 'xclipsen-weather-');
  let nextId = 500000000000000000n;
  const createId = () => String(nextId++);
  const channels = new Map();
  const roles = new Map();
  const createdChannels = [];
  const createdRoles = [];
  const pins = [];
  const bot = {
    member: { permissions: new PermissionsBitField([Flags.ManageRoles]) },
    channelPermissions: new PermissionsBitField([Flags.ViewChannel, Flags.SendMessages, Flags.AddReactions])
  };
  let deleteGate = null;

  const client = {
    user: { id: BOT_ID },
    channels: { fetch: async (channelId) => channels.get(channelId) || null },
    rest: { put: async (route) => pins.push(route) }
  };

  function addChannel({ id = createId(), name, parentId = null, isText = true }) {
    const messages = new Map();
    const channel = {
      id,
      name,
      parentId,
      type: isText ? ChannelType.GuildText : ChannelType.GuildCategory,
      sent: [],
      isTextBased: () => isText,
      permissionsFor: () => bot.channelPermissions,
      messages: {
        async fetch(messageId) {
          const message = messages.get(messageId);
          if (!message) {
            throw new Error('Unknown Message');
          }
          return message;
        }
      },
      async send(payload) {
        const message = {
          id: createId(),
          channelId: channel.id,
          client,
          author: { id: BOT_ID },
          payload,
          pinned: false,
          deleted: false,
          edits: [],
          reactions: [],
          get content() {
            return this.payload.content ?? '';
          },
          get embeds() {
            return toApiObjects(this.payload.embeds);
          },
          get components() {
            return toApiObjects(this.payload.components);
          },
          async react(emoji) {
            this.reactions.push(emoji);
          },
          async delete() {
            if (deleteGate) {
              await deleteGate;
            }
            this.deleted = true;
            messages.delete(this.id);
          },
          async edit(update) {
            this.edits.push(update);
            this.payload = { ...this.payload, ...update };
            return this;
          }
        };
        channel.sent.push(message);
        messages.set(message.id, message);
        return message;
      }
    };
    channels.set(id, channel);
    return channel;
  }

  function addRole(id, name, permissions = []) {
    const role = { id, name, managed: false, editable: true, permissions: new PermissionsBitField(permissions) };
    roles.set(id, role);
    return role;
  }

  const guild = {
    id: GUILD_ID,
    client,
    members: { me: bot.member },
    channels: {
      async fetch(channelId) {
        if (channelId === undefined) {
          return new Map(channels);
        }
        const channel = channels.get(channelId);
        if (!channel) {
          throw new Error('Unknown Channel');
        }
        return channel;
      },
      async create(options) {
        createdChannels.push(options);
        return addChannel({ name: options.name, parentId: options.parent ?? null });
      }
    },
    roles: {
      async fetch(roleId) {
        if (roleId === undefined) {
          return new Map(roles);
        }
        const role = roles.get(roleId);
        if (!role) {
          throw new Error('Unknown Role');
        }
        return role;
      },
      async create(options) {
        createdRoles.push(options);
        return addRole(createId(), options.name);
      }
    }
  };

  const reactionRoles = createReactionRoleService({ client, store, ensureSetupAccess: async () => true, pagedLists: null });
  // Tests never load the canvas renderer; this fake returns a tiny PNG-like buffer.
  const renderCalls = [];
  const fakeRenderTooltips = async (tooltips, options) => {
    renderCalls.push({ tooltips, options });
    return Buffer.concat([PNG_SIGNATURE, Buffer.from(tooltips.map((lines) => lines[0]).join('|'))]);
  };
  const createService = (serviceStore = store, { renderTooltips = fakeRenderTooltips } = {}) =>
    createWeatherService({ client, store: serviceStore, reactionRoles, renderTooltips });

  return {
    paths,
    store,
    client,
    guild,
    bot,
    // Holds every message delete until the returned release function is called.
    holdDeletes() {
      let release;
      deleteGate = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        deleteGate = null;
        release();
      };
    },
    pins,
    channels,
    createdChannels,
    createdRoles,
    addChannel,
    addRole,
    reactionRoles,
    renderCalls,
    createService,
    configureWeather: (channelId, weatherRoles = {}) => store.setGuildConfig(GUILD_ID, {
      weather: { channelId, roles: { mild: null, extreme: null, ...weatherRoles } }
    }),
    getWeatherState: () => store.getGuildRuntimeState(GUILD_ID).weather
  };
}

function toApiObjects(items = []) {
  return items.map((item) => {
    const data = typeof item.toJSON === 'function' ? item.toJSON() : item;
    return { ...data, toJSON: () => ({ ...data }) };
  });
}

function getIslandSelect(message) {
  assert.equal(message.components.length, 1);
  assert.equal(message.components[0].components.length, 1);
  return message.components[0].components[0];
}

function createSelectInteraction(values) {
  return {
    customId: WEATHER_ISLAND_SELECT_ID,
    values,
    deferred: false,
    replied: false,
    calls: [],
    isStringSelectMenu: () => true,
    async reply(payload) {
      this.replied = true;
      this.calls.push(['reply', payload]);
    },
    async deferReply(payload) {
      this.deferred = true;
      this.calls.push(['deferReply', payload]);
    },
    async editReply(payload) {
      this.replied = true;
      this.calls.push(['editReply', payload]);
    }
  };
}

function getPings(channel) {
  return channel.sent.filter((message) => message.content.startsWith('<@&'));
}

function getDashboards(channel) {
  return channel.sent.filter((message) => message.embeds[0]?.title === 'SkyBlock Weather');
}

test('weather windows follow the hourly XX:35–XX:55 schedule with every 3rd window EXTREME', () => {
  const mild = getActiveWeatherWindow(at('2026-10-21T16:35:00Z'));
  assert.equal(mild.tier, 'mild');
  assert.equal(mild.startAt, at('2026-10-21T16:35:00Z'));
  assert.equal(mild.endAt, at('2026-10-21T16:55:00Z'));
  assert.equal(getActiveWeatherWindow(at('2026-10-21T16:54:59.999Z')).index, mild.index);
  assert.equal(getActiveWeatherWindow(at('2026-10-21T16:55:00Z')), null);
  assert.equal(getActiveWeatherWindow(at('2026-10-21T16:34:59.999Z')), null);

  const extreme = getActiveWeatherWindow(at('2026-10-21T17:35:00Z'));
  assert.equal(extreme.tier, 'extreme');
  assert.equal(extreme.index, mild.index + 1);
  assert.deepEqual(getWeatherWindow(extreme.index), extreme);
  assert.equal(getActiveWeatherWindow(at('2026-10-21T17:55:00Z')), null);

  for (const hour of ['02', '05', '08', '11', '14', '17', '20', '23']) {
    assert.equal(getActiveWeatherWindow(at(`2026-10-21T${hour}:40:00Z`)).tier, 'extreme', `${hour}:35 UTC`);
  }

  // "Next" always starts strictly after now, even while a window is active.
  assert.equal(getNextWeatherWindow(at('2026-10-21T16:35:00Z')).startAt, at('2026-10-21T17:35:00Z'));
  assert.equal(getNextWeatherWindow(at('2026-10-21T17:35:00Z'), 'mild').startAt, at('2026-10-21T18:35:00Z'));
  assert.equal(getNextWeatherWindow(at('2026-10-21T17:35:00Z'), 'extreme').startAt, at('2026-10-21T20:35:00Z'));
  assert.equal(getNextWeatherWindow(at('2026-10-21T17:34:59Z'), 'extreme').startAt, at('2026-10-21T17:35:00Z'));

  const upcoming = getUpcomingWeatherWindows(at('2026-10-21T17:55:00Z'), 6);
  assert.deepEqual(upcoming.map((window) => new Date(window.startAt).toISOString()), [
    '2026-10-21T18:35:00.000Z',
    '2026-10-21T19:35:00.000Z',
    '2026-10-21T20:35:00.000Z',
    '2026-10-21T21:35:00.000Z',
    '2026-10-21T22:35:00.000Z',
    '2026-10-21T23:35:00.000Z'
  ]);
  assert.deepEqual(upcoming.map((window) => window.tier), ['mild', 'mild', 'extreme', 'mild', 'mild', 'extreme']);
  assert.ok(upcoming.every((window) => window.endAt - window.startAt === 20 * 60 * 1000));
});

test('weather windows agree with the Spider\'s Den rain/thunder calendar entries', () => {
  const start = at('2026-10-21T02:00:00Z');
  for (let now = start; now < start + (26 * 60 * 60 * 1000); now += 5 * 60 * 1000) {
    const active = getActiveWeatherWindow(now);
    const rain = EVENT_DEFINITION_MAP.spiderRain.getSchedule(now);
    const thunder = EVENT_DEFINITION_MAP.spiderThunder.getSchedule(now);
    const label = new Date(now).toISOString();

    assert.equal(thunder.isActive, active?.tier === 'extreme', label);
    assert.equal(rain.isActive, active?.tier === 'mild', label);

    const expectedThunder = active?.tier === 'extreme' ? active : getNextWeatherWindow(now, 'extreme');
    const expectedRain = active?.tier === 'mild' ? active : getNextWeatherWindow(now, 'mild');
    assert.equal(thunder.windowStartAt, expectedThunder.startAt, label);
    assert.equal(thunder.windowEndAt, expectedThunder.endAt, label);
    assert.equal(rain.windowStartAt, expectedRain.startAt, label);
    assert.equal(rain.windowEndAt, expectedRain.endAt, label);
  }
});

test('store normalizes weather config and runtime state with safe defaults', (t) => {
  const harness = createWeatherHarness(t);
  const { store } = harness;

  assert.deepEqual(store.getGuildConfig(GUILD_ID).weather, { channelId: null, roles: { mild: null, extreme: null } });
  assert.deepEqual(store.getGuildRuntimeState(GUILD_ID).weather, {
    channelId: null,
    dashboardMessageId: null,
    dashboardStateKey: null,
    lastSentStarts: { mild: null, extreme: null },
    pingMessageIds: { mild: null, extreme: null },
    pingExpireAts: { mild: null, extreme: null },
    rolePanelMessageId: null,
    rolePanelChannelId: null
  });
  assert.deepEqual(store.getWeatherConfiguredGuildIds(), []);

  store.setGuildConfig(GUILD_ID, { weather: { channelId: WEATHER_CHANNEL_ID, roles: { extreme: EXTREME_ROLE_ID, bogus: '1' } } });
  store.setGuildRuntimeState(GUILD_ID, {
    weather: {
      lastSentStarts: { mild: 'not a number', extreme: '123', other: 5 },
      pingMessageIds: { mild: 42, extreme: '' },
      pingExpireAts: 'garbage'
    }
  });

  const reloaded = createStore(harness.paths);
  assert.deepEqual(reloaded.getGuildConfig(GUILD_ID).weather, { channelId: WEATHER_CHANNEL_ID, roles: { mild: null, extreme: EXTREME_ROLE_ID } });
  assert.deepEqual(reloaded.getWeatherConfiguredGuildIds(), [GUILD_ID]);
  const state = reloaded.getGuildRuntimeState(GUILD_ID).weather;
  assert.deepEqual(state.lastSentStarts, { mild: null, extreme: 123 });
  assert.deepEqual(state.pingMessageIds, { mild: '42', extreme: null });
  assert.deepEqual(state.pingExpireAts, { mild: null, extreme: null });
  assert.equal(reloaded.getGuildConfig(GUILD_ID).miningEvents.channelId, null);
});

test('a weather ping is sent once per window, survives a restart and is deleted at window end', async (t) => {
  const harness = createWeatherHarness(t);
  const channel = harness.addChannel({ id: WEATHER_CHANNEL_ID, name: WEATHER_CHANNEL_NAME });
  harness.configureWeather(WEATHER_CHANNEL_ID, { mild: MILD_ROLE_ID, extreme: EXTREME_ROLE_ID });
  const extremeEnd = at('2026-10-21T17:55:00Z');

  await harness.createService().checkForWeather(at('2026-10-21T17:36:00Z'));

  const [ping] = getPings(channel);
  assert.equal(getPings(channel).length, 1);
  assert.equal(
    ping.content,
    `<@&${EXTREME_ROLE_ID}>\n⛈️ EXTREME weather is active now — until <t:${unix(extremeEnd)}:t> (<t:${unix(extremeEnd)}:R>).`
  );
  assert.deepEqual(ping.payload.allowedMentions, { roles: [EXTREME_ROLE_ID] });
  const pingLines = ping.embeds[0].description.split('\n');
  assert.equal(pingLines.length, WEATHER_ISLANDS.length + 2);
  assert.deepEqual(pingLines.slice(0, 4), [
    "Spider's Den — Thunderstorm",
    'Backwater Bayou — Acid Rain',
    'Crimson Isle — Hellstorm',
    'Moonglade Marsh — Thunderstorm'
  ]);
  assert.ok(pingLines.includes('The End — Voidstorm'));
  assert.ok(pingLines.includes("Jerry's Workshop (Season of Jerry only) — Blizzard"));
  assert.equal(pingLines.at(-1), 'Pick an island under the dashboard for details.');
  assert.doesNotMatch(ping.embeds[0].description, /Fog|Void Storm|Toxic Rain Slimes|Fortune|\+\d/);
  assert.deepEqual(ping.components, []);
  assert.deepEqual(harness.getWeatherState().pingMessageIds, { mild: null, extreme: ping.id });
  assert.deepEqual(harness.getWeatherState().pingExpireAts, { mild: null, extreme: extremeEnd });
  assert.equal(harness.getWeatherState().lastSentStarts.extreme, at('2026-10-21T17:35:00Z'));

  // A fresh store and service read the persisted state like a bot restart would.
  const restarted = harness.createService(createStore(harness.paths));
  await restarted.checkForWeather(at('2026-10-21T17:40:00Z'));
  await restarted.checkForWeather(at('2026-10-21T17:54:59Z'));
  assert.equal(getPings(channel).length, 1);
  assert.equal(ping.deleted, false);

  await restarted.checkForWeather(extremeEnd);
  assert.equal(ping.deleted, true);
  assert.deepEqual(createStore(harness.paths).getGuildRuntimeState(GUILD_ID).weather.pingMessageIds, { mild: null, extreme: null });

  await restarted.checkForWeather(at('2026-10-21T18:35:00Z'));
  const pings = getPings(channel);
  assert.equal(pings.length, 2);
  assert.match(pings[1].content, new RegExp(`^<@&${MILD_ROLE_ID}>\\n🌦️ Mild weather is active now`));
  assert.match(pings[1].embeds[0].description, /^Spider's Den — Rain$/m);
  assert.match(pings[1].embeds[0].description, /^Moonglade Marsh — Moonfall$/m);
  assert.doesNotMatch(pings[1].embeds[0].description, /Rain Slimes/);
});

test('no ping without a role; a role chosen mid-window waits for the next window of that tier', async (t) => {
  const harness = createWeatherHarness(t);
  const channel = harness.addChannel({ id: WEATHER_CHANNEL_ID, name: WEATHER_CHANNEL_NAME });
  harness.configureWeather(WEATHER_CHANNEL_ID, { mild: MILD_ROLE_ID });
  const service = harness.createService();

  await service.checkForWeather(at('2026-10-21T17:36:00Z'));
  assert.equal(getPings(channel).length, 0);
  assert.equal(getDashboards(channel).length, 1);
  assert.equal(harness.getWeatherState().lastSentStarts.extreme, at('2026-10-21T17:35:00Z'));

  harness.configureWeather(WEATHER_CHANNEL_ID, { mild: MILD_ROLE_ID, extreme: EXTREME_ROLE_ID });
  await service.checkForWeather(at('2026-10-21T17:40:00Z'));
  assert.equal(getPings(channel).length, 0);

  await service.checkForWeather(at('2026-10-21T20:35:00Z'));
  assert.equal(getPings(channel).length, 1);
  assert.match(getPings(channel)[0].content, new RegExp(`^<@&${EXTREME_ROLE_ID}>`));
});

test('the dashboard is created once, edited only on state changes and recreated when deleted', async (t) => {
  const harness = createWeatherHarness(t);
  const channel = harness.addChannel({ id: WEATHER_CHANNEL_ID, name: WEATHER_CHANNEL_NAME });
  harness.configureWeather(WEATHER_CHANNEL_ID);
  const service = harness.createService();

  await service.checkForWeather(at('2026-10-21T17:40:00Z'));
  assert.equal(channel.sent.length, 1);
  const [dashboard] = channel.sent;
  assert.deepEqual(dashboard.payload.allowedMentions, { parse: [] });
  const activeEmbed = dashboard.embeds[0];
  assert.match(activeEmbed.description, new RegExp(`EXTREME weather\\*\\* is active until <t:${unix(at('2026-10-21T17:55:00Z'))}:t>`));
  assert.equal(activeEmbed.description, `⛈️ **EXTREME weather** is active until <t:${unix(at('2026-10-21T17:55:00Z'))}:t> (<t:${unix(at('2026-10-21T17:55:00Z'))}:R>).`);
  assert.deepEqual(activeEmbed.fields.map((field) => [field.name, Boolean(field.inline)]), [
    ['Next Mild', true],
    ['Next EXTREME', true],
    ['Upcoming', false]
  ]);
  assert.match(activeEmbed.fields[0].value, new RegExp(`<t:${unix(at('2026-10-21T18:35:00Z'))}:t>`));
  assert.match(activeEmbed.fields[1].value, new RegExp(`<t:${unix(at('2026-10-21T20:35:00Z'))}:R>`));
  assert.equal(activeEmbed.fields[2].value.split('\n').length, 4);
  assert.doesNotMatch(JSON.stringify(activeEmbed), /Jerry|Sowdust|Superior Dragon|Fortune/);
  assert.equal(activeEmbed.footer.text, 'Pick an island below for its weather stats · times in your local time');

  const select = getIslandSelect(dashboard);
  assert.equal(select.custom_id, WEATHER_ISLAND_SELECT_ID);
  assert.equal(select.custom_id, 'weather:island');
  assert.equal(select.placeholder, 'Choose an island for weather details');
  assert.equal(select.options.length, 11);
  assert.deepEqual(select.options.map((option) => option.value), WEATHER_ISLANDS.map((island) => island.key));
  assert.ok(select.options.every((option) => !option.default));
  const garden = select.options.find((option) => option.value === 'garden');
  assert.deepEqual([garden.label, garden.description], ['Garden', 'Rain / Blooming']);
  assert.equal(select.options.find((option) => option.value === 'jerrysWorkshop').description, 'Breeze / Blizzard · Season of Jerry only');

  await service.checkForWeather(at('2026-10-21T17:45:00Z'));
  await service.checkForWeather(at('2026-10-21T17:54:00Z'));
  assert.equal(channel.sent.length, 1);
  assert.equal(dashboard.edits.length, 0);

  await service.checkForWeather(at('2026-10-21T17:55:00Z'));
  await service.checkForWeather(at('2026-10-21T18:20:00Z'));
  assert.equal(channel.sent.length, 1);
  assert.equal(dashboard.edits.length, 1);
  assert.equal(dashboard.edits[0].components.length, 1);
  assert.equal(getIslandSelect(dashboard).options.length, 11);
  const clearEmbed = dashboard.embeds[0];
  assert.match(clearEmbed.description, /Clear/);
  assert.notEqual(clearEmbed.color, activeEmbed.color);
  assert.match(clearEmbed.fields[2].value.split('\n')[0], new RegExp(`<t:${unix(at('2026-10-21T18:35:00Z'))}:t>–<t:${unix(at('2026-10-21T18:55:00Z'))}:t> · Mild`));
  assert.match(clearEmbed.fields[2].value.split('\n')[2], /· \*\*EXTREME\*\*$/);

  await dashboard.delete();
  await service.checkForWeather(at('2026-10-21T18:21:00Z'));
  assert.equal(getDashboards(channel).length, 2);
  const recreated = channel.sent[1];
  assert.equal(recreated.deleted, false);
  assert.equal(harness.getWeatherState().dashboardMessageId, recreated.id);
});

test('changing the weather channel removes tracked messages from the old channel', async (t) => {
  const harness = createWeatherHarness(t);
  const oldChannel = harness.addChannel({ id: WEATHER_CHANNEL_ID, name: WEATHER_CHANNEL_NAME });
  const newChannel = harness.addChannel({ id: OTHER_CHANNEL_ID, name: 'weather-two' });
  harness.configureWeather(WEATHER_CHANNEL_ID, { extreme: EXTREME_ROLE_ID });
  const service = harness.createService();

  await service.checkForWeather(at('2026-10-21T17:36:00Z'));
  assert.equal(oldChannel.sent.length, 2);

  harness.configureWeather(OTHER_CHANNEL_ID, { extreme: EXTREME_ROLE_ID });
  await service.checkForWeather(at('2026-10-21T17:40:00Z'));

  assert.ok(oldChannel.sent.every((message) => message.deleted));
  assert.equal(getPings(newChannel).length, 0);
  assert.equal(getDashboards(newChannel).length, 1);
  const state = harness.getWeatherState();
  assert.equal(state.channelId, OTHER_CHANNEL_ID);
  assert.equal(state.dashboardMessageId, newChannel.sent[0].id);
  assert.deepEqual(state.pingMessageIds, { mild: null, extreme: null });
});

test('quick setup creates the channel next to the bot channels, two roles, and a pinned panel above the dashboard', async (t) => {
  const harness = createWeatherHarness(t);
  harness.addChannel({ id: CATEGORY_ID, name: 'Yap', isText: false });
  harness.addChannel({ id: MINING_CHANNEL_ID, name: 'mining-events', parentId: CATEGORY_ID });
  harness.addRole(GUILD_ID, '@everyone');
  harness.addRole(UNRELATED_ROLE_ID, 'Member');
  harness.store.setGuildConfig(GUILD_ID, { miningEvents: { channelId: MINING_CHANNEL_ID, roles: {} } });
  harness.store.setReactionRoleEntries(GUILD_ID, [
    { channelId: MINING_CHANNEL_ID, messageId: '600000000000000001', roleId: UNRELATED_ROLE_ID, emoji: '⛏️', requiredRoleId: null }
  ]);
  const service = harness.createService();

  const result = await service.runQuickSetup(harness.guild);

  assert.equal(harness.createdChannels.length, 1);
  assert.deepEqual(harness.createdChannels[0], {
    name: WEATHER_CHANNEL_NAME,
    type: ChannelType.GuildText,
    parent: CATEGORY_ID,
    topic: 'Hypixel SkyBlock island weather: live forecast and Mild/EXTREME weather pings.',
    reason: 'Quick setup for the Weather feature'
  });
  assert.deepEqual(harness.createdRoles.map((role) => [role.name, role.mentionable]), [['Mild Weather', false], ['Extreme Weather', false]]);
  assert.equal(result.createdCount, 2);
  assert.deepEqual(result.warnings, []);

  const channel = result.channel;
  assert.equal(channel.parentId, CATEGORY_ID);
  assert.deepEqual(harness.store.getGuildConfig(GUILD_ID).weather, { channelId: channel.id, roles: result.roles });

  const [panel, dashboard] = channel.sent;
  assert.equal(channel.sent.length, 2);
  assert.equal(panel.embeds[0].title, 'SkyBlock Weather Pings');
  assert.match(panel.embeds[0].description, new RegExp(`🌦️ Mild weather pings \\(2 of every 3 hours\\) → <@&${result.roles.mild}>`));
  assert.match(panel.embeds[0].description, new RegExp(`⛈️ EXTREME weather pings every 3 hours → <@&${result.roles.extreme}>`));
  assert.deepEqual(panel.payload.allowedMentions, { parse: [] });
  assert.deepEqual(panel.reactions, WEATHER_ROLE_DEFINITIONS.map((definition) => definition.emoji));
  assert.deepEqual(harness.pins, [`/channels/${channel.id}/messages/pins/${panel.id}`]);
  assert.equal(dashboard.embeds[0].title, 'SkyBlock Weather');
  assert.ok(BigInt(panel.id) < BigInt(dashboard.id));

  const state = harness.getWeatherState();
  assert.equal(state.rolePanelMessageId, panel.id);
  assert.equal(state.rolePanelChannelId, channel.id);
  assert.equal(state.dashboardMessageId, dashboard.id);
  const bindings = harness.store.getReactionRoleEntries(GUILD_ID);
  assert.equal(bindings.length, 3);
  assert.deepEqual(bindings.filter((entry) => entry.messageId === panel.id).map((entry) => entry.roleId), [result.roles.mild, result.roles.extreme]);

  // Running it again reuses everything, replaces the panel and keeps it above the dashboard.
  const rerun = await service.runQuickSetup(harness.guild);
  assert.equal(rerun.channel, channel);
  assert.equal(rerun.createdCount, 0);
  assert.deepEqual(rerun.roles, result.roles);
  assert.equal(harness.createdChannels.length, 1);
  assert.equal(panel.deleted, true);
  assert.equal(dashboard.deleted, true);

  const liveMessages = channel.sent.filter((message) => !message.deleted);
  assert.equal(liveMessages.length, 2);
  const [newPanel, movedDashboard] = liveMessages;
  assert.equal(newPanel.embeds[0].title, 'SkyBlock Weather Pings');
  assert.equal(movedDashboard.embeds[0].title, 'SkyBlock Weather');
  assert.deepEqual(movedDashboard.payload.allowedMentions, { parse: [] });
  assert.equal(getIslandSelect(movedDashboard).custom_id, WEATHER_ISLAND_SELECT_ID);
  assert.equal(harness.getWeatherState().rolePanelMessageId, newPanel.id);
  assert.equal(harness.getWeatherState().dashboardMessageId, movedDashboard.id);
  const rerunBindings = harness.store.getReactionRoleEntries(GUILD_ID);
  assert.equal(rerunBindings.length, 3);
  assert.equal(rerunBindings.filter((entry) => entry.messageId === newPanel.id).length, 2);
});

test('quick setup reuses matching roles and an existing weather channel', async (t) => {
  const harness = createWeatherHarness(t);
  const existingChannel = harness.addChannel({ id: WEATHER_CHANNEL_ID, name: WEATHER_CHANNEL_NAME });
  harness.addRole(EXTREME_ROLE_ID, 'extreme weather ping');
  const service = harness.createService();

  const result = await service.runQuickSetup(harness.guild);
  assert.equal(result.channel, existingChannel);
  assert.equal(harness.createdChannels.length, 0);
  assert.equal(result.roles.extreme, EXTREME_ROLE_ID);
  assert.equal(result.createdCount, 1);
  assert.deepEqual(harness.createdRoles.map((role) => role.name), ['Mild Weather']);
});

test('startup reposts a missing role panel and only re-pins an intact one', async (t) => {
  const harness = createWeatherHarness(t);
  harness.addChannel({ id: WEATHER_CHANNEL_ID, name: WEATHER_CHANNEL_NAME });
  harness.addRole(MILD_ROLE_ID, 'Mild Weather');
  harness.addRole(EXTREME_ROLE_ID, 'Extreme Weather');
  const service = harness.createService();
  const { channel } = await service.runQuickSetup(harness.guild);
  const [panel] = channel.sent;

  await service.ensureWeatherRolePanel(harness.guild);
  assert.equal(channel.sent.length, 2);
  assert.equal(harness.pins.length, 2);

  await panel.delete();
  await service.ensureWeatherRolePanel(harness.guild);
  const liveMessages = channel.sent.filter((message) => !message.deleted);
  assert.deepEqual(liveMessages.map((message) => message.embeds[0].title), ['SkyBlock Weather Pings', 'SkyBlock Weather']);
  assert.equal(harness.getWeatherState().rolePanelMessageId, liveMessages[0].id);
  assert.equal(harness.store.getReactionRoleEntries(GUILD_ID).length, 2);
  assert.ok(harness.store.getReactionRoleEntries(GUILD_ID).every((entry) => entry.messageId === liveMessages[0].id));
});

test('test pings require a channel, are marked as tests and are not tracked', async (t) => {
  const harness = createWeatherHarness(t);
  const service = harness.createService();
  await assert.rejects(() => service.sendTestWeatherPing(GUILD_ID, 'extreme'), /does not have a configured weather channel/);

  const channel = harness.addChannel({ id: WEATHER_CHANNEL_ID, name: WEATHER_CHANNEL_NAME });
  harness.configureWeather(WEATHER_CHANNEL_ID, { extreme: EXTREME_ROLE_ID });
  await assert.rejects(() => service.sendTestWeatherPing(GUILD_ID, 'storm'), /Unknown weather tier/);
  await service.sendTestWeatherPing(GUILD_ID, 'extreme');

  const [message] = channel.sent;
  assert.match(message.content, new RegExp(`^<@&${EXTREME_ROLE_ID}>\\nTest ping · ⛈️`));
  assert.deepEqual(message.payload.allowedMentions, { roles: [EXTREME_ROLE_ID] });
  assert.match(message.embeds[0].footer.text, /Test ping/);
  assert.deepEqual(harness.getWeatherState().pingMessageIds, { mild: null, extreme: null });
  assert.deepEqual(harness.getWeatherState().lastSentStarts, { mild: null, extreme: null });
});

test('weather summary describes the active or next window', (t) => {
  const service = createWeatherHarness(t).createService();
  assert.equal(
    service.getWeatherSummary(at('2026-10-21T16:40:00Z')),
    `Mild weather active until <t:${unix(at('2026-10-21T16:55:00Z'))}:t>`
  );
  assert.equal(
    service.getWeatherSummary(at('2026-10-21T17:00:00Z')),
    `Clear · next: EXTREME <t:${unix(at('2026-10-21T17:35:00Z'))}:R>`
  );
});

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

test('unsafe roles are left off the role panel with a warning', async (t) => {
  const harness = createWeatherHarness(t);
  const channel = harness.addChannel({ id: WEATHER_CHANNEL_ID, name: WEATHER_CHANNEL_NAME });
  harness.addRole(MILD_ROLE_ID, 'Mild Weather');
  harness.addRole(EXTREME_ROLE_ID, 'Extreme Weather', [Flags.ManageMessages]);
  const service = harness.createService();

  const { message, warnings } = await service.postWeatherRolePanel(harness.guild, channel, { mild: MILD_ROLE_ID, extreme: EXTREME_ROLE_ID });
  assert.equal(channel.sent.length, 1);
  assert.equal(message, channel.sent[0]);
  assert.deepEqual(message.reactions, ['🌦️']);
  assert.doesNotMatch(message.embeds[0].description, new RegExp(EXTREME_ROLE_ID));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], new RegExp(`EXTREME Weather role left off the panel: <@&${EXTREME_ROLE_ID}> .*Manage Messages`));
  assert.deepEqual(harness.store.getReactionRoleEntries(GUILD_ID).map((entry) => entry.roleId), [MILD_ROLE_ID]);

  // With no safe role left, the old panel and its bindings go and nothing new is posted.
  harness.store.setGuildConfig(GUILD_ID, { botManagers: { userIds: [], roleIds: [MILD_ROLE_ID] } });
  const rejected = await service.postWeatherRolePanel(harness.guild, channel, { mild: MILD_ROLE_ID, extreme: EXTREME_ROLE_ID });
  assert.equal(rejected.message, null);
  assert.equal(rejected.warnings.length, 2);
  assert.match(rejected.warnings[0], /bot-manager access/);
  assert.equal(message.deleted, true);
  assert.equal(channel.sent.length, 1);
  assert.deepEqual(harness.store.getReactionRoleEntries(GUILD_ID), []);
  assert.equal(harness.getWeatherState().rolePanelMessageId, null);

  await assert.rejects(() => service.validateWeatherPanelRole(harness.guild, EXTREME_ROLE_ID), /Manage Messages/);
  await assert.rejects(() => service.validateWeatherPanelRole(harness.guild, '400000000000000099'), /not a regular role/);
  harness.addRole(UNRELATED_ROLE_ID, 'Above the bot').editable = false;
  await assert.rejects(() => service.validateWeatherPanelRole(harness.guild, UNRELATED_ROLE_ID), /cannot be assigned by the bot/);
});

test('the role panel is not posted without Add Reactions or Manage Roles', async (t) => {
  const harness = createWeatherHarness(t);
  const channel = harness.addChannel({ id: WEATHER_CHANNEL_ID, name: WEATHER_CHANNEL_NAME });
  harness.addRole(MILD_ROLE_ID, 'Mild Weather');
  const service = harness.createService();

  harness.bot.channelPermissions = new PermissionsBitField([Flags.ViewChannel, Flags.SendMessages]);
  const noReactions = await service.postWeatherRolePanel(harness.guild, channel, { mild: MILD_ROLE_ID });
  assert.equal(noReactions.message, null);
  assert.match(noReactions.warnings[0], /Add Reactions .* Manage Roles/);

  harness.bot.channelPermissions = new PermissionsBitField([Flags.AddReactions]);
  harness.bot.member.permissions = new PermissionsBitField([]);
  const noManageRoles = await service.postWeatherRolePanel(harness.guild, channel, { mild: MILD_ROLE_ID });
  assert.equal(noManageRoles.message, null);
  assert.equal(channel.sent.length, 0);
  assert.deepEqual(harness.store.getReactionRoleEntries(GUILD_ID), []);
});

test('quick setup never reuses an unsafe role, even with a matching name', async (t) => {
  const harness = createWeatherHarness(t);
  harness.addChannel({ id: WEATHER_CHANNEL_ID, name: WEATHER_CHANNEL_NAME });
  harness.addRole(MOD_ROLE_ID, 'Moderator', [Flags.KickMembers]);
  harness.addRole(EXTREME_ROLE_ID, 'Extreme Weather', [Flags.Administrator]);
  harness.configureWeather(null, { mild: MOD_ROLE_ID });
  const service = harness.createService();

  const result = await service.runQuickSetup(harness.guild);
  assert.equal(result.createdCount, 2);
  assert.notEqual(result.roles.mild, MOD_ROLE_ID);
  assert.notEqual(result.roles.extreme, EXTREME_ROLE_ID);
  assert.deepEqual(harness.createdRoles.map((role) => role.name), ['Mild Weather', 'Extreme Weather']);
  assert.deepEqual(result.warnings, []);
  const boundRoleIds = harness.store.getReactionRoleEntries(GUILD_ID).map((entry) => entry.roleId);
  assert.ok(!boundRoleIds.includes(MOD_ROLE_ID) && !boundRoleIds.includes(EXTREME_ROLE_ID));
});

test('startup repair replaces a panel whose role gained moderator permissions', async (t) => {
  const harness = createWeatherHarness(t);
  harness.addChannel({ id: WEATHER_CHANNEL_ID, name: WEATHER_CHANNEL_NAME });
  harness.addRole(MILD_ROLE_ID, 'Mild Weather');
  const extremeRole = harness.addRole(EXTREME_ROLE_ID, 'Extreme Weather');
  const service = harness.createService();
  const { channel } = await service.runQuickSetup(harness.guild);
  const [oldPanel] = channel.sent;
  const warn = t.mock.method(console, 'warn', () => {});

  extremeRole.permissions = new PermissionsBitField([Flags.ManageRoles]);
  await service.ensureWeatherRolePanel(harness.guild);

  assert.equal(oldPanel.deleted, true);
  const newPanelId = harness.getWeatherState().rolePanelMessageId;
  assert.notEqual(newPanelId, oldPanel.id);
  assert.deepEqual(harness.store.getReactionRoleEntries(GUILD_ID).map((entry) => [entry.messageId, entry.roleId]), [[newPanelId, MILD_ROLE_ID]]);
  assert.ok(warn.mock.calls.some((call) => /Manage Roles permission/.test(call.arguments[0])));
});

test('the guild lock keeps a check from interleaving with a channel move', async (t) => {
  const harness = createWeatherHarness(t);
  const oldChannel = harness.addChannel({ id: WEATHER_CHANNEL_ID, name: WEATHER_CHANNEL_NAME });
  const newChannel = harness.addChannel({ id: OTHER_CHANNEL_ID, name: 'weather-two' });
  harness.configureWeather(WEATHER_CHANNEL_ID, { mild: MILD_ROLE_ID, extreme: EXTREME_ROLE_ID });
  const service = harness.createService();
  await service.checkForWeather(at('2026-10-21T17:56:00Z'));
  assert.equal(oldChannel.sent.length, 1);

  // Same steps as the editor's channel save: delete tracked posts, then switch the channel.
  const releaseDeletes = harness.holdDeletes();
  const move = service.withGuildLock(GUILD_ID, async () => {
    await service.deleteTrackedWeatherMessages(GUILD_ID);
    await service.deleteWeatherRolePanel(harness.guild);
    harness.configureWeather(OTHER_CHANNEL_ID, { mild: MILD_ROLE_ID, extreme: EXTREME_ROLE_ID });
  });
  const check = service.checkForWeather(at('2026-10-21T18:36:00Z'));
  for (let tick = 0; tick < 5; tick += 1) {
    await flushAsync();
  }
  assert.equal(oldChannel.sent.length + newChannel.sent.length, 1, 'the check waits for the move');

  releaseDeletes();
  await Promise.all([move, check]);

  assert.ok(oldChannel.sent.every((message) => message.deleted));
  const state = harness.getWeatherState();
  const tracked = new Set([state.dashboardMessageId, state.rolePanelMessageId, ...Object.values(state.pingMessageIds)].filter(Boolean));
  const live = [...oldChannel.sent, ...newChannel.sent].filter((message) => !message.deleted);
  assert.equal(live.length, 2);
  assert.ok(live.every((message) => tracked.has(message.id)), 'every live weather post is tracked');
  assert.equal(state.channelId, OTHER_CHANNEL_ID);
  assert.match(getPings(newChannel)[0].content, new RegExp(`^<@&${MILD_ROLE_ID}>`));
});

test('deleting tracked messages only forgets the ids it actually deleted', async (t) => {
  const harness = createWeatherHarness(t);
  const channel = harness.addChannel({ id: WEATHER_CHANNEL_ID, name: WEATHER_CHANNEL_NAME });
  harness.configureWeather(WEATHER_CHANNEL_ID, { extreme: EXTREME_ROLE_ID });
  const service = harness.createService();
  await service.checkForWeather(at('2026-10-21T17:36:00Z'));
  const [extremePing, dashboard] = channel.sent;

  const releaseDeletes = harness.holdDeletes();
  const deletion = service.deleteTrackedWeatherMessages(GUILD_ID);
  await flushAsync();
  // Simulates a ping that an unserialized caller posted while the delete was pending.
  const lateMessageId = '500000000000009999';
  const state = harness.getWeatherState();
  harness.store.setGuildRuntimeState(GUILD_ID, {
    weather: { ...state, pingMessageIds: { ...state.pingMessageIds, mild: lateMessageId }, pingExpireAts: { ...state.pingExpireAts, mild: 123 } }
  });
  releaseDeletes();
  await deletion;

  assert.equal(extremePing.deleted, true);
  assert.equal(dashboard.deleted, true);
  const after = harness.getWeatherState();
  assert.deepEqual(after.pingMessageIds, { mild: lateMessageId, extreme: null });
  assert.deepEqual(after.pingExpireAts, { mild: 123, extreme: null });
  assert.equal(after.dashboardMessageId, null);
  assert.equal(after.channelId, WEATHER_CHANNEL_ID);
});

test('a thread or uncategorized channel never becomes the parent of a new channel', async (t) => {
  const harness = createWeatherHarness(t);
  harness.addChannel({ id: CATEGORY_ID, name: 'Yap', isText: false });
  const textChannel = harness.addChannel({ id: OTHER_CHANNEL_ID, name: 'general', parentId: CATEGORY_ID });
  harness.addChannel({ id: MINING_CHANNEL_ID, name: 'mining-events' });
  harness.store.setGuildConfig(GUILD_ID, { miningEvents: { channelId: MINING_CHANNEL_ID, roles: {} } });
  const service = harness.createService();
  const thread = { id: '300000000000000009', parentId: OTHER_CHANNEL_ID, isThread: () => true };

  assert.equal(await service.findBotChannelCategoryId(harness.guild, thread), null);
  assert.equal(await service.findBotChannelCategoryId(harness.guild, { id: '300000000000000010', parentId: OTHER_CHANNEL_ID }), null);
  assert.equal(await service.findBotChannelCategoryId(harness.guild, textChannel), CATEGORY_ID);
  assert.equal(await service.findBotChannelCategoryId(harness.guild), null);
});

function getIntroLines(islandKey, tier) {
  const lines = buildWeatherTooltipLines(islandKey, tier);
  return lines.slice(3, lines.findIndex((line) => line.startsWith('§8 • '))).map(visible);
}

test('island weather data is complete and only uses known stats and palette codes', () => {
  assert.equal(WEATHER_ISLANDS.length, 11);
  assert.equal(new Set(WEATHER_ISLANDS.map((island) => island.key)).size, 11);
  const colorCode = /^§[0-9a-f]$/;

  for (const island of WEATHER_ISLANDS) {
    assert.match(island.color, colorCode, island.key);
    assert.ok(['on the', 'in the', 'in'].includes(island.where), island.key);
    assert.equal(island.mild, island.tiers.mild.name);
    assert.equal(island.extreme, island.tiers.extreme.name);
    assert.ok(island.extremeBonus.length > 0 && !island.extremeBonus.includes('§'), island.key);

    for (const tier of ['mild', 'extreme']) {
      const weather = island.tiers[tier];
      const label = `${island.key}/${tier}`;
      assert.match(weather.color, colorCode, label);
      assert.equal([...weather.icon].length, 1, label);
      assert.equal(weather.stats.length, 3, label);
      for (const [statKey, amount] of weather.stats) {
        assert.ok(STAT_STYLES[statKey], `${label}: ${statKey}`);
        assert.ok(Number.isFinite(amount) && amount > 0, `${label}: ${statKey}`);
      }

      const lines = buildWeatherTooltipLines(island.key, tier);
      assert.equal(lines[0], `${weather.color}${weather.icon} ${weather.name}`);
      assert.equal(lines[1], tier === 'extreme' ? '§8EXTREME Weather' : '§8Mild Weather');
      assert.equal(lines[2], '');
      for (const line of lines) {
        assert.doesNotMatch(line, /§(?![0-9a-flr])/, `${label}: ${line}`);
        assert.ok([...line].every((char) => char.codePointAt(0) <= 0xffff), `${label} stays in the BMP: ${line}`);
        assert.ok(getMinecraftTextWidth(line) <= 186, `${label} fits the lore width: ${line}`);
      }
    }
  }

  assert.equal(WEATHER_ISLANDS.find((island) => island.key === 'moongladeMarsh').extreme, 'Thunderstorm');
  assert.equal(WEATHER_ISLANDS.find((island) => island.key === 'theEnd').extreme, 'Voidstorm');
  assert.equal(
    WEATHER_ISLANDS.find((island) => island.key === 'lotusAtoll').extremeBonus,
    'Trophy Frogs are 5% more likely to be GOLD or DIAMOND'
  );
  assert.throws(() => buildWeatherTooltipLines('atlantis', 'mild'), /Unknown weather island/);
  assert.throws(() => buildWeatherTooltipLines('garden', 'storm'), /Unknown weather island/);
});

test('tooltip lines match the in-game Blooming and Blossoming tooltips', () => {
  assert.deepEqual(buildWeatherTooltipLines('garden', 'extreme'), [
    '§d✾ Blooming',
    '§8EXTREME Weather',
    '',
    '§7All players on the §aGarden §7receive',
    '§7the following stats during §dBlooming§7:',
    '§8 • §2+10ൠ Bonus Pest Chance',
    '§8 • §e+5☀ Overbloom',
    '§8 • §6+50☘ Farming Fortune',
    '§8 • §7Gain §a+10% §7more §aSowdust'
  ]);
  assert.deepEqual(buildWeatherTooltipLines('lotusAtoll', 'extreme'), [
    '§d✿ Blossoming',
    '§8EXTREME Weather',
    '',
    '§7All players on the §3Lotus Atoll',
    '§7receive the following stats during',
    '§dBlossoming§7:',
    '§8 • §b+50☂ Fishing Speed',
    '§8 • §3+5α Sea Creature Chance',
    '§8 • §6+5♔ Trophy Chance',
    '§8 • §aTrophy Frogs §7are §a5% §7more likely',
    '§7   to be §6§lGOLD §7or §b§lDIAMOND'
  ]);
});

test('the intro sentence wraps exactly like the in-game tooltips', () => {
  const cases = [
    ['lotusAtoll', 'extreme', ['All players on the Lotus Atoll', 'receive the following stats during', 'Blossoming:']],
    ['garden', 'extreme', ['All players on the Garden receive', 'the following stats during Blooming:']],
    ['theEnd', 'extreme', ['All players on the The End receive', 'the following stats during Voidstorm:']],
    ['glaciteTunnels', 'mild', ['All players in the Glacite Tunnels', 'receive the following stats during', 'Breeze:']],
    ['moongladeMarsh', 'extreme', ['All players on the Moonglade Marsh', 'receive the following stats during', 'Thunderstorm:']],
    // The remaining reference screenshots.
    ['lotusAtoll', 'mild', ['All players on the Lotus Atoll', 'receive the following stats during', 'Tropical Rain:']],
    ['glaciteTunnels', 'extreme', ['All players in the Glacite Tunnels', 'receive the following stats during', 'Snowstorm:']],
    ['theEnd', 'mild', ['All players on the The End receive', 'the following stats during Wispfall:']],
    ['moongladeMarsh', 'mild', ['All players on the Moonglade Marsh', 'receive the following stats during', 'Moonfall:']]
  ];

  for (const [islandKey, tier, expected] of cases) {
    assert.deepEqual(getIntroLines(islandKey, tier), expected, `${islandKey}/${tier}`);
  }
});

test('wrapping measures Minecraft pixel widths and carries colour and bold to the next line', () => {
  assert.equal(getMinecraftTextWidth('§7All players'), 55);
  assert.equal(getMinecraftTextWidth("il'tf@ "), 2 + 3 + 2 + 4 + 5 + 7 + 4);
  assert.equal(getMinecraftTextWidth('§lGOLD'), 28);
  assert.equal(getMinecraftTextWidth('§6§lGOLD§r!'), 30);

  assert.deepEqual(wrapMinecraftText('§aone §btwo three', 40), ['§aone §btwo', '§bthree']);
  assert.deepEqual(wrapMinecraftText('§6§lGOLD GOLD GOLD', 40), ['§6§lGOLD', '§6§lGOLD', '§6§lGOLD']);
  assert.deepEqual(wrapMinecraftText('§7to be §6§lGOLD §7or', 40), ['§7to be', '§6§lGOLD', '§7or']);
  assert.deepEqual(wrapMinecraftText('§cred§r plain text', 50), ['§cred§r plain', 'text']);
  assert.deepEqual(wrapMinecraftText('short'), ['short']);
  assert.deepEqual(wrapMinecraftText('Supercalifragilistic', 20), ['Supercalifragilistic']);
});

test('the dashboard state key bump edits an older dashboard once with the island select', async (t) => {
  const harness = createWeatherHarness(t);
  const channel = harness.addChannel({ id: WEATHER_CHANNEL_ID, name: WEATHER_CHANNEL_NAME });
  harness.configureWeather(WEATHER_CHANNEL_ID);
  const now = at('2026-10-21T17:40:00Z');
  const legacy = await channel.send({
    embeds: [{ title: '🌤️ SkyBlock Weather', description: 'old layout', fields: [{ name: 'EXTREME bonuses', value: '…' }] }],
    allowedMentions: { parse: [] }
  });
  harness.store.setGuildRuntimeState(GUILD_ID, {
    weather: {
      ...harness.getWeatherState(),
      channelId: WEATHER_CHANNEL_ID,
      dashboardMessageId: legacy.id,
      dashboardStateKey: `${getActiveWeatherWindow(now).index}:${getNextWeatherWindow(now).index}`
    }
  });
  const service = harness.createService();

  await service.checkForWeather(now);
  assert.equal(channel.sent.length, 1);
  assert.equal(legacy.edits.length, 1);
  assert.equal(legacy.edits[0].components.length, 1);
  assert.equal(getIslandSelect(legacy).options.length, 11);
  assert.deepEqual(legacy.embeds[0].fields.map((field) => field.name), ['Next Mild', 'Next EXTREME', 'Upcoming']);
  assert.match(harness.getWeatherState().dashboardStateKey, /^v3:/);

  await service.checkForWeather(now + (60 * 1000));
  assert.equal(legacy.edits.length, 1);
  assert.equal(channel.sent.length, 1);
});

test('choosing an island answers ephemerally with a rendered tooltip image, rendered once per island', async (t) => {
  const harness = createWeatherHarness(t);
  const service = harness.createService();
  const now = at('2026-10-21T17:40:00Z');

  const first = createSelectInteraction(['garden']);
  await service.handleIslandSelect(first, now);
  assert.deepEqual(first.calls.map(([name]) => name), ['deferReply', 'editReply']);
  assert.equal(first.calls[0][1].flags, MessageFlags.Ephemeral);

  const reply = first.calls[1][1];
  assert.equal(
    reply.content,
    `**Garden** · next Mild <t:${unix(at('2026-10-21T18:35:00Z'))}:R> · next EXTREME <t:${unix(at('2026-10-21T20:35:00Z'))}:R>`
      + ` · EXTREME active now until <t:${unix(at('2026-10-21T17:55:00Z'))}:t>`
  );
  assert.equal(reply.files.length, 1);
  const [file] = reply.files;
  assert.ok(file instanceof AttachmentBuilder);
  assert.equal(file.name, 'weather-garden.png');
  assert.ok(Buffer.isBuffer(file.attachment));
  assert.ok(file.attachment.subarray(0, 8).equals(PNG_SIGNATURE));

  assert.equal(harness.renderCalls.length, 1);
  assert.deepEqual(harness.renderCalls[0].tooltips, [
    buildWeatherTooltipLines('garden', 'mild'),
    buildWeatherTooltipLines('garden', 'extreme')
  ]);

  const second = createSelectInteraction(['garden']);
  await service.handleIslandSelect(second, at('2026-10-21T18:00:00Z'));
  assert.equal(harness.renderCalls.length, 1, 'the cached image is reused');
  assert.equal(second.calls[1][1].files[0].attachment, file.attachment);
  assert.doesNotMatch(second.calls[1][1].content, /active now/);

  const jerry = createSelectInteraction(['jerrysWorkshop']);
  await service.handleIslandSelect(jerry, now);
  assert.equal(harness.renderCalls.length, 2);
  assert.match(jerry.calls[1][1].content, /^\*\*Jerry's Workshop\*\* \(Season of Jerry only\) · next Mild/);
  assert.equal(jerry.calls[1][1].files[0].name, 'weather-jerrysWorkshop.png');

  // Concurrent selects of a new island share one render.
  await Promise.all([
    service.handleIslandSelect(createSelectInteraction(['theEnd']), now),
    service.handleIslandSelect(createSelectInteraction(['theEnd']), now)
  ]);
  assert.equal(harness.renderCalls.length, 3);
});

test('an island select works while the guild lock is held and rejects unknown islands', async (t) => {
  const harness = createWeatherHarness(t);
  const service = harness.createService();
  void service.withGuildLock(GUILD_ID, () => new Promise(() => {}));

  const unknown = createSelectInteraction(['atlantis']);
  await service.handleIslandSelect(unknown);
  assert.deepEqual(unknown.calls.map(([name]) => name), ['reply']);
  assert.equal(unknown.calls[0][1].flags, MessageFlags.Ephemeral);
  assert.match(unknown.calls[0][1].content, /Unknown island/);
  for (const value of ['constructor', '__proto__']) {
    const prototypeKey = createSelectInteraction([value]);
    await service.handleIslandSelect(prototypeKey);
    assert.deepEqual(prototypeKey.calls.map(([name]) => name), ['reply'], value);
  }
  assert.throws(() => buildWeatherTooltipLines('garden', 'constructor'), /Unknown weather island/);
  assert.equal(harness.renderCalls.length, 0);

  const known = createSelectInteraction(['lotusAtoll']);
  await service.handleIslandSelect(known);
  assert.equal(known.calls[1][1].files[0].name, 'weather-lotusAtoll.png');
});

test('a failed render falls back to a plain-text summary and is retried next time', async (t) => {
  const harness = createWeatherHarness(t);
  const error = t.mock.method(console, 'error', () => {});
  let failures = 1;
  let renders = 0;
  const service = harness.createService(harness.store, {
    renderTooltips: async () => {
      renders += 1;
      if (failures > 0) {
        failures -= 1;
        throw new Error('canvas missing');
      }
      return PNG_SIGNATURE;
    }
  });

  const failed = createSelectInteraction(['garden']);
  await service.handleIslandSelect(failed, at('2026-10-21T17:00:00Z'));
  assert.deepEqual(failed.calls.map(([name]) => name), ['deferReply', 'editReply']);
  const fallback = failed.calls[1][1];
  assert.equal(fallback.files, undefined);
  assert.deepEqual(fallback.content.split('\n'), [
    `**Garden** · next Mild <t:${unix(at('2026-10-21T18:35:00Z'))}:R> · next EXTREME <t:${unix(at('2026-10-21T17:35:00Z'))}:R>`,
    '',
    '🌦️ **Mild — Rain**: +5 Bonus Pest Chance, +2.5 Overbloom, +25 Farming Fortune',
    '⛈️ **EXTREME — Blooming**: +10 Bonus Pest Chance, +5 Overbloom, +50 Farming Fortune · Gain +10% more Sowdust'
  ]);
  assert.equal(error.mock.callCount(), 1);
  assert.match(error.mock.calls[0].arguments[0], /garden/);

  const retried = createSelectInteraction(['garden']);
  await service.handleIslandSelect(retried, at('2026-10-21T17:00:00Z'));
  assert.equal(renders, 2);
  assert.equal(retried.calls[1][1].files[0].name, 'weather-garden.png');
});
