import { appOrigin, assertRequestOrigin, requireDatabase } from "../../_lib/config.js";
import { clearCookie, json } from "../../_lib/http.js";
import { getSession, SESSION_COOKIE, CSRF_COOKIE, verifyCsrf } from "../../_lib/session.js";

export async function onRequestPost({ request, env }) {
  const session = await getSession(request, env);
  if (!session) {
    const origin = appOrigin(env);
    assertRequestOrigin(request, origin);
    if (request.headers.get("Origin") !== origin) {
      return json({ error: { code: "csrf_check_failed", message: "This request could not be verified." } }, 403);
    }
    return json({ error: { code: "authentication_required", message: "Sign in to continue." } }, 401, {
      "Set-Cookie": [clearCookie(SESSION_COOKIE), clearCookie(CSRF_COOKIE, { httpOnly: false })]
    });
  }
  await verifyCsrf(request, env, session);
  await requireDatabase(env).prepare("DELETE FROM sessions WHERE token_hash = ?").bind(session.tokenHash).run();
  return json({ ok: true }, 200, {
    "Set-Cookie": [
      clearCookie(SESSION_COOKIE),
      clearCookie(CSRF_COOKIE, { httpOnly: false })
    ]
  });
}
