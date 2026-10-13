const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:3000/api/v1";

const TOKEN_STORAGE_KEY = "testops.accessToken";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
  else localStorage.removeItem(TOKEN_STORAGE_KEY);
}

/** Requests where 401 means wrong credentials rather than an ended session. */
const CREDENTIAL_CHECKS = ["/auth/login", "/auth/register", "/auth/me/password"];

let sessionExpiredListener: (() => void) | null = null;

/**
 * Called when a request that carried a session token gets 401: the session expired or was
 * ended elsewhere. The token is already dropped when the listener runs.
 */
export function onSessionExpired(listener: (() => void) | null) {
  sessionExpiredListener = listener;
}

/**
 * Whether the token a request was sent with is still the session's token. A 401 for a token that
 * was replaced meanwhile (a new sign-in, a password change) must not end the new session.
 */
function isCurrentToken(token: string | null): token is string {
  return token !== null && getToken() === token;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    // FormData sets its own multipart Content-Type with the boundary.
    ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((options.headers as Record<string, string>) ?? {}),
  };

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (res.status === 401 && isCurrentToken(token) && !CREDENTIAL_CHECKS.some((p) => path.startsWith(p))) {
    setToken(null);
    sessionExpiredListener?.();
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.message ?? message;
    } catch {
      /* ignore non-JSON error body */
    }
    throw new ApiError(
      res.status,
      Array.isArray(message) ? message.join(", ") : message,
    );
  }
  // Endpoints such as DELETE may return 200/204 without a body; an empty body is not JSON.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  /** Multipart upload, e.g. attachment files under the field name the endpoint expects. */
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
};

/** Downloads a protected file (the session token can't be sent with a plain link) and saves it. */
export async function downloadFile(path: string, fileName: string) {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401 && isCurrentToken(token)) {
    setToken(null);
    sessionExpiredListener?.();
  }
  if (!res.ok) throw new ApiError(res.status, res.statusText || "Download failed");
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
