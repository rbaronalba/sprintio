import { BadRequestException } from '@nestjs/common';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Credentials {
  email: string;
  password: string;
}

export function parseCredentials(body: unknown): Credentials {
  const { email, password } = (body ?? {}) as Record<string, unknown>;
  // 254 is the longest address SMTP can deliver to.
  if (typeof email !== 'string' || email.length > 254 || !EMAIL_RE.test(email)) {
    throw new BadRequestException('Invalid email');
  }
  // The cap keeps a megabyte "password" from buying a free scrypt run.
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new BadRequestException('Password must be 8 to 128 characters');
  }
  return { email: email.toLowerCase(), password };
}

export function parseDisplayName(body: unknown): string | null {
  const { displayName } = (body ?? {}) as Record<string, unknown>;
  if (displayName === null) return null;
  if (typeof displayName !== 'string') {
    throw new BadRequestException('displayName must be a string or null');
  }
  const trimmed = displayName.trim();
  if (trimmed.length > 60) {
    throw new BadRequestException('displayName must be at most 60 characters');
  }
  // Empty means "no display name", same as null — one representation in the DB.
  return trimmed || null;
}
