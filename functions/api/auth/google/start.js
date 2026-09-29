import { assertRequestOrigin, requireGoogleConfig } from "../../../_lib/config.js";
import { base64Url, randomToken, sha256 } from "../../../_lib/crypto.js";
import { HttpError, redirect, setCookie } from "../../../_lib/http.js";
import { enforceRateLimit } from "../../../_lib/rate-limit.js";

const STATE_COOKIE = "__Host-namaa-oauth-state";
const STATE_SECONDS = 10 * 60;

export async function onRequestGet({ request, env }) {
  const config = requireGoogleConfig(env);
  assertRequestOrigin(request, config.origin);
  await enforceRateLimit(request, env, "oauth-start", 10);
  const now = Math.floor(Date.now() / 1000);
  const state = randomToken();
  const verifier = randomToken(48);
  const stateHash = await sha256(state);
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  await env.DB.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(now).run();
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
  await env.DB.prepare(
    "INSERT INTO oauth_states (state_hash, code_verifier, created_at, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(stateHash, verifier, now, now + STATE_SECONDS).run();

  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account"
  }).toString();
  return redirect(authorization.toString(), 302, {
    "Set-Cookie": setCookie(STATE_COOKIE, state, { maxAge: STATE_SECONDS })
  });
}
