/**
 * Thin fetch client for the OREON FastAPI backend.
 *
 * Base URL resolution (in priority order):
 *  1. VITE_API_URL build-time env var — set this for local dev or multi-domain cloud deploys
 *  2. "" (empty string) — relative URL; works when nginx proxies /api/* to the backend
 *     on the same domain (standard production docker-compose / VPS setup)
 *
 * Local dev:  set VITE_API_URL=http://localhost:8000 in frontend/.env.local
 * Production: leave unset — nginx handles /api/* → backend routing
 */
const buildTimeUrl = import.meta.env.VITE_API_URL;

function resolveApiBase(): string {
  if (buildTimeUrl !== undefined && buildTimeUrl !== null && buildTimeUrl !== "") {
    return buildTimeUrl.replace(/\/$/, "");
  }

  if (typeof window === "undefined") {
    // Server-side (SSR) environment
    const serverUrl = typeof process !== "undefined"
      ? (process.env.VITE_API_URL || process.env.API_URL)
      : undefined;
    return serverUrl ? serverUrl.replace(/\/$/, "") : "http://localhost:8000";
  }

  // Client-side environment
  if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    return "http://localhost:8000";
  }
  return "";
}

export const API_BASE: string = resolveApiBase();

const V1 = `${API_BASE}/api/v1`;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type QueryParams = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, params?: QueryParams): string {
  const base = path.startsWith("http") ? path : `${V1}${path}`;
  if (!params) return base;
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      usp.append(key, String(value));
    }
  }
  const qs = usp.toString();
  return qs ? `${base}?${qs}` : base;
}

async function request<T>(
  method: string,
  path: string,
  opts: { params?: QueryParams; body?: unknown } = {},
): Promise<T> {
  const activeRole = typeof window !== "undefined" ? localStorage.getItem("oreon_role") || "operator" : "operator";
  const headers: Record<string, string> = {
    ...(opts.body ? { "Content-Type": "application/json" } : {}),
    "X-Oreon-Role": activeRole,
  };

  const res = await fetch(buildUrl(path, opts.params), {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = (data?.detail as string) ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const http = {
  get: <T>(path: string, params?: QueryParams) =>
    request<T>("GET", path, { params }),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, { body }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>("PATCH", path, { body }),
  delete: <T>(path: string) => request<T>("DELETE", path),
};
