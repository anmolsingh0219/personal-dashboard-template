import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppEnv } from "./env";

// Every /api request must carry a valid Cloudflare Access JWT. Access sits in front of the
// whole site and handles the Google sign-in; this check makes sure nobody can reach the
// Worker around it (e.g. through the raw workers.dev URL). Fails closed when unconfigured.

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function issuerFor(teamDomain: string) {
  const host = teamDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${host.includes(".") ? host : `${host}.cloudflareaccess.com`}`;
}

function isLocalhost(url: string) {
  const { hostname } = new URL(url);
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export const requireAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { ACCESS_TEAM_DOMAIN, ACCESS_AUD, DEV_AUTH_BYPASS } = c.env;

  if (DEV_AUTH_BYPASS === "1" && isLocalhost(c.req.url)) {
    c.set("userEmail", "dev@localhost");
    return next();
  }

  if (!ACCESS_TEAM_DOMAIN || !ACCESS_AUD) {
    return c.json({ error: "Cloudflare Access is not configured (set ACCESS_TEAM_DOMAIN and ACCESS_AUD)." }, 503);
  }

  const token = c.req.header("cf-access-jwt-assertion");
  if (!token) return c.json({ error: "Unauthorized" }, 401);

  const issuer = issuerFor(ACCESS_TEAM_DOMAIN);
  let jwks = jwksByIssuer.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksByIssuer.set(issuer, jwks);
  }

  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: ACCESS_AUD });
    c.set("userEmail", typeof payload.email === "string" ? payload.email : "");
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
};
