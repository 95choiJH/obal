// background.js — Supabase에서 일정을 읽어 캐싱 + content script에 제공
// Chrome: service worker / Firefox: event page 양쪽에서 동작

if (typeof importScripts === "function") {
  try {
    importScripts("streamer-ids.js");
    if (typeof CHZZK_SCHEDULE_CONFIG === "undefined") importScripts("config.js");
  } catch (e) {
  }
}

const api = typeof browser !== "undefined" ? browser : chrome;
const PENDING_UPDATE_TAB_KEY = "pendingUpdateTabId";
const AVAILABLE_UPDATE_VERSION_KEY = "availableUpdateVersion";
const READY_UPDATE_VERSION_KEY = "readyUpdateVersion";
const APPLY_UPDATE_TAB_KEY = "applyUpdateTabId";
const OPEN_SCHEDULE_REQUEST_KEY = "openScheduleRequest";
const TARGET_LIVE_STATE_KEY = "targetLiveStartState";
const TARGET_LIVE_STATUS_CACHE_KEY = "targetLiveStatusCache";
const TARGET_CHANNEL_PROFILE_CACHE_KEY = "targetChannelProfileCache";
const TARGET_LIVE_STATUS_CACHE_TTL = 9000;
const TARGET_LIVE_START_RECOVERY_MAX_AGE = 5 * 60 * 1000;
const TARGET_CHANNEL_PROFILE_CACHE_TTL = 6 * 60 * 60 * 1000;
let updateReloadScheduled = false;

function storageGet(keys) {
  if (typeof browser !== "undefined") return api.storage.local.get(keys);
  return new Promise((resolve) => api.storage.local.get(keys, (result) => resolve(result || {})));
}

function storageSet(values) {
  if (typeof browser !== "undefined") return api.storage.local.set(values);
  return new Promise((resolve) => api.storage.local.set(values, resolve));
}

function storageRemove(keys) {
  if (typeof browser !== "undefined") return api.storage.local.remove(keys);
  return new Promise((resolve) => api.storage.local.remove(keys, resolve));
}

async function reloadPendingUpdateTab() {
  const saved = await storageGet([PENDING_UPDATE_TAB_KEY]);
  const tabId = Number(saved[PENDING_UPDATE_TAB_KEY]);
  if (!Number.isInteger(tabId)) return;
  await storageRemove([PENDING_UPDATE_TAB_KEY, APPLY_UPDATE_TAB_KEY, READY_UPDATE_VERSION_KEY, AVAILABLE_UPDATE_VERSION_KEY]);
  try { await api.tabs.reload(tabId); } catch (_) { /* 탭이 닫힌 경우 무시 */ }
}

reloadPendingUpdateTab().catch(() => {});

function defaultChannelId() {
  const c = typeof CHZZK_SCHEDULE_CONFIG !== "undefined" ? CHZZK_SCHEDULE_CONFIG : {};
  return String(c.channelId || "0dad8baf12a436f722faa8e5001c5011").trim();
}

function defaultChannelUrl() {
  return "https://chzzk.naver.com/" + encodeURIComponent(defaultChannelId());
}

function targetChannelName() {
  const c = typeof CHZZK_SCHEDULE_CONFIG !== "undefined" ? CHZZK_SCHEDULE_CONFIG : {};
  return String(c.channelName || "\uB530\uD6A8\uB2C8").trim() || "\uB530\uD6A8\uB2C8";
}

function normalizeLiveStatusPayload(json) {
  const content = json && json.content ? json.content : null;
  if (!content || typeof content !== "object") return { ok: false, live: false, error: "empty content" };
  const status = String(content.status || "").toUpperCase();
  const live = status === "OPEN" || status === "LIVE";
  const liveKey = live
    ? String(content.liveId || content.openDate || content.liveTitle || status || "open").trim()
    : "";
  return {
    ok: true,
    live,
    status,
    liveKey,
    liveId: String(content.liveId || "").trim(),
    title: String(content.liveTitle || "").trim(),
    openDate: String(content.openDate || "").trim(),
    categoryName: String(content.liveCategoryValue || content.categoryValue || content.liveCategory || content.categoryType || "").trim(),
    categoryKey: String(content.liveCategoryValue || content.categoryValue || content.liveCategory || content.categoryType || "").trim().toLowerCase(),
    categoryType: String(content.categoryType || "").trim().toUpperCase(),
    liveCategory: String(content.liveCategory || "").trim().toLowerCase(),
  };
}
async function fetchTargetChannelProfile() {
  const now = Date.now();
  const channelId = defaultChannelId();
  const saved = await storageGet([TARGET_CHANNEL_PROFILE_CACHE_KEY]);
  const cached = saved[TARGET_CHANNEL_PROFILE_CACHE_KEY];
  if (cached && typeof cached === "object" && cached.channelId === channelId && cached.fetchedAt && now - cached.fetchedAt < TARGET_CHANNEL_PROFILE_CACHE_TTL) {
    return cached.value || { channelName: targetChannelName(), channelImageUrl: "" };
  }

  let value = { channelName: targetChannelName(), channelImageUrl: "" };
  try {
    const res = await fetch("https://api.chzzk.naver.com/service/v1/channels/" + encodeURIComponent(channelId), {
      headers: { Accept: "application/json" },
      credentials: "omit",
    });
    if (res.ok) {
      const json = await res.json();
      const normalized = normalizeChannelRef(json && json.content);
      if (normalized) {
        value = {
          channelName: normalized.channelName || value.channelName,
          channelImageUrl: normalized.channelImageUrl || "",
        };
      }
    }
  } catch (e) {
  }
  await storageSet({ [TARGET_CHANNEL_PROFILE_CACHE_KEY]: { channelId, fetchedAt: now, value } });
  return value;
}

async function fetchTargetLiveStatus(force) {
  const now = Date.now();
  if (!force) {
    const saved = await storageGet([TARGET_LIVE_STATUS_CACHE_KEY]);
    const cached = saved[TARGET_LIVE_STATUS_CACHE_KEY];
    if (cached && typeof cached === "object" && cached.fetchedAt && now - cached.fetchedAt < TARGET_LIVE_STATUS_CACHE_TTL) {
      return cached.value || { ok: false, live: false, error: "invalid cache" };
    }
  }

  const channelId = defaultChannelId();
  const url = "https://api.chzzk.naver.com/polling/v2/channels/" + encodeURIComponent(channelId) + "/live-status";
  try {
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const value = normalizeLiveStatusPayload(await res.json());
    await storageSet({ [TARGET_LIVE_STATUS_CACHE_KEY]: { fetchedAt: now, value } });
    return value;
  } catch (error) {
    const value = { ok: false, live: false, error: String((error && error.message) || error) };
    await storageSet({ [TARGET_LIVE_STATUS_CACHE_KEY]: { fetchedAt: now, value } });
    return value;
  }
}

