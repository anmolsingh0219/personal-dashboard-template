import type { ApiError as ApiErrorBody } from "../../shared/types";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: ApiErrorBody["code"],
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    // Cloudflare Access redirects expired sessions to its login page, which fetch can't follow.
    throw new ApiError(0, "Can't reach the server. If your session expired, reload the page.");
  }
  const data = (await res.json().catch(() => ({}))) as T & Partial<ApiErrorBody>;
  if (!res.ok) throw new ApiError(res.status, data.error ?? res.statusText, data.code);
  return data;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};
