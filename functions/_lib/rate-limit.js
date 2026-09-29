import { HttpError } from "./http.js";
import { sha256 } from "./crypto.js";
import { requireDatabase } from "./config.js";

export async function enforceRateLimit(request, env, category, limit, windowSeconds = 60, principal) {
  const db = requireDatabase(env);
  const identity = principal || request.headers.get("CF-Connecting-IP") || "unknown";
  const key = await sha256(`${category}:${identity}`);
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const result = await db.prepare(
    `INSERT INTO rate_limits (bucket_key, window_start, request_count) VALUES (?, ?, 1)
     ON CONFLICT(bucket_key) DO UPDATE SET
       request_count = CASE WHEN rate_limits.window_start < ? THEN 1 ELSE rate_limits.request_count + 1 END,
       window_start = CASE WHEN rate_limits.window_start < ? THEN ? ELSE rate_limits.window_start END
     RETURNING request_count`
  ).bind(key, windowStart, windowStart, windowStart, windowStart).first();
  if (result?.request_count > limit) {
    const retryAfter = Math.max(1, windowStart + windowSeconds - now);
    throw new HttpError(429, "rate_limited", "Too many requests. Try again shortly.", {
      "Retry-After": String(retryAfter)
    });
  }
}
