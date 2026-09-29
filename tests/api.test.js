import assert from "node:assert/strict";
import test from "node:test";
import { onRequestGet as startGoogleSignIn } from "../functions/api/auth/google/start.js";
import { onRequestGet as finishGoogleSignIn } from "../functions/api/auth/google/callback.js";
import { onRequestGet as adminOverview } from "../functions/api/admin/overview.js";
import { onRequestPatch as updateUserStatus } from "../functions/api/admin/users/[id]/status.js";
import { assertRequestOrigin } from "../functions/_lib/config.js";
import { base64Url, sha256 } from "../functions/_lib/crypto.js";
import { HttpError, getCookie } from "../functions/_lib/http.js";
import { issueSession, verifyCsrf } from "../functions/_lib/session.js";

function fakeDb({ first } = {}) {
  const calls = [];
  const db = {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            sql,
            args,
            async first() {
              calls.push({ method: "first", sql, args });
              return first ? first(sql, args) : null;
            },
            async run() {
              calls.push({ method: "run", sql, args });
              return { success: true };
            },
            async all() {
              calls.push({ method: "all", sql, args });
              return { results: [] };
            }
          };
        }
      };
    },
    async batch(statements) {
      calls.push({
        method: "batch",
        statements: statements.map((statement) => ({ sql: statement.sql, args: statement.args }))
      });
      return [];
    }
  };
  return db;
}

test("Google start creates server-side state and a PKCE challenge", async () => {
  let storedState;
  let storedVerifier;
  const DB = fakeDb({
    first: (sql) => sql.includes("INSERT INTO rate_limits") ? { request_count: 1 } : null
  });
  const originalRun = DB.prepare.bind(DB);
  DB.prepare = (sql) => {
    const statement = originalRun(sql);
    return {
      bind(...args) {
        const bound = statement.bind(...args);
        if (sql.includes("INSERT INTO oauth_states")) {
          storedState = args[0];
          storedVerifier = args[1];
        }
        return bound;
      }
    };
  };

  const response = await startGoogleSignIn({
    request: new Request("https://namaa.example/api/auth/google/start"),
    env: {
      DB,
      APP_ORIGIN: "https://namaa.example",
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret"
    }
  });
  const authorization = new URL(response.headers.get("Location"));
  const state = authorization.searchParams.get("state");
  assert.equal(authorization.origin, "https://accounts.google.com");
  assert.equal(authorization.searchParams.get("response_type"), "code");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(state, getCookie(new Request("https://namaa.example", {
    headers: { Cookie: response.headers.getSetCookie()[0].split(";")[0] }
  }), "__Host-namaa-oauth-state"));
  assert.equal(storedState, await sha256(state));
  assert.equal(
    authorization.searchParams.get("code_challenge"),
    base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(storedVerifier))))
  );
  assert.match(response.headers.getSetCookie()[0], /; Path=\/; Secure; SameSite=Lax; Max-Age=600; HttpOnly$/);
});

