const assert = require('node:assert/strict');
const test = require('node:test');

process.env.DISCORD_TOKEN ||= 'test-token';

const {
  createSpotifyResolver, parseSpotifyLink, isSpotifyLink, toSearchQuery, pickBestMatch, scoreCandidate, SpotifyError
} = require('../src/features/music/spotify');
const { MusicError } = require('../src/features/music/sources');
const embedFixture = require('./fixtures/spotify-embed.json');

const TRACK_ID = '4u7EnebtmKWzUH433cf5Qv';
const PLAYLIST_ID = '5ABHKGoOzxkaa28ttQV9sE';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function embedResponse(nextData) {
  return new Response(`<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></body></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html' }
  });
}

// Routes fetch calls by URL prefix; records every call.
function createFakeFetch(routes) {
  const calls = [];
  async function fetchImpl(url, options = {}) {
    calls.push({ url, options });
    for (const [prefix, handler] of routes) {
      if (url.startsWith(prefix)) return handler(url, options);
    }
    throw new Error(`Unexpected fetch ${url}`);
  }
  return { fetchImpl, calls };
}

function tokenRoute(counter = { count: 0 }, expiresIn = 3600) {
  return ['https://accounts.spotify.com/api/token', () => {
    counter.count += 1;
    return jsonResponse({ access_token: `token-${counter.count}`, token_type: 'Bearer', expires_in: expiresIn });
  }];
}

function apiTrackItem(n) {
  return { id: `track${String(n).padStart(17, '0')}`, name: `Song ${n}`, type: 'track', artists: [{ name: 'Band' }], album: { name: 'Record' }, duration_ms: 200_000 + n, external_ids: { isrc: `ISRC${n}` }, external_urls: { spotify: `https://open.spotify.com/track/t${n}` } };
}

test('parseSpotifyLink reads open.spotify.com links, intl paths, si params and spotify: URIs', () => {
  assert.deepEqual(parseSpotifyLink(`https://open.spotify.com/track/${TRACK_ID}?si=abc123`), { type: 'track', id: TRACK_ID });
  assert.deepEqual(parseSpotifyLink(`https://open.spotify.com/intl-de/album/0ETFjACtuP2ADo6LFhL6HN?si=x&nd=1`), { type: 'album', id: '0ETFjACtuP2ADo6LFhL6HN' });
  assert.deepEqual(parseSpotifyLink(`open.spotify.com/playlist/${PLAYLIST_ID}`), { type: 'playlist', id: PLAYLIST_ID });
  assert.deepEqual(parseSpotifyLink(`https://open.spotify.com/user/someone/playlist/${PLAYLIST_ID}`), { type: 'playlist', id: PLAYLIST_ID });
  assert.deepEqual(parseSpotifyLink(`https://open.spotify.com/embed/artist/1dfeR4HaWDbWqFHLkxsg1d`), { type: 'artist', id: '1dfeR4HaWDbWqFHLkxsg1d' });
  assert.deepEqual(parseSpotifyLink(`spotify:track:${TRACK_ID}`), { type: 'track', id: TRACK_ID });
  assert.equal(parseSpotifyLink(`https://open.spotify.com/episode/${TRACK_ID}`), null);
  assert.equal(parseSpotifyLink(`https://open.spotify.com.evil.example/track/${TRACK_ID}`), null);
  assert.equal(parseSpotifyLink(`https://evil.example/open.spotify.com/track/${TRACK_ID}`), null);
  assert.equal(parseSpotifyLink('https://open.spotify.com/track/short'), null);
  assert.equal(parseSpotifyLink('never gonna give you up'), null);
  assert.equal(isSpotifyLink(`https://open.spotify.com/episode/${TRACK_ID}`), true);
  assert.equal(isSpotifyLink('https://spotify.link/AbCdEf'), true);
  assert.equal(isSpotifyLink('https://youtube.com/watch?v=x'), false);
});

test('parseSpotifyUrl follows short-link redirects only on Spotify domains', async () => {
  const { fetchImpl, calls } = createFakeFetch([
    ['https://spotify.link/good', () => new Response(null, { status: 307, headers: { location: 'https://spotify.app.link/good?_p=1' } })],
    ['https://spotify.app.link/good', () => new Response(null, { status: 302, headers: { location: `https://open.spotify.com/intl-de/track/${TRACK_ID}?si=x` } })],
    ['https://spotify.link/evil', () => new Response(null, { status: 302, headers: { location: `https://evil.example/track/${TRACK_ID}` } })],
    ['https://spotify.link/loop', () => new Response(null, { status: 302, headers: { location: 'https://spotify.link/loop' } })],
    ['https://spotify.app.link/html', () => new Response(`<a href="https://open.spotify.com/playlist/${PLAYLIST_ID}?si=1">open</a>`, { status: 200 })]
  ]);
  const resolver = createSpotifyResolver({ fetchImpl });

  assert.deepEqual(await resolver.parseSpotifyUrl('https://spotify.link/good'), { type: 'track', id: TRACK_ID });
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(await resolver.parseSpotifyUrl('spotify.link/evil'), null);
  calls.length = 0;
  assert.equal(await resolver.parseSpotifyUrl('https://spotify.link/loop'), null);
  assert.equal(calls.length, 3);
  assert.deepEqual(await resolver.parseSpotifyUrl('https://spotify.app.link/html'), { type: 'playlist', id: PLAYLIST_ID });
  await assert.rejects(resolver.resolve('https://spotify.link/evil'), { message: /short link doesn't lead/ });
});

test('Web API token is cached until it expires', async () => {
  let time = 1_000_000;
  const counter = { count: 0 };
  const { fetchImpl, calls } = createFakeFetch([
    tokenRoute(counter, 3600),
    ['https://api.spotify.com/v1/tracks/', () => jsonResponse(apiTrackItem(1))]
  ]);
  const resolver = createSpotifyResolver({ clientId: 'id', clientSecret: 'secret', fetchImpl, now: () => time });

  const first = await resolver.resolve(`https://open.spotify.com/track/${TRACK_ID}`);
  assert.equal(first.source, 'api');
  assert.deepEqual(first.tracks[0], { title: 'Song 1', artists: ['Band'], album: 'Record', durationMs: 200_001, isrc: 'ISRC1', spotifyUrl: 'https://open.spotify.com/track/t1' });
  await resolver.resolve(`spotify:track:${TRACK_ID}`);
  assert.equal(counter.count, 1);
  const tokenCall = calls.find((call) => call.url.startsWith('https://accounts.spotify.com'));
  assert.equal(tokenCall.options.headers.Authorization, `Basic ${Buffer.from('id:secret').toString('base64')}`);
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer token-1');

  time += 3600 * 1000;
  await resolver.resolve(`spotify:track:${TRACK_ID}`);
  assert.equal(counter.count, 2);
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer token-2');
});

test('Web API playlists paginate up to the limit and report truncation', async () => {
  const pages = [];
  const total = 120;
  for (let offset = 0; offset < total; offset += 50) {
    const items = [];
    for (let n = offset; n < Math.min(total, offset + 50); n += 1) items.push({ item: apiTrackItem(n) });
    // Local files and podcast episodes are skipped.
    if (offset === 0) items.splice(1, 0, { item: { ...apiTrackItem(999), is_local: true } }, { item: { ...apiTrackItem(998), type: 'episode' } }, { item: null });
    pages.push({ items, next: offset + 50 < total ? `https://api.spotify.com/v1/playlists/${PLAYLIST_ID}/items?offset=${offset + 50}&limit=50` : null });
  }
  const { fetchImpl, calls } = createFakeFetch([
    tokenRoute(),
    [`https://api.spotify.com/v1/playlists/${PLAYLIST_ID}/items?offset=`, (url) => jsonResponse(pages[Number(new URL(url).searchParams.get('offset')) / 50])],
    [`https://api.spotify.com/v1/playlists/${PLAYLIST_ID}`, () => jsonResponse({ name: 'Mix', owner: { display_name: 'la' }, items: pages[0] })]
  ]);
  const resolver = createSpotifyResolver({ clientId: 'id', clientSecret: 'secret', fetchImpl });

  const limited = await resolver.resolve(`https://open.spotify.com/playlist/${PLAYLIST_ID}`, { limit: 60 });
  assert.equal(limited.kind, 'playlist');
  assert.equal(limited.name, 'Mix');
  assert.equal(limited.owner, 'la');
  assert.equal(limited.tracks.length, 60);
  assert.equal(limited.truncated, true);
  assert.deepEqual(limited.tracks.slice(0, 2).map((track) => track.title), ['Song 0', 'Song 1']);
  assert.equal(calls.filter((call) => call.url.includes('offset=100')).length, 0);

  const all = await resolver.resolve(`https://open.spotify.com/playlist/${PLAYLIST_ID}`, { limit: 500 });
  assert.equal(all.tracks.length, 120);
  assert.equal(all.truncated, false);
  assert.equal(all.tracks.at(-1).title, 'Song 119');
});

test('Web API albums use the pre-2026 tracks field and keep the album name', async () => {
  const { fetchImpl } = createFakeFetch([
    tokenRoute(),
    ['https://api.spotify.com/v1/albums/', () => jsonResponse({
      name: 'Record', artists: [{ name: 'Band' }, { name: 'Guest' }],
      tracks: { items: [{ id: 'a'.repeat(22), name: 'Intro', artists: [{ name: 'Band' }], duration_ms: 1000 }], next: null }
    })]
  ]);
  const resolver = createSpotifyResolver({ clientId: 'id', clientSecret: 'secret', fetchImpl });
  const album = await resolver.resolve('spotify:album:0ETFjACtuP2ADo6LFhL6HN');
  assert.equal(album.owner, 'Band, Guest');
  assert.deepEqual(album.tracks, [{ title: 'Intro', artists: ['Band'], album: 'Record', durationMs: 1000, spotifyUrl: `https://open.spotify.com/track/${'a'.repeat(22)}` }]);
});

test('without credentials the embed page fixture is parsed', async () => {
  const { fetchImpl, calls } = createFakeFetch([
    [`https://open.spotify.com/embed/track/${TRACK_ID}`, () => embedResponse(embedFixture.track)],
    ['https://open.spotify.com/embed/album/', () => embedResponse(embedFixture.album)],
    [`https://open.spotify.com/embed/playlist/${PLAYLIST_ID}`, () => embedResponse(embedFixture.playlist)],
    ['https://open.spotify.com/embed/artist/', () => embedResponse(embedFixture.artist)]
  ]);
  const resolver = createSpotifyResolver({ fetchImpl });
  assert.equal(resolver.hasCredentials, false);

  const track = await resolver.resolve(`https://open.spotify.com/track/${TRACK_ID}?si=1`);
  assert.deepEqual(track, {
    kind: 'track', name: 'Bohemian Rhapsody - Remastered 2011', source: 'embed', truncated: false,
    tracks: [{ title: 'Bohemian Rhapsody - Remastered 2011', artists: ['Queen'], durationMs: 354320, spotifyUrl: `https://open.spotify.com/track/${TRACK_ID}` }]
  });
  assert.match(calls[0].options.headers['User-Agent'], /Mozilla/);

  const album = await resolver.resolve('https://open.spotify.com/album/0ETFjACtuP2ADo6LFhL6HN');
  assert.equal(album.name, 'Abbey Road (Remastered 2009)');
  assert.equal(album.owner, 'The Beatles');
  assert.deepEqual(album.tracks[0], { title: 'Come Together - Remastered 2009', artists: ['The Beatles'], album: 'Abbey Road (Remastered 2009)', durationMs: 259946, spotifyUrl: 'https://open.spotify.com/track/2EqlS6tkEnglzr7tkKAAYD' });

  const playlist = await resolver.resolve(`https://open.spotify.com/playlist/${PLAYLIST_ID}`, { limit: 2 });
  assert.equal(playlist.owner, 'hoolgerssson');
  assert.equal(playlist.tracks.length, 2);
  assert.equal(playlist.truncated, true);
  assert.deepEqual(playlist.tracks[0].artists, ['The Weeknd']);

  const artist = await resolver.resolve('https://open.spotify.com/artist/1dfeR4HaWDbWqFHLkxsg1d');
  assert.equal(artist.kind, 'artist');
  assert.equal(artist.name, 'Queen');
  assert.equal(artist.owner, undefined);
  assert.ok(artist.tracks.length > 0);
});

test('a full 100-track embed page counts as truncated', async () => {
  const entity = structuredClone(embedFixture.playlist.props.pageProps.state.data.entity);
  const sample = entity.trackList[0];
  entity.trackList = Array.from({ length: 100 }, (_, n) => ({ ...sample, uri: `spotify:track:${String(n).padStart(22, 'x')}` }));
  const { fetchImpl } = createFakeFetch([['https://open.spotify.com/embed/', () => embedResponse({ props: { pageProps: { state: { data: { entity } } } } })]]);
  const result = await createSpotifyResolver({ fetchImpl }).resolve(`spotify:playlist:${PLAYLIST_ID}`, { limit: 200 });
  assert.equal(result.tracks.length, 100);
  assert.equal(result.truncated, true);
});

test('Web API failures fall back to the embed page (editorial playlists, removed top tracks)', async () => {
  const { fetchImpl } = createFakeFetch([
    tokenRoute(),
    ['https://api.spotify.com/v1/playlists/', () => jsonResponse({ error: { status: 404, message: 'Resource not found' } }, 404)],
    ['https://api.spotify.com/v1/artists/', () => jsonResponse({ error: { status: 403, message: 'Forbidden' } }, 403)],
    ['https://open.spotify.com/embed/playlist/', () => embedResponse(embedFixture.editorialPlaylist)],
    ['https://open.spotify.com/embed/artist/', () => embedResponse(embedFixture.artist)]
  ]);
  const resolver = createSpotifyResolver({ clientId: 'id', clientSecret: 'secret', fetchImpl });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const playlist = await resolver.resolve('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');
    assert.equal(playlist.source, 'embed');
    assert.equal(playlist.name, 'Today’s Top Hits');
    assert.equal(playlist.owner, 'Spotify');
    const artist = await resolver.resolve('https://open.spotify.com/artist/1dfeR4HaWDbWqFHLkxsg1d');
    assert.equal(artist.source, 'embed');
  } finally {
    console.warn = originalWarn;
  }
});

test('Web API playlists without items (restricted dev-mode apps) fall back to the embed page', async () => {
  const { fetchImpl } = createFakeFetch([
    tokenRoute(),
    ['https://api.spotify.com/v1/playlists/', () => jsonResponse({ name: 'Mix', owner: { display_name: 'someone' } })],
    ['https://open.spotify.com/embed/playlist/', () => embedResponse(embedFixture.playlist)]
  ]);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await createSpotifyResolver({ clientId: 'id', clientSecret: 'secret', fetchImpl }).resolve(`spotify:playlist:${PLAYLIST_ID}`);
    assert.equal(result.source, 'embed');
    assert.equal(result.tracks.length, 3);
  } finally {
    console.warn = originalWarn;
  }
});

test('resolve throws short user-facing errors', async () => {
  const quiet = { warn: console.warn, error: console.error };
  console.warn = () => {};
  console.error = () => {};
  try {
    const notFound = createSpotifyResolver({ fetchImpl: createFakeFetch([['https://open.spotify.com/embed/', () => embedResponse(embedFixture.notFound)]]).fetchImpl });
    await assert.rejects(notFound.resolve(`spotify:playlist:${PLAYLIST_ID}`), (error) => error instanceof SpotifyError && error instanceof MusicError && /doesn't exist or is private/.test(error.message));
    await assert.rejects(notFound.resolve(`spotify:track:${TRACK_ID}`), { message: /track doesn't exist/ });
    await assert.rejects(notFound.resolve(`https://open.spotify.com/episode/${TRACK_ID}`), { message: /not podcasts/ });
    await assert.rejects(notFound.resolve('hello'), { message: /not a Spotify link/ });

    const broken = createFakeFetch([['https://open.spotify.com/embed/', () => new Response('<html>changed</html>', { status: 200 })]]);
    await assert.rejects(createSpotifyResolver({ fetchImpl: broken.fetchImpl }).resolve(`spotify:playlist:${PLAYLIST_ID}`), { message: /Setting SPOTIFY_CLIENT_ID\/SECRET/ });

    const editorial = createFakeFetch([
      tokenRoute(),
      ['https://api.spotify.com/v1/playlists/', () => jsonResponse({ error: { status: 404 } }, 404)],
      ['https://open.spotify.com/embed/', () => new Response('nope', { status: 500 })]
    ]);
    await assert.rejects(
      createSpotifyResolver({ clientId: 'id', clientSecret: 'secret', fetchImpl: editorial.fetchImpl }).resolve('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M'),
      { message: /Spotify-owned editorial and algorithmic playlists can't be read by bots/ }
    );
  } finally {
    console.warn = quiet.warn;
    console.error = quiet.error;
  }
});

test('toSearchQuery removes remaster noise and duplicate feat. credits', () => {
  assert.equal(toSearchQuery({ title: 'Bohemian Rhapsody - Remastered 2011', artists: ['Queen'] }), 'Queen - Bohemian Rhapsody');
  assert.equal(toSearchQuery({ title: 'Come Together - 2019 Mix', artists: ['The Beatles'] }), 'The Beatles - Come Together - 2019 Mix');
  assert.equal(toSearchQuery({ title: 'Here Comes the Sun (Remastered 2009)', artists: ['The Beatles'] }), 'The Beatles - Here Comes the Sun');
  assert.equal(toSearchQuery({ title: 'Starboy (feat. Daft Punk)', artists: ['The Weeknd', 'Daft Punk'] }), 'The Weeknd, Daft Punk - Starboy');
  assert.equal(toSearchQuery({ title: 'Old Town Road (feat. Billy Ray Cyrus) - Remix', artists: ['Lil Nas X'] }), 'Lil Nas X, Billy Ray Cyrus - Old Town Road - Remix');
  assert.equal(toSearchQuery({ title: 'Hold My Hand - From “Top Gun: Maverick”', artists: ['Lady Gaga'] }), 'Lady Gaga - Hold My Hand');
  assert.equal(toSearchQuery({ title: 'Wonderwall - Live at Knebworth', artists: ['Oasis'] }), 'Oasis - Wonderwall - Live at Knebworth');
  assert.equal(toSearchQuery({ title: 'Song', artists: ['A', 'B', 'C', 'D'] }), 'A, B, C - Song');
  assert.equal(toSearchQuery({ title: 'Remastered', artists: [] }), 'Remastered');
});

test('pickBestMatch prefers the official studio upload and respects duration', () => {
  const track = { title: 'Bohemian Rhapsody - Remastered 2011', artists: ['Queen'], durationMs: 354_320 };
  // Shape of real ytsearch5 results from 2026-11-06.
  const candidates = [
    { title: 'Queen - Bohemian Rhapsody (Live Aid 1985)', uploader: 'Queen Official', duration: 165, url: 'live-aid' },
    { title: 'Bohemian Rhapsody (cover)', uploader: 'Some Singer', duration: 352, url: 'cover' },
    { title: 'Queen - Bohemian Rhapsody (Nightcore)', uploader: 'NightcoreFan', duration: 290, url: 'nightcore' },
    { title: 'Bohemian Rhapsody (Remastered 2011)', uploader: 'Queen - Topic', duration: 355, url: 'topic' },
    { title: 'Queen - Bohemian Rhapsody (Lyrics)', uploader: '7clouds Rock', duration: 355, url: 'lyrics' }
  ];
  assert.equal(pickBestMatch(track, candidates).url, 'topic');
  assert.ok(scoreCandidate(track, candidates[3]) > scoreCandidate(track, candidates[0]));
  assert.ok(scoreCandidate(track, candidates[4]) > scoreCandidate(track, candidates[1]));

  // Same title and channel: the upload with the matching length wins.
  const lengths = [
    { title: 'Queen - Bohemian Rhapsody', uploader: 'Queen Official', duration: 600, url: 'long' },
    { title: 'Queen - Bohemian Rhapsody', uploader: 'Queen Official', duration: 358, url: 'right' }
  ];
  assert.equal(pickBestMatch(track, lengths).url, 'right');

  // Live/remix are fine when the Spotify track is that version.
  const liveTrack = { title: 'Wonderwall - Live at Knebworth', artists: ['Oasis'], durationMs: 270_000 };
  assert.equal(pickBestMatch(liveTrack, [
    { title: 'Oasis - Wonderwall (Official Video)', uploader: 'Oasis', duration: 258, url: 'studio' },
    { title: 'Oasis - Wonderwall (Live at Knebworth 1996)', uploader: 'Oasis', duration: 271, url: 'live' }
  ]).url, 'live');

  // Nothing related → null.
  assert.equal(pickBestMatch(track, [{ title: 'Minecraft speedrun world record', uploader: 'Gamer', duration: 1200, url: 'x' }]), null);
  assert.equal(pickBestMatch(track, []), null);
});

test('embed artists split on comma plus no-break space; http short links are fetched over https', async () => {
  const entity = {
    type: 'playlist',
    name: 'Duets',
    subtitle: 'me',
    trackList: [{ uri: `spotify:track:${TRACK_ID}`, title: 'Duet', subtitle: 'Alice, Bob, Carol', duration: 180_000 }]
  };
  const { fetchImpl, calls } = createFakeFetch([
    ['https://open.spotify.com/embed/playlist/', () => embedResponse({ props: { pageProps: { state: { data: { entity } } } } })],
    ['https://spotify.link/plain', () => new Response(null, { status: 302, headers: { location: `https://open.spotify.com/track/${TRACK_ID}` } })]
  ]);
  const resolver = createSpotifyResolver({ fetchImpl });
  const result = await resolver.resolve(`https://open.spotify.com/playlist/${PLAYLIST_ID}`);
  assert.deepEqual(result.tracks[0].artists, ['Alice', 'Bob', 'Carol']);

  assert.deepEqual(await resolver.parseSpotifyUrl('http://spotify.link/plain'), { type: 'track', id: TRACK_ID });
  assert.equal(calls.at(-1).url, 'https://spotify.link/plain');
});

test('oversized pages are refused and an empty Web API result is an error', async () => {
  // A valid embed page, only too big: without the size cap it would resolve.
  const entity = { type: 'playlist', name: 'Big', trackList: [{ uri: `spotify:track:${TRACK_ID}`, title: 'Song', subtitle: 'Band', duration: 1000 }] };
  const page = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script>`;
  const big = new Response(page + ' '.repeat(5 * 1024 * 1024), { status: 200, headers: { 'content-type': 'text/html' } });
  const originalError = console.error;
  console.error = () => {};
  try {
    const { fetchImpl } = createFakeFetch([['https://open.spotify.com/embed/playlist/', () => big]]);
    await assert.rejects(createSpotifyResolver({ fetchImpl }).resolve(`https://open.spotify.com/playlist/${PLAYLIST_ID}`), SpotifyError);
  } finally {
    console.error = originalError;
  }

  const { fetchImpl, calls } = createFakeFetch([
    tokenRoute(),
    ['https://api.spotify.com/v1/albums/', () => jsonResponse({ name: 'Empty', artists: [], tracks: { items: [], next: null } })]
  ]);
  const resolver = createSpotifyResolver({ clientId: 'id', clientSecret: 'secret', fetchImpl });
  await assert.rejects(resolver.resolve('https://open.spotify.com/album/0ETFjACtuP2ADo6LFhL6HN'), { message: /no playable tracks/ });
  assert.ok(!calls.some((call) => call.url.includes('/embed/')), 'no embed fallback for an empty album');
});
