import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService, REFRESH_TOKEN_TTL_MS } from './auth.service.js';
import { parseCredentials, parseDisplayName } from './dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { EmailThrottlerGuard } from './guards/email-throttler.guard.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import type { JwtPayload } from './auth.service.js';

const REFRESH_COOKIE = 'refresh_token';

// Credential endpoints: brute-force / credential-stuffing surface, so far tighter than
// the global limit. Env-configurable because a rate limit is deployment policy, not
// application logic: the e2e suite registers a dozen accounts in seconds from one IP,
// which is exactly the traffic this is meant to stop in production.
const AUTH_LIMIT = { default: { ttl: 60_000, limit: Number(process.env.AUTH_RATE_LIMIT ?? 10) } };

// Refresh is not a guessing surface — it needs an unforgeable signed cookie we issued —
// and every page load spends one. At the credential limit, a user with a handful of tabs
// locks themselves out, so it gets its own, looser ceiling.
const REFRESH_LIMIT = { default: { ttl: 60_000, limit: 60 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle(AUTH_LIMIT)
  @UseGuards(EmailThrottlerGuard)
  @Post('register')
  async register(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { email, password } = parseCredentials(body);
    const result = await this.auth.register(email, password);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Throttle(AUTH_LIMIT)
  @UseGuards(EmailThrottlerGuard)
  @Post('login')
  async login(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { email, password } = parseCredentials(body);
    const result = await this.auth.login(email, password);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Throttle(REFRESH_LIMIT)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (!refreshToken) throw new UnauthorizedException('Missing refresh token');

    const result = await this.auth.refresh(refreshToken);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(user.sub, req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE);
    return { success: true };
  }

  // Read from the row, not the token: displayName can change mid-token.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.auth.profile(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  updateProfile(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    return this.auth.updateProfile(user.sub, parseDisplayName(body));
  }

  private setRefreshCookie(res: Response, token: string | null) {
    // Null inside the rotation grace window: this browser's cookie is already current.
    if (!token) return;
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: REFRESH_TOKEN_TTL_MS,
      path: '/',
    });
  }
}
