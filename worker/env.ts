export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  DEV_AUTH_BYPASS?: string;
  TOKEN_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  FINNHUB_API_KEY?: string;
  /** Web Push sender keys (VAPID): public key as a var, private scalar as a secret. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export interface AppEnv {
  Bindings: Bindings;
  Variables: { userEmail: string };
}

type ErrorCode = "google_not_connected" | "scope_missing" | "google_not_configured" | "not_found" | "bad_request";

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 500 | 502 | 503,
    message: string,
    public code?: ErrorCode,
  ) {
    super(message);
  }
}

export const newId = () => crypto.randomUUID();