function liveStartedAt(openDate) {
  const value = String(openDate || "").trim().replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(value)) return NaN;
  // 시간대가 없는 치지직 시작 시각은 한국 시간으로 해석한다.
  return Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value) ? value + "+09:00" : value);
}

function hasNewLiveSession(previous, status) {
  if (!previous || previous.live !== true) return false;
  const previousId = previous.liveId || (/^\d+$/.test(previous.liveKey || "") ? previous.liveKey : "");
  if (previousId && status.liveId) return String(previousId) !== String(status.liveId);
  const previousStart = liveStartedAt(previous.openDate || previous.liveKey);
  const currentStart = liveStartedAt(status.openDate);
  return Number.isFinite(previousStart) && Number.isFinite(currentStart) && previousStart !== currentStart;
}

async function checkTargetLiveStart(currentChannelId, options, dependencies = {
  storageGet, storageSet, fetchTargetLiveStatus, fetchTargetChannelProfile,
}) {
  const { storageGet, storageSet, fetchTargetLiveStatus, fetchTargetChannelProfile } = dependencies;
  // 감지 이력은 채널이 아닌 실제 브라우저 탭별로 저장한다.
  const tabId = options && options.notificationTabId;
  const stateKey = Number.isInteger(tabId) && tabId >= 0 ? TARGET_LIVE_STATE_KEY + ":tab:" + tabId : TARGET_LIVE_STATE_KEY;
  const liveStartNoticeEnabled = !options || options.liveStartNoticeEnabled !== false;
  const categoryChangeNoticeEnabled = !options || options.categoryChangeNoticeEnabled !== false;
  const targetChannelId = defaultChannelId();
  const current = String(currentChannelId || "").trim().toLowerCase();
  const isWatchingVod = !!options && options.isWatchingVod === true;
  if (!isWatchingVod && (!current || current === targetChannelId.toLowerCase())) {
    return { ok: true, notify: false, live: false, targetChannelId };
  }

  const status = await fetchTargetLiveStatus(false);
  const saved = await storageGet([stateKey]);
  const previous = saved[stateKey] && typeof saved[stateKey] === "object"
    ? saved[stateKey]
    : null;
  const now = Date.now();

  if (!status.ok) {
    await storageSet({
      [stateKey]: {
        ...(previous || {}),
        checkedAt: now,
        lastError: status.error || "live status check failed",
      },
    });
    return { ok: false, notify: false, live: false, targetChannelId, error: status.error };
  }

  if (!status.live) {
    await storageSet({
      [stateKey]: {
        ...(previous || {}),
        live: false,
        liveKey: "",
        liveId: "",
        openDate: "",
        categoryKey: "",
        categoryName: "",
        checkedAt: now,
        lastError: "",
      },
    });
    return { ok: true, notify: false, live: false, targetChannelId };
  }

  const profile = await fetchTargetChannelProfile();
  const liveKey = status.liveKey || "open";
  const categoryKey = status.categoryKey || "";
  const categoryName = status.categoryName || "";
  const hadKnownState = !!previous && typeof previous.live === "boolean";
  const newSession = hasNewLiveSession(previous, status);
  const startedAt = liveStartedAt(status.openDate);
  const recentlyStarted = Number.isFinite(startedAt) && now >= startedAt && now - startedAt <= TARGET_LIVE_START_RECOVERY_MAX_AGE;
  const liveStartNotify = liveStartNoticeEnabled && hadKnownState &&
    (previous.live === false || (newSession && recentlyStarted)) && previous.lastNotifiedLiveKey !== liveKey;
  const isGameCategory = status.categoryType === "GAME" || (status.categoryType === "" && !!status.liveCategory && status.liveCategory !== "talk" && status.liveCategory !== "etc");
  const categoryNotify = categoryChangeNoticeEnabled && isGameCategory && hadKnownState && previous.live === true && !newSession && !!categoryKey && !!previous.categoryKey && previous.categoryKey !== categoryKey;
  const notify = liveStartNotify || categoryNotify;
  const notificationType = categoryNotify ? "categoryChange" : "liveStart";
  await storageSet({
    [stateKey]: {
      ...(previous || {}),
      live: true,
      liveKey,
      liveId: status.liveId || "",
      openDate: status.openDate || "",
      categoryKey,
      categoryName,
      checkedAt: now,
      lastError: "",
      lastNotifiedLiveKey: liveStartNotify ? liveKey : ((previous && previous.lastNotifiedLiveKey) || ""),
    },
  });

  return {
    ok: true,
    notify,
    notificationType,
    liveKey,
    live: true,
    targetChannelId,
    channelName: profile.channelName || targetChannelName(),
    channelImageUrl: profile.channelImageUrl || "",
    categoryName,
    title: status.title || "",
    openDate: status.openDate || "",
  };
}

let multiTabLiveSimulation = null;

function restoreMultiTabLiveSimulation(record) {
  const { startsAt, expiresAt } = record;
  let saved = record.saved || {};
  return {
    startsAt, expiresAt,
    dependencies: {
      storageGet: async () => ({ ...saved }),
      storageSet: async (values) => {
        saved = { ...saved, ...values };
        await storageSet({ targetLiveSimulation: { startsAt, expiresAt, saved } });
      },
      fetchTargetChannelProfile,
      fetchTargetLiveStatus: async () => normalizeLiveStatusPayload({ content: Date.now() < startsAt
        ? { status: "CLOSE" }
        : { status: "OPEN", liveId: "test-multi-tab-" + startsAt, openDate: new Date(startsAt).toISOString(),
          liveTitle: "여러 탭 알림 테스트", categoryType: "GAME", liveCategory: "minecraft", liveCategoryValue: "마인크래프트" } }),
    },
  };
}

async function loadMultiTabLiveSimulation() {
  if (!multiTabLiveSimulation) {
    const values = await storageGet(["targetLiveSimulation"]);
    const record = values.targetLiveSimulation;
    if (!multiTabLiveSimulation && record && record.expiresAt > Date.now()) multiTabLiveSimulation = restoreMultiTabLiveSimulation(record);
  }
  return multiTabLiveSimulation;
}

