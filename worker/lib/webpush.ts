// Web Push (RFC 8030) with message encryption (RFC 8291, aes128gcm) and VAPID sender
// identification (RFC 8292), built on WebCrypto so it runs in the Worker without Node APIs.

const enc = new TextEncoder();

export const b64u = {
  encode(bytes: Uint8Array) {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(s: string) {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
  },
};

export function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** P-256 private key as a JWK, from the raw public key (uncompressed point) and the private scalar. */
export function ecJwk(publicKey: Uint8Array, d: string): JsonWebKey {
  return { kty: "EC", crv: "P-256", x: b64u.encode(publicKey.slice(1, 33)), y: b64u.encode(publicKey.slice(33, 65)), d };
}

/**
 * Encrypts a push message for one subscription (RFC 8291). `salt` and `serverKeys` are only
 * passed by tests; normally both are fresh for every message.
 */
export async function encryptPayload(payload: Uint8Array, p256dh: string, auth: string, fixed?: { salt: Uint8Array; serverKeys: CryptoKeyPair }) {
  const uaPublic = b64u.decode(p256dh);
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const server = fixed?.serverKeys ?? ((await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", server.publicKey)) as ArrayBuffer);

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // Workers' types call the field `$public`; the runtime (like the spec) reads `public`.
  const ecdh = { name: "ECDH", public: uaKey } as SubtleCryptoDeriveKeyAlgorithm;
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdh, server.privateKey, 256));
  const ikm = await hkdf(b64u.decode(auth), ecdhSecret, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // A single record: the payload plus the 0x02 "last record" delimiter, no padding.
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2]))));

  const header = new Uint8Array(21 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url (65 bytes). Also the browser's applicationServerKey. */
  publicKey: string;
  /** Private scalar `d`, base64url. */
  privateKey: string;
  /** mailto: or https: contact for the push services. */
  subject: string;
}

/** `Authorization` header value identifying this sender to the push service (RFC 8292). */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()) {
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  // Apple rejects tokens valid for more than a day.
  const claims = b64u.encode(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })));
  const key = await crypto.subtle.importKey("jwk", ecJwk(b64u.decode(keys.publicKey), keys.privateKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64u.encode(signature)}, k=${keys.publicKey}`;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Page to open when the notification is tapped, e.g. "/#tasks". */
  url?: string;
  /** A newer notification with the same tag replaces the older one. */
  tag?: string;
}

/** Sends one notification; returns the push service's HTTP status (404/410 mean the subscription is gone). */
export async function sendPush(target: PushTarget, message: PushMessage, keys: VapidKeys, ttlSeconds = 12 * 3600) {
  const body = await encryptPayload(enc.encode(JSON.stringify(message)), target.p256dh, target.auth);
  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, keys),
      TTL: String(ttlSeconds),
      Urgency: "high",
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
    },
    body,
  });
  return res.status;
}

/** Push services this dashboard will deliver to (the Worker POSTs to whatever endpoint is saved). */
export function isPushEndpoint(endpoint: string) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && /(^|\.)(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/.test(u.hostname);
  } catch {
    return false;
  }
}
