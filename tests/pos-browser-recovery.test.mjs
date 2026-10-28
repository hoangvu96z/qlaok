import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function createCdpConnection(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let idCounter = 0;
  const pending = new Map();

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.id && pending.has(data.id)) {
        const { resolve, reject } = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) reject(new Error(data.error.message || JSON.stringify(data.error)));
        else resolve(data.result);
      }
    } catch (err) {
      console.error('CDP parse error:', err);
    }
  };

  return {
    async ready() {
      if (ws.readyState === WebSocket.OPEN) return;
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
      });
    },
    send(method, params = {}) {
      const id = ++idCounter;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    async eval(expression) {
      const res = await this.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (res.exceptionDetails) {
        throw new Error(`Eval exception: ${res.exceptionDetails.text || JSON.stringify(res.exceptionDetails)}`);
      }
      return res.result?.value;
    },
    close() {
      try {
        ws.close();
      } catch {}
    },
  };
}

async function buildBrowserBundle(tmpDir) {
  const webpackPkg = await import('next/dist/compiled/webpack/webpack.js');
  webpackPkg.default.init();
  const webpack = webpackPkg.default.webpack;
  const swcPath = require.resolve('next/dist/build/swc');

  const swcLoaderPath = path.join(tmpDir, 'test-swc-loader.cjs');
  fs.writeFileSync(
    swcLoaderPath,
    `
const swc = require(${JSON.stringify(swcPath)});
module.exports = function (source) {
  const isTsx = this.resourcePath.endsWith('.tsx') || this.resourcePath.endsWith('.jsx');
  const isTs = this.resourcePath.endsWith('.ts');
  const result = swc.transformSync(source, {
    jsc: {
      parser: {
        syntax: isTs || isTsx ? 'typescript' : 'ecmascript',
        tsx: isTsx,
      },
      transform: {
        react: { runtime: 'automatic' },
      },
    },
  });
  return result.code;
};
`
  );

  const mockNextLinkPath = path.join(tmpDir, 'mock-next-link.cjs');
  fs.writeFileSync(
    mockNextLinkPath,
    `
const React = require('react');
module.exports = function MockLink(props) {
  return React.createElement('a', { href: props.href, ...props }, props.children);
};
`
  );

  const entryPath = path.join(tmpDir, 'test-harness-entry.tsx');
  fs.writeFileSync(
    entryPath,
    `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PosCounterWorkspace } from '@/components/dashboard/PosCounterWorkspace';
import { AppI18nProvider } from '@/components/ui/AppI18nProvider';
import type { Shop, Category, CatalogItem } from '@/types/qlaok';

const FIXTURE_SHOP_A: Shop = {
  id: 'shop-qa-a',
  slug: 'shop-qa-a',
  name: 'Quán Cà Phê QA',
  vertical: 'fnb',
  currency: 'VND',
  theme_config: {},
  supported_langs: ['vi', 'en'],
};

const FIXTURE_CATEGORIES: Category[] = [
  { id: 'cat-1', shop_id: 'shop-qa-a', name_i18n: { vi: 'Cà phê', en: 'Coffee' }, sort_order: 1 },
];

const FIXTURE_ITEMS: CatalogItem[] = [
  {
    id: 'item-coffee-1',
    shop_id: 'shop-qa-a',
    category_id: 'cat-1',
    name_i18n: { vi: 'Cà phê sữa đá', en: 'Iced Milk Coffee' },
    desc_i18n: { vi: 'Đậm đà truyền thống', en: 'Traditional rich' },
    price: 35000,
    compare_at_price: null,
    unit_i18n: { vi: 'ly', en: 'cup' },
    duration_mins: null,
    image_url: null,
    sort_order: 1,
    is_available: true,
    options_json: [],
  },
];

interface HarnessState {
  accountId: string | null;
  shop: Shop;
  autoPrintOnPay: boolean;
}

function HarnessApp() {
  const [harness, setHarness] = useState<HarnessState>({
    accountId: 'owner-alpha',
    shop: FIXTURE_SHOP_A,
    autoPrintOnPay: true,
  });

  // Expose control to window
  (window as any).__setHarness = setHarness;

  return (
    <AppI18nProvider initialLocale="vi">
      <PosCounterWorkspace
        shop={harness.shop}
        accountId={harness.accountId}
        categories={FIXTURE_CATEGORIES}
        items={FIXTURE_ITEMS}
        tables={[]}
        orders={[]}
        autoPrintOnPay={harness.autoPrintOnPay}
        canApplyDiscount={true}
        onOrderCreated={(order, shouldPrint) => {
          const events = (window as any).__orderEvents || [];
          events.push({ order, shouldPrint, timestamp: Date.now() });
          (window as any).__orderEvents = events;
        }}
      />
    </AppI18nProvider>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<HarnessApp />);
`
  );

  const bundleDestDir = path.join(tmpDir, 'dist');
  fs.mkdirSync(bundleDestDir, { recursive: true });

  await new Promise((resolve, reject) => {
    const compiler = webpack({
      mode: 'development',
      entry: entryPath,
      output: {
        path: bundleDestDir,
        filename: 'bundle.js',
      },
      resolve: {
        modules: [path.resolve('node_modules'), 'node_modules'],
        extensions: ['.ts', '.tsx', '.js', '.jsx'],
        alias: {
          '@': path.resolve('src'),
          'next/link': mockNextLinkPath,
        },
      },
      module: {
        rules: [
          {
            test: /\.(tsx|ts|jsx|js)$/,
            exclude: /node_modules/,
            use: [{ loader: swcLoaderPath }],
          },
        ],
      },
      plugins: [
        new webpack.DefinePlugin({
          'process.env.NODE_ENV': JSON.stringify('development'),
        }),
      ],
    });

    compiler.run((err, stats) => {
      if (err) return reject(err);
      if (stats.hasErrors()) {
        const info = stats.toJson();
        return reject(new Error(JSON.stringify(info.errors)));
      }
      resolve(stats);
    });
  });

  return path.join(bundleDestDir, 'bundle.js');
}

