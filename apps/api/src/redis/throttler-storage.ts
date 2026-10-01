import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

// Fixed window: the first hit sets the expiry; a key over its limit is blocked for
// blockDuration. One round trip, atomic, so parallel instances agree on the count.
const SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) and redis.call('EXISTS', KEYS[2]) == 0 then
  redis.call('SET', KEYS[2], 1, 'PX', ARGV[3])
end
return { hits, ttl, redis.call('PTTL', KEYS[2]) }
`;

/** Rate-limit counters shared by every api instance (the default storage is per process). */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string) {
    const base = `throttle:${throttlerName}:${key}`;
    const [hits, ttlMs, blockMs] = (await this.redis.eval(SCRIPT, 2, base, `${base}:block`, ttl, limit, blockDuration || ttl)) as number[];
    const isBlocked = blockMs > 0;
    return {
      totalHits: hits,
      timeToExpire: Math.ceil(Math.max(ttlMs, 0) / 1000),
      isBlocked,
      timeToBlockExpire: isBlocked ? Math.ceil(blockMs / 1000) : 0,
    };
  }
}
