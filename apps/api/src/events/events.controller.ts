import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Query,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { Observable, finalize, interval, map, merge } from 'rxjs';
import { EventsService } from './events.service.js';
import { NotificationsService } from './notifications.service.js';
import { JWT_ALGORITHM, STREAM_AUDIENCE, type JwtPayload } from '../auth/auth.service.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';

/** Long enough to survive a slow page load, short enough that a logged URL is stale on arrival. */
const TICKET_TTL = '60s';
/** Proxies and load balancers drop idle connections; this keeps the pipe warm. */
const HEARTBEAT_MS = 25_000;
/** One tab each for a handful of boards is normal; hundreds is someone exhausting our sockets. */
const MAX_STREAMS_PER_USER = 6;

interface SsePayload {
  data: Record<string, unknown>;
}

@Controller('events')
export class EventsController {
  private readonly openStreams = new Map<string, number>();

  constructor(
    private readonly events: EventsService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * EventSource cannot send an Authorization header, and a long-lived token in a URL
   * ends up in proxy and browser logs. So the stream is opened with a separate,
   * audience-scoped, 60-second ticket that is useless anywhere else in the API.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('ticket')
  async ticket(@CurrentUser() user: JwtPayload) {
    const ticket = await this.jwt.signAsync(
      { sub: user.sub },
      { expiresIn: TICKET_TTL, audience: STREAM_AUDIENCE },
    );
    return { ticket };
  }

  @Sse('stream')
  // nginx buffers proxied responses by default, which holds events back until the buffer fills.
  @Header('X-Accel-Buffering', 'no')
  async stream(@Query('ticket') ticket: string): Promise<Observable<SsePayload>> {
    const userId = await this.userFromTicket(ticket);

    const open = this.openStreams.get(userId) ?? 0;
    if (open >= MAX_STREAMS_PER_USER) {
      throw new UnauthorizedException('Too many open streams');
    }
    this.openStreams.set(userId, open + 1);

    const heartbeat = interval(HEARTBEAT_MS).pipe(map(() => ({ data: { type: 'ping' } })));
    const events = this.events.streamFor(userId).pipe(map((message) => ({ data: { ...message } })));

    return merge(events, heartbeat).pipe(
      finalize(() => {
        const remaining = (this.openStreams.get(userId) ?? 1) - 1;
        if (remaining > 0) this.openStreams.set(userId, remaining);
        else this.openStreams.delete(userId);
      }),
    );
  }

  private async userFromTicket(ticket: string): Promise<string> {
    if (!ticket) throw new UnauthorizedException('Missing stream ticket');
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(ticket, {
        audience: STREAM_AUDIENCE,
        algorithms: [JWT_ALGORITHM],
      });
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired stream ticket');
    }
  }
}

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.notifications.list(user.sub);
  }

  @Post('read')
  markRead(@CurrentUser() user: JwtPayload, @Body() body: unknown) {
    const { ids } = (body ?? {}) as { ids?: unknown };
    // No ids means "mark everything read", which is what opening the bell does.
    const only = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : undefined;
    return this.notifications.markRead(user.sub, only);
  }
}
