// Sync the current CHZZK live category and title changes into the schedule date based on the live start time.
// Deploy: supabase functions deploy sync-live-category
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LIVE_CATEGORY_SYNC_SECRET
// Optional env: LIVE_CATEGORY_CHANNEL_ID, LIVE_CATEGORY_SYNC_TYPES (default: *), LIVE_CATEGORY_TIMEZONE_OFFSET_HOURS (default: 9)

const DEFAULT_CHANNEL_ID = "0dad8baf12a436f722faa8e5001c5011";
const AUTO_LIVE_CATEGORY_SYNC_SETTING_KEY = "auto_live_category_sync";
const LIVE_TITLE_HISTORY_TABLE = "live_title_history";

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

function liveTitle(live: Record<string, unknown>) {
  return String(live.liveTitle || live.title || live.liveName || "").trim();
}

function liveKey(live: Record<string, unknown>, scheduleDate: string, startedAt: string) {
  const candidates = [
    live.liveId,
    live.liveNo,
    live.livePlaybackJson && typeof live.livePlaybackJson === "object" ? (live.livePlaybackJson as Record<string, unknown>).liveId : "",
    live.openDate,
    live.liveOpenDate,
    startedAt,
  ];
  const key = candidates.find((value) => String(value || "").trim());
  return String(key || scheduleDate || "live").trim();
}

function allowedTypes() {
  return (Deno.env.get("LIVE_CATEGORY_SYNC_TYPES") || "*")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function normalizeGameImage(item: unknown) {
  if (!item || typeof item !== "object") return null;
  const source = item as Record<string, unknown>;
  const label = String(source.label || source.categoryValue || source.liveCategoryValue || source.title || source.name || source.game || "").trim();
  const posterImageUrl = String(source.posterImageUrl || "").trim();
  const url = String(source.url || source.imageUrl || source.src || posterImageUrl || "").trim();
  const categoryId = String(source.categoryId || source.liveCategory || "").trim();
  const categoryType = String(source.categoryType || "").trim().toUpperCase();
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
    const merged = { ...list[index], ...current, url: list[index].url || current.url || current.posterImageUrl || "" };
    const changed = JSON.stringify(list[index]) !== JSON.stringify(merged);
    list[index] = merged;
    return { list, changed, action: changed ? "updated" : "unchanged" };
  }
  list.push({ ...current, url: current.url || current.posterImageUrl || "" });
  return { list, changed: true, action: "added" };
}

