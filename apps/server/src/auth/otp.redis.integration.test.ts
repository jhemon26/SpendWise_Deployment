import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Redis from 'ioredis';
import { OtpService } from './otp.service.js';
import { RedisOtpStore } from './otp.store.redis.js';

const PORT = Number(process.env['REDIS_TEST_PORT'] ?? 56379);

const available: boolean = await (async () => {
  const r = new Redis({ port: PORT, lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await r.connect();
    await r.ping();
    await r.quit();
    return true;
  } catch {
    r.disconnect();
    return false;
  }
})();

if (!available) console.warn(`[otp.redis] no Redis on :${PORT} — skipping`);

let redis: Redis;
let clock: Date;

beforeAll(() => {
  if (!available) return;
  redis = new Redis({ port: PORT });
});
afterAll(async () => {
  if (!available || !redis) return;
  await redis.flushdb();
  await redis.quit();
});

const svc = () => new OtpService(new RedisOtpStore(redis, () => clock), { now: () => clock });

describe.skipIf(!available)('OTP over Redis', () => {
  beforeEach(async () => {
    clock = new Date('2026-08-07T12:00:00Z');
    await redis.flushdb();
  });

  it('round-trips a challenge', async () => {
    const otp = svc();
    const { id, code } = await otp.send('+447700900000', '1.1.1.1');
    expect(await otp.verify(id, code)).toEqual({ target: '+447700900000' });
  });

  it('persists the attempt counter across service instances', async () => {
    // Restart resilience: a limiter that resets on deploy is not a limiter.
    const { id, code } = await svc().send('+447700900000', '1.1.1.1');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await expect(svc().verify(id, wrong)).rejects.toMatchObject({ code: 'bad_code' });
    }
    await expect(svc().verify(id, code)).rejects.toMatchObject({ code: 'too_many_attempts' });
  });

  it('a wrong guess does not extend the challenge TTL', async () => {
    // Without KEEPTTL, guessing periodically would hold a challenge open
    // forever and defeat the expiry entirely.
    const otp = svc();
    const { id, code } = await otp.send('+447700900000', '1.1.1.1');
    const before = await redis.pttl(`otp:c:${id}`);
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(otp.verify(id, wrong)).rejects.toMatchObject({ code: 'bad_code' });
    const after = await redis.pttl(`otp:c:${id}`);
    expect(after).toBeLessThanOrEqual(before);
  });

  it('enforces the per-number limit through Redis', async () => {
    const otp = svc();
    for (let i = 0; i < 3; i++) await otp.send('+447700900000', `1.1.1.${i}`);
    await expect(otp.send('+447700900000', '1.1.1.9')).rejects.toMatchObject({
      code: 'rate_limited_target',
    });
  });

  it('uses a SLIDING window, not a fixed bucket', async () => {
    // A fixed hourly bucket lets an attacker send 2x the limit across the
    // boundary. Sorted-set scores make the window slide.
    const otp = svc();
    for (let i = 0; i < 3; i++) await otp.send('+447700900000', `1.1.1.${i}`);
    clock = new Date(clock.getTime() + 59 * 60_000); // 59 min later: still capped
    await expect(otp.send('+447700900000', '1.1.1.9')).rejects.toMatchObject({
      code: 'rate_limited_target',
    });
    clock = new Date(clock.getTime() + 2 * 60_000); // now past the hour
    await expect(otp.send('+447700900000', '1.1.1.9')).resolves.toBeDefined();
  });

  it('counts the daily spend ceiling across instances', async () => {
    const capped = () =>
      new OtpService(new RedisOtpStore(redis, () => clock), {
        now: () => clock,
        dailySendCeiling: 3,
      });
    await capped().send('+447700900001', '1.1.1.1');
    await capped().send('+447700900002', '1.1.1.2');
    await capped().send('+447700900003', '1.1.1.3');
    await expect(capped().send('+447700900004', '1.1.1.4')).rejects.toMatchObject({
      code: 'spend_ceiling',
    });
  });

  it('never stores the code in the clear', async () => {
    const { id, code } = await svc().send('+447700900000', '1.1.1.1');
    const raw = await redis.get(`otp:c:${id}`);
    expect(raw).not.toContain(code);
  });
});
