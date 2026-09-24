import { describe, expect, it } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { ACCESS_AUDIENCE, REFRESH_AUDIENCE, STREAM_AUDIENCE } from './auth.service.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

const jwt = new JwtService({ secret: 'test-secret' });

const contextWith = (token: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }),
  }) as never;

describe('token audiences', () => {
  it('accepts an access token', async () => {
    const token = await jwt.signAsync({ sub: 'u1' }, { audience: ACCESS_AUDIENCE });
    await expect(new JwtAuthGuard(jwt).canActivate(contextWith(token))).resolves.toBe(true);
  });

  // The whole point of the audience claim: these two are valid signatures over our own
  // secret, so without it they would authenticate as the user they name.
  it('rejects a refresh token used as an access token', async () => {
    const token = await jwt.signAsync({ sub: 'u1' }, { audience: REFRESH_AUDIENCE });
    await expect(new JwtAuthGuard(jwt).canActivate(contextWith(token))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an SSE stream ticket used as an access token', async () => {
    const token = await jwt.signAsync({ sub: 'u1' }, { audience: STREAM_AUDIENCE });
    await expect(new JwtAuthGuard(jwt).canActivate(contextWith(token))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token signed with any algorithm but HS256', async () => {
    const token = await jwt.signAsync({ sub: 'u1' }, { audience: ACCESS_AUDIENCE, algorithm: 'HS512' });
    await expect(new JwtAuthGuard(jwt).canActivate(contextWith(token))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a token minted with no audience at all', async () => {
    const token = await jwt.signAsync({ sub: 'u1' });
    await expect(new JwtAuthGuard(jwt).canActivate(contextWith(token))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
