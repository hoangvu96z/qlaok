import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Focused Regression Test: Review Item P3-17 (Catalog toast and saved feedback timers)
 *
 * Requirements:
 * 1. No stale timer can dismiss a newer feedback message (timer cancellation on replacement).
 * 2. Every component-owned timeout that can update component state is cleared on unmount.
 * 3. Preserve current toast duration (2500ms for catalog page, 1800ms for QuickItemRow),
 *    wording, and behavior.
 * 4. Regression proves why the fix works and demonstrates that the pre-fix implementation
 *    fails under concurrent/rapid actions or unmount.
 */

const catalogPagePath = path.join(
  process.cwd(),
  'src/app/(dashboard)/dashboard/catalog/page.tsx'
);
const quickItemRowPath = path.join(
  process.cwd(),
  'src/components/dashboard/QuickItemRow.tsx'
);
const feedbackToastPath = path.join(
  process.cwd(),
  'src/components/ui/FeedbackToast.tsx'
);

const catalogPageSource = readFileSync(catalogPagePath, 'utf8');
const quickItemRowSource = readFileSync(quickItemRowPath, 'utf8');
const feedbackToastSource = readFileSync(feedbackToastPath, 'utf8');

// Helper to count occurrences of a regex pattern in text
function countOccurrences(source: string, regex: RegExp): number {
  const matches = source.match(new RegExp(regex, 'g'));
  return matches ? matches.length : 0;
}

test('P3-17: DashboardCatalogPage static source & AST invariants for toast timer', () => {
  // 1. Ref declaration exists and is typed appropriately
  assert.match(
    catalogPageSource,
    /const\s+toastTimerRef\s*=\s*useRef<ReturnType<typeof\s+setTimeout>\s*\|\s*null>\(null\);/,
    'DashboardCatalogPage must declare toastTimerRef as a useRef for setTimeout handle'
  );

  // 2. showToast cancels any active timer before queuing a new one
  assert.match(
    catalogPageSource,
    /const\s+showToast\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?if\s*\(\s*toastTimerRef\.current\s*\)\s*clearTimeout\(\s*toastTimerRef\.current\s*\);[\s\S]*?toastTimerRef\.current\s*=\s*setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*?setToastMsg\(''\);[\s\S]*?toastTimerRef\.current\s*=\s*null;[\s\S]*?\}\s*,\s*2500\s*\);/,
    'showToast must clear active toastTimerRef.current, set message, save new timer handle, and reset ref on completion (2500ms)'
  );

  // 3. Unmount cleanup hook cancels toastTimerRef
  assert.match(
    catalogPageSource,
    /useEffect\(\s*\(\)\s*=>\s*\(\)\s*=>\s*\{[\s\S]*?if\s*\(\s*toastTimerRef\.current\s*\)\s*clearTimeout\(\s*toastTimerRef\.current\s*\);[\s\S]*?\}\s*,\s*\[\]\s*\);/,
    'DashboardCatalogPage must have an unmount useEffect cleanup that cancels toastTimerRef.current'
  );

  // 4. Verify no untracked setTimeout calls exist in DashboardCatalogPage
  const setTimeoutCalls = countOccurrences(catalogPageSource, /setTimeout\s*\(/);
  assert.equal(
    setTimeoutCalls,
    1,
    'DashboardCatalogPage must contain exactly 1 setTimeout call, which is tracked in toastTimerRef'
  );

  // 5. Verify no untracked setInterval calls exist in DashboardCatalogPage
  const setIntervalCalls = countOccurrences(catalogPageSource, /setInterval\s*\(/);
  assert.equal(
    setIntervalCalls,
    0,
    'DashboardCatalogPage must not contain unmanaged setInterval calls'
  );
});

