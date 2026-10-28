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
  { id: 'cat-1', shop_id: 'shop-qa-a', name_i18n: { vi: 'Đồ uống', en: 'Drinks' }, sort_order: 1 },
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
  {
    id: 'item-tea-2',
    shop_id: 'shop-qa-a',
    category_id: 'cat-1',
    name_i18n: { vi: 'Trà đào cam sả', en: 'Peach Lemongrass Tea' },
    desc_i18n: { vi: 'Thơm mát', en: 'Fresh' },
    price: 45000,
    compare_at_price: null,
    unit_i18n: { vi: 'ly', en: 'cup' },
    duration_mins: null,
    image_url: null,
    sort_order: 2,
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

test('Two-browser-tab POS race: distinct sales in concurrent tabs under same account/shop', async () => {
  assert.ok(
    fs.existsSync(CHROME_PATH),
    `Google Chrome executable not found at ${CHROME_PATH}`
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qlaok-two-tab-test-'));
  const bundleFile = await buildBrowserBundle(tmpDir);
  const bundleContent = fs.readFileSync(bundleFile, 'utf8');

  // Track server interactions
  const serverState = {
    receivedPosts: [],
    committedOrders: new Map(),
    holdPostA: null, // resolver for delayed response to Tab 1
    holdPostAResolver: null,
    simulateLostResponseOnce: false,
    holdConcurrentRetriesCount: 0,
    heldRetryResolvers: [],
    orderCodeCounter: 500,
  };

  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>POS Recovery Two-Tab Race Test</title>
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
      req.on('end', async () => {
        const parsed = JSON.parse(body);
        const idempotencyKey = parsed.idempotency_key;

        const record = {
          rawBody: body,
          parsed,
          idempotencyKey,
          timestamp: Date.now(),
        };
        serverState.receivedPosts.push(record);

        if (!serverState.committedOrders.has(idempotencyKey)) {
          const newOrder = {
            id: `ord_${serverState.orderCodeCounter++}`,
            shop_id: parsed.shop_id,
            order_code: `ORD-${serverState.orderCodeCounter}`,
            status: 'new',
            payment_status: parsed.payment_status || 'paid',
            total_amount: parsed.items?.reduce((s, it) => s + (it.unit_price || 0) * (it.quantity || 1), 0) || 35000,
            items: parsed.items || [],
            source: 'counter_pos',
            created_at: new Date().toISOString(),
          };
          serverState.committedOrders.set(idempotencyKey, newOrder);
        }

        const committedOrder = serverState.committedOrders.get(idempotencyKey);

        if (serverState.simulateLostResponseOnce) {
          serverState.simulateLostResponseOnce = false;
          res.writeHead(504, { 'Content-Type': 'application/json', Connection: 'close' });
          res.end(JSON.stringify({ error: 'Gateway Timeout after order commit' }));
          return;
        }

        if (serverState.holdConcurrentRetriesCount > 0) {
          await new Promise((resolve) => {
            serverState.heldRetryResolvers.push(resolve);
            if (serverState.heldRetryResolvers.length >= serverState.holdConcurrentRetriesCount) {
              const resolvers = serverState.heldRetryResolvers.splice(0);
              serverState.holdConcurrentRetriesCount = 0;
              for (const r of resolvers) r();
            }
          });
        }

        // If this is Tab 1's request (first one), hold it in flight
        if (serverState.holdPostA === true) {
          await new Promise((resolve) => {
            serverState.holdPostAResolver = resolve;
          });
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

  let cdp1 = null;
  let cdp2 = null;

  try {
    const { port: chromePort, wsUrl: ws1 } = await new Promise((resolve, reject) => {
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
          resolve({ port, wsUrl: target.webSocketDebuggerUrl });
        } catch (err) {
          reject(err);
        }
      });

      chromeProc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    cdp1 = createCdpConnection(ws1);
    await cdp1.ready();
    await cdp1.send('Page.enable');
    await cdp1.send('Runtime.enable');

    // Tab 1 navigate to app
    await cdp1.send('Page.navigate', { url: baseUrl });

    // Open Tab 2 in the same browser profile / same origin
    const newTarget = await cdp1.send('Target.createTarget', { url: baseUrl });
    const tab2TargetId = newTarget.targetId;

    // Get Tab 2 WebSocket URL
    const listRes = await fetch(`http://127.0.0.1:${chromePort}/json/list`);
    const pages = await listRes.json();
    const tab2Target = pages.find((p) => p.id === tab2TargetId);
    assert.ok(tab2Target, 'Target for Tab 2 must exist');

    cdp2 = createCdpConnection(tab2Target.webSocketDebuggerUrl);
    await cdp2.ready();
    await cdp2.send('Page.enable');
    await cdp2.send('Runtime.enable');

    // Wait for both tabs to mount and finish initial IndexedDB recovery check
    const waitForApp = async (cdp, name) => {
      const start = Date.now();
      while (Date.now() - start < 8000) {
        const ready = await cdp.eval(`Boolean(
          window.__setHarness &&
          document.querySelector('#root') &&
          !document.querySelector('[role="status"]')
        )`);
        if (ready) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`Timeout waiting for ${name} to mount`);
    };

    await waitForApp(cdp1, 'Tab 1');
    await waitForApp(cdp2, 'Tab 2');

    const readIdbPendingRaw = async (cdp, storageKey) => {
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

    // Helper to select item in a tab and wait until Pay button is enabled
    const selectItem = async (cdp, itemName) => {
      await cdp.eval(`(() => {
        const card = Array.from(document.querySelectorAll('div')).find(el =>
          el.className && typeof el.className === 'string' && el.className.includes('cursor-pointer') && el.textContent.includes(${JSON.stringify(itemName)})
        );
        if (card) card.click();
      })()`);
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        const ready = await cdp.eval(`(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b =>
            b.className && typeof b.className === 'string' && b.className.includes('col-span-4')
          );
          return Boolean(btn && !btn.disabled);
        })()`);
        if (ready) return;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw new Error(`Pay button did not enable after selecting ${itemName}`);
    };

    const clickPayButton = async (cdp) => {
      return await cdp.eval(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b =>
          b.className && typeof b.className === 'string' && b.className.includes('col-span-4')
        );
        if (btn && !btn.disabled) {
          btn.click();
          return true;
        }
        return false;
      })()`);
    };

    const clickRetryButton = async (cdp) => {
      return await cdp.eval(`(() => {
        const retryBtn = Array.from(document.querySelectorAll('button')).find(b =>
          b.textContent && (b.textContent.includes('Thử lại đơn chờ') || b.textContent.includes('Retry pending order'))
        );
        if (retryBtn && !retryBtn.disabled) {
          retryBtn.click();
          return true;
        }
        return false;
      })()`);
    };

    // 1. Prepare distinct items in each tab
    // Tab 1: Cà phê sữa đá (35,000 VND)
    await selectItem(cdp1, 'Cà phê sữa đá');

    // Tab 2: Trà đào cam sả (45,000 VND)
    await selectItem(cdp2, 'Trà đào cam sả');

    // Configure server to HOLD Tab 1's request in flight
    serverState.holdPostA = true;

    // Queue both real checkout attempts behind the same browser lock.
    // This forces both tabs to begin before either can read or claim storage.
    const pendingStorageKey = `qlaok_pos_pending_v1:owner-alpha:shop-qa-a`;
    await cdp1.eval(`(() => {
      navigator.locks.request(${JSON.stringify(pendingStorageKey)}, async () => {
        window.__testLockHeld = true;
        await new Promise(resolve => { window.__releaseTestLock = resolve; });
      });
    })()`);
    const lockDeadline = Date.now() + 5000;
    while (Date.now() < lockDeadline && !await cdp1.eval('!!window.__testLockHeld')) {
      await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(await cdp1.eval('!!window.__testLockHeld'), true, 'test barrier must hold the browser lock');

    // 2. Both tabs click Pay while the barrier prevents either claim.
    const clickedTab1 = await clickPayButton(cdp1);
    assert.equal(clickedTab1, true, 'Tab 1 Pay button should be clicked');
    const clickedTab2 = await clickPayButton(cdp2);
    assert.equal(clickedTab2, true, 'Tab 2 Pay button should be clicked concurrently');
    assert.equal(serverState.receivedPosts.length, 0, 'neither checkout may send before the lock is released');
    await cdp1.eval('window.__releaseTestLock()');

    // Wait until Tab 1's POST request has been sent and reached the server
    const waitDeadline = Date.now() + 5000;
    while (serverState.receivedPosts.length === 0 && Date.now() < waitDeadline) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // Tab 2 should immediately reflect the pending order before another checkout.
    const bannerDeadline = Date.now() + 5000;
    while (Date.now() < bannerDeadline && !await cdp2.eval(`!!document.querySelector('[data-testid="pos-pending-order"]')`)) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const tab2PendingBannerBeforeClick = await cdp2.eval(
      `!!document.querySelector('[data-testid="pos-pending-order"]')`
    );
    assert.equal(tab2PendingBannerBeforeClick, true, 'Tab 2 should show the pending request promptly');

    // Ensure Tab 2's concurrent attempt has finished its lock turn and did not send a second POST
    assert.equal(
      serverState.receivedPosts.length,
      1,
      `Expected one request while the first is held; fixture items: ${serverState.receivedPosts.map(post => post.parsed.items?.[0]?.item_id).join(', ')}`
    );

    const reqA = serverState.receivedPosts[0];
    const keyA = reqA.idempotencyKey;
    assert.ok(keyA.startsWith('pos-web:'), 'Tab 1 idempotency key must start with pos-web:');

    // Verify IndexedDB currently has Tab 1's pending order and localStorage is NOT used
    const tab1IdbRaw = await readIdbPendingRaw(cdp1, pendingStorageKey);
    assert.ok(tab1IdbRaw, 'IndexedDB must hold Tab 1 pending order while request is in flight');
    const tab1Storage = JSON.parse(tab1IdbRaw);
    assert.equal(tab1Storage.key, keyA);
    assert.equal(
      await cdp1.eval(`window.localStorage.getItem(${JSON.stringify(pendingStorageKey)})`),
      null,
      'localStorage must not be used as authoritative pending store'
    );

    // VERIFICATION 1: Did Tab 2 overwrite Tab 1's pending order in IndexedDB?
    const currentIdbRaw = await readIdbPendingRaw(cdp2, pendingStorageKey);
    assert.ok(currentIdbRaw, 'Tab 2 must read Tab 1 pending order from IndexedDB');
    const currentStorage = JSON.parse(currentIdbRaw);
    assert.equal(
      currentStorage.key,
      keyA,
      'Tab 2 MUST NOT overwrite Tab 1 pending request in IndexedDB!'
    );

    // VERIFICATION 2: Did Tab 2 send a request to the server?
    assert.equal(
      serverState.receivedPosts.length,
      1,
      'Tab 2 MUST NOT have sent a network request while Tab 1 pending request is unresolved!'
    );

    // 4. Release Tab 1's in-flight request so it completes successfully
    serverState.holdPostA = false;
    if (serverState.holdPostAResolver) {
      const resolve = serverState.holdPostAResolver;
      serverState.holdPostAResolver = null;
      resolve();
    }

    // Wait for Tab 1 to finish and clear IndexedDB
    const waitClearDeadline = Date.now() + 5000;
    while (Date.now() < waitClearDeadline) {
      const s = await readIdbPendingRaw(cdp1, pendingStorageKey);
      if (s === null) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    const finalStorage = await readIdbPendingRaw(cdp1, pendingStorageKey);
    assert.equal(finalStorage, null, 'IndexedDB must be cleared after Tab 1 order confirmed');

    // Tab 1 finished successfully
    const tab1EventsDeadline = Date.now() + 5000;
    while (Date.now() < tab1EventsDeadline && (await cdp1.eval(`(window.__orderEvents || []).length`)) === 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const tab1Events = await cdp1.eval(`window.__orderEvents || []`);
    assert.equal(tab1Events.length, 1, 'Tab 1 should have confirmed 1 order');
    assert.equal((await cdp2.eval(`(window.__orderEvents || []).length`)), 0, 'Tab 2 must not fire onOrderCreated for Tab 1 order');

    // Tab 2 unlocks after the confirmed removal, preserving its separate ticket.
    const unlockDeadline = Date.now() + 5000;
    while (Date.now() < unlockDeadline && await cdp2.eval(`!!document.querySelector('[data-testid="pos-pending-order"]')`)) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(await cdp2.eval(`!!document.querySelector('[data-testid="pos-pending-order"]')`), false);
    assert.equal(await clickPayButton(cdp2), true, 'Tab 2 can submit its own preserved ticket');
    const secondDeadline = Date.now() + 5000;
    while (serverState.receivedPosts.length < 2 && Date.now() < secondDeadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(serverState.receivedPosts.length, 2, 'Tab 2 sends its own order once');
    assert.notEqual(serverState.receivedPosts[1].idempotencyKey, keyA);
    assert.equal(serverState.receivedPosts[1].parsed.items?.[0]?.item_id, 'item-tea-2');

    const tab2FinishDeadline = Date.now() + 5000;
    while (Date.now() < tab2FinishDeadline && (await cdp2.eval(`(window.__orderEvents || []).length`)) === 0) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(await cdp2.eval(`(window.__orderEvents || []).length`), 1, 'Tab 2 confirms its own order');

    // =========================================================================
    // PHASE 2: Concurrent retry across two tabs after a lost response
    // =========================================================================
    await cdp1.eval(`window.__orderEvents = []`);
    await cdp2.eval(`window.__orderEvents = []`);

    // Tab 1 prepares Coffee; Tab 2 prepares Peach Tea draft (not yet submitted)
    await selectItem(cdp1, 'Cà phê sữa đá');
    await selectItem(cdp2, 'Trà đào cam sả');

    serverState.simulateLostResponseOnce = true;
    const clickedPhase2Tab1 = await clickPayButton(cdp1);
    assert.equal(clickedPhase2Tab1, true, 'Tab 1 clicks Pay for Phase 2 order');

    const lostDeadline = Date.now() + 5000;
    while (serverState.receivedPosts.length < 3 && Date.now() < lostDeadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(serverState.receivedPosts.length, 3, 'Phase 2 initial attempt reached server before lost response');
    const lostPost = serverState.receivedPosts[2];

    // Wait for both Tab 1 and Tab 2 to show the pending recovery banner
    const bothPendingDeadline = Date.now() + 5000;
    while (Date.now() < bothPendingDeadline) {
      const b1 = await cdp1.eval(`!!document.querySelector('[data-testid="pos-pending-order"]')`);
      const b2 = await cdp2.eval(`!!document.querySelector('[data-testid="pos-pending-order"]')`);
      const retry1Ready = await cdp1.eval(`(() => {
        const retryBtn = Array.from(document.querySelectorAll('button')).find(b =>
          b.textContent && (b.textContent.includes('Thử lại đơn chờ') || b.textContent.includes('Retry pending order'))
        );
        return Boolean(retryBtn && !retryBtn.disabled);
      })()`);
      if (b1 && b2 && retry1Ready) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(await cdp1.eval(`!!document.querySelector('[data-testid="pos-pending-order"]')`), true, 'Tab 1 shows pending banner after lost response');
    assert.equal(await cdp2.eval(`!!document.querySelector('[data-testid="pos-pending-order"]')`), true, 'Tab 2 shows pending banner via BroadcastChannel');

    // Hold both concurrent retry responses on server until both arrive, then release simultaneously
    serverState.holdConcurrentRetriesCount = 2;
    assert.equal(await clickRetryButton(cdp1), true, 'Tab 1 clicks retry');
    assert.equal(await clickRetryButton(cdp2), true, 'Tab 2 clicks retry concurrently');

    const retryPostsDeadline = Date.now() + 5000;
    while (serverState.receivedPosts.length < 5 && Date.now() < retryPostsDeadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(serverState.receivedPosts.length, 5, 'Both tabs sent exact retry requests');
    assert.equal(serverState.receivedPosts[3].idempotencyKey, lostPost.idempotencyKey);
    assert.equal(serverState.receivedPosts[3].rawBody, lostPost.rawBody);
    assert.equal(serverState.receivedPosts[4].idempotencyKey, lostPost.idempotencyKey);
    assert.equal(serverState.receivedPosts[4].rawBody, lostPost.rawBody);
    assert.equal(serverState.committedOrders.size, 3, 'Server committed only 1 order for the retried key (total 3 orders across test)');

    // Wait for both tabs to clear the pending banner and IndexedDB to be empty
    const retryClearDeadline = Date.now() + 5000;
    while (Date.now() < retryClearDeadline) {
      const b1 = await cdp1.eval(`!!document.querySelector('[data-testid="pos-pending-order"]')`);
      const b2 = await cdp2.eval(`!!document.querySelector('[data-testid="pos-pending-order"]')`);
      const idbVal = await readIdbPendingRaw(cdp1, pendingStorageKey);
      if (!b1 && !b2 && idbVal === null) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(await readIdbPendingRaw(cdp1, pendingStorageKey), null, 'IndexedDB cleared after concurrent retry');
    assert.equal(await cdp1.eval(`!!document.querySelector('[data-testid="pos-pending-order"]')`), false);
    assert.equal(await cdp2.eval(`!!document.querySelector('[data-testid="pos-pending-order"]')`), false);

    // Exactly ONE tab must have fired onOrderCreated/receipt callback for the concurrent retry
    const retryEvents1 = await cdp1.eval(`window.__orderEvents || []`);
    const retryEvents2 = await cdp2.eval(`window.__orderEvents || []`);
    assert.equal(
      retryEvents1.length + retryEvents2.length,
      1,
      `Expected exactly 1 confirmed callback across both tabs on concurrent retry, got tab1=${retryEvents1.length}, tab2=${retryEvents2.length}`
    );

    // Tab 2 still preserved its Peach Tea draft and can submit it
    assert.equal(await clickPayButton(cdp2), true, 'Tab 2 still preserves its draft after concurrent retry and can submit it');
    const finalPostDeadline = Date.now() + 5000;
    while (serverState.receivedPosts.length < 6 && Date.now() < finalPostDeadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(serverState.receivedPosts.length, 6, 'Tab 2 submits its preserved Peach Tea order');
    assert.equal(serverState.receivedPosts[5].parsed.items?.[0]?.item_id, 'item-tea-2');
  } finally {
    if (serverState.holdPostAResolver) {
      serverState.holdPostAResolver();
    }
    if (cdp1) cdp1.close();
    if (cdp2) cdp2.close();
    chromeProc.kill('SIGKILL');
    await new Promise((r) => server.close(r));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5 });
    } catch {}
  }
});
