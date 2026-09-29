import { HttpError, getCookie, setCookie } from "./http.js";
import { appOrigin, assertRequestOrigin, requireDatabase } from "./config.js";
import { constantTimeEqual, randomToken, sha256 } from "./crypto.js";
import { enforceRateLimit } from "./rate-limit.js";

export const SESSION_COOKIE = "__Host-namaa-session";
export const CSRF_COOKIE = "__Host-namaa-csrf";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

export async function getSession(request, env) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const db = requireDatabase(env);
  const tokenHash = await sha256(token);
  const row = await db.prepare(
    `SELECT s.token_hash, s.csrf_hash, s.expires_at, u.id, u.email, u.display_name, u.role, u.status
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`
  ).bind(tokenHash).first();
  if (!row || row.expires_at <= Math.floor(Date.now() / 1000)) return null;
  if (row.status !== "active") throw new HttpError(403, "account_suspended", "This account is unavailable.");
  await enforceRateLimit(request, env, "authenticated-api", 180, 60, row.id);
  return { ...row, tokenHash };
}

export async function issueSession(db, userId, previousToken) {
  const now = Math.floor(Date.now() / 1000);
  const token = randomToken();
  const csrfToken = randomToken();
  const tokenHash = await sha256(token);
  const csrfHash = await sha256(csrfToken);
  if (previousToken) {
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await sha256(previousToken))
      .run();
  }
  await db.prepare(
    "INSERT INTO sessions (token_hash, user_id, csrf_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(tokenHash, userId, csrfHash, now, now + SESSION_SECONDS).run();
  return {
    token,
    csrfToken,
    expiresIn: SESSION_SECONDS,
    sessionCookie: setCookie(SESSION_COOKIE, token, { maxAge: SESSION_SECONDS }),
    csrfCookie: setCookie(CSRF_COOKIE, csrfToken, { maxAge: SESSION_SECONDS, httpOnly: false })
  };
}

export async function csrfTokenFor(request, db, session) {
  const token = getCookie(request, CSRF_COOKIE);
  if (token && token.length <= 100 && constantTimeEqual(await sha256(token), session.csrf_hash)) {
    return { token, setCookie: null };
  }
  const nextToken = randomToken();
  await db.prepare("UPDATE sessions SET csrf_hash = ? WHERE token_hash = ?")
    .bind(await sha256(nextToken), session.tokenHash)
    .run();
  return {
    token: nextToken,
    setCookie: setCookie(CSRF_COOKIE, nextToken, {
      maxAge: Math.max(0, session.expires_at - Math.floor(Date.now() / 1000)),
      httpOnly: false
    })
  };
}

export async function requireSession(request, env) {
  const session = await getSession(request, env);
  if (!session) throw new HttpError(401, "authentication_required", "Sign in to continue.");
  return session;
}

export async function verifyCsrf(request, env, session) {
  const expectedOrigin = appOrigin(env);
  assertRequestOrigin(request, expectedOrigin);
  if (request.headers.get("Origin") !== expectedOrigin) {
    throw new HttpError(403, "csrf_check_failed", "This request could not be verified.");
  }
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && fetchSite !== "same-origin") {
    throw new HttpError(403, "csrf_check_failed", "This request could not be verified.");
  }
  const cookieToken = getCookie(request, CSRF_COOKIE);
  const headerToken = request.headers.get("X-CSRF-Token");
  if (
    !cookieToken || !headerToken || cookieToken.length > 100 ||
    !constantTimeEqual(cookieToken, headerToken) ||
    !constantTimeEqual(await sha256(cookieToken), session.csrf_hash)
  ) {
    throw new HttpError(403, "csrf_check_failed", "This request could not be verified.");
  }
}
