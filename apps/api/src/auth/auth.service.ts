import { createHash, randomUUID } from 'node:crypto';
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Role, User } from '../generated/prisma/client.js';
import { hashPassword, verifyPassword } from './password.util.js';

// Every token we mint carries an audience, and every verifier demands the one it expects.
// Without this all three are interchangeable bearer tokens: a refresh cookie or a
// 60s SSE ticket would sail through JwtAuthGuard and act as a full access token.
export const ACCESS_AUDIENCE = 'sprintio:access';
export const REFRESH_AUDIENCE = 'sprintio:refresh';
export const STREAM_AUDIENCE = 'sprintio:stream';

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
}

export interface RefreshPayload {
  sub: string;
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
  refreshToken: string;
  user: AuthUser;
}

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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
    return this.issueTokens(user);
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<AuthResult> {
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        audience: REFRESH_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user?.refreshTokenHash || !user.refreshTokenExpiresAt) {
      throw new UnauthorizedException('No active session');
    }
    if (user.refreshTokenExpiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }
    if (hashToken(refreshToken) !== user.refreshTokenHash) {
      // Reused/stolen token: kill the session.
      await this.prisma.user.update({
        where: { id: user.id },
        data: { refreshTokenHash: null, refreshTokenExpiresAt: null },
      });
      throw new UnauthorizedException('Invalid refresh token');
    }
    return this.issueTokens(user);
  }

  async logout(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: null, refreshTokenExpiresAt: null },
    });
  }

  private async issueTokens(user: User): Promise<AuthResult> {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: ACCESS_TOKEN_TTL,
      audience: ACCESS_AUDIENCE,
    });

    const refreshPayload: RefreshPayload = { sub: user.id, jti: randomUUID() };
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      expiresIn: REFRESH_TOKEN_TTL,
      audience: REFRESH_AUDIENCE,
    });
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        refreshTokenHash: hashToken(refreshToken),
        refreshTokenExpiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
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
