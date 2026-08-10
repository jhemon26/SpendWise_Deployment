/**
 * Google Identity Services.
 *
 * The browser receives an ID token from Google and posts it to our API, which
 * verifies the signature against Google's JWKS. There is no redirect and no
 * client secret — the secret would be readable by anyone viewing source, so a
 * browser flow must never use one.
 */

export const GOOGLE_CLIENT_ID =
  (import.meta.env['VITE_GOOGLE_CLIENT_ID'] as string | undefined) ?? '';

const SRC = 'https://accounts.google.com/gsi/client';

interface GoogleCredentialResponse { credential?: string }

interface GoogleIdApi {
  initialize(o: {
    client_id: string;
    callback: (r: GoogleCredentialResponse) => void;
    nonce?: string;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    use_fedcm_for_prompt?: boolean;
  }): void;
  renderButton(parent: HTMLElement, o: Record<string, unknown>): void;
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
 * Render Google's own button into `parent`.
 *
 * An earlier version rendered it off-screen and forwarded clicks from a custom
 * button. That looked better and did not work: GIS may render inside a
 * cross-origin iframe, where querySelector finds nothing, so the forwarded
 * click hit an inert wrapper and nothing happened — a sign-in button that
 * silently does nothing is worse than one that looks slightly off-brand.
 *
 * So this uses the supported path. GIS renders at a FIXED pixel width and will
 * not follow its container, so the width is measured and re-measured.
 */
export async function renderGoogleButton(
  parent: HTMLElement,
  nonce: string,
  onToken: (idToken: string) => void,
  onError: (e: unknown) => void,
): Promise<void> {
  try {
    const api = await loadGoogle();
    api.initialize({
      client_id: GOOGLE_CLIENT_ID,
      nonce,
      callback: (r) => {
        if (r.credential) onToken(r.credential);
        else onError(new Error('google_no_credential'));
      },
      // No silent sign-in: on a shared device that would pick an account for
      // the user without them choosing.
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    const paint = (): void => {
      const w = Math.round(parent.getBoundingClientRect().width);
      if (w < 40) return;                       // not laid out yet
      parent.replaceChildren();
      api.renderButton(parent, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: Math.min(Math.max(w, 200), 400), // Google clamps at 400
      });
    };
    paint();

    if (typeof ResizeObserver !== 'undefined') {
      let last = Math.round(parent.getBoundingClientRect().width);
      const ro = new ResizeObserver(() => {
        const w = Math.round(parent.getBoundingClientRect().width);
        if (Math.abs(w - last) > 4) { last = w; paint(); }
      });
      ro.observe(parent);
    }
  } catch (e) {
    onError(e);
  }
}
