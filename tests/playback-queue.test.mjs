import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlaybackQueue } from '../scripts/playback-queue.js';

test('serializes starts and drops an entry that became stale while queued', async () => {
  const queue = createPlaybackQueue();
  let releaseFirst;
  let secondStarts = 0;
  let secondIsCurrent = true;

  const first = queue.enqueue(
    () =>
      new Promise((resolve) => {
        releaseFirst = resolve;
      }),
  );
  await Promise.resolve();

  const second = queue.enqueue(
    () => {
      secondStarts += 1;
      return 'second';
    },
    () => secondIsCurrent,
  );
  secondIsCurrent = false;
  releaseFirst('first');

  assert.equal(await first, 'first');
  assert.equal(await second, null);
  assert.equal(secondStarts, 0);
});

test('a rejected start does not poison later queue entries', async () => {
  const queue = createPlaybackQueue();
  const failure = new Error('setup failed');

  await assert.rejects(
    queue.enqueue(() => Promise.reject(failure)),
    failure,
  );
  assert.equal(await queue.enqueue(() => 'recovered'), 'recovered');
});

test('rejects invalid callbacks before mutating the queue', () => {
  const queue = createPlaybackQueue();
  assert.throws(() => queue.enqueue(null), /expects start and isCurrent functions/);
  assert.throws(() => queue.enqueue(() => undefined, null), /expects start and isCurrent functions/);
});
