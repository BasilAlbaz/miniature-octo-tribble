import { HttpError, json, readJson } from "../../../_lib/http.js";
import { requireDatabase } from "../../../_lib/config.js";
import { requireSession, verifyCsrf } from "../../../_lib/session.js";

const KINDS = new Set(["question", "article", "flashcard", "case", "other"]);

function itemKey(params) {
  const key = params.itemKey;
  if (typeof key !== "string" || !/^[A-Za-z0-9._:-]{1,160}$/.test(key)) {
    throw new HttpError(400, "invalid_item_key", "The item key is invalid.");
  }
  return key;
}

export async function onRequestPut({ request, env, params }) {
  const session = await requireSession(request, env);
  await verifyCsrf(request, env, session);
  const key = itemKey(params);
  const body = await readJson(request, 8192);
  if (typeof body.kind !== "string" || !KINDS.has(body.kind)) {
    throw new HttpError(400, "invalid_kind", "The saved item kind is invalid.");
  }
  const metadata = body.metadata === undefined ? null : body.metadata;
  if (metadata !== null && (typeof metadata !== "object" || Array.isArray(metadata))) {
    throw new HttpError(400, "invalid_metadata", "Metadata must be a JSON object.");
  }
  const serialized = metadata === null ? null : JSON.stringify(metadata);
  if (serialized && new TextEncoder().encode(serialized).byteLength > 6000) {
    throw new HttpError(413, "payload_too_large", "The saved item metadata is too large.");
  }
  const now = Math.floor(Date.now() / 1000);
  await requireDatabase(env).prepare(
    `INSERT INTO saved_items (user_id, item_key, kind, metadata, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, item_key) DO UPDATE SET kind = excluded.kind, metadata = excluded.metadata`
  ).bind(session.id, key, body.kind, serialized, now).run();
  return json({ ok: true, itemKey: key });
}

export async function onRequestDelete({ request, env, params }) {
  const session = await requireSession(request, env);
  await verifyCsrf(request, env, session);
  const key = itemKey(params);
  await requireDatabase(env).prepare(
    "DELETE FROM saved_items WHERE user_id = ? AND item_key = ?"
  ).bind(session.id, key).run();
  return json({ ok: true });
}