test('POS recovery browser flow: lost response after server commit, reload, idempotent retry, exactly one order, receipt behavior, context isolation', async () => {
  assert.ok(
    fs.existsSync(CHROME_PATH),
    `Google Chrome executable not found at ${CHROME_PATH}`
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qlaok-pos-test-'));
  const bundleFile = await buildBrowserBundle(tmpDir);
  const bundleContent = fs.readFileSync(bundleFile, 'utf8');

  // Set up mock HTTP server
  const serverState = {
    receivedPosts: [],
    committedOrders: new Map(),
    simulateLostResponse: false,
    orderCodeCounter: 100,
  };

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>POS Recovery Test</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="/bundle.js"></script>
  </body>
</html>`);
      return;
    }

    if (req.method === 'GET' && req.url === '/bundle.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      res.end(bundleContent);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/orders') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }

        const idempotencyKey = parsed.idempotency_key;
        serverState.receivedPosts.push({
          rawBody: body,
          parsed,
          idempotencyKey,
          timestamp: Date.now(),
        });

        // Ensure order is committed in the server's database
        if (!serverState.committedOrders.has(idempotencyKey)) {
          const newOrder = {
            id: `ord_${serverState.orderCodeCounter++}`,
            shop_id: parsed.shop_id,
            order_code: `ORD-${serverState.orderCodeCounter}`,
            status: 'new',
            payment_status: parsed.payment_status || 'paid',
            total_amount: 35000,
            items: parsed.items || [],
            source: 'counter_pos',
            created_at: new Date().toISOString(),
          };
          serverState.committedOrders.set(idempotencyKey, newOrder);
        }

        const committedOrder = serverState.committedOrders.get(idempotencyKey);

        if (serverState.simulateLostResponse) {
          // Response is lost after server committed order (simulates gateway timeout / upstream drop)
          serverState.simulateLostResponse = false;
          res.writeHead(504, { 'Content-Type': 'application/json', 'Connection': 'close' });
          res.end(JSON.stringify({ error: 'Gateway Timeout after order commit' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, order: committedOrder }));
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  server.on('clientError', (_err, socket) => {
    socket.destroy();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const serverPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${serverPort}`;

  // Spawn headless Google Chrome
  const chromeProfileDir = path.join(tmpDir, 'chrome-profile');
  fs.mkdirSync(chromeProfileDir, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${chromeProfileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ]);

  let cdp = null;

  try {
    const wsDebuggerUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for Chrome DevTools port'));
      }, 10000);

      chromeProc.stderr.on('data', async (d) => {
        const match = d.toString().match(/DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/[^\s]+)/);
        if (!match) return;
        clearTimeout(timeout);
        const port = match[2];
        try {
          const listRes = await fetch(`http://127.0.0.1:${port}/json/list`);
          const pages = await listRes.json();
          const target = pages.find((p) => p.type === 'page') || pages[0];
          resolve(target.webSocketDebuggerUrl);
        } catch (err) {
          reject(err);
        }
      });

      chromeProc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    cdp = createCdpConnection(wsDebuggerUrl);
    await cdp.ready();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // 1. Navigate to test app
    await cdp.send('Page.navigate', { url: baseUrl });

    // Wait until root has rendered and recovery check finished
    const waitForApp = async (timeoutMs = 8000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const ready = await cdp.eval(`Boolean(
          window.__setHarness &&
          document.querySelector('#root') &&
          !document.querySelector('[role="status"]')
        )`);
        if (ready) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('Timeout waiting for HarnessApp to mount');
    };
    await waitForApp();

    const readIdbPendingRaw = async (storageKey) => {
      return await cdp.eval(`new Promise((resolve, reject) => {
        const req = window.indexedDB.open('qlaok_pos_recovery_v1', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('pending_orders')) db.createObjectStore('pending_orders');
        };
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('pending_orders', 'readonly');
          const getReq = tx.objectStore('pending_orders').get(${JSON.stringify(storageKey)});
          getReq.onsuccess = () => {
            const val = getReq.result ?? null;
            db.close();
            resolve(val);
          };
          getReq.onerror = () => {
            db.close();
            reject(getReq.error);
          };
        };
      })`);
    };

    // Verify Context Isolation on unauthenticated / missing account
    await cdp.eval(`window.__setHarness(prev => ({ ...prev, accountId: null }))`);
    await new Promise((r) => setTimeout(r, 200));
    const alertUnauthenticated = await cdp.eval(`document.querySelector('[role="alert"]')?.textContent || ''`);
    assert.match(
      alertUnauthenticated,
      /Không thể kiểm tra đơn chờ an toàn|Cannot safely check pending orders/,
      'Must display unavailable alert when accountId is missing'
    );

    // Restore authenticated context: accountId = 'owner-alpha', shopId = 'shop-qa-a'
    await cdp.eval(`window.__setHarness(prev => ({ ...prev, accountId: 'owner-alpha' }))`);
    await new Promise((r) => setTimeout(r, 200));

    // Verify no pending order banner exists initially
    const initialPendingBanner = await cdp.eval(`document.querySelector('[data-testid="pos-pending-order"]')`);
    assert.equal(initialPendingBanner, null, 'Initial state must not have pending orders');

    // Helper to add item to ticket and click pay
    const selectItemAndPay = async () => {
      // 1. Click product card
      await cdp.eval(`(() => {
        const card = Array.from(document.querySelectorAll('div')).find(el =>
          el.className && typeof el.className === 'string' && el.className.includes('cursor-pointer') && el.textContent.includes('Cà phê sữa đá')
        );
        if (card) card.click();
      })()`);

      // 2. Wait until pay button is present and not disabled
      const start = Date.now();
      while (Date.now() - start < 4000) {
        const ready = await cdp.eval(`(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b =>
            b.className && typeof b.className === 'string' && b.className.includes('col-span-4')
          );
          return Boolean(btn && !btn.disabled);
        })()`);
        if (ready) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      // 3. Click pay button
      const clicked = await cdp.eval(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b =>
          b.className && typeof b.className === 'string' && b.className.includes('col-span-4')
        );
        if (btn && !btn.disabled) {
          btn.click();
          return true;
        }
        return false;
      })()`);
      assert.equal(clicked, true, 'Pay button should be clicked');
    };

    // 2. Select item to add to ticket
    serverState.simulateLostResponse = true;
    await selectItemAndPay();

    // Wait for the request to reach server and connection to be dropped
    const waitForLostResponse = async (timeoutMs = 5000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (serverState.receivedPosts.length === 1 && serverState.committedOrders.size === 1) {
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('Server did not record committed order and lost response');
    };
    await waitForLostResponse();

    assert.equal(serverState.receivedPosts.length, 1, 'Server must have received exactly 1 POST attempt');
    assert.equal(serverState.committedOrders.size, 1, 'Server must have committed exactly 1 order');
    const firstAttempt = serverState.receivedPosts[0];
    assert.ok(firstAttempt.idempotencyKey.startsWith('pos-web:'), 'Idempotency key must have pos-web: prefix');

    // Verify browser IndexedDB saved the pending order and localStorage is NOT used
    const pendingStorageKey = `qlaok_pos_pending_v1:owner-alpha:shop-qa-a`;
    const storedPendingRaw = await readIdbPendingRaw(pendingStorageKey);
    assert.ok(storedPendingRaw, 'Browser IndexedDB must retain pending order during lost response');
    assert.equal(
      await cdp.eval(`window.localStorage.getItem(${JSON.stringify(pendingStorageKey)})`),
      null,
      'localStorage must not be used as authoritative pending store'
    );
    const storedPending = JSON.parse(storedPendingRaw);
    assert.equal(storedPending.key, firstAttempt.idempotencyKey);
    assert.equal(storedPending.accountId, 'owner-alpha');
    assert.equal(storedPending.shopId, 'shop-qa-a');
    assert.equal(storedPending.body, firstAttempt.rawBody);

    // 3. Reload the browser page
    await cdp.send('Page.reload');
    await waitForApp();

    // Verify: No automatic resubmit on page reload
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(
      serverState.receivedPosts.length,
      1,
      'Page reload must NOT automatically resubmit or send another request to server'
    );

    // Verify: UI displays pending order alert with retry button
    const waitBannerText = async (timeoutMs = 5000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const text = await cdp.eval(`document.querySelector('[data-testid="pos-pending-order"]')?.textContent || ''`);
        if (text) return text;
        await new Promise((r) => setTimeout(r, 50));
      }
      return '';
    };
    const pendingBannerText = await waitBannerText();
    assert.match(
      pendingBannerText,
      /Đơn trước chưa được xác nhận|Previous order not confirmed/,
      'Must display pending order alert after reload'
    );
    assert.match(
      pendingBannerText,
      /Thử lại đơn chờ|Retry pending order/,
      'Must display retry pending order button'
    );

    // 4. Verify context isolation with pending order
    // Switch to another account: owner-beta
    await cdp.eval(`window.__setHarness(prev => ({ ...prev, accountId: 'owner-beta' }))`);
    await waitForApp();
    const ownerBetaPendingBanner = await cdp.eval(
      `document.querySelector('[data-testid="pos-pending-order"]')`
    );
    assert.equal(
      ownerBetaPendingBanner,
      null,
      'Another account context must NOT see the pending order from owner-alpha'
    );

    // Switch back to owner-alpha
    await cdp.eval(`window.__setHarness(prev => ({ ...prev, accountId: 'owner-alpha' }))`);
    await waitForApp();
    assert.match(
      await waitBannerText(),
      /Đơn trước chưa được xác nhận|Previous order not confirmed/,
      'Pending order banner must reappear when switching back to owner-alpha'
    );

    // 5. Explicit retry
    const retryClicked = await cdp.eval(`(() => {
      const retryBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent && (b.textContent.includes('Thử lại đơn chờ') || b.textContent.includes('Retry pending order'))
      );
      if (!retryBtn) return false;
      retryBtn.click();
      return true;
    })()`);
    assert.equal(retryClicked, true, 'Retry button should be clicked');

    // Wait for the retry POST to complete on server
    const waitForRetry = async (timeoutMs = 5000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (serverState.receivedPosts.length === 2) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('Server did not receive the retry attempt');
    };
    await waitForRetry();

    // 6. Verify explicit retry uses IDENTICAL key and body
    const secondAttempt = serverState.receivedPosts[1];
    assert.equal(
      secondAttempt.idempotencyKey,
      firstAttempt.idempotencyKey,
      'Retry attempt must use identical idempotency key'
    );
    assert.equal(
      secondAttempt.rawBody,
      firstAttempt.rawBody,
      'Retry attempt must use byte-for-byte identical request body'
    );

    // 7. Verify exactly ONE order in database
    assert.equal(
      serverState.committedOrders.size,
      1,
      'Exactly ONE order must exist on server across original commit and retry'
    );

    // 8. Verify receipt behavior and cleanup
    // Wait for client to process confirmed order
    const waitForConfirmation = async (timeoutMs = 5000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const events = await cdp.eval(`window.__orderEvents || []`);
        if (events.length > 0) return events;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('Browser did not trigger onOrderCreated callback');
    };
    const events = await waitForConfirmation();

    assert.equal(events.length, 1, 'onOrderCreated must be called exactly once');
    assert.equal(events[0].order.id, serverState.committedOrders.get(firstAttempt.idempotencyKey).id);
    assert.equal(
      events[0].shouldPrint,
      true,
      'Receipt should print according to autoPrintOnPay setting'
    );

    // Verify IndexedDB pending order is cleaned up
    const clearedStorage = await readIdbPendingRaw(pendingStorageKey);
    assert.equal(clearedStorage, null, 'Pending order in IndexedDB must be cleared after confirmed retry');

    // Verify pending alert is dismissed
    const finalPendingBanner = await cdp.eval(
      `document.querySelector('[data-testid="pos-pending-order"]')`
    );
    assert.equal(finalPendingBanner, null, 'Pending order banner must be dismissed');

    // =========================================================================
    // FLOW B: Verify receipt behavior when autoPrintOnPay is false
    // =========================================================================
    await cdp.eval(`(() => {
      window.__setHarness(prev => ({ ...prev, autoPrintOnPay: false }));
      window.__orderEvents = [];
    })()`);
    await new Promise((r) => setTimeout(r, 200));

    serverState.simulateLostResponse = true;
    const postCountBeforeB = serverState.receivedPosts.length; // was 2
    await selectItemAndPay();

    // Wait for lost response
    const deadlineB = Date.now() + 5000;
    while (serverState.receivedPosts.length === postCountBeforeB && Date.now() < deadlineB) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(serverState.receivedPosts.length, 3, 'Flow B must record attempt 3');
    const bAttempt1 = serverState.receivedPosts[2];

    // Reload page
    await cdp.send('Page.reload');
    await waitForApp();
    await cdp.eval(`(() => {
      window.__setHarness(prev => ({ ...prev, autoPrintOnPay: false }));
      window.__orderEvents = [];
    })()`);

    // Verify pending alert
    const bBannerText = await waitBannerText();
    assert.match(bBannerText, /Đơn trước chưa được xác nhận|Previous order not confirmed/);

    // Click retry
    await cdp.eval(`(() => {
      const retryBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent && (b.textContent.includes('Thử lại đơn chờ') || b.textContent.includes('Retry pending order'))
      );
      if (retryBtn) retryBtn.click();
    })()`);

    const deadlineRetryB = Date.now() + 5000;
    while (serverState.receivedPosts.length === 3 && Date.now() < deadlineRetryB) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(serverState.receivedPosts.length, 4, 'Flow B retry must record attempt 4');
    const bAttempt2 = serverState.receivedPosts[3];

    assert.equal(bAttempt2.idempotencyKey, bAttempt1.idempotencyKey, 'Flow B retry must match key');
    assert.equal(bAttempt2.rawBody, bAttempt1.rawBody, 'Flow B retry must match body');

    // Wait for event and verify shouldPrint is FALSE
    const bEvents = await (async () => {
      const start = Date.now();
      while (Date.now() - start < 5000) {
        const ev = await cdp.eval(`window.__orderEvents || []`);
        if (ev.length > 0) return ev;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('Timeout waiting for Flow B onOrderCreated');
    })();

    assert.equal(bEvents.length, 1);
    assert.equal(
      bEvents[0].shouldPrint,
      false,
      'Receipt should NOT print when autoPrintOnPay is false'
    );
    assert.equal(serverState.committedOrders.size, 2, 'Total orders committed must be exactly 2');

    // =========================================================================
    // FLOW C: Discard pending order without resubmitting
    // =========================================================================
    await cdp.eval(`(() => {
      window.__setHarness(prev => ({ ...prev, autoPrintOnPay: true }));
      window.__orderEvents = [];
      window.confirm = () => true;
    })()`);
    await new Promise((r) => setTimeout(r, 200));

    serverState.simulateLostResponse = true;
    const postCountBeforeC = serverState.receivedPosts.length; // was 4
    await selectItemAndPay();

    const deadlineC = Date.now() + 5000;
    while (serverState.receivedPosts.length === postCountBeforeC && Date.now() < deadlineC) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(serverState.receivedPosts.length, 5, 'Flow C must record attempt 5');
    await waitBannerText();

    // Click discard button
    const discardClicked = await cdp.eval(`(() => {
      const discardBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.textContent && (b.textContent.includes('bỏ yêu cầu chờ') || b.textContent.includes('discard pending request'))
      );
      if (!discardBtn) return false;
      discardBtn.click();
      return true;
    })()`);
    assert.equal(discardClicked, true, 'Discard button should be clicked');
    const clearDeadlineC = Date.now() + 5000;
    while (Date.now() < clearDeadlineC && await cdp.eval(`!!document.querySelector('[data-testid="pos-pending-order"]')`)) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // Verify IndexedDB cleared and banner gone, and NO retry network request made
    const cStorage = await readIdbPendingRaw(pendingStorageKey);
    assert.equal(cStorage, null, 'Discarding pending order must clear IndexedDB');
    const cBanner = await cdp.eval(`document.querySelector('[data-testid="pos-pending-order"]')`);
    assert.equal(cBanner, null, 'Pending banner must be dismissed after discard');
    assert.equal(
      serverState.receivedPosts.length,
      5,
      'Discarding pending order must NOT send any further network requests'
    );

    // Some browser environments throw while accessing IndexedDB itself.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new Error('storage denied'); } });`,
    });
    await cdp.send('Page.reload');
    const unavailableDeadline = Date.now() + 5000;
    let unavailableText = '';
    while (Date.now() < unavailableDeadline) {
      unavailableText = await cdp.eval(`document.querySelector('[role="alert"]')?.textContent || ''`);
      if (unavailableText) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.match(unavailableText, /Không thể kiểm tra đơn chờ an toàn|Cannot safely check pending orders/);
    assert.equal(serverState.receivedPosts.length, 5, 'unavailable IndexedDB must not submit an order');
  } finally {
    if (cdp) cdp.close();
    chromeProc.kill('SIGKILL');
    await new Promise((r) => server.close(r));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 });
    } catch {}
  }
});
