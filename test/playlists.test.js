const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MAX_PLAYLISTS_PER_USER,
  MAX_PLAYLIST_TRACKS,
  createPlaylistStore,
  normalizePlaylistData,
  toPlaylistTrack
} = require('../src/features/music/playlists');
const { createResumeStore } = require('../src/features/music/resume');
const { nextLoopMode, shuffled, removeAt, moveItem, totalDuration } = require('../src/features/music/queue');
const { createMusicSources, getYouTubePlaylistId } = require('../src/features/music/sources');

const owner = { id: 'owner', isManager: false };
const other = { id: 'other', isManager: false };
const admin = { id: 'admin', isManager: true };

function track(id, extra = {}) {
  return { kind: 'track', title: `Song ${id}`, url: `https://www.youtube.com/watch?v=${id}`, duration: 100, isLive: false, requesterId: 'x', thumbnail: 't', ...extra };
}

function createStore() {
  let time = 0;
  let id = 0;
  return createPlaylistStore({ now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, time++)).toISOString(), createId: () => `id${++id}` });
}

test('playlists store only { title, url, duration, isLive } of single YouTube videos', () => {
  assert.deepEqual(toPlaylistTrack(track('a1')), { title: 'Song a1', url: 'https://www.youtube.com/watch?v=a1', duration: 100, isLive: false });
  assert.equal(toPlaylistTrack({ kind: 'radio', title: 'Lofi', url: 'https://stream.laut.fm/lofi' }), null);
  assert.equal(toPlaylistTrack(track('x', { url: 'https://www.youtube.com/playlist?list=PL1' })), null);
  assert.equal(toPlaylistTrack(track('x', { url: 'https://example.com/song.mp3' })), null);

  const store = createStore();
  const playlist = store.create('g1', owner, '  Chill   Vibes ', [track('a1'), { kind: 'radio', title: 'R', url: 'https://r.example/x' }]);
  assert.equal(playlist.name, 'Chill Vibes');
  assert.equal(playlist.visibility, 'private');
  assert.equal(playlist.tracks.length, 1);
});

test('names are unique per owner (case-insensitive), 1-50 characters', () => {
  const store = createStore();
  store.create('g1', owner, 'Chill');
  assert.throws(() => store.create('g1', owner, 'CHILL'), /already have a playlist called/);
  // Another member and another server may use the same name.
  assert.equal(store.create('g1', other, 'chill').name, 'chill');
  assert.equal(store.create('g2', owner, 'Chill').name, 'Chill');
  assert.throws(() => store.create('g1', owner, '   '), /Give the playlist a name/);
  assert.throws(() => store.create('g1', owner, 'x'.repeat(51)), /at most 50/);
  assert.throws(() => store.create('g1', owner, '#id1'), /cannot start with/);
  assert.equal(store.create('g1', owner, 'y'.repeat(50)).name.length, 50);

  assert.throws(() => store.rename('g1', owner, 'chill', 'Y'.repeat(50)), /already is a playlist/);
  assert.equal(store.rename('g1', owner, 'chill', 'Lofi').name, 'Lofi');
  assert.equal(store.rename('g1', owner, 'lofi', 'LOFI').name, 'LOFI', 'only the case may change');
});

test('private playlists are only for the owner, public ones are read-only for others', () => {
  const store = createStore();
  store.create('g1', owner, 'Secret', [track('a1')]);
  const shared = store.create('g1', owner, 'Shared', [track('b1')], { visibility: 'public' });

  assert.throws(() => store.resolve('g1', other, 'Secret', 'owner'), /<@owner> has no public playlist called \*\*Secret\*\*/);
  assert.throws(() => store.resolve('g1', other, 'Shared'), /You have no playlist called/, 'without user: only own playlists');
  assert.equal(store.resolve('g1', other, 'shared', 'owner').id, shared.id);
  assert.equal(store.resolve('g1', other, `#${shared.id}`).id, shared.id);
  assert.throws(() => store.resolve('g1', other, `#${store.resolve('g1', owner, 'Secret').id}`), /no playlist/);

  for (const change of [
    () => store.addTracks('g1', other, `#${shared.id}`, [track('c1')]),
    () => store.removeTrack('g1', other, `#${shared.id}`, 1),
    () => store.rename('g1', other, `#${shared.id}`, 'Mine'),
    () => store.setVisibility('g1', other, `#${shared.id}`, 'private'),
    () => store.remove('g1', other, `#${shared.id}`)
  ]) {
    assert.throws(change, /Only <@owner> or a server manager/);
  }

  // Managers may see and change everything.
  assert.equal(store.resolve('g1', admin, 'Secret', 'owner').name, 'Secret');
  assert.equal(store.addTracks('g1', admin, `#${shared.id}`, [track('c1')]).added, 1);
  assert.equal(store.remove('g1', admin, `#${shared.id}`).name, 'Shared');
  assert.equal(store.listPublic('g1').length, 0);
});

