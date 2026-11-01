import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  issueSessionToken,
  isServerSigningSecretConfigured,
  verifySessionToken,
} from '@/lib/server-auth';

describe('P2-4 server signing secret regression tests', () => {
  const envSnapshot = {
    NODE_ENV: process.env.NODE_ENV,
    SESSION_SECRET: process.env.SESSION_SECRET,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    PAYMENT_WEBHOOK_SECRET: process.env.PAYMENT_WEBHOOK_SECRET,
  };

  const setEnv = (key: string, value: string | undefined) => {
    const env = process.env as Record<string, string | undefined>;
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  };

  const restoreEnv = () => {
    for (const [key, value] of Object.entries(envSnapshot)) {
      setEnv(key, value);
    }
  };

  afterEach(() => {
    restoreEnv();
  });

  it('throws in production when SESSION_SECRET is missing or too short', () => {
    try {
      setEnv('NODE_ENV', 'production');
      delete process.env.SESSION_SECRET;

      // Missing SESSION_SECRET in production causes issuance to throw
      assert.throws(
        () => {
          issueSessionToken({
            id: 'synthetic-prod-user-missing',
            email: 'prod-user-missing@example.com',
            role: 'owner',
          });
        },
        /SESSION_SECRET \(at least 16 characters\) is required in production/
      );

      // Whitespace-only SESSION_SECRET in production causes issuance to throw
      process.env.SESSION_SECRET = '              ';
      assert.throws(
        () => {
          issueSessionToken({
            id: 'synthetic-prod-user-whitespace',
            email: 'prod-user-whitespace@example.com',
            role: 'owner',
          });
        },
        /SESSION_SECRET \(at least 16 characters\) is required in production/
      );

      // Too-short (< 16 chars) SESSION_SECRET in production causes issuance to throw
      process.env.SESSION_SECRET = 'short-secret';
      assert.throws(
        () => {
          issueSessionToken({
            id: 'synthetic-prod-user-short',
            email: 'prod-user-short@example.com',
            role: 'owner',
          });
        },
        /SESSION_SECRET \(at least 16 characters\) is required in production/
      );

      // 15 characters (still < 16 chars)
      process.env.SESSION_SECRET = '123456789012345';
      assert.throws(
        () => {
          issueSessionToken({
            id: 'synthetic-prod-user-15-chars',
            email: 'prod-user-15@example.com',
            role: 'owner',
          });
        },
        /SESSION_SECRET \(at least 16 characters\) is required in production/
      );

      // Valid (>= 16 chars) SESSION_SECRET succeeds in production
      process.env.SESSION_SECRET = 'synthetic-prod-secret-16-chars-min';
      const token = issueSessionToken({
        id: 'synthetic-prod-user-valid',
        email: 'prod-user-valid@example.com',
        role: 'owner',
      });
      assert.ok(typeof token === 'string' && token.length > 0);
      const verified = verifySessionToken(token);
      assert.ok(verified);
      assert.equal(verified?.sub, 'synthetic-prod-user-valid');
      assert.equal(verified?.email, 'prod-user-valid@example.com');
    } finally {
      restoreEnv();
    }
  });

  it('allows dev issue and verify to succeed even after fallback candidate variables change', () => {
    try {
      setEnv('NODE_ENV', 'development');
      delete process.env.SESSION_SECRET;

      // Seed fallback candidates with initial synthetic values
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-role-key-candidate-v1';
      process.env.PAYMENT_WEBHOOK_SECRET = 'synthetic-payment-webhook-secret-candidate-v1';

      const token = issueSessionToken({
        id: 'synthetic-dev-user-id',
        email: 'synthetic-dev-user@example.com',
        role: 'owner',
      });
      assert.ok(typeof token === 'string' && token.length > 0);

      // Mutate both fallback candidate variables
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-role-key-candidate-v2';
      process.env.PAYMENT_WEBHOOK_SECRET = 'synthetic-payment-webhook-secret-candidate-v2';

      // Verification still succeeds because dev uses a process-local random secret, not fallback candidate variables
      const verified = verifySessionToken(token);
      assert.ok(verified);
      assert.equal(verified?.sub, 'synthetic-dev-user-id');
      assert.equal(verified?.email, 'synthetic-dev-user@example.com');

      // Verification still succeeds even when fallback candidates are deleted
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      delete process.env.PAYMENT_WEBHOOK_SECRET;

      const verifiedAfterDelete = verifySessionToken(token);
      assert.ok(verifiedAfterDelete);
      assert.equal(verifiedAfterDelete?.sub, 'synthetic-dev-user-id');
    } finally {
      restoreEnv();
    }
  });

  it('reports isServerSigningSecretConfigured false for fallback candidates and true only for SESSION_SECRET >= 16 chars', () => {
    try {
      delete process.env.SESSION_SECRET;

      // Only fallback candidate variables configured
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service-role-key-candidate';
      process.env.PAYMENT_WEBHOOK_SECRET = 'synthetic-payment-webhook-secret-candidate';
      assert.equal(isServerSigningSecretConfigured(), false);

      // Missing / undefined SESSION_SECRET
      assert.equal(isServerSigningSecretConfigured(), false);

      // Empty string SESSION_SECRET
      process.env.SESSION_SECRET = '';
      assert.equal(isServerSigningSecretConfigured(), false);

      // Whitespace-only SESSION_SECRET
      process.env.SESSION_SECRET = '                ';
      assert.equal(isServerSigningSecretConfigured(), false);

      // Exactly 15 characters (too short)
      process.env.SESSION_SECRET = '123456789012345';
      assert.equal(isServerSigningSecretConfigured(), false);

      // Padded string whose trimmed length is < 16 chars
      process.env.SESSION_SECRET = '   123456789   ';
      assert.equal(isServerSigningSecretConfigured(), false);

      // Exactly 16 characters
      process.env.SESSION_SECRET = '1234567890123456';
      assert.equal(isServerSigningSecretConfigured(), true);

      // Greater than 16 characters
      process.env.SESSION_SECRET = 'synthetic-session-secret-32-chars-long';
      assert.equal(isServerSigningSecretConfigured(), true);
    } finally {
      restoreEnv();
    }
  });
});
