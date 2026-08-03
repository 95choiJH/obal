type FeedbackRecord = {
  type?: string | null;
  message?: string | null;
  related_link?: string | null;
  created_at?: string | null;
};

type DatabaseWebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: FeedbackRecord | null;
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
  const webhookSecret = Deno.env.get("FEEDBACK_WEBHOOK_SECRET");

  if (!botToken || !chatId || !webhookSecret) {
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }

  if (request.headers.get("x-webhook-secret") !== webhookSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let payload: DatabaseWebhookPayload;
  try {
    payload = await request.json();
  } catch (_e) {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const record = payload.record;
  if (payload.type !== "INSERT" || payload.table !== "feedback" || !record) {
    return jsonResponse({ skipped: true, reason: "Not a new feedback item" });
  }

  if (String(record.type || "").trim() !== "일정") {
    return jsonResponse({ skipped: true, reason: "Feedback type is not schedule" });
  }

  const message = String(record.message || "").trim() || "내용 없음";
  const relatedLink = String(record.related_link || "").trim();
  const createdAt = record.created_at
    ? new Date(record.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
    : new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });

  const text = [
    "<b>새 일정 제보</b>",
    "",
    escapeHtml(message),
    relatedLink ? "\n<b>관련 링크</b>\n" + escapeHtml(relatedLink) : "",
    "\n<b>접수 시각</b> " + escapeHtml(createdAt),
  ]
    .filter(Boolean)
    .join("\n");

  const telegramResponse = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    },
  );

  if (!telegramResponse.ok) {
    const errorText = await telegramResponse.text();
    console.error("Telegram sendMessage failed", telegramResponse.status, errorText);
    return jsonResponse({ error: "Telegram delivery failed" }, 502);
  }

  return jsonResponse({ delivered: true });
});