test('lists: own plus public ones, one member\'s public ones, everything for owner and managers', () => {
  const store = createStore();
  store.create('g1', owner, 'Secret');
  store.create('g1', owner, 'Shared', [], { visibility: 'public' });
  store.create('g1', other, 'Mine');
  store.create('g1', other, 'Theirs Public', [], { visibility: 'public' });

  assert.deepEqual(store.listVisible('g1', other).map((entry) => entry.name).sort(), ['Mine', 'Shared', 'Theirs Public']);
  assert.deepEqual(store.listByOwner('g1', 'owner', other).map((entry) => entry.name), ['Shared']);
  assert.deepEqual(store.listByOwner('g1', 'owner', owner).map((entry) => entry.name).sort(), ['Secret', 'Shared']);
  assert.deepEqual(store.listByOwner('g1', 'owner', admin).map((entry) => entry.name).sort(), ['Secret', 'Shared']);

  // Played playlists come first, most recent first.
  store.markUsed('g1', store.resolve('g1', other, 'Theirs Public').id);
  assert.deepEqual(store.listPublic('g1').map((entry) => entry.name), ['Theirs Public', 'Shared']);

  const suggestions = store.suggest('g1', other, '');
  assert.deepEqual(suggestions.map((entry) => [entry.playlist.name, entry.own]), [['Theirs Public', true], ['Mine', true], ['Shared', false]]);
  assert.match(suggestions[2].value, /^#id/);
  assert.deepEqual(store.suggest('g1', other, '', { editable: true }).map((entry) => entry.playlist.name), ['Theirs Public', 'Mine']);
});

test('limits: 25 playlists per member and 200 tracks per playlist', () => {
  const store = createStore();
  for (let index = 0; index < MAX_PLAYLISTS_PER_USER; index += 1) store.create('g1', owner, `List ${index}`);
  assert.throws(() => store.create('g1', owner, 'One more'), /already have 25 playlists/);
  assert.equal(store.create('g1', other, 'One more').name, 'One more');

  const many = Array.from({ length: 250 }, (_, index) => track(`v${index}`));
  const { added, dropped, playlist } = store.addTracks('g1', other, 'One more', many);
  assert.equal(added, MAX_PLAYLIST_TRACKS);
  assert.equal(dropped, 50);
  assert.equal(playlist.tracks.length, 200);
  assert.throws(() => store.addTracks('g1', other, 'One more', [track('z')]), /is full \(200 tracks\)/);

  assert.throws(() => store.removeTrack('g1', other, 'One more', 201), /has no track 201/);
  assert.equal(store.removeTrack('g1', other, 'One more', 1).removed.title, 'Song v0');
});

test('save replaces your own playlist of that name, copy makes a private copy', () => {
  const store = createStore();
  const first = store.saveTracks('g1', owner, 'Queue', [track('a1'), { kind: 'radio', title: 'R', url: 'https://r.example/' }, track('b1')]);
  assert.equal(first.created, true);
  assert.deepEqual(first.playlist.tracks.map((entry) => entry.title), ['Song a1', 'Song b1']);
  const second = store.saveTracks('g1', owner, 'queue', [track('c1')]);
  assert.equal(second.created, false);
  assert.equal(second.playlist.id, first.playlist.id);
  assert.deepEqual(second.playlist.tracks.map((entry) => entry.title), ['Song c1']);
  assert.throws(() => store.saveTracks('g1', owner, 'Empty', [{ kind: 'radio', title: 'R', url: 'https://r.example/' }]), /no YouTube tracks/);

  assert.throws(() => store.copy('g1', other, 'Queue', 'owner', 'Mine'), /no public playlist/);
  store.setVisibility('g1', owner, 'Queue', 'public');
  const copy = store.copy('g1', other, 'Queue', 'owner');
  assert.equal(copy.name, 'Queue');
  assert.equal(copy.ownerId, 'other');
  assert.equal(copy.visibility, 'private');
  assert.deepEqual(copy.tracks, second.playlist.tracks);
  assert.throws(() => store.copy('g1', other, 'Queue', 'owner'), /already have a playlist called/);
  assert.equal(store.copy('g1', other, 'Queue', 'owner', 'Queue 2').name, 'Queue 2');
});

test('playlists are saved to and loaded from the JSON file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playlists-'));
  const filePath = path.join(dir, 'playlists.json');
  try {
    const store = createPlaylistStore({ filePath });
    store.create('g1', owner, 'Chill', [track('a1')], { visibility: 'public' });
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.deepEqual(Object.keys(raw.guilds), ['g1']);
    assert.deepEqual(Object.keys(raw.guilds.g1[0]).sort(), ['createdAt', 'id', 'lastUsedAt', 'name', 'ownerId', 'tracks', 'updatedAt', 'visibility']);
    assert.deepEqual(raw.guilds.g1[0].tracks[0], { title: 'Song a1', url: 'https://www.youtube.com/watch?v=a1', duration: 100, isLive: false });

    const reloaded = createPlaylistStore({ filePath });
    assert.equal(reloaded.resolve('g1', other, 'chill', 'owner').tracks.length, 1);

    fs.writeFileSync(filePath, '{ broken');
    assert.throws(() => createPlaylistStore({ filePath }), /not valid JSON/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const normalized = normalizePlaylistData({ guilds: { g1: [{ id: 'x', name: 'A', ownerId: 'o', visibility: 'weird', tracks: [{ title: 'T', url: 'https://evil.example/' }] }, { name: 'no id' }] } });
  assert.equal(normalized.guilds.g1.length, 1);
  assert.equal(normalized.guilds.g1[0].visibility, 'private');
  assert.equal(normalized.guilds.g1[0].tracks.length, 0);
});

