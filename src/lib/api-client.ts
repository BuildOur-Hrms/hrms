/**
 * Browser-side client for `/api/v1`.
 *
 * Unwraps the `{ data, meta }` envelope and turns `{ error }` responses into a
 * thrown `ApiError` carrying the field-level `details`, so a form can map
 * server validation straight onto its inputs instead of showing a toast that
 * says "something was wrong somewhere".
 */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, string[]>;

  constructor(status: number, code: string, message: string, details?: Record<string, string[]>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }

  /** True when the caller should be sent back to the login screen. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }
}

export interface ListMeta {
  page: number;
  pageSize: number;
  total: number;
}

export interface Paged<T> {
  data: T[];
  meta: ListMeta;
}

const BASE = "/api/v1";

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = `${BASE}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";

  const response = await fetch(buildUrl(path, options.query), {
    method,
    headers: options.body ? { "Content-Type": "application/json" } : {},
    body: options.body ? JSON.stringify(options.body) : undefined,
    // The session cookie is httpOnly; `same-origin` is what sends it.
    credentials: "same-origin",
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = (
      payload as { error?: { code: string; message: string; details?: Record<string, string[]> } }
    )?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "INTERNAL",
      error?.message ?? "Something went wrong",
      error?.details,
    );
  }

  return (payload as { data: T }).data;
}

async function requestPaged<T>(path: string, options: RequestOptions = {}): Promise<Paged<T>> {
  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? "GET",
    credentials: "same-origin",
    ...(options.signal ? { signal: options.signal } : {}),
  });

  const payload = (await response.json()) as
    | { data: T[]; meta: ListMeta }
    | { error: { code: string; message: string; details?: Record<string, string[]> } };

  if (!response.ok) {
    const error = (
      payload as { error: { code: string; message: string; details?: Record<string, string[]> } }
    ).error;
    throw new ApiError(response.status, error.code, error.message, error.details);
  }

  return payload as Paged<T>;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions["query"], signal?: AbortSignal) =>
    request<T>(path, { method: "GET", ...(query ? { query } : {}), ...(signal ? { signal } : {}) }),
  list: <T>(path: string, query?: RequestOptions["query"], signal?: AbortSignal) =>
    requestPaged<T>(path, { ...(query ? { query } : {}), ...(signal ? { signal } : {}) }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

/**
 * Map an ApiError's `details` onto react-hook-form fields, falling back to a
 * form-level message for anything that does not name a field.
 */
export function applyServerErrors(
  error: unknown,
  setError: (field: string, error: { type: string; message: string }) => void,
): string | null {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : "Something went wrong";
  }
  if (!error.details) return error.message;

  let matched = false;
  for (const [field, messages] of Object.entries(error.details)) {
    if (field === "_") continue;
    matched = true;
    setError(field, { type: "server", message: messages.join(", ") });
  }
  return matched ? null : error.message;
}
