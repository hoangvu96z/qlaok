import nodemailer from 'nodemailer';
import {
  type AuthEmailLocale,
  type AuthEmailTemplateKind,
  type RenderedAuthEmail,
  escapeAuthEmailHtml,
  normalizeAuthEmailLocale,
  renderPasswordResetEmail,
  renderRegistrationVerificationEmail,
  resolveTrustedQlaokEmailOrigin,
  sanitizeAuthEmailHeaderValue,
  assertTrustedQlaokEmailUrl,
} from '@/lib/auth-email-templates';

export {
  type AuthEmailLocale,
  type AuthEmailTemplateKind,
  type RenderedAuthEmail,
  escapeAuthEmailHtml,
  normalizeAuthEmailLocale,
  renderPasswordResetEmail,
  renderRegistrationVerificationEmail,
  resolveTrustedQlaokEmailOrigin,
  sanitizeAuthEmailHeaderValue,
  assertTrustedQlaokEmailUrl,
};

export type AuthEmailErrorCode =
  | 'EMAIL_SERVICE_NOT_CONFIGURED'
  | 'EMAIL_DELIVERY_FAILED'
  | 'INVALID_EMAIL_RECIPIENT';

export class AuthEmailError extends Error {
  readonly code: AuthEmailErrorCode;
  readonly status: number;

  constructor(code: AuthEmailErrorCode, status = 503) {
    super(code);
    this.name = 'AuthEmailError';
    this.code = code;
    this.status = status;
  }
}

export interface AuthEmailSmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  auth?: {
    user: string;
    pass: string;
  };
  from: string;
  fromAddress: string;
  fromName: string;
  replyTo?: string;
  timeoutMs: number;
}

export interface AuthEmailSendPayload {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  locale: AuthEmailLocale;
  kind: AuthEmailTemplateKind;
  appUrl: string;
  actionUrl?: string;
  headers: Record<string, string>;
}

export type AuthEmailSendHandler = (
  payload: AuthEmailSendPayload
) => Promise<void>;

export interface NodemailerLikeSendResult {
  messageId?: string;
  accepted?: unknown[];
  rejected?: unknown[];
  pending?: unknown[];
}

export interface NodemailerLikeTransporter {
  sendMail: (mailOptions: {
    from: string;
    to: string;
    replyTo?: string;
    subject: string;
    text: string;
    html: string;
    headers?: Record<string, string>;
  }) => Promise<NodemailerLikeSendResult>;
  close?: () => void;
}

export type NodemailerTransportFactory = (
  config: AuthEmailSmtpConfig
) => NodemailerLikeTransporter;

const EMAIL_ADDRESS_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HOSTNAME_REGEX = /^[A-Za-z0-9.-]+$|^\[[0-9a-fA-F:]+\]$/;
export const DEFAULT_SMTP_TIMEOUT_MS = 10_000;
export const MIN_SMTP_TIMEOUT_MS = 1_000;
export const MAX_SMTP_TIMEOUT_MS = 60_000;
const DEFAULT_FROM_NAME = 'Qlaok — Quét Là OK';

let testEmailSender: AuthEmailSendHandler | null = null;
let testTransportFactory: NodemailerTransportFactory | null = null;

export function setAuthEmailSenderForTests(
  handler: AuthEmailSendHandler | null
): void {
  testEmailSender = handler;
}

export function setNodemailerTransportFactoryForTests(
  factory: NodemailerTransportFactory | null
): void {
  testTransportFactory = factory;
}

export function resetAuthEmailTestHooks(): void {
  testEmailSender = null;
  testTransportFactory = null;
}

function hasControlChars(value: string): boolean {
  return /[\u0000-\u001F\u007F]/.test(value);
}

function isPlaceholderValue(value: string): boolean {
  const lower = value.trim().toLowerCase();
  if (!lower) return true;
  if (
    lower.startsWith('replace-with-') ||
    lower.startsWith('your-') ||
    lower.includes('replace_with_') ||
    lower.includes('your_smtp_') ||
    lower === 'changeme' ||
    lower === 'todo' ||
    lower === 'placeholder' ||
    lower === 'example.com' ||
    lower === 'smtp.example.com' ||
    lower.endsWith('@example.com')
  ) {
    return true;
  }
  return false;
}

