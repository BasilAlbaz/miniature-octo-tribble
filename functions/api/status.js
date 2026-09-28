export async function onRequestGet({ env }) {
  return Response.json({
    status: "demo",
    apiConfigured: Boolean(env.API_BASE_URL),
    message: "The study app is running in local demo mode."
  }, {
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
