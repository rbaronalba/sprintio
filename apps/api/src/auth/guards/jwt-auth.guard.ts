import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ACCESS_AUDIENCE, JWT_ALGORITHM, type JwtPayload } from '../auth.service.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization as string | undefined;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Missing access token');

    try {
      // The audience check is what stops a refresh cookie or an SSE ticket being
      // replayed here as an access token.
      request.user = await this.jwt.verifyAsync<JwtPayload>(token, {
        audience: ACCESS_AUDIENCE,
        algorithms: [JWT_ALGORITHM],
      });
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