function isLoopbackHost(host: string): boolean {
  const lower = host.trim().toLowerCase();
  return (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '::1' ||
    lower === '[::1]'
  );
}

function parseStrictEnvBoolean(
  raw: string | undefined,
  defaultValue: boolean
): boolean {
  if (raw === undefined) return defaultValue;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return defaultValue;
  if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes') {
    return true;
  }
  if (trimmed === 'false' || trimmed === '0' || trimmed === 'no') {
    return false;
  }
  throw new AuthEmailError('EMAIL_SERVICE_NOT_CONFIGURED', 503);
}

function parseFromHeader(
  rawFrom: string,
  rawFromName?: string
): { from: string; fromAddress: string; fromName: string } {
  if (hasControlChars(rawFrom) || (rawFromName && hasControlChars(rawFromName))) {
    throw new AuthEmailError('EMAIL_SERVICE_NOT_CONFIGURED', 503);
  }
  const trimmed = rawFrom.trim();
  if (!trimmed || isPlaceholderValue(trimmed)) {
    throw new AuthEmailError('EMAIL_SERVICE_NOT_CONFIGURED', 503);
  }

  let extractedName = sanitizeAuthEmailHeaderValue(rawFromName || '');
  let extractedAddress = trimmed;

  const angleMatch = trimmed.match(/^(.*?)<\s*([^<>]+)\s*>$/);
  if (angleMatch) {
    const prefixName = angleMatch[1]
      .trim()
      .replace(/^["']+|["']+$/g, '')
      .trim();
    extractedAddress = angleMatch[2].trim();
    if (prefixName && !extractedName) {
      extractedName = sanitizeAuthEmailHeaderValue(prefixName);
    }
  }

  const normalizedAddress = extractedAddress.toLowerCase();
  if (
    !normalizedAddress ||
    normalizedAddress.length > 254 ||
    hasControlChars(normalizedAddress) ||
    !EMAIL_ADDRESS_REGEX.test(normalizedAddress) ||
    isPlaceholderValue(normalizedAddress)
  ) {
    throw new AuthEmailError('EMAIL_SERVICE_NOT_CONFIGURED', 503);
  }

  const finalName = extractedName || DEFAULT_FROM_NAME;
  const safeQuotedName = finalName.replace(/["\\]/g, '').trim() || DEFAULT_FROM_NAME;
  return {
    from: `"${safeQuotedName}" <${normalizedAddress}>`,
    fromAddress: normalizedAddress,
    fromName: safeQuotedName,
  };
}

export function hasForbiddenPublicSmtpEnv(
  env: Record<string, string | undefined> = process.env
): boolean {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const upper = key.toUpperCase();
    if (
      upper.startsWith('NEXT_PUBLIC_SMTP_') ||
      upper.startsWith('EXPO_PUBLIC_SMTP_') ||
      upper.startsWith('NEXT_PUBLIC_AUTH_SMTP_') ||
      upper.startsWith('EXPO_PUBLIC_AUTH_SMTP_')
    ) {
      return true;
    }
  }
  return false;
}

export function resolveAuthEmailSmtpConfig(
  env: Record<string, string | undefined> = process.env
): AuthEmailSmtpConfig {
  if (typeof window !== 'undefined') {
    throw new AuthEmailError('EMAIL_SERVICE_NOT_CONFIGURED', 503);
  }
  if (hasForbiddenPublicSmtpEnv(env)) {
    throw new AuthEmailError('EMAIL_SERVICE_NOT_CONFIGURED', 503);
  }

  const rawHost = (env.SMTP_HOST ?? env.AUTH_SMTP_HOST ?? '').trim();
  if (
    !rawHost ||
    rawHost.length > 253 ||
    hasControlChars(rawHost) ||
    /\s/.test(rawHost) ||
    rawHost.includes('://') ||
    rawHost.includes('/') ||
    !HOSTNAME_REGEX.test(rawHost) ||
    isPlaceholderValue(rawHost)
  ) {
    throw new AuthEmailError('EMAIL_SERVICE_NOT_CONFIGURED', 503);
  }

  const rawSecure = env.SMTP_SECURE ?? env.AUTH_SMTP_SECURE;
  const rawPort = (env.SMTP_PORT ?? env.AUTH_SMTP_PORT ?? '').trim();

  let port: number;
  if (!rawPort) {
    const inferredSecure = parseStrictEnvBoolean(rawSecure, false);
    port = inferredSecure ? 465 : 587;
  } else {
    if (!/^\d+$/.test(rawPort)) {
      throw new AuthEmailError('EMAIL_SERVICE_NOT_CONFIGURED', 503);
    }
    port = Number(rawPort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new AuthEmailError('EMAIL_SERVICE_NOT_CONFIGURED', 503);
    }
  }

  const secure = parseStrictEnvBoolean(rawSecure, port === 465);
  if ((port === 465 && !secure) || (port === 587 && secure)) {
    throw new AuthEmailError('EMAIL_SERVICE_NOT_CONFIGURED', 503);
  }

  const requireTls = parseStrictEnvBoolean(
    env.SMTP_REQUIRE_TLS ?? env.AUTH_SMTP_REQUIRE_TLS,
    !secure && !isLoopbackHost(rawHost)
  );

  const authOptional = parseStrictEnvBoolean(
    env.SMTP_AUTH_OPTIONAL ?? env.AUTH_SMTP_AUTH_OPTIONAL,
    false
  );
  const rawUser = (
    env.SMTP_USER ??
    env.AUTH_SMTP_USER ??
    env.SMTP_USERNAME ??
    ''
  ).trim();
  const rawPass = (
    env.SMTP_PASS ??
    env.AUTH_SMTP_PASS ??
    env.SMTP_PASSWORD ??
    ''
  ).trim();

  let auth: { user: string; pass: string } | undefined;
  if (authOptional && !rawUser && !rawPass) {
    if (env.NODE_ENV === 'production' && !isLoopbackHost(rawHost)) {
      throw new AuthEmailError('EMAIL_SERVICE_NOT_CONFIGURED', 503);
    }
    auth = undefined;
  } else {
    if (
      !rawUser ||
      !rawPass ||
      hasControlChars(rawUser) ||
      hasControlChars(rawPass) ||
      isPlaceholderValue(rawUser) ||
      isPlaceholderValue(rawPass)
    ) {
      throw new AuthEmailError('EMAIL_SERVICE_NOT_CONFIGURED', 503);
    }
    auth = { user: rawUser, pass: rawPass };
  }

  const rawFrom = (
    env.SMTP_FROM ??
    env.SMTP_FROM_EMAIL ??
    env.AUTH_EMAIL_FROM ??
    env.EMAIL_FROM ??
    ''
  ).trim();
  const rawFromName = (
    env.SMTP_FROM_NAME ??
    env.AUTH_EMAIL_FROM_NAME ??
    ''
  ).trim();
  const parsedFrom = parseFromHeader(rawFrom, rawFromName);

  const rawReplyTo = (
    env.SMTP_REPLY_TO ??
    env.AUTH_EMAIL_REPLY_TO ??
    ''
  ).trim();
  let replyTo: string | undefined;
  if (rawReplyTo) {
    if (
      rawReplyTo.length > 254 ||
      hasControlChars(rawReplyTo) ||
      !EMAIL_ADDRESS_REGEX.test(rawReplyTo.toLowerCase()) ||
      isPlaceholderValue(rawReplyTo)
    ) {
      throw new AuthEmailError('EMAIL_SERVICE_NOT_CONFIGURED', 503);
    }
    replyTo = rawReplyTo.toLowerCase();
  }

  const rawTimeout = (
    env.SMTP_TIMEOUT_MS ??
    env.AUTH_SMTP_TIMEOUT_MS ??
    ''
  ).trim();
  let timeoutMs = DEFAULT_SMTP_TIMEOUT_MS;
  if (rawTimeout) {
    if (!/^\d+$/.test(rawTimeout)) {
      throw new AuthEmailError('EMAIL_SERVICE_NOT_CONFIGURED', 503);
    }
    timeoutMs = Number(rawTimeout);
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs < MIN_SMTP_TIMEOUT_MS ||
      timeoutMs > MAX_SMTP_TIMEOUT_MS
    ) {
      throw new AuthEmailError('EMAIL_SERVICE_NOT_CONFIGURED', 503);
    }
  }

  return {
    host: rawHost,
    port,
    secure,
    requireTls,
    auth,
    from: parsedFrom.from,
    fromAddress: parsedFrom.fromAddress,
    fromName: parsedFrom.fromName,
    ...(replyTo ? { replyTo } : {}),
    timeoutMs,
  };
}

export function isAuthEmailConfigured(options?: {
  smtpConfig?: AuthEmailSmtpConfig;
  sendEmail?: AuthEmailSendHandler;
  env?: Record<string, string | undefined>;
}): boolean {
  if (options?.sendEmail || testEmailSender) {
    return true;
  }
  if (options?.smtpConfig) {
    return true;
  }
  try {
    resolveAuthEmailSmtpConfig(options?.env ?? process.env);
    return true;
  } catch {
    return false;
  }
}

export function assertAuthEmailConfigured(options?: {
  smtpConfig?: AuthEmailSmtpConfig;
  sendEmail?: AuthEmailSendHandler;
  env?: Record<string, string | undefined>;
}): void {
  if (options?.sendEmail || testEmailSender) {
    return;
  }
  if (options?.smtpConfig) {
    return;
  }
  resolveAuthEmailSmtpConfig(options?.env ?? process.env);
}

function createDefaultNodemailerTransporter(
  config: AuthEmailSmtpConfig
): NodemailerLikeTransporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    ...(config.auth ? { auth: config.auth } : {}),
    connectionTimeout: config.timeoutMs,
    greetingTimeout: config.timeoutMs,
    socketTimeout: config.timeoutMs,
    dnsTimeout: config.timeoutMs,
  });
}

