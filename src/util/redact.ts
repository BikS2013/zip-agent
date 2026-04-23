/**
 * Redact secrets from any string before it reaches stderr or a log file.
 * Patterns: explicit `key=value` / `key: value` for known secret-like keys,
 * Bearer tokens, JWT-shaped strings, long base64-url runs, and OpenAI/
 * Anthropic key prefixes.
 */
const SECRET_KEY_NAMES = [
  'api[_-]?key',
  'apikey',
  'access[_-]?key',
  'secret[_-]?key',
  'session[_-]?token',
  'auth[_-]?token',
  'authorization',
  'password',
  'pwd',
  'token',
];

const KV_PATTERN = new RegExp(
  `\\b(${SECRET_KEY_NAMES.join('|')})\\b\\s*[=:]\\s*['"]?([^\\s'",;}]{4,})['"]?`,
  'gi',
);

const BEARER_PATTERN = /(bearer\s+)([A-Za-z0-9._\-]{8,})/gi;

// JWT-shaped: 3 dot-separated base64url segments, each ≥ 4 chars.
const JWT_PATTERN = /\b([A-Za-z0-9_\-]{4,})\.([A-Za-z0-9_\-]{4,})\.([A-Za-z0-9_\-]{4,})\b/g;

// Common provider key prefixes.
const PROVIDER_KEY_PATTERN =
  /\b(sk-(?:proj-|live-|test-|ant-|or-)?[A-Za-z0-9_\-]{16,}|sk-[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_\-]{20,}|xoxp-[A-Za-z0-9-]{12,})\b/g;

// Long base64-url runs (40+ chars) that aren't already redacted.
const LONG_B64_PATTERN = /\b([A-Za-z0-9_\-]{40,})\b/g;

const REDACTED = '[REDACTED]';

export function redactString(input: string): string {
  if (!input) return input;
  let out = input;
  // Order matters: redact specific high-confidence patterns first so
  // the KV-pattern match (which consumes only up to the next space)
  // can't leave a trailing secret behind.
  out = out.replace(BEARER_PATTERN, (_m, prefix) => `${prefix}${REDACTED}`);
  out = out.replace(JWT_PATTERN, REDACTED);
  out = out.replace(PROVIDER_KEY_PATTERN, REDACTED);
  out = out.replace(KV_PATTERN, (_m, k) => `${k}=${REDACTED}`);
  out = out.replace(LONG_B64_PATTERN, (m) => (m === REDACTED ? m : REDACTED));
  return out;
}