async function startMultiTabLiveSimulation() {
  await loadMultiTabLiveSimulation();
  const now = Date.now();
  if (multiTabLiveSimulation && now < multiTabLiveSimulation.expiresAt) return multiTabLiveSimulation;
  const record = { startsAt: now + 15000, expiresAt: now + 60000, saved: {} };
  multiTabLiveSimulation = restoreMultiTabLiveSimulation(record);
  await storageSet({ targetLiveSimulation: record });
  return multiTabLiveSimulation;
}

const liveTabCheckQueues = new Map();
function checkTargetLiveStartForPage(currentChannelId, options) {
  const key = options && options.notificationTabId;
  const previous = liveTabCheckQueues.get(key) || Promise.resolve();
  const request = previous.catch(() => {}).then(() => checkTargetLiveStartForPageUnlocked(currentChannelId, options));
  liveTabCheckQueues.set(key, request);
  const cleanup = () => { if (liveTabCheckQueues.get(key) === request) liveTabCheckQueues.delete(key); };
  request.then(cleanup, cleanup);
  return request;
}

async function checkTargetLiveStartForPageUnlocked(currentChannelId, options) {
  const session = await loadMultiTabLiveSimulation();
  if (!session || Date.now() >= session.expiresAt) {
    multiTabLiveSimulation = null;
    return checkTargetLiveStart(currentChannelId, options);
  }
  const result = await checkTargetLiveStart(currentChannelId, options, session.dependencies);
  return { ...result, simulation: { scenario: "multi-tab", startsAt: session.startsAt, expiresAt: session.expiresAt } };
}

async function simulateTargetLiveStart(currentChannelId, options, scenario) {
  if (scenario === "multi-tab") {
    await startMultiTabLiveSimulation();
    return checkTargetLiveStartForPage(currentChannelId, options);
  }
  // 실제 감지 함수를 사용하되, 테스트 상태와 응답은 이 호출 안에서만 유지한다.
  let saved = {};
  let payload;
  const dependencies = {
    storageGet: async () => saved,
    storageSet: async (values) => { saved = { ...saved, ...values }; },
    fetchTargetLiveStatus: async () => normalizeLiveStatusPayload(payload),
    fetchTargetChannelProfile,
  };
  const live = {
    status: "OPEN", liveId: "test-new-live", openDate: new Date().toISOString(),
    liveTitle: "방송 시작 감지 테스트", categoryType: "GAME",
    liveCategory: "minecraft", liveCategoryValue: "마인크래프트",
  };
  payload = { content: scenario === "recovery"
    ? { ...live, liveId: "test-old-live", openDate: new Date(Date.now() - 86400000).toISOString() }
    : { status: "CLOSE" } };
  const before = await checkTargetLiveStart(currentChannelId, options, dependencies);
  payload = { content: live };
  const started = await checkTargetLiveStart(currentChannelId, options, dependencies);
  const repeated = await checkTargetLiveStart(currentChannelId, options, dependencies);
  return {
    ...started,
    simulation: { scenario: scenario === "recovery" ? "recovery" : "offline-to-live",
      beforeNotify: before.notify, startedNotify: started.notify, repeatedNotify: repeated.notify },
  };
}

function sendLiveTabMessage(tabId, message) {
  if (typeof browser !== "undefined") return api.tabs.sendMessage(tabId, message);
  return new Promise((resolve, reject) => api.tabs.sendMessage(tabId, message, (result) => {
    if (api.runtime.lastError) reject(new Error(api.runtime.lastError.message));
    else resolve(result);
  }));
}

let desktopNoticeQueue = Promise.resolve();
function notifyHiddenLiveTab(result, options) {
  if (!result || !result.notify || options.pageVisible !== false || !api.notifications) return Promise.resolve();
  const task = desktopNoticeQueue.catch(() => {}).then(async () => {
    const key = [result.simulation ? "test" : "live", result.liveKey, result.notificationType, result.categoryName].join(":");
    const saved = await storageGet(["lastDesktopLiveNotice"]);
    const previous = saved.lastDesktopLiveNotice;
    if (previous && previous.key === key && Date.now() - previous.at < 180000) return;
    const name = result.channelName || targetChannelName();
    const details = {
      type: "basic", iconUrl: api.runtime.getURL("icons/icon128.png"), title: "오뱅알",
      message: result.notificationType === "categoryChange"
        ? name + "님이 카테고리를 변경했습니다. " + result.categoryName
        : name + "님이 방송을 시작했습니다.",
    };
    if (typeof browser !== "undefined") await api.notifications.create("obaengal-live", details);
    else await new Promise((resolve, reject) => api.notifications.create("obaengal-live", details, () => {
      if (api.runtime.lastError) reject(new Error(api.runtime.lastError.message));
      else resolve();
    }));
    await storageSet({ lastDesktopLiveNotice: { key, at: Date.now() } });
  });
  desktopNoticeQueue = task;
  return task;
}

let backgroundLivePollInFlight = false;
async function pollLiveNotificationTabs() {
  if (backgroundLivePollInFlight) return;
  backgroundLivePollInFlight = true;
  try {
    const tabs = await api.tabs.query({});
    await Promise.all(tabs.map(async (tab) => {
      try {
        const context = await sendLiveTabMessage(tab.id, { type: "getLiveNotificationContext" });
        if (!context || !context.eligible) return;
        // 페이지에 처리 요청만 보내지 않고 백그라운드에서 직접 조회한다.
        const options = { ...context, notificationTabId: tab.id };
        const result = await checkTargetLiveStartForPage(context.currentChannelId, options);
        await notifyHiddenLiveTab(result, options).catch(error => console.warn("[오뱅알] 데스크톱 알림 실패", error));
        if (result.notify || result.simulation) await sendLiveTabMessage(tab.id, { type: "targetLiveNotification", result });
      } catch (_) { /* 확장 미적용 페이지와 닫힌 탭은 건너뛴다. */ }
    }));
  } finally {
    backgroundLivePollInFlight = false;
  }
}

async function openDefaultChannelWithSchedule() {
  const channelId = defaultChannelId();
  await storageSet({
    [OPEN_SCHEDULE_REQUEST_KEY]: {
      channelId,
      createdAt: Date.now(),
    },
  });
  await api.tabs.create({ url: defaultChannelUrl() });
}

