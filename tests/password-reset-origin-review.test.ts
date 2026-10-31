import test from 'node:test';
import assert from 'node:assert/strict';
import { buildZitadelPasswordResetUrlTemplate } from '@/lib/zitadel-login-ui';

test('Password reset origin resolution regression suite (P3-21)', async (t) => {
  await t.test(
    'In development, an incoming http://localhost:3000 origin resolves to the trusted webRedirectUri origin from config',
    () => {
      const originalEnv = {
        NODE_ENV: process.env.NODE_ENV,
        ZITADEL_REDIRECT_URI: process.env.ZITADEL_REDIRECT_URI,
        ZITADEL_ISSUER_URL: process.env.ZITADEL_ISSUER_URL,
      };

      try {
        (process.env as Record<string, string | undefined>).NODE_ENV =
          'development';
        delete process.env.ZITADEL_REDIRECT_URI;
        delete process.env.ZITADEL_ISSUER_URL;

        const trustedRedirectUri = 'https://preview.qlaok.vn/api/auth/callback';
        const result = buildZitadelPasswordResetUrlTemplate(
          'http://localhost:3000',
          {
            issuerUrl: 'https://auth.vunph.click',
            webRedirectUri: trustedRedirectUri,
          }
        );

        assert.equal(
          result,
          'https://preview.qlaok.vn/login?mode=reset&userID={{.UserID}}&code={{.Code}}&orgID={{.OrgID}}'
        );
      } finally {
        for (const [key, value] of Object.entries(originalEnv)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            (process.env as Record<string, string | undefined>)[key] = value;
          }
        }
      }
    }
  );

  await t.test(
    'In production, untrusted caller origin and caller webRedirectUri do not override process.env.ZITADEL_REDIRECT_URI',
    () => {
      const originalEnv = {
        NODE_ENV: process.env.NODE_ENV,
        ZITADEL_REDIRECT_URI: process.env.ZITADEL_REDIRECT_URI,
        ZITADEL_ISSUER_URL: process.env.ZITADEL_ISSUER_URL,
      };

      try {
        (process.env as Record<string, string | undefined>).NODE_ENV =
          'production';
        process.env.ZITADEL_REDIRECT_URI =
          'https://configured.qlaok.test/api/auth/callback';
        delete process.env.ZITADEL_ISSUER_URL;

        const result = buildZitadelPasswordResetUrlTemplate(
          'https://attacker-origin.example.com',
          {
            issuerUrl: 'https://auth.vunph.click',
            webRedirectUri: 'https://phishing-redirect.example.com/callback',
          }
        );

        assert.equal(
          result,
          'https://configured.qlaok.test/login?mode=reset&userID={{.UserID}}&code={{.Code}}&orgID={{.OrgID}}'
        );
      } finally {
        for (const [key, value] of Object.entries(originalEnv)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            (process.env as Record<string, string | undefined>)[key] = value;
          }
        }
      }
    }
  );

  await t.test(
    'Production falls back to https://qlaok.vunph.click when the env redirect URI is invalid or points to the issuer origin',
    () => {
      const originalEnv = {
        NODE_ENV: process.env.NODE_ENV,
        ZITADEL_REDIRECT_URI: process.env.ZITADEL_REDIRECT_URI,
        ZITADEL_ISSUER_URL: process.env.ZITADEL_ISSUER_URL,
      };

      try {
        (process.env as Record<string, string | undefined>).NODE_ENV =
          'production';

        // Subcase 1: Invalid URL in process.env.ZITADEL_REDIRECT_URI
        process.env.ZITADEL_REDIRECT_URI = 'not-a-valid-url';
        delete process.env.ZITADEL_ISSUER_URL;
        const invalidUrlResult = buildZitadelPasswordResetUrlTemplate(
          'https://attacker-origin.example.com',
          {
            issuerUrl: 'https://auth.vunph.click',
            webRedirectUri: 'https://phishing-redirect.example.com/callback',
          }
        );
        assert.equal(
          invalidUrlResult,
          'https://qlaok.vunph.click/login?mode=reset&userID={{.UserID}}&code={{.Code}}&orgID={{.OrgID}}'
        );

        // Subcase 2: Non-http/https protocol in process.env.ZITADEL_REDIRECT_URI
        process.env.ZITADEL_REDIRECT_URI = 'javascript:alert(1)';
        const invalidProtoResult = buildZitadelPasswordResetUrlTemplate(
          'https://attacker-origin.example.com'
        );
        assert.equal(
          invalidProtoResult,
          'https://qlaok.vunph.click/login?mode=reset&userID={{.UserID}}&code={{.Code}}&orgID={{.OrgID}}'
        );

        // Subcase 3: Embedded credentials in process.env.ZITADEL_REDIRECT_URI
        process.env.ZITADEL_REDIRECT_URI =
          'https://user:pass@evil.example.com/callback';
        const credentialResult = buildZitadelPasswordResetUrlTemplate(
          'https://attacker-origin.example.com'
        );
        assert.equal(
          credentialResult,
          'https://qlaok.vunph.click/login?mode=reset&userID={{.UserID}}&code={{.Code}}&orgID={{.OrgID}}'
        );

        // Subcase 4: process.env.ZITADEL_REDIRECT_URI points to the issuer origin
        process.env.ZITADEL_ISSUER_URL = 'https://auth.vunph.click';
        process.env.ZITADEL_REDIRECT_URI =
          'https://auth.vunph.click/api/auth/callback';
        const issuerOriginMatchResult = buildZitadelPasswordResetUrlTemplate(
          'https://attacker-origin.example.com',
          {
            issuerUrl: 'https://auth.vunph.click',
            webRedirectUri: 'https://preview.qlaok.vn/api/auth/callback',
          }
        );
        assert.equal(
          issuerOriginMatchResult,
          'https://qlaok.vunph.click/login?mode=reset&userID={{.UserID}}&code={{.Code}}&orgID={{.OrgID}}'
        );

        // Subcase 5: process.env.ZITADEL_REDIRECT_URI is empty/missing
        delete process.env.ZITADEL_REDIRECT_URI;
        delete process.env.ZITADEL_ISSUER_URL;
        const missingEnvResult = buildZitadelPasswordResetUrlTemplate(
          'https://attacker-origin.example.com'
        );
        assert.equal(
          missingEnvResult,
          'https://qlaok.vunph.click/login?mode=reset&userID={{.UserID}}&code={{.Code}}&orgID={{.OrgID}}'
        );
      } finally {
        for (const [key, value] of Object.entries(originalEnv)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            (process.env as Record<string, string | undefined>)[key] = value;
          }
        }
      }
    }
  );
});