function normalizePart(item: unknown) {
  if (typeof item === "string") {
    const content = item.trim();
    return content ? { content, label: "", categoryLabel: "", categoryId: "", categoryType: "", categoryPosterImageUrl: "", manualPartLabel: false, hidePartLabel: false, hiddenFromFront: false, displayType: "text", profile: null, collab: false, official: false, otherChannel: false, ad: false, outdoor: false, speculative: false, members: [], hostChannel: null, notes: [] } : null;
  }
  if (!item || typeof item !== "object") return null;
  const source = item as Record<string, unknown>;
  const content = String(source.content || source.title || source.label || "").trim();
  if (!content) return null;
  return {
    content,
    label: String(source.label || "").trim(),
    categoryLabel: String(source.categoryLabel || "").trim(),
    categoryPosterImageUrl: String(source.categoryPosterImageUrl || source.posterImageUrl || "").trim(),
    manualPartLabel: !!source.manualPartLabel,
    hidePartLabel: !!source.hidePartLabel,
    hiddenFromFront: !!source.hiddenFromFront,
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

function partCategoryLabel(part: NonNullable<ReturnType<typeof normalizePart>>) {
  return String(part.categoryLabel || (part.autoCategory ? part.content : "") || "").trim();
}

function samePartCategory(part: NonNullable<ReturnType<typeof normalizePart>>, category: NonNullable<ReturnType<typeof normalizeGameImage>>) {
  if (part.categoryId && category.categoryId && part.categoryType && category.categoryType) {
    return part.categoryId === category.categoryId && part.categoryType === category.categoryType;
  }
  return !!partCategoryLabel(part) && partCategoryLabel(part).toLowerCase() === category.label.trim().toLowerCase();
}

function nextVisiblePartLabel(parts: NonNullable<ReturnType<typeof normalizePart>>[]) {
  const visibleCount = parts.filter((part) => !part.hiddenFromFront && !part.hidePartLabel && !part.manualPartLabel).length;
  return String(visibleCount + 1) + "\uBD80";
}

function syncVisiblePartLabels(parts: NonNullable<ReturnType<typeof normalizePart>>[]) {
  let visibleIndex = 0;
  return parts.map((part) => {
    if (part.hiddenFromFront) return part;
    if (!part.hidePartLabel && !part.manualPartLabel) visibleIndex += 1;
    if (part.autoCategory && part.categoryType === "GAME" && !part.hidePartLabel && !part.manualPartLabel && !part.label) {
      return { ...part, label: String(visibleIndex) + "\uBD80" };
    }
    return part;
  });
}
function mergeParts(existing: unknown, current: NonNullable<ReturnType<typeof normalizeGameImage>>) {
  const list = Array.isArray(existing) ? existing.map(normalizePart).filter(Boolean) as NonNullable<ReturnType<typeof normalizePart>>[] : [];
  const index = list.findIndex((part) => samePartCategory(part, current));
  if (index >= 0) {
    const merged = {
      ...list[index],
      content: list[index].content || current.label,
      categoryLabel: list[index].categoryLabel || current.label,
      categoryId: list[index].categoryId || current.categoryId,
      categoryType: list[index].categoryType || current.categoryType,
      categoryPosterImageUrl: list[index].categoryPosterImageUrl || current.posterImageUrl,
      autoCategory: true,
      hiddenFromFront: list[index].hiddenFromFront || current.categoryType !== "GAME",
    };
    const changed = JSON.stringify(list[index]) !== JSON.stringify(merged);
    list[index] = merged;
    return { list: syncVisiblePartLabels(list), changed, action: changed ? "updated" : "unchanged" };
  }
  list.push({
    content: current.label,
    label: current.categoryType === "GAME" ? nextVisiblePartLabel(list) : "",
    categoryLabel: current.label,
    categoryPosterImageUrl: current.posterImageUrl,
    manualPartLabel: false,
    hidePartLabel: current.categoryType !== "GAME",
    hiddenFromFront: current.categoryType !== "GAME",
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
  return { list: syncVisiblePartLabels(list), changed: true, action: "added" };
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
  const title = live && typeof live === "object" ? liveTitle(live as Record<string, unknown>) : "";
  const key = live && typeof live === "object" ? liveKey(live as Record<string, unknown>, scheduleDate, startedAt) : "";
  if (status !== "OPEN") return { live: false, category: null, status, date: scheduleDate, startedAt, title, liveKey: key };

  const category = normalizeGameImage({
    label: live.liveCategoryValue,
    categoryId: live.liveCategory,
    categoryType: live.categoryType,
  });
  if (!category || !category.label || !category.categoryId || !category.categoryType) {
    return { live: true, category: null, status, date: scheduleDate, startedAt, title, liveKey: key };
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

  return { live: true, category, status, date: scheduleDate, startedAt, title, liveKey: key };
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

function sameTitleHistoryCategory(
  row: { category_id?: string | null; category_type?: string | null; category_label?: string | null },
  category: ReturnType<typeof normalizeGameImage>,
) {
  if (!category) return !String(row.category_id || row.category_type || row.category_label || "").trim();
  const rowCategoryId = String(row.category_id || "").trim();
  const rowCategoryType = String(row.category_type || "").trim().toUpperCase();
  if (rowCategoryId && category.categoryId && rowCategoryType && category.categoryType) {
    return rowCategoryId === category.categoryId && rowCategoryType === category.categoryType;
  }
  return String(row.category_label || "").trim().toLowerCase() === category.label.trim().toLowerCase();
}

async function recordLiveTitleChange(
  channelId: string,
  date: string,
  title: string,
  key: string,
  startedAt: string,
  category: ReturnType<typeof normalizeGameImage>,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const normalizedTitle = String(title || "").trim();
  if (!normalizedTitle) return { recorded: false, reason: "empty-title" };

  const normalizedKey = String(key || startedAt || date || "live").trim();
  const query = "/rest/v1/" + LIVE_TITLE_HISTORY_TABLE +
    "?select=id,title,category_label,category_id,category_type&channel_id=eq." + encodeURIComponent(channelId) +
    "&live_key=eq." + encodeURIComponent(normalizedKey) +
    "&order=changed_at.desc,id.desc&limit=1";
  const rows = await supabaseFetch(query, { method: "GET" }, supabaseUrl, serviceRoleKey) as Array<{ id: number; title: string; category_label?: string | null; category_id?: string | null; category_type?: string | null }>;
  const latest = rows && rows[0];
  const previousTitle = latest ? String(latest.title || "").trim() : "";
  const categoryUnchanged = latest ? sameTitleHistoryCategory(latest, category) : false;
  if (previousTitle === normalizedTitle && categoryUnchanged) {
    return { recorded: false, reason: "unchanged", title: normalizedTitle, previousTitle, category };
  }

  await supabaseFetch("/rest/v1/" + LIVE_TITLE_HISTORY_TABLE, {
    method: "POST",
    body: JSON.stringify({
      channel_id: channelId,
      live_key: normalizedKey,
      schedule_date: date,
      title: normalizedTitle,
      previous_title: previousTitle || null,
      category_label: category ? category.label : null,
      category_id: category ? category.categoryId || null : null,
      category_type: category ? category.categoryType || null : null,
      category_poster_image_url: category ? category.posterImageUrl || category.url || null : null,
      started_at: startedAt || null,
      changed_at: new Date().toISOString(),
    }),
  }, supabaseUrl, serviceRoleKey);

  return {
    recorded: true,
    action: previousTitle ? "changed" : "initial",
    title: normalizedTitle,
    previousTitle,
    liveKey: normalizedKey,
    category,
  };
}

async function safeRecordLiveTitleChange(
  channelId: string,
  date: string,
  title: string,
  key: string,
  startedAt: string,
  category: ReturnType<typeof normalizeGameImage>,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  try {
    return await recordLiveTitleChange(channelId, date, title, key, startedAt, category, supabaseUrl, serviceRoleKey);
  } catch (error) {
    console.warn("live title history write failed", error);
    return { recorded: false, reason: "write-failed", error: String((error && (error as Error).message) || error) };
  }
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
    if (testCategories.length) {
      const startedAt = String(body.startedAt || "");
      const date = String(body.date || dateKeyFromTimestamp(startedAt, offsetHours) || currentDateKey(offsetHours));
      const testTitle = String(body.liveTitle || body.title || "").trim();
      const titleHistory = testTitle
        ? await safeRecordLiveTitleChange(channelId, date, testTitle, String(body.liveKey || startedAt || date), startedAt, testCategories[0] || null, supabaseUrl, serviceRoleKey)
        : { recorded: false, reason: "empty-title" };
      if (!syncSetting.enabled) {
        return jsonResponse({ synced: false, reason: "disabled", setting: AUTO_LIVE_CATEGORY_SYNC_SETTING_KEY, mode: "test", titleHistory });
      }
      const result = await syncCategoriesToSchedule(channelId, date, testCategories, typeAllowList, startedAt, supabaseUrl, serviceRoleKey);
      return jsonResponse({ ...result, mode: "test", titleHistory });
    }

    const current = await currentLiveCategory(channelId, offsetHours);
    const date = current.date || currentDateKey(offsetHours);
    const titleHistory = current.live
      ? await safeRecordLiveTitleChange(channelId, date, current.title || "", current.liveKey || "", current.startedAt || "", current.category, supabaseUrl, serviceRoleKey)
      : { recorded: false, reason: "not-live" };
    if (!syncSetting.enabled) {
      return jsonResponse({ synced: false, reason: "disabled", setting: AUTO_LIVE_CATEGORY_SYNC_SETTING_KEY, mode: "live", titleHistory });
    }
    if (!current.live) return jsonResponse({ synced: false, reason: "not-live", status: current.status || "", date, startedAt: current.startedAt || "", titleHistory });
    if (!current.category) return jsonResponse({ synced: false, reason: "no-category", date, startedAt: current.startedAt || "", titleHistory });
    if (!typeAllowList.includes("*") && !typeAllowList.includes(current.category.categoryType)) {
      return jsonResponse({ synced: false, reason: "category-type-skipped", date, startedAt: current.startedAt || "", category: current.category, allowedTypes: typeAllowList, titleHistory });
    }

    const result = await syncCategoriesToSchedule(channelId, date, [current.category], typeAllowList, current.startedAt || "", supabaseUrl, serviceRoleKey);
    return jsonResponse({ ...result, category: current.category, titleHistory });
  } catch (error) {
    console.error("sync-live-category failed", error);
    return jsonResponse({ error: String((error && (error as Error).message) || error) }, 502);
  }
});