async function consumeOpenScheduleRequest(channelId) {
  const saved = await storageGet([OPEN_SCHEDULE_REQUEST_KEY]);
  const request = saved[OPEN_SCHEDULE_REQUEST_KEY];
  if (!request || typeof request !== "object") return { ok: true, open: false };
  const requestChannelId = String(request.channelId || "").trim();
  const createdAt = Number(request.createdAt || 0);
  const fresh = createdAt && Date.now() - createdAt < 120000;
  const matches = requestChannelId && requestChannelId === String(channelId || "").trim();
  if (!fresh) await storageRemove(OPEN_SCHEDULE_REQUEST_KEY);
  if (!fresh || !matches) return { ok: true, open: false };
  await storageRemove(OPEN_SCHEDULE_REQUEST_KEY);
  return { ok: true, open: true };
}

if (api.action && api.action.onClicked) {
  api.action.onClicked.addListener(() => {
    openDefaultChannelWithSchedule().catch((error) => console.warn("[오뱅알] 채널 열기 실패", error));
  });
}

async function applyReadyUpdate(tabId) {
  if (updateReloadScheduled) return;
  updateReloadScheduled = true;
  if (Number.isInteger(tabId)) await storageSet({ [PENDING_UPDATE_TAB_KEY]: tabId });
  await storageRemove(APPLY_UPDATE_TAB_KEY);
  setTimeout(() => api.runtime.reload(), 150);
}

async function handleUpdateAvailable(details) {
  const version = String((details && details.version) || "").trim();
  if (!version) return;
  await storageSet({
    [AVAILABLE_UPDATE_VERSION_KEY]: version,
    [READY_UPDATE_VERSION_KEY]: version,
  });
  const saved = await storageGet([APPLY_UPDATE_TAB_KEY]);
  const requestedTabId = Number(saved[APPLY_UPDATE_TAB_KEY]);
  if (Number.isInteger(requestedTabId)) await applyReadyUpdate(requestedTabId);
}

if (api.runtime.onUpdateAvailable) {
  api.runtime.onUpdateAvailable.addListener((details) => {
    handleUpdateAvailable(details).catch(() => {});
  });
}

async function checkDeployedUpdate() {
  const saved = await storageGet([AVAILABLE_UPDATE_VERSION_KEY]);
  let version = String(saved[AVAILABLE_UPDATE_VERSION_KEY] || "").trim();
  try {
    const result = await api.runtime.requestUpdateCheck();
    if (result && result.status === "update_available") {
      version = String(result.version || "").trim();
      if (version) await storageSet({ [AVAILABLE_UPDATE_VERSION_KEY]: version });
    } else if (result && result.status === "no_update") {
      version = "";
      await storageRemove([AVAILABLE_UPDATE_VERSION_KEY, READY_UPDATE_VERSION_KEY]);
    }
    return { ok: true, version, result };
  } catch (error) {
    return { ok: false, version, error: String((error && error.message) || error) };
  }
}

async function requestAndApplyUpdate(tabId, targetVersion) {
  const expectedVersion = String(targetVersion || "").trim();
  if (Number.isInteger(tabId)) await storageSet({ [APPLY_UPDATE_TAB_KEY]: tabId });
  const checked = await checkDeployedUpdate();
  const result = checked.result || null;
  if (!checked.version || (expectedVersion && checked.version !== expectedVersion)) {
    await storageRemove(APPLY_UPDATE_TAB_KEY);
    return { ok: true, applying: false, result };
  }
  const saved = await storageGet([READY_UPDATE_VERSION_KEY]);
  const readyVersion = String(saved[READY_UPDATE_VERSION_KEY] || "").trim();
  if (readyVersion && readyVersion === checked.version) {
    await applyReadyUpdate(tabId);
    return { ok: true, applying: true, ready: true, result };
  }
  return { ok: true, applying: true, ready: false, result };
}

function isConfigured() {
  const c = CHZZK_SCHEDULE_CONFIG;
  return (
    c &&
    c.supabaseUrl &&
    !c.supabaseUrl.includes("YOUR_PROJECT") &&
    c.supabaseKey &&
    !c.supabaseKey.includes("YOUR_ANON")
  );
}

async function getCache() {
  return new Promise((resolve) => {
    api.storage.local.get(["scheduleData", "fetchedAt"], (result) => resolve(result || {}));
  });
}

async function setCache(data, fetchedAt) {
  return new Promise((resolve) => {
    api.storage.local.set({ scheduleData: data, fetchedAt }, () => resolve());
  });
}

async function getProfileCache() {
  return new Promise((resolve) => {
    api.storage.local.get(["chzzkProfileCache"], (result) => resolve((result && result.chzzkProfileCache) || {}));
  });
}

async function setProfileCache(cache) {
  return new Promise((resolve) => {
    api.storage.local.set({ chzzkProfileCache: cache || {} }, () => resolve());
  });
}

function normalizeChannelRef(c) {
  if (!c || typeof c !== "object") return null;
  if (!c.channelId && !c.channelName) return null;
  return {
    channelId: c.channelId || "",
    channelName: c.channelName || "",
    channelImageUrl: c.channelImageUrl || "",
  };
}

// parts 항목을 {content, collab, official, otherChannel, members, hostChannel} 형태로 정규화 (구버전은 문자열 하나였음)
function normalizePart(p) {
  if (typeof p === "string") {
    return { content: p, label: "", categoryLabel: "", categoryId: "", categoryType: "", categoryPosterImageUrl: "", manualPartLabel: false, hidePartLabel: false, hiddenFromFront: false, displayType: "text", profile: null, collab: false, official: false, otherChannel: false, ad: false, outdoor: false, speculative: false, members: [], hostChannel: null, notes: [] };
  }
  if (p && typeof p === "object") {
    return {
      content: p.content || "",
      label: p.label || "",
      categoryLabel: String(p.categoryLabel || "").trim(),
      categoryId: String(p.categoryId || "").trim(),
      categoryType: String(p.categoryType || "").trim(),
      categoryPosterImageUrl: String(p.categoryPosterImageUrl || p.posterImageUrl || "").trim(),
      manualPartLabel: !!p.manualPartLabel,
      hidePartLabel: !!p.hidePartLabel,
      hiddenFromFront: !!p.hiddenFromFront,
      displayType: p.displayType || "text",
      profile: normalizeChannelRef(p.profile),
      collab: !!p.collab,
      official: !!p.official,
      otherChannel: !!p.otherChannel,
      ad: !!p.ad,
      outdoor: !!p.outdoor,
      speculative: !!p.speculative,
      members: Array.isArray(p.members) ? p.members.map(normalizeChannelRef).filter(Boolean) : [],
      hostChannel: normalizeChannelRef(p.hostChannel),
      notes: normalizeNotes(p.notes || p.note),
      autoCategory: !!p.autoCategory,
      categoryId: String(p.categoryId || "").trim(),
      categoryType: String(p.categoryType || "").trim(),
    };
  }
  return { content: "", label: "", categoryLabel: "", categoryId: "", categoryType: "", categoryPosterImageUrl: "", manualPartLabel: false, hidePartLabel: false, hiddenFromFront: false, displayType: "text", profile: null, collab: false, official: false, otherChannel: false, ad: false, outdoor: false, speculative: false, members: [], hostChannel: null, notes: [] };
}

