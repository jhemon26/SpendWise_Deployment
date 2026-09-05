/**
 * Google Identity Services.
 *
 * The browser receives an ID token from Google and posts it to our API, which
 * verifies the signature against Google's JWKS. There is no redirect and no
 * client secret — the secret would be readable by anyone viewing source, so a
 * browser flow must never use one.
 */

/*
 * The OAuth client ID for www.spendwise.uk.
 *
 * Public by definition — it is embedded in every browser bundle and visible to
 * anyone who views source. Google's security model rests on the registered
 * origin, not on this string being hidden, and the client secret is never in
 * the browser at all (see above).
 *
 * It lives here rather than in an env file because it once did not: a build
 * made without the untracked .env produced an empty ID, `ready` went false,
 * and the Google button was disabled on a live sign-in screen with no error to
 * explain it. A value that is public, fixed, and required to boot is not
 * configuration — it is a constant. The env var still overrides, for a
 * different deployment.
 */
const DEFAULT_CLIENT_ID = '597080784367-0oa7pfngksc4ih6sqsfouvbv2fog9un2.apps.googleusercontent.com';

export const GOOGLE_CLIENT_ID =
  (import.meta.env['VITE_GOOGLE_CLIENT_ID'] as string | undefined) || DEFAULT_CLIENT_ID;

const SRC = 'https://accounts.google.com/gsi/client';

interface GoogleCredentialResponse { credential?: string }

interface PromptMoment {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
}

interface GoogleIdApi {
  initialize(o: {
    client_id: string;
    callback: (r: GoogleCredentialResponse) => void;
    nonce?: string;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    use_fedcm_for_prompt?: boolean;
    itp_support?: boolean;
  }): void;
  renderButton(parent: HTMLElement, o: Record<string, unknown>): void;
  prompt(listener?: (n?: PromptMoment) => void): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window { google?: { accounts?: { id?: GoogleIdApi } } }
}

let loading: Promise<GoogleIdApi> | null = null;

/** Loads the SDK once, however many times this is called. */
export function loadGoogle(): Promise<GoogleIdApi> {
  if (loading) return loading;

  loading = new Promise<GoogleIdApi>((resolve, reject) => {
    const existing = window.google?.accounts?.id;
    if (existing) { resolve(existing); return; }

    const el = document.createElement('script');
    el.src = SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => {
      const api = window.google?.accounts?.id;
      // Loaded but no API means a content blocker replaced the response with
      // something harmless. Treat it as unavailable rather than crashing.
      if (api) resolve(api);
      else reject(new Error('google_unavailable'));
    };
    el.onerror = () => reject(new Error('google_unavailable'));
    document.head.appendChild(el);
  }).catch((e: unknown) => {
    // Let a later attempt retry rather than caching the failure forever —
    // the usual cause is a transient network drop.
    loading = null;
    throw e;
  });

  return loading;
}

/**
 * A nonce the server will check against the one inside the ID token.
 *
 * This is what stops a token minted for another site being replayed at ours,
 * so it has to come from the CSPRNG, not Math.random.
 */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Start sign-in from OUR button.
 *
 * Google's rendered button is not used at all. It cannot be sized (its `width`
 * is a minimum, so it may paint wider), it swaps to a taller personalised
 * variant for anyone with a Google session unless it is shrunk to `medium`, and
 * it cannot be restyled — three constraints that between them make it
 * impossible to line up with the buttons beside it.
 *
 * prompt() opens the browser's credential chooser (FedCM on Chrome, One Tap
 * elsewhere) and delivers the token to the same callback, so we draw the button
 * and Google handles the account picking.
 *
 * https://developers.google.com/identity/gsi/web/reference/js-reference
 */
export async function initGoogle(
  nonce: string,
  onToken: (idToken: string) => void,
): Promise<void> {
  const api = await loadGoogle();
  api.initialize({
    client_id: GOOGLE_CLIENT_ID,
    nonce,
    callback: (r) => { if (r.credential) onToken(r.credential); },
    // No silent sign-in: on a shared device that would pick an account without
    // the user choosing one.
    auto_select: false,
    cancel_on_tap_outside: true,
    use_fedcm_for_prompt: true,
    itp_support: true,
  });
}

/**
 * Render Google's own button as a fallback.
 *
 * prompt() opens One Tap / FedCM, which browsers suppress freely — after a few
 * dismissals, with third-party cookies off, and routinely on mobile. The
 * rendered button uses a different path (a popup), so it commonly works when
 * the prompt will not. It looks like Google's button rather than ours, which is
 * a fair trade against a sign-in that cannot be completed at all.
 */
export async function renderGoogleFallback(parent: HTMLElement): Promise<void> {
  const api = await loadGoogle();
  const w = Math.round(parent.getBoundingClientRect().width);
  parent.replaceChildren();
  api.renderButton(parent, {
    type: 'standard',
    theme: 'outline',
    // medium keeps the personalised two-line variant away, so the row stays
    // the height it was designed for.
    size: 'medium',
    text: 'continue_with',
    shape: 'rectangular',
    logo_alignment: 'left',
    width: Math.min(Math.max(w || 300, 200), 400),
  });
}

/**
 * Open the chooser. Resolves false when the browser refused to show it —
 * usually because the user dismissed it too many times, which is a state only
 * they can clear, so the caller must say so rather than appear broken.
 */
export async function promptGoogle(): Promise<boolean> {
  const api = await loadGoogle();
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (v: boolean): void => { if (!settled) { settled = true; resolve(v); } };
    try {
      api.prompt((n?: PromptMoment) => {
        // Under FedCM several of these are deprecated no-ops, hence the guards.
        const skipped = typeof n?.isNotDisplayed === 'function' && n.isNotDisplayed();
        const passed = typeof n?.isSkippedMoment === 'function' && n.isSkippedMoment();
        if (skipped || passed) done(false);
      });
    } catch { done(false); return; }
    // No moment callback fires on the happy path, so assume shown.
    setTimeout(() => done(true), 800);
  });
}
