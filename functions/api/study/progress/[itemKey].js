import { HttpError, json, readJson } from "../../../_lib/http.js";
import { requireDatabase } from "../../../_lib/config.js";
import { requireSession, verifyCsrf } from "../../../_lib/session.js";

function itemKey(context) {
  const key = context.params.itemKey;
  if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(key)) {
    throw new HttpError(400, "invalid_item_key", "The item key is invalid.");
  }
  return key;
}

export async function onRequestPut({ request, env, params }) {
  const session = await requireSession(request, env);
  await verifyCsrf(request, env, session);
  const key = itemKey({ params });
  const body = await readJson(request, 16384);
  if (!body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) {
    throw new HttpError(400, "invalid_payload", "Payload must be a JSON object.");
  }
  const payload = JSON.stringify(body.payload);
  if (new TextEncoder().encode(payload).byteLength > 12000) {
    throw new HttpError(413, "payload_too_large", "The progress payload is too large.");
  }
  const now = Math.floor(Date.now() / 1000);
  await requireDatabase(env).prepare(
    `INSERT INTO study_progress (user_id, item_key, payload, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, item_key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`
  ).bind(session.id, key, payload, now).run();
  return json({ ok: true, itemKey: key, updatedAt: now });
}

export async function onRequestDelete({ request, env, params }) {
  const session = await requireSession(request, env);
  await verifyCsrf(request, env, session);
  const key = itemKey({ params });
  await requireDatabase(env).prepare(
    "DELETE FROM study_progress WHERE user_id = ? AND item_key = ?"
  ).bind(session.id, key).run();
  return json({ ok: true });
}