export async function sendAuthEmail(params: {
  to: string;
  rendered: RenderedAuthEmail;
  smtpConfig?: AuthEmailSmtpConfig;
  sendEmail?: AuthEmailSendHandler;
  transportFactory?: NodemailerTransportFactory;
  env?: Record<string, string | undefined>;
}): Promise<void> {
  if (typeof window !== 'undefined') {
    throw new AuthEmailError('EMAIL_SERVICE_NOT_CONFIGURED', 503);
  }

  const rawTo = String(params.to || '').trim().toLowerCase();
  if (
    !rawTo ||
    rawTo.length > 254 ||
    hasControlChars(rawTo) ||
    !EMAIL_ADDRESS_REGEX.test(rawTo)
  ) {
    throw new AuthEmailError('INVALID_EMAIL_RECIPIENT', 400);
  }

  const headers: Record<string, string> = {
    'Auto-Submitted': 'auto-generated',
    'X-Auto-Response-Suppress': 'All',
    'X-Qlaok-Email-Kind': params.rendered.kind,
  };

  const customSender = params.sendEmail ?? testEmailSender;
  if (customSender) {
    const fallbackFrom =
      params.smtpConfig?.from ??
      `"${DEFAULT_FROM_NAME}" <no-reply@qlaok.vunph.click>`;
    const payload: AuthEmailSendPayload = {
      to: rawTo,
      from: fallbackFrom,
      ...(params.smtpConfig?.replyTo
        ? { replyTo: params.smtpConfig.replyTo }
        : {}),
      subject: params.rendered.subject,
      html: params.rendered.html,
      text: params.rendered.text,
      locale: params.rendered.locale,
      kind: params.rendered.kind,
      appUrl: params.rendered.appUrl,
      ...(params.rendered.actionUrl
        ? { actionUrl: params.rendered.actionUrl }
        : {}),
      headers,
    };
    try {
      await customSender(payload);
      return;
    } catch (err) {
      if (err instanceof AuthEmailError) {
        throw err;
      }
      throw new AuthEmailError('EMAIL_DELIVERY_FAILED', 503);
    }
  }

  const smtpConfig =
    params.smtpConfig ?? resolveAuthEmailSmtpConfig(params.env ?? process.env);
  const factory =
    params.transportFactory ??
    testTransportFactory ??
    createDefaultNodemailerTransporter;

  let transporter: NodemailerLikeTransporter;
  try {
    transporter = factory(smtpConfig);
  } catch {
    throw new AuthEmailError('EMAIL_SERVICE_NOT_CONFIGURED', 503);
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const sendPromise = transporter.sendMail({
      from: smtpConfig.from,
      to: rawTo,
      ...(smtpConfig.replyTo ? { replyTo: smtpConfig.replyTo } : {}),
      subject: params.rendered.subject,
      text: params.rendered.text,
      html: params.rendered.html,
      headers,
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new AuthEmailError('EMAIL_DELIVERY_FAILED', 503));
      }, smtpConfig.timeoutMs);
    });

    const result = await Promise.race([sendPromise, timeoutPromise]);
    if (
      (Array.isArray(result?.rejected) && result.rejected.length > 0) ||
      (Array.isArray(result?.accepted) && result.accepted.length === 0)
    ) {
      throw new AuthEmailError('EMAIL_DELIVERY_FAILED', 503);
    }
  } catch (err) {
    if (err instanceof AuthEmailError) {
      throw err;
    }
    throw new AuthEmailError('EMAIL_DELIVERY_FAILED', 503);
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
    try {
      transporter.close?.();
    } catch {
      // ignore close errors
    }
  }
}

