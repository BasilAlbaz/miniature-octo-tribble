import { json } from "../../_lib/http.js";
import { requireDatabase } from "../../_lib/config.js";
import { requireSession } from "../../_lib/session.js";

export async function onRequestGet({ request, env }) {
  const session = await requireSession(request, env);
  const result = await requireDatabase(env).prepare(
    "SELECT item_key, kind, metadata, created_at FROM saved_items WHERE user_id = ? ORDER BY created_at DESC LIMIT 500"
  ).bind(session.id).all();
  return json({
    items: (result.results || []).map((row) => ({
      itemKey: row.item_key,
      kind: row.kind,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.created_at
    }))
  });
}
