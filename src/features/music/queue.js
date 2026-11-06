const { MusicError } = require('./sources');

// Pure queue helpers; positions are 1-based like in /music queue (the current track is not part of it).
const LOOP_MODES = ['off', 'track', 'queue'];

function nextLoopMode(mode) {
  return LOOP_MODES[(LOOP_MODES.indexOf(mode) + 1) % LOOP_MODES.length] || 'off';
}

// Fisher-Yates on a copy; `random` is injectable for tests.
function shuffled(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

function checkPosition(queue, position, label = 'position') {
  if (!Number.isInteger(position) || position < 1 || position > queue.length) {
    throw new MusicError(queue.length
      ? `There is no track at ${label} ${position}; the queue has ${queue.length} track${queue.length === 1 ? '' : 's'}.`
      : 'The queue is empty.');
  }
}

// Returns { queue, removed }.
function removeAt(queue, position) {
  checkPosition(queue, position);
  const next = [...queue];
  const [removed] = next.splice(position - 1, 1);
  return { queue: next, removed };
}

// Returns { queue, moved }.
function moveItem(queue, from, to) {
  checkPosition(queue, from, 'position');
  checkPosition(queue, to, 'position');
  const next = [...queue];
  const [moved] = next.splice(from - 1, 1);
  next.splice(to - 1, 0, moved);
  return { queue: next, moved };
}

// Sum of the known lengths; live items and unknown lengths are counted separately.
function totalDuration(items) {
  let seconds = 0;
  let unknown = 0;
  for (const item of items) {
    if (!item.isLive && Number.isFinite(item.duration)) seconds += item.duration;
    else unknown += 1;
  }
  return { seconds, unknown };
}

module.exports = { LOOP_MODES, nextLoopMode, shuffled, removeAt, moveItem, totalDuration };
