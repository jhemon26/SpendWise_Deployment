import type Redis from 'ioredis';
import type { Challenge, OtpStore } from './otp.service.js';

/**
 * Redis-backed OTP store.
 *
 * The in-memory store is fine for one process, but the limits it enforces are
 * security and billing controls — they must survive a restart and hold across
 * replicas. An attacker who can reset your rate limiter by waiting for a deploy
 * does not have a rate limiter to beat.
 *
 * Every key carries a TTL, so expired challenges and stale counters evict
 * themselves. Redis is configured `noeviction` for queues (§7.3); these keys
 * are small and short-lived.
 */

const K = {
  challenge: (id: string) => `otp:c:${id}`,
  target: (t: string) => `otp:t:${t}`,
  ip: (ip: string) => `otp:i:${ip}`,
  daily: (day: string) => `otp:d:${day}`,
};

const dayKey = (d: Date): string => d.toISOString().slice(0, 10);

export class RedisOtpStore implements OtpStore {
  constructor(
    private readonly redis: Redis,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async put(c: Challenge): Promise<void> {
    const ttlMs = Math.max(1000, c.expires_at.getTime() - this.now().getTime());
    await this.redis.set(
      K.challenge(c.id),
      JSON.stringify({ ...c, expires_at: c.expires_at.toISOString(), consumed_at: null }),
      'PX',
      // Outlive the challenge itself, so a replay after expiry is reported as
      // 'expired' rather than 'not_found' — the difference matters when reading
      // an incident timeline.
      Math.floor(ttlMs) + 60_000,
    );
  }

  async get(id: string): Promise<Challenge | null> {
    const raw = await this.redis.get(K.challenge(id));
    if (!raw) return null;
    const o = JSON.parse(raw) as Omit<Challenge, 'expires_at' | 'consumed_at'> & {
      expires_at: string;
      consumed_at: string | null;
    };
    return {
      ...o,
      expires_at: new Date(o.expires_at),
      consumed_at: o.consumed_at ? new Date(o.consumed_at) : null,
    };
  }

  async update(c: Challenge): Promise<void> {
    // Preserve the existing TTL: writing without KEEPTTL would make a wrong
    // guess reset the expiry, so an attacker could hold a challenge open
    // indefinitely by guessing periodically.
    await this.redis.set(
      K.challenge(c.id),
      JSON.stringify({
        ...c,
        expires_at: c.expires_at.toISOString(),
        consumed_at: c.consumed_at ? c.consumed_at.toISOString() : null,
      }),
      'KEEPTTL',
    );
  }

  private async countSince(key: string, sinceMs: number): Promise<number> {
    // Sorted set scored by timestamp: a sliding window, not a fixed bucket.
    // Fixed buckets let an attacker send 2x the limit across a boundary.
    await this.redis.zremrangebyscore(key, 0, sinceMs);
    return this.redis.zcard(key);
  }

  async countSends(target: string, sinceMs: number): Promise<number> {
    return this.countSince(K.target(target), sinceMs);
  }

  async countSendsByIp(ip: string, sinceMs: number): Promise<number> {
    return this.countSince(K.ip(ip), sinceMs);
  }

  async recordSend(target: string, ip: string, at: Date): Promise<void> {
    const ts = at.getTime();
    const member = `${ts}:${Math.random().toString(36).slice(2, 8)}`;
    await this.redis
      .multi()
      .zadd(K.target(target), ts, member)
      .expire(K.target(target), 3600 * 2)
      .zadd(K.ip(ip), ts, member)
      .expire(K.ip(ip), 86_400 * 2)
      .incr(K.daily(dayKey(at)))
      .expire(K.daily(dayKey(at)), 86_400 * 2)
      .exec();
  }

  async countSendsToday(): Promise<number> {
    const v = await this.redis.get(K.daily(dayKey(this.now())));
    return v ? Number(v) : 0;
  }
}
