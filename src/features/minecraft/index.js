const { createIrcBridge } = require('./ircBridge');

function createMinecraftFeatures({ client, env, store }) {
  const modules = {
    ircBridge: createIrcBridge({ client, env, store })
  };

  async function start() {
    for (const feature of Object.values(modules)) {
      if (typeof feature.start === 'function') {
        await feature.start();
      }
    }
  }

  async function stop() {
    for (const feature of Object.values(modules)) {
      if (typeof feature.stop === 'function') {
        await feature.stop();
      }
    }
  }

  async function handleDiscordMessage(message) {
    for (const feature of Object.values(modules)) {
      if (typeof feature.handleDiscordMessage === 'function') {
        await feature.handleDiscordMessage(message);
      }
    }
  }

  async function sendEventMessage(eventKey, eventName, content, options = {}) {
    for (const feature of Object.values(modules)) {
      if (typeof feature.sendEventMessage === 'function') {
        await feature.sendEventMessage(eventKey, eventName, content, options);
      }
    }
  }

  return {
    ...modules,
    start,
    stop,
    handleDiscordMessage,
    sendEventMessage
  };
}

module.exports = { createMinecraftFeatures };
