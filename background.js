// background.js — Supabase에서 일정을 읽어 캐싱 + content script에 제공
// Chrome: service worker / Firefox: event page 양쪽에서 동작

if (typeof CHZZK_SCHEDULE_CONFIG === "undefined" && typeof importScripts === "function") {
  try {
    importScripts("config.js");
  } catch (e) {
  }
}

const api = typeof browser !== "undefined" ? browser : chrome;

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
    return { content: p, label: "", hidePartLabel: false, displayType: "text", profile: null, collab: false, official: false, otherChannel: false, ad: false, outdoor: false, speculative: false, members: [], hostChannel: null, notes: [] };
  }
  if (p && typeof p === "object") {
    return {
      content: p.content || "",
      label: p.label || "",
      hidePartLabel: !!p.hidePartLabel,
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
    };
  }
  return { content: "", label: "", hidePartLabel: false, displayType: "text", profile: null, collab: false, official: false, otherChannel: false, ad: false, outdoor: false, speculative: false, members: [], hostChannel: null, notes: [] };
}

function normalizeGameImage(item) {
  if (typeof item === "string") {
    const value = item.trim();
    if (!value) return null;
    return /^https?:\/\//i.test(value) ? { url: value, label: "" } : { url: "", label: value };
  }
  if (!item || typeof item !== "object") return null;
  const url = String(item.url || item.imageUrl || item.src || "").trim();
  const label = String(item.label || item.title || item.name || item.game || "").trim();
  return (label || url) ? { url, label } : null;
}
// vods 항목을 {url, label} 형태로 정규화. label이 없으면 "방송 다시보기"가 기본값.
function normalizeVod(v) {
  if (!v || typeof v !== "object" || !v.url) return null;
  return { url: v.url, label: v.label || "방송 다시보기" };
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
    if (Array.isArray(r.parts) && r.parts.length) entry.parts = r.parts.map(normalizePart);
    if (Array.isArray(r.vods) && r.vods.length) entry.vods = r.vods.map(normalizeVod).filter(Boolean);
    if (Array.isArray(r.game_images) && r.game_images.length) entry.gameImages = r.game_images.map(normalizeGameImage).filter(Boolean);
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
function mergeInfoItems(channels, rows) {
  for (const r of rows) {
    const cid = r.channel_id;
    if (!cid || !r.content || r.hidden) continue;
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

function directiveNames(value) {
  const raw = String(value || "").trim();
  const whole = raw.match(/^:s(?:\[([^\]]+)\]|\s+(.+))$/i);
  if (whole) return [(whole[1] || whole[2]).trim()];
  return Array.from(raw.matchAll(/:s(?:\[([^\]]+)\]|\s+([^\s:]+))/gi), (match) => (match[1] || match[2]).trim());
}

const GNIMTI_PROFILE_NAMES = [
  "김뿡", "김호러", "러너", "룩삼", "승우아빠", "울프", "윤가놈", "인간젤리", "철면수심", "캡틴잭", "크랭크", "푸린", "한동숙",
  "꼴랑이", "멋사", "삼식", "소우릎", "플레임", "헤징",
  "네클릿", "뱅", "샘웨", "앰비션", "크캣", "햇살살",
  "괴물쥐", "눈꽃", "명예훈장", "실프", "이선생", "플러리",
  "갱맘", "니니아", "던", "두니주니", "서새봄냥", "채현찌", "초승달", "큐베", "피닉스박",
];
const GNIMTI_PROFILE_OVERRIDES = {
  "김뿡": "17f0cfcba4ff608de5eabb5110d134d0",
  "김호러": "",
  "러너": "",
  "룩삼": "",
  "승우아빠": "",
  "울프": "",
  "윤가놈": "",
  "인간젤리": "",
  "철면수심": "",
  "캡틴잭": "",
  "크랭크": "",
  "푸린": "",
  "한동숙": "",
  "꼴랑이": "",
  "멋사": "",
  "삼식": "",
  "소우릎": "",
  "플레임": "",
  "헤징": "",
  "네클릿": "",
  "뱅": "",
  "샘웨": "",
  "앰비션": "",
  "크캣": "",
  "햇살살": "",
  "괴물쥐": "",
  "눈꽃": "",
  "명예훈장": "",
  "실프": "",
  "이선생": "",
  "플러리": "",
  "갱맘": "",
  "니니아": "",
  "던": "",
  "두니주니": "",
  "서새봄냥": "458f6ec20b034f49e0fc6d03921646d2",
  "채현찌": "",
  "초승달": "",
  "큐베": "",
  "피닉스박": "",
};
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
  GNIMTI_PROFILE_NAMES.forEach((name) => names.add(name));

  const profiles = {};
  const profileCache = await getProfileCache();
  let cacheChanged = false;
  const base = CHZZK_SCHEDULE_CONFIG.supabaseUrl.replace(/\/+$/, "");
  await Promise.all(Array.from(names).map(async (name) => {
    const key = String(name || "").trim();
    if (!key) return;
    const overrideId = String(GNIMTI_PROFILE_OVERRIDES[key] || "").trim();
    const idCacheKey = overrideId ? "id:v2:" + overrideId : "";
    const cached = normalizeChannelRef(overrideId ? profileCache[idCacheKey] : profileCache[key]);
    if (cached) {
      profiles[key] = cached;
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
      const override = overrideId ? list.find((c) => String(c.channelId || "").trim() === overrideId) : null;
      const exact = list.find((c) => String(c.channelName || "").trim().toLowerCase() === key.toLowerCase());
      const found = overrideId
        ? (override || { channelId: overrideId, channelName: key, channelImageUrl: "" })
        : (exact || list[0] || null);
      const normalized = normalizeChannelRef(found);
      if (normalized) {
        if (overrideId) normalized.channelId = overrideId;
        if (!normalized.channelName) normalized.channelName = key;
        profiles[key] = normalized;
        profileCache[key] = normalized;
        if (idCacheKey) profileCache[idCacheKey] = normalized;
        cacheChanged = true;
      }
    } catch (e) {
    }
  }));
  if (cacheChanged) await setProfileCache(profileCache);
  return profiles;
}

async function fetchFromSupabase() {
  const c = CHZZK_SCHEDULE_CONFIG;
  const scheduleRows = await fetchTable(c.tableName || "schedule", "date.asc");
  const { channels, latestUpdate } = rowsToChannels(scheduleRows);

  // 소식 테이블은 아직 없을 수 있으므로(선택 기능), 실패해도 일정 기능에는 영향 없게 함
  try {
    const infoRows = await fetchTable(c.upcomingContentTableName || "upcoming_content", "sort_order.asc,id.asc");
    mergeInfoItems(channels, infoRows);
  } catch (e) {
  }

  const directiveProfiles = await resolveDirectiveProfiles(channels);
  return { version: 1, updatedAt: latestUpdate, channels, directiveProfiles };
}

async function attachCachedProfiles(data) {
  if (!data || typeof data !== "object") return data;
  const profileCache = await getProfileCache();
  data.directiveProfiles = { ...(data.directiveProfiles || {}), ...profileCache };
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
  if (!force && cached.scheduleData && cached.fetchedAt && now - cached.fetchedAt < ttl) {
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

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "getSchedule") {
    fetchSchedule(!!msg.force).then(sendResponse);
    return true; // 비동기 응답 유지
  }
  if (msg && msg.type === "submitFeedback") {
    submitFeedback(msg.payload || {}).then(sendResponse);
    return true;
  }
});













