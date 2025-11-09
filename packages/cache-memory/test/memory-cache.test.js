import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryCache, MemoryCache } from '../dist/index.js';

const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('returns undefined for missing keys and retrieves stored values', async () => {
  const cache = new MemoryCache();

  assert.equal(await cache.get('missing'), undefined);

  await cache.set('foo', 'bar');
  assert.equal(await cache.get('foo'), 'bar');

  await cache.delete('foo');
});

test('overwrites existing entries and clears old timers', async () => {
  let now = 0;
  const clock = () => now;
  const cache = new MemoryCache({ clock });

  await cache.set('key', 'first', { ttlSeconds: 10 });
  await cache.set('key', 'second');

  assert.equal(await cache.get('key'), 'second');
  await cache.delete('key');
});

test('lazily evicts expired entries when accessed', async () => {
  let now = 0;
  const clock = () => now;
  const cache = new MemoryCache({ clock });

  await cache.set('lazy', 'value', { ttlSeconds: 1 });
  now = 2000;

  assert.equal(await cache.get('lazy'), undefined);
});

test('evicts entries via timer when TTL elapses', async () => {
  const cache = new MemoryCache();

  await cache.set('timer', 'value', { ttlSeconds: 0 });
  await waitFor(0);

  assert.equal(await cache.get('timer'), undefined);
});

test('purges entries by tag', async () => {
  const cache = new MemoryCache();

  await cache.set('alpha', 1, { tags: ['group-1'] });
  await cache.set('beta', 2, { tags: ['group-1', 'group-2'] });
  await cache.set('gamma', 3, { tags: ['group-3'] });

  await cache.purgeByTag('group-1');

  assert.equal(await cache.get('alpha'), undefined);
  assert.equal(await cache.get('beta'), undefined);
  assert.equal(await cache.get('gamma'), 3);

  await cache.clear();
});

test('clears all entries and timers', async () => {
  const cache = new MemoryCache();

  await cache.set('one', 1, { ttlSeconds: 10 });
  await cache.set('two', 2);

  await cache.clear();

  assert.equal(await cache.get('one'), undefined);
  assert.equal(await cache.get('two'), undefined);
});

test('createMemoryCache factory constructs instances', async () => {
  const cache = createMemoryCache();
  await cache.set('factory', 'value');
  assert.equal(await cache.get('factory'), 'value');
});
