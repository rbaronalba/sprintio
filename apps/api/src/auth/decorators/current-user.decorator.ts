import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../auth.service.js';

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): JwtPayload => {
  return ctx.switchToHttp().getRequest().user;
});