test('P3-17: QuickItemRow static source & AST invariants for price and stock saved timers', () => {
  // 1. Ref declarations exist for price and stock
  assert.match(
    quickItemRowSource,
    /const\s+priceSavedTimerRef\s*=\s*useRef<ReturnType<typeof\s+setTimeout>\s*\|\s*null>\(null\);/,
    'QuickItemRow must declare priceSavedTimerRef'
  );
  assert.match(
    quickItemRowSource,
    /const\s+stockSavedTimerRef\s*=\s*useRef<ReturnType<typeof\s+setTimeout>\s*\|\s*null>\(null\);/,
    'QuickItemRow must declare stockSavedTimerRef'
  );

  // 2. Unmount cleanup hook cancels both timer refs
  assert.match(
    quickItemRowSource,
    /useEffect\(\s*\(\)\s*=>\s*\(\)\s*=>\s*\{[\s\S]*?if\s*\(\s*priceSavedTimerRef\.current\s*\)\s*clearTimeout\(\s*priceSavedTimerRef\.current\s*\);[\s\S]*?if\s*\(\s*stockSavedTimerRef\.current\s*\)\s*clearTimeout\(\s*stockSavedTimerRef\.current\s*\);[\s\S]*?\}\s*,\s*\[\]\s*\);/,
    'QuickItemRow must have unmount cleanup clearing both priceSavedTimerRef and stockSavedTimerRef'
  );

  // 3. handlePriceBlurOrEnter clears active timer before setting a new one (1800ms)
  assert.match(
    quickItemRowSource,
    /setPriceSaved\(true\);[\s\S]*?if\s*\(\s*priceSavedTimerRef\.current\s*\)\s*clearTimeout\(\s*priceSavedTimerRef\.current\s*\);[\s\S]*?priceSavedTimerRef\.current\s*=\s*setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*?priceSavedTimerRef\.current\s*=\s*null;[\s\S]*?setPriceSaved\(false\);[\s\S]*?\}\s*,\s*1800\s*\);/,
    'Price save must clear active timer and set 1800ms timeout tracked in priceSavedTimerRef'
  );

  // 4. handleStockBlurOrEnter clears active timer before setting a new one (1800ms)
  assert.match(
    quickItemRowSource,
    /setStockSaved\(true\);[\s\S]*?if\s*\(\s*stockSavedTimerRef\.current\s*\)\s*clearTimeout\(\s*stockSavedTimerRef\.current\s*\);[\s\S]*?stockSavedTimerRef\.current\s*=\s*setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*?stockSavedTimerRef\.current\s*=\s*null;[\s\S]*?setStockSaved\(false\);[\s\S]*?\}\s*,\s*1800\s*\);/,
    'Stock save must clear active timer and set 1800ms timeout tracked in stockSavedTimerRef'
  );

  // 5. Total setTimeout calls in QuickItemRow is exactly 2 (price and stock)
  const setTimeoutCalls = countOccurrences(quickItemRowSource, /setTimeout\s*\(/);
  assert.equal(
    setTimeoutCalls,
    2,
    'QuickItemRow must contain exactly 2 setTimeout calls (priceSaved and stockSaved)'
  );

  // 6. Photo upload feedback uses FeedbackToast component
  assert.match(
    quickItemRowSource,
    /<FeedbackToast[\s\S]*?feedback=\{photoFeedback\}[\s\S]*?onDismiss=\{\(\)\s*=>\s*setPhotoFeedback\(null\)\}/,
    'QuickItemRow photo upload feedback must be delegated to FeedbackToast with safe onDismiss'
  );

  // 7. FeedbackToast itself cleans up timeout on unmount or feedback change
  assert.match(
    feedbackToastSource,
    /useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?const\s+timeout\s*=\s*window\.setTimeout\(onDismiss,\s*4000\);[\s\S]*?return\s*\(\)\s*=>\s*window\.clearTimeout\(timeout\);[\s\S]*?\}\s*,\s*\[feedback,\s*onDismiss\]\s*\);/,
    'FeedbackToast must register an unmount/change cleanup via window.clearTimeout'
  );
});

