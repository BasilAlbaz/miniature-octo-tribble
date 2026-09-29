import { adminEmails, assertRequestOrigin, requireGoogleConfig, requireDatabase } from "../../../_lib/config.js";
import { constantTimeEqual, sha256, randomToken } from "../../../_lib/crypto.js";
import { clearCookie, getCookie, HttpError, redirect, setCookie } from "../../../_lib/http.js";
import { enforceRateLimit } from "../../../_lib/rate-limit.js";
import { issueSession } from "../../../_lib/session.js";

const STATE_COOKIE = "__Host-namaa-oauth-state";
const SESSION_COOKIE = "__Host-namaa-session";
const CSRF_COOKIE = "__Host-namaa-csrf";

function authPageRedirect(origin, outcome) {
  const target = new URL("/admin.html", origin);
  if (outcome) target.searchParams.set("auth", outcome);
  return target.toString();
}

async function googleFetch(url, options) {
  try {
    return await fetch(url, options);
  } catch {
    throw new HttpError(502, "identity_provider_unavailable", "Google sign-in could not be completed.");
  }
}

export async function onRequestGet({ request, env }) {
  const config = requireGoogleConfig(env);
  assertRequestOrigin(request, config.origin);
  await enforceRateLimit(request, env, "oauth-callback", 20);

  const params = new URL(request.url).searchParams;
  const stateCookie = getCookie(request, STATE_COOKIE);
  const stateQuery = params.get("state");
  if (!stateCookie || !stateQuery || !constantTimeEqual(stateCookie, stateQuery)) {
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

  const tokenResponse = await googleFetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.callbackUrl,
      grant_type: "authorization_code",
      code_verifier: pending.code_verifier
    }),
    redirect: "error"
  });
  if (!tokenResponse.ok) {
    return redirect(authPageRedirect(config.origin, "error"), 302, {
      "Set-Cookie": clearCookie(STATE_COOKIE)
    });
  }
  const tokenBody = await tokenResponse.json().catch(() => null);
  if (!tokenBody || typeof tokenBody.access_token !== "string" || tokenBody.access_token.length > 8192) {
    return redirect(authPageRedirect(config.origin, "error"), 302, {
      "Set-Cookie": clearCookie(STATE_COOKIE)
    });
  }

  const userResponse = await googleFetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    redirect: "error"
  });
  if (!userResponse.ok) {
    return redirect(authPageRedirect(config.origin, "error"), 302, {
      "Set-Cookie": clearCookie(STATE_COOKIE)
    });
  }
  const profile = await userResponse.json().catch(() => null);
  if (
    !profile || typeof profile.sub !== "string" || profile.sub.length > 255 ||
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
