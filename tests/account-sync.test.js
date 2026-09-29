import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiClientError,
  checkAccountService,
  mergeProgressPayloads,
  requestApi,
  serializedSize
} from "../public/account-sync.js";

test("API mutations use same-origin credentials and require the CSRF token", async () => {
  const originalFetch = globalThis.fetch;
  let call;
  globalThis.fetch = async (path, options) => {
    call = { path, options };
    return Response.json({ ok: true });
  };
  try {
    await assert.rejects(
      requestApi("/api/auth/logout", { method: "POST" }),
      (error) => error instanceof ApiClientError && error.code === "csrf_token_missing"
    );
    assert.equal(call, undefined);
    assert.deepEqual(await requestApi("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify({})
    }, "csrf-value"), { ok: true });
    assert.equal(call.path, "/api/auth/logout");
    assert.equal(call.options.credentials, "same-origin");
    assert.equal(call.options.cache, "no-store");
    assert.equal(call.options.headers.get("X-CSRF-Token"), "csrf-value");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("account probe reads the session only when the API is configured", async () => {
  const originalFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (path) => {
    paths.push(path);
    if (path === "/api/status") return Response.json({ status: "available", apiConfigured: true });
    return Response.json({
      authenticated: true,
      user: { email: "student@example.test", role: "student" },
      csrfToken: "csrf-value"
    });
  };
  try {
    const account = await checkAccountService();
    assert.equal(account.available, true);
    assert.equal(account.user.email, "student@example.test");
    assert.equal(account.csrfToken, "csrf-value");
    assert.deepEqual(paths, ["/api/status", "/api/auth/me"]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => Response.json(
    { status: "unavailable", apiConfigured: false },
    { status: 503 }
  );
  try {
    const account = await checkAccountService();
    assert.equal(account.available, false);
    assert.equal(account.user, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("progress merges preserve records and counters while using newer scalar values", () => {
  const merged = mergeProgressPayloads(
    {
      version: 1,
      modifiedAt: "2025-01-01T00:00:00.000Z",
      value: {
        history: [{ id: "local" }],
        tracker: { q1: { attempts: 3, flagged: true }, q2: { attempts: 1 } },
        ratings: { deckA: 4 },
        progress: { lessonA: 30 },
        currentStation: "interview"
      }
    },
    {
      version: 1,
      modifiedAt: "2025-01-02T00:00:00.000Z",
      value: {
        history: [{ id: "remote" }],
        tracker: { q1: { attempts: 2, flagged: false }, q3: { attempts: 4 } },
        ratings: { deckA: 2, deckB: 1 },
        progress: { lessonA: 20, lessonB: 100 },
        currentStation: "structure"
      }
    }
  );

  assert.deepEqual(merged.value.history.map((item) => item.id), ["local", "remote"]);
  assert.deepEqual(merged.value.tracker.q1, { attempts: 3, flagged: false });
  assert.deepEqual(merged.value.tracker.q2, { attempts: 1 });
  assert.deepEqual(merged.value.tracker.q3, { attempts: 4 });
  assert.deepEqual(merged.value.ratings, { deckA: 4, deckB: 1 });
  assert.deepEqual(merged.value.progress, { lessonA: 30, lessonB: 100 });
  assert.equal(merged.value.currentStation, "structure");
});

test("invalid progress records are rejected and payload sizing measures encoded JSON", async () => {
  assert.throws(
    () => mergeProgressPayloads(null, { version: 2, value: {} }),
    (error) => error instanceof ApiClientError && error.code === "invalid_progress_record"
  );
  assert.equal(serializedSize({ value: "é" }), new TextEncoder().encode('{"value":"é"}').byteLength);
  await assert.rejects(
    requestApi("https://elsewhere.example/api/auth/me"),
    (error) => error instanceof ApiClientError && error.code === "invalid_api_path"
  );
});
