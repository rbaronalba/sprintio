import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// OWASP's scrypt floor: N=2^17, r=8, p=1. That costs 128 MiB per hash (128·N·r), above
// Node's 32 MiB default maxmem, hence the explicit ceiling.
const PARAMS = { N: 2 ** 17, r: 8, p: 1 };
const KEY_LEN = 64;

function derive(password: string, salt: string, params: { N: number; r: number; p: number }) {
  const options: ScryptOptions = { ...params, maxmem: 256 * params.N * params.r };
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, KEY_LEN, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** `scrypt$N$r$p$salt$hash`: the cost travels with the hash, so it can be raised later without guessing. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, PARAMS);
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt}$${key.toString('hex')}`;
}

/** Hashes from before the parameters were stored (`salt:hash`, Node's defaults) still verify. */
function parse(stored: string) {
  const parts = stored.split('$');
  if (parts.length === 6 && parts[0] === 'scrypt') {
    const [, N, r, p, salt, hash] = parts;
    return { params: { N: Number(N), r: Number(r), p: Number(p) }, salt, hash };
  }
  const [salt, hash] = stored.split(':');
  return { params: { N: 16384, r: 8, p: 1 }, salt, hash };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const { params, salt, hash } = parse(stored);
  if (!salt || !hash) return false;
  const key = await derive(password, salt, params);
  const expected = Buffer.from(hash, 'hex');
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** True when the stored hash was made with weaker parameters than we use today. */
export function needsRehash(stored: string): boolean {
  const { params } = parse(stored);
  return params.N !== PARAMS.N || params.r !== PARAMS.r || params.p !== PARAMS.p;
}
