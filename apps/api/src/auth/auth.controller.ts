import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService, JWT_ALGORITHM, REFRESH_TOKEN_TTL_MS } from './auth.service.js';
import { parseCredentials, parseDisplayName, parsePasswordChange, parseRegisterName } from './dto.js';
import { authorizeUrl, exchangeCode, microsoftConfig, newOAuthState, validateClaims, type OAuthState } from './microsoft.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { EmailThrottlerGuard } from './guards/email-throttler.guard.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import type { JwtPayload } from './auth.service.js';

const REFRESH_COOKIE = 'refresh_token';

/** Read once at boot: a half-configured Microsoft sign-in stops the api from starting. */
const MICROSOFT = microsoftConfig();
const OAUTH_COOKIE = 'ms_oauth';
const OAUTH_AUDIENCE = 'sprintio:oauth';
/** Long enough to pick an account and do MFA, short enough to be useless if stolen. */
const OAUTH_TTL_MS = 10 * 60 * 1000;

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
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
  ) {}

  /** Which sign-in buttons the login page should show. */
  @Get('providers')
  providers() {
    return { microsoft: MICROSOFT !== null };
  }

  /** Step 1: remember state/nonce/PKCE verifier in a signed cookie and send the browser to Microsoft. */
  @Throttle(AUTH_LIMIT)
  @Get('microsoft')
  async microsoftStart(@Res() res: Response) {
    if (!MICROSOFT) throw new NotFoundException();
    const state = newOAuthState();
    const signed = await this.jwt.signAsync({ ...state }, { expiresIn: OAUTH_TTL_MS / 1000, audience: OAUTH_AUDIENCE });
    res.cookie(OAUTH_COOKIE, signed, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      // Lax, not strict: the callback is a cross-site navigation back from Microsoft.
      sameSite: 'lax',
      maxAge: OAUTH_TTL_MS,
      path: '/auth/microsoft',
    });
    res.redirect(authorizeUrl(MICROSOFT, state));
  }

  /** Step 2: Microsoft sends the browser back with a code; trade it, sign in, land on /home. */
  @Throttle(AUTH_LIMIT)
  @Get('microsoft/callback')
  async microsoftCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (!MICROSOFT) throw new NotFoundException();
    const web = process.env.WEB_ORIGIN;
    res.clearCookie(OAUTH_COOKIE, { path: '/auth/microsoft' });
    try {
      const saved = await this.jwt.verifyAsync<OAuthState>(req.cookies?.[OAUTH_COOKIE] ?? '', {
        audience: OAUTH_AUDIENCE,
        algorithms: [JWT_ALGORITHM],
      });
      // Also covers ?error=... (user cancelled, consent denied): no code comes back.
      if (!code || state !== saved.state) throw new Error('State mismatch or no code');
      const identity = validateClaims(await exchangeCode(MICROSOFT, code, saved.verifier), MICROSOFT, saved.nonce);
      const result = await this.auth.signInWithMicrosoft(identity);
      this.setRefreshCookie(res, result.refreshToken);
      // The app picks the session up from the refresh cookie on load, like any page reload.
      res.redirect(`${web}/home`);
    } catch (error) {
      this.logger.warn(`Microsoft sign-in failed: ${(error as Error).message}`);
      const reason = error instanceof ConflictException ? 'microsoft-linked' : 'microsoft';
      res.redirect(`${web}/login?error=${reason}`);
    }
  }

  @Throttle(AUTH_LIMIT)
  @UseGuards(JwtAuthGuard)
  @Post('password')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: JwtPayload, @Body() body: unknown, @Req() req: Request) {
    const { current, next } = parsePasswordChange(body);
    await this.auth.changePassword(user.sub, current, next, req.cookies?.[REFRESH_COOKIE]);
  }

  @Throttle(AUTH_LIMIT)
  @UseGuards(EmailThrottlerGuard)
  @Post('register')
  async register(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    // With Microsoft on, accounts come from the company directory: an unverified self-registered
    // email would otherwise sit waiting for its real owner's first Microsoft sign-in.
    if (MICROSOFT) throw new NotFoundException();
    const { email, password } = parseCredentials(body);
    const displayName = parseRegisterName(body);
    const result = await this.auth.register(email, password, displayName);
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
