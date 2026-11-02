import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DELETE as deletePost,
  GET as getPosts,
  POST as savePost,
} from '@/app/api/posts/route';
import {
  dbGetShopPosts,
  dbDeletePost,
  dbUpsertPost,
  setSupabaseDbClientForTests,
} from '@/lib/db';
import { SUPER_ADMIN_EMAIL } from '@/lib/auth-session';
import { issueSessionToken } from '@/lib/server-auth';
import type { Post } from '@/types/qlaok';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

interface MockQueryLog {
  table: string;
  filters: Array<{ column: string; value: unknown }>;
  orders: Array<{ column: string; ascending?: boolean }>;
  limitCount: number | null;
  operation: 'select' | 'insert' | 'update' | 'delete';
  payload?: Record<string, unknown>;
}

function createPostDbMock(
  initialPosts: Post[],
  options: {
    forceInsertConflict?: boolean;
    forceDeleteError?: boolean;
    forceDeleteNoRows?: boolean;
  } = {}
) {
  const queryLogs: MockQueryLog[] = [];
  const posts = initialPosts.map(cloneJson);

  class MockQueryBuilder {
    private table: string;
    private filters: Array<{ column: string; value: unknown }> = [];
    private orders: Array<{ column: string; ascending?: boolean }> = [];
    private limitCount: number | null = null;
    private singleMode: 'none' | 'single' | 'maybeSingle' = 'none';
    private operation: 'select' | 'insert' | 'update' | 'delete' = 'select';
    private mutationPayload: Record<string, unknown> | null = null;

    constructor(table: string) {
      this.table = table;
    }

    select(_cols = '*') {
      return this;
    }

    insert(payload: Record<string, unknown>) {
      this.operation = 'insert';
      this.mutationPayload = cloneJson(payload);
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.operation = 'update';
      this.mutationPayload = cloneJson(payload);
      return this;
    }

    delete() {
      this.operation = 'delete';
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.push({ column, value });
      return this;
    }

    order(column: string, opts?: { ascending?: boolean }) {
      this.orders.push({ column, ascending: opts?.ascending });
      return this;
    }

    limit(count: number) {
      this.limitCount = count;
      return this;
    }

    single() {
      this.singleMode = 'single';
      return this.execute();
    }

    maybeSingle() {
      this.singleMode = 'maybeSingle';
      return this.execute();
    }

    private execute(): Promise<{
      data: unknown;
      error: { code: string; message: string } | null;
    }> {
      queryLogs.push({
        table: this.table,
        filters: [...this.filters],
        orders: [...this.orders],
        limitCount: this.limitCount,
        operation: this.operation,
        ...(this.mutationPayload ? { payload: cloneJson(this.mutationPayload) } : {}),
      });

      if (this.table === 'shops') {
        const demoShop = { id: 'fallback-shop-first' };
        if (this.singleMode !== 'none') {
          return Promise.resolve({ data: demoShop, error: null });
        }
        return Promise.resolve({ data: [demoShop], error: null });
      }

      if (this.table === 'posts') {
        if (this.operation === 'insert') {
          const incoming = this.mutationPayload as unknown as Post;
          const hasDuplicateId =
            options.forceInsertConflict || posts.some((p) => p.id === incoming.id);
          if (hasDuplicateId) {
            return Promise.resolve({
              data: null,
              error: { code: '23505', message: 'duplicate key value' },
            });
          }
          const inserted = cloneJson(incoming);
          posts.push(inserted);
          return Promise.resolve({ data: inserted, error: null });
        }

        let matched = posts.filter((p) => {
          return this.filters.every((f) => {
            return (p as unknown as Record<string, unknown>)[f.column] === f.value;
          });
        });

        if (this.operation === 'update') {
          for (const post of matched) {
            Object.assign(post, cloneJson(this.mutationPayload || {}));
          }
          if (this.singleMode !== 'none') {
            return Promise.resolve({ data: matched[0] ?? null, error: null });
          }
          return Promise.resolve({ data: matched, error: null });
        }

        if (this.operation === 'delete') {
          if (options.forceDeleteError) {
            return Promise.resolve({
              data: null,
              error: { code: 'XX000', message: 'Simulated delete failure' },
            });
          }
          if (options.forceDeleteNoRows) {
            return Promise.resolve({ data: [], error: null });
          }
          const deletedIds = new Set(matched.map((post) => post.id));
          for (let index = posts.length - 1; index >= 0; index -= 1) {
            if (deletedIds.has(posts[index].id)) posts.splice(index, 1);
          }
          return Promise.resolve({
            data: matched.map((post) => ({ id: post.id })),
            error: null,
          });
        }

        matched = [...matched].sort((a, b) => {
          for (const ord of this.orders) {
            const rowA = a as unknown as Record<string, string | number | boolean | undefined>;
            const rowB = b as unknown as Record<string, string | number | boolean | undefined>;
            const valA = rowA[ord.column];
            const valB = rowB[ord.column];
            if (valA === valB) continue;
            if (valA === undefined) return 1;
            if (valB === undefined) return -1;
            const asc = ord.ascending ?? true;
            if (asc) {
              return valA > valB ? 1 : -1;
            }
            return valA < valB ? 1 : -1;
          }
          return 0;
        });

        if (typeof this.limitCount === 'number') {
          matched = matched.slice(0, this.limitCount);
        }

        if (this.singleMode !== 'none') {
          return Promise.resolve({ data: matched[0] ?? null, error: null });
        }
        return Promise.resolve({ data: matched, error: null });
      }

      return Promise.resolve({ data: [], error: null });
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?:
        | ((value: {
            data: unknown;
            error: { code: string; message: string } | null;
          }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null
    ): Promise<TResult1 | TResult2> {
      return this.execute().then(onfulfilled, onrejected);
    }
  }

  const client = {
    from(table: string) {
      return new MockQueryBuilder(table);
    },
  };

  return {
    client,
    queryLogs,
  };
}

const FIXTURE_POSTS: Post[] = [
  {
    id: 'post-1-active-pinned',
    shop_id: 'shop-alpha',
    title_i18n: { vi: 'Bài ghim đang chạy' },
    content_i18n: { vi: 'Nội dung bài ghim' },
    is_pinned: true,
    is_active: true,
    created_at: '2026-03-01T10:00:00.000Z',
  },
  {
    id: 'post-2-inactive-pinned',
    shop_id: 'shop-alpha',
    title_i18n: { vi: 'Bài ghim đã ẩn' },
    content_i18n: { vi: 'Nội dung bài ẩn' },
    is_pinned: true,
    is_active: false,
    created_at: '2026-03-02T10:00:00.000Z',
  },
  {
    id: 'post-3-active-recent',
    shop_id: 'shop-alpha',
    title_i18n: { vi: 'Bài viết mới nhất' },
    content_i18n: { vi: 'Nội dung mới' },
    is_pinned: false,
    is_active: true,
    created_at: '2026-03-03T10:00:00.000Z',
  },
  {
    id: 'post-4-active-old',
    shop_id: 'shop-alpha',
    title_i18n: { vi: 'Bài viết cũ hơn' },
    content_i18n: { vi: 'Nội dung cũ' },
    is_pinned: false,
    is_active: true,
    created_at: '2026-03-01T08:00:00.000Z',
  },
  {
    id: 'post-5-other-shop-active',
    shop_id: 'shop-beta',
    title_i18n: { vi: 'Bài của quán Beta' },
    content_i18n: { vi: 'Quán khác' },
    is_pinned: true,
    is_active: true,
    created_at: '2026-03-04T10:00:00.000Z',
  },
];

test('dbGetShopPosts returns empty array without querying database when shopId is empty or whitespace', async () => {
  const { client, queryLogs } = createPostDbMock(FIXTURE_POSTS);
  setSupabaseDbClientForTests(client as never);

  try {
    const emptyResult = await dbGetShopPosts('');
    assert.deepEqual(emptyResult, []);
    assert.equal(queryLogs.length, 0, 'Must not query any table when shopId is empty');

    const whitespaceResult = await dbGetShopPosts('   ');
    assert.deepEqual(whitespaceResult, []);
    assert.equal(queryLogs.length, 0, 'Must not query any table when shopId is whitespace');
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('dbUpsertPost never reparents an existing post to another shop', async () => {
  const { client, queryLogs } = createPostDbMock(FIXTURE_POSTS);
  setSupabaseDbClientForTests(client as never);

  try {
    const result = await dbUpsertPost({
      id: 'post-5-other-shop-active',
      shop_id: 'shop-alpha',
      title_i18n: { vi: 'Attempted overwrite' },
      content_i18n: { vi: 'Attempted cross-shop change' },
    });

    assert.equal(result, null);
    assert.equal(
      queryLogs.some((query) => query.operation === 'insert' || query.operation === 'update'),
      false,
      'A post owned by another shop must not be mutated'
    );

    const shopBetaPosts = await dbGetShopPosts('shop-beta');
    assert.equal(shopBetaPosts[0]?.id, 'post-5-other-shop-active');
    assert.equal(shopBetaPosts[0]?.title_i18n.vi, 'Bài của quán Beta');
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('dbUpsertPost updates an existing post only with matching id and shop_id filters', async () => {
  const { client, queryLogs } = createPostDbMock(FIXTURE_POSTS);
  setSupabaseDbClientForTests(client as never);

  try {
    const result = await dbUpsertPost({
      id: 'post-1-active-pinned',
      shop_id: 'shop-alpha',
      title_i18n: { vi: 'Updated title' },
      content_i18n: { vi: 'Updated content' },
    });

    assert.equal(result?.id, 'post-1-active-pinned');
    assert.equal(result?.shop_id, 'shop-alpha');
    assert.deepEqual(
      queryLogs.find((query) => query.operation === 'update')?.filters,
      [
        { column: 'id', value: 'post-1-active-pinned' },
        { column: 'shop_id', value: 'shop-alpha' },
      ]
    );
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('dbUpsertPost creates posts with server IDs and does not overwrite on a primary-key race', async () => {
  const createdMock = createPostDbMock([]);
  setSupabaseDbClientForTests(createdMock.client as never);

  try {
    const created = await dbUpsertPost({
      shop_id: 'shop-alpha',
      title_i18n: { vi: 'New post' },
      content_i18n: { vi: 'New content' },
    });
    assert.match(created?.id || '', /^post-/);
    assert.equal(
      createdMock.queryLogs.some((query) => query.operation === 'insert'),
      true
    );
  } finally {
    setSupabaseDbClientForTests(null);
  }

  const conflictMock = createPostDbMock([], { forceInsertConflict: true });
  setSupabaseDbClientForTests(conflictMock.client as never);

  try {
    const conflicted = await dbUpsertPost({
      shop_id: 'shop-alpha',
      title_i18n: { vi: 'Must not replace a concurrent row' },
    });
    assert.equal(conflicted, null);
    assert.equal(
      conflictMock.queryLogs.some((query) => query.operation === 'update'),
      false
    );
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('POST /api/posts maps cross-shop ID conflicts to a generic 404', async () => {
  const { client, queryLogs } = createPostDbMock(FIXTURE_POSTS);
  setSupabaseDbClientForTests(client as never);
  const adminToken = issueSessionToken({
    id: 'posts-review-admin',
    email: SUPER_ADMIN_EMAIL,
    role: 'admin',
  });

  try {
    const response = await savePost(
      new Request('http://localhost/api/posts', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id: 'post-5-other-shop-active',
          shop_id: 'shop-alpha',
          title_i18n: { vi: 'Attempted overwrite' },
          content_i18n: { vi: 'Attempted cross-shop change' },
        }),
      })
    );

    const missingIdResponse = await savePost(
      new Request('http://localhost/api/posts', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          id: 'post-id-does-not-exist',
          shop_id: 'shop-alpha',
          title_i18n: { vi: 'Missing ID probe' },
          content_i18n: { vi: 'Must not create an explicitly identified post' },
        }),
      })
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Post not found' });
    assert.equal(missingIdResponse.status, 404);
    assert.deepEqual(await missingIdResponse.json(), { error: 'Post not found' });
    assert.equal(
      queryLogs.some((query) => query.operation === 'insert' || query.operation === 'update'),
      false
    );
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('dbGetShopPosts queries posts scoped to shop_id and is_active: true with ordering, never falling back to first shop', async () => {
  const { client, queryLogs } = createPostDbMock(FIXTURE_POSTS);
  setSupabaseDbClientForTests(client as never);

  try {
    const results = await dbGetShopPosts('shop-alpha');

    // Verify results: only active posts belonging to shop-alpha, pinned first, then created_at desc
    assert.equal(results.length, 3);
    assert.deepEqual(
      results.map((p) => p.id),
      ['post-1-active-pinned', 'post-3-active-recent', 'post-4-active-old']
    );

    // Verify every post has is_active === true and shop_id === 'shop-alpha'
    for (const post of results) {
      assert.equal(post.shop_id, 'shop-alpha');
      assert.equal(post.is_active, true);
    }

    // Check query logs for the posts query
    const postsQuery = queryLogs.find((q) => q.table === 'posts');
    assert.ok(postsQuery, 'Must have executed a posts query');
    assert.deepEqual(
      postsQuery.filters,
      [
        { column: 'shop_id', value: 'shop-alpha' },
        { column: 'is_active', value: true },
      ],
      'Query must explicitly filter shop_id and is_active: true'
    );
    assert.deepEqual(postsQuery.orders, [
      { column: 'is_pinned', ascending: false },
      { column: 'created_at', ascending: false },
    ]);

    // Verify there was NO fallback query against shops table looking for first shop
    const shopQueries = queryLogs.filter((q) => q.table === 'shops');
    // Note: ensureSupabaseReadyAndSeeded runs select('id').limit(1), but no fallback shop selection
    for (const sq of shopQueries) {
      assert.notEqual(
        sq.filters.some((f) => f.column === 'id'),
        true,
        'No query for first shop id fallback'
      );
    }
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('GET /api/posts returns 400 SHOP_ID_REQUIRED on missing or whitespace shopId', async () => {
  const { client, queryLogs } = createPostDbMock(FIXTURE_POSTS);
  setSupabaseDbClientForTests(client as never);

  try {
    // Missing query parameter
    const resNoParam = await getPosts(new Request('http://localhost/api/posts'));
    assert.equal(resNoParam.status, 400);
    const bodyNoParam = await resNoParam.json();
    assert.deepEqual(bodyNoParam, { error: 'Missing shopId', code: 'SHOP_ID_REQUIRED' });

    // Empty query parameter
    const resEmptyParam = await getPosts(new Request('http://localhost/api/posts?shopId='));
    assert.equal(resEmptyParam.status, 400);
    const bodyEmptyParam = await resEmptyParam.json();
    assert.deepEqual(bodyEmptyParam, { error: 'Missing shopId', code: 'SHOP_ID_REQUIRED' });

    // Whitespace query parameter
    const resWhitespaceParam = await getPosts(new Request('http://localhost/api/posts?shopId=%20%20'));
    assert.equal(resWhitespaceParam.status, 400);
    const bodyWhitespaceParam = await resWhitespaceParam.json();
    assert.deepEqual(bodyWhitespaceParam, { error: 'Missing shopId', code: 'SHOP_ID_REQUIRED' });

    // No DB queries should have been made
    assert.equal(queryLogs.length, 0);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('GET /api/posts returns 200 with only active posts for valid shopId', async () => {
  const { client } = createPostDbMock(FIXTURE_POSTS);
  setSupabaseDbClientForTests(client as never);

  try {
    const res = await getPosts(new Request('http://localhost/api/posts?shopId=shop-alpha'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.posts));
    assert.equal(body.posts.length, 3);
    assert.deepEqual(
      body.posts.map((p: Post) => p.id),
      ['post-1-active-pinned', 'post-3-active-recent', 'post-4-active-old']
    );
    for (const post of body.posts) {
      assert.equal(post.shop_id, 'shop-alpha');
      assert.equal(post.is_active, true);
    }
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('DELETE /api/posts authenticates before looking up post IDs', async () => {
  const { client, queryLogs } = createPostDbMock(FIXTURE_POSTS);
  setSupabaseDbClientForTests(client as never);

  try {
    const existingPost = await deletePost(
      new Request('http://localhost/api/posts?postId=post-2-inactive-pinned')
    );
    const missingPost = await deletePost(
      new Request('http://localhost/api/posts?postId=post-does-not-exist')
    );

    assert.equal(existingPost.status, 401);
    assert.equal(missingPost.status, 401);
    assert.equal(
      queryLogs.length,
      0,
      'Unauthenticated post ID checks must not query the database'
    );
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('dbDeletePost reports only confirmed successful deletes', async () => {
  const errorDb = createPostDbMock(FIXTURE_POSTS, { forceDeleteError: true });
  setSupabaseDbClientForTests(errorDb.client as never);
  try {
    assert.equal(await dbDeletePost('post-1-active-pinned'), false);
  } finally {
    setSupabaseDbClientForTests(null);
  }

  const emptyDb = createPostDbMock(FIXTURE_POSTS, { forceDeleteNoRows: true });
  setSupabaseDbClientForTests(emptyDb.client as never);
  try {
    assert.equal(await dbDeletePost('post-1-active-pinned'), false);
  } finally {
    setSupabaseDbClientForTests(null);
  }

  const successDb = createPostDbMock(FIXTURE_POSTS);
  setSupabaseDbClientForTests(successDb.client as never);
  try {
    assert.equal(await dbDeletePost('post-1-active-pinned'), true);
  } finally {
    setSupabaseDbClientForTests(null);
  }
});

test('DELETE /api/posts returns non-2xx when the database delete fails', async () => {
  const { client } = createPostDbMock(FIXTURE_POSTS, { forceDeleteError: true });
  setSupabaseDbClientForTests(client as never);

  try {
    const adminToken = issueSessionToken({
      id: 'admin-post-delete-review',
      email: SUPER_ADMIN_EMAIL,
      role: 'admin',
      is_admin: true,
    });
    const response = await deletePost(
      new Request('http://localhost/api/posts?postId=post-1-active-pinned', {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
    );
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.deleted, false);
    assert.equal(body.code, 'POST_DELETE_FAILED');
  } finally {
    setSupabaseDbClientForTests(null);
  }
});
