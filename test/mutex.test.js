import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMutex } from '../server/files/mutex.js';

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('work on one key runs strictly in order', async () => {
  const mutex = createMutex();
  const order = [];
  // The first task is the slowest. Without serialization it would finish last.
  const a = mutex.run('tank', async () => {
    await tick(30);
    order.push('a');
  });
  const b = mutex.run('tank', async () => {
    await tick(10);
    order.push('b');
  });
  const c = mutex.run('tank', async () => {
    order.push('c');
  });
  await Promise.all([a, b, c]);
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('different keys do not wait on each other', async () => {
  const mutex = createMutex();
  const order = [];
  const slow = mutex.run('tank', async () => {
    await tick(40);
    order.push('tank');
  });
  const fast = mutex.run('snake', async () => {
    order.push('snake');
  });
  await Promise.all([slow, fast]);
  assert.deepEqual(order, ['snake', 'tank']);
});

test('the caller receives the return value', async () => {
  const mutex = createMutex();
  assert.equal(await mutex.run('k', () => 42), 42);
  assert.equal(await mutex.run('k', async () => 'later'), 'later');
});

test('a rejection reaches its own caller and nobody else', async () => {
  const mutex = createMutex();
  const failing = mutex.run('k', async () => {
    throw new Error('commit failed');
  });
  const following = mutex.run('k', async () => 'still ran');

  await assert.rejects(failing, /commit failed/);
  // The critical property: one failed write must not wedge the project.
  assert.equal(await following, 'still ran');
  assert.equal(await mutex.run('k', () => 'and again'), 'and again');
});

test('a synchronous throw is serialised like any other failure', async () => {
  const mutex = createMutex();
  const boom = mutex.run('k', () => {
    throw new Error('sync boom');
  });
  await assert.rejects(boom, /sync boom/);
  assert.equal(await mutex.run('k', () => 'ok'), 'ok');
});

test('the key map empties once a queue drains', async () => {
  const mutex = createMutex();
  await Promise.all([
    mutex.run('a', () => tick(5)),
    mutex.run('b', () => tick(5)),
  ]);
  // Allow the cleanup continuation to run.
  await tick(5);
  assert.equal(mutex._size(), 0);
});

test('a long queue on one key stays ordered under load', async () => {
  const mutex = createMutex();
  const seen = [];
  const jobs = [];
  for (let i = 0; i < 25; i += 1) {
    jobs.push(mutex.run('tank', async () => {
      // Random-ish delays without Math.random: alternate long and short.
      await tick(i % 2 === 0 ? 4 : 1);
      seen.push(i);
    }));
  }
  await Promise.all(jobs);
  assert.deepEqual(seen, Array.from({ length: 25 }, (_, i) => i));
});
