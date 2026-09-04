// Sync the current CHZZK live category and title changes into the schedule date based on the live start time.
// Deploy: supabase functions deploy sync-live-category
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LIVE_CATEGORY_SYNC_SECRET
// Optional env: LIVE_CATEGORY_CHANNEL_ID, LIVE_CATEGORY_SYNC_TYPES (default: *), LIVE_CATEGORY_TIMEZONE_OFFSET_HOURS (default: 9)

const DEFAULT_CHANNEL_ID = "0dad8baf12a436f722faa8e5001c5011";
const AUTO_LIVE_CATEGORY_SYNC_SETTING_KEY = "auto_live_category_sync";
const LIVE_TITLE_HISTORY_TABLE = "live_title_history";
const LIVE_CATEGORY_HISTORY_TABLE = "live_category_history";
const LIVE_SESSION_STATE_TABLE = "live_session_state";
const LIVE_CONTINUATION_WINDOW_MS = 2 * 60 * 60 * 1000;

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

function timestampMs(value: unknown) {
  const time = value ? new Date(String(value)).getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
}

function chzzkTimestampMs(value: unknown, offsetHours: number) {
  if (!value) return 0;
  const raw = String(value).trim();
  if (!raw) return 0;
  const localDateTime = raw.match(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/);
  const parsed = new Date(localDateTime ? raw.replace(" ", "T") + timezoneOffsetSuffix(offsetHours) : raw);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function timezoneOffsetSuffix(offsetHours: number) {
  const sign = offsetHours >= 0 ? "+" : "-";
  const abs = Math.abs(offsetHours);
  const hours = String(Math.floor(abs)).padStart(2, "0");
  const minutes = String(Math.round((abs - Math.floor(abs)) * 60)).padStart(2, "0");
  return sign + hours + ":" + minutes;
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
type LiveSessionState = {
  id?: number;
  channel_id: string;
  live_key: string | null;
  schedule_date: string | null;
  started_at: string | null;
  last_seen_at: string | null;
  ended_at: string | null;
  title: string | null;
  vod_url: string | null;
  vod_video_no: string | null;
  vod_saved_at: string | null;
  vod_checked_at: string | null;
  is_live: boolean | null;
  updated_at: string | null;
};

const LIVE_SESSION_STATE_SELECT = "id,channel_id,live_key,schedule_date,started_at,last_seen_at,ended_at,title,vod_url,vod_video_no,vod_saved_at,vod_checked_at,is_live,updated_at";

async function loadLatestLiveSessionState(channelId: string, supabaseUrl: string, serviceRoleKey: string) {
  const query = "/rest/v1/" + LIVE_SESSION_STATE_TABLE +
    "?select=" + LIVE_SESSION_STATE_SELECT + "&channel_id=eq." + encodeURIComponent(channelId) +
    "&order=updated_at.desc&limit=1";
  const rows = await supabaseFetch(query, { method: "GET" }, supabaseUrl, serviceRoleKey) as LiveSessionState[];
  return rows && rows[0] ? rows[0] : null;
}

async function loadActiveLiveSessionState(channelId: string, supabaseUrl: string, serviceRoleKey: string) {
  const query = "/rest/v1/" + LIVE_SESSION_STATE_TABLE +
    "?select=" + LIVE_SESSION_STATE_SELECT + "&channel_id=eq." + encodeURIComponent(channelId) +
    "&is_live=eq.true&order=updated_at.desc&limit=1";
  const rows = await supabaseFetch(query, { method: "GET" }, supabaseUrl, serviceRoleKey) as LiveSessionState[];
  return rows && rows[0] ? rows[0] : null;
}

async function loadLiveSessionStateByKey(channelId: string, liveKey: string, supabaseUrl: string, serviceRoleKey: string) {
  const key = String(liveKey || "").trim();
  if (!key) return null;
  const query = "/rest/v1/" + LIVE_SESSION_STATE_TABLE +
    "?select=" + LIVE_SESSION_STATE_SELECT + "&channel_id=eq." + encodeURIComponent(channelId) +
    "&live_key=eq." + encodeURIComponent(key) + "&limit=1";
  const rows = await supabaseFetch(query, { method: "GET" }, supabaseUrl, serviceRoleKey) as LiveSessionState[];
  return rows && rows[0] ? rows[0] : null;
}

async function loadPendingVodSessions(channelId: string, supabaseUrl: string, serviceRoleKey: string) {
  const query = "/rest/v1/" + LIVE_SESSION_STATE_TABLE +
    "?select=" + LIVE_SESSION_STATE_SELECT + "&channel_id=eq." + encodeURIComponent(channelId) +
    "&is_live=eq.false&or=(vod_saved_at.is.null,vod_url.is.null)&order=ended_at.asc.nullslast,updated_at.asc&limit=8";
  const rows = await supabaseFetch(query, { method: "GET" }, supabaseUrl, serviceRoleKey) as LiveSessionState[];
  return Array.isArray(rows) ? rows : [];
}

async function updateLiveSessionState(channelId: string, state: Partial<LiveSessionState>, supabaseUrl: string, serviceRoleKey: string) {
  const now = new Date().toISOString();
  const liveKey = String(state.live_key || "").trim();
  const existing = state.id
    ? { id: state.id } as LiveSessionState
    : liveKey
      ? await loadLiveSessionStateByKey(channelId, liveKey, supabaseUrl, serviceRoleKey)
      : await loadLatestLiveSessionState(channelId, supabaseUrl, serviceRoleKey);
  const payload = { channel_id: channelId, ...state, updated_at: now };
  if (existing && existing.id) {
    await supabaseFetch("/rest/v1/" + LIVE_SESSION_STATE_TABLE + "?id=eq." + encodeURIComponent(String(existing.id)), {
      method: "PATCH",
      body: JSON.stringify(payload),
    }, supabaseUrl, serviceRoleKey);
    return;
  }
  await supabaseFetch("/rest/v1/" + LIVE_SESSION_STATE_TABLE, {
    method: "POST",
    body: JSON.stringify(payload),
  }, supabaseUrl, serviceRoleKey);
}

async function markLiveSessionEndedIfNeeded(channelId: string, supabaseUrl: string, serviceRoleKey: string) {
  try {
    const previous = await loadActiveLiveSessionState(channelId, supabaseUrl, serviceRoleKey);
    if (!previous || previous.is_live === false) return { updated: false, reason: previous ? "already-ended" : "empty", session: previous || null };
    const endedAt = new Date().toISOString();
    await updateLiveSessionState(channelId, {
      live_key: previous.live_key || null,
      schedule_date: previous.schedule_date || null,
      started_at: previous.started_at || null,
      last_seen_at: previous.last_seen_at || endedAt,
      ended_at: endedAt,
      title: previous.title || null,
      vod_url: previous.vod_url || null,
      vod_video_no: previous.vod_video_no || null,
      vod_saved_at: previous.vod_saved_at || null,
      vod_checked_at: previous.vod_checked_at || null,
      is_live: false,
    }, supabaseUrl, serviceRoleKey);
    return { updated: true, endedAt, scheduleDate: previous.schedule_date || "", liveKey: previous.live_key || "", session: { ...previous, ended_at: endedAt, is_live: false } };
  } catch (error) {
    console.warn("live session end state update failed", error);
    return { updated: false, reason: "write-failed", error: String((error && (error as Error).message) || error) };
  }
}

async function resolveLiveSession(channelId: string, currentDate: string, currentLiveKey: string, currentStartedAt: string, currentTitle: string, supabaseUrl: string, serviceRoleKey: string) {
  const now = new Date().toISOString();
  const normalizedLiveKey = String(currentLiveKey || currentStartedAt || currentDate || "live").trim();
  const startedMs = timestampMs(currentStartedAt) || Date.now();
  try {
    const sameLiveSession = await loadLiveSessionStateByKey(channelId, normalizedLiveKey, supabaseUrl, serviceRoleKey);
    const previous = sameLiveSession || await loadLatestLiveSessionState(channelId, supabaseUrl, serviceRoleKey);
    const sameLive = !!sameLiveSession;
    let effectiveDate = currentDate;
    let effectiveLiveKey = normalizedLiveKey;
    let continued = false;
    let endedAt = previous && previous.ended_at ? previous.ended_at : "";
    if (!endedAt && previous && previous.is_live === false) endedAt = previous.last_seen_at || previous.updated_at || "";
    const endedMs = timestampMs(endedAt);
    if (!sameLive && previous && previous.is_live === false && previous.schedule_date && previous.live_key && endedMs && startedMs >= endedMs && startedMs - endedMs <= LIVE_CONTINUATION_WINDOW_MS) {
      effectiveDate = previous.schedule_date;
      continued = true;
    }
    await updateLiveSessionState(channelId, {
      live_key: effectiveLiveKey,
      schedule_date: effectiveDate,
      started_at: currentStartedAt || null,
      last_seen_at: now,
      ended_at: null,
      title: String(currentTitle || "").trim() || null,
      vod_url: null,
      vod_video_no: null,
      vod_saved_at: null,
      vod_checked_at: null,
      is_live: true,
    }, supabaseUrl, serviceRoleKey);
    return { date: effectiveDate, liveKey: effectiveLiveKey, continued, previousEndedAt: endedAt || null };
  } catch (error) {
    console.warn("live session state lookup failed", error);
    return { date: currentDate, liveKey: normalizedLiveKey, continued: false, error: String((error && (error as Error).message) || error) };
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


function sameCategoryHistoryCategory(
  row: { category_id?: string | null; category_type?: string | null; category_label?: string | null },
  category: NonNullable<ReturnType<typeof normalizeGameImage>>,
) {
  const rowCategoryId = String(row.category_id || "").trim();
  const rowCategoryType = String(row.category_type || "").trim().toUpperCase();
  if (rowCategoryId && category.categoryId && rowCategoryType && category.categoryType) {
    return rowCategoryId === category.categoryId && rowCategoryType === category.categoryType;
  }
  return String(row.category_label || "").trim().toLowerCase() === category.label.trim().toLowerCase();
}

async function recordLiveCategoryChange(
  channelId: string,
  date: string,
  key: string,
  startedAt: string,
  category: ReturnType<typeof normalizeGameImage>,
  offsetHours: number,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  if (!category || !String(category.label || "").trim()) return { recorded: false, reason: "empty-category" };

  const normalizedKey = String(key || startedAt || date || "live").trim();
  const query = "/rest/v1/" + LIVE_CATEGORY_HISTORY_TABLE +
    "?select=id,category_label,category_id,category_type&channel_id=eq." + encodeURIComponent(channelId) +
    "&live_key=eq." + encodeURIComponent(normalizedKey) +
    "&order=changed_at.desc,id.desc&limit=1";
  const rows = await supabaseFetch(query, { method: "GET" }, supabaseUrl, serviceRoleKey) as Array<{ id: number; category_label?: string | null; category_id?: string | null; category_type?: string | null }>;
  const latest = rows && rows[0];
  if (latest && sameCategoryHistoryCategory(latest, category)) {
    return { recorded: false, reason: "unchanged", category };
  }

  const changedAt = new Date().toISOString();
  const startedMs = chzzkTimestampMs(startedAt, offsetHours);
  const changedMs = timestampMs(changedAt);
  const offsetSeconds = latest ? (startedMs && changedMs >= startedMs ? Math.floor((changedMs - startedMs) / 1000) : null) : 0;
  await supabaseFetch("/rest/v1/" + LIVE_CATEGORY_HISTORY_TABLE, {
    method: "POST",
    body: JSON.stringify({
      channel_id: channelId,
      live_key: normalizedKey,
      schedule_date: date,
      category_label: category.label,
      category_id: category.categoryId || null,
      category_type: category.categoryType || null,
      category_poster_image_url: category.posterImageUrl || category.url || null,
      previous_category_label: latest ? String(latest.category_label || "").trim() || null : null,
      previous_category_id: latest ? String(latest.category_id || "").trim() || null : null,
      previous_category_type: latest ? String(latest.category_type || "").trim() || null : null,
      started_at: startedAt || null,
      changed_at: changedAt,
      offset_seconds: offsetSeconds,
    }),
  }, supabaseUrl, serviceRoleKey);

  return {
    recorded: true,
    action: latest ? "changed" : "initial",
    category,
    previousCategory: latest || null,
    changedAt,
    offsetSeconds,
    liveKey: normalizedKey,
  };
}

async function safeRecordLiveCategoryChange(
  channelId: string,
  date: string,
  key: string,
  startedAt: string,
  category: ReturnType<typeof normalizeGameImage>,
  offsetHours: number,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  try {
    return await recordLiveCategoryChange(channelId, date, key, startedAt, category, offsetHours, supabaseUrl, serviceRoleKey);
  } catch (error) {
    console.warn("live category history write failed", error);
    return { recorded: false, reason: "write-failed", error: String((error && (error as Error).message) || error) };
  }
}

function normalizeVodItem(item: unknown) {
  if (!item || typeof item !== "object") return null;
  const source = item as Record<string, unknown>;
  const url = String(source.url || "").trim();
  const label = String(source.label || "").trim() || "방송 다시보기";
  if (!url) return null;
  const vod = { url, label } as Record<string, string>;
  const liveKey = String(source.liveKey || source.live_key || "").trim();
  const startedAt = String(source.startedAt || source.started_at || "").trim();
  const endedAt = String(source.endedAt || source.ended_at || "").trim();
  const videoNo = String(source.videoNo || source.video_no || "").trim();
  if (liveKey) vod.liveKey = liveKey;
  if (startedAt) vod.startedAt = startedAt;
  if (endedAt) vod.endedAt = endedAt;
  if (videoNo) vod.videoNo = videoNo;
  return vod;
}

function sameVodUrl(a: string, b: string) {
  const left = String(a || "").trim().replace(/\/+$/, "");
  const right = String(b || "").trim().replace(/\/+$/, "");
  return !!left && !!right && left === right;
}

async function fetchLatestReplayVideos(channelId: string) {
  const url = "https://api.chzzk.naver.com/service/v1/channels/" + encodeURIComponent(channelId) +
    "/videos?sortType=LATEST&pagingType=PAGE&page=0&size=8&publishDateAt=&videoType=REPLAY";
  const json = await fetchJson(url);
  const content = json && (json.content || json);
  const data = content && Array.isArray(content.data) ? content.data : [];
  return data.filter((item: unknown) => item && typeof item === "object") as Record<string, unknown>[];
}

function randomDtToken() {
  return Math.floor(0x10000 + Math.random() * 0xeffff).toString(16);
}

async function fetchVideoDetail(videoNo: string) {
  const url = "https://api.chzzk.naver.com/service/v3/videos/" + encodeURIComponent(videoNo) + "?dt=" + randomDtToken();
  const json = await fetchJson(url);
  return json && (json.content || json);
}

function videoNoFromItem(item: Record<string, unknown>) {
  return String(item.videoNo || item.videoId || "").trim();
}

function videoTitleFromItem(item: Record<string, unknown>) {
  return String(item.videoTitle || item.title || "").trim();
}

function videoPublishMs(item: Record<string, unknown>, offsetHours: number) {
  const raw = item.publishDateAt || item.publishDate || item.createdDate;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  return chzzkTimestampMs(raw, offsetHours);
}

function videoMatchesEndedSession(video: Record<string, unknown>, detail: Record<string, unknown> | null, session: LiveSessionState, offsetHours: number) {
  const startedMs = chzzkTimestampMs(session.started_at, offsetHours);
  const endedMs = chzzkTimestampMs(session.ended_at || session.last_seen_at, offsetHours);
  const title = String(session.title || "").trim();
  const videoTitle = videoTitleFromItem(video) || (detail ? videoTitleFromItem(detail) : "");
  const liveOpenMs = detail ? chzzkTimestampMs((detail as Record<string, unknown>).liveOpenDate, offsetHours) : 0;
  if (startedMs && liveOpenMs && Math.abs(liveOpenMs - startedMs) <= 10 * 60 * 1000) return true;
  if (title && videoTitle && title === videoTitle) return true;
  const publishMs = videoPublishMs(video, offsetHours);
  if (endedMs && publishMs && publishMs >= endedMs - 15 * 60 * 1000 && publishMs <= endedMs + 12 * 60 * 60 * 1000) return true;
  return false;
}

async function findReplayVodForSession(channelId: string, session: LiveSessionState, offsetHours: number) {
  const videos = await fetchLatestReplayVideos(channelId);
  for (const video of videos) {
    const videoNo = videoNoFromItem(video);
    if (!videoNo) continue;
    let detail: Record<string, unknown> | null = null;
    try {
      detail = await fetchVideoDetail(videoNo) as Record<string, unknown>;
    } catch (error) {
      console.warn("video detail lookup failed", videoNo, error);
    }
    if (!videoMatchesEndedSession(video, detail, session, offsetHours)) continue;
    const label = videoTitleFromItem(video) || (detail ? videoTitleFromItem(detail) : "") || "방송 다시보기";
    return { videoNo, url: "https://chzzk.naver.com/video/" + encodeURIComponent(videoNo), label };
  }
  return null;
}

async function syncReplayVodToSchedule(channelId: string, session: LiveSessionState | null, offsetHours: number, supabaseUrl: string, serviceRoleKey: string) {
  if (!session || !session.schedule_date) return { synced: false, reason: "no-ended-session" };
  if (session.vod_saved_at && session.vod_url) return { synced: false, reason: "already-saved", url: session.vod_url };
  const checkedAt = new Date().toISOString();
  try {
    const vod = await findReplayVodForSession(channelId, session, offsetHours);
    if (!vod) {
      await updateLiveSessionState(channelId, { id: session.id, live_key: session.live_key || null, vod_checked_at: checkedAt }, supabaseUrl, serviceRoleKey);
      return { synced: false, reason: "vod-not-ready", checkedAt };
    }

    const query = "/rest/v1/schedule?select=id,vods&channel_id=eq." + encodeURIComponent(channelId) +
      "&date=eq." + encodeURIComponent(session.schedule_date) + "&limit=1";
    const rows = await supabaseFetch(query, { method: "GET" }, supabaseUrl, serviceRoleKey) as Array<{ id: number; vods: unknown }>;
    const existing = rows && rows[0];
    const vods = (existing && Array.isArray(existing.vods) ? existing.vods : []).map(normalizeVodItem).filter(Boolean) as NonNullable<ReturnType<typeof normalizeVodItem>>[];
    const alreadyExists = vods.some((item) => sameVodUrl(item.url, vod.url));
    const autoVod = normalizeVodItem({
      url: vod.url,
      label: vod.label || "방송 다시보기",
      liveKey: session.live_key || "",
      startedAt: session.started_at || "",
      endedAt: session.ended_at || session.last_seen_at || "",
      videoNo: vod.videoNo || "",
    }) || { url: vod.url, label: vod.label || "방송 다시보기" };
    const nextVods = alreadyExists ? vods : [...vods, autoVod];
    const payload = { vods: nextVods, updated_at: new Date().toISOString() };
    if (existing) {
      await supabaseFetch("/rest/v1/schedule?id=eq." + encodeURIComponent(String(existing.id)), {
        method: "PATCH",
        body: JSON.stringify(payload),
      }, supabaseUrl, serviceRoleKey);
    } else {
      await supabaseFetch("/rest/v1/schedule", {
        method: "POST",
        body: JSON.stringify({ channel_id: channelId, date: session.schedule_date, ...payload }),
      }, supabaseUrl, serviceRoleKey);
    }
    const savedAt = new Date().toISOString();
    await updateLiveSessionState(channelId, {
      id: session.id,
      live_key: session.live_key || null,
      vod_url: vod.url,
      vod_video_no: vod.videoNo,
      vod_saved_at: savedAt,
      vod_checked_at: checkedAt,
    }, supabaseUrl, serviceRoleKey);
    return { synced: !alreadyExists, reason: alreadyExists ? "already-present" : "added", url: vod.url, label: vod.label, videoNo: vod.videoNo, date: session.schedule_date };
  } catch (error) {
    console.warn("replay vod sync failed", error);
    await updateLiveSessionState(channelId, { id: session.id, live_key: session.live_key || null, vod_checked_at: checkedAt }, supabaseUrl, serviceRoleKey);
    return { synced: false, reason: "write-failed", error: String((error && (error as Error).message) || error) };
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
      const rawDate = String(body.date || dateKeyFromTimestamp(startedAt, offsetHours) || currentDateKey(offsetHours));
      const testTitle = String(body.liveTitle || body.title || "").trim();
      const session = await resolveLiveSession(channelId, rawDate, String(body.liveKey || startedAt || rawDate), startedAt, testTitle, supabaseUrl, serviceRoleKey);
      const date = session.date;
      const testCategory = testCategories[0] || null;
      const titleHistory = testTitle
        ? await safeRecordLiveTitleChange(channelId, date, testTitle, session.liveKey, startedAt, testCategory, supabaseUrl, serviceRoleKey)
        : { recorded: false, reason: "empty-title" };
      const categoryHistory = await safeRecordLiveCategoryChange(channelId, date, session.liveKey, startedAt, testCategory, offsetHours, supabaseUrl, serviceRoleKey);
      if (!syncSetting.enabled) {
        return jsonResponse({ synced: false, reason: "disabled", setting: AUTO_LIVE_CATEGORY_SYNC_SETTING_KEY, mode: "test", titleHistory, categoryHistory });
      }
      const result = await syncCategoriesToSchedule(channelId, date, testCategories, typeAllowList, startedAt, supabaseUrl, serviceRoleKey);
      return jsonResponse({ ...result, mode: "test", session, titleHistory, categoryHistory });
    }

    const current = await currentLiveCategory(channelId, offsetHours);
    const rawDate = current.date || currentDateKey(offsetHours);
    const session = current.live
      ? await resolveLiveSession(channelId, rawDate, current.liveKey || "", current.startedAt || "", current.title || "", supabaseUrl, serviceRoleKey)
      : null;
    const endState = current.live ? null : await markLiveSessionEndedIfNeeded(channelId, supabaseUrl, serviceRoleKey);
    const endedSession = endState && "session" in endState ? (endState.session as LiveSessionState | null) : null;
    const pendingVodSessions = current.live ? [] : await loadPendingVodSessions(channelId, supabaseUrl, serviceRoleKey);
    const vodSyncResults = [] as Array<Record<string, unknown>>;
    if (!current.live) {
      const seenSessionIds = new Set<string>();
      for (const pendingSession of pendingVodSessions) {
        const sessionId = String(pendingSession.id || pendingSession.live_key || "");
        if (sessionId && seenSessionIds.has(sessionId)) continue;
        if (sessionId) seenSessionIds.add(sessionId);
        vodSyncResults.push(await syncReplayVodToSchedule(channelId, pendingSession, offsetHours, supabaseUrl, serviceRoleKey));
      }
      if (endedSession) {
        const endedSessionId = String(endedSession.id || endedSession.live_key || "");
        if (!endedSessionId || !seenSessionIds.has(endedSessionId)) {
          vodSyncResults.push(await syncReplayVodToSchedule(channelId, endedSession, offsetHours, supabaseUrl, serviceRoleKey));
        }
      }
    }
    const vodSync = current.live ? null : vodSyncResults;
    const date = session ? session.date : rawDate;
    const liveKeyForHistory = session ? session.liveKey : (current.liveKey || "");
    const titleHistory = current.live
      ? await safeRecordLiveTitleChange(channelId, date, current.title || "", liveKeyForHistory, current.startedAt || "", current.category, supabaseUrl, serviceRoleKey)
      : { recorded: false, reason: "not-live" };
    const categoryHistory = current.live
      ? await safeRecordLiveCategoryChange(channelId, date, liveKeyForHistory, current.startedAt || "", current.category, offsetHours, supabaseUrl, serviceRoleKey)
      : { recorded: false, reason: "not-live" };
    if (!syncSetting.enabled) {
      return jsonResponse({ synced: false, reason: "disabled", setting: AUTO_LIVE_CATEGORY_SYNC_SETTING_KEY, mode: "live", session, endState, vodSync, titleHistory, categoryHistory });
    }
    if (!current.live) return jsonResponse({ synced: false, reason: "not-live", status: current.status || "", date, startedAt: current.startedAt || "", endState, vodSync, titleHistory, categoryHistory });
    if (!current.category) return jsonResponse({ synced: false, reason: "no-category", date, startedAt: current.startedAt || "", session, titleHistory, categoryHistory });
    if (!typeAllowList.includes("*") && !typeAllowList.includes(current.category.categoryType)) {
      return jsonResponse({ synced: false, reason: "category-type-skipped", date, startedAt: current.startedAt || "", category: current.category, allowedTypes: typeAllowList, session, titleHistory, categoryHistory });
    }

    const result = await syncCategoriesToSchedule(channelId, date, [current.category], typeAllowList, current.startedAt || "", supabaseUrl, serviceRoleKey);
    return jsonResponse({ ...result, category: current.category, session, titleHistory, categoryHistory });
  } catch (error) {
    console.error("sync-live-category failed", error);
    return jsonResponse({ error: String((error && (error as Error).message) || error) }, 502);
  }
});