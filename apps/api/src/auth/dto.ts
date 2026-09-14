import { BadRequestException } from '@nestjs/common';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface Credentials {
  email: string;
  password: string;
}

export function parseCredentials(body: unknown): Credentials {
  const { email, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    throw new BadRequestException('Invalid email');
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw new BadRequestException('Password must be at least 8 characters');
  }
  return { email: email.toLowerCase(), password };
}
