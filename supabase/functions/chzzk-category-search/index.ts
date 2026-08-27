// Chzzk category search proxy for admin game/category autocomplete.
// Deploy: supabase functions deploy chzzk-category-search
// Required env: CHZZK_CLIENT_ID, CHZZK_CLIENT_SECRET

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;
const MAX_KEYWORD_LENGTH = 40;

function allowedOrigins() {
  return (Deno.env.get("CHZZK_CATEGORY_SEARCH_ALLOWED_ORIGINS") || Deno.env.get("CHZZK_SEARCH_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function originMatches(origin: string, allowed: string) {
  if (allowed === origin) return true;
  if (allowed.endsWith("://*")) return origin.startsWith(allowed.slice(0, -1));
  return false;
}

function isAllowedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const configured = allowedOrigins();
  return !origin || !configured.length || configured.some((allowed) => originMatches(origin, allowed));
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin");
  const configured = allowedOrigins();
  const allowOrigin = origin && isAllowedOrigin(request) ? origin : (configured[0] || "*");
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
  };
}

async function clientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const raw = request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    (forwarded && forwarded[forwarded.length - 1]) ||
    "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function checkRateLimit(request: Request, supabaseUrl: string, serviceRoleKey: string) {
  const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/check_edge_rate_limit`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_scope: "chzzk-category-search",
      p_client_key: await clientKey(request),
      p_window_seconds: Math.floor(WINDOW_MS / 1000),
      p_max_requests: MAX_REQUESTS_PER_WINDOW,
    }),
  });
  if (!response.ok) throw new Error(`rate-limit RPC failed: ${response.status}`);
  return (await response.json()) === true;
}

function jsonResponse(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(req) });
  if (!isAllowedOrigin(req)) return jsonResponse(req, { error: "Origin not allowed" }, 403);
  if (req.method !== "GET") return jsonResponse(req, { error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const clientId = Deno.env.get("CHZZK_CLIENT_ID");
  const clientSecret = Deno.env.get("CHZZK_CLIENT_SECRET");
  if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret) {
    return jsonResponse(req, { error: "Missing server configuration" }, 500);
  }

  try {
    if (!(await checkRateLimit(req, supabaseUrl, serviceRoleKey))) {
      return jsonResponse(req, { error: "Too many requests" }, 429);
    }
  } catch (error) {
    console.error("rate-limit check failed", error);
    return jsonResponse(req, { error: "Rate limit unavailable" }, 503);
  }

  const url = new URL(req.url);
  const keyword = (url.searchParams.get("keyword") || url.searchParams.get("query") || "").trim().slice(0, MAX_KEYWORD_LENGTH);
  const requestedSize = Number(url.searchParams.get("size") || 8);
  const size = Math.max(1, Math.min(Number.isFinite(requestedSize) ? requestedSize : 8, 50));
  if (!keyword) return jsonResponse(req, { content: { data: [] } });

  const upstream = "https://openapi.chzzk.naver.com/open/v1/categories/search?query=" +
    encodeURIComponent(keyword) +
    "&size=" + encodeURIComponent(String(size));

  try {
    const res = await fetch(upstream, {
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Client-Id": clientId,
        "Client-Secret": clientSecret,
      },
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return jsonResponse(req, { error: String(e) }, 502);
  }
});