test('P3-17: Behavioral simulation - Catalog Page showToast prevents premature dismissal and unmount leaks', () => {
  // Mock clock environment
  let now = 0;
  let nextTimerId = 1;
  interface ScheduledTimer {
    id: number;
    fireAt: number;
    fn: () => void;
    canceled: boolean;
  }
  const timerQueue: ScheduledTimer[] = [];

  const mockSetTimeout = (fn: () => void, ms: number) => {
    const id = nextTimerId++;
    timerQueue.push({ id, fireAt: now + ms, fn, canceled: false });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  const mockClearTimeout = (handle: ReturnType<typeof setTimeout> | null | undefined) => {
    if (!handle) return;
    const entry = timerQueue.find((t) => t.id === (handle as unknown as number));
    if (entry) {
      entry.canceled = true;
    }
  };

  const advanceClockTo = (targetTime: number) => {
    now = targetTime;
    // Execute all non-canceled timers up to current time
    const ready = timerQueue
      .filter((t) => !t.canceled && t.fireAt <= now)
      .sort((a, b) => a.fireAt - b.fireAt);
    for (const item of ready) {
      if (!item.canceled) {
        item.canceled = true;
        item.fn();
      }
    }
  };

  // --- 1. Simulation of the FIXED implementation ---
  {
    let toastMsg = '';
    let toastTimerRefCurrent: ReturnType<typeof setTimeout> | null = null;
    let postUnmountUpdates = 0;
    let isMounted = true;

    const setToastMsg = (msg: string) => {
      if (!isMounted) postUnmountUpdates++;
      toastMsg = msg;
    };

    const showToastFixed = (msg: string) => {
      if (toastTimerRefCurrent) mockClearTimeout(toastTimerRefCurrent);
      setToastMsg(msg);
      toastTimerRefCurrent = mockSetTimeout(() => {
        setToastMsg('');
        toastTimerRefCurrent = null;
      }, 2500);
    };

    const unmountPage = () => {
      isMounted = false;
      if (toastTimerRefCurrent) {
        mockClearTimeout(toastTimerRefCurrent);
        toastTimerRefCurrent = null;
      }
    };

    // Action 1: show toast "Item 1 saved" at t = 0
    now = 0;
    showToastFixed('Món 1 đã lưu');
    assert.equal(toastMsg, 'Món 1 đã lưu');
    assert.ok(toastTimerRefCurrent !== null);

    // Advance 1500ms
    advanceClockTo(1500);
    assert.equal(toastMsg, 'Món 1 đã lưu');

    // Action 2: show toast "Item 2 saved" at t = 1500ms (overlapping)
    showToastFixed('Món 2 đã lưu');
    assert.equal(toastMsg, 'Món 2 đã lưu');

    // Advance to t = 2500ms: in the OLD code, timer 1 would fire here and wipe out "Món 2" after only 1000ms.
    // In the FIXED code, timer 1 was canceled, so "Món 2" MUST remain visible!
    advanceClockTo(2500);
    assert.equal(
      toastMsg,
      'Món 2 đã lưu',
      'At t=2500ms, newer message must NOT be dismissed by the older timer'
    );

    // Advance to t = 3999ms: "Món 2" is still within its 2500ms window (active until 1500 + 2500 = 4000)
    advanceClockTo(3999);
    assert.equal(toastMsg, 'Món 2 đã lưu');

    // Advance to t = 4000ms: timer 2 fires
    advanceClockTo(4000);
    assert.equal(toastMsg, '', 'At t=4000ms, message is dismissed after its full 2500ms window');
    assert.equal(toastTimerRefCurrent, null);

    // Action 3: verify unmount cleanup
    showToastFixed('Món 3 đã lưu');
    assert.equal(toastMsg, 'Món 3 đã lưu');
    unmountPage();
    advanceClockTo(8000);
    assert.equal(
      postUnmountUpdates,
      0,
      'No state updates may occur after component unmounts'
    );
  }

  // --- 2. Counterfactual proof: Simulation of the PRE-FIX implementation ---
  {
    let toastMsg = '';
    let isMounted = true;
    let postUnmountUpdates = 0;

    const setToastMsg = (msg: string) => {
      if (!isMounted) postUnmountUpdates++;
      toastMsg = msg;
    };

    // Pre-fix implementation: bare setTimeout with no handle, no clearTimeout, no unmount hook
    const showToastBuggy = (msg: string) => {
      setToastMsg(msg);
      mockSetTimeout(() => {
        setToastMsg('');
      }, 2500);
    };

    now = 0;
    showToastBuggy('Món 1 đã lưu');
    advanceClockTo(1500);
    showToastBuggy('Món 2 đã lưu');

    // At t=2500ms, stale timer 1 fires in buggy code
    advanceClockTo(2500);
    assert.equal(
      toastMsg,
      '',
      'Proof of bug: without the fix, stale timer 1 clears newer message after only 1000ms'
    );

    // Unmount at t=3000ms with pending timer 2
    isMounted = false;
    advanceClockTo(4000); // timer 2 fires at 1500 + 2500 = 4000
    assert.equal(
      postUnmountUpdates,
      1,
      'Proof of bug: without the fix, orphaned timer fires and updates state after unmount'
    );
  }
});

test('P3-17: Behavioral simulation - QuickItemRow price and stock saved indicators', () => {
  let now = 0;
  let nextTimerId = 1;
  interface ScheduledTimer {
    id: number;
    fireAt: number;
    fn: () => void;
    canceled: boolean;
  }
  const timerQueue: ScheduledTimer[] = [];

  const mockSetTimeout = (fn: () => void, ms: number) => {
    const id = nextTimerId++;
    timerQueue.push({ id, fireAt: now + ms, fn, canceled: false });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  const mockClearTimeout = (handle: ReturnType<typeof setTimeout> | null | undefined) => {
    if (!handle) return;
    const entry = timerQueue.find((t) => t.id === (handle as unknown as number));
    if (entry) {
      entry.canceled = true;
    }
  };

  const advanceClockTo = (targetTime: number) => {
    now = targetTime;
    const ready = timerQueue
      .filter((t) => !t.canceled && t.fireAt <= now)
      .sort((a, b) => a.fireAt - b.fireAt);
    for (const item of ready) {
      if (!item.canceled) {
        item.canceled = true;
        item.fn();
      }
    }
  };

  let priceSaved = false;
  let stockSaved = false;
  let priceSavedTimerRefCurrent: ReturnType<typeof setTimeout> | null = null;
  let stockSavedTimerRefCurrent: ReturnType<typeof setTimeout> | null = null;
  let isMounted = true;
  let postUnmountUpdates = 0;

  const setPriceSaved = (val: boolean) => {
    if (!isMounted) postUnmountUpdates++;
    priceSaved = val;
  };
  const setStockSaved = (val: boolean) => {
    if (!isMounted) postUnmountUpdates++;
    stockSaved = val;
  };

  const onPriceSavedSuccess = () => {
    setPriceSaved(true);
    if (priceSavedTimerRefCurrent) mockClearTimeout(priceSavedTimerRefCurrent);
    priceSavedTimerRefCurrent = mockSetTimeout(() => {
      priceSavedTimerRefCurrent = null;
      setPriceSaved(false);
    }, 1800);
  };

  const onStockSavedSuccess = () => {
    setStockSaved(true);
    if (stockSavedTimerRefCurrent) mockClearTimeout(stockSavedTimerRefCurrent);
    stockSavedTimerRefCurrent = mockSetTimeout(() => {
      stockSavedTimerRefCurrent = null;
      setStockSaved(false);
    }, 1800);
  };

  const unmountRow = () => {
    isMounted = false;
    if (priceSavedTimerRefCurrent) mockClearTimeout(priceSavedTimerRefCurrent);
    if (stockSavedTimerRefCurrent) mockClearTimeout(stockSavedTimerRefCurrent);
  };

  // Test price: rapid saves at t=0 and t=1000ms
  now = 0;
  onPriceSavedSuccess();
  assert.equal(priceSaved, true);
  advanceClockTo(1000);
  onPriceSavedSuccess(); // Save again before 1800ms

  // At t=1800ms: timer 1 would have expired, but timer 2 was set at t=1000ms (expires at 2800ms)
  advanceClockTo(1800);
  assert.equal(priceSaved, true, 'Price saved indicator must stay visible after timer 1 cancelation');

  advanceClockTo(2800);
  assert.equal(priceSaved, false, 'Price saved indicator clears at t=2800ms');

  // Test stock: save at t=3000ms and unmount at t=3500ms
  now = 3000;
  onStockSavedSuccess();
  assert.equal(stockSaved, true);
  advanceClockTo(3500);
  unmountRow();

  // Advance past expiration (3000 + 1800 = 4800)
  advanceClockTo(5000);
  assert.equal(
    postUnmountUpdates,
    0,
    'Unmount cleanup must cancel pending stock/price timers, preventing post-unmount setState'
  );
});
