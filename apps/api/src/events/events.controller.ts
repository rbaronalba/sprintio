import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Optional,
  Post,
  Query,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { Observable, finalize, interval, map, merge, tap } from 'rxjs';
import { REDIS, type RedisClients } from '../redis/redis.module.js';
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
/** A stream whose instance stopped heartbeating (crashed, redeployed) stops counting after this. */
const STREAM_STALE_MS = HEARTBEAT_MS * 3;

interface SsePayload {
  data: Record<string, unknown>;
}

@Controller('events')
export class EventsController {
  /** Used only without Redis, where one process sees every stream anyway. */
  private readonly openStreams = new Map<string, number>();

  constructor(
    private readonly events: EventsService,
    private readonly jwt: JwtService,
    @Optional() @Inject(REDIS) private readonly redis: RedisClients | null = null,
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

    const slot = await this.claimSlot(userId);

    const heartbeat = interval(HEARTBEAT_MS).pipe(
      tap(() => void slot.touch()),
      map(() => ({ data: { type: 'ping' } })),
    );
    const events = this.events.streamFor(userId).pipe(map((message) => ({ data: { ...message } })));

    return merge(events, heartbeat).pipe(finalize(() => void slot.release()));
  }

  /**
   * Counts the user's open streams across every api instance: a Redis sorted set of
   * stream id -> last heartbeat, so streams on an instance that died age out on their own.
   */
  private async claimSlot(userId: string): Promise<{ touch: () => Promise<unknown>; release: () => Promise<unknown> }> {
    if (!this.redis) {
      const open = this.openStreams.get(userId) ?? 0;
      if (open >= MAX_STREAMS_PER_USER) throw new UnauthorizedException('Too many open streams');
      this.openStreams.set(userId, open + 1);
      return {
        touch: async () => {},
        release: async () => {
          const remaining = (this.openStreams.get(userId) ?? 1) - 1;
          if (remaining > 0) this.openStreams.set(userId, remaining);
          else this.openStreams.delete(userId);
        },
      };
    }
    const redis = this.redis.cmd;
    const key = `streams:${userId}`;
    const id = randomUUID();
    await redis.zremrangebyscore(key, '-inf', Date.now() - STREAM_STALE_MS);
    // ponytail: count-then-add is not atomic, so a burst can overshoot the cap by a stream or two; it is a soft cap.
    if ((await redis.zcard(key)) >= MAX_STREAMS_PER_USER) throw new UnauthorizedException('Too many open streams');
    const touch = () => redis.multi().zadd(key, Date.now(), id).pexpire(key, STREAM_STALE_MS).exec();
    await touch();
    return { touch, release: () => redis.zrem(key, id) };
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
