import { HttpError, json } from "./_lib/http.js";

export async function onRequest({ request, next }) {
  try {
    const response = await next();
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Referrer-Policy", "no-referrer");
    headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: { code: error.code, message: error.message } }, error.status, error.headers);
    }
    console.error("Namaa API request failed.");
    return json({ error: { code: "internal_error", message: "The request could not be completed." } }, 500);
  }
}