export async function sendQlaokRegistrationVerificationEmail(params: {
  to: string;
  fullName?: string;
  verificationCode: string;
  lang?: AuthEmailLocale | string;
  origin?: string;
  isResend?: boolean;
  issuerUrl?: string;
  webRedirectUri?: string;
  smtpConfig?: AuthEmailSmtpConfig;
  sendEmail?: AuthEmailSendHandler;
  transportFactory?: NodemailerTransportFactory;
  env?: Record<string, string | undefined>;
}): Promise<RenderedAuthEmail> {
  assertAuthEmailConfigured({
    smtpConfig: params.smtpConfig,
    sendEmail: params.sendEmail,
    env: params.env,
  });

  let rendered: RenderedAuthEmail;
  try {
    rendered = renderRegistrationVerificationEmail({
      email: params.to,
      fullName: params.fullName,
      verificationCode: params.verificationCode,
      lang: params.lang,
      origin: params.origin,
      isResend: params.isResend,
      issuerUrl: params.issuerUrl,
      webRedirectUri: params.webRedirectUri,
    });
  } catch {
    throw new AuthEmailError('EMAIL_DELIVERY_FAILED', 503);
  }

  await sendAuthEmail({
    to: params.to,
    rendered,
    smtpConfig: params.smtpConfig,
    sendEmail: params.sendEmail,
    transportFactory: params.transportFactory,
    env: params.env,
  });

  return rendered;
}

