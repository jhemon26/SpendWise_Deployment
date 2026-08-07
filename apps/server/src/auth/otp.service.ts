import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Phone OTP and email magic-link challenges (ARCHITECTURE §9.1).
 *
 * A 6-digit code is only 10^6 possibilities, so the code itself is not the
 * security boundary — the ATTEMPT LIMIT is. Five guesses then the challenge is
 * burned, which leaves a 1-in-200,000 chance per challenge.
 *
 * The send limits are a cost control as much as a security one. SMS pumping is
 * a real fraud: an attacker triggers thousands of OTPs to premium numbers they
 * control and takes a revenue share, billed to you. The daily ceiling is the
 * backstop that turns an unbounded bill into a capped one.
 */

export class OtpError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'rate_limited_target'
      | 'rate_limited_ip'
      | 'spend_ceiling'
      | 'not_found'
      | 'expired'
      | 'too_many_attempts'
      | 'bad_code'
      | 'blocked_prefix',
  ) {
    super(message);
    this.name = 'OtpError';
  }
}

export interface Challenge {
  id: string;
  target: string;
  code_hash: string;
  expires_at: Date;
  attempts: number;
  consumed_at: Date | null;
}

export interface OtpStore {
  put(c: Challenge): Promise<void>;
  get(id: string): Promise<Challenge | null>;
  update(c: Challenge): Promise<void>;
  /** Sends to this target in the trailing window. */
  countSends(target: string, sinceMs: number): Promise<number>;
  countSendsByIp(ip: string, sinceMs: number): Promise<number>;
  recordSend(target: string, ip: string, at: Date): Promise<void>;
  countSendsToday(): Promise<number>;
}

export interface OtpOptions {
  ttlSeconds?: number;
  maxAttempts?: number;
  perTargetPerHour?: number;
  perIpPerDay?: number;
  /** Hard stop on total sends per day — the SMS bill ceiling. */
  dailySendCeiling?: number;
  /** E.164 prefixes we refuse to send to (premium-rate / high-risk). */
  blockedPrefixes?: string[];
  now?: () => Date;
}

export class OtpService {
  private readonly ttl: number;
  private readonly maxAttempts: number;
  private readonly perTargetPerHour: number;
  private readonly perIpPerDay: number;
  private readonly dailyCeiling: number;
  private readonly blocked: string[];
  private readonly now: () => Date;
  private seq = 0;

  constructor(
    private readonly store: OtpStore,
    opts: OtpOptions = {},
  ) {
    this.ttl = opts.ttlSeconds ?? 300;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.perTargetPerHour = opts.perTargetPerHour ?? 3;
    this.perIpPerDay = opts.perIpPerDay ?? 10;
    this.dailyCeiling = opts.dailySendCeiling ?? 5000;
    this.blocked = opts.blockedPrefixes ?? [];
    this.now = opts.now ?? (() => new Date());
  }

  private hash(code: string, id: string): string {
    // Salted with the challenge id so two live challenges sharing a code do not
    // share a hash.
    return createHash('sha256').update(`${id}:${code}`, 'utf8').digest('hex');
  }

  /** Cryptographic RNG, not Math.random — a predictable OTP is not an OTP. */
  private newCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  async send(target: string, ip: string): Promise<{ id: string; code: string }> {
    if (this.blocked.some((p) => target.startsWith(p))) {
      throw new OtpError(`Refusing to send to ${target}`, 'blocked_prefix');
    }

    const nowMs = this.now().getTime();
    if ((await this.store.countSends(target, nowMs - 3_600_000)) >= this.perTargetPerHour) {
      throw new OtpError('Too many codes requested for this number', 'rate_limited_target');
    }
    if ((await this.store.countSendsByIp(ip, nowMs - 86_400_000)) >= this.perIpPerDay) {
      throw new OtpError('Too many codes requested from this address', 'rate_limited_ip');
    }
    if ((await this.store.countSendsToday()) >= this.dailyCeiling) {
      // Fail closed. An outage is cheaper than an unbounded SMS bill.
      throw new OtpError('Daily send ceiling reached', 'spend_ceiling');
    }

    const id = `otp-${++this.seq}-${randomInt(1e9)}`;
    const code = this.newCode();
    await this.store.put({
      id,
      target,
      code_hash: this.hash(code, id),
      expires_at: new Date(nowMs + this.ttl * 1000),
      attempts: 0,
      consumed_at: null,
    });
    await this.store.recordSend(target, ip, this.now());
    return { id, code };
  }

  /**
   * Verify and consume. Single-use: a correct code cannot be replayed, and a
   * wrong one burns an attempt.
   */
  async verify(id: string, code: string): Promise<{ target: string }> {
    const c = await this.store.get(id);
    if (!c || c.consumed_at) throw new OtpError('Challenge not found', 'not_found');

    if (c.expires_at.getTime() <= this.now().getTime()) {
      throw new OtpError('Code expired', 'expired');
    }
    if (c.attempts >= this.maxAttempts) {
      throw new OtpError('Too many attempts', 'too_many_attempts');
    }

    c.attempts += 1;
    await this.store.update(c);

    const expected = Buffer.from(c.code_hash, 'hex');
    const actual = Buffer.from(this.hash(code, id), 'hex');
    // Constant-time: comparing digests with === leaks position through timing.
    const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
    if (!ok) throw new OtpError('Incorrect code', 'bad_code');

    c.consumed_at = this.now();
    await this.store.update(c);
    return { target: c.target };
  }
}

/** In-memory store, for tests and single-node development. */
export class InMemoryOtpStore implements OtpStore {
  private readonly rows = new Map<string, Challenge>();
  private readonly sends: Array<{ target: string; ip: string; at: Date }> = [];

  async put(c: Challenge): Promise<void> {
    this.rows.set(c.id, { ...c });
  }
  async get(id: string): Promise<Challenge | null> {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }
  async update(c: Challenge): Promise<void> {
    this.rows.set(c.id, { ...c });
  }
  async countSends(target: string, sinceMs: number): Promise<number> {
    return this.sends.filter((s) => s.target === target && s.at.getTime() >= sinceMs).length;
  }
  async countSendsByIp(ip: string, sinceMs: number): Promise<number> {
    return this.sends.filter((s) => s.ip === ip && s.at.getTime() >= sinceMs).length;
  }
  async recordSend(target: string, ip: string, at: Date): Promise<void> {
    this.sends.push({ target, ip, at });
  }
  async countSendsToday(): Promise<number> {
    return this.sends.length;
  }
}
