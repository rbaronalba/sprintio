import { Global, Module, OnApplicationShutdown, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';

/**
 * Two connections: a subscribed Redis connection can do nothing but receive, so
 * publishing, counters and rate limits go through `cmd`.
 * Null when REDIS_URL is unset (unit tests, a lone dev instance): callers fall back to
 * in-process state, which is only correct while a single api instance runs.
 */
export interface RedisClients {
  cmd: Redis;
  sub: Redis;
}

export const REDIS = Symbol('REDIS');

function connect(): RedisClients | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  return { cmd: new Redis(url), sub: new Redis(url) };
}

@Global()
@Module({
  providers: [{ provide: REDIS, useFactory: connect }],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: RedisClients | null) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.redis?.cmd.quit(), this.redis?.sub.quit()]);
  }
}