test('resume snapshots persist, keep only queue item fields and expire after 24 hours', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-'));
  const filePath = path.join(dir, 'music-resume.json');
  let clock = 1_000;
  try {
    const store = createResumeStore({ filePath, now: () => clock });
    assert.equal(store.set('g1', { current: null, queue: [] }), null, 'nothing to keep');
    store.set('g1', { current: { ...track('a1'), resource: {} }, position: 42.7, queue: [track('b1')], loop: 'track', savedBy: 'owner', reason: 'stopped' });
    const reloaded = createResumeStore({ filePath, now: () => clock });
    const snapshot = reloaded.get('g1');
    assert.equal(snapshot.position, 42);
    assert.equal(snapshot.loop, 'track');
    assert.equal(snapshot.current.resource, undefined);
    assert.equal(snapshot.queue[0].title, 'Song b1');
    clock += 24 * 60 * 60 * 1000 + 1;
    assert.equal(reloaded.get('g1'), null);
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')).guilds, {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('queue helpers: shuffle, bounds, move and totals', () => {
  assert.deepEqual(['off', 'track', 'queue'].map(nextLoopMode), ['track', 'queue', 'off']);
  const items = [1, 2, 3, 4];
  const mixed = shuffled(items, () => 0.5);
  assert.deepEqual([...mixed].sort(), items);
  assert.deepEqual(items, [1, 2, 3, 4], 'the input stays unchanged');

  assert.throws(() => removeAt([], 1), /queue is empty/);
  assert.throws(() => removeAt([1], 0), /no track at position 0/);
  assert.throws(() => moveItem([1, 2], 1, 3), /no track at position 3/);
  assert.deepEqual(removeAt([1, 2, 3], 2), { queue: [1, 3], removed: 2 });
  assert.deepEqual(moveItem([1, 2, 3], 3, 1), { queue: [3, 1, 2], moved: 3 });
  assert.deepEqual(moveItem([1, 2, 3], 1, 3), { queue: [2, 3, 1], moved: 1 });

  assert.deepEqual(totalDuration([{ duration: 60 }, { duration: 30 }, { isLive: true, duration: null }, { duration: null }]), { seconds: 90, unknown: 2 });
});

test('playlist import lists one flat page of up to 100 entries', async () => {
  assert.equal(getYouTubePlaylistId('https://www.youtube.com/playlist?list=PL123'), 'PL123');
  assert.equal(getYouTubePlaylistId('https://youtu.be/abc?list=PLx_y-z'), 'PLx_y-z');
  assert.equal(getYouTubePlaylistId('https://www.youtube.com/watch?v=abc'), null);
  assert.equal(getYouTubePlaylistId('https://example.com/playlist?list=PL123'), null);

  const calls = [];
  const entries = Array.from({ length: 120 }, (_, index) => ({ id: `video${String(index).padStart(4, '0')}`, title: `V${index}`, duration: 61 }));
  entries[3] = { id: 'privatev', title: '[Private video]' };
  entries[4] = { id: 'upcoming', title: 'Soon', live_status: 'is_upcoming' };
  entries[5] = { id: 'livenow1', title: 'Live', live_status: 'is_live' };
  const spawn = (command, args) => {
    const { EventEmitter } = require('node:events');
    const { PassThrough } = require('node:stream');
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    calls.push(args);
    setImmediate(() => {
      child.stdout.write(JSON.stringify({ title: 'Big List', entries }));
      child.emit('close', 0);
    });
    return child;
  };
  const sources = createMusicSources({ spawn });
  const result = await sources.resolvePlaylist('https://www.youtube.com/watch?v=x&list=PLbig');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].at(-1), 'https://www.youtube.com/playlist?list=PLbig');
  assert.equal(result.title, 'Big List');
  assert.equal(result.tracks.length, 98);
  assert.equal(result.skipped, 2);
  assert.equal(result.tracks[3].isLive, true);
  assert.equal(result.tracks[3].duration, null);
  assert.equal(result.tracks[0].url, 'https://www.youtube.com/watch?v=video0000');

  await assert.rejects(sources.resolvePlaylist('https://www.youtube.com/watch?v=abc'), /link to a YouTube playlist/);
});
