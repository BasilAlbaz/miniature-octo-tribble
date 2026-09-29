import { HttpError, json } from "../../_lib/http.js";
import { adminEmails, requireDatabase } from "../../_lib/config.js";
import { requireSession } from "../../_lib/session.js";

async function requireAdmin(request, env) {
  const session = await requireSession(request, env);
  if (!adminEmails(env).has(session.email.toLowerCase())) {
    throw new HttpError(403, "admin_required", "Administrator access is required.");
  }
  return session;
}

export async function onRequestGet({ request, env }) {
  await requireAdmin(request, env);
  const db = requireDatabase(env);
  const [users, progress, saved, audits] = await Promise.all([
    db.prepare("SELECT status, COUNT(*) AS total FROM users GROUP BY status").all(),
    db.prepare("SELECT COUNT(*) AS total FROM study_progress").first(),
    db.prepare("SELECT COUNT(*) AS total FROM saved_items").first(),
    db.prepare(
      "SELECT action, created_at FROM audit_events ORDER BY created_at DESC LIMIT 10"
    ).all()
  ]);
  const userCounts = { active: 0, suspended: 0 };
  for (const row of users.results || []) userCounts[row.status] = row.total;
  return json({
    users: userCounts,
    studyProgressRecords: progress?.total || 0,
    savedItems: saved?.total || 0,
    recentAdminEvents: (audits.results || []).map((row) => ({
      action: row.action,
      createdAt: row.created_at
    }))
  });
}
