import { adminEmails, assertRequestOrigin, requireGoogleConfig, requireDatabase } from "../../../_lib/config.js";
import { constantTimeEqual, sha256, randomToken } from "../../../_lib/crypto.js";
import { clearCookie, getCookie, HttpError, redirect } from "../../../_lib/http.js";
import { enforceRateLimit } from "../../../_lib/rate-limit.js";
import { issueSession } from "../../../_lib/session.js";

const STATE_COOKIE = "__Host-namaa-oauth-state";
const SESSION_COOKIE = "__Host-namaa-session";
const CSRF_COOKIE = "__Host-namaa-csrf";

function authPageRedirect(origin, outcome) {
  const target = new URL("/", origin);
  target.hash = "profile";
  if (outcome) target.searchParams.set("auth", outcome);
  return target.toString();
}

async function googleJson(url, options, maxBytes) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      ...options,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) return null;
    const contentLength = Number(response.headers.get("Content-Length") || 0);
    if (contentLength > maxBytes || !response.body) {
      await response.body?.cancel();
      return null;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return null;
    }
  } catch {
    if (controller.signal.aborted) {
      throw new HttpError(
        502,
        "identity_provider_timeout",
        "Google sign-in took too long. Please try again.",
        { "Set-Cookie": clearCookie(STATE_COOKIE) }
      );
    }
    throw new HttpError(
      502,
      "identity_provider_unavailable",
      "Google sign-in could not be completed.",
      { "Set-Cookie": clearCookie(STATE_COOKIE) }
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function onRequestGet({ request, env }) {
  const config = requireGoogleConfig(env);
  assertRequestOrigin(request, config.origin);
  await enforceRateLimit(request, env, "oauth-callback", 20);

  const params = new URL(request.url).searchParams;
  const stateCookie = getCookie(request, STATE_COOKIE);
  const stateQuery = params.get("state");
  if (
    !stateCookie || stateCookie.length > 100 || !stateQuery || stateQuery.length > 100 ||
    !constantTimeEqual(stateCookie, stateQuery)
  ) {
    throw new HttpError(400, "invalid_oauth_state", "The sign-in request could not be verified. Start again.");
  }
  const db = requireDatabase(env);
  const stateHash = await sha256(stateQuery);
  const now = Math.floor(Date.now() / 1000);
  await db.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(now).run();
  const pending = await db.prepare(
    "DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING code_verifier"
  ).bind(stateHash, now).first();
  if (!pending) {
    throw new HttpError(400, "expired_oauth_state", "The sign-in request expired. Start again.");
  }

  const oauthError = params.get("error");
  const code = params.get("code");
  if (oauthError || !code || code.length > 2048) {
    return redirect(authPageRedirect(config.origin, "error"), 302, {
      "Set-Cookie": clearCookie(STATE_COOKIE)
    });
  }

  const tokenBody = await googleJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.callbackUrl,
      grant_type: "authorization_code",
      code_verifier: pending.code_verifier
    })
  }, 16384);
  if (!tokenBody || typeof tokenBody.access_token !== "string" || !tokenBody.access_token || tokenBody.access_token.length > 8192) {
    return redirect(authPageRedirect(config.origin, "error"), 302, {
      "Set-Cookie": clearCookie(STATE_COOKIE)
    });
  }

  const profile = await googleJson("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` }
  }, 32768);
  if (
    !profile || typeof profile.sub !== "string" || !profile.sub || profile.sub.length > 255 ||
    typeof profile.email !== "string" || profile.email.length > 320 ||
    profile.email_verified !== true
  ) {
    return redirect(authPageRedirect(config.origin, "error"), 302, {
      "Set-Cookie": clearCookie(STATE_COOKIE)
    });
  }
  const email = profile.email.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return redirect(authPageRedirect(config.origin, "error"), 302, {
      "Set-Cookie": clearCookie(STATE_COOKIE)
    });
  }
  const displayName = typeof profile.name === "string" ? profile.name.trim().slice(0, 120) : "";
  const isAdmin = adminEmails(env).has(email);
  const role = isAdmin ? "admin" : "student";
  const userId = randomToken(18);
  await db.prepare(
    `INSERT INTO users (id, google_sub, email, display_name, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
     ON CONFLICT(google_sub) DO UPDATE SET
       email = excluded.email,
       display_name = excluded.display_name,
       role = excluded.role,
       updated_at = excluded.updated_at`
  ).bind(userId, profile.sub, email, displayName, role, now, now).run();
  const user = await db.prepare(
    "SELECT id, status FROM users WHERE google_sub = ?"
  ).bind(profile.sub).first();
  if (!user || user.status !== "active") {
    return redirect(authPageRedirect(config.origin, "error"), 302, {
      "Set-Cookie": clearCookie(STATE_COOKIE)
    });
  }

  const oldToken = getCookie(request, SESSION_COOKIE);
  const created = await issueSession(db, user.id, oldToken);
  return redirect(authPageRedirect(config.origin, null), 302, {
    "Set-Cookie": [
      clearCookie(STATE_COOKIE),
      created.sessionCookie,
      created.csrfCookie
    ]
  });
}
