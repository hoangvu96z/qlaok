import assert from 'node:assert/strict';
import test from 'node:test';
import { copyText } from '@/lib/copy-text';

test('clipboard copy succeeds or fails honestly and always removes the fallback input', async () => {
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let removed = 0;
  let copied = '';
  let fallbackResult: boolean | 'throw' = true;
  const input = { value: '', style: { position: '', opacity: '' }, select() {}, remove() { removed++; } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement() { return input; },
    body: { appendChild() {} },
    execCommand() { if (fallbackResult === 'throw') throw new Error('denied'); return fallbackResult; },
  } });
  try {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
      clipboard: { async writeText(text: string) { copied = text; } },
    } });
    assert.equal(await copyText('fixture'), true);
    assert.equal(copied, 'fixture');
    assert.equal(removed, 0);

    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
      clipboard: { async writeText() { throw new Error('denied'); } },
    } });
    assert.equal(await copyText('fixture'), true);
    fallbackResult = false;
    assert.equal(await copyText('fixture'), false);
    fallbackResult = 'throw';
    assert.equal(await copyText('fixture'), false);
    assert.equal(removed, 3);
  } finally {
    if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
