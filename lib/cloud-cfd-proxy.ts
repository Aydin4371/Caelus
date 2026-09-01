export type CloudCfdProxyEnv = {
  KYTHROS_CFD_GATEWAY_URL?: string;
  KYTHROS_CFD_GATEWAY_TOKEN?: string;
};

const API_PREFIX = "/api/cloud-cfd";

function json(status: number, value: unknown) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export async function handleCloudCfdProxy(request: Request, env: CloudCfdProxyEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const source = new URL(request.url);
  if (!source.pathname.startsWith(API_PREFIX)) return json(404, { error: "Unknown cloud CFD route." });

  const gatewayUrl = env.KYTHROS_CFD_GATEWAY_URL?.replace(/\/$/, "");
  const gatewayToken = env.KYTHROS_CFD_GATEWAY_TOKEN;
  if (!gatewayUrl || !gatewayToken) {
    return json(503, {
      status: "unavailable",
      provider: "Google Cloud Run",
      region: null,
      message: "Cloud execution has not been connected to a Kythros Google Cloud project yet.",
      tiers: [],
      error: "Cloud execution has not been activated for this deployment.",
    });
  }

  const user = request.headers.get("oai-authenticated-user-email");
  const isHealth = source.pathname === `${API_PREFIX}/health` && request.method === "GET";
  if (!user && !isHealth) return json(401, { error: "Sign in before starting a paid cloud simulation." });
  if (!["GET", "POST", "DELETE"].includes(request.method)) return json(405, { error: "Unsupported cloud CFD request." });

  const suffix = source.pathname.slice(API_PREFIX.length);
  const target = new URL(`/v1${suffix}${source.search}`, `${gatewayUrl}/`);
  const headers = new Headers({ authorization: `Bearer ${gatewayToken}`, accept: "application/json" });
  if (user) headers.set("x-kythros-user", user);
  if (request.headers.get("content-type")) headers.set("content-type", request.headers.get("content-type")!);

  try {
    const response = await fetchImpl(target, {
      method: request.method,
      headers,
      body: request.method === "GET" ? undefined : request.body,
      redirect: "error",
    });
    return new Response(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
  } catch {
    return json(502, { error: "Kythros could not reach the Google Cloud execution gateway." });
  }
}