test("Google callback consumes one-time state and rejects an unverified email", async () => {
  const state = "one-time-state";
  let tokenExchangeBody;
  const DB = fakeDb({
    first(sql) {
      if (sql.includes("INSERT INTO rate_limits")) return { request_count: 1 };
      if (sql.includes("DELETE FROM oauth_states")) return { code_verifier: "one-time-verifier" };
      return null;
    }
  });
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async (_url, options) => {
    fetchCount += 1;
    if (fetchCount === 1) {
      tokenExchangeBody = new URLSearchParams(options.body);
      return Response.json({ access_token: "server-only-access-token" });
    }
    return Response.json({
      sub: "google-account",
      email: "student@example.com",
      email_verified: false
    });
  };
  try {
    const response = await finishGoogleSignIn({
      request: new Request(`https://namaa.example/api/auth/google/callback?code=authorization-code&state=${state}`, {
        headers: { Cookie: `__Host-namaa-oauth-state=${state}` }
      }),
      env: {
        DB,
        APP_ORIGIN: "https://namaa.example",
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret"
      }
    });
    assert.equal(response.status, 302);
    assert.equal(new URL(response.headers.get("Location")).searchParams.get("auth"), "error");
    assert.equal(tokenExchangeBody.get("code_verifier"), "one-time-verifier");
    assert.equal(DB.calls.filter((call) => call.sql?.includes("DELETE FROM oauth_states")).length, 2);
    assert.equal(DB.calls.some((call) => call.sql?.includes("INSERT INTO users")), false);
    assert.equal(response.headers.getSetCookie().length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Google callback redirects a signed-in user to the study profile", async () => {
  const state = "one-time-state";
  const DB = fakeDb({
    first(sql) {
      if (sql.includes("INSERT INTO rate_limits")) return { request_count: 1 };
      if (sql.includes("DELETE FROM oauth_states")) return { code_verifier: "one-time-verifier" };
      if (sql.includes("SELECT id, status FROM users")) return { id: "user-1", status: "active" };
      return null;
    }
  });
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return fetchCount === 1
      ? Response.json({ access_token: "server-only-access-token" })
      : Response.json({
        sub: "google-account",
        email: "student@example.com",
        email_verified: true,
        name: "Student"
      });
  };
  try {
    const response = await finishGoogleSignIn({
      request: new Request(`https://namaa.example/api/auth/google/callback?code=authorization-code&state=${state}`, {
        headers: { Cookie: `__Host-namaa-oauth-state=${state}` }
      }),
      env: {
        DB,
        APP_ORIGIN: "https://namaa.example",
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret"
      }
    });
    const destination = new URL(response.headers.get("Location"));
    assert.equal(destination.origin, "https://namaa.example");
    assert.equal(destination.pathname, "/");
    assert.equal(destination.hash, "#profile");
    assert.equal(destination.searchParams.has("auth"), false);
    assert.equal(response.headers.getSetCookie().length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("session cookies are secure and the session token is stored only as a hash", async () => {
  let insert;
  const DB = fakeDb();
  const originalPrepare = DB.prepare.bind(DB);
  DB.prepare = (sql) => {
    const statement = originalPrepare(sql);
    return {
      bind(...args) {
        if (sql.includes("INSERT INTO sessions")) insert = args;
        return statement.bind(...args);
      }
    };
  };
  const result = await issueSession(DB, "user-1");
  assert.equal(insert[1], "user-1");
  assert.equal(insert[0], await sha256(result.token));
  assert.notEqual(insert[0], result.token);
  assert.match(result.sessionCookie, /^__Host-namaa-session=.*; Path=\/; Secure; SameSite=Lax; Max-Age=604800; HttpOnly$/);
  assert.match(result.csrfCookie, /^__Host-namaa-csrf=.*; Path=\/; Secure; SameSite=Lax; Max-Age=604800$/);
  assert.doesNotMatch(result.csrfCookie, /HttpOnly/);
});

test("CSRF validation requires same-origin request and matching readable cookie/header", async () => {
  const csrf = "csrf-value";
  const session = { csrf_hash: await sha256(csrf) };
  const env = { APP_ORIGIN: "https://namaa.example" };
  const valid = new Request("https://namaa.example/api/auth/logout", {
    method: "POST",
    headers: {
      Origin: "https://namaa.example",
      "Sec-Fetch-Site": "same-origin",
      Cookie: `__Host-namaa-csrf=${csrf}`,
      "X-CSRF-Token": csrf
    }
  });
  await verifyCsrf(valid, env, session);
  const invalid = new Request("https://namaa.example/api/auth/logout", {
    method: "POST",
    headers: {
      Origin: "https://attacker.example",
      Cookie: `__Host-namaa-csrf=${csrf}`,
      "X-CSRF-Token": csrf
    }
  });
  await assert.rejects(verifyCsrf(invalid, env, session), (error) => error instanceof HttpError && error.status === 403);
  assert.throws(
    () => assertRequestOrigin(new Request("https://attacker.example/api"), "https://namaa.example"),
    (error) => error instanceof HttpError && error.status === 403
  );
});

test("admin overview denies a signed-in student account", async () => {
  const token = "valid-session-token";
  const DB = fakeDb({
    first(sql) {
      if (sql.includes("SELECT s.token_hash")) {
        return {
          token_hash: awaitableHash,
          csrf_hash: awaitableCsrfHash,
          expires_at: Math.floor(Date.now() / 1000) + 600,
          id: "student-1",
          email: "student@example.com",
          display_name: "Student",
          role: "student",
          status: "active"
        };
      }
      if (sql.includes("INSERT INTO rate_limits")) return { request_count: 1 };
      return null;
    }
  });
  const awaitableHash = await sha256(token);
  const awaitableCsrfHash = await sha256("stored-csrf");
  await assert.rejects(
    adminOverview({
      request: new Request("https://namaa.example/api/admin/overview", {
        headers: { Cookie: `__Host-namaa-session=${token}` }
      }),
      env: { DB, APP_ORIGIN: "https://namaa.example", ADMIN_EMAILS: "owner@example.com" }
    }),
    (error) => error instanceof HttpError && error.status === 403 && error.code === "admin_required"
  );
});

test("allowlisted admin can suspend a student and the change is audited", async () => {
  const token = "valid-admin-session";
  const csrf = "valid-csrf-token";
  const DB = fakeDb({
    first(sql) {
      if (sql.includes("SELECT s.token_hash")) {
        return {
          csrf_hash: awaitableCsrfHash,
          expires_at: Math.floor(Date.now() / 1000) + 600,
          id: "admin-1",
          email: "owner@example.com",
          display_name: "Owner",
          role: "student",
          status: "active"
        };
      }
      if (sql.includes("INSERT INTO rate_limits")) return { request_count: 1 };
      if (sql.includes("SELECT id, email, status FROM users")) {
        return { id: "student-1", email: "student@example.com", status: "active" };
      }
      return null;
    }
  });
  const awaitableCsrfHash = await sha256(csrf);
  const response = await updateUserStatus({
    request: new Request("https://namaa.example/api/admin/users/student-1/status", {
      method: "PATCH",
      headers: {
        Origin: "https://namaa.example",
        "Sec-Fetch-Site": "same-origin",
        Cookie: `__Host-namaa-session=${token}; __Host-namaa-csrf=${csrf}`,
        "X-CSRF-Token": csrf,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status: "suspended" })
    }),
    env: {
      DB,
      APP_ORIGIN: "https://namaa.example",
      ADMIN_EMAILS: "owner@example.com"
    },
    params: { id: "student-1" }
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, userId: "student-1", status: "suspended" });
  const statements = DB.calls.find((call) => call.method === "batch").statements;
  assert.equal(statements.some((statement) => statement.sql.includes("DELETE FROM sessions")), true);
  assert.equal(statements.some((statement) => statement.sql.includes("INSERT INTO audit_events")), true);
});