export async function sendQlaokPasswordResetEmail(params: {
  to: string;
  displayName?: string;
  resetUrl: string;
  lang?: AuthEmailLocale | string;
  origin?: string;
  issuerUrl?: string;
  webRedirectUri?: string;
  smtpConfig?: AuthEmailSmtpConfig;
  sendEmail?: AuthEmailSendHandler;
  transportFactory?: NodemailerTransportFactory;
  env?: Record<string, string | undefined>;
}): Promise<RenderedAuthEmail> {
  assertAuthEmailConfigured({
    smtpConfig: params.smtpConfig,
    sendEmail: params.sendEmail,
    env: params.env,
  });

  let rendered: RenderedAuthEmail;
  try {
    rendered = renderPasswordResetEmail({
      email: params.to,
      displayName: params.displayName,
      resetUrl: params.resetUrl,
      lang: params.lang,
      origin: params.origin,
      issuerUrl: params.issuerUrl,
      webRedirectUri: params.webRedirectUri,
    });
  } catch {
    throw new AuthEmailError('EMAIL_DELIVERY_FAILED', 503);
  }

  await sendAuthEmail({
    to: params.to,
    rendered,
    smtpConfig: params.smtpConfig,
    sendEmail: params.sendEmail,
    transportFactory: params.transportFactory,
    env: params.env,
  });

  return rendered;
}
