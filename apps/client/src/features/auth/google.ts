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
    itp_support?: boolean;
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
  /**
   * Reports the height Google actually rendered.
   *
   * Both dimensions vary and neither can be dictated. A visitor already signed
   * in to Google gets the PERSONALISED button — two lines, name over email,
   * plus a chevron — which is taller than the plain one. And GIS adds its own
   * padding beyond the requested width, so the painted button is wider than
   * asked for and overhangs anything sized to match. The caller sizes the other
   * buttons from what actually landed.
   */
  onMeasured?: (size: { width: number; height: number }) => void,
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
      // Chrome has moved this flow to FedCM. Without opting in, the button
      // renders and personalises but the credential callback can never fire —
      // which looks exactly like a dead button.
      use_fedcm_for_prompt: true,
      itp_support: true,
    });

    /*
     * Two documented GIS behaviours drove every earlier attempt at this wrong.
     *
     * 1. `width` is the MINIMUM button width, not the exact one — Google's
     *    reference says so plainly. The button may paint wider, which is the
     *    overhang that read as a white frame around the row. It cannot be
     *    dictated, only measured and corrected for.
     *
     * 2. The PERSONALISED button ("Continue as <name>" over the email, taller
     *    and a different shape) is suppressed only when size is `medium` or
     *    `small`, when type is `icon`, or when width is under 200px. No amount
     *    of styling or disableAutoSelect() removes it at size `large` — which
     *    is why it kept coming back.
     *
     * So: size `medium` for one predictable button for every visitor, and a
     * measure-and-correct pass for the width.
     *
     * https://developers.google.com/identity/gsi/web/guides/personalized-button
     * https://developers.google.com/identity/gsi/web/reference/js-reference
     */
    const target = (): number => Math.round(parent.getBoundingClientRect().width);

    const draw = (requested: number): void => {
      parent.replaceChildren();
      api.renderButton(parent, {
        type: 'standard',
        theme: 'outline',
        // NOT 'large': that is what re-enables the personalised button.
        size: 'medium',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: Math.min(Math.max(requested, 200), 400), // Google clamps at 400
      });
    };

    const paint = (): void => {
      const want = target();
      if (want < 40) return;                    // not laid out yet
      draw(want);
      requestAnimationFrame(() => {
        const painted = Math.round(parent.getBoundingClientRect().width);
        const over = painted - want;
        // One correction only. A loop here would fight the ResizeObserver.
        if (over > 1) draw(want - over);
        requestAnimationFrame(() => {
          // Google's own element, not our wrapper: the wrapper can stretch and
          // would report a height the button does not actually have.
          const el = (parent.firstElementChild as HTMLElement | null) ?? parent;
          const r = el.getBoundingClientRect();
          if (r.height > 20 && onMeasured) {
            onMeasured({ width: Math.round(r.width), height: Math.round(r.height) });
          }
        });
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
