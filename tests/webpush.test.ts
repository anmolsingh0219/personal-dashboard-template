import { describe, expect, it } from "vitest";
import { b64u, concat, ecJwk, encryptPayload, isPushEndpoint, vapidAuthorization } from "../worker/lib/webpush";

// RFC 8291, Section 5 and Appendix A.
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  header: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
};

describe("web push encryption", () => {
  it("matches the RFC 8291 example byte for byte", async () => {
    const asPublic = b64u.decode(RFC.asPublic);
    const serverKeys = {
      publicKey: await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, true, []),
      privateKey: await crypto.subtle.importKey("jwk", ecJwk(asPublic, RFC.asPrivate), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]),
    };
    const body = await encryptPayload(new TextEncoder().encode(RFC.plaintext), RFC.uaPublic, RFC.auth, { salt: b64u.decode(RFC.salt), serverKeys });
    expect(b64u.encode(body)).toBe(b64u.encode(concat(b64u.decode(RFC.header), b64u.decode(RFC.ciphertext))));
  });

  it("uses a fresh salt and key for every message", async () => {
    const a = await encryptPayload(new Uint8Array([1]), RFC.uaPublic, RFC.auth);
    const b = await encryptPayload(new Uint8Array([1]), RFC.uaPublic, RFC.auth);
    expect(b64u.encode(a.slice(0, 16))).not.toBe(b64u.encode(b.slice(0, 16)));
    expect(a.length).toBe(86 + 1 + 1 + 16); // header + payload + delimiter + GCM tag
  });
});

describe("VAPID", () => {
  it("signs a token the public key verifies, scoped to the push service", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const publicRaw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
    const { d } = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
    const keys = { publicKey: b64u.encode(publicRaw), privateKey: d!, subject: "https://dashboard.example.dev" };
    const now = Date.UTC(2026, 8, 23, 12);

    const value = await vapidAuthorization("https://web.push.apple.com/QGuQyavXutnMH...", keys, now);
    const [, token, k] = value.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);

    const [h, c, s] = token.split(".");
    const claims = JSON.parse(new TextDecoder().decode(b64u.decode(c)));
    expect(claims).toEqual({ aud: "https://web.push.apple.com", exp: now / 1000 + 12 * 3600, sub: keys.subject });
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, b64u.decode(s), new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });

  it("only delivers to known push services", () => {
    expect(isPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isPushEndpoint("https://evil.example.com/web.push.apple.com")).toBe(false);
    expect(isPushEndpoint("http://web.push.apple.com/abc")).toBe(false);
    expect(isPushEndpoint("not a url")).toBe(false);
  });
});
