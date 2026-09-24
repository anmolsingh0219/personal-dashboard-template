import { HttpError, type Bindings } from "../env";

// AES-GCM for OAuth tokens at rest. Stored format: base64(iv || ciphertext).

let cachedKey: { raw: string; key: CryptoKey } | null = null;

async function getKey(env: Bindings): Promise<CryptoKey> {
  const raw = env.TOKEN_KEY;
  if (!raw) throw new HttpError(500, "TOKEN_KEY is not set. See .dev.vars.example.");
  if (cachedKey?.raw === raw) return cachedKey.key;
  const bytes = Uint8Array.from(atob(raw), (ch) => ch.charCodeAt(0));
  if (bytes.length !== 32) throw new HttpError(500, "TOKEN_KEY must be 32 bytes, base64-encoded.");
  const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  cachedKey = { raw, key };
  return key;
}

const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

export async function encrypt(env: Bindings, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await getKey(env), new TextEncoder().encode(plain));
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), iv.length);
  return toB64(out);
}

export async function decrypt(env: Bindings, stored: string): Promise<string> {
  const bytes = fromB64(stored);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await getKey(env), bytes.slice(12));
  return new TextDecoder().decode(pt);
}
