import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Same limit as the global per-IP guard, but counted per target email. The IP limit alone
 * falls to an attacker rotating addresses; this one caps guesses against any one account.
 */
@Injectable()
export class EmailThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const email = req.body?.email;
    return typeof email === 'string' ? `email:${email.trim().toLowerCase()}` : req.ip;
  }
}
