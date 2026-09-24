import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Role, User } from '../generated/prisma/client.js';
import { hashPassword, needsRehash, verifyPassword } from './password.util.js';

// Every token we mint carries an audience, and every verifier demands the one it expects.
// Without this all three are interchangeable bearer tokens: a refresh cookie or a
// 60s SSE ticket would sail through JwtAuthGuard and act as a full access token.
export const ACCESS_AUDIENCE = 'sprintio:access';
export const REFRESH_AUDIENCE = 'sprintio:refresh';
export const STREAM_AUDIENCE = 'sprintio:stream';
// Pinned on both ends so a token can never pick its own verification algorithm.
export const JWT_ALGORITHM = 'HS256';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}

export interface RefreshPayload {
  sub: string;
  /** The Session row this token belongs to: one per signed-in device. */
  sid: string;
  // Makes every issued refresh token unique: `iat` only has second resolution,
  // so two tokens minted in the same second would otherwise be identical.
  jti: string;
}

/**
 * The profile the client renders. displayName is deliberately NOT in the JWT:
 * a token minted before a rename would keep serving the stale name for 15 minutes.
 */
export type AuthUser = JwtPayload & { displayName: string | null };

export interface AuthResult {
  accessToken: string;
  /** Null when the cookie the client already holds is still the current one. */
  refreshToken: string | null;
  user: AuthUser;
}

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Two tabs share one cookie jar: if both refresh at once, the loser presents the token the
// winner just rotated out. Within this window that is a race, not a replay.
const ROTATION_GRACE_MS = 10_000;

// Login always runs scrypt, even for an unknown email, so response time does not reveal
// which emails have accounts.
const DUMMY_HASH = await hashPassword('dummy-password-for-timing');

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async register(email: string, password: string): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await hashPassword(password);
    const user = await this.prisma.user.create({ data: { email, passwordHash } });
    return this.startSession(user);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw new UnauthorizedException('Invalid credentials');

    // The only moment we hold the plaintext: upgrade hashes made with older parameters.
    if (needsRehash(user.passwordHash)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(password) },
      });
    }
    return this.startSession(user);
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    const payload = await this.verifyRefresh(refreshToken);

    const session = await this.prisma.session.findUnique({ where: { id: payload.sid } });
    if (!session || session.userId !== payload.sub) {
      throw new UnauthorizedException('No active session');
    }
    if (session.expiresAt < new Date()) {
      await this.prisma.session.deleteMany({ where: { id: session.id } });
      throw new UnauthorizedException('Refresh token expired');
    }
    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) throw new UnauthorizedException('Account no longer exists');

    const presented = hashToken(refreshToken);
    const { token, hash } = await this.signRefresh(user.id, session.id);
    // Conditional on the hash still being current, so two concurrent refreshes cannot
    // both rotate: exactly one wins, the other falls through to the grace check.
    const rotated = await this.prisma.session.updateMany({
      where: { id: session.id, tokenHash: presented },
      data: {
        tokenHash: hash,
        prevTokenHash: presented,
        rotatedAt: new Date(),
        // Sliding: a device in use stays signed in; one idle for the TTL does not.
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    if (rotated.count === 1) return this.result(user, token);

    const current = await this.prisma.session.findUnique({ where: { id: session.id } });
    const graceful =
      current?.prevTokenHash === presented &&
      current.rotatedAt !== null &&
      Date.now() - current.rotatedAt.getTime() < ROTATION_GRACE_MS;
    // The winner's Set-Cookie is already on its way to this same browser: hand out an
    // access token only and leave the cookie alone.
    if (graceful) return this.result(user, null);

    // A rotated-out token outside the grace window was replayed: kill this device's session.
    await this.prisma.session.deleteMany({ where: { id: session.id } });
    throw new UnauthorizedException('Invalid refresh token');
  }

  /** Signs out the device holding this cookie. Other devices stay signed in. */
  async logout(userId: string, refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const payload = await this.verifyRefresh(refreshToken).catch(() => null);
    if (payload) await this.prisma.session.deleteMany({ where: { id: payload.sid, userId } });
  }

  private async verifyRefresh(refreshToken: string): Promise<RefreshPayload> {
    try {
      const payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        audience: REFRESH_AUDIENCE,
        algorithms: [JWT_ALGORITHM],
      });
      // Tokens from before per-device sessions carry no sid: they are simply signed out.
      if (!payload.sid) throw new Error('no sid');
      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  private async startSession(user: User): Promise<AuthResult> {
    // Housekeeping: a user's dead sessions go whenever they sign in again.
    await this.prisma.session.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: '',
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    });
    const { token, hash } = await this.signRefresh(user.id, session.id);
    await this.prisma.session.update({ where: { id: session.id }, data: { tokenHash: hash } });
    return this.result(user, token);
  }

  private async signRefresh(userId: string, sid: string) {
    const payload: RefreshPayload = { sub: userId, sid, jti: randomUUID() };
    const token = await this.jwt.signAsync(payload, {
      expiresIn: REFRESH_TOKEN_TTL,
      audience: REFRESH_AUDIENCE,
    });
    return { token, hash: hashToken(token) };
  }

  private async result(user: User, refreshToken: string | null): Promise<AuthResult> {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: ACCESS_TOKEN_TTL,
      audience: ACCESS_AUDIENCE,
    });
    return { accessToken, refreshToken, user: { ...payload, displayName: user.displayName } };
  }

  async profile(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Account no longer exists');
    return { sub: user.id, email: user.email, role: user.role, displayName: user.displayName };
  }

  async updateProfile(userId: string, displayName: string | null): Promise<AuthUser> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { displayName },
    });
    return { sub: user.id, email: user.email, role: user.role, displayName: user.displayName };
  }
}

export { REFRESH_TOKEN_TTL_MS };
