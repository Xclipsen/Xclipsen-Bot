const { simulatedMayors, simulatedPerkPool } = require('../config/simulationData');

function createSimulationFeature({ store }) {
  function getMayorByKey(key) {
    return simulatedMayors.find((mayor) => mayor.key === key) || null;
  }

  function pickRandomItems(items, count) {
    const pool = items.slice();
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }

    return pool.slice(0, count);
  }

  function buildCandidateVotes(selectedMayor) {
    const candidates = pickRandomItems(simulatedMayors.filter((mayor) => mayor.key !== selectedMayor.key), 4);
    const lineup = [...candidates, selectedMayor];

    return lineup
      .map((mayor) => ({
        name: mayor.name,
        votes: Math.floor(5000 + (Math.random() * 245000))
      }))
      .sort((left, right) => right.votes - left.votes);
  }

  function buildCustomSimulation({ mayorKey, perkCount, boothOpen }) {
    const mayor = getMayorByKey(mayorKey);
    if (!mayor) {
      throw new Error('Unknown mayor selection.');
    }

    return {
      success: true,
      lastUpdated: Date.now(),
      mayor: {
        key: mayor.key,
        name: mayor.name,
        perks: pickRandomItems(simulatedPerkPool, Math.min(perkCount, simulatedPerkPool.length))
      },
      current: boothOpen
        ? {
          year: 500,
          candidates: buildCandidateVotes(mayor)
        }
        : null,
      _mock: {
        boothOpen
      }
    };
  }

  async function handleSimulateCommand(interaction, mayorAlerts) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'clear') {
      store.setMockState({ enabled: false, customData: null });
      await interaction.reply({ content: 'Simulation cleared. The bot will use the real Hypixel API again.', flags: 64 });
      await mayorAlerts.checkElectionState();
      await mayorAlerts.sendScheduledStatusUpdate();
      return;
    }

    const mayorKey = interaction.options.getString('mayor', true);
    const perkCount = interaction.options.getInteger('perk_count', true);
    const boothOpen = interaction.options.getBoolean('booth_open') ?? false;
    const mayor = getMayorByKey(mayorKey);
    const customData = buildCustomSimulation({ mayorKey, perkCount, boothOpen });

    store.setMockState({ enabled: true, customData });
    await interaction.reply({
      content: `Custom simulation set to \`${mayor?.name || mayorKey}\` with ${perkCount} random perk(s)${boothOpen ? ' and an open election booth' : ''}. Triggering a fresh check now.`,
      flags: 64
    });
    await mayorAlerts.checkElectionState();
    await mayorAlerts.sendScheduledStatusUpdate();
  }

  return { handleSimulateCommand };
}

module.exports = { createSimulationFeature };
