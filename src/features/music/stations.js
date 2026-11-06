// Built-in lofi / chill internet radio streams (direct Icecast/Shoutcast audio URLs).
// All verified to stream audio on 2026-11-06. SomaFM refuses curl's user agent but accepts ffmpeg's.
const BUILT_IN_STATIONS = [
  { id: 'lautfm-lofi', name: 'Lofi (laut.fm)', url: 'https://stream.laut.fm/lofi' },
  { id: 'lautfm-lofi-radio', name: 'Lofi Radio (laut.fm)', url: 'https://stream.laut.fm/lofi-radio' },
  { id: 'lautfm-lofifm', name: 'lofiFM (laut.fm)', url: 'https://stream.laut.fm/lofifm' },
  { id: 'lautfm-loungetunes', name: 'Loungetunes: Chillhop & Jazzhop (laut.fm)', url: 'https://stream.laut.fm/loungetunes' },
  { id: 'lautfm-chilled-beats', name: 'Chilled Beats (laut.fm)', url: 'https://stream.laut.fm/chilled-beats' },
  { id: 'fluxfm-chillhop', name: 'FluxFM Chillhop', url: 'https://streams.fluxfm.de/Chillhop/mp3-128/streams.fluxfm.de/' },
  { id: 'somafm-groovesalad', name: 'SomaFM Groove Salad', url: 'https://ice4.somafm.com/groovesalad-128-mp3' },
  { id: 'somafm-fluid', name: 'SomaFM Fluid (instrumental hip hop)', url: 'https://ice4.somafm.com/fluid-128-mp3' },
  { id: 'somafm-lush', name: 'SomaFM Lush', url: 'https://ice4.somafm.com/lush-128-mp3' },
  { id: 'radioparadise-mellow', name: 'Radio Paradise Mellow Mix', url: 'https://stream.radioparadise.com/mellow-128' },
  { id: 'nightride-chillsynth', name: 'Nightride FM Chillsynth', url: 'https://stream.nightride.fm/chillsynth.mp3' }
];

const CUSTOM_PREFIX = 'custom:';

// Built-in stations plus the ones admins added in /setup (music.stations), each with a stable key.
function listStations(customStations = []) {
  const builtIn = BUILT_IN_STATIONS.map((station) => ({ key: station.id, name: station.name, url: station.url, custom: false }));
  const custom = customStations.map((station) => ({
    key: `${CUSTOM_PREFIX}${station.name.toLowerCase()}`.slice(0, 100),
    name: station.name,
    url: station.url,
    custom: true
  }));
  const seen = new Set();
  return [...builtIn, ...custom].filter((station) => !seen.has(station.key) && seen.add(station.key));
}

function findStation(key, customStations = []) {
  const stations = listStations(customStations);
  const normalized = String(key || '').trim().toLowerCase();
  return stations.find((station) => station.key === normalized)
    || stations.find((station) => station.name.toLowerCase() === normalized)
    || null;
}

module.exports = { BUILT_IN_STATIONS, listStations, findStation };
