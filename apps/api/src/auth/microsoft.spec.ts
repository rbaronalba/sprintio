import { describe, expect, it } from 'vitest';
import { authorizeUrl, microsoftConfig, newOAuthState, validateClaims } from './microsoft.js';
import { cfg, claimsWith, tenant } from '../../test/support/microsoft.fixtures.js';

describe('microsoft sign-in', () => {
  it('is off when unconfigured and refuses a half or multi-tenant setup', () => {
    expect(microsoftConfig({})).toBeNull();
    expect(() => microsoftConfig({ MICROSOFT_CLIENT_ID: 'x' })).toThrow();
    expect(() =>
      microsoftConfig({ MICROSOFT_CLIENT_ID: 'x', MICROSOFT_CLIENT_SECRET: 'y', MICROSOFT_TENANT_ID: 'common' }),
    ).toThrow();
  });

  it('builds a PKCE authorize URL for the company tenant', () => {
    const url = new URL(authorizeUrl(cfg, newOAuthState()));
    expect(url.pathname).toBe(`/${tenant}/oauth2/v2.0/authorize`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('https://sprintio.test/auth/microsoft/callback');
  });

  it('accepts a valid token and normalises the email', () => {
    expect(validateClaims(claimsWith(), cfg, 'n1')).toEqual({ oid: 'oid-1', email: 'ana@company.com', name: 'Ana Lopez' });
  });

  it.each([
    ['another tenant', { tid: '99999999-2222-3333-4444-555555555555' }],
    ['another issuer', { iss: 'https://evil.test/v2.0' }],
    ['another app', { aud: 'client-2' }],
    ['a nonce from another attempt', { nonce: 'n2' }],
    ['an expired token', { exp: 1 }],
    ['no usable email', { preferred_username: 'no-at-sign' }],
  ])('rejects %s', (_, patch) => {
    expect(() => validateClaims(claimsWith(patch), cfg, 'n1')).toThrow(/Rejected/);
  });
});
