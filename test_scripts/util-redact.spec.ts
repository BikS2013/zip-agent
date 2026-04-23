import { describe, it, expect } from 'vitest';
import { redactString } from '../src/util/redact';

describe('redactString', () => {
  it('redacts api_key=value pairs', () => {
    expect(redactString('debug: api_key=ABCDEFGHIJK')).toMatch(/api_key=\[REDACTED\]/);
  });

  it('redacts Bearer tokens (or the surrounding header)', () => {
    // Either the bearer pattern OR the authorization key=val pattern
    // catches it; both paths must fully redact the token.
    const out = redactString('Authorization: Bearer abcdefghijk1234567');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('abcdefghijk1234567');
  });

  it('redacts sk- prefixed keys', () => {
    expect(redactString('key=sk-proj-ABCDEFGHIJKLMNOPQRSTUV')).toMatch(/\[REDACTED\]/);
  });

  it('redacts JWT-shaped tokens', () => {
    const jwt = 'eyJhbGciOi.eyJzdWIiOiI.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(redactString(`token=${jwt}`)).toContain('[REDACTED]');
  });

  it('redacts long base64-url runs', () => {
    const s = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    expect(redactString(`raw ${s} tail`)).toContain('[REDACTED]');
  });

  it('leaves short strings alone', () => {
    expect(redactString('short tail')).toBe('short tail');
  });
});