function visiblePartsForFront(parts) {
  let visibleIndex = 0;
  return parts
    .map(normalizePart)
    .filter((part) => part && !part.hiddenFromFront)
    .map((part) => {
      if (part.autoCategory && String(part.categoryType || "").toUpperCase() === "GAME" && !part.hidePartLabel && !part.manualPartLabel && !part.label) {
        visibleIndex += 1;
        return { ...part, label: String(visibleIndex) + "\uBD80" };
      }
      if (!part.hidePartLabel && !part.manualPartLabel) visibleIndex += 1;
      return part;
    });
}
function normalizeGameImage(item) {
  if (typeof item === "string") {
    const value = item.trim();
    if (!value) return null;
    return /^https?:\/\//i.test(value) ? { url: value, label: "" } : { url: "", label: value };
  }
  if (!item || typeof item !== "object") return null;
  const posterImageUrl = String(item.posterImageUrl || "").trim();
  const url = String(item.url || item.imageUrl || item.src || posterImageUrl || "").trim();
  const label = String(item.label || item.title || item.name || item.game || "").trim();
  const categoryId = String(item.categoryId || "").trim();
  const categoryType = String(item.categoryType || "").trim().toUpperCase();
  return (label || url) ? { url, label, categoryId, categoryType, posterImageUrl } : null;
}
// vods 항목을 정규화. 자동 저장된 다시보기는 liveKey 메타데이터를 보존한다.
function normalizeVod(v) {
  if (!v || typeof v !== "object" || !v.url) return null;
  const item = { url: v.url, label: v.label || "방송 다시보기" };
  const liveKey = String(v.liveKey || v.live_key || "").trim();
  const startedAt = String(v.startedAt || v.started_at || "").trim();
  const endedAt = String(v.endedAt || v.ended_at || "").trim();
  const videoNo = String(v.videoNo || v.video_no || "").trim();
  if (liveKey) item.liveKey = liveKey;
  if (startedAt) item.startedAt = startedAt;
  if (endedAt) item.endedAt = endedAt;
  if (videoNo) item.videoNo = videoNo;
  return item;
}

function normalizeNoteItem(item) {
  if (item && typeof item === "object") {
    const content = String(item.content || item.text || item.note || "");
    return content.trim() && !item.hidden ? content : "";
  }
  const content = String(item || "");
  return content.trim() ? content : "";
}

function normalizeNotes(value) {
  if (Array.isArray(value)) return value.map(normalizeNoteItem).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(normalizeNoteItem).filter(Boolean);
    const item = normalizeNoteItem(parsed);
    if (item) return [item];
  } catch (_e) { /* 기존 일반 텍스트 메모 */ }
  return [value];
}

// Supabase가 돌려주는 납작한 행 배열 -> 확장이 기대하는 channels 구조로 변환
function rowsToChannels(rows) {
  const channels = {};
  let latestUpdate = null;

  for (const r of rows) {
    const cid = r.channel_id;
    if (!cid) continue;
    if (!channels[cid]) {
      channels[cid] = { name: r.channel_name || "", timezone: "Asia/Seoul", schedule: [], info: [] };
    }
    const entry = { date: r.date };
    if (r.start_time) entry.start = r.start_time;
    if (r.end_time) entry.end = r.end_time;
    if (r.title) entry.title = r.title;
    if (r.title_short) entry.titleShort = r.title_short;
    if (Array.isArray(r.parts) && r.parts.length) entry.parts = visiblePartsForFront(r.parts);
    if (Array.isArray(r.vods) && r.vods.length) entry.vods = r.vods.map(normalizeVod).filter(Boolean);
    if (Array.isArray(r.game_images) && r.game_images.length) {
      const allGameImages = r.game_images.map(normalizeGameImage).filter(Boolean);
      entry.gameImages = allGameImages.filter((game) => game && (!game.categoryType || game.categoryType === "GAME"));
    }
    if (r.status) entry.status = r.status;
    if (r.cafe_time) entry.cafeTime = true;
    if (r.video_time) entry.videoTime = true;
    const notes = normalizeNotes(r.note);
    if (notes.length) entry.notes = notes;
    channels[cid].schedule.push(entry);

    if (r.updated_at && (!latestUpdate || r.updated_at > latestUpdate)) {
      latestUpdate = r.updated_at;
    }
  }
  return { channels, latestUpdate };
}

// 소식 행 배열을 channels[cid].info 목록으로 병합 (sort_order로 이미 정렬된 상태로 들어옴)

function normalizeLiveTitleHistory(item) {
  if (!item || typeof item !== "object") return null;
  const title = String(item.title || "").trim();
  if (!title) return null;
  return {
    id: item.id,
    liveKey: String(item.live_key || item.liveKey || "").trim(),
    scheduleDate: String(item.schedule_date || item.scheduleDate || "").trim(),
    title,
    previousTitle: String(item.previous_title || item.previousTitle || "").trim(),
    categoryLabel: String(item.category_label || item.categoryLabel || "").trim(),
    categoryId: String(item.category_id || item.categoryId || "").trim(),
    categoryType: String(item.category_type || item.categoryType || "").trim().toUpperCase(),
    categoryPosterImageUrl: String(item.category_poster_image_url || item.categoryPosterImageUrl || "").trim(),
    hidden: item.hidden === true,
    categoryHidden: item.category_hidden === true || item.categoryHidden === true,
    startedAt: String(item.started_at || item.startedAt || "").trim(),
    changedAt: String(item.changed_at || item.changedAt || "").trim(),
  };
}

