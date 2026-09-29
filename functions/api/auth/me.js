import { json } from "../../_lib/http.js";
import { adminEmails, requireDatabase } from "../../_lib/config.js";
import { csrfTokenFor, getSession } from "../../_lib/session.js";

export async function onRequestGet({ request, env }) {
  const session = await getSession(request, env);
  if (!session) return json({ authenticated: false, user: null });
  const csrf = await csrfTokenFor(request, requireDatabase(env), session);
  const headers = csrf.setCookie ? { "Set-Cookie": csrf.setCookie } : {};
  return json({
    authenticated: true,
    user: {
      id: session.id,
      email: session.email,
      displayName: session.display_name,
      role: adminEmails(env).has(session.email.toLowerCase()) ? "admin" : "student"
    },
    csrfToken: csrf.token
  }, 200, headers);
}
