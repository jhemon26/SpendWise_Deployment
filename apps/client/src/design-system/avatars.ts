/**
 * Illustrated profile avatars.
 *
 * Each entry is the inner markup of a 64x64 SVG and carries its OWN background
 * circle and palette, so it is complete on its own — no tint to choose, nothing
 * to clash with. That is the difference from the emoji option, which sits on a
 * user-picked colour plate.
 *
 * Flat shapes only: no gradients, no strokes thinner than 2, nothing that needs
 * more than a few paths. These render at 24px in a picker grid and at 62px on
 * the profile card, and anything fussier turns to mush at the small end.
 */

export const AVATARS: Record<string, string> = {
  cat: `<circle cx="32" cy="32" r="32" fill="#FDBA74"/>
    <path d="M14 26 18 9l13 9z" fill="#F97316"/><path d="M50 26 46 9 33 18z" fill="#F97316"/>
    <circle cx="32" cy="36" r="19" fill="#FFEDD5"/>
    <circle cx="25" cy="34" r="3.2" fill="#27272A"/><circle cx="39" cy="34" r="3.2" fill="#27272A"/>
    <path d="M32 41.5 29 45h6z" fill="#F97316"/>
    <path d="M14 36h8M14 41h8M50 36h-8M50 41h-8" stroke="#FDBA74" stroke-width="2" stroke-linecap="round"/>`,

  dog: `<circle cx="32" cy="32" r="32" fill="#A78BFA"/>
    <ellipse cx="13" cy="30" rx="7" ry="12" fill="#7C3AED"/><ellipse cx="51" cy="30" rx="7" ry="12" fill="#7C3AED"/>
    <circle cx="32" cy="33" r="19" fill="#EDE9FE"/>
    <circle cx="25" cy="30" r="3.2" fill="#27272A"/><circle cx="39" cy="30" r="3.2" fill="#27272A"/>
    <ellipse cx="32" cy="42" rx="9" ry="7" fill="#DDD6FE"/>
    <ellipse cx="32" cy="39" rx="4" ry="3" fill="#27272A"/>`,

  fox: `<circle cx="32" cy="32" r="32" fill="#FB7185"/>
    <path d="M12 24 17 8l12 10z" fill="#E11D48"/><path d="M52 24 47 8 35 18z" fill="#E11D48"/>
    <path d="M32 15c11 0 19 9 19 19S43 52 32 52 13 43 13 34s8-19 19-19z" fill="#FDA4AF"/>
    <path d="M32 30c7 0 12 6 12 11S38 52 32 52 20 46 20 41s5-11 12-11z" fill="#FFF1F2"/>
    <circle cx="25" cy="31" r="3" fill="#27272A"/><circle cx="39" cy="31" r="3" fill="#27272A"/>
    <path d="M32 40 28.5 44h7z" fill="#27272A"/>`,

  panda: `<circle cx="32" cy="32" r="32" fill="#94A3B8"/>
    <circle cx="15" cy="16" r="8" fill="#1E293B"/><circle cx="49" cy="16" r="8" fill="#1E293B"/>
    <circle cx="32" cy="34" r="20" fill="#F8FAFC"/>
    <ellipse cx="24" cy="31" rx="5.5" ry="7" fill="#1E293B"/><ellipse cx="40" cy="31" rx="5.5" ry="7" fill="#1E293B"/>
    <circle cx="24" cy="31" r="2.2" fill="#F8FAFC"/><circle cx="40" cy="31" r="2.2" fill="#F8FAFC"/>
    <ellipse cx="32" cy="42" rx="4" ry="3" fill="#1E293B"/>`,

  bear: `<circle cx="32" cy="32" r="32" fill="#D97706"/>
    <circle cx="16" cy="17" r="8.5" fill="#B45309"/><circle cx="48" cy="17" r="8.5" fill="#B45309"/>
    <circle cx="32" cy="34" r="20" fill="#FCD34D"/>
    <circle cx="25" cy="31" r="3" fill="#451A03"/><circle cx="39" cy="31" r="3" fill="#451A03"/>
    <ellipse cx="32" cy="41" rx="9" ry="7" fill="#FEF3C7"/>
    <ellipse cx="32" cy="38.5" rx="3.5" ry="2.8" fill="#451A03"/>`,

  owl: `<circle cx="32" cy="32" r="32" fill="#8B5CF6"/>
    <path d="M32 12c12 0 19 10 19 21s-8 19-19 19-19-8-19-19 7-21 19-21z" fill="#C4B5FD"/>
    <circle cx="24" cy="29" r="8" fill="#F5F3FF"/><circle cx="40" cy="29" r="8" fill="#F5F3FF"/>
    <circle cx="24" cy="29" r="4" fill="#27272A"/><circle cx="40" cy="29" r="4" fill="#27272A"/>
    <path d="M32 35 27 41h10z" fill="#F59E0B"/>
    <path d="M17 17 24 22M47 17 40 22" stroke="#6D28D9" stroke-width="3" stroke-linecap="round"/>`,

  penguin: `<circle cx="32" cy="32" r="32" fill="#38BDF8"/>
    <ellipse cx="32" cy="34" rx="19" ry="21" fill="#1E293B"/>
    <ellipse cx="32" cy="38" rx="12" ry="16" fill="#F8FAFC"/>
    <circle cx="26" cy="27" r="3" fill="#F8FAFC"/><circle cx="38" cy="27" r="3" fill="#F8FAFC"/>
    <circle cx="26" cy="27" r="1.6" fill="#27272A"/><circle cx="38" cy="27" r="1.6" fill="#27272A"/>
    <path d="M32 32 27 36l5 3 5-3z" fill="#FB923C"/>`,

  frog: `<circle cx="32" cy="32" r="32" fill="#34D399"/>
    <circle cx="20" cy="20" r="9" fill="#6EE7B7"/><circle cx="44" cy="20" r="9" fill="#6EE7B7"/>
    <circle cx="20" cy="20" r="4.5" fill="#27272A"/><circle cx="44" cy="20" r="4.5" fill="#27272A"/>
    <path d="M32 26c12 0 20 7 20 14s-9 12-20 12-20-5-20-12 8-14 20-14z" fill="#10B981"/>
    <path d="M22 42q10 8 20 0" stroke="#065F46" stroke-width="3" fill="none" stroke-linecap="round"/>`,

  bee: `<circle cx="32" cy="32" r="32" fill="#FACC15"/>
    <ellipse cx="18" cy="22" rx="9" ry="7" fill="#FEF9C3" opacity=".9"/>
    <ellipse cx="46" cy="22" rx="9" ry="7" fill="#FEF9C3" opacity=".9"/>
    <ellipse cx="32" cy="36" rx="15" ry="18" fill="#FBBF24"/>
    <path d="M18 31h28M19 41h26" stroke="#27272A" stroke-width="5" stroke-linecap="round"/>
    <circle cx="27" cy="24" r="2.6" fill="#27272A"/><circle cx="37" cy="24" r="2.6" fill="#27272A"/>`,

  whale: `<circle cx="32" cy="32" r="32" fill="#22D3EE"/>
    <path d="M10 36c0-9 10-15 22-15s22 6 22 15-10 13-22 13S10 45 10 36z" fill="#0E7490"/>
    <path d="M14 42c8 6 28 6 36 0-4 8-32 8-36 0z" fill="#155E75"/>
    <circle cx="24" cy="33" r="3.2" fill="#ECFEFF"/><circle cx="24" cy="33" r="1.6" fill="#0C4A6E"/>
    <path d="M32 18c0-5 6-5 6-9" stroke="#ECFEFF" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="39" cy="8" r="3" fill="#ECFEFF"/>`,

  octopus: `<circle cx="32" cy="32" r="32" fill="#F472B6"/>
    <path d="M32 14c11 0 18 8 18 17v8H14v-8c0-9 7-17 18-17z" fill="#DB2777"/>
    <path d="M14 39c0 6 3 9 3 13M23 39c0 7 2 10 2 14M32 39v14M41 39c0 7-2 10-2 14M50 39c0 6-3 9-3 13"
      stroke="#DB2777" stroke-width="5" stroke-linecap="round" fill="none"/>
    <circle cx="25" cy="29" r="4" fill="#FFF1F2"/><circle cx="39" cy="29" r="4" fill="#FFF1F2"/>
    <circle cx="25" cy="29" r="2" fill="#27272A"/><circle cx="39" cy="29" r="2" fill="#27272A"/>`,

  rabbit: `<circle cx="32" cy="32" r="32" fill="#F9A8D4"/>
    <ellipse cx="24" cy="16" rx="5" ry="13" fill="#FBCFE8"/><ellipse cx="40" cy="16" rx="5" ry="13" fill="#FBCFE8"/>
    <ellipse cx="24" cy="17" rx="2.2" ry="8" fill="#F472B6"/><ellipse cx="40" cy="17" rx="2.2" ry="8" fill="#F472B6"/>
    <circle cx="32" cy="39" r="16" fill="#FDF2F8"/>
    <circle cx="26" cy="36" r="2.8" fill="#27272A"/><circle cx="38" cy="36" r="2.8" fill="#27272A"/>
    <path d="M32 43 29 46h6z" fill="#F472B6"/>`,

  robot: `<circle cx="32" cy="32" r="32" fill="#2DD4BF"/>
    <rect x="14" y="20" width="36" height="30" rx="9" fill="#134E4A"/>
    <rect x="20" y="27" width="24" height="13" rx="6" fill="#5EEAD4"/>
    <circle cx="26" cy="33.5" r="3" fill="#0F172A"/><circle cx="38" cy="33.5" r="3" fill="#0F172A"/>
    <path d="M32 20v-7" stroke="#134E4A" stroke-width="3" stroke-linecap="round"/>
    <circle cx="32" cy="10" r="4" fill="#FACC15"/>
    <path d="M22 45h20" stroke="#5EEAD4" stroke-width="3" stroke-linecap="round"/>`,

  alien: `<circle cx="32" cy="32" r="32" fill="#A3E635"/>
    <path d="M32 12c12 0 19 9 19 19 0 11-9 21-19 21s-19-10-19-21c0-10 7-19 19-19z" fill="#65A30D"/>
    <ellipse cx="23" cy="31" rx="6" ry="9" fill="#1A2E05" transform="rotate(-14 23 31)"/>
    <ellipse cx="41" cy="31" rx="6" ry="9" fill="#1A2E05" transform="rotate(14 41 31)"/>
    <path d="M26 44q6 5 12 0" stroke="#1A2E05" stroke-width="3" fill="none" stroke-linecap="round"/>`,

  ghost: `<circle cx="32" cy="32" r="32" fill="#818CF8"/>
    <path d="M32 12c10 0 17 8 17 18v22l-6-5-5 5-6-5-6 5-5-5-6 5V30c0-10 7-18 17-18z" fill="#EEF2FF"/>
    <circle cx="25" cy="30" r="3.4" fill="#3730A3"/><circle cx="39" cy="30" r="3.4" fill="#3730A3"/>
    <ellipse cx="32" cy="39" rx="4" ry="3" fill="#3730A3"/>`,

  rocket: `<circle cx="32" cy="32" r="32" fill="#0EA5E9"/>
    <path d="M32 9c7 6 11 15 11 24v9H21v-9c0-9 4-18 11-24z" fill="#F1F5F9"/>
    <circle cx="32" cy="26" r="6" fill="#0284C7"/>
    <path d="M21 34 12 44h9zM43 34l9 10h-9z" fill="#EF4444"/>
    <path d="M27 42h10l-5 12z" fill="#FB923C"/>`,

  planet: `<circle cx="32" cy="32" r="32" fill="#1E1B4B"/>
    <circle cx="32" cy="30" r="16" fill="#A855F7"/>
    <circle cx="26" cy="24" r="4" fill="#7E22CE"/><circle cx="38" cy="34" r="5" fill="#7E22CE"/>
    <ellipse cx="32" cy="34" rx="27" ry="7" fill="none" stroke="#FACC15" stroke-width="4" transform="rotate(-18 32 34)"/>
    <circle cx="12" cy="14" r="2" fill="#FDE68A"/><circle cx="52" cy="50" r="2" fill="#FDE68A"/>`,

  mushroom: `<circle cx="32" cy="32" r="32" fill="#FCA5A5"/>
    <path d="M32 14c12 0 21 9 21 17H11c0-8 9-17 21-17z" fill="#DC2626"/>
    <circle cx="22" cy="25" r="4" fill="#FEE2E2"/><circle cx="40" cy="23" r="3" fill="#FEE2E2"/><circle cx="33" cy="29" r="2.5" fill="#FEE2E2"/>
    <path d="M24 31h16v13a8 8 0 0 1-16 0z" fill="#FEF3C7"/>
    <circle cx="27" cy="39" r="2" fill="#27272A"/><circle cx="37" cy="39" r="2" fill="#27272A"/>`,

  plant: `<circle cx="32" cy="32" r="32" fill="#4ADE80"/>
    <path d="M32 50V26" stroke="#15803D" stroke-width="4" stroke-linecap="round"/>
    <path d="M32 30c-10 0-15-6-15-13 8 0 15 4 15 13z" fill="#16A34A"/>
    <path d="M32 36c10 0 15-6 15-13-8 0-15 4-15 13z" fill="#22C55E"/>
    <path d="M20 50h24l-3 8H23z" fill="#F97316"/>`,

  star: `<circle cx="32" cy="32" r="32" fill="#FBBF24"/>
    <path d="M32 11 39 26l16 2-12 11 3 16-14-8-14 8 3-16L11 28l16-2z" fill="#FEF3C7"/>
    <circle cx="27" cy="30" r="2.6" fill="#92400E"/><circle cx="37" cy="30" r="2.6" fill="#92400E"/>
    <path d="M28 37q4 4 8 0" stroke="#92400E" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,

  moon: `<circle cx="32" cy="32" r="32" fill="#312E81"/>
    <path d="M40 12a22 22 0 1 0 12 22 17 17 0 0 1-12-22z" fill="#FDE68A"/>
    <circle cx="27" cy="30" r="4" fill="#F59E0B" opacity=".45"/><circle cx="36" cy="43" r="3" fill="#F59E0B" opacity=".45"/>
    <circle cx="13" cy="16" r="2.2" fill="#FDE68A"/><circle cx="50" cy="52" r="2" fill="#FDE68A"/>`,

  wave: `<circle cx="32" cy="32" r="32" fill="#0891B2"/>
    <path d="M0 34q8-8 16 0t16 0 16 0 16 0v30H0z" fill="#22D3EE"/>
    <path d="M0 42q8-8 16 0t16 0 16 0 16 0v22H0z" fill="#67E8F9"/>
    <circle cx="44" cy="18" r="7" fill="#FDE68A"/>`,
};

export const AVATAR_KEYS = Object.keys(AVATARS);

/** Values stored with this prefix are illustration ids, not emoji. */
export const SVG_PREFIX = 'svg:';

export const isSvgAvatar = (value: string): boolean => value.startsWith(SVG_PREFIX);
export const svgAvatarKey = (value: string): string => value.slice(SVG_PREFIX.length);
