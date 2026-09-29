import { json } from "../_lib/http.js";
import { appOrigin } from "../_lib/config.js";

export async function onRequestGet({ env }) {
  let originConfigured = false;
  try {
    appOrigin(env);
    originConfigured = true;
  } catch {
    originConfigured = false;
  }
  const configured = Boolean(env.DB && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && originConfigured);
  return json({
    status: configured ? "available" : "unavailable",
    apiConfigured: configured
  }, configured ? 200 : 503);
}
