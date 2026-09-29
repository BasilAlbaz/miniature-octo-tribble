import { HttpError, json, readJson } from "../../../../_lib/http.js";
import { adminEmails, requireDatabase } from "../../../../_lib/config.js";
import { requireSession, verifyCsrf } from "../../../../_lib/session.js";

export async function onRequestPatch({ request, env, params }) {
  const actor = await requireSession(request, env);
  const allowlist = adminEmails(env);
  if (!allowlist.has(actor.email.toLowerCase())) {
    throw new HttpError(403, "admin_required", "Administrator access is required.");
  }
  await verifyCsrf(request, env, actor);
  const targetId = params.id;
  if (typeof targetId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(targetId)) {
    throw new HttpError(400, "invalid_user_id", "The user id is invalid.");
  }
  const body = await readJson(request, 1024);
  if (body.status !== "active" && body.status !== "suspended") {
    throw new HttpError(400, "invalid_status", "Status must be active or suspended.");
  }
  if (targetId === actor.id) {
    throw new HttpError(400, "cannot_change_self", "You cannot change your own account status.");
  }

  const db = requireDatabase(env);
  const target = await db.prepare("SELECT id, email, status FROM users WHERE id = ?")
    .bind(targetId).first();
  if (!target) throw new HttpError(404, "user_not_found", "The user was not found.");
  if (allowlist.has(target.email.toLowerCase())) {
    throw new HttpError(403, "admin_account_protected", "Administrator accounts cannot be changed here.");
  }
  const now = Math.floor(Date.now() / 1000);
  await db.batch([
    db.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?")
      .bind(body.status, now, targetId),
    ...(body.status === "suspended"
      ? [db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetId)]
      : []),
    db.prepare(
      "INSERT INTO audit_events (actor_user_id, target_user_id, action, created_at) VALUES (?, ?, ?, ?)"
    ).bind(actor.id, targetId, `user_status_${body.status}`, now)
  ]);
  return json({ ok: true, userId: targetId, status: body.status });
}
