import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  NewOrderToastCard,
  TOAST_POSITION_CLASSES,
  type NewOrderToastCardProps,
} from '@/components/dashboard/NewOrderToastCard';
import type { OrderToastPosition } from '@/lib/order-chime';

/**
 * Focused Regression Test: Full-card new-order toast interaction
 *
 * Scope & Test Limit Explanation:
 * The complete DashboardShell component relies on browser-only state and active
 * backend subscriptions (Supabase auth client, BroadcastChannel, Web Audio context,
 * and DashboardProvider context), so headlessly mounting DashboardShell in isolated
 * Node.js test runs without mock infrastructure is intractable.
 *
 * DashboardShell delegates the popup rendering directly to NewOrderToastCard.
 * This test exercises NewOrderToastCard itself:
 * 1. Confirms the root element is an accessible Link to /dashboard/orders with
 *    data-testid="new-order-toast-card".
 * 2. Confirms there are no nested interactive elements (<button> or <a>).
 * 3. Confirms inner content has `pointer-events-none` so in the browser all pointer hits
 *    resolve unambiguously to the card Link, accompanied by `cursor-pointer` and `group`
 *    affordances.
 * 4. Traverses the actual React element tree to prove that clicks at all distinct
 *    descendant targets (padding/background, bell icon, title/order code, total amount,
 *    yellow CTA pill, and close glyph area) reach the root Link and invoke `onOpenOrders`.
 */

