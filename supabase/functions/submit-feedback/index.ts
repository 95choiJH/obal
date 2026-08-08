type SubmitFeedbackInput = {
  feedbackType?: string;
  message?: string;
  contact?: string;
  relatedLink?: string;
  extensionVersion?: string;
};

const MAX_MESSAGE_LENGTH = 1000;
const MAX_CONTACT_LENGTH = 320;
const MAX_LINK_LENGTH = 2000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 5;
const allowedTypes = new Set(["일정", "건의", "버그 제보", "문의", "기타"]);

function allowedOrigins() {
  return (Deno.env.get("FEEDBACK_ALLOWED_ORIGINS") || "")
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
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json; charset=utf-8" },
  });
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
      p_scope: "submit-feedback",
      p_client_key: await clientKey(request),
      p_window_seconds: Math.floor(WINDOW_MS / 1000),
      p_max_requests: MAX_REQUESTS_PER_WINDOW,
    }),
  });
  if (!response.ok) throw new Error(`rate-limit RPC failed: ${response.status}`);
  return (await response.json()) === true;
}

function cleanText(value: unknown, limit: number) {
  return String(value || "").trim().slice(0, limit);
}

function cleanRelatedLink(value: unknown) {
  const raw = cleanText(value, MAX_LINK_LENGTH);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return "";
    return parsed.href;
  } catch (_e) {
    return "";
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(request) });
  if (!isAllowedOrigin(request)) return jsonResponse(request, { error: "Origin not allowed" }, 403);
  if (request.method !== "POST") return jsonResponse(request, { error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(request, { error: "Missing server configuration" }, 500);
  }

  try {
    if (!(await checkRateLimit(request, supabaseUrl, serviceRoleKey))) {
      return jsonResponse(request, { error: "Too many requests" }, 429);
    }
  } catch (error) {
    console.error("rate-limit check failed", error);
    return jsonResponse(request, { error: "Rate limit unavailable" }, 503);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 16_384) return jsonResponse(request, { error: "Payload too large" }, 413);

  let input: SubmitFeedbackInput;
  try {
    input = await request.json();
  } catch (_e) {
    return jsonResponse(request, { error: "Invalid JSON" }, 400);
  }

  const type = allowedTypes.has(String(input.feedbackType || "")) ? String(input.feedbackType) : "기타";
  const message = cleanText(input.message, MAX_MESSAGE_LENGTH);
  const contact = cleanText(input.contact, MAX_CONTACT_LENGTH);
  const relatedLink = type === "일정" ? cleanRelatedLink(input.relatedLink) : "";
  const extensionVersion = cleanText(input.extensionVersion, 80);

  if (!message) return jsonResponse(request, { error: "Message is required" }, 400);
  if (type === "일정" && input.relatedLink && !relatedLink) {
    return jsonResponse(request, { error: "Invalid related link" }, 400);
  }

  const payload: Record<string, unknown> = {
    type,
    message,
    contact: contact || null,
    extension_version: extensionVersion || null,
  };
  if (relatedLink) payload.related_link = relatedLink;

  const res = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/rest/v1/feedback`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    console.error("feedback insert failed", res.status, errorText.slice(0, 500));
    return jsonResponse(request, { error: "Feedback insert failed" }, 502);
  }

  return jsonResponse(request, { ok: true });
});


