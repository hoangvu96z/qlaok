import test from 'node:test';
import assert from 'node:assert/strict';
import { escapePostgrestIlikePattern } from '@/lib/owner-invitations';

test('escapePostgrestIlikePattern makes email wildcard characters literal', () => {
  assert.equal(
    escapePostgrestIlikePattern('staff%@example.com'),
    'staff\\%@example.com'
  );
  assert.equal(
    escapePostgrestIlikePattern('staff_@example.com'),
    'staff\\_@example.com'
  );
  assert.equal(
    escapePostgrestIlikePattern('staff\\@example.com'),
    'staff\\\\@example.com'
  );
});