function liveTitleHistoriesByChannel(rows) {
  const byChannel = {};
  for (const row of rows || []) {
    const channelId = String((row && (row.channel_id || row.channelId)) || "").trim();
    const item = normalizeLiveTitleHistory(row);
    if (!channelId || !item) continue;
    if (!byChannel[channelId]) byChannel[channelId] = [];
    byChannel[channelId].push(item);
  }
  Object.values(byChannel).forEach((list) => {
    list.sort((a, b) => String(b.changedAt || "").localeCompare(String(a.changedAt || "")) || String(b.id || "").localeCompare(String(a.id || "")));
  });
  return byChannel;
}

function normalizeLiveCategoryHistory(item) {
  if (!item || typeof item !== "object") return null;
  const label = String(item.category_label || item.categoryLabel || "").trim();
  if (!label) return null;
  const offsetSecondsValue = Number(item.offset_seconds ?? item.offsetSeconds);
  return {
    id: item.id,
    liveKey: String(item.live_key || item.liveKey || "").trim(),
    scheduleDate: String(item.schedule_date || item.scheduleDate || "").trim(),
    categoryLabel: label,
    categoryId: String(item.category_id || item.categoryId || "").trim(),
    categoryType: String(item.category_type || item.categoryType || "").trim().toUpperCase(),
    categoryPosterImageUrl: String(item.category_poster_image_url || item.categoryPosterImageUrl || "").trim(),
    previousCategoryLabel: String(item.previous_category_label || item.previousCategoryLabel || "").trim(),
    startedAt: String(item.started_at || item.startedAt || "").trim(),
    changedAt: String(item.changed_at || item.changedAt || "").trim(),
    offsetSeconds: Number.isFinite(offsetSecondsValue) ? Math.max(0, Math.floor(offsetSecondsValue)) : null,
    hidden: item.hidden === true,
  };
}

function liveCategoryHistoriesByChannel(rows) {
  const byChannel = {};
  for (const row of rows || []) {
    const channelId = String((row && (row.channel_id || row.channelId)) || "").trim();
    const item = normalizeLiveCategoryHistory(row);
    if (!channelId || !item) continue;
    if (!byChannel[channelId]) byChannel[channelId] = [];
    byChannel[channelId].push(item);
  }
  Object.values(byChannel).forEach((list) => {
    list.sort((a, b) => String(b.changedAt || "").localeCompare(String(a.changedAt || "")) || String(b.id || "").localeCompare(String(a.id || "")));
  });
  return byChannel;
}

function extensionVersionFromInfoItems(rows) {
  for (const r of rows || []) {
    const content = String((r && r.content) || "").trim();
    const match = content.match(/^@extension-version\s*:\s*([0-9]+(?:\.[0-9]+){0,3})\s*$/i);
    if (match) return match[1];
  }
  return "";
}

function noticesFromInfoItems(rows) {
  return (rows || [])
    .map((r) => String((r && r.content) || "").trim().match(/^@notice\s*:\s*([\s\S]+)$/i))
    .filter(Boolean)
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function updateHistoriesFromInfoItems(rows) {
  return (rows || [])
    .map((r) => String((r && r.content) || "").trim().match(/^@update\s*:\s*([\s\S]+)$/i))
    .filter(Boolean)
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function mergeInfoItems(channels, rows) {
  for (const r of rows) {
    const cid = r.channel_id;
    const content = String(r.content || "").trim();
    if (!cid || !content || r.hidden || /^@notice\s*:/i.test(content) || /^@update\s*:/i.test(content) || /^@extension-version\s*:/i.test(content)) continue;
    if (!channels[cid]) {
      channels[cid] = { name: r.channel_name || "", timezone: "Asia/Seoul", schedule: [], info: [] };
    }
    channels[cid].info.push(r.content);
  }
}

async function fetchTable(tableName, order) {
  const c = CHZZK_SCHEDULE_CONFIG;
  const base = c.supabaseUrl.replace(/\/+$/, "");
  const url = base + "/rest/v1/" + encodeURIComponent(tableName) + "?select=*&order=" + order;

  const res = await fetch(url, {
    headers: {
      apikey: c.supabaseKey,
      Authorization: "Bearer " + c.supabaseKey,
    },
    cache: "no-cache",
  });
  if (!res.ok) throw new Error("Supabase HTTP " + res.status + " " + (await res.text()).slice(0, 120));
  return res.json();
}

async function fetchAdminSettingsByKey(key) {
  const c = CHZZK_SCHEDULE_CONFIG;
  const base = c.supabaseUrl.replace(/\/+$/, "");
  const table = c.adminSettingsTableName || "admin_settings";
  const url = base + "/rest/v1/" + encodeURIComponent(table) + "?select=channel_id,value&key=eq." + encodeURIComponent(key);
  const res = await fetch(url, {
    headers: {
      apikey: c.supabaseKey,
      Authorization: "Bearer " + c.supabaseKey,
    },
    cache: "no-cache",
  });
  if (!res.ok) throw new Error("Supabase HTTP " + res.status + " " + (await res.text()).slice(0, 120));
  return res.json();
}

function normalizeGnimtiContent(value) {
  const source = value && typeof value === "object" ? value : {};
  const september = source.september && typeof source.september === "object" ? source.september : {};
  return {
    version: 1,
    september: {
      members: Array.isArray(september.members) ? september.members.map((member) => ({
        name: String((member && member.name) || "").trim(),
        position: String((member && member.position) || "").trim(),
        tier: String((member && member.tier) || "").trim().toUpperCase(),
        selfImageUrl: String((member && (member.selfImageUrl || member.self_image_url)) || "").trim(),
        analysisImageUrl: String((member && (member.analysisImageUrl || member.analysis_image_url)) || "").trim(),
      })).filter((member) => member.name) : [],
      tierlistImageUrl: String(september.tierlistImageUrl || september.tierlist_image_url || "").trim(),
      rosterImageUrls: Array.isArray(september.rosterImageUrls || september.roster_image_urls)
        ? (september.rosterImageUrls || september.roster_image_urls).map((url) => String(url || "").trim()).filter(Boolean)
        : [],
    },
  };
}

async function fetchGnimtiContentByChannel() {
  const rows = await fetchAdminSettingsByKey("gnimti_content");
  const byChannel = {};
  (rows || []).forEach((row) => {
    const channelId = String((row && row.channel_id) || "").trim();
    if (channelId) byChannel[channelId] = normalizeGnimtiContent(row.value);
  });
  return byChannel;
}
function directiveNames(value) {
  const raw = String(value || "").trim();
  const whole = raw.match(/^:s(?:\[([^\]]+)\]|\s+(.+))$/i);
  if (whole) return [(whole[1] || whole[2]).trim()];
  return Array.from(raw.matchAll(/:s(?:\[([^\]]+)\]|\s+([^\s:]+))/gi), (match) => (match[1] || match[2]).trim());
}

