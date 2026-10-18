// Away mode: a privacy screen for when you step away. The PIN keeps a passer-by out of the dashboard; it is not
// account security (Windows' own lock, Win+L, is). Settings live in this browser only.

export interface LockPrefs {
  /** Lock after this many idle minutes; 0 is never. */
  autoMin: number;
  /** SHA-256 of the PIN, or null for "any key wakes it". */
  pinHash: string | null;
  /** The id of this app's Windows Hello key, when Windows Hello unlocks it. */
  hello: string | null;
}

const KEY = 'soul-engine:lock';
const LOCKED = 'soul-engine:locked';

export function readPrefs(): LockPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LockPrefs>;
    return { autoMin: typeof p.autoMin === 'number' ? p.autoMin : 10, pinHash: typeof p.pinHash === 'string' ? p.pinHash : null, hello: typeof p.hello === 'string' ? p.hello : null };
  } catch {
    return { autoMin: 10, pinHash: null, hello: null };
  }
}

export function writePrefs(p: LockPrefs) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private window */ }
}

/** Stays locked across a reload, so refreshing the page does not get past it. */
export function readLocked(): boolean {
  try { return localStorage.getItem(LOCKED) === '1'; } catch { return false; }
}
export function writeLocked(v: boolean) {
  try { if (v) localStorage.setItem(LOCKED, '1'); else localStorage.removeItem(LOCKED); } catch { /* private window */ }
}

export async function hashPin(pin: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`soul-engine:${pin}`));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- Windows Hello (or Touch ID, or a phone passkey) through WebAuthn ----
// The browser asks Windows to verify you (face, fingerprint or Windows PIN) and returns a signed answer for the
// key it made for this app. Unlocking needs that answer; a passer-by cannot give it. WebAuthn needs a name, not an
// IP address, so this works at http://localhost:7777, not at http://127.0.0.1:7777.

const b64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function helloAvailable(): Promise<'yes' | 'needs-localhost' | 'no'> {
  if (location.hostname !== 'localhost') return 'needs-localhost';
  try {
    return window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()) ? 'yes' : 'no';
  } catch {
    return 'no';
  }
}

/** Makes a key for this app in Windows Hello; returns its id to keep. */
export async function registerHello(): Promise<string> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'REKA Soul Engine', id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'soul-engine', displayName: 'REKA Soul Engine lock' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      attestation: 'none',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Windows Hello did not create a key.');
  return b64u(cred.rawId);
}

/** Asks Windows Hello to verify you with that key. Resolves true only when it did. */
export async function verifyHello(credId: string): Promise<boolean> {
  try {
    const a = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: fromB64u(credId) }],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return !!a;
  } catch {
    return false;
  }
}
