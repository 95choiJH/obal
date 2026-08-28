// Sync the current CHZZK live category into the schedule date based on the live start time.
// Deploy: supabase functions deploy sync-live-category
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LIVE_CATEGORY_SYNC_SECRET
// Optional env: LIVE_CATEGORY_CHANNEL_ID, LIVE_CATEGORY_SYNC_TYPES (default: GAME), LIVE_CATEGORY_TIMEZONE_OFFSET_HOURS (default: 9)

const DEFAULT_CHANNEL_ID = "0dad8baf12a436f722faa8e5001c5011";
const AUTO_LIVE_CATEGORY_SYNC_SETTING_KEY = "auto_live_category_sync";

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function bearerToken(request: Request) {
  const value = request.headers.get("authorization") || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}

function isAuthorized(request: Request, serviceRoleKey: string, syncSecret: string) {
  const provided = request.headers.get("x-sync-secret") || bearerToken(request);
  return !!provided && (provided === syncSecret || provided === serviceRoleKey);
}

function dateKeyFromTimestamp(value: unknown, offsetHours: number) {
  if (!value) return "";
  const raw = String(value).trim();
  const localDateTime = raw.match(/^(\d{4}-\d{2}-\d{2})[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/);
  if (localDateTime) return localDateTime[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  const shifted = new Date(parsed.getTime() + offsetHours * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function currentDateKey(offsetHours: number) {
  return dateKeyFromTimestamp(new Date().toISOString(), offsetHours);
}

function liveStartTimestamp(live: Record<string, unknown>) {
  const candidates = [
    live.openDate,
    live.liveOpenDate,
    live.startDate,
    live.liveStartDate,
    live.createdDate,
    live.createdAt,
  ];
  return candidates.find((value) => value && !Number.isNaN(new Date(String(value)).getTime())) || "";
}

function liveScheduleDate(live: Record<string, unknown>, offsetHours: number) {
  return dateKeyFromTimestamp(liveStartTimestamp(live), offsetHours) || currentDateKey(offsetHours);
}

function allowedTypes() {
  return (Deno.env.get("LIVE_CATEGORY_SYNC_TYPES") || "GAME")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function normalizeGameImage(item: unknown) {
  if (!item || typeof item !== "object") return null;
  const source = item as Record<string, unknown>;
  const label = String(source.label || source.categoryValue || source.liveCategoryValue || source.title || source.name || source.game || "").trim();
  const url = String(source.url || source.imageUrl || source.src || "").trim();
  const categoryId = String(source.categoryId || source.liveCategory || "").trim();
  const categoryType = String(source.categoryType || "").trim().toUpperCase();
  const posterImageUrl = String(source.posterImageUrl || "").trim();
  return (label || url) ? { url, label, categoryId, categoryType, posterImageUrl } : null;
}

function sameCategory(a: ReturnType<typeof normalizeGameImage>, b: ReturnType<typeof normalizeGameImage>) {
  if (!a || !b) return false;
  if (a.categoryId && b.categoryId && a.categoryType && b.categoryType) {
    return a.categoryId === b.categoryId && a.categoryType === b.categoryType;
  }
  return !!a.label && !!b.label && a.label.trim().toLowerCase() === b.label.trim().toLowerCase();
}

function mergeGameImages(existing: unknown, current: ReturnType<typeof normalizeGameImage>) {
  const list = Array.isArray(existing) ? existing.map(normalizeGameImage).filter(Boolean) as NonNullable<ReturnType<typeof normalizeGameImage>>[] : [];
  if (!current) return { list, changed: false, action: "none" };
  const index = list.findIndex((item) => sameCategory(item, current));
  if (index >= 0) {
    const merged = { ...list[index], ...current, url: list[index].url || current.url || "" };
    const changed = JSON.stringify(list[index]) !== JSON.stringify(merged);
    list[index] = merged;
    return { list, changed, action: changed ? "updated" : "unchanged" };
  }
  list.push(current);
  return { list, changed: true, action: "added" };
}

function normalizePart(item: unknown) {
  if (typeof item === "string") {
    const content = item.trim();
    return content ? { content, label: "", displayType: "text", profile: null, collab: false, official: false, otherChannel: false, ad: false, outdoor: false, speculative: false, members: [], hostChannel: null, notes: [] } : null;
  }
  if (!item || typeof item !== "object") return null;
  const source = item as Record<string, unknown>;
  const content = String(source.content || source.title || source.label || "").trim();
  if (!content) return null;
  return {
    content,
    label: String(source.label || "").trim(),
    hidePartLabel: !!source.hidePartLabel,
    displayType: String(source.displayType || "text"),
    profile: source.profile || null,
    collab: !!source.collab,
    official: !!source.official,
    otherChannel: !!source.otherChannel,
    ad: !!source.ad,
    outdoor: !!source.outdoor,
    speculative: !!source.speculative,
    members: Array.isArray(source.members) ? source.members : [],
    hostChannel: source.hostChannel || null,
    notes: source.notes || null,
    autoCategory: !!source.autoCategory,
    categoryId: String(source.categoryId || "").trim(),
    categoryType: String(source.categoryType || "").trim().toUpperCase(),
  };
}

function samePartCategory(part: NonNullable<ReturnType<typeof normalizePart>>, category: NonNullable<ReturnType<typeof normalizeGameImage>>) {
  if (part.categoryId && category.categoryId && part.categoryType && category.categoryType) {
    return part.categoryId === category.categoryId && part.categoryType === category.categoryType;
  }
  return part.content.trim().toLowerCase() === category.label.trim().toLowerCase();
}

function partLabel(index: number) {
  return String(index + 1) + "부";
}

function mergeParts(existing: unknown, current: NonNullable<ReturnType<typeof normalizeGameImage>>) {
  const list = Array.isArray(existing) ? existing.map(normalizePart).filter(Boolean) as NonNullable<ReturnType<typeof normalizePart>>[] : [];
  const index = list.findIndex((part) => samePartCategory(part, current));
  if (index >= 0) {
    const merged = {
      ...list[index],
      content: list[index].content || current.label,
      categoryId: list[index].categoryId || current.categoryId,
      categoryType: list[index].categoryType || current.categoryType,
      autoCategory: true,
    };
    const changed = JSON.stringify(list[index]) !== JSON.stringify(merged);
    list[index] = merged;
    return { list, changed, action: changed ? "updated" : "unchanged" };
  }
  list.push({
    content: current.label,
    label: partLabel(list.length),
    hidePartLabel: false,
    displayType: "text",
    profile: null,
    collab: false,
    official: false,
    otherChannel: false,
    ad: false,
    outdoor: false,
    speculative: false,
    members: [],
    hostChannel: null,
    notes: [],
    autoCategory: true,
    categoryId: current.categoryId,
    categoryType: current.categoryType,
  });
  return { list, changed: true, action: "added" };
}
async function fetchJson(url: string) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`CHZZK HTTP ${res.status} ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

async function currentLiveCategory(channelId: string, offsetHours: number) {
  const statusUrl = "https://api.chzzk.naver.com/polling/v3.1/channels/" + encodeURIComponent(channelId) + "/live-status";
  const statusJson = await fetchJson(statusUrl);
  const live = statusJson && (statusJson.content || statusJson);
  const status = String((live && live.status) || "").toUpperCase();
  const scheduleDate = live && typeof live === "object" ? liveScheduleDate(live as Record<string, unknown>, offsetHours) : currentDateKey(offsetHours);
  const startedAt = live && typeof live === "object" ? String(liveStartTimestamp(live as Record<string, unknown>) || "") : "";
  if (status !== "OPEN") return { live: false, category: null, status, date: scheduleDate, startedAt };

  const category = normalizeGameImage({
    label: live.liveCategoryValue,
    categoryId: live.liveCategory,
    categoryType: live.categoryType,
  });
  if (!category || !category.label || !category.categoryId || !category.categoryType) {
    return { live: true, category: null, status, date: scheduleDate, startedAt };
  }

  try {
    const infoUrl = "https://api.chzzk.naver.com/service/v1/categories/" +
      encodeURIComponent(category.categoryType) + "/" + encodeURIComponent(category.categoryId) + "/info";
    const infoJson = await fetchJson(infoUrl);
    const info = infoJson && (infoJson.content || infoJson);
    category.posterImageUrl = String((info && info.posterImageUrl) || category.posterImageUrl || "").trim();
  } catch (error) {
    console.warn("category poster lookup failed", error);
  }

  return { live: true, category, status, date: scheduleDate, startedAt };
}

async function supabaseFetch(path: string, options: RequestInit, supabaseUrl: string, serviceRoleKey: string) {
  const res = await fetch(supabaseUrl.replace(/\/+$/, "") + path, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}


function autoLiveCategorySyncEnabledFromValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "enabled")) {
    return (value as Record<string, unknown>).enabled === true;
  }
  return false;
}

async function loadAutoLiveCategorySyncEnabled(channelId: string, supabaseUrl: string, serviceRoleKey: string) {
  const query = "/rest/v1/admin_settings?select=value&channel_id=eq." + encodeURIComponent(channelId) +
    "&key=eq." + encodeURIComponent(AUTO_LIVE_CATEGORY_SYNC_SETTING_KEY) + "&limit=1";
  try {
    const rows = await supabaseFetch(query, { method: "GET" }, supabaseUrl, serviceRoleKey) as Array<{ value: unknown }>;
    const row = rows && rows[0];
    return { enabled: row ? autoLiveCategorySyncEnabledFromValue(row.value) : false, source: row ? "db" : "default" };
  } catch (error) {
    console.warn("auto live category sync setting lookup failed", error);
    return { enabled: false, source: "default", warning: "settings-unavailable" };
  }
}
async function requestBody(request: Request) {
  if (request.method !== "POST") return {} as Record<string, unknown>;
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) return {} as Record<string, unknown>;
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {} as Record<string, unknown>;
  } catch (_error) {
    return {} as Record<string, unknown>;
  }
}

function testCategoriesFromBody(body: Record<string, unknown>) {
  const raw = body.testCategories || body.categories;
  return Array.isArray(raw) ? raw.map(normalizeGameImage).filter(Boolean) as NonNullable<ReturnType<typeof normalizeGameImage>>[] : [];
}

async function syncCategoriesToSchedule(
  channelId: string,
  date: string,
  categories: NonNullable<ReturnType<typeof normalizeGameImage>>[],
  typeAllowList: string[],
  startedAt: string,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const outcomes: Array<Record<string, unknown>> = [];
  const accepted = categories.filter((category) => {
    const allowed = typeAllowList.includes("*") || typeAllowList.includes(category.categoryType);
    if (!allowed) outcomes.push({ category: category.label, type: category.categoryType, result: "skipped" });
    return allowed;
  });

  if (!accepted.length) {
    return { synced: false, reason: categories.length ? "category-type-skipped" : "no-category", date, startedAt, outcomes, allowedTypes: typeAllowList };
  }

  const query = "/rest/v1/schedule?select=id,game_images,parts&channel_id=eq." + encodeURIComponent(channelId) +
    "&date=eq." + encodeURIComponent(date) + "&limit=1";
  const rows = await supabaseFetch(query, { method: "GET" }, supabaseUrl, serviceRoleKey) as Array<{ id: number; game_images: unknown; parts: unknown }>;
  const existing = rows && rows[0];
  let gameImages: unknown = existing && existing.game_images;
  let parts: unknown = existing && existing.parts;
  let changed = false;
  let lastAction = "unchanged";

  for (const category of accepted) {
    const gameMerge = mergeGameImages(gameImages, category);
    const partMerge = mergeParts(parts, category);
    gameImages = gameMerge.list;
    parts = partMerge.list;
    changed = changed || gameMerge.changed || partMerge.changed;
    lastAction = gameMerge.action === "unchanged" ? partMerge.action : gameMerge.action;
    outcomes.push({ category: category.label, type: category.categoryType, game: gameMerge.action, part: partMerge.action });
  }

  if (existing && !changed) {
    return { synced: false, reason: "already-present", date, startedAt, outcomes };
  }

  const payload = { game_images: gameImages, parts, updated_at: new Date().toISOString() };
  if (existing) {
    await supabaseFetch("/rest/v1/schedule?id=eq." + encodeURIComponent(String(existing.id)), {
      method: "PATCH",
      body: JSON.stringify(payload),
    }, supabaseUrl, serviceRoleKey);
  } else {
    await supabaseFetch("/rest/v1/schedule", {
      method: "POST",
      body: JSON.stringify({ channel_id: channelId, date, ...payload }),
    }, supabaseUrl, serviceRoleKey);
  }

  return { synced: true, action: accepted.length > 1 ? "merged" : lastAction, date, startedAt, outcomes, gameImages, parts };
}
Deno.serve(async (req) => {
  if (!["GET", "POST"].includes(req.method)) return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const syncSecret = Deno.env.get("LIVE_CATEGORY_SYNC_SECRET");
  if (!supabaseUrl || !serviceRoleKey || !syncSecret) {
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }
  if (!isAuthorized(req, serviceRoleKey, syncSecret)) return jsonResponse({ error: "Unauthorized" }, 401);

  const url = new URL(req.url);
  const channelId = (url.searchParams.get("channelId") || Deno.env.get("LIVE_CATEGORY_CHANNEL_ID") || DEFAULT_CHANNEL_ID).trim();
  if (!/^[0-9a-f]{32}$/i.test(channelId)) return jsonResponse({ error: "Invalid channel ID" }, 400);

  const offsetHoursValue = Number(Deno.env.get("LIVE_CATEGORY_TIMEZONE_OFFSET_HOURS") || 9);
  const offsetHours = Number.isFinite(offsetHoursValue) ? offsetHoursValue : 9;
  const typeAllowList = allowedTypes();

  try {
    const body = await requestBody(req);
    const syncSetting = await loadAutoLiveCategorySyncEnabled(channelId, supabaseUrl, serviceRoleKey);
    const testCategories = testCategoriesFromBody(body);
    if (!syncSetting.enabled) {
      return jsonResponse({ synced: false, reason: "disabled", setting: AUTO_LIVE_CATEGORY_SYNC_SETTING_KEY, mode: testCategories.length ? "test" : "live" });
    }
    if (testCategories.length) {
      const startedAt = String(body.startedAt || "");
      const date = String(body.date || dateKeyFromTimestamp(startedAt, offsetHours) || currentDateKey(offsetHours));
      const result = await syncCategoriesToSchedule(channelId, date, testCategories, typeAllowList, startedAt, supabaseUrl, serviceRoleKey);
      return jsonResponse({ ...result, mode: "test" });
    }

    const current = await currentLiveCategory(channelId, offsetHours);
    const date = current.date || currentDateKey(offsetHours);
    if (!current.live) return jsonResponse({ synced: false, reason: "not-live", status: current.status || "", date, startedAt: current.startedAt || "" });
    if (!current.category) return jsonResponse({ synced: false, reason: "no-category", date, startedAt: current.startedAt || "" });
    if (!typeAllowList.includes("*") && !typeAllowList.includes(current.category.categoryType)) {
      return jsonResponse({ synced: false, reason: "category-type-skipped", date, startedAt: current.startedAt || "", category: current.category, allowedTypes: typeAllowList });
    }

    const result = await syncCategoriesToSchedule(channelId, date, [current.category], typeAllowList, current.startedAt || "", supabaseUrl, serviceRoleKey);
    return jsonResponse({ ...result, category: current.category });
  } catch (error) {
    console.error("sync-live-category failed", error);
    return jsonResponse({ error: String((error && (error as Error).message) || error) }, 502);
  }
});