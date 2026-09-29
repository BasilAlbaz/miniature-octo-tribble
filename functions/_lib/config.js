import { HttpError } from "./http.js";

export function appOrigin(env) {
  if (!env.APP_ORIGIN) {
    throw new HttpError(503, "service_unavailable", "Authentication is not configured.");
  }
  let parsed;
  try {
    parsed = new URL(env.APP_ORIGIN);
  } catch {
    throw new HttpError(503, "service_unavailable", "Authentication is not configured.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash ||
    (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:"))
  ) {
    throw new HttpError(503, "service_unavailable", "Authentication is not configured.");
  }
  return parsed.origin;
}

export function requireDatabase(env) {
  if (!env.DB) throw new HttpError(503, "service_unavailable", "The API is not configured.");
  return env.DB;
}

export function requireGoogleConfig(env) {
  const origin = appOrigin(env);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.DB) {
    throw new HttpError(503, "service_unavailable", "Authentication is not configured.");
  }
  return {
    origin,
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    callbackUrl: `${origin}/api/auth/google/callback`
  };
}

export function assertRequestOrigin(request, expectedOrigin) {
  if (new URL(request.url).origin !== expectedOrigin) {
    throw new HttpError(403, "origin_not_allowed", "This request origin is not allowed.");
  }
}

export function adminEmails(env) {
  return new Set(
    (env.ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}
