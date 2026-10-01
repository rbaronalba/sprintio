import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ACCESS_AUDIENCE, JWT_ALGORITHM, type JwtPayload } from '../auth.service.js';

/**
 * The global limit, counted per signed-in user rather than per IP: a team behind one
 * office NAT would otherwise share a single budget. The token is verified (not just
 * decoded), so nobody can spread requests over made-up user ids to dodge the limit.
 * Anonymous requests and bad tokens still count against the IP.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  // Property injection: the base constructor's params carry throttler-specific tokens.
  @Inject(JwtService) private readonly jwt!: JwtService;

  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const header = req.headers?.authorization as string | undefined;
    if (header?.startsWith('Bearer ')) {
      try {
        const { sub } = await this.jwt.verifyAsync<JwtPayload>(header.slice(7), {
          audience: ACCESS_AUDIENCE,
          algorithms: [JWT_ALGORITHM],
        });
        return `user:${sub}`;
      } catch {
        // Fall through: an invalid token is just an anonymous request.
      }
    }
    return req.ip;
  }
}
