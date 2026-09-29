import { HttpError, json } from "../../_lib/http.js";
import { adminEmails, requireDatabase } from "../../_lib/config.js";
import { requireSession } from "../../_lib/session.js";

async function requireAdmin(request, env) {
  const session = await requireSession(request, env);
  if (!adminEmails(env).has(session.email.toLowerCase())) {
    throw new HttpError(403, "admin_required", "Administrator access is required.");
  }
}

export async function onRequestGet({ request, env }) {
  await requireAdmin(request, env);
  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "50", 10) || 50));
  const offset = Math.min(5000, Math.max(0, Number.parseInt(url.searchParams.get("offset") || "0", 10) || 0));
  const result = await requireDatabase(env).prepare(
    `SELECT id, email, display_name, role, status, created_at FROM users
     ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all();
  return json({
    users: (result.results || []).map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      role: adminEmails(env).has(user.email.toLowerCase()) ? "admin" : "student",
      status: user.status,
      createdAt: user.created_at
    })),
    limit,
    offset
  });
}
