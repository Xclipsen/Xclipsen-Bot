const assert = require('node:assert/strict');
const test = require('node:test');

const { guarded } = require('../src/utils/guarded');

test('a guarded task skips overlapping runs', async () => {
  let calls = 0;
  let release;
  const task = guarded('Test task', () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  });
  const first = task();
  await task();
  assert.equal(calls, 1);
  release();
  await first;
  const second = task();
  release();
  await second;
  assert.equal(calls, 2);
});

test('a guarded task logs failures instead of rejecting and can run again', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  let calls = 0;
  const task = guarded('Failing task', async () => {
    calls += 1;
    throw new Error('boom');
  });
  await task();
  await task();
  assert.equal(calls, 2);
  assert.match(errors.mock.calls[0].arguments[0], /Failing task failed/);
});
