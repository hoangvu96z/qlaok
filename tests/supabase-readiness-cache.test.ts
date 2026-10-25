import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import {
  ensureSupabaseReadyAndSeeded,
  setSupabaseDbClientForTests,
} from '@/lib/db';

const originalEnv = process.env;
before(() => { process.env = { ...process.env, NODE_ENV: 'production' }; });
after(() => {
  process.env = originalEnv;
  setSupabaseDbClientForTests(null);
});

function mockClient(resolveQuery: () => Promise<unknown> | unknown) {
  let queries = 0;
  return {
    get queries() { return queries; },
    client: {
      from(table: string) {
        assert.equal(table, 'shops');
        return {
          select(columns: string) {
            assert.equal(columns, 'id');
            return {
              limit(count: number) {
                assert.equal(count, 1);
                queries++;
                return resolveQuery();
              },
            };
          },
        };
      },
    },
  };
}

test('positive readiness is cached and concurrent calls share one query', async () => {
  let release!: (value: unknown) => void;
  const firstQuery = new Promise((resolve) => { release = resolve; });
  const mock = mockClient(() => firstQuery);
  setSupabaseDbClientForTests(mock.client);
  const first = ensureSupabaseReadyAndSeeded();
  const second = ensureSupabaseReadyAndSeeded();
  assert.equal(mock.queries, 1);
  release({ data: [{ id: 'shop-1' }], error: null });
  assert.deepEqual(await Promise.all([first, second]), [
    { ready: true, seeded: true },
    { ready: true, seeded: true },
  ]);
  assert.deepEqual(await ensureSupabaseReadyAndSeeded(), { ready: true, seeded: true });
  assert.equal(mock.queries, 1);
});

test('errors and empty shop results are retried', async () => {
  let call = 0;
  const mock = mockClient(() => {
    call++;
    return call === 1
      ? { data: null, error: { code: 'DOWN', message: 'unavailable' } }
      : { data: [], error: null };
  });
  setSupabaseDbClientForTests(mock.client);
  assert.equal((await ensureSupabaseReadyAndSeeded()).ready, false);
  assert.deepEqual(await ensureSupabaseReadyAndSeeded(), { ready: true, seeded: false });
  assert.deepEqual(await ensureSupabaseReadyAndSeeded(), { ready: true, seeded: false });
  assert.equal(mock.queries, 3);
});

test('client swap invalidates cache and old in-flight result cannot populate it', async () => {
  let release!: (value: unknown) => void;
  const oldQuery = new Promise((resolve) => { release = resolve; });
  const oldMock = mockClient(() => oldQuery);
  const newMock = mockClient(() => ({ data: [{ id: 'new-shop' }], error: null }));
  setSupabaseDbClientForTests(oldMock.client);
  const oldResult = ensureSupabaseReadyAndSeeded();
  setSupabaseDbClientForTests(newMock.client);
  assert.deepEqual(await ensureSupabaseReadyAndSeeded(), { ready: true, seeded: true });
  release({ data: [{ id: 'old-shop' }], error: null });
  await oldResult;
  assert.deepEqual(await ensureSupabaseReadyAndSeeded(), { ready: true, seeded: true });
  assert.equal(newMock.queries, 1);
  setSupabaseDbClientForTests(newMock.client);
  await ensureSupabaseReadyAndSeeded();
  assert.equal(newMock.queries, 2);
});
