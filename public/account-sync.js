export class ApiClientError extends Error {
  constructor(message, status = 0, code = "request_failed") {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

export async function requestApi(path, options = {}, csrfToken = null) {
  if (typeof path !== "string" || !path.startsWith("/api/") || path.startsWith("//")) {
    throw new ApiClientError("Only same-origin API routes are supported.", 0, "invalid_api_path");
  }
  const method = String(options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (method !== "GET") {
    if (!csrfToken) throw new ApiClientError("A CSRF token is required.", 0, "csrf_token_missing");
    headers.set("X-CSRF-Token", csrfToken);
  }

  let response;
  try {
    response = await fetch(path, {
      ...options,
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store"
    });
  } catch {
    throw new ApiClientError("The account service could not be reached.", 0, "service_unavailable");
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiClientError(
      payload?.error?.message || `The account request failed (${response.status}).`,
      response.status,
      payload?.error?.code || "request_failed"
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ApiClientError("The account service returned an invalid response.", response.status, "invalid_response");
  }
  return payload;
}

export async function checkAccountService() {
  try {
    const status = await requestApi("/api/status");
    if (status.status !== "available" || status.apiConfigured !== true) {
      return { available: false, user: null, csrfToken: null };
    }
    const auth = await requestApi("/api/auth/me");
    if (auth.authenticated === true) {
      if (!auth.user || typeof auth.user.email !== "string" || typeof auth.csrfToken !== "string") {
        throw new ApiClientError("The account service returned incomplete session data.", 0, "invalid_session");
      }
      return { available: true, user: auth.user, csrfToken: auth.csrfToken };
    }
    if (auth.authenticated !== false) {
      throw new ApiClientError("The account service returned an invalid session state.", 0, "invalid_session");
    }
    return { available: true, user: null, csrfToken: null };
  } catch (error) {
    return {
      available: false,
      user: null,
      csrfToken: null,
      error: error instanceof ApiClientError ? error : new ApiClientError("The account service could not be reached.", 0, "service_unavailable")
    };
  }
}

function mergeValues(local, remote, path, preferLocal) {
  if (local === undefined) return remote;
  if (remote === undefined) return local;
  if (
    local && remote &&
    typeof local.present === "boolean" && typeof remote.present === "boolean" &&
    typeof local.changedAt === "string" && typeof remote.changedAt === "string"
  ) {
    return timestamp(local.changedAt) >= timestamp(remote.changedAt) ? local : remote;
  }
  if (Array.isArray(local) && Array.isArray(remote)) {
    const merged = new Map();
    for (const value of [...local, ...remote]) {
      const key = value && typeof value === "object"
        ? (typeof value.id === "string" ? `id:${value.id}` : JSON.stringify(value))
        : `${typeof value}:${String(value)}`;
      merged.set(key, merged.has(key) ? mergeValues(merged.get(key), value, path, preferLocal) : value);
    }
    return [...merged.values()];
  }
  if (
    local && remote &&
    typeof local === "object" && typeof remote === "object" &&
    !Array.isArray(local) && !Array.isArray(remote)
  ) {
    const merged = {};
    for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      merged[key] = mergeValues(local[key], remote[key], path ? `${path}.${key}` : key, preferLocal);
    }
    return merged;
  }
  if (
    (path.startsWith("ratings.") || path.startsWith("progress.") ||
      path.endsWith(".attempts") || path.endsWith(".correct")) &&
    typeof local === "number" && typeof remote === "number"
  ) {
    return Math.max(local, remote);
  }
  return preferLocal ? local : remote;
}

function timestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function mergeProgressPayloads(localPayload, remotePayload) {
  for (const payload of [localPayload, remotePayload]) {
    if (payload && (
      payload.version !== 1 ||
      !payload.value || typeof payload.value !== "object" || Array.isArray(payload.value)
    )) {
      throw new ApiClientError("A saved progress record is not compatible with this app.", 0, "invalid_progress_record");
    }
  }
  if (!localPayload) return remotePayload;
  if (!remotePayload) return localPayload;
  const preferLocal = timestamp(localPayload.modifiedAt) >= timestamp(remotePayload.modifiedAt);
  return {
    version: 1,
    modifiedAt: new Date(Math.max(timestamp(localPayload.modifiedAt), timestamp(remotePayload.modifiedAt), Date.now())).toISOString(),
    value: mergeValues(localPayload.value, remotePayload.value, "", preferLocal)
  };
}

export function serializedSize(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
