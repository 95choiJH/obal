// Chzzk channel search proxy for admin autocomplete and directive profile lookup.
// Deploy: supabase functions deploy chzzk-search

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 30;
const MAX_KEYWORD_LENGTH = 40;
const buckets = new Map<string, { count: number; resetAt: number }>();

function allowedOrigins() {
  return (Deno.env.get("CHZZK_SEARCH_ALLOWED_ORIGINS") || "")
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

function clientKey(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("cf-connecting-ip") ||
    "unknown";
}

function checkRateLimit(request: Request) {
  const now = Date.now();
  const key = clientKey(request);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (bucket.count >= MAX_REQUESTS_PER_WINDOW) return false;
  bucket.count += 1;
  return true;
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
  if (!checkRateLimit(req)) return jsonResponse(req, { error: "Too many requests" }, 429);

  const url = new URL(req.url);
  const keyword = (url.searchParams.get("keyword") || "").trim().slice(0, MAX_KEYWORD_LENGTH);

  if (!keyword) return jsonResponse(req, { content: { data: [] } });

  const upstream =
    "https://api.chzzk.naver.com/service/v1/search/channels?keyword=" +
    encodeURIComponent(keyword) +
    "&offset=0&size=8&withFirstChannelContent=false";

  try {
    const res = await fetch(upstream, { headers: { Accept: "application/json" } });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return jsonResponse(req, { error: String(e) }, 502);
  }
});

