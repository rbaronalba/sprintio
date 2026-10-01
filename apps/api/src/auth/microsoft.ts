import { createHash, randomBytes } from 'node:crypto';

/**
 * "Sign in with Microsoft": OpenID Connect authorization code flow with PKCE against
 * Microsoft Entra ID, done server-side with plain fetch.
 *
 * Pinned to ONE tenant (the company's). That is what makes it safe to link a Microsoft
 * sign-in to an existing account by email: with a multi-tenant app, anyone could create
 * their own tenant, put your address on a user there, and sign in as you.
 */
export interface MicrosoftConfig {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  redirectUri: string;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Null when not configured (the button is hidden). Half-configured = refuse to boot. */
export function microsoftConfig(env: Record<string, string | undefined> = process.env): MicrosoftConfig | null {
  const { MICROSOFT_CLIENT_ID: clientId, MICROSOFT_CLIENT_SECRET: clientSecret, MICROSOFT_TENANT_ID: tenantId } = env;
  if (!clientId && !clientSecret && !tenantId) return null;
  if (!clientId || !clientSecret || !tenantId) {
    throw new Error('MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET and MICROSOFT_TENANT_ID must be set together');
  }
  if (!GUID.test(tenantId)) {
    // 'common' / 'organizations' would accept any tenant: see the note at the top.
    throw new Error('MICROSOFT_TENANT_ID must be your directory (tenant) id, not common/organizations');
  }
  // Through the web origin: nginx proxies /auth/ to the api, so cookies land on the app's own site.
  return { clientId, clientSecret, tenantId, redirectUri: `${env.WEB_ORIGIN}/auth/microsoft/callback` };
}

const b64url = (buf: Buffer) => buf.toString('base64url');

/** What the browser carries (in a short-lived signed cookie) from the redirect to the callback. */
export interface OAuthState {
  state: string;
  nonce: string;
  verifier: string;
}

export function newOAuthState(): OAuthState {
  return { state: b64url(randomBytes(16)), nonce: b64url(randomBytes(16)), verifier: b64url(randomBytes(32)) };
}

export function authorizeUrl(cfg: MicrosoftConfig, s: OAuthState): string {
  const url = new URL(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: cfg.redirectUri,
    response_mode: 'query',
    scope: 'openid profile email',
    state: s.state,
    nonce: s.nonce,
    code_challenge: b64url(createHash('sha256').update(s.verifier).digest()),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return url.toString();
}

/** Trades the code for tokens and returns the id_token's claims, not yet validated (see validateClaims). */
export async function exchangeCode(cfg: MicrosoftConfig, code: string, verifier: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
      code_verifier: verifier,
      scope: 'openid profile email',
    }),
  });
  if (!res.ok) throw new Error(`Token endpoint answered ${res.status}`);
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error('No id_token in token response');
  return JSON.parse(Buffer.from(id_token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
}

export interface MicrosoftIdentity {
  oid: string;
  email: string;
  name: string | null;
}

/**
 * The id_token came straight from Microsoft's token endpoint over TLS, authenticated with
 * our client secret, so per OIDC Core 3.1.3.7 TLS stands in for the signature check.
 * Everything else is still checked: issuer, audience, tenant, nonce, expiry.
 */
export function validateClaims(
  claims: Record<string, unknown>,
  cfg: MicrosoftConfig,
  nonce: string,
  now = Date.now(),
): MicrosoftIdentity {
  const reject = (why: string): never => {
    throw new Error(`Rejected id_token: ${why}`);
  };
  if (claims.iss !== `https://login.microsoftonline.com/${cfg.tenantId}/v2.0`) reject('issuer');
  if (claims.aud !== cfg.clientId) reject('audience');
  if (claims.tid !== cfg.tenantId) reject('tenant');
  if (claims.nonce !== nonce) reject('nonce');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now) reject('expired');
  if (typeof claims.oid !== 'string') reject('no oid');
  // `email` is only there when the directory has a mail address; the UPN is the fallback.
  const email =
    [claims.email, claims.preferred_username].find((v): v is string => typeof v === 'string' && v.includes('@')) ??
    reject('no email');
  const name = typeof claims.name === 'string' ? claims.name.trim().slice(0, 60) : '';
  return { oid: claims.oid as string, email: email.toLowerCase(), name: name || null };
}