describe('NewOrderToastCard Interaction and Markup QA', () => {
  const defaultOrder = {
    orderCode: 'QC-108',
    tableLabel: 'Bàn 03',
    totalAmount: 95000,
  };

  const defaultProps: NewOrderToastCardProps = {
    order: defaultOrder,
    position: 'top-right',
    currency: 'VND',
    targetHref: '/dashboard/orders',
    onOpenOrders: () => {},
    openOrdersLabel: 'Mở xử lý đơn',
    newOrderBadgeLabel: 'Đơn mới',
    totalLabel: 'Tổng đơn:',
  };

  it('renders semantic, accessible whole-card Link without nested interactive controls', () => {
    const html = renderToStaticMarkup(React.createElement(NewOrderToastCard, defaultProps));

    // Root is an anchor link to /dashboard/orders with data-testid="new-order-toast-card"
    assert.match(html, /^<a\b/, 'Root element must be an anchor tag');
    assert.match(
      html,
      /data-testid="new-order-toast-card"/,
      'Root must be marked with data-testid="new-order-toast-card"'
    );
    assert.match(
      html,
      /href="\/dashboard\/orders"/,
      'Root must be an anchor link to /dashboard/orders'
    );

    // Accessible name and live region
    assert.match(html, /aria-label="Bàn 03 • #QC-108 - Mở xử lý đơn"/, 'Card must have clear accessible name');
    assert.match(html, /aria-live="polite"/, 'Card must announce politely');

    // Interactive styling: pointer cursor, text selection suppression, and group hover
    assert.match(html, /cursor-pointer/, 'Card must have cursor-pointer across its full surface');
    assert.match(html, /select-none/, 'Card must have select-none to prevent drag interfering with click');
    assert.match(html, /group/, 'Card must have group class for coordinated hover');
    assert.match(html, /focus-visible:ring-2/, 'Card must show keyboard focus ring');

    // Inner container uses pointer-events-none to prevent child hit trapping
    assert.match(
      html,
      /data-testid="toast-card-content"[^>]*pointer-events-none/,
      'Content wrapper must have pointer-events-none so pointer hits target root Link directly'
    );

    // Close glyph is decorative (aria-hidden) and not a nested button
    assert.match(
      html,
      /data-testid="toast-card-close"[^>]*aria-hidden="true"/,
      'Close glyph must be marked aria-hidden="true"'
    );

    // Verify absence of nested interactive controls (no nested <button> or second <a>)
    assert.doesNotMatch(html, /<button/i, 'Card must NOT contain nested <button> controls');
    const anchorMatches = html.match(/<a\b/gi);
    assert.equal(anchorMatches?.length, 1, 'Card must contain exactly ONE anchor link (the root card itself)');
  });

  it('renders content labels and formatted currency properly', () => {
    const html = renderToStaticMarkup(React.createElement(NewOrderToastCard, defaultProps));

    assert.ok(html.includes('Bàn 03 • #QC-108'), 'Must include table label and order code');
    assert.ok(html.includes('Đơn mới'), 'Must include new order badge');
    assert.ok(html.includes('Mở xử lý đơn'), 'Must include CTA action text');
    assert.ok(html.includes('95.000'), 'Must include formatted total amount');
  });

  it('maps position prop to correct fixed position classes and falls back safely', () => {
    const positions: Array<[OrderToastPosition, string]> = [
      ['top-right', 'top-4 right-4'],
      ['top-left', 'top-4 left-4'],
      ['bottom-right', 'bottom-4 right-4'],
      ['bottom-left', 'bottom-4 left-4'],
    ];

    for (const [pos, expectedClass] of positions) {
      assert.equal(
        TOAST_POSITION_CLASSES[pos],
        expectedClass,
        `TOAST_POSITION_CLASSES[${pos}] must match ${expectedClass}`
      );
      const html = renderToStaticMarkup(
        React.createElement(NewOrderToastCard, { ...defaultProps, position: pos })
      );
      assert.ok(
        html.includes(expectedClass),
        `Position ${pos} must apply class "${expectedClass}"`
      );
    }

    // Fallback for invalid/unrecognized position
    const fallbackHtml = renderToStaticMarkup(
      React.createElement(NewOrderToastCard, {
        ...defaultProps,
        position: 'invalid-position' as unknown as OrderToastPosition,
      })
    );
    assert.ok(
      fallbackHtml.includes('top-4 right-4'),
      'Invalid position must safely fall back to top-4 right-4'
    );
  });

  // --- Real Rendered Element Event Bubbling & Multi-point Click Verification ---

  /**
   * Helper that walks a React element tree and finds the path from a node to the root.
   */
  function findElementPathByTestId(
    root: React.ReactElement,
    testId: string
  ): React.ReactElement[] | null {
    const path: React.ReactElement[] = [];

    function search(node: React.ReactNode): boolean {
      if (!React.isValidElement(node)) return false;
      path.push(node);
      const props = node.props as Record<string, unknown>;
      if (props['data-testid'] === testId) {
        return true;
      }
      const children = (node.props as { children?: React.ReactNode }).children;
      if (Array.isArray(children)) {
        for (const child of children) {
          if (search(child)) return true;
        }
      } else if (children) {
        if (search(children)) return true;
      }
      path.pop();
      return false;
    }

    return search(root) ? path : null;
  }

  /**
   * Simulates browser event bubbling: starts at target element and walks up
   * ancestors to the root, executing onClick handlers along the way.
   */
  function simulateClickAtPoint(root: React.ReactElement, testId: string): void {
    const path = findElementPathByTestId(root, testId);
    assert.ok(path, `Target element data-testid="${testId}" must exist in the rendered component`);

    const simulatedEvent = {
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      },
      target: path[path.length - 1],
      currentTarget: root,
    };

    // Bubble upwards from the clicked point to root
    for (let i = path.length - 1; i >= 0; i--) {
      const element = path[i];
      const props = element.props as Record<string, unknown>;
      if (typeof props.onClick === 'function') {
        props.onClick(simulatedEvent);
        if (simulatedEvent.propagationStopped) break;
      }
    }
  }

  it('clicks at card padding/background call the dismiss-and-navigate action', () => {
    let callCount = 0;
    const tree = NewOrderToastCard({
      ...defaultProps,
      onOpenOrders: () => {
        callCount++;
      },
    });

    simulateClickAtPoint(tree, 'new-order-toast-card');
    assert.equal(callCount, 1, 'Clicking card padding/background must invoke onOpenOrders');
  });

  it('clicks at bell icon container call the dismiss-and-navigate action', () => {
    let callCount = 0;
    const tree = NewOrderToastCard({
      ...defaultProps,
      onOpenOrders: () => {
        callCount++;
      },
    });

    simulateClickAtPoint(tree, 'toast-card-bell');
    assert.equal(callCount, 1, 'Clicking bell icon must bubble and invoke onOpenOrders');
  });

  it('clicks at table label and order code title call the dismiss-and-navigate action', () => {
    let callCount = 0;
    const tree = NewOrderToastCard({
      ...defaultProps,
      onOpenOrders: () => {
        callCount++;
      },
    });

    simulateClickAtPoint(tree, 'toast-card-title');
    assert.equal(callCount, 1, 'Clicking order title must bubble and invoke onOpenOrders');
  });

  it('clicks at total amount text call the dismiss-and-navigate action', () => {
    let callCount = 0;
    const tree = NewOrderToastCard({
      ...defaultProps,
      onOpenOrders: () => {
        callCount++;
      },
    });

    simulateClickAtPoint(tree, 'toast-card-total');
    assert.equal(callCount, 1, 'Clicking total amount text must bubble and invoke onOpenOrders');
  });

  it('clicks at yellow CTA pill call the dismiss-and-navigate action', () => {
    let callCount = 0;
    const tree = NewOrderToastCard({
      ...defaultProps,
      onOpenOrders: () => {
        callCount++;
      },
    });

    simulateClickAtPoint(tree, 'toast-card-cta');
    assert.equal(callCount, 1, 'Clicking yellow CTA pill must invoke onOpenOrders');
  });

  it('clicks at decorative close glyph area call the dismiss-and-navigate action', () => {
    let callCount = 0;
    const tree = NewOrderToastCard({
      ...defaultProps,
      onOpenOrders: () => {
        callCount++;
      },
    });

    simulateClickAtPoint(tree, 'toast-card-close');
    assert.equal(callCount, 1, 'Clicking close glyph area must invoke onOpenOrders (navigates + closes)');
  });

  it('verifies all 6 distinct points call the exact same dismiss-and-navigate handler', () => {
    const points = [
      'new-order-toast-card', // 1. Root card background / padding
      'toast-card-bell',      // 2. Bell icon
      'toast-card-title',     // 3. Table/order title
      'toast-card-total',     // 4. Total amount
      'toast-card-cta',       // 5. Yellow CTA
      'toast-card-close',     // 6. Decorative close glyph area
    ];

    let totalActionCalls = 0;
    const tree = NewOrderToastCard({
      ...defaultProps,
      onOpenOrders: () => {
        totalActionCalls++;
      },
    });

    for (let i = 0; i < points.length; i++) {
      simulateClickAtPoint(tree, points[i]);
      assert.equal(
        totalActionCalls,
        i + 1,
        `Point "${points[i]}" must increment action call count to ${i + 1}`
      );
    }

    assert.equal(totalActionCalls, 6, 'All 6 interaction points must trigger the same dismiss-and-navigate action');
  });
});
