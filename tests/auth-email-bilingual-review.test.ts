import assert from 'node:assert/strict';
import test from 'node:test';
import {
  renderPasswordResetEmail,
  renderRegistrationVerificationEmail,
} from '../src/lib/auth-email-templates';

const origin = 'https://qlaok.vunph.click';
const issuerUrl = 'https://auth.vunph.click';
const code = 'TEST92';
const resetUrl = `${origin}/login?mode=reset&userID=123456&code=${code}`;

for (const lang of ['vi', 'en'] as const) {
  for (const isResend of [false, true]) {
    test(`registration ${isResend ? 'resend' : 'verification'} email is bilingual (${lang})`, () => {
      const mail = renderRegistrationVerificationEmail({
        email: 'owner@example.test',
        fullName: '<script>alert(1)</script>',
        verificationCode: code,
        isResend,
        lang,
        origin,
        issuerUrl,
      });

      assert.match(mail.subject, /xác thực/i);
      assert.match(mail.subject, /verif/i);
      assert.match(mail.html, /<title>[^<]*xác thực[^<]*verif/i);
      assert.match(mail.html, /<img[^>]+src="https:\/\/qlaok\.vunph\.click\/brand\/icon-192\.png"/);
      assert.match(mail.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
      assert.doesNotMatch(mail.html, /<script>/);
      for (const body of [mail.html, mail.text]) {
        assert.match(body, /quay lại màn hình đăng ký đang mở/i);
        assert.match(body, /return to the registration screen you already have open/i);
        assert.ok(body.includes(code));
        assert.doesNotMatch(body, /auth\.vunph\.click/);
      }
      const preheader = mail.html.match(/<div style="display:none;[^>]*>(.*?)<\/div>/s)?.[1];
      assert.ok(preheader, 'a preheader is present');
      assert.ok(!preheader.includes(code), 'the preheader must not reveal the code');
      assert.doesNotMatch(mail.html, /href=/);
    });
  }

  test(`password reset email is bilingual and links to Qlaok (${lang})`, () => {
    const mail = renderPasswordResetEmail({
      email: 'owner@example.test',
      displayName: '<script>alert(1)</script>',
      resetUrl,
      lang,
      origin,
      issuerUrl,
    });
    assert.match(mail.subject, /đặt lại mật khẩu/i);
    assert.match(mail.subject, /reset your password/i);
    assert.match(mail.html, /<title>[^<]*đặt lại mật khẩu[^<]*reset your password/i);
    assert.match(mail.html, /<img[^>]+src="https:\/\/qlaok\.vunph\.click\/brand\/icon-192\.png"/);
    assert.match(mail.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(mail.html, /<script>/);
    for (const body of [mail.html, mail.text]) {
      assert.match(body, /đặt lại mật khẩu/i);
      assert.match(body, /reset the password/i);
      assert.doesNotMatch(body, /auth\.vunph\.click/);
    }
    assert.equal(mail.actionUrl, resetUrl);
    assert.ok(mail.html.includes(resetUrl.replaceAll('&', '&amp;')));
    assert.ok(mail.text.includes(resetUrl));
    const preheader = mail.html.match(/<div style="display:none;[^>]*>(.*?)<\/div>/s)?.[1];
    assert.ok(preheader);
    assert.ok(!preheader.includes(code));
  });
}

test('password reset email rejects a link on another origin', () => {
  assert.throws(() => renderPasswordResetEmail({
    email: 'owner@example.test',
    resetUrl: `https://attacker.example/login?mode=reset&userID=123456&code=${code}`,
    origin,
    issuerUrl,
  }), /UNTRUSTED_EMAIL_URL/);
});
