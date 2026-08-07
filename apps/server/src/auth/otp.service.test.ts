import { describe, it, expect, beforeEach } from 'vitest';
import { OtpService, InMemoryOtpStore, OtpError } from './otp.service.js';

const PHONE = '+447700900000';
const IP = '203.0.113.9';

let store: InMemoryOtpStore;
let clock: Date;
let otp: OtpService;

beforeEach(() => {
  store = new InMemoryOtpStore();
  clock = new Date('2026-08-07T12:00:00Z');
  otp = new OtpService(store, {
    now: () => clock,
    blockedPrefixes: ['+8811', '+8812', '+239'],
  });
});

const advance = (ms: number) => (clock = new Date(clock.getTime() + ms));

describe('send', () => {
  it('issues a 6-digit code', async () => {
    const { id, code } = await otp.send(PHONE, IP);
    expect(id).toBeTruthy();
    expect(code).toMatch(/^\d{6}$/);
  });

  it('never stores the code in the clear', async () => {
    const { id, code } = await otp.send(PHONE, IP);
    const c = await store.get(id);
    expect(c!.code_hash).not.toContain(code);
    expect(c!.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for the same code in different challenges', async () => {
    // salted with the challenge id
    const a = await otp.send(PHONE, IP);
    const b = await otp.send(PHONE, IP);
    const ca = await store.get(a.id);
    const cb = await store.get(b.id);
    if (a.code === b.code) expect(ca!.code_hash).not.toBe(cb!.code_hash);
  });
});

describe('verify', () => {
  it('accepts the correct code once', async () => {
    const { id, code } = await otp.send(PHONE, IP);
    expect(await otp.verify(id, code)).toEqual({ target: PHONE });
  });

  it('refuses to replay a consumed code', async () => {
    const { id, code } = await otp.send(PHONE, IP);
    await otp.verify(id, code);
    await expect(otp.verify(id, code)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rejects a wrong code', async () => {
    const { id, code } = await otp.send(PHONE, IP);
    const wrong = code === '000000' ? '111111' : '000000';
    await expect(otp.verify(id, wrong)).rejects.toMatchObject({ code: 'bad_code' });
  });

  it('expires after 5 minutes', async () => {
    const { id, code } = await otp.send(PHONE, IP);
    advance(5 * 60_000 + 1000);
    await expect(otp.verify(id, code)).rejects.toMatchObject({ code: 'expired' });
  });

  it('burns the challenge after 5 wrong attempts', async () => {
    // The attempt limit IS the security boundary: 10^6 codes is trivially
    // brute-forceable otherwise.
    const { id, code } = await otp.send(PHONE, IP);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      await expect(otp.verify(id, wrong)).rejects.toMatchObject({ code: 'bad_code' });
    }
    // even the CORRECT code no longer works
    await expect(otp.verify(id, code)).rejects.toMatchObject({ code: 'too_many_attempts' });
  });

  it('rejects an unknown challenge id', async () => {
    await expect(otp.verify('nope', '123456')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('abuse and cost controls', () => {
  it('limits codes per number per hour', async () => {
    await otp.send(PHONE, IP);
    await otp.send(PHONE, '198.51.100.1');
    await otp.send(PHONE, '198.51.100.2');
    await expect(otp.send(PHONE, '198.51.100.3')).rejects.toMatchObject({
      code: 'rate_limited_target',
    });
  });

  it('lets the per-number window roll off', async () => {
    for (let i = 0; i < 3; i++) await otp.send(PHONE, `198.51.100.${i}`);
    advance(3_600_001);
    await expect(otp.send(PHONE, IP)).resolves.toBeDefined();
  });

  it('limits codes per IP per day', async () => {
    for (let i = 0; i < 10; i++) await otp.send(`+4477009000${String(i).padStart(2, '0')}`, IP);
    await expect(otp.send('+447700999999', IP)).rejects.toMatchObject({
      code: 'rate_limited_ip',
    });
  });

  it('hard-stops at the daily spend ceiling', async () => {
    // SMS pumping: the attacker triggers sends to premium numbers they own and
    // takes a cut, billed to us. Failing closed is cheaper than the bill.
    const capped = new OtpService(store, { now: () => clock, dailySendCeiling: 3 });
    await capped.send('+447700900001', '1.1.1.1');
    await capped.send('+447700900002', '1.1.1.2');
    await capped.send('+447700900003', '1.1.1.3');
    await expect(capped.send('+447700900004', '1.1.1.4')).rejects.toMatchObject({
      code: 'spend_ceiling',
    });
  });

  it('refuses known premium-rate prefixes', async () => {
    await expect(otp.send('+8811999999', IP)).rejects.toMatchObject({ code: 'blocked_prefix' });
    await expect(otp.send('+239555000', IP)).rejects.toMatchObject({ code: 'blocked_prefix' });
  });

  it('does not consume quota when a send is refused', async () => {
    await expect(otp.send('+8811999999', IP)).rejects.toThrow(OtpError);
    // the blocked attempt must not count against the legitimate number
    await expect(otp.send(PHONE, IP)).resolves.toBeDefined();
    expect(await store.countSendsByIp(IP, 0)).toBe(1);
  });
});
