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
 * Prepare sign-in and return a trigger for our own button.
 *
 * Google's rendered button will not sit on a dark card — its wrapper paints its
 * own white surround at the container's width, which reads as a slab rather
 * than a button. Their guidelines do permit a custom button provided the
 * wordmark, the four-colour G and the proportions are right, which is what the
 * caller draws.
 *
 * So the real button is still rendered — off-screen — and our button forwards
 * the click to it. That keeps the supported flow (and its nonce, its popup
 * handling, its FedCM path) rather than reimplementing any of it.
 */
export async function prepareGoogle(
  host: HTMLElement,
  nonce: string,
  onToken: (idToken: string) => void,
  onError: (e: unknown) => void,
): Promise<() => void> {
  const api = await loadGoogle();
  api.initialize({
    client_id: GOOGLE_CLIENT_ID,
    nonce,
    callback: (r) => {
      if (r.credential) onToken(r.credential);
      else onError(new Error('google_no_credential'));
    },
    // No silent sign-in: on a shared device that would pick an account for the
    // user without them choosing.
    auto_select: false,
    cancel_on_tap_outside: true,
  });

  /* Off-screen, not display:none — GIS needs real layout to render into, and a
     hidden element cannot be clicked. Kept out of the tab order and out of the
     accessibility tree; our visible button carries the label. */
  host.replaceChildren();
  Object.assign(host.style, {
    position: 'absolute', width: '320px', height: '44px',
    left: '-10000px', top: '0', opacity: '0',
    pointerEvents: 'none', overflow: 'hidden',
  } satisfies Partial<CSSStyleDeclaration>);
  host.setAttribute('aria-hidden', 'true');

  api.renderButton(host, {
    type: 'standard', theme: 'outline', size: 'large',
    text: 'continue_with', shape: 'rectangular', width: 320,
  });

  return () => {
    // GIS nests the clickable element; the exact class names are theirs and
    // change, so find it by role rather than by class.
    const target = host.querySelector<HTMLElement>('[role="button"]')
      ?? host.querySelector<HTMLElement>('div > div');
    if (target) target.click();
    else onError(new Error('google_unavailable'));
  };
}
