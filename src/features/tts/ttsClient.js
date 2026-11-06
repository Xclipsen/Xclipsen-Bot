// HTTP client for the tts-service container (see tts-service/README.md).

const SYNTHESIZE_TIMEOUT_MS = 30_000;
// Short: /tts voice and autocomplete must answer within Discord's 3 second window.
const VOICES_TIMEOUT_MS = 2_000;
const VOICES_CACHE_MS = 60_000;

function createTtsClient({ baseUrl, fetchImpl = fetch }) {
  let voicesCache = null;

  async function synthesize(text, voice) {
    const response = await fetchImpl(`${baseUrl}/synthesize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, voice: voice || null }),
      signal: AbortSignal.timeout(SYNTHESIZE_TIMEOUT_MS)
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // The configured voice was removed from the service: fall back to its default voice.
      if (response.status === 400 && voice && detail.includes('unknown voice')) {
        return synthesize(text, null);
      }
      throw new Error(`TTS service answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  // [{ id, label, engine }]; cached because autocomplete asks on every keystroke.
  async function listVoices() {
    if (voicesCache && Date.now() - voicesCache.fetchedAt < VOICES_CACHE_MS) {
      return voicesCache.voices;
    }

    const response = await fetchImpl(`${baseUrl}/voices`, { signal: AbortSignal.timeout(VOICES_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`TTS service answered ${response.status}`);
    }

    const body = await response.json();
    const voices = Array.isArray(body) ? body : body.voices || [];
    voicesCache = { voices, fetchedAt: Date.now() };
    return voices;
  }

  return { synthesize, listVoices };
}

module.exports = { createTtsClient };