const GNIMTI_PROFILE_OVERRIDES = globalThis.CHZZK_STREAMER_IDS || {};
async function resolveDirectiveProfiles(channels) {
  const names = new Set();
  const collect = (value) => { directiveNames(value).forEach((name) => names.add(name)); };
  Object.values(channels).forEach((channel) => {
    (channel.info || []).forEach(collect);
    (channel.schedule || []).forEach((entry) => {
      collect(entry.title); collect(entry.titleShort); collect(entry.note);
      (entry.notes || []).forEach(collect);
      (entry.parts || []).forEach((part) => { collect(part.content); (part.notes || []).forEach(collect); });
      (entry.vods || []).forEach((vod) => collect(vod.label));
      (entry.gameImages || []).forEach((game) => collect(game.label));
    });
  });
  const profiles = {};
  const profileCache = await getProfileCache();
  let cacheChanged = false;
  const base = CHZZK_SCHEDULE_CONFIG.supabaseUrl.replace(/\/+$/, "");
  await Promise.all(Array.from(names).map(async (name) => {
    const key = String(name || "").trim();
    if (!key) return;
    const cached = normalizeChannelRef(profileCache[key]);
    if (cached && /^[0-9a-f]{32}$/i.test(String(cached.channelId || "").trim())) {
      profiles[key] = cached;
      return;
    }
    const overrideId = String(GNIMTI_PROFILE_OVERRIDES[key] || "").trim();
    if (/^[0-9a-f]{32}$/i.test(overrideId)) {
      const overridden = { ...(cached || {}), channelId: overrideId, channelName: (cached && cached.channelName) || key, channelImageUrl: (cached && cached.channelImageUrl) || "" };
      profiles[key] = overridden;
      profileCache[key] = overridden;
      cacheChanged = true;
      return;
    }
    try {
      const res = await fetch(base + "/functions/v1/chzzk-search?keyword=" + encodeURIComponent(key), {
        headers: { apikey: CHZZK_SCHEDULE_CONFIG.supabaseKey, Authorization: "Bearer " + CHZZK_SCHEDULE_CONFIG.supabaseKey },
      });
      if (!res.ok) return;
      const json = await res.json();
      const items = (json && json.content && json.content.data) || [];
      const list = items.map((item) => item && item.channel).filter(Boolean);
      const exact = list.find((c) => String(c.channelName || "").trim().toLowerCase() === key.toLowerCase());
      const found = exact || list[0] || null;
      const normalized = normalizeChannelRef(found);
      if (normalized) {
        if (!normalized.channelName) normalized.channelName = key;
        profiles[key] = normalized;
        profileCache[key] = normalized;
        cacheChanged = true;
      }
    } catch (e) {
    }
  }));
  if (cacheChanged) await setProfileCache(profileCache);
  return profiles;
}

