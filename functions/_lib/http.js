export class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function headersFrom(extraHeaders) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(extraHeaders)) {
    if (Array.isArray(value)) {
      for (const entry of value) headers.append(name, entry);
    } else {
      headers.set(name, value);
    }
  }
  return headers;
}

export function json(body, status = 200, extraHeaders = {}) {
  const headers = headersFrom(extraHeaders);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers });
}

export function redirect(location, status = 302, extraHeaders = {}) {
  const headers = headersFrom(extraHeaders);
  headers.set("Location", location);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(null, { status, headers });
}

export function setCookie(name, value, { maxAge, httpOnly = true } = {}) {
  const parts = [`${name}=${value}`, "Path=/", "Secure", "SameSite=Lax"];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  if (httpOnly) parts.push("HttpOnly");
  return parts.join("; ");
}

export function clearCookie(name, { httpOnly = true } = {}) {
  return setCookie(name, "", { maxAge: 0, httpOnly });
}

export function getCookie(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  for (const entry of cookies.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    if (entry.slice(0, separator).trim() === name) return entry.slice(separator + 1).trim();
  }
  return null;
}

export async function readJson(request, maxBytes = 16384) {
  const contentType = request.headers.get("Content-Type") || "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new HttpError(415, "unsupported_media_type", "Send a JSON request body.");
  }
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > maxBytes) {
    throw new HttpError(413, "payload_too_large", "The request body is too large.");
  }
  if (!request.body) throw new HttpError(400, "invalid_json", "A JSON request body is required.");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, "payload_too_large", "The request body is too large.");
    }
    chunks.push(value);
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("JSON body must be an object.");
    }
    return value;
  } catch {
    throw new HttpError(400, "invalid_json", "The request body must be a valid JSON object.");
  }
}
