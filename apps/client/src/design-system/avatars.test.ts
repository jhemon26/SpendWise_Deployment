import { describe, it, expect } from 'vitest';
import { AVATARS, AVATAR_KEYS, SVG_PREFIX, isSvgAvatar, svgAvatarKey } from './avatars.js';

describe('illustrated avatars', () => {
  it('ships a usable number of them', () => {
    expect(AVATAR_KEYS.length).toBeGreaterThanOrEqual(20);
  });

  it('every entry fills the full circle', () => {
    // Each carries its own background, so a missing one would render as a
    // transparent hole rather than an avatar.
    for (const k of AVATAR_KEYS) {
      expect(AVATARS[k], k).toMatch(/r="32"/);
    }
  });

  it('every entry is balanced markup', () => {
    for (const k of AVATAR_KEYS) {
      const art = AVATARS[k]!;
      const paired = [...art.matchAll(/<([a-z]+)(?![^>]*\/>)[^>]*>/g)].length;
      const closed = [...art.matchAll(/<\/([a-z]+)>/g)].length;
      expect(paired, k).toBe(closed);
      expect((art.match(/"/g) ?? []).length % 2, k).toBe(0);
    }
  });

  it('uses no external references', () => {
    // A strict CSP and offline use both rule these out.
    for (const k of AVATAR_KEYS) {
      expect(AVATARS[k], k).not.toMatch(/https?:|url\(|<image|xlink/);
    }
  });

  it('carries no script or event handlers', () => {
    // The markup goes through dangerouslySetInnerHTML.
    for (const k of AVATAR_KEYS) {
      expect(AVATARS[k], k).not.toMatch(/<script|on[a-z]+=/i);
    }
  });

  it('round-trips the storage prefix', () => {
    expect(isSvgAvatar(`${SVG_PREFIX}cat`)).toBe(true);
    expect(svgAvatarKey(`${SVG_PREFIX}cat`)).toBe('cat');
    expect(isSvgAvatar('🐱')).toBe(false);
    expect(isSvgAvatar('')).toBe(false);
  });
});