async function resolveGnimtiProfiles() {
  const profiles = {};
  const entries = Object.entries(GNIMTI_PROFILE_OVERRIDES).filter(([, channelId]) =>
    /^[0-9a-f]{32}$/i.test(String(channelId || "").trim())
  );

  await Promise.all(entries.map(async ([name, channelId]) => {
    const id = String(channelId).trim();
    let profile = { channelId: id, channelName: name, channelImageUrl: "" };
    try {
      const res = await fetch("https://api.chzzk.naver.com/service/v1/channels/" + encodeURIComponent(id), {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const json = await res.json();
        const matched = json && json.content;
        if (matched) profile = normalizeChannelRef(matched) || profile;
      }
    } catch (e) {
    }
    profile.channelId = id;
    if (!profile.channelName) profile.channelName = name;
    profiles[name] = profile;
  }));

  return profiles;
}

async function fetchFromSupabase() {
  const c = CHZZK_SCHEDULE_CONFIG;
  const scheduleRows = await fetchTable(c.tableName || "schedule", "date.asc");
  const { channels, latestUpdate } = rowsToChannels(scheduleRows);

  // 소식 테이블은 아직 없을 수 있으므로(선택 기능), 실패해도 일정 기능에는 영향 없게 함
  let latestExtensionVersion = "";
  let notices = [];
  let updateHistories = [];
  try {
    const infoRows = await fetchTable(c.upcomingContentTableName || "upcoming_content", "sort_order.asc,id.asc");
    latestExtensionVersion = extensionVersionFromInfoItems(infoRows);
    notices = noticesFromInfoItems(infoRows);
    updateHistories = updateHistoriesFromInfoItems(infoRows);
    mergeInfoItems(channels, infoRows);
  } catch (e) {
  }

  let titleHistories = {};
  try {
    const historyRows = await fetchTable(c.liveTitleHistoryTableName || "live_title_history", "changed_at.desc,id.desc");
    titleHistories = liveTitleHistoriesByChannel(historyRows);
  } catch (e) {
  }

  let categoryHistories = {};
  try {
    const categoryHistoryRows = await fetchTable(c.liveCategoryHistoryTableName || "live_category_history", "changed_at.desc,id.desc");
    categoryHistories = liveCategoryHistoriesByChannel(categoryHistoryRows);
  } catch (e) {
  }

  const directiveProfiles = await resolveDirectiveProfiles(channels);
  const gnimtiProfiles = await resolveGnimtiProfiles();
  let gnimtiContentByChannel = {};
  try {
    gnimtiContentByChannel = await fetchGnimtiContentByChannel();
  } catch (e) {
  }
  const gnimtiContent = gnimtiContentByChannel[Object.keys(gnimtiContentByChannel)[0]] || null;
  return { version: 1, directiveProfileVersion: 2, gnimtiProfileVersion: 4, titleHistoryVersion: 1, categoryHistoryVersion: 2, latestExtensionVersion, notices, updateHistories, updatedAt: latestUpdate, channels, titleHistories, categoryHistories, directiveProfiles, gnimtiProfiles, gnimtiContent, gnimtiContentByChannel };
}

async function attachCachedProfiles(data) {
  if (!data || typeof data !== "object") return data;
  const profileCache = await getProfileCache();
  const linkedCache = Object.fromEntries(Object.entries(profileCache).filter(([, profile]) =>
    /^[0-9a-f]{32}$/i.test(String((profile && profile.channelId) || "").trim())
  ));
  data.directiveProfiles = { ...linkedCache, ...(data.directiveProfiles || {}) };
  return data;
}
async function fetchSchedule(force) {
  const now = Date.now();
  const cached = await getCache();
  const ttl = (CHZZK_SCHEDULE_CONFIG.cacheTtlMinutes || 10) * 60 * 1000;

  if (!isConfigured()) {
    return { ok: false, error: "Supabase 연결 정보가 설정되지 않았습니다. config.js를 확인하세요." };
  }

  // 캐시가 신선하면 그대로 반환
  if (!force && cached.scheduleData && cached.scheduleData.directiveProfileVersion === 2 && cached.scheduleData.gnimtiProfileVersion === 4 && cached.scheduleData.titleHistoryVersion === 1 && cached.scheduleData.categoryHistoryVersion === 2 && cached.fetchedAt && now - cached.fetchedAt < ttl) {
    return { ok: true, data: await attachCachedProfiles(cached.scheduleData), fetchedAt: cached.fetchedAt, fromCache: true };
  }

  try {
    const data = await fetchFromSupabase();
    await setCache(data, now);
    return { ok: true, data, fetchedAt: now, fromCache: false };
  } catch (e) {
    // 네트워크 실패 시: 오래된 캐시라도 있으면 그것을 반환
    if (cached.scheduleData) {
      return {
        ok: true,
        data: await attachCachedProfiles(cached.scheduleData),
        fetchedAt: cached.fetchedAt,
        fromCache: true,
        stale: true,
        error: String(e),
      };
    }
    return { ok: false, error: String(e) };
  }
}

async function submitFeedback(input) {
  if (!isConfigured()) return { ok: false, error: "설정 오류로 전송할 수 없습니다." };
  const type = String(input && input.feedbackType || "기타").slice(0, 40);
  const message = String(input && input.message || "").trim().slice(0, 1000);
  const contact = String(input && input.contact || "").trim().slice(0, 320);
  const relatedLink = type === "일정" ? String(input && input.relatedLink || "").trim().slice(0, 2000) : "";
  if (!message) return { ok: false, error: "내용을 입력해주세요." };
  if (relatedLink) {
    try {
      const parsed = new URL(relatedLink);
      if (parsed.protocol !== "https:") throw new Error("invalid protocol");
    } catch (_e) {
      return { ok: false, error: "관련 링크 주소를 확인해주세요." };
    }
  }

  const c = CHZZK_SCHEDULE_CONFIG;
  const url = c.supabaseUrl.replace(/\/+$/, "") + "/functions/v1/submit-feedback";
  const payload = {
    feedbackType: type,
    message,
    contact,
    relatedLink,
    extensionVersion: (api.runtime.getManifest && api.runtime.getManifest().version) || null,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: c.supabaseKey,
        Authorization: "Bearer " + c.supabaseKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: "HTTP " + res.status + (text ? " " + text.slice(0, 120) : "") };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
}

if (api.tabs && api.tabs.onRemoved) {
  api.tabs.onRemoved.addListener((tabId) => {
    storageRemove(TARGET_LIVE_STATE_KEY + ":tab:" + tabId).catch(() => {});
  });
}

if (api.alarms) {
  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "obaengal-live-poll") pollLiveNotificationTabs().catch(error => console.warn("[오뱅알] 백그라운드 알림 조회 실패", error));
  });
  api.alarms.get("obaengal-live-poll").then((alarm) => {
    if (!alarm) return api.alarms.create("obaengal-live-poll", { periodInMinutes: 0.5 });
  }).catch(error => console.warn("[오뱅알] 알림 조회 예약 실패", error));
}
if (api.notifications && api.notifications.onClicked) {
  api.notifications.onClicked.addListener((id) => {
    if (id === "obaengal-live") api.tabs.create({ url: defaultChannelUrl() });
  });
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "getTargetChannelProfile") {
    fetchTargetChannelProfile().then((profile) => {
      sendResponse({ ok: true, ...(profile || {}) });
    }).catch((error) => {
      sendResponse({ ok: false, channelName: targetChannelName(), channelImageUrl: "", error: String((error && error.message) || error) });
    });
    return true;
  }
  if (msg && (msg.type === "checkTargetLiveStart" || msg.type === "simulateTargetLiveStart")) {
    const check = msg.type === "simulateTargetLiveStart" ? simulateTargetLiveStart : checkTargetLiveStartForPage;
    const options = {
      notificationTabId: _sender && _sender.tab && _sender.tab.id,
      pageVisible: msg.pageVisible !== false,
      isWatchingVod: msg.isWatchingVod === true,
      liveStartNoticeEnabled: msg.liveStartNoticeEnabled !== false,
      categoryChangeNoticeEnabled: msg.categoryChangeNoticeEnabled !== false,
    };
    const request = msg.type === "simulateTargetLiveStart"
      ? check(msg.currentChannelId, options, msg.scenario)
      : check(msg.currentChannelId, options);
    request.then(async (result) => {
      await notifyHiddenLiveTab(result, options).catch(error => console.warn("[오뱅알] 데스크톱 알림 실패", error));
      sendResponse(result);
    }).catch((error) => {
      sendResponse({ ok: false, notify: false, error: String((error && error.message) || error) });
    });
    return true;
  }
  if (msg && msg.type === "getSchedule") {
    fetchSchedule(!!msg.force).then(sendResponse);
    return true; // 비동기 응답 유지
  }
  if (msg && msg.type === "submitFeedback") {
    submitFeedback(msg.payload || {}).then(sendResponse);
    return true;
  }
  if (msg && msg.type === "requestAndApplyUpdate") {
    requestAndApplyUpdate(_sender && _sender.tab && _sender.tab.id, msg.targetVersion).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: String((error && error.message) || error) });
    });
    return true;
  }
  if (msg && msg.type === "checkDeployedUpdate") {
    checkDeployedUpdate().then(sendResponse);
    return true;
  }
  if (msg && msg.type === "consumeOpenScheduleRequest") {
    consumeOpenScheduleRequest(msg.channelId).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: String((error && error.message) || error) });
    });
    return true;
  }
  if (msg && msg.type === "getDeployedUpdate") {
    storageGet([AVAILABLE_UPDATE_VERSION_KEY]).then((saved) => {
      sendResponse({ ok: true, version: String(saved[AVAILABLE_UPDATE_VERSION_KEY] || "").trim() });
    });
    return true;
  }
});













