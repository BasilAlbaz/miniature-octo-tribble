import { json } from "../../_lib/http.js";
import { requireDatabase } from "../../_lib/config.js";
import { requireSession } from "../../_lib/session.js";

export async function onRequestGet({ request, env }) {
  const session = await requireSession(request, env);
  const result = await requireDatabase(env).prepare(
    "SELECT item_key, payload, updated_at FROM study_progress WHERE user_id = ? ORDER BY updated_at DESC LIMIT 500"
  ).bind(session.id).all();
  return json({
    items: (result.results || []).map((row) => ({
      itemKey: row.item_key,
      payload: JSON.parse(row.payload),
      updatedAt: row.updated_at
    }))
  });
}
