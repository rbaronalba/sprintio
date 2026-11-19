import { microsoftConfig } from '../../src/auth/microsoft.js';

export const tenant = '11111111-2222-3333-4444-555555555555';

export const cfg = microsoftConfig({
  MICROSOFT_CLIENT_ID: 'client-1',
  MICROSOFT_CLIENT_SECRET: 'secret',
  MICROSOFT_TENANT_ID: tenant,
  WEB_ORIGIN: 'https://sprintio.test',
})!;

/** Claims of a token that passes validation, with `patch` applied on top. */
export function claimsWith(patch: Record<string, unknown> = {}) {
  return {
    iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
    aud: 'client-1',
    tid: tenant,
    nonce: 'n1',
    exp: Math.floor(Date.now() / 1000) + 600,
    oid: 'oid-1',
    preferred_username: 'Ana@Company.com',
    name: 'Ana Lopez',
    ...patch,
  };
}
