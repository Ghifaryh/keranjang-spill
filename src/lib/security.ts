import crypto from 'node:crypto';

const PLACEHOLDER_SECRETS = new Set([
  'xxxxxx',
  'your_random_secret_token_here',
  'super_secret_sync_key',
  'changeme',
  'secret',
]);

/**
 * Checks whether a secret environment variable is set to a real, non-placeholder value.
 */
export function isConfiguredSecret(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return !PLACEHOLDER_SECRETS.has(trimmed.toLowerCase());
}

/**
 * Constant-time string comparison to prevent timing side-channel attacks on secrets.
 */
export function timingSafeEqualStr(provided: string | undefined | null, expected: string): boolean {
  if (!provided || !expected) return false;
  const bufA = Buffer.from(provided, 'utf-8');
  const bufB = Buffer.from(expected, 'utf-8');
  if (bufA.length !== bufB.length) {
    // Compare bufB against itself to keep execution time consistent before returning false
    crypto.timingSafeEqual(bufB, bufB);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Validates that a URL uses http: or https: and never embeds a Telegram bot token.
 * Returns an empty string if invalid or unsafe.
 */
export function sanitizeHttpUrl(rawUrl: string | undefined | null): string {
  if (!rawUrl) return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    // Never allow Telegram bot file URLs containing bot tokens to be persisted or rendered
    if (
      parsed.hostname.toLowerCase() === 'api.telegram.org' &&
      /\/bot[^/]+/i.test(parsed.pathname)
    ) {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

/**
 * Validates product image URLs: allows internal `/api/tg-photo/<fileId>` proxy paths
 * or safe external http(s) URLs (explicitly blocking Telegram bot token URLs).
 */
export function sanitizeImageUrl(rawUrl: string | undefined | null): string {
  if (!rawUrl) return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  if (/^\/api\/tg-photo\/[A-Za-z0-9_-]{5,256}$/.test(trimmed)) {
    return trimmed;
  }

  return sanitizeHttpUrl(trimmed);
}

