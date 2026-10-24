import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALLOWED_STAFF_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  OWNER_ONLY_SHOP_PERMISSIONS,
  STAFF_ACCOUNT_ROLES,
} from '../src/lib/shop-permissions';

const read = (rel: string) => fs.readFileSync(path.resolve(rel), 'utf8');

describe('ShopMembersManager — Owner-managed username/password staff accounts UI contracts', () => {
  const componentSource = read('src/components/dashboard/ShopMembersManager.tsx');

  it('1. Roles: ASSIGNABLE_STAFF_ROLES only allows cashier and staff, never owner or admin', () => {
    assert.match(
      componentSource,
      /export const ASSIGNABLE_STAFF_ROLES:\s*Array<'cashier'\s*\|\s*'staff'>\s*=\s*\[\s*'cashier',\s*'staff',?\s*\];/
    );
    assert.match(
      componentSource,
      /const ASSIGNABLE_STAFF_ROLES/
    );

    // Verify against backend STAFF_ACCOUNT_ROLES
    assert.deepEqual(STAFF_ACCOUNT_ROLES, ['cashier', 'staff']);
  });

  it('2. Permissions: ALLOWED_STAFF_PERMISSIONS in component matches backend and strictly excludes members.manage', () => {
    // Verify backend excludes owner-only permissions
    for (const ownerPerm of OWNER_ONLY_SHOP_PERMISSIONS) {
      assert.equal(
        ALLOWED_STAFF_PERMISSIONS.includes(ownerPerm),
        false,
        `Owner permission ${ownerPerm} must not be allowed for staff`
      );
    }
    assert.equal(ALLOWED_STAFF_PERMISSIONS.includes('members.manage'), false);

    // Verify ALLOWED_STAFF_PERMISSIONS array definition in component excludes members.manage
    const allowedPermsMatch = componentSource.match(
      /export const ALLOWED_STAFF_PERMISSIONS:\s*ShopPermission\[\]\s*=\s*\[([\s\S]*?)\];/
    );
    assert.ok(allowedPermsMatch, 'ALLOWED_STAFF_PERMISSIONS must be defined');
    const allowedPermsBlock = allowedPermsMatch[1];
    assert.equal(
      allowedPermsBlock.includes('members.manage'),
      false,
      'ShopMembersManager ALLOWED_STAFF_PERMISSIONS must never include members.manage'
    );

    // Verify all 17 allowed staff permissions are listed in component
    for (const perm of ALLOWED_STAFF_PERMISSIONS) {
      assert.ok(
        componentSource.includes(`'${perm}'`),
        `Component must include allowed permission ${perm}`
      );
    }
  });

  it('3. Default presets: Cashier and Staff presets include orders.create for mobile table ordering', () => {
    assert.ok(
      DEFAULT_ROLE_PERMISSIONS.cashier.includes('orders.create'),
      'Cashier role must include orders.create'
    );
    assert.ok(
      DEFAULT_ROLE_PERMISSIONS.staff.includes('orders.create'),
      'Staff role must include orders.create'
    );

    // Check component defines DEFAULT_STAFF_ROLE_PERMISSIONS matching backend
    assert.match(componentSource, /export const DEFAULT_STAFF_ROLE_PERMISSIONS/);
  });

  it('4. Form controls safety: EVERY button has type="button" and inputs intercept Enter key', () => {
    const buttonTags = componentSource.match(/<button[\s\S]*?>/g) || [];
    assert.ok(buttonTags.length >= 10, 'Expected at least 10 buttons in UI');

    for (const tag of buttonTags) {
      assert.ok(
        tag.includes('type="button"'),
        `Every button inside settings form must explicitly have type="button": ${tag}`
      );
    }

    // Verify Enter key interception pattern on inputs
    const enterHandlers = componentSource.match(/e\.key === 'Enter'/g) || [];
    assert.ok(
      enterHandlers.length >= 4,
      'Must intercept Enter on username, password, fullname, and reset password inputs'
    );
    assert.ok(
      componentSource.includes('e.preventDefault()'),
      'Must prevent default form submission on Enter'
    );
  });

  it('5. API Actions: All four required backend actions are wired with correct payloads', () => {
    // 1. create_staff_member
    assert.match(
      componentSource,
      /action:\s*['"]create_staff_member['"]/
    );
    assert.match(componentSource, /username:\s*cleanUsername/);
    assert.match(componentSource, /password:\s*newPassword/);

    // 2. update_staff_member
    assert.match(
      componentSource,
      /action:\s*actionName/
    );
    assert.match(
      componentSource,
      /const actionName = isStaff \? 'update_staff_member' : 'upsert_member'/
    );

    // 3. reset_staff_password
    assert.match(
      componentSource,
      /action:\s*['"]reset_staff_password['"]/
    );
    assert.match(componentSource, /new_password:\s*resetPassword/);

    // 4. delete_staff_member
    assert.match(
      componentSource,
      /const actionName = isStaff \? 'delete_staff_member' : 'delete_member'/
    );

    // Memberships query
    assert.match(
      componentSource,
      /\/api\/shops\?action=memberships&shopId=/
    );
  });

  it('6. Validation & Security: Username 3-32 regex, password length bounds, and zero exposed hashes', () => {
    // Username regex: ^[a-z0-9._-]{3,32}$
    assert.match(
      componentSource,
      /export const STAFF_USERNAME_REGEX = \/\^\[a-z0-9\._-\]\{3,32\}\$\/;/
    );

    // Password length constants
    assert.match(
      componentSource,
      /export const MIN_STAFF_PASSWORD_LEN = 6;/
    );
    assert.match(
      componentSource,
      /export const MAX_STAFF_PASSWORD_LEN = 128;/
    );

    // Zero secret/hash display
    assert.equal(
      componentSource.includes('password_hash'),
      false,
      'Password hashes must never be referenced or displayed in UI'
    );

    // Auto-correction turned off on username inputs
    assert.match(
      componentSource,
      /autoCorrect="off"/
    );
    assert.match(
      componentSource,
      /autoCapitalize="off"/
    );
    assert.match(
      componentSource,
      /spellCheck="false"/
    );
  });

  it('7. UX & Accessibility: Dialogs use role="dialog", aria-modal="true", and test IDs exist', () => {
    // Dialog semantics
    assert.match(componentSource, /role="dialog"/);
    assert.match(componentSource, /aria-modal="true"/);

    // Required test IDs
    const requiredTestIds = [
      'shop-members-manager',
      'create-staff-username',
      'create-staff-password',
      'create-staff-fullname',
      'create-staff-submit',
      'toggle-create-permissions',
      'reset-create-permissions',
      'shop-members-list',
      'confirm-reset-password',
      'confirm-delete-member',
      'save-edit-member',
      'toggle-legacy-invite',
      'shop-members-invite',
    ];

    for (const testId of requiredTestIds) {
      assert.ok(
        componentSource.includes(`data-testid="${testId}"`),
        `Component must include testid: ${testId}`
      );
    }
  });

  it('8. Client state rollback: displayed membership state is NOT mutated on API failures', () => {
    // Ensure optimistic local mutations without API response are absent;
    // state reload or update only happens after successful await postMemberAction(...)
    assert.match(
      componentSource,
      /await postMemberAction\([\s\S]*?\);\s*[\s\S]*?await loadMembers\(\);/
    );
  });
});
