// content.js — 치지직 페이지에 일정 그리드를 주입
// 확정 스펙:
//  - 인라인 5일 그리드 (오늘이 첫 칸, D+4까지) / 앵커 실패 시 플로팅 폴백
//  - 화살표 5일 페이지 이동 (데이터 유무로 활성/비활성)
//  - 시각 언어: 초록=오늘, 흐림=휴방·지난 일정, 초록 점=휴방 칸에 메모 있음
//  - 헤더 필 4상태: 방송 OO시 / 방송 예정(시간 미정) / 방송 미정 / 휴방
//  - 팝오버: 호버 시 해당 칸 바로 아래 absolute, X 없음, 과거 일정은 시간 생략
//  - 섹션 = 헤더 + 그리드 + 업데이트 시간까지. 팝오버는 오버레이.

(() => {
  "use strict";

  const api = typeof browser !== "undefined" ? browser : chrome;
  const EXTENSION_VERSION = (api.runtime.getManifest && api.runtime.getManifest().version) || "0";
  const BREAK_ICON_URL = api.runtime.getURL("icons/on_break.png");
  const BREAK_LIGHT_ICON_URL = api.runtime.getURL("icons/on_break-white.png");
  const UNDETERMINED_ICON_URL = api.runtime.getURL("icons/undetermined.png");
  const UNDETERMINED_LIGHT_ICON_URL = api.runtime.getURL("icons/undetermined.png");
  const NAVER_CAFE_ICON_URL = api.runtime.getURL("icons/naver_cafe.png");
  const VIDEO_DONATION_ICON_URL = api.runtime.getURL("icons/video_donation.png");
  const GAMEPAD_ICON_URL = api.runtime.getURL("icons/gamepad-icon.svg");
  const CALENDAR_ICON_URL = api.runtime.getURL("icons/calendar-icon.svg");
  const GNIMTI_POPUP_IMAGE_URL = api.runtime.getURL("images/gnimti-back.png");
  const GNIMTI_LOGO_IMAGE_URL = api.runtime.getURL("images/gnimti-logo.png");
  const GNIMTI_ICON_IMAGE_URL = api.runtime.getURL("images/gnimti-logo2.png");
  const OBAL_IOS_GUIDE_IMAGE_URL = api.runtime.getURL("images/obal_ios.png");
  const OBAL_ANDROID_GUIDE_IMAGE_URL = api.runtime.getURL("images/obal-android.png");
  const NOTIFICATION_GUIDE_IMAGE_URL = api.runtime.getURL("images/notification-guide.png");
  const OBAL_MOBILE_LINK_URL = "https://obaengal.netlify.app/";
  const GNIMTI_TIERLIST_IMAGE_URL = api.runtime.getURL("images/gnimti/tierlist.png");
  const GNIMTI_TIER_BACK_IMAGE_URLS = {
    S: api.runtime.getURL("images/gnimti/tier-s-back.png"),
    A: api.runtime.getURL("images/gnimti/tier-a-back.png"),
    B: api.runtime.getURL("images/gnimti/tier-b-back.png"),
    C: api.runtime.getURL("images/gnimti/tier-c-back.png"),
    D: api.runtime.getURL("images/gnimti/tier-d-back.png"),
  };
  const GNIMTI_ROSTER_IMAGE_URLS = [
    api.runtime.getURL("images/gnimti/roster1.png"),
    api.runtime.getURL("images/gnimti/roster2.png"),
  ];

  // ----------------------------------------------------------
  // 상태
  // ----------------------------------------------------------
  const EXTENSION_COLLAPSED_KEY = "obaengal:extension-collapsed";
  const LIVE_START_NOTICE_KEY = "obaengal:live-start-notice";
  const CATEGORY_CHANGE_NOTICE_KEY = "obaengal:category-change-notice";
  const VOD_CATEGORY_SEEK_KEY = "obaengal:vod-category-seek";

  function readExtensionCollapsed() {
    try { return localStorage.getItem(EXTENSION_COLLAPSED_KEY) === "1"; }
    catch (_) { return false; }
  }

  function saveExtensionCollapsed(collapsed) {
    try { localStorage.setItem(EXTENSION_COLLAPSED_KEY, collapsed ? "1" : "0"); }
    catch (_) { /* 저장소 접근이 제한된 페이지에서는 현재 세션 상태만 사용 */ }
  }

  function readNotificationSetting(key, defaultValue) {
    try {
      const value = localStorage.getItem(key);
      if (value === null) return defaultValue !== false;
      return value !== "0";
    } catch (_) { return defaultValue !== false; }
  }

  function saveNotificationSetting(key, enabled) {
    try { localStorage.setItem(key, enabled ? "1" : "0"); }
    catch (_) { /* 저장소 접근이 제한된 페이지에서는 현재 세션 상태만 사용 */ }
  }

  const state = {
    data: null,          // schedule.json 전체
    fetchedAt: null,
    channelId: null,     // 현재 페이지의 채널 ID
    channel: null,       // data.channels[channelId]
    byDate: new Map(),   // "YYYY-MM-DD" -> entry
    pageOffset: 0,       // 0 = 오늘 페이지, -1 = 5일 전 페이지 ...
    monthExpanded: false,
    scheduleViewMode: "schedule",
    lastRenderedScheduleFingerprint: "",
    lastRenderedLolFingerprint: "",
    extensionCollapsed: readExtensionCollapsed(),
    monthOffset: 0,
    gameOnly: false,
    settingsOpen: false,
    liveStartNoticeEnabled: readNotificationSetting(LIVE_START_NOTICE_KEY, false),
    categoryChangeNoticeEnabled: readNotificationSetting(CATEGORY_CHANGE_NOTICE_KEY, false),
    targetLiveNotificationsEnabled: true,
    targetLiveNotificationsPublicEnabled: false,
    selectedGame: "",
    gameRankTranslate: 0,
    noticeIndex: 0,
    deployedExtensionVersion: "",
    updateCheckAttempted: false,
    host: null,          // shadow host element
    shadow: null,
    mode: null,          // "inline" | "floating"
    todayKey: null,
    popoverTimer: null,
    popoverCloseTimer: null,
    activePopoverDate: "",
    pageTheme: null,
    feedbackOpen: false,
    infoExpanded: new Set(),
    updateHistoryExpanded: false,
    feedbackDraft: { type: "일정", message: "", relatedLink: "", contact: "", contactOpen: false },
    feedbackOutsideHandler: null,
    scheduleOutsideHandler: null,
    schedulePopoverPinned: false,
    openScheduleRequestConsumed: false,
    schedulePanelForcedOpen: false,
    titleHistoryHost: null,
    titleHistoryPopoverHost: null,
    titleHistoryOpen: false,
    titleHistoryOutsideHandler: null,
    vodCategoryHost: null,
    vodCategoryInfoPopover: null,
    vodCategoryInfoHideTimer: null,
  };

  const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];
  const PAGE_SIZE = 5;
  const INFO_V2_PREFIX = "@info-v2:";
  const LIVE_START_CHECK_INTERVAL = 10000;
  const LIVE_START_HIDDEN_TOAST_MAX_AGE = 3 * 60 * 1000;
  const NEW_TAG_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

  // 치지직 DOM 앵커 후보 (실제 확장프로그램들이 사용하는 클래스 접두어 기반)
  // 위에서부터 순서대로 시도하고, 모두 실패하면 플로팅 모드로 폴백
  // 폴백 후에도 계속 탐색하다가 앵커가 나타나면 인라인으로 자동 전환됨
  const ANCHOR_SELECTORS = [
    '[class^="live_information_contents__"]',   // 라이브 페이지: 제목/스트리머 정보 블록
    '[class*="video_information_container"]',   // VOD/다시보기 정보 블록
    '[class^="video_information__"]',
    '[class^="channel_area__"]',                // 채널 홈(오프라인) 후보
    '[class*="channel_profile_wrap"]',
    '[class^="channel_content__"]',
  ];

  // ----------------------------------------------------------
  // 날짜 유틸
  // ----------------------------------------------------------
  function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + dd;
  }

  function parseKey(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(d, n) {
    const c = new Date(d);
    c.setDate(c.getDate() + n);
    return c;
  }

  function todayDate() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  // 칸용 날짜 라벨: "7/6 (월)"
  function cellDateLabel(d) {
    return d.getMonth() + 1 + "/" + d.getDate() + " (" + WEEKDAYS_KO[d.getDay()] + ")";
  }

  // 팝오버용 날짜 라벨: "7월 6일 월요일"
  function popoverDateLabel(d) {
    return d.getMonth() + 1 + "월 " + d.getDate() + "일 " + WEEKDAYS_KO[d.getDay()] + "요일";
  }

  // ----------------------------------------------------------
  // 데이터
  // ----------------------------------------------------------
  function getChannelIdFromUrl() {
    const m = location.pathname.match(/^\/(?:live\/)?([0-9a-f]{32})(?:\/|$)/);
    return m ? m[1] : null;
  }

  function sendRuntimeMessage(message) {
    if (typeof browser !== "undefined") {
      return browser.runtime.sendMessage(message).catch((error) => ({ ok: false, error: String(error) }));
    }
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (res) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(res || { ok: false, error: "no response" });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  const handleUpdate = async () => {
    const button = state.shadow && state.shadow.getElementById("cs-update-refresh");
    if (button) {
      button.disabled = true;
      button.textContent = "확인 중";
    }
    const response = await sendRuntimeMessage({
      type: "requestAndApplyUpdate",
      targetVersion: state.deployedExtensionVersion,
    });
    if (button && !response.applying) {
      button.disabled = false;
      button.textContent = response.ok ? "최신 버전" : "다시 시도";
    } else if (button) {
      button.textContent = "적용 중";
    }
    return response;
  };

  function loadSchedule(force) {
    return sendRuntimeMessage({ type: "getSchedule", force: !!force });
  }
  function targetChannelId() {
    const cfg = typeof CHZZK_SCHEDULE_CONFIG !== "undefined" ? CHZZK_SCHEDULE_CONFIG : {};
    return String(cfg.channelId || "0dad8baf12a436f722faa8e5001c5011").trim();
  }

  function findLivePlayerToastParent() {
    const fullscreen = document.fullscreenElement || document.webkitFullscreenElement;
    if (fullscreen) return { element: fullscreen, insidePlayer: true };

    const webPlayer = document.querySelector(".webplayer-internal-video");
    if (webPlayer) {
      const element = /^(VIDEO|CANVAS|IFRAME)$/i.test(webPlayer.tagName) && webPlayer.parentElement
        ? webPlayer.parentElement
        : webPlayer;
      return { element, insidePlayer: true };
    }

    const videos = Array.from(document.querySelectorAll("video"));
    const visibleVideos = videos
      .map((video) => ({ video, rect: video.getBoundingClientRect() }))
      .filter((item) => item.rect.width >= 240 && item.rect.height >= 135);
    const video = visibleVideos.sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0];
    if (!video) return { element: document.body || document.documentElement, insidePlayer: false };

    const player = video.video.closest('[class*="player"], [class*="Player"], [class*="live_player"], [class*="video_player"], [class*="video_area"], [class*="video_container"]');
    if (player) return { element: player, insidePlayer: true };

    let candidate = video.video.parentElement;
    let best = candidate;
    const videoArea = video.rect.width * video.rect.height;
    for (let i = 0; candidate && i < 5; i += 1, candidate = candidate.parentElement) {
      const rect = candidate.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (rect.width >= video.rect.width && rect.height >= video.rect.height && area <= videoArea * 3.2) best = candidate;
    }
    return { element: best || document.body || document.documentElement, insidePlayer: !!best };
  }

  function ensureLiveStartToastHost() {
    const target = findLivePlayerToastParent();
    const parent = target.element;
    if (!parent) return null;
    let host = document.getElementById("obaengal-live-start-toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "obaengal-live-start-toast-host";
      host.style.zIndex = "2147483647";
      host.style.pointerEvents = "none";
      host.attachShadow({ mode: "open" });
    }

    if (target.insidePlayer) {
      const computed = window.getComputedStyle(parent);
      if (computed.position === "static") parent.style.position = "relative";
      host.style.position = "absolute";
      host.style.top = "0";
      host.style.left = "0";
      host.style.right = "0";
      host.style.bottom = "auto";
      host.style.width = "100%";
      host.style.height = "108px";
      host.style.transform = "none";
    } else {
      host.style.position = "fixed";
      host.style.top = "0";
      host.style.left = "0";
      host.style.right = "0";
      host.style.bottom = "auto";
      host.style.width = "100%";
      host.style.height = "108px";
      host.style.transform = "none";
    }

    if (host.parentNode !== parent) parent.appendChild(host);
    return host;
  }

  function showLiveStartToast(channelName, channelImageUrl, messageSuffix, categoryName) {
    const host = ensureLiveStartToastHost();
    if (!host || !host.shadowRoot) return;
    const name = String(channelName || "\uB530\uD6A8\uB2C8").trim() || "\uB530\uD6A8\uB2C8";
    const imageUrl = String(channelImageUrl || "").trim();
    const suffix = String(messageSuffix || "\uB2D8\uC774 \uBC29\uC1A1\uC744 \uC2DC\uC791\uD588\uC2B5\uB2C8\uB2E4").trim();
    const category = String(categoryName || "").trim();
    host.shadowRoot.innerHTML =
      '<style>' +
      ':host{all:initial;display:flex;justify-content:center;align-items:flex-start;box-sizing:border-box;width:100%;height:108px;padding:16px 24px 28px;pointer-events:none;background:linear-gradient(180deg,rgba(0,0,0,.68) 0%,rgba(0,0,0,.5) 42%,rgba(0,0,0,.2) 72%,rgba(0,0,0,0) 100%)}.toast{position:relative;pointer-events:auto;display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px;width:max-content;max-width:calc(100vw - 48px);box-sizing:border-box;margin-left:27px;padding:10px 10px 10px 38px;border:1px solid transparent;border-radius:8px;background:linear-gradient(135deg,rgba(8,10,14,.995),rgba(18,22,29,.99)) padding-box,linear-gradient(90deg,#00ffa3,#38bdf8,#f8fafc,#00ffa3) border-box;background-size:100% 100%,260% 100%;color:#f8fafc;font:800 14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 18px 46px rgba(0,0,0,.68),0 0 0 1px rgba(255,255,255,.14),0 0 28px rgba(0,255,163,.2);transform:translateY(-14px);opacity:0;isolation:isolate;animation:cs-live-toast-in .22s cubic-bezier(.2,.8,.2,1) forwards,cs-live-toast-border 3s linear infinite}.toast::before{content:"";position:absolute;left:8px;top:8px;bottom:8px;z-index:1;width:4px;border-radius:999px;background:linear-gradient(180deg,#00ffa3,#38bdf8);box-shadow:0 0 14px rgba(0,255,163,.45)}.toast.is-exiting{animation:cs-live-toast-out .2s ease forwards,cs-live-toast-border 3s linear infinite}.avatar{position:absolute;left:-25px;top:50%;z-index:2;width:50px;height:50px;border-radius:50%;padding:2px;background:linear-gradient(135deg,#00ffa3,#38bdf8,#a78bfa);transform:translateY(-50%);overflow:hidden}.avatar img{display:block;width:100%;height:100%;border-radius:50%;object-fit:cover}.avatar-fallback{display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;background:#23262b;color:#00ffa3;font-size:15px;font-weight:900}.copy{position:relative;z-index:1;grid-column:1;min-width:max-content;color:#f4f5f6;font-size:14px;font-weight:850;line-height:1.25;white-space:nowrap;overflow:visible;text-overflow:clip}.name{color:#fff;font-weight:950}.message{color:#eef4fb;font-weight:850;text-shadow:0 1px 2px rgba(0,0,0,.36)}.category{display:inline-flex;align-items:center;max-width:none;margin:0 3px;padding:1px 6px;border:1px solid rgba(56,189,248,.55);border-radius:999px;background:rgba(56,189,248,.18);color:#7dd3fc;font-weight:950;vertical-align:baseline;white-space:nowrap;overflow:visible;text-overflow:clip}.watch-btn{position:relative;z-index:1;grid-column:2;appearance:none;border:1px solid rgba(0,255,163,.45);border-radius:7px;background:#00ffa3;color:#04251d;height:30px;padding:0 10px;font:950 12px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;cursor:pointer;box-shadow:0 0 18px rgba(0,255,163,.22)}.watch-btn:hover{border-color:rgba(125,211,252,.75);background:#7dd3fc;color:#031923}.watch-btn:focus-visible{outline:2px solid rgba(56,189,248,.78);outline-offset:2px}.close-btn{position:relative;z-index:1;grid-column:3;appearance:none;display:inline-flex;align-items:flex-start;justify-content:center;width:24px;height:24px;margin-left:-2px;border:1px solid rgba(255,255,255,.26);border-radius:7px;background:rgba(255,255,255,.1);color:#f1f5f9;font:900 17px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}.close-btn:hover{border-color:rgba(248,250,252,.36);background:rgba(255,255,255,.13);color:#fff}.close-btn:focus-visible{outline:2px solid rgba(56,189,248,.78);outline-offset:2px}@keyframes cs-live-toast-in{to{transform:translateY(0);opacity:1}}@keyframes cs-live-toast-border{to{background-position:0 0,260% 0}}@keyframes cs-live-toast-out{to{transform:translateY(-14px);opacity:0}}' +
      '</style><div class="toast" id="obaengal-live-start-toast" role="status" aria-live="polite"><span class="avatar" id="obaengal-live-start-avatar"></span><span class="copy"><span class="name" id="obaengal-live-start-name"></span><span class="message" id="obaengal-live-start-message"></span></span><button type="button" class="watch-btn" id="obaengal-live-start-watch">방송보러가기</button><button type="button" class="close-btn" id="obaengal-live-start-close" aria-label="닫기">&times;</button></div>';
    const avatar = host.shadowRoot.getElementById("obaengal-live-start-avatar");
    if (avatar) {
      if (imageUrl) {
        const img = document.createElement("img");
        img.src = imageUrl;
        img.alt = "";
        avatar.appendChild(img);
      } else {
        const fallback = document.createElement("span");
        fallback.className = "avatar-fallback";
        fallback.textContent = name.charAt(0) || "D";
        avatar.appendChild(fallback);
      }
    }
    const nameEl = host.shadowRoot.getElementById("obaengal-live-start-name");
    if (nameEl) nameEl.textContent = name;
    const messageEl = host.shadowRoot.getElementById("obaengal-live-start-message");
    if (messageEl) {
      if (category) {
        messageEl.appendChild(document.createTextNode("님이 카테고리를 변경하였습니다. "));
        const categoryEl = document.createElement("span");
        categoryEl.className = "category";
        categoryEl.textContent = category;
        messageEl.appendChild(categoryEl);

      } else {
        messageEl.textContent = suffix;
      }
    }
    const toast = host.shadowRoot.getElementById("obaengal-live-start-toast");
    const watchButton = host.shadowRoot.getElementById("obaengal-live-start-watch");
    const closeButton = host.shadowRoot.getElementById("obaengal-live-start-close");
    const goTarget = () => { window.location.href = "https://chzzk.naver.com/" + encodeURIComponent(targetChannelId()); };
    if (watchButton) watchButton.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); goTarget(); });
    clearTimeout(host._obaengalLiveToastTimer);
    clearTimeout(host._obaengalLiveToastRemoveTimer);
    clearTimeout(host._obaengalLiveToastHiddenExpireTimer);
    const hideToast = () => {
      if (!host || !host.isConnected || !toast) return;
      toast.classList.add("is-exiting");
      host._obaengalLiveToastRemoveTimer = setTimeout(() => {
        if (host && host.isConnected) host.remove();
      }, 220);
    };
    const startTimer = () => {
      clearTimeout(host._obaengalLiveToastTimer);
      host._obaengalLiveToastTimer = setTimeout(hideToast, 5000);
    };
    if (closeButton) closeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearTimeout(host._obaengalLiveToastTimer);
      clearTimeout(host._obaengalLiveToastRemoveTimer);
      clearTimeout(host._obaengalLiveToastHiddenExpireTimer);
      hideToast();
    });
    if (toast) {
      toast.addEventListener("mouseenter", () => {
        clearTimeout(host._obaengalLiveToastTimer);
        clearTimeout(host._obaengalLiveToastRemoveTimer);
        clearTimeout(host._obaengalLiveToastHiddenExpireTimer);
        toast.classList.remove("is-exiting");
      });
      toast.addEventListener("mouseleave", startTimer);
    }
    if (document.visibilityState === "visible") {
      startTimer();
    } else {
      const createdAt = Date.now();
      const expireHiddenToast = () => {
        document.removeEventListener("visibilitychange", startTimerWhenVisible);
        if (host && host.isConnected) host.remove();
      };
      const startTimerWhenVisible = () => {
        if (document.visibilityState !== "visible") return;
        document.removeEventListener("visibilitychange", startTimerWhenVisible);
        clearTimeout(host._obaengalLiveToastHiddenExpireTimer);
        if (Date.now() - createdAt > LIVE_START_HIDDEN_TOAST_MAX_AGE) {
          if (host && host.isConnected) host.remove();
          return;
        }
        startTimer();
      };
      document.addEventListener("visibilitychange", startTimerWhenVisible);
      host._obaengalLiveToastHiddenExpireTimer = setTimeout(expireHiddenToast, LIVE_START_HIDDEN_TOAST_MAX_AGE);
    }
  }

  let liveStartCheckInFlight = false;
  let lastLiveStartCheckAt = 0;


  function targetLiveNotificationsAvailable() {
    return state.targetLiveNotificationsEnabled !== false && state.targetLiveNotificationsPublicEnabled === true;
  }

  function targetLiveNotificationSettingsVisible() {
    return state.targetLiveNotificationsPublicEnabled === true;
  }

  function effectiveLiveStartNoticeEnabled() {
    return targetLiveNotificationsAvailable() && state.liveStartNoticeEnabled !== false;
  }

  function effectiveCategoryChangeNoticeEnabled() {
    return targetLiveNotificationsAvailable() && state.categoryChangeNoticeEnabled !== false;
  }
  function getLiveNotificationContext() {
    const currentChannelId = getChannelIdFromUrl();
    const isWatchingVod = /^\/video\/[0-9]+(?:\/|$)/i.test(location.pathname);
    const target = targetChannelId();
    return {
      eligible: !!target && (isWatchingVod || (!!currentChannelId && currentChannelId.toLowerCase() !== target.toLowerCase())),
      currentChannelId, isWatchingVod, pageVisible: document.visibilityState === "visible",
      liveStartNoticeEnabled: effectiveLiveStartNoticeEnabled(),
      categoryChangeNoticeEnabled: effectiveCategoryChangeNoticeEnabled(),
    };
  }

  function displayTargetLiveNotification(result) {
    if (!getLiveNotificationContext().eligible) return;
    if (result && result.notify && (result.notificationType === "categoryChange" ? effectiveCategoryChangeNoticeEnabled() : effectiveLiveStartNoticeEnabled())) {
      const suffix = result.notificationType === "categoryChange" && result.categoryName
        ? "님이 카테고리를 변경하였습니다. " + result.categoryName
        : "님이 방송을 시작했습니다";
      showLiveStartToast(result.channelName || "따효니", result.channelImageUrl || "", suffix, result.notificationType === "categoryChange" ? result.categoryName : "");
    }
  }

  async function checkTargetLiveStartToast(force) {
    if (liveStartCheckInFlight) {
      return;
    }
    const currentChannelId = getChannelIdFromUrl();
    const isWatchingVod = /^\/video\/[0-9]+(?:\/|$)/i.test(location.pathname);
    const target = targetChannelId();
    if (!target || (!isWatchingVod && (!currentChannelId || currentChannelId.toLowerCase() === target.toLowerCase()))) {
      return;
    }
    const now = Date.now();
    if (!force && now - lastLiveStartCheckAt < LIVE_START_CHECK_INTERVAL) return;
    lastLiveStartCheckAt = now;
    liveStartCheckInFlight = true;
    try {
      const result = await sendRuntimeMessage({
        type: "checkTargetLiveStart",
        currentChannelId,
        isWatchingVod,
        pageVisible: document.visibilityState === "visible",
        liveStartNoticeEnabled: effectiveLiveStartNoticeEnabled(),
        categoryChangeNoticeEnabled: effectiveCategoryChangeNoticeEnabled(),
      });
      displayTargetLiveNotification(result);
    } catch (_e) {
    } finally {
      liveStartCheckInFlight = false;
    }
  }

  function startLiveStartWatcher() {
    api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message && message.type === "getLiveNotificationContext") {
        sendResponse(getLiveNotificationContext());
      }
      if (message && message.type === "targetLiveNotification") {
        displayTargetLiveNotification(message.result);
        sendResponse({ ok: true });
      }
    });
    setTimeout(() => checkTargetLiveStartToast(true), 2500);
    setInterval(() => checkTargetLiveStartToast(false), LIVE_START_CHECK_INTERVAL);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkTargetLiveStartToast(true);
    });
    document.addEventListener("fullscreenchange", ensureLiveStartToastHost);
    document.addEventListener("webkitfullscreenchange", ensureLiveStartToastHost);
  }

  function indexSchedule() {
    state.byDate.clear();
    const list = (state.channel && state.channel.schedule) || [];
    for (const entry of list) {
      if (entry && entry.date) state.byDate.set(entry.date, entry);
    }
  }

  function entryFor(key) {
    return state.byDate.get(key) || null;
  }

  function visibleNoteText(note) {
    if (note && typeof note === "object") {
      const content = String(note.content || note.text || note.note || "");
      return content.trim() && !note.hidden ? content : "";
    }
    const content = String(note || "");
    return content.trim() ? content : "";
  }

  function entryNotes(entry) {
    if (!entry) return [];
    if (Array.isArray(entry.notes)) return entry.notes.map(visibleNoteText).filter(Boolean);
    const note = visibleNoteText(entry.note);
    return note ? [note] : [];
  }

  function partNotes(part) {
    if (!part) return [];
    if (Array.isArray(part.notes)) return part.notes.map(visibleNoteText).filter(Boolean);
    const note = visibleNoteText(part.note);
    return note ? [note] : [];
  }

  function entryHasPartNotes(entry) {
    return !!(entry && entry.parts && entry.parts.some((part) => partNotes(part).length > 0));
  }
  function hasEntryBefore(key) {
    for (const k of state.byDate.keys()) if (k < key) return true;
    return false;
  }

  function hasEntryAfter(key) {
    for (const k of state.byDate.keys()) if (k > key) return true;
    return false;
  }

  // 오늘을 그리드 첫 칸에 둘지, 가운데 칸에 둘지 결정.
  // D+3 또는 D+4에 확정된 일정(미정이 아님)이 있으면 첫 칸, 없으면 가운데(D-2~D+2).
  function todayAnchorOffset() {
    const today = parseKey(state.todayKey);
    const hasFarEntry = !!entryFor(dateKey(addDays(today, 3))) || !!entryFor(dateKey(addDays(today, 4)));
    return hasFarEntry ? 0 : -2;
  }

  // ----------------------------------------------------------
  // 헤더 필 4상태
  // ----------------------------------------------------------
  function pillState() {
    const e = entryFor(state.todayKey);
    if (!e) {
      return { cls: "cs-pill-unknown", html: '오늘 방송 미정' };
    }
    if (e.status === "off") {
      return { cls: "cs-pill-off", html: '오늘 휴방' };
    }
    if (e.start) {
      return { cls: "cs-pill-on", html: '<span class="cs-dot"></span>오늘 방송 ' + escapeHtml(e.start) };
    }
    return { cls: "cs-pill-on", html: '<span class="cs-dot"></span>오늘 방송 예정 (시간 미정)' };
  }

  function lolStreamerRankForCurrentChannel() {
    const rank = state.data && state.data.lolStreamerRanks && state.data.lolStreamerRanks[state.channelId];
    return rank && typeof rank === "object" ? rank : null;
  }

  function lolRankText(rank) {
    if (!rank || !rank.tier) return "";
    const tierLabels = { IRON: "아이언", BRONZE: "브론즈", SILVER: "실버", GOLD: "골드", PLATINUM: "플래티넘", EMERALD: "에메랄드", DIAMOND: "다이아", MASTER: "마스터", GRANDMASTER: "그마", CHALLENGER: "챌린저" };
    const tier = tierLabels[rank.tier] || rank.tier;
    const division = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(rank.tier) ? "" : (rank.rank ? " " + rank.rank : "");
    const lp = Number.isFinite(Number(rank.leaguePoints)) ? " " + Number(rank.leaguePoints) + "LP" : "";
    return tier + division + lp;
  }

  function lolRankBadgeHtml() {
    const rank = lolStreamerRankForCurrentChannel();
    const text = lolRankText(rank);
    if (!text) return "";
    const name = rank.riotGameName ? rank.riotGameName + (rank.riotTagLine ? "#" + rank.riotTagLine : "") : "";
    return '<span class="cs-lol-rank-badge" title="' + escapeHtml(name || "현재 솔로랭크") + '"><span>솔랭</span>' + escapeHtml(text) + '</span>';
  }

  function lolTierIconUrl(rank) {
    const tier = String((rank && rank.tier) || "").trim().toLowerCase();
    if (!tier) return "";
    return "https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/ranked-emblem/emblem-" + encodeURIComponent(tier) + ".png";
  }

  function lolRiotIdText(rank) {
    if (!rank || !rank.riotGameName) return "LoL 경기 로그";
    return rank.riotGameName + (rank.riotTagLine ? "#" + rank.riotTagLine : "");
  }

  function lolDivisionLabel(rank) {
    if (!rank || !rank.rank) return "";
    const tier = String(rank.tier || "").toUpperCase();
    if (["MASTER", "GRANDMASTER", "CHALLENGER"].includes(tier)) return "";
    const division = String(rank.rank || "").toUpperCase();
    return /^(I|II|III|IV)$/.test(division) ? division : "";
  }

  function lolLogToggleHtml(lolLogMode) {
    if (lolLogMode) {
      return '<button type="button" class="cs-lol-log-toggle cs-open" id="cs-lol-log-toggle" aria-pressed="true">방송 일정</button>';
    }
    const rank = lolStreamerRankForCurrentChannel();
    const rankText = lolRankText(rank) || "현재 솔로랭크";
    const riotId = lolRiotIdText(rank);
    const tierIcon = lolTierIconUrl(rank);
    const division = lolDivisionLabel(rank);
    const emblemHtml = tierIcon
      ? '<img class="cs-lol-toggle-emblem" src="' + escapeHtml(tierIcon) + '" alt="" loading="lazy" />'
      : '<span class="cs-lol-toggle-emblem cs-lol-toggle-emblem-fallback" aria-hidden="true"></span>';
    const divisionHtml = division ? '<span class="cs-lol-toggle-division" aria-label="세부 티어 ' + escapeHtml(division) + '">' + escapeHtml(division) + '</span>' : "";
    return '<button type="button" class="cs-lol-log-toggle cs-lol-rank-toggle" id="cs-lol-log-toggle" aria-pressed="false" aria-label="' + escapeHtml(rankText + " 경기 로그") + '">' +
      emblemHtml + divisionHtml + '<span class="cs-lol-toggle-id">' + escapeHtml(riotId) + '</span></button>';
  }

  function lolRankSummaryHtml(rank, text) {
    const icon = lolTierIconUrl(rank);
    return '<div class="cs-lol-summary-rank">' +
      '<div class="cs-lol-summary-rank-emblem">' +
      (icon ? '<img src="' + escapeHtml(icon) + '" alt="" loading="lazy" />' : '') +
      '</div>' +
      '<strong>' + escapeHtml(text || "-") + '</strong>' +
      '</div>';
  }

  function lolMatchLogsForCurrentChannel() {
    const logs = state.data && state.data.lolMatchLogs && state.data.lolMatchLogs[state.channelId];
    return Array.isArray(logs) ? logs : [];
  }

  function lolCanonicalMatchKey(item) {
    const id = String((item && item.matchId) || "").trim();
    if (id) return id.replace(/^ui-test-/i, "");
    return [item && item.gameStartAt, item && item.championId, item && item.teamPosition].map((value) => String(value || "")).join("|");
  }

  function lolMatchInProgress(item) {
    return !!item && item.win == null && !item.gameEndAt &&
      !!lolChampionPortraitUrl(item) &&
      !!(Number(item.primaryRuneId) || (item.runeIds || []).length);
  }

  function lolUniqueMatchLogs(logs) {
    const seen = new Set();
    const list = [];
    (logs || []).forEach((item) => {
      const key = lolCanonicalMatchKey(item);
      if (!key || seen.has(key)) return;
      seen.add(key);
      list.push(item);
    });
    return list;
  }

  function stableStringifyForFingerprint(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(stableStringifyForFingerprint).join(",") + "]";
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + stableStringifyForFingerprint(value[key])).join(",") + "}";
  }

  function currentChannelScheduleFingerprint() {
    const channel = state.channel || {};
    return stableStringifyForFingerprint({
      channelId: state.channelId || "",
      schedule: channel.schedule || [],
      updatedAt: state.data && state.data.updatedAt || "",
      notices: state.data && state.data.notices || [],
      updateHistories: state.data && state.data.updateHistories || [],
      targetLiveNotificationsEnabled: state.targetLiveNotificationsEnabled !== false,
      targetLiveNotificationsPublicEnabled: state.targetLiveNotificationsPublicEnabled === true,
    });
  }

  function currentLolMatchLogFingerprint() {
    const rank = lolStreamerRankForCurrentChannel();
    return stableStringifyForFingerprint({
      channelId: state.channelId || "",
      rank: rank || null,
      logs: lolRecentMatchLogs(100).map((item) => ({
        matchId: item && item.matchId || "",
        scheduleDate: item && item.scheduleDate || "",
        gameStartAt: item && item.gameStartAt || "",
        gameEndAt: item && item.gameEndAt || "",
        position: item && item.teamPosition || "",
        championId: item && item.championId || null,
        result: item && item.win,
        k: item && item.kills || 0,
        d: item && item.deaths || 0,
        a: item && item.assists || 0,
        damage: item && item.damageToChampions || null,
        csPerMinute: item && item.csPerMinute || null,
        goldPerMinute: item && item.goldPerMinute || null,
        teamDamageShare: item && item.teamDamageShare || null,
        killParticipation: item && item.killParticipation || null,
        visionScorePerMinute: item && item.visionScorePerMinute || null,
        wardsKilled: item && item.wardsKilled || null,
        primaryRuneId: item && item.primaryRuneId || null,
        secondaryStyleId: item && item.secondaryStyleId || null,
        itemIds: item && item.itemIds || [],
      })),
    });
  }

  function currentViewFingerprint() {
    return state.scheduleViewMode === "lolMatchLogs"
      ? currentLolMatchLogFingerprint()
      : currentChannelScheduleFingerprint();
  }

  function rememberRenderedFingerprint() {
    const value = currentViewFingerprint();
    if (state.scheduleViewMode === "lolMatchLogs") state.lastRenderedLolFingerprint = value;
    else state.lastRenderedScheduleFingerprint = value;
    return value;
  }

  function captureLolLogScroll() {
    const log = state.shadow && state.shadow.querySelector && state.shadow.querySelector(".cs-lol-log");
    return log ? log.scrollTop : 0;
  }

  function restoreLolLogScroll(scrollTop) {
    if (state.scheduleViewMode !== "lolMatchLogs" || !Number.isFinite(Number(scrollTop))) return;
    const log = state.shadow && state.shadow.querySelector && state.shadow.querySelector(".cs-lol-log");
    if (log) log.scrollTop = Math.max(0, Number(scrollTop));
  }

  function shouldRenderAfterAutoRefresh(beforeFingerprint) {
    const afterFingerprint = currentViewFingerprint();
    if (state.scheduleViewMode === "lolMatchLogs") {
      return afterFingerprint !== (beforeFingerprint || state.lastRenderedLolFingerprint);
    }
    return afterFingerprint !== (beforeFingerprint || state.lastRenderedScheduleFingerprint);
  }

  function lolSupportPosition(item) {
    const position = String((item && item.teamPosition) || "").toUpperCase();
    return position === "UTILITY" || position === "SUPPORT";
  }

  function lolRecentMatchLogs(limit) {
    return lolUniqueMatchLogs(lolMatchLogsForCurrentChannel()).slice(0, limit);
  }

  function lolMatchStartMs(item) {
    const start = item && item.gameStartAt ? new Date(String(item.gameStartAt)).getTime() : NaN;
    if (Number.isFinite(start)) return start;
    const key = String((item && item.scheduleDate) || "").trim();
    const fallback = /^\d{4}-\d{2}-\d{2}$/.test(key) ? new Date(key + "T00:00:00+09:00").getTime() : NaN;
    return Number.isFinite(fallback) ? fallback : 0;
  }

  function lolRecentDaysMatchLogs(logs, days) {
    const now = Date.now();
    const cutoff = now - Math.max(1, Number(days) || 30) * 24 * 60 * 60 * 1000;
    return (logs || []).filter((item) => {
      const time = lolMatchStartMs(item);
      return time && time >= cutoff && time <= now + 24 * 60 * 60 * 1000;
    });
  }

  function lolMatchDateLabel(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ""))) return String(key || "");
    return popoverDateLabel(parseKey(key));
  }

  function lolMatchTimeLabel(value) {
    if (!value) return "시간 미정";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "시간 미정";
    return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function lolQueueLabel(item) {
    if (Number(item.queueId) === 420 || item.queueLabel === "솔로랭크") return "랭크";
    if (item.queueLabel) return item.queueLabel;
    const labels = { 400: "일반", 420: "랭크", 430: "일반", 440: "자유랭크", 450: "칼바람" };
    return labels[item.queueId] || (item.queueId ? "큐 " + item.queueId : "경기");
  }

  function lolPositionLabel(value) {
    const labels = { TOP: "탑", JUNGLE: "정글", MIDDLE: "미드", MID: "미드", BOTTOM: "원딜", ADC: "원딜", UTILITY: "서폿", SUPPORT: "서폿" };
    return labels[String(value || "").toUpperCase()] || "포지션 미정";
  }

  function lolPositionIconSvg(value) {
    const key = String(value || "").toUpperCase();
    const icon = key === "TOP" ? '<path d="M7 17 17 7"/><path d="M8 8h8v8"/><path d="M5 19h5"/>' :
      key === "JUNGLE" ? '<path d="M12 4c-4 3-6 6-6 10a6 6 0 0 0 12 0c0-4-2-7-6-10Z"/><path d="M12 8v9"/><path d="M9 12h6"/>' :
      key === "MIDDLE" || key === "MID" ? '<path d="M5 19 19 5"/><path d="M6 8V6h2"/><path d="M16 18h2v-2"/>' :
      key === "BOTTOM" || key === "ADC" ? '<path d="M17 7 7 17"/><path d="M16 16H8V8"/><path d="M14 19h5"/>' :
      key === "UTILITY" || key === "SUPPORT" ? '<circle cx="12" cy="8" r="3"/><path d="M6 20c1-4 3-6 6-6s5 2 6 6"/><path d="M12 11v5"/>' :
      '<circle cx="12" cy="12" r="7"/><path d="M12 8v4l3 2"/>';
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#bfdbfe" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + icon + '</svg>');
  }
  const LOL_DATA_DRAGON_VERSION = "16.18.1";
  const LOL_RUNE_ICON_PATHS = {"8000":"perk-images/Styles/7201_Precision.png","8005":"perk-images/Styles/Precision/PressTheAttack/PressTheAttack.png","8008":"perk-images/Styles/Precision/LethalTempo/LethalTempoTemp.png","8009":"perk-images/Styles/Precision/PresenceOfMind/PresenceOfMind.png","8010":"perk-images/Styles/Precision/Conqueror/Conqueror.png","8014":"perk-images/Styles/Precision/CoupDeGrace/CoupDeGrace.png","8017":"perk-images/Styles/Precision/CutDown/CutDown.png","8021":"perk-images/Styles/Precision/FleetFootwork/FleetFootwork.png","8100":"perk-images/Styles/7200_Domination.png","8105":"perk-images/Styles/Domination/RelentlessHunter/RelentlessHunter.png","8106":"perk-images/Styles/Domination/UltimateHunter/UltimateHunter.png","8112":"perk-images/Styles/Domination/Electrocute/Electrocute.png","8126":"perk-images/Styles/Domination/CheapShot/CheapShot.png","8128":"perk-images/Styles/Domination/DarkHarvest/DarkHarvest.png","8135":"perk-images/Styles/Domination/TreasureHunter/TreasureHunter.png","8137":"perk-images/Styles/Domination/SixthSense/SixthSense.png","8139":"perk-images/Styles/Domination/TasteOfBlood/GreenTerror_TasteOfBlood.png","8140":"perk-images/Styles/Domination/GrislyMementos/GrislyMementos.png","8141":"perk-images/Styles/Domination/DeepWard/DeepWard.png","8143":"perk-images/Styles/Domination/SuddenImpact/SuddenImpact.png","8200":"perk-images/Styles/7202_Sorcery.png","8210":"perk-images/Styles/Sorcery/Transcendence/Transcendence.png","8214":"perk-images/Styles/Sorcery/SummonAery/SummonAery.png","8224":"perk-images/Styles/Sorcery/NullifyingOrb/Axiom_Arcanist.png","8226":"perk-images/Styles/Sorcery/ManaflowBand/ManaflowBand.png","8229":"perk-images/Styles/Sorcery/ArcaneComet/ArcaneComet.png","8230":"perk-images/Styles/Sorcery/PhaseRush/StormraidersSurgeRuneIcon2.png","8232":"perk-images/Styles/Sorcery/Waterwalking/Waterwalking.png","8233":"perk-images/Styles/Sorcery/AbsoluteFocus/AbsoluteFocus.png","8234":"perk-images/Styles/Sorcery/Celerity/CelerityTemp.png","8236":"perk-images/Styles/Sorcery/GatheringStorm/GatheringStorm.png","8237":"perk-images/Styles/Sorcery/Scorch/Scorch.png","8242":"perk-images/Styles/Sorcery/Unflinching/Unflinching.png","8275":"perk-images/Styles/Sorcery/NimbusCloak/6361.png","8299":"perk-images/Styles/Sorcery/LastStand/LastStand.png","8300":"perk-images/Styles/7203_Whimsy.png","8304":"perk-images/Styles/Inspiration/MagicalFootwear/MagicalFootwear.png","8306":"perk-images/Styles/Inspiration/HextechFlashtraption/HextechFlashtraption.png","8313":"perk-images/Styles/Inspiration/PerfectTiming/AlchemistCabinet.png","8316":"perk-images/Styles/Inspiration/JackOfAllTrades/JackofAllTrades2.png","8321":"perk-images/Styles/Inspiration/CashBack/CashBack2.png","8345":"perk-images/Styles/Inspiration/BiscuitDelivery/BiscuitDelivery.png","8347":"perk-images/Styles/Inspiration/CosmicInsight/CosmicInsight.png","8351":"perk-images/Styles/Inspiration/GlacialAugment/GlacialAugment.png","8352":"perk-images/Styles/Inspiration/TimeWarpTonic/TimeWarpTonic.png","8360":"perk-images/Styles/Inspiration/UnsealedSpellbook/UnsealedSpellbook.png","8369":"perk-images/Styles/Inspiration/FirstStrike/FirstStrike.png","8400":"perk-images/Styles/7204_Resolve.png","8401":"perk-images/Styles/Resolve/MirrorShell/MirrorShell.png","8410":"perk-images/Styles/Resolve/ApproachVelocity/ApproachVelocity.png","8429":"perk-images/Styles/Resolve/Conditioning/Conditioning.png","8437":"perk-images/Styles/Resolve/GraspOfTheUndying/GraspOfTheUndying.png","8439":"perk-images/Styles/Resolve/VeteranAftershock/VeteranAftershock.png","8444":"perk-images/Styles/Resolve/SecondWind/SecondWind.png","8446":"perk-images/Styles/Resolve/Demolish/Demolish.png","8451":"perk-images/Styles/Resolve/Overgrowth/Overgrowth.png","8453":"perk-images/Styles/Resolve/Revitalize/Revitalize.png","8463":"perk-images/Styles/Resolve/FontOfLife/FontOfLife.png","8465":"perk-images/Styles/Resolve/Guardian/Guardian.png","8473":"perk-images/Styles/Resolve/BonePlating/BonePlating.png","8992":"perk-images/Styles/Sorcery/DeathfireTouch/DEATHFIRE_TOUCH_KEYSTONE.png","9101":"perk-images/Styles/Precision/AbsorbLife/AbsorbLife.png","9103":"perk-images/Styles/Precision/LegendBloodline/LegendBloodline.png","9104":"perk-images/Styles/Precision/LegendAlacrity/LegendAlacrity.png","9105":"perk-images/Styles/Precision/LegendHaste/LegendHaste.png","9111":"perk-images/Styles/Precision/Triumph.png","9923":"perk-images/Styles/Domination/HailOfBlades/HailOfBlades.png"};
  const LOL_ITEM_NAMES = {"1001":"장화","1004":"요정의 부적","1006":"원기 회복의 구슬","1011":"거인의 허리띠","1018":"민첩성의 망토","1026":"방출의 마법봉","1027":"사파이어 수정","1028":"루비 수정","1029":"천 갑옷","1031":"쇠사슬 조끼","1033":"마법무효화의 망토","1035":"잉걸불 칼","1036":"롱소드","1037":"곡괭이","1038":"B.F. 대검","1039":"빗발칼날","1040":"흑요석 검","1042":"단검","1043":"곡궁","1052":"증폭의 고서","1053":"흡혈의 낫","1054":"도란의 방패","1055":"도란의 검","1056":"도란의 반지","1057":"음전자 망토","1058":"쓸데없이 큰 지팡이","1082":"암흑의 인장","1083":"수확의 낫","1086":"도란의 활","1090":"퀘스트: 상단","1091":"퀘스트: 중단","1092":"퀘스트: 하단","1093":"퀘스트: 서포터","1094":"퀘스트: 정글","1101":"새끼 화염발톱","1102":"새끼 바람돌이","1103":"새끼 이끼쿵쿵이","1104":"전령의 눈","1105":"새끼 이끼쿵쿵이","1106":"새끼 바람돌이","1107":"새끼 화염발톱","1111":"자르반 1세의","1120":"도란의 투구","1200":"상단 공격로 퀘스트","1201":"중단 공격로 퀘스트","1202":"하단 공격로 퀘스트","1203":"서포터 퀘스트","1204":"정글 퀘스트","1205":"정글 퀘스트 보상","1206":"중단 공격로 퀘스트 보상","1207":"하단 공격로 퀘스트 보상","1208":"서포터 퀘스트 보상","1209":"정글 퀘스트 보상","1210":"정글 퀘스트 보상","1211":"정글 퀘스트 보상","1220":"강력 순간이동 (상단 공격로 퀘스트 보상)","1221":"상단 공격로 퀘스트 보상","1222":"상단 공격로 퀘스트","1500":"관통 탄환","1501":"요새화","1502":"이중 갑옷","1503":"파수꾼의 눈","1504":"수호자","1505":"이중 갑옷","1506":"이중 갑옷","1507":"과충전","1508":"방탄 양말","1509":"체질","1510":"특이 체질","1511":"슈퍼 메크 방어구","1512":"슈퍼 메크 전력장","1515":"포탑 방패","1516":"구조물 현상금","1517":"구조물 현상금","1518":"구조물 현상금","1519":"구조물 현상금","1520":"과충전HA","1521":"요새화","1522":"포탑 강화","1523":"과충전","1524":"과잉성장","2001":"귀환","2002":"상급 귀환","2003":"체력 물약","2007":"귀환 비활성화","2010":"굳건한 의지의 완전한 비스킷","2015":"키르히아이스의 파편","2019":"강철 인장","2020":"야수화","2021":"땅굴 채굴기","2022":"빛나는 티끌","2031":"충전형 물약","2033":"부패 물약","2049":"수호자의 부적","2050":"수호자의 장막","2051":"수호자의 뿔피리","2052":"포로 간식","2055":"제어 와드","2056":"투명 와드","2065":"슈렐리아의 군가","2138":"강철의 영약","2139":"마법의 영약","2140":"분노의 영약","2141":"카파 주스","2142":"힘의 주스","2143":"활력의 주스","2144":"가속의 주스","2145":"행운의 주사위","2146":"향상된 행운의 주사위","2147":"증강 레벨","2150":"숙련의 영약","2151":"탐욕의 영약","2152":"힘의 영약","2161":"힘의 밴들 주스","2162":"활력의 밴들 주스","2163":"가속의 밴들 주스","2403":"미니언 해체분석기","2420":"추적자의 팔목 보호대","2421":"부서진 팔목 보호대","2422":"약간 신비한 신발","2501":"지배자의 피갑옷","2502":"끝없는 절망","2503":"어둠불꽃 횃불","2504":"케이닉 루컨","2508":"운명의 재","2510":"황혼과 새벽","2512":"악마사냥꾼의 화살","2517":"끝없는 갈망","2520":"요새파괴자","2522":"실체화 장비","2523":"마법광학 장치 C44","2524":"밴들파이프","2525":"원형질 안전벨트","2526":"속삭이는 머리띠","2530":"악곡의 왕관","3001":"저녁갑주","3002":"개척자","3003":"대천사의 지팡이","3004":"마나무네","3005":"유령 배회자","3006":"광전사의 군화","3008":"탐욕의 군화","3009":"신속의 장화","3010":"공생형 밑창","3011":"화학공학 부패기","3012":"축복의 성배","3013":"하나 된 영혼","3020":"마법사의 신발","3023":"생명의 샘 펜던트","3024":"얼음 방패","3026":"수호 천사","3031":"무한의 대검","3032":"윤 탈 야생화살","3033":"필멸자의 운명","3035":"최후의 속삭임","3036":"도미닉 경의 인사","3039":"아트마의 심판","3040":"대천사의 포옹","3041":"메자이의 영혼약탈자","3042":"무라마나","3044":"탐식의 망치","3046":"유령 무희","3047":"판금 장화","3050":"지크의 융합","3051":"온기가 필요한 자의 도끼","3053":"스테락의 도전","3057":"광휘의 검","3065":"정령의 형상","3066":"비상의 월갑","3067":"점화석","3068":"태양불꽃 방패","3070":"여신의 눈물","3071":"칠흑의 양날 도끼","3072":"피바라기","3073":"실험적 마공학판","3074":"굶주린 히드라","3075":"가시 갑옷","3076":"덤불 조끼","3077":"티아맷","3078":"삼위일체","3082":"파수꾼의 갑옷","3083":"워모그의 갑옷","3084":"강철심장","3085":"루난의 허리케인","3086":"열정의 검","3087":"스태틱의 단검","3089":"라바돈의 죽음모자","3091":"마법사의 최후","3094":"고속 연사포","3095":"폭풍갈퀴","3100":"리치베인","3102":"밴시의 장막","3105":"군단의 방패","3107":"구원","3108":"악마의 마법서","3109":"기사의 맹세","3110":"얼어붙은 심장","3111":"헤르메스의 발걸음","3112":"수호자의 보주","3113":"에테르 환영","3114":"금지된 우상","3115":"내셔의 이빨","3116":"라일라이의 수정홀","3117":"기동력의 장화","3118":"악의","3119":"혹한의 손길","3121":"종말의 겨울","3123":"처형인의 대검","3124":"구인수의 격노검","3128":"죽음불꽃 손아귀","3131":"신성의 검","3133":"콜필드의 전투 망치","3134":"톱날 단검","3135":"공허의 지팡이","3137":"무덤꽃","3139":"헤르메스의 시미터","3140":"수은 장식띠","3142":"요우무의 유령검","3143":"란두인의 예언","3144":"정찰병의 새총","3145":"마법공학 교류 발전기","3146":"마법공학 총검","3147":"기괴한 가면","3152":"마법공학 로켓 벨트","3153":"몰락한 왕의 검","3155":"주문포식자","3156":"맬모셔스의 아귀","3157":"존야의 모래시계","3158":"명석함의 아이오니아 장화","3161":"쇼진의 창","3165":"모렐로노미콘","3168":"불멸의 길","3170":"신속행진","3171":"핏빛 명석함","3172":"건메탈 군화","3173":"사슬끈 분쇄자","3174":"무장 진격","3175":"주문투척자의 신발","3176":"영원한 전진","3177":"수호자의 검","3179":"그림자 검","3181":"선체파괴자","3184":"수호자의 망치","3190":"강철의 솔라리 펜던트","3193":"가고일 돌갑옷","3211":"망령의 두건","3222":"미카엘의 축복","3302":"경계","3330":"허수아비","3340":"투명 와드","3348":"비전 탐지기","3349":"광휘의 특이점","3363":"망원형 개조","3364":"예언자의 렌즈","3398":"작은 파티 선물","3399":"파티 선물","3400":"수당","3430":"파멸의식 고서","3504":"불타는 향로","3508":"정수 약탈자","3513":"전령의 눈","3599":"칼리스타의 칠흑의 창","3600":"칼리스타의 칠흑의 창","3742":"망자의 갑옷","3748":"거대한 히드라","3801":"수정 팔 보호구","3802":"사라진 양피지","3803":"억겁의 카탈리스트","3814":"밤의 끝자락","3850":"주문도둑의 검","3851":"얼음 송곳니","3853":"얼음 정수의 파편","3854":"강철 어깨 보호대","3855":"룬 강철 어깨 갑옷","3857":"화이트록의 갑옷","3858":"고대유물 방패","3859":"타곤 산의 방패","3860":"타곤 산의 방벽","3862":"영혼의 낫","3863":"해로윙 초승달낫","3864":"검은 안개 낫","3865":"세계 지도집","3866":"룬 나침반","3867":"세계의 결실","3869":"천상의 이의","3870":"꿈 생성기","3871":"자자크의 세계가시","3876":"태양의 썰매","3877":"피의 노래","3901":"가차없는 포격바다뱀 은화 500닢","3902":"죽음의 여신바다뱀 은화 500닢","3903":"사기진작바다뱀 은화 500닢","3916":"망각의 구","4003":"생명선","4004":"망령 해적검","4005":"제국의 명령","4010":"핏빛 저주","4011":"꽃피는 새벽의 검","4012":"죄악 포식자","4013":"번개 끈","4014":"얼어붙은 망치","4015":"당혹","4016":"무언의 서약","4017":"지옥불 손도끼","4401":"대자연의 힘","4402":"활력증진의 펜던트","4403":"황금 뒤집개","4628":"지평선의 초점","4629":"우주의 추진력","4630":"역병의 보석","4632":"신록의 장벽","4633":"균열 생성기","4635":"흡수의 시선","4636":"밤의 수확자","4637":"악마의 포옹","4638":"감시하는 와드석","4641":"고무의 와드석","4642":"밴들유리 거울","4643":"경계의 와드석","4644":"부서진 여왕의 왕관","4645":"그림자불꽃","4646":"폭풍 쇄도","6029":"강철가시 채찍","6032":"추가 능력치","6035":"은빛 여명","6333":"죽음의 무도","6609":"화공 펑크 사슬검","6610":"갈라진 하늘","6616":"흐르는 물의 지팡이","6617":"월석 재생기","6620":"헬리아의 메아리","6621":"새벽심장","6630":"선혈포식자","6631":"발걸음 분쇄기","6632":"신성한 파괴자","6653":"리안드리의 고통","6655":"루덴의 메아리","6656":"만년서리","6657":"영겁의 지팡이","6660":"바미의 불씨","6662":"얼어붙은 건틀릿","6664":"공허한 광휘","6665":"해신 작쇼","6667":"광휘의 미덕","6670":"절정의 화살","6671":"돌풍","6672":"크라켄 학살자","6673":"불멸의 철갑궁","6675":"나보리 명멸검","6676":"징수의 총","6677":"분노의 칼","6690":"꽁지깃","6691":"드락사르의 황혼검","6692":"월식","6693":"자객의 발톱","6694":"세릴다의 원한","6695":"독사의 송곳니","6696":"원칙의 원형낫","6697":"오만","6698":"불경한 히드라","6699":"벼락폭풍검","6700":"라코어의 방패","6701":"기회","6702":"전방 정찰","7050":"갱플랭크 Placeholder","8001":"증오의 사슬","8010":"핏빛 저주","8020":"심연의 가면","9168":"잠긴 무기 슬롯","9171":"회오리 칼날","9172":"유미봇","9173":"광휘 역장","9174":"스태틱의 검","9175":"사자의 비가","9176":"개틀링 토끼 건","9177":"타오르는 단궁","9178":"절멸자","9179":"전투 토끼 석궁","9180":"귀여운 발사기","9181":"소용돌이 장갑","9183":"칼날 부메랑","9184":"토끼 초강력 폭발","9185":"상어잡이 해양 기뢰","9187":"티.버","9188":"동물 지뢰","9189":"최후의 도시 대중교통","9190":"메아리치는 박쥐칼날","9192":"발자국 중독 장치","9193":"얼음작렬 갑옷","9271":"그치지 않는 폭풍","9272":"유미봇_최종_최종","9273":"폭발의 포옹","9274":"프룸비스의 전기도축칼","9275":"휘감는 빛","9276":"이중 깡충깡충 포화","9277":"진화한 불꽃 사격","9278":"동물의 종말","9279":"토끼 프라임 거대 석궁","9280":"왕 귀여운 발사기","9281":"폭풍의 건틀릿","9283":"사중 부메랑","9284":"고속 토끼 속사포","9285":"무한의 괴물 퇴치기","9287":"티.버 (특.대.형 에디션)","9288":"징크스의 삼중 다이너마이트","9289":"FC 급행열차","9290":"베인의 크로마칼날","9292":"맨발 화학 물질 분사기","9293":"완전 빙결","9300":"야옹 야옹","9301":"방패 타격","9302":"음향의 물결","9303":"족쇄 할퀴기","9304":"강철 폭풍","9305":"촉수 후려치기","9306":"날개 달린 단검","9307":"인도의 저주","9308":"토끼뜀","9400":"전투 고양이 총알 세례","9401":"사자의 광명","9402":"동물 메아리","9403":"포악한 베기","9404":"떠도는 폭풍","9405":"곰의 강타","9406":"연인의 도탄","9407":"고양된 저주","9408":"당근 격돌","123430":"파멸의식 고서","124011":"꽃피는 새벽의 검","126697":"오만","220000":"추가 능력치","220001":"전설 전사 아이템","220002":"전설 원거리 딜러 아이템","220003":"전설 암살자 아이템","220004":"전설 마법사 아이템","220005":"전설 탱커 아이템","220006":"전설 서포터 아이템","220007":"프리즘 아이템","220008":"모루 교환권","220009":"골드 능력치 모루 교환권","220010":"프리즘 능력치 모루 교환권","220011":"용기 교환권","220012":"파편검","220013":"포로 간식","221011":"거인의 허리띠","221026":"방출의 마법봉","221031":"쇠사슬 조끼","221038":"B.F. 대검","221043":"곡궁","221053":"흡혈의 낫","221057":"음전자 망토","221058":"쓸데없이 큰 지팡이","222022":"빛나는 티끌","222051":"수호자의 뿔피리","222065":"슈렐리아의 군가","222141":"카파 주스","222502":"끝없는 절망","222503":"어둠불꽃 횃불","222504":"케이닉 루컨","222510":"황혼과 새벽","222512":"악마사냥꾼의 화살","222517":"끝없는 갈망","222522":"실체화 장비","222523":"마법광학 장치 C44","222524":"밴들파이프","222525":"원형질 안전벨트","222526":"속삭이는 머리띠","222530":"악곡의 왕관","223001":"저녁갑주","223002":"개척자","223003":"대천사의 지팡이","223004":"마나무네","223005":"유령 배회자","223006":"광전사의 군화","223008":"탐욕의 군화","223009":"신속의 장화","223011":"화학공학 부패기","223020":"마법사의 신발","223026":"수호 천사","223031":"무한의 대검","223032":"윤 탈 야생화살","223033":"필멸자의 운명","223036":"도미닉 경의 인사","223039":"아트마의 심판","223040":"대천사의 포옹","223042":"무라마나","223046":"유령 무희","223047":"판금 장화","223050":"지크의 융합","223053":"스테락의 도전","223057":"광휘의 검","223065":"정령의 형상","223067":"점화석","223068":"태양불꽃 방패","223069":"공허의 불길","223071":"칠흑의 양날 도끼","223072":"피바라기","223073":"실험적 마공학판","223074":"굶주린 히드라","223075":"가시 갑옷","223078":"삼위일체","223084":"강철심장","223085":"루난의 허리케인","223087":"스태틱의 단검","223089":"라바돈의 죽음모자","223091":"마법사의 최후","223094":"고속 연사포","223095":"폭풍갈퀴","223100":"리치베인","223102":"밴시의 장막","223105":"군단의 방패","223107":"구원","223109":"기사의 맹세","223110":"얼어붙은 심장","223111":"헤르메스의 발걸음","223112":"수호자의 보주","223115":"내셔의 이빨","223116":"라일라이의 수정홀","223118":"악의","223119":"혹한의 손길","223121":"종말의 겨울","223124":"구인수의 격노검","223135":"공허의 지팡이","223137":"무덤꽃","223139":"헤르메스의 시미터","223142":"요우무의 유령검","223143":"란두인의 예언","223146":"마법공학 총검","223152":"마법공학 로켓 벨트","223153":"몰락한 왕의 검","223156":"맬모셔스의 아귀","223157":"존야의 모래시계","223158":"명석함의 아이오니아 장화","223161":"쇼진의 창","223165":"모렐로노미콘","223172":"서풍","223177":"수호자의 검","223181":"선체파괴자","223184":"수호자의 망치","223185":"수호자의 단검","223190":"강철의 솔라리 펜던트","223193":"가고일 돌갑옷","223222":"미카엘의 축복","223302":"경계","223504":"불타는 향로","223508":"정수 약탈자","223742":"망자의 갑옷","223748":"거대한 히드라","223814":"밤의 끝자락","224004":"망령 해적검","224005":"제국의 명령","224401":"대자연의 힘","224403":"황금 뒤집개","224628":"지평선의 초점","224629":"우주의 추진력","224633":"균열 생성기","224636":"밤의 수확자","224637":"악마의 포옹","224644":"부서진 여왕의 왕관","224645":"그림자불꽃","224646":"폭풍 쇄도","226035":"은빛 여명","226333":"죽음의 무도","226609":"화공 펑크 사슬검","226610":"갈라진 하늘","226616":"흐르는 물의 지팡이","226617":"월석 재생기","226620":"헬리아의 메아리","226621":"새벽심장","226630":"선혈포식자","226631":"발걸음 분쇄기","226632":"신성한 파괴자","226653":"리안드리의 고뇌","226655":"루덴의 메아리","226656":"만년서리","226657":"영겁의 지팡이","226662":"얼어붙은 건틀릿","226664":"공허한 광휘","226665":"해신 작쇼","226667":"광휘의 미덕","226668":"궁극의 히드라","226671":"돌풍","226672":"크라켄 학살자","226673":"불멸의 철갑궁","226675":"나보리 명멸검","226676":"징수의 총","226691":"드락사르의 황혼검","226692":"월식","226693":"자객의 발톱","226694":"세릴다의 원한","226695":"독사의 송곳니","226696":"원칙의 원형낫","226697":"오만","226698":"불경한 히드라","226699":"벼락폭풍검","226701":"기회","228001":"증오의 사슬","228002":"우글렛의 마녀 모자","228003":"죽음의 검","228004":"적응형 투구","228005":"흑요석 양날 도끼","228006":"핏빛 칼날","228008":"룬 글레이브","228009":"다용도 도구","228020":"심연의 가면","322065":"슈렐리아의 군가","322526":"속삭이는 머리띠","322530":"악곡의 왕관","323002":"개척자","323003":"대천사의 지팡이","323004":"마나무네","323040":"대천사의 포옹","323042":"무라마나","323050":"지크의 융합","323070":"여신의 눈물","323075":"가시 갑옷","323107":"구원","323109":"기사의 맹세","323110":"얼어붙은 심장","323119":"혹한의 손길","323121":"종말의 겨울","323190":"강철의 솔라리 펜던트","323222":"미카엘의 축복","323504":"불타는 향로","324005":"제국의 명령","326616":"흐르는 물의 지팡이","326617":"월석 재생기","326620":"헬리아의 메아리","326621":"새벽심장","326657":"영겁의 지팡이","328020":"심연의 가면","443054":"흑강철 발톱","443055":"질책","443056":"불사대마왕의 왕관","443058":"용암의 방패","443059":"별빛밤 망토","443060":"신성의 검","443061":"엔트로피의 힘","443062":"핏빛 선물","443063":"일라이자의 기적","443064":"승천의 부적","443069":"불귀신","443079":"터보 화공 탱크","443080":"쌍둥이 가면","443081":"마공화살 동료","443083":"워모그의 갑옷","443090":"사신의 대가","443193":"가고일 돌갑옷","444636":"밤의 수확자","444637":"악마의 포옹","444644":"부서진 여왕의 왕관","446632":"신성한 파괴자","446656":"만년서리","446667":"광휘의 미덕","446671":"돌풍","446691":"드락사르의 황혼검","446693":"자객의 발톱","447100":"신기루 검","447101":"도박꾼의 칼날","447102":"현실 균열","447103":"혈마법사의 투구","447104":"활력증진의 펜던트","447105":"창공의 서약","447106":"용의 심장","447107":"참수자","447108":"룬 조각기","447109":"잔혹 행위","447110":"달빛 마법검","447111":"지배자의 피갑옷","447112":"살점포식자","447113":"폭발의 구","447114":"반향","447115":"섭정 시해","447116":"킨코우 십수","447118":"화염술사의 망토","447119":"번개 막대","447120":"다이아몬드 창","447121":"황혼의 끝자락","447122":"블랙홀 건틀릿","447123":"조종의 손아귀","550001":"체력 바 색칠: 파랑","550002":"체력 바 색칠: 주황","550003":"체력 바 색칠: 초록","550004":"체력 바 색칠: 분홍","550005":"체력 바 청소: 색상 초기화","550006":"체력 바 색칠: 무지개","550007":"파티 선물","663039":"아트마의 심판","663056":"불사대마왕의 왕관","663058":"용암의 방패","663059":"별빛밤 망토","663060":"신성의 검","663064":"베이가의 승천의 부적","663146":"마법공학 총검","663172":"서풍","663193":"가고일 돌갑옷","664011":"꽃피는 새벽의 검","664403":"황금 뒤집개","664644":"부서진 여왕의 왕관","667101":"도박꾼의 칼날","667109":"잔혹 행위","667112":"살점포식자","667666":"징수의 총","771001":"속도의 장화","771004":"요정의 부적","771006":"원기 회복의 구슬","771011":"거인의 허리띠","771018":"민첩성의 망토","771026":"방출의 마법봉","771027":"사파이어 수정","771028":"루비 수정","771029":"천 갑옷","771031":"쇠사슬 조끼","771033":"마법무효화의 망토","771036":"롱소드","771037":"곡괭이","771038":"B.F. 대검","771039":"사냥꾼의 마체테","771042":"단검","771043":"곡궁","771051":"싸움꾼의 장갑","771052":"증폭의 고서","771053":"흡혈의 낫","771054":"도란의 방패","771055":"도란의 검","771056":"도란의 반지","771057":"음전자 망토","771058":"쓸데없이 큰 지팡이","771080":"정령석","771500":"관통 탄환","772001":"귀환","772003":"체력 물약","772004":"마나 물약","772009":"원기회복의 완전한 비스킷","772037":"불굴의 영약","772038":"민첩의 영약","772039":"지능의 영약","772041":"수정 플라스크","772042":"예언자의 영약","772043":"투명 감지 와드","772044":"시야 와드","772045":"루비 시야석","772049":"시야석","772050":"탐험가의 와드","773001":"심연의 홀","773003":"대천사의 지팡이","773004":"마나무네","773005":"아트마의 창","773006":"광전사의 군화","773009":"신속의 장화","773010":"수호자 카탈리스트","773020":"마법사의 신발","773022":"얼어붙은 망치","773023":"쌍둥이 그림자","773024":"빙하의 장막","773025":"얼어붙은 건틀릿","773026":"수호 천사","773027":"영겁의 지팡이","773028":"조화의 성배","773031":"무한의 대검","773035":"최후의 속삭임","773037":"마나의 보주","773040":"대천사의 포옹","773041":"메자이의 영혼약탈자","773042":"무라마나","773044":"탐식의 망치","773046":"유령 무희","773047":"닌자의 신발","773050":"스타크의 열정","773052":"용맹의 징표","773056":"저항 공성기","773057":"광휘의 검","773060":"지휘관의 깃발","773063":"영혼의 갑옷","773064":"대자연의 힘","773065":"정령의 형상","773067":"점화석","773068":"태양불꽃 망토","773069":"슈렐리아의 몽상","773070":"여신의 눈물","773071":"칠흑의 양날 도끼","773072":"피바라기","773073":"태양불꽃 망토 무더기","773074":"굶주린 히드라","773075":"가시 갑옷","773077":"티아맷","773078":"삼위일체","773082":"파수꾼의 갑옷","773083":"워모그의 갑옷","773084":"활력증진의 펜던트","773085":"루난의 허리케인","773086":"열정의 검","773087":"스태틱의 단검","773089":"라바돈의 죽음모자","773091":"마법사의 최후","773092":"얼음 정수의 파편","773093":"탐욕의 검","773096":"현자의 돌","773098":"행운 피크","773100":"리치베인","773101":"쐐기검","773102":"밴시의 장막","773105":"군단의 방패","773106":"마드레드의 갈퀴손","773107":"룬 방벽","773108":"악마의 마법서","773109":"마드레드의 피갈퀴손","773110":"얼어붙은 심장","773111":"헤르메스의 발걸음","773114":"역병의 비수","773115":"내셔의 이빨","773116":"라일라이의 수정홀","773117":"기동력의 장화","773123":"처형인의 대검","773124":"구인수의 격노검","773128":"죽음불꽃 손아귀","773131":"신성의 검","773132":"황금의 심장","773134":"야수화","773135":"공허의 지팡이","773136":"기괴한 가면","773138":"레비아탄 갑옷","773139":"헤르메스의 시미터","773140":"수은 장식띠","773141":"비술의 검","773142":"요우무의 유령검","773143":"란두인의 예언","773144":"빌지워터 해적검","773145":"마법공학 리볼버","773146":"마법공학 총검","773151":"리안드리의 고통","773152":"고대인의 의지","773153":"몰락한 왕의 검","773154":"리글의 랜턴","773155":"주문포식자","773156":"맬모셔스의 아귀","773157":"존야의 모래시계","773158":"명석함의 아이오니아 장화","773160":"야생의 섬광","773165":"모렐로노미콘","773172":"서풍","773173":"일라이자의 기적","773174":"슈세이의 마나 통","773178":"이온 충격기","773190":"강철의 솔라리 펜던트","773191":"추적자의 팔목 보호대","773206":"망령의 영혼","773207":"고대 골렘의 영혼","773209":"도마뱀 장로의 영혼","773211":"망령의 두건","773222":"미카엘의 도가니","773340":"노란색 장신구","773348":"빨간색 장신구","773504":"불타는 향로","773512":"즈롯 차원문","773513":"프로토타입 마공학 핵","773514":"마공학 핵 mk-1","773515":"마공학 핵 mk-2","773516":"완성형 마공학 핵","773517":"에그노그","773518":"티백","773519":"캔디 콘","773521":"체력 물약","994403":"황금 뒤집개"};

  function lolDataDragonAssetUrl(assetPath) {
    const clean = String(assetPath || "").replace(/^\/+/, "");
    return clean ? "https://ddragon.leagueoflegends.com/cdn/img/" + clean : "";
  }

  function lolRuneIconUrl(id) {
    const key = String(Number(id) || "");
    return LOL_RUNE_ICON_PATHS[key] ? lolDataDragonAssetUrl(LOL_RUNE_ICON_PATHS[key]) : "";
  }

  function lolItemIconUrl(id) {
    const number = Number(id);
    if (!Number.isFinite(number) || number <= 0) return "";
    return "https://ddragon.leagueoflegends.com/cdn/" + LOL_DATA_DRAGON_VERSION + "/img/item/" + encodeURIComponent(String(Math.round(number))) + ".png";
  }

  function lolItemName(id) {
    const key = String(Math.round(Number(id) || 0));
    return LOL_ITEM_NAMES[key] || "";
  }

  function lolChampionPortraitUrl(item) {
    const id = Number(item && item.championId);
    if (Number.isFinite(id) && id > 0) return "https://cdn.communitydragon.org/latest/champion/" + encodeURIComponent(String(id)) + "/square";
    const name = String((item && item.championName) || "").trim();
    return name ? "https://cdn.communitydragon.org/latest/champion/" + encodeURIComponent(name) + "/square" : "";
  }

  // Korean server Data Dragon names, bundled for immediate offline lookup.
  const LOL_CHAMPION_NAMES_KO = {"266":"아트록스","Aatrox":"아트록스","103":"아리","Ahri":"아리","84":"아칼리","Akali":"아칼리","166":"아크샨","Akshan":"아크샨","12":"알리스타","Alistar":"알리스타","799":"암베사","Ambessa":"암베사","32":"아무무","Amumu":"아무무","34":"애니비아","Anivia":"애니비아","1":"애니","Annie":"애니","523":"아펠리오스","Aphelios":"아펠리오스","22":"애쉬","Ashe":"애쉬","136":"아우렐리온 솔","AurelionSol":"아우렐리온 솔","893":"오로라","Aurora":"오로라","268":"아지르","Azir":"아지르","432":"바드","Bard":"바드","200":"벨베스","Belveth":"벨베스","53":"블리츠크랭크","Blitzcrank":"블리츠크랭크","63":"브랜드","Brand":"브랜드","201":"브라움","Braum":"브라움","233":"브라이어","Briar":"브라이어","51":"케이틀린","Caitlyn":"케이틀린","164":"카밀","Camille":"카밀","69":"카시오페아","Cassiopeia":"카시오페아","31":"초가스","Chogath":"초가스","42":"코르키","Corki":"코르키","122":"다리우스","Darius":"다리우스","131":"다이애나","Diana":"다이애나","119":"드레이븐","Draven":"드레이븐","36":"문도 박사","DrMundo":"문도 박사","245":"에코","Ekko":"에코","60":"엘리스","Elise":"엘리스","28":"이블린","Evelynn":"이블린","81":"이즈리얼","Ezreal":"이즈리얼","9":"피들스틱","Fiddlesticks":"피들스틱","114":"피오라","Fiora":"피오라","105":"피즈","Fizz":"피즈","3":"갈리오","Galio":"갈리오","41":"갱플랭크","Gangplank":"갱플랭크","86":"가렌","Garen":"가렌","150":"나르","Gnar":"나르","79":"그라가스","Gragas":"그라가스","104":"그레이브즈","Graves":"그레이브즈","887":"그웬","Gwen":"그웬","120":"헤카림","Hecarim":"헤카림","74":"하이머딩거","Heimerdinger":"하이머딩거","910":"흐웨이","Hwei":"흐웨이","420":"일라오이","Illaoi":"일라오이","39":"이렐리아","Irelia":"이렐리아","427":"아이번","Ivern":"아이번","40":"잔나","Janna":"잔나","59":"자르반 4세","JarvanIV":"자르반 4세","24":"잭스","Jax":"잭스","126":"제이스","Jayce":"제이스","202":"진","Jhin":"진","222":"징크스","Jinx":"징크스","145":"카이사","Kaisa":"카이사","429":"칼리스타","Kalista":"칼리스타","43":"카르마","Karma":"카르마","30":"카서스","Karthus":"카서스","38":"카사딘","Kassadin":"카사딘","55":"카타리나","Katarina":"카타리나","10":"케일","Kayle":"케일","141":"케인","Kayn":"케인","85":"케넨","Kennen":"케넨","121":"카직스","Khazix":"카직스","203":"킨드레드","Kindred":"킨드레드","240":"클레드","Kled":"클레드","96":"코그모","KogMaw":"코그모","897":"크산테","KSante":"크산테","7":"르블랑","Leblanc":"르블랑","64":"리 신","LeeSin":"리 신","89":"레오나","Leona":"레오나","876":"릴리아","Lillia":"릴리아","127":"리산드라","Lissandra":"리산드라","805":"로크","Locke":"로크","236":"루시안","Lucian":"루시안","117":"룰루","Lulu":"룰루","99":"럭스","Lux":"럭스","54":"말파이트","Malphite":"말파이트","90":"말자하","Malzahar":"말자하","57":"마오카이","Maokai":"마오카이","11":"마스터 이","MasterYi":"마스터 이","800":"멜","Mel":"멜","902":"밀리오","Milio":"밀리오","21":"미스 포츈","MissFortune":"미스 포츈","62":"오공","MonkeyKing":"오공","82":"모데카이저","Mordekaiser":"모데카이저","25":"모르가나","Morgana":"모르가나","950":"나피리","Naafiri":"나피리","267":"나미","Nami":"나미","75":"나서스","Nasus":"나서스","111":"노틸러스","Nautilus":"노틸러스","518":"니코","Neeko":"니코","76":"니달리","Nidalee":"니달리","895":"닐라","Nilah":"닐라","56":"녹턴","Nocturne":"녹턴","20":"누누와 윌럼프","Nunu":"누누와 윌럼프","2":"올라프","Olaf":"올라프","61":"오리아나","Orianna":"오리아나","516":"오른","Ornn":"오른","80":"판테온","Pantheon":"판테온","78":"뽀삐","Poppy":"뽀삐","555":"파이크","Pyke":"파이크","246":"키아나","Qiyana":"키아나","133":"퀸","Quinn":"퀸","497":"라칸","Rakan":"라칸","33":"람머스","Rammus":"람머스","421":"렉사이","RekSai":"렉사이","526":"렐","Rell":"렐","888":"레나타 글라스크","Renata":"레나타 글라스크","58":"레넥톤","Renekton":"레넥톤","107":"렝가","Rengar":"렝가","92":"리븐","Riven":"리븐","68":"럼블","Rumble":"럼블","13":"라이즈","Ryze":"라이즈","360":"사미라","Samira":"사미라","113":"세주아니","Sejuani":"세주아니","235":"세나","Senna":"세나","147":"세라핀","Seraphine":"세라핀","875":"세트","Sett":"세트","35":"샤코","Shaco":"샤코","98":"쉔","Shen":"쉔","102":"쉬바나","Shyvana":"쉬바나","27":"신지드","Singed":"신지드","14":"사이온","Sion":"사이온","15":"시비르","Sivir":"시비르","72":"스카너","Skarner":"스카너","901":"스몰더","Smolder":"스몰더","37":"소나","Sona":"소나","16":"소라카","Soraka":"소라카","50":"스웨인","Swain":"스웨인","517":"사일러스","Sylas":"사일러스","134":"신드라","Syndra":"신드라","223":"탐 켄치","TahmKench":"탐 켄치","163":"탈리야","Taliyah":"탈리야","91":"탈론","Talon":"탈론","44":"타릭","Taric":"타릭","17":"티모","Teemo":"티모","412":"쓰레쉬","Thresh":"쓰레쉬","18":"트리스타나","Tristana":"트리스타나","48":"트런들","Trundle":"트런들","23":"트린다미어","Tryndamere":"트린다미어","4":"트위스티드 페이트","TwistedFate":"트위스티드 페이트","29":"트위치","Twitch":"트위치","77":"우디르","Udyr":"우디르","6":"우르곳","Urgot":"우르곳","110":"바루스","Varus":"바루스","67":"베인","Vayne":"베인","45":"베이가","Veigar":"베이가","161":"벨코즈","Velkoz":"벨코즈","711":"벡스","Vex":"벡스","254":"바이","Vi":"바이","234":"비에고","Viego":"비에고","112":"빅토르","Viktor":"빅토르","8":"블라디미르","Vladimir":"블라디미르","106":"볼리베어","Volibear":"볼리베어","19":"워윅","Warwick":"워윅","498":"자야","Xayah":"자야","101":"제라스","Xerath":"제라스","5":"신 짜오","XinZhao":"신 짜오","157":"야스오","Yasuo":"야스오","777":"요네","Yone":"요네","83":"요릭","Yorick":"요릭","804":"유나라","Yunara":"유나라","350":"유미","Yuumi":"유미","904":"자헨","Zaahen":"자헨","154":"자크","Zac":"자크","238":"제드","Zed":"제드","221":"제리","Zeri":"제리","115":"직스","Ziggs":"직스","26":"질리언","Zilean":"질리언","142":"조이","Zoe":"조이","143":"자이라","Zyra":"자이라"};
  const LOL_RUNE_NAMES_KO = {"8100":"지배","8112":"감전","8128":"어둠의 수확","9923":"칼날비","8126":"비열한 한 방","8139":"피의 맛","8143":"돌발 일격","8137":"육감","8140":"섬뜩한 기념품","8141":"깊은 와드","8135":"보물 사냥꾼","8105":"끈질긴 사냥꾼","8106":"궁극의 사냥꾼","8300":"영감","8351":"빙결 강화","8360":"봉인 풀린 주문서","8369":"선제공격","8306":"마법공학 점멸기","8304":"마법의 신발","8321":"환급","8313":"삼중 물약","8352":"시간 왜곡 물약","8345":"비스킷 배달","8347":"우주적 통찰력","8410":"쾌속 접근","8316":"다재다능","8000":"정밀","8005":"집중 공격","8008":"치명적 속도","8021":"기민한 발놀림","8010":"정복자","9101":"생명 흡수","9111":"승전보","8009":"침착","9104":"전설: 민첩함","9105":"전설: 가속","9103":"전설: 핏빛 길","8014":"최후의 일격","8017":"체력차 극복","8299":"최후의 저항","8400":"결의","8437":"착취의 손아귀","8439":"여진","8465":"수호자","8446":"철거","8463":"생명의 샘","8401":"보호막 강타","8429":"사전 준비","8444":"재생의 바람","8473":"뼈 방패","8451":"과잉성장","8453":"소생","8242":"불굴의 의지","8200":"마법","8214":"콩콩이 소환","8229":"신비로운 유성","8230":"폭풍전사의 포효","8992":"죽음불꽃 손길","8224":"액시옴 비전 마법사","8226":"마나순환 팔찌","8275":"빛의 망토","8210":"깨달음","8234":"기민함","8233":"절대 집중","8237":"주문 작열","8232":"물 위를 걷는 자","8236":"폭풍의 결집"};

  function lolChampionName(item) {
    const name = String((item && item.championName) || "").trim();
    return LOL_CHAMPION_NAMES_KO[String(item && item.championId)] || LOL_CHAMPION_NAMES_KO[name] || name || "챔피언 미정";
  }

  function lolRuneSlotHtml(id, primary) {
    const url = lolRuneIconUrl(id);
    const name = LOL_RUNE_NAMES_KO[String(id)] || (primary ? "핵심 룬" : "보조 룬 계열");
    const label = url ? name : (primary ? "핵심 룬 기록 없음" : "보조 룬 기록 없음");
    return '<span class="cs-lol-rune-slot" tabindex="0" aria-label="' + escapeHtml(label) + '">' +
      (url ? '<img class="cs-lol-rune-icon' + (primary ? ' cs-lol-rune-primary' : '') + '" src="' + escapeHtml(url) + '" alt="" loading="lazy" />' : '<span class="cs-lol-rune-icon cs-lol-empty-slot"></span>') +
      '<span class="cs-lol-loadout-tip" role="tooltip">' + escapeHtml(label) + '</span></span>';
  }

  function lolMatchVisualHtml(item) {
    const position = lolPositionLabel(item && item.teamPosition);
    const champion = lolChampionName(item);
    const portrait = lolChampionPortraitUrl(item);
    const championHtml = portrait
      ? '<img class="cs-lol-champion-portrait" src="' + escapeHtml(portrait) + '" alt="' + escapeHtml(champion) + '" loading="lazy" />'
      : '<span class="cs-lol-champion-portrait cs-lol-champion-fallback">?</span>';
    return '<div class="cs-lol-log-visual" tabindex="0" aria-label="' + escapeHtml(position + ' · ' + champion) + '">' +
      (lolMatchInProgress(item) && position === "포지션 미정"
        ? '<span class="cs-lol-position-icon cs-lol-skeleton" role="img" aria-label="포지션 집계 대기"></span>'
        : '<img class="cs-lol-position-icon" src="' + escapeHtml(lolPositionIconSvg(item && item.teamPosition)) + '" alt="' + escapeHtml(position) + '" />') +
      championHtml +
      '<span class="cs-lol-loadout-tip" role="tooltip">' + escapeHtml(champion + ' · ' + position) + '</span>' +
      '</div>';
  }

  function lolLpDeltaText(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    return (number > 0 ? "+" : "") + number + " LP";
  }


  function lolNumberCompact(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "-";
    if (number >= 10000) return (number / 10000).toFixed(number >= 100000 ? 0 : 1).replace(/\.0$/, "") + "만";
    if (number >= 1000) return (number / 1000).toFixed(number >= 10000 ? 0 : 1).replace(/\.0$/, "") + "천";
    return String(Math.round(number));
  }

  function lolDamageCap(logs) {
    const max = Math.max(...(logs || []).map((item) => Number(item.damageToChampions || 0)));
    return Number.isFinite(max) && max > 0 ? max : 1;
  }
  function lolLoadoutHtml(item, runesOnly = false) {
    const runeIds = Array.isArray(item && item.runeIds) ? item.runeIds : [];
    const primaryRuneId = Number(item && item.primaryRuneId) || Number(runeIds[0]) || 0;
    const secondaryStyleId = Number(item && item.secondaryStyleId) || 0;
    const itemIds = (Array.isArray(item && item.itemIds) ? item.itemIds : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)
      .slice(0, 7);
    const runeSlots = lolRuneSlotHtml(primaryRuneId, true) + lolRuneSlotHtml(secondaryStyleId, false);
    if (runesOnly) return '<div class="cs-lol-loadout-runes">' + runeSlots + '</div>';
    const itemSlots = Array.from({ length: 7 }, (_, index) => {
      const id = itemIds[index];
      if (!id) {
        return '<span class="cs-lol-loadout-slot"><span class="cs-lol-item-icon cs-lol-empty-slot"></span><span class="cs-lol-loadout-tip" role="tooltip">빈 아이템 슬롯</span></span>';
      }
      const name = lolItemName(id) || "아이템 " + String(id);
      return '<span class="cs-lol-loadout-slot" aria-label="' + escapeHtml(name) + '">' +
        '<img class="cs-lol-item-icon" src="' + escapeHtml(lolItemIconUrl(id)) + '" alt="" loading="lazy" />' +
        '<span class="cs-lol-loadout-tip" role="tooltip">' + escapeHtml(name) + '</span>' +
        '</span>';
    }).join('');
    return '<div class="cs-lol-loadout" aria-label="룬 및 최종 아이템 빌드">' +
      '<div class="cs-lol-loadout-runes">' + runeSlots + '</div>' +
      '<span class="cs-lol-loadout-divider"></span>' +
      '<div class="cs-lol-loadout-items">' + itemSlots + '</div>' +
      '</div>';
  }

  function lolCoreStatsHtml(item, damageCap) {
    const kdaHtml = '<span class="cs-lol-kda-stat"><b>KDA</b><strong>' + escapeHtml(String(item.kills || 0)) + '/' + escapeHtml(String(item.deaths || 0)) + '/' + escapeHtml(String(item.assists || 0)) + '</strong></span>';
    if (lolSupportPosition(item)) {
      const killParticipation = Number(item && item.killParticipation);
      const kpText = Number.isFinite(killParticipation) ? killParticipation.toFixed(1).replace(/\.0$/, "") + "%" : "-";
      const visionPerMinute = Number(item && item.visionScorePerMinute);
      const visionText = Number.isFinite(visionPerMinute) ? visionPerMinute.toFixed(1).replace(/\.0$/, "") : "-";
      const wardsKilled = Number(item && item.wardsKilled);
      const wardsText = Number.isFinite(wardsKilled) ? String(Math.round(wardsKilled)) : "-";
      return '<div class="cs-lol-log-meta">' +
        kdaHtml +
        '<span class="cs-lol-kp-stat"><b>킬 관여율</b><strong>' + escapeHtml(kpText) + '</strong></span>' +
        '<span class="cs-lol-vision-stat"><b>분당 시야</b><strong>' + escapeHtml(visionText) + '</strong></span>' +
        '<span class="cs-lol-ward-stat"><b>와드 제거</b><strong>' + escapeHtml(wardsText) + '</strong></span>' +
        '</div>';
    }
    const damage = Number(item && item.damageToChampions);
    const damageText = Number.isFinite(damage) && damage > 0 ? lolNumberCompact(damage) : "-";
    const damageWidth = Number.isFinite(damage) && damage > 0 ? Math.max(6, Math.min(100, Math.round((damage / Math.max(1, damageCap)) * 100))) : 0;
    const csPerMinute = Number(item && item.csPerMinute);
    const csText = Number.isFinite(csPerMinute) ? csPerMinute.toFixed(1).replace(/\.0$/, "") : "-";
    const goldPerMinute = Number(item && item.goldPerMinute);
    const goldText = Number.isFinite(goldPerMinute) ? String(Math.round(goldPerMinute)) : "-";
    const teamDamageShare = Number(item && item.teamDamageShare);
    const shareText = Number.isFinite(teamDamageShare) ? teamDamageShare.toFixed(1).replace(/\.0$/, "") + "%" : "-";
    return '<div class="cs-lol-log-meta">' +
      kdaHtml +
      '<span class="cs-lol-damage"><b>총 딜량</b><i><em style="width:' + escapeHtml(String(damageWidth)) + '%"></em></i><strong>' + escapeHtml(damageText) + '</strong></span>' +
      '<span class="cs-lol-cs-stat"><b>분당 CS</b><strong>' + escapeHtml(csText) + '</strong></span>' +
      '<span class="cs-lol-gold-stat"><b>분당 골드</b><strong>' + escapeHtml(goldText) + '</strong></span>' +
      '<span class="cs-lol-share-stat"><b>팀 내 피해량 지분</b><strong>' + escapeHtml(shareText) + '</strong></span>' +
      '</div>';
  }
  function lolWinRateText(wins, games) {
    if (!games) return "0%";
    return Math.round((wins / games) * 100) + "%";
  }

  function lolAverageKdaText(items) {
    const games = items.length;
    if (!games) return "-";
    const kills = items.reduce((sum, item) => sum + Number(item.kills || 0), 0) / games;
    const deaths = items.reduce((sum, item) => sum + Number(item.deaths || 0), 0) / games;
    const assists = items.reduce((sum, item) => sum + Number(item.assists || 0), 0) / games;
    if (deaths <= 0) return "Perfect";
    return ((kills + assists) / deaths).toFixed(2);
  }

  function lolTopPositionText(items) {
    const counts = new Map();
    items.forEach((item) => {
      const key = String((item && item.teamPosition) || "").toUpperCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    let best = "";
    let count = 0;
    counts.forEach((value, key) => {
      if (value > count) { best = key; count = value; }
    });
    return best ? lolPositionLabel(best) + " " + count + "판" : "-";
  }

  function lolChampionSummary(items) {
    const byChampion = new Map();
    items.forEach((item) => {
      const key = String((item && item.championId) || (item && item.championName) || "").trim();
      if (!key) return;
      if (!byChampion.has(key)) byChampion.set(key, { sample: item, games: 0, wins: 0, items: [] });
      const entry = byChampion.get(key);
      entry.games += 1;
      if (item.win === true) entry.wins += 1;
      entry.items.push(item);
    });
    return Array.from(byChampion.values()).sort((a, b) => b.games - a.games || b.wins - a.wins || String(a.sample.championName || "").localeCompare(String(b.sample.championName || ""))).slice(0, 5);
  }

  function lolTierScore(tier, rank, lp) {
    const tierOrder = { IRON: 0, BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4, EMERALD: 5, DIAMOND: 6, MASTER: 7, GRANDMASTER: 8, CHALLENGER: 9 };
    const divisionOrder = { IV: 0, III: 1, II: 2, I: 3 };
    const tierKey = String(tier || "").trim().toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(tierOrder, tierKey)) return null;
    const lpNumber = Number(lp);
    const division = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(tierKey) ? 0 : (divisionOrder[String(rank || "").trim().toUpperCase()] || 0) * 100;
    return tierOrder[tierKey] * 400 + division + (Number.isFinite(lpNumber) ? Math.max(0, lpNumber) : 0);
  }

  function lolTierShortLabel(tier, rank, lp) {
    const tierKey = String(tier || "").trim().toUpperCase();
    const labels = { IRON: "I", BRONZE: "B", SILVER: "S", GOLD: "G", PLATINUM: "P", EMERALD: "E", DIAMOND: "D", MASTER: "M", GRANDMASTER: "GM", CHALLENGER: "C" };
    if (!labels[tierKey]) return "-";
    const division = ["MASTER", "GRANDMASTER", "CHALLENGER"].includes(tierKey) ? "" : String(rank || "").replace(/^I+V?$/, (value) => value).trim();
    const lpNumber = Number(lp);
    return labels[tierKey] + division + (Number.isFinite(lpNumber) ? " " + lpNumber + "LP" : "");
  }

  function lolTierTrendPoints(items) {
    return items.slice().sort((a, b) => lolMatchStartMs(a) - lolMatchStartMs(b)).map((item) => {
      const score = lolTierScore(item.tierAfter, item.rankAfter, item.lpAfter);
      if (!Number.isFinite(score)) return null;
      return { score, label: lolTierShortLabel(item.tierAfter, item.rankAfter, item.lpAfter) };
    }).filter(Boolean);
  }

  function lolTierTrendHtml(items) {
    const points = lolTierTrendPoints(items);
    if (points.length < 2) {
      return '<strong>기록 수집 중</strong><small>최근 30일</small>';
    }
    const scores = points.map((point) => point.score);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const range = Math.max(1, max - min);
    const width = 150;
    const height = 44;
    const coords = points.map((point, index) => {
      const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
      const y = height - ((point.score - min) / range) * 34 - 5;
      return x.toFixed(1) + "," + y.toFixed(1);
    });
    const first = points[0].label;
    const last = points[points.length - 1].label;
    return '<div class="cs-lol-tier-trend"><svg viewBox="0 0 150 44" aria-hidden="true"><polyline points="' + escapeHtml(coords.join(" ")) + '" /></svg><small>' + escapeHtml(first + ' -> ' + last) + '</small></div>';
  }

  function lolRecentSummaryHtml(logs) {
    logs = logs.filter((item) => typeof item.win === "boolean");
    const monthItems = lolRecentDaysMatchLogs(logs, 30);
    const items = monthItems.length ? monthItems : logs.slice(0, 10);
    if (!items.length) return "";
    const recentItems = logs.slice(0, 10);
    const rank = lolStreamerRankForCurrentChannel();
    const rankText = lolRankText(rank) || "-";
    const wins = items.filter((item) => item.win === true).length;
    const losses = items.filter((item) => item.win === false).length;
    const recentWins = recentItems.filter((item) => item.win === true).length;
    const recentLosses = recentItems.filter((item) => item.win === false).length;
    const champs = lolChampionSummary(items);
    const champHtml = champs.length ? champs.map((entry) => {
      const champion = lolChampionName(entry.sample);
      const portrait = lolChampionPortraitUrl(entry.sample);
      return '<div class="cs-lol-summary-champ" tabindex="0" aria-label="' + escapeHtml(champion) + '">' +
        (portrait ? '<img src="' + escapeHtml(portrait) + '" alt="' + escapeHtml(champion) + '" loading="lazy" />' : '<span>?</span>') +
        '<div><strong>' + escapeHtml(String(entry.games) + '판') + '</strong><small>승률 ' + escapeHtml(lolWinRateText(entry.wins, entry.games)) + '</small></div>' +
        '<span class="cs-lol-loadout-tip cs-lol-champion-tip" role="tooltip">' + escapeHtml(champion) + '</span>' +
        '</div>';
    }).join("") : '<span class="cs-lol-summary-muted">기록 없음</span>';
    return '<section class="cs-lol-summary" aria-label="최근 30일 요약">' +
      '<div class="cs-lol-summary-stat cs-lol-summary-rank-card"><span>현재 티어</span>' + lolRankSummaryHtml(rank, rankText) + '</div>' +
      '<div class="cs-lol-summary-stat cs-lol-summary-bottom"><span>최근 30일</span><strong>' + escapeHtml(String(wins) + '승 ' + String(losses) + '패') + '</strong><small>' + escapeHtml(lolWinRateText(wins, items.length)) + '</small></div>' +
      '<div class="cs-lol-summary-stat"><span>티어 변화</span>' + lolTierTrendHtml(items) + '</div>' +
      '<div class="cs-lol-summary-stat cs-lol-summary-bottom"><span>주 포지션</span><strong>' + escapeHtml(lolTopPositionText(items)) + '</strong><small>KDA ' + escapeHtml(lolAverageKdaText(items)) + '</small></div>' +
      '<div class="cs-lol-summary-stat cs-lol-summary-bottom"><span>최근 폼</span><strong>' + escapeHtml(String(recentWins) + '승 ' + String(recentLosses) + '패') + '</strong><small>최근 ' + escapeHtml(String(recentItems.length)) + '경기</small></div>' +
      '<div class="cs-lol-summary-champs"><span>최근 30일 TOP5 챔피언</span><div>' + champHtml + '</div></div>' +
      '</section>';
  }

  function lolMatchLogHtml() {
    const logs = lolRecentMatchLogs(100);
    if (!logs.length) {
      return '<div class="cs-lol-log-empty">아직 표시할 리그 오브 레전드 경기 로그가 없습니다.</div>';
    }
    const byDate = new Map();
    logs.forEach((item) => {
      const key = String(item.scheduleDate || "").trim() || "unknown";
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(item);
    });
    const damageCap = lolDamageCap(logs);
    return lolRecentSummaryHtml(logs) + '<div class="cs-lol-log">' + Array.from(byDate.entries()).map(([key, items]) => {
      const rows = items.map((item) => {
        if (lolMatchInProgress(item)) {
          return '<div class="cs-lol-log-row cs-lol-in-progress">' +
            '<div class="cs-lol-log-time">' + escapeHtml(lolMatchTimeLabel(item.gameStartAt)) + '</div>' +
            '<div class="cs-lol-live-visual">' + lolMatchVisualHtml(item) + lolLoadoutHtml(item, true) + '</div>' +
            '<div class="cs-lol-log-main" aria-label="게임 진행 중, 종료 후 데이터 집계" aria-busy="true">' +
            '<div class="cs-lol-log-title"><span class="cs-lol-log-title-text">' + escapeHtml(lolQueueLabel(item)) + '</span><span class="cs-lol-skeleton cs-lol-skeleton-result" aria-hidden="true"></span></div>' +
            '<div class="cs-lol-skeleton-stats" aria-hidden="true">' +
            Array.from({ length: 5 }, (_, index) =>
              '<span class="cs-lol-skeleton-stat"><b class="cs-lol-scramble" style="--cs-scramble-offset:' + (-index * 0.37) + 's">' +
              '<span></span><span></span><span></span><span></span></b><i class="cs-lol-skeleton cs-lol-skeleton-value"></i></span>').join('') + '</div>' +
            '<div class="cs-lol-skeleton-items" aria-hidden="true">' + Array.from({ length: 7 }, () => '<span class="cs-lol-skeleton cs-lol-skeleton-item"></span>').join('') + '</div>' +
            '</div><div class="cs-lol-live-note" title="경기 종료 후 통계 반영까지 잠시만 기다려주세요.">경기 종료 후 통계 반영까지 잠시만 기다려주세요.</div></div>';
        }
        const resultClass = item.win === true ? " cs-win" : item.win === false ? " cs-loss" : "";
        const resultText = item.win === true ? "승리" : item.win === false ? "패배" : "결과 미정";
        return '<div class="cs-lol-log-row">' +
          '<div class="cs-lol-log-time">' + escapeHtml(lolMatchTimeLabel(item.gameStartAt)) + '</div>' +
          lolMatchVisualHtml(item) +
          '<div class="cs-lol-log-main">' +
          '<div class="cs-lol-log-title"><span class="cs-lol-log-title-text">' + escapeHtml(lolQueueLabel(item)) + '</span><span class="cs-lol-result' + resultClass + '">' + resultText + '</span></div>' +
          lolCoreStatsHtml(item, damageCap) +
          lolLoadoutHtml(item) +
          '</div>' +
          '</div>';
      }).join("");
      return '<section class="cs-lol-log-day"><div class="cs-lol-log-date"><span>' + escapeHtml(lolMatchDateLabel(key)) + '</span><small>' + escapeHtml(String(items.length) + '경기') + '</small></div>' + rows + '</section>';
    }).join("") + '</div>';
  }

  // ----------------------------------------------------------
  // 스타일 (Shadow DOM 내부에만 적용)
  // ----------------------------------------------------------
  const STYLE = `
    .cs-lol-live-visual { display: flex; flex-direction: column; align-items: center; gap: 4px; }
    .cs-lol-log-row.cs-lol-in-progress { position: relative; }
    .cs-lol-in-progress .cs-lol-log-visual, .cs-lol-in-progress .cs-lol-champion-portrait { width: 36px; height: 36px; }
    .cs-lol-in-progress .cs-lol-rune-icon { width: 18px; height: 18px; }
    .cs-lol-in-progress .cs-lol-log-main { gap: 3px; }
    .cs-lol-in-progress .cs-lol-skeleton-stats { flex-wrap: nowrap; overflow: hidden; }
    .cs-lol-in-progress .cs-lol-skeleton-stat { flex: 0 0 auto; }
    .cs-lol-skeleton { display: inline-block; flex: 0 0 auto; border-radius: 5px; background: rgba(160,166,180,.2); animation: cs-lol-skeleton-pulse 1.8s ease-in-out infinite; }
    .cs-lol-position-icon.cs-lol-skeleton { background: #454851; border-color: rgba(160,166,180,.3); box-shadow: none; }
    .cs-lol-skeleton-result { width: 30px; height: 14px; }
    .cs-lol-skeleton-stats { display: flex; flex-wrap: wrap; gap: 6px; }
    .cs-lol-skeleton-stat { display: inline-flex; align-items: center; gap: 5px; min-height: 18px; padding: 0 6px; }
    .cs-lol-skeleton-stat b { color: #8f939b; font-size: 11px; font-weight: 900; }
    .cs-lol-scramble { display: inline-flex; width: 44px; height: 14px; overflow: hidden; font-family: monospace; line-height: 14px; }
    .cs-lol-scramble > span { display: inline-block; width: 11px; text-align: center; }
    .cs-lol-scramble > span::after { content: "#"; animation: cs-lol-scramble-text 2.8s step-end infinite; animation-delay: var(--cs-scramble-offset, 0s); }
    .cs-lol-scramble > span:nth-child(2)::after { animation-delay: calc(var(--cs-scramble-offset, 0s) - .53s); }
    .cs-lol-scramble > span:nth-child(3)::after { animation-delay: calc(var(--cs-scramble-offset, 0s) - 1.17s); }
    .cs-lol-scramble > span:nth-child(4)::after { animation-delay: calc(var(--cs-scramble-offset, 0s) - 1.91s); }
    @keyframes cs-lol-scramble-text { 0%, 100% { content: "#"; } 10% { content: "@"; } 20% { content: "%"; } 30% { content: "&"; } 40% { content: "*"; } 50% { content: "+"; } 60% { content: "?"; } 70% { content: "!"; } 80% { content: "="; } 90% { content: "~"; } }
    .cs-lol-live-note { position: absolute; right: 10px; bottom: 9px; max-width: max(0px, calc(100% - 326px)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #9d9ea3; font-size: 14px; line-height: 1.5; text-align: right; }
    :host(.cs-light-theme) .cs-lol-live-note { color: #707580; }
    .cs-lol-skeleton-value { width: 38px; height: 12px; }
    .cs-lol-skeleton-items { display: flex; flex-wrap: nowrap; gap: 4px; padding: 0; overflow: hidden; }
    .cs-lol-skeleton-item { width: 22px; height: 22px; }
    :host(.cs-light-theme) .cs-lol-skeleton { background: rgba(90,100,118,.18); }
    :host(.cs-light-theme) .cs-lol-position-icon.cs-lol-skeleton { background: #c8cdd5; }
    @keyframes cs-lol-skeleton-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
    @media (prefers-reduced-motion: reduce) { .cs-lol-skeleton, .cs-lol-scramble > span::after { animation: none; } .cs-lol-scramble > span::after { content: "·"; } }
    :host { all: initial; }
    :host(.cs-fullscreen-hidden),
    :host(.cs-large-chat-hidden) { display: none !important; }
    * { box-sizing: border-box; margin: 0; padding: 0;
        font-family: "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
    #cs-root { position: relative; }

    .cs-wrapper { position: relative; background: #1b1c1f; border: 1px solid #2e3033;
      border-radius: 10px; margin: 0 30px 20px; }
    .cs-schedule-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin: 0 30px 6px; }
    .cs-schedule-toolbar .cs-view-tip,
    .cs-schedule-toolbar .cs-extension-collapse-tip { top: calc(100% + 6px); bottom: auto; }
    .cs-settings-toggle { position: relative; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: 7px; border: 1px solid #3b3d42; background: #25272b; color: #d7d9dd;
      font-size: 20px; line-height: 1; cursor: pointer; transition: background .15s ease, border-color .15s ease, color .15s ease; }
    .cs-settings-toggle:hover { border-color: #51545b; background: #2d2f34; color: #fff; }
    .cs-settings-toggle.cs-open { border-color: #03a950; background: #03a950; color: #ffffff; box-shadow: 0 0 0 3px rgba(3,169,80,0.18), 0 8px 18px rgba(3,169,80,0.22); }
    .cs-settings-tip { position: absolute; right: 0; top: calc(100% + 6px); z-index: 12; padding: 5px 8px;
      border-radius: 6px; border: 1px solid #303238; background: #202126; color: #f3f4f5; font-size: 12px; white-space: nowrap;
      opacity: 0; visibility: hidden; transform: translateY(-2px); transition: opacity .15s ease, transform .15s ease, visibility .15s ease; pointer-events: none; }
    .cs-settings-toggle:hover .cs-settings-tip,
    .cs-settings-toggle:focus-visible .cs-settings-tip { opacity: 1; visibility: visible; transform: translateY(0); }
    .cs-settings-panel { position: absolute; top: 38px; right: 30px; z-index: 18; width: min(330px, calc(100% - 60px)); box-sizing: border-box;
      padding: 10px; border: 1px solid #343740; border-radius: 8px; background: #202126; color: #f1f2f4;
      box-shadow: 0 12px 28px rgba(0,0,0,.34); }
    .cs-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 36px; padding: 6px 4px; }
    .cs-settings-heading { display: flex; align-items: center; gap: 6px; padding: 0 4px 6px; font-size: 13px; font-weight: 700; }
    .cs-settings-help { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 18px; height: 18px; padding: 0; border: 1px solid #727680; border-radius: 50%; color: inherit; background: transparent; font: 700 11px/1 system-ui; cursor: pointer; }
    .cs-settings-help:hover { background: rgba(128,128,128,.2); }
    .cs-settings-help:focus-visible, .cs-notification-guide-close:focus-visible { outline: 2px solid #03a950; outline-offset: 3px; }
    .cs-notification-guide { position: fixed; inset: 0; margin: auto; width: min(640px, calc(100vw - 32px)); max-height: calc(100vh - 48px); padding: 0; overflow: auto; overscroll-behavior: contain; box-sizing: border-box; border: 1px solid #727680; border-radius: 12px; background: #fff; color: #202126; box-shadow: 0 16px 48px rgba(0,0,0,.4); }
    .cs-notification-guide::backdrop { background: rgba(0,0,0,.35); }
    .cs-notification-guide-heading { position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; background: #fff; border-bottom: 1px solid #e5e7eb; font: 700 14px/1.4 system-ui; }
    .cs-notification-guide-close { width: 28px; height: 28px; border: 0; border-radius: 6px; background: #eef0f3; color: #202126; font-size: 20px; cursor: pointer; }
    .cs-notification-guide img { display: block; width: 100%; height: auto; }
    .cs-settings-row + .cs-settings-row { border-top: 1px solid rgba(255,255,255,.07); }
    .cs-settings-label { min-width: 0; color: #eef0f3; font-size: 13px; font-weight: 700; line-height: 1.35; }
    .cs-settings-switch { position: relative; flex: 0 0 auto; width: 42px; height: 24px; border: 0; border-radius: 999px; background: #4a4d54; cursor: pointer; transition: background .16s ease; }
    .cs-settings-switch::after { content: ""; position: absolute; left: 3px; top: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.28); transition: transform .16s ease; }
    .cs-settings-switch.cs-on { background: #03a950; }
    .cs-settings-switch.cs-on::after { transform: translateX(18px); }
    .cs-section { position: relative; padding: 12px 14px; }
    .cs-schedule-section { position: relative; border-radius: 10px; }
    .cs-info-section { padding: 14px; border-top: 1px solid #2e3033;
      background: rgba(15,16,18,0.28); }
    .cs-info-layout { display: flex; flex-direction: column; gap: 10px; }
    .cs-info-content-area { display: none !important; }

    .cs-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .cs-schedule-section.cs-collapsed .cs-header { margin-bottom: 0; }
    .cs-extension-collapse { position: relative; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border: 1px solid #3a3c41; border-radius: 7px; background: #242529;
      color: #c9cbd1; font-size: 10px; font-weight: 800; line-height: 1; cursor: pointer; }
    .cs-extension-collapse:hover { border-color: #51545b; background: #2d2f34; color: #fff; }
    .cs-extension-collapse-tip { position: absolute; right: 0; bottom: calc(100% + 6px); z-index: 10;
      width: max-content; padding: 5px 7px; border: 1px solid #3a3c40; border-radius: 7px;
      background: #232427; color: #efeff1; font-size: 12px; font-weight: 800; line-height: 1.2;
      box-shadow: 0 4px 14px rgba(0,0,0,0.25); opacity: 0; visibility: hidden; transform: translateY(3px);
      transition: opacity .12s ease, transform .12s ease, visibility .12s ease; pointer-events: none; }
    .cs-extension-collapse:hover .cs-extension-collapse-tip,
    .cs-extension-collapse:focus-visible .cs-extension-collapse-tip { opacity: 1; visibility: visible; transform: translateY(0); }
    .cs-schedule-body[hidden] { display: none !important; }
    .cs-title { color: #efeff1; font-size: 16px; font-weight: 600; }
    .cs-spacer { flex: 1; }
    .cs-update-notice-wrap { margin: 0 30px -1px; }
    .cs-update-notice { position: relative; z-index: 1; display: flex; align-items: center; gap: 8px; width: 100%; max-width: 100%; margin: 0; padding: 8px 10px 9px 11px; border: 1px solid rgba(0,255,163,0.38); border-bottom: 0; border-radius: 7px 7px 0 0; background: #124233; color: #d7f7ea; font-size: 12px; font-weight: 700; line-height: 1.35; box-shadow: 0 -2px 10px rgba(0,0,0,0.18); }
    .cs-update-notice-wrap + .cs-wrapper { border-top-left-radius: 0; border-top-right-radius: 0; }
    .cs-update-notice-badge { flex: 0 0 auto; display: inline-flex; align-items: center; height: 19px; padding: 0 7px; border-radius: 999px; background: rgba(0,255,163,0.18); color: #8fffd5; font-size: 11px; font-weight: 900; line-height: 1; }
    .cs-update-notice-text { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; animation: csNoticeSwap 0.22s ease-out both; }
    @keyframes csNoticeSwap { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    @media (prefers-reduced-motion: reduce) { .cs-update-notice-text { animation: none; } }
    .cs-update-notice-strong { color: #f2fff9; font-weight: 900; }
    .cs-update-notice-controls { flex: 0 0 auto; margin-left: auto; display: inline-flex; align-items: center; gap: 3px; }
    .cs-update-notice-arrow { width: 23px; height: 23px; border: 1px solid rgba(143,255,213,0.28); border-radius: 6px; background: rgba(255,255,255,0.07); color: #d7f7ea; font-size: 17px; font-weight: 900; line-height: 1; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .cs-update-notice-arrow:hover { background: rgba(255,255,255,0.15); color: #ffffff; }
    .cs-update-refresh { flex: 0 0 auto; border: 1px solid rgba(143,255,213,0.38); border-radius: 6px; background: rgba(255,255,255,0.08); color: #d7f7ea; padding: 5px 8px; font-size: 12px; font-weight: 900; line-height: 1; cursor: pointer; white-space: nowrap; }
    .cs-update-refresh:hover { background: rgba(255,255,255,0.15); color: #ffffff; }

    .cs-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 13px;
      font-weight: 600; padding: 3px 10px; border-radius: 10px; line-height: 1.4; }
    .cs-pill-on { background: rgba(0,255,163,0.12); color: #00FFA3; }
    .cs-pill-on .cs-dot { background: #00FFA3; }
    .cs-pill-unknown { background: rgba(232,194,104,0.12); color: #e8c268; }
    .cs-pill-unknown .cs-dot { background: #e8c268; }
    .cs-pill-off { background: rgba(157,158,163,0.12); color: #9d9ea3; }
    .cs-dot { width: 5px; height: 5px; border-radius: 50%; }
    .cs-break-icon { display: block; object-fit: contain; border-radius: 4px; }
    .cs-break-icon-light { display: none !important; }
    .cs-break-icon-pill { width: 16px; height: 16px; }
    .cs-cell-time .cs-break-icon { width: max(46px, 60%); height: 100%; margin: 0 auto; }
    .cs-cell.cs-cell-off { position: relative; gap: 0; padding: 0; overflow: hidden; }
    .cs-cell.cs-cell-off .cs-cell-date { position: absolute; left: 0; right: 0; top: 9px; z-index: 2; text-align: center; }
    .cs-cell.cs-cell-off .cs-cell-center-body { position: absolute; inset: 0; display: grid; place-items: end center; }
    .cs-cell.cs-cell-off .cs-cell-time { display: grid; place-items: center; width: 100%; height: 100%; margin: 0; }
    .cs-cell.cs-cell-off .cs-cell-time .cs-break-icon { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center bottom; }
    .cs-cell.cs-cell-off .cs-cell-title { position: absolute; left: 0; right: 0; top: 42px; z-index: 2; display: block; margin: 0; text-align: center; color: #c2cbdd; font-size: 15px; font-weight: 600; letter-spacing: 0.02em; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7); }
    .cs-cell.cs-cell-off:not(.cs-month-cell) .cs-cell-time { position: absolute; inset: 0; overflow: hidden; }
    .cs-cell.cs-cell-off:not(.cs-month-cell) .cs-cell-time .cs-break-icon { position: absolute; left: 50%; bottom: 0; width: 100%; height: auto; min-height: 100%; max-width: none; object-fit: cover; object-position: center bottom; transform: translateX(-50%) scale(1.1); transform-origin: bottom center; }
    .cs-undetermined-icon { display: block; object-fit: contain; }
    .cs-undetermined-icon-light { display: none !important; }
    .cs-undetermined-icon-pill { width: 16px; height: 16px; }
    .cs-cell-time .cs-undetermined-icon { width: max(46px, 56%); height: 100%; margin: 0 auto; }
    .cs-cell.cs-cell-unknown:not(.cs-cell-off) { position: relative; gap: 0; padding: 0; overflow: hidden; }
    .cs-cell.cs-cell-unknown:not(.cs-cell-off) .cs-cell-date { position: absolute; left: 0; right: 0; top: 9px; z-index: 2; text-align: center; }
    .cs-cell.cs-cell-unknown:not(.cs-cell-off) .cs-cell-center-body { position: absolute; inset: 0; display: grid; place-items: end center; }
    .cs-cell.cs-cell-unknown:not(.cs-cell-off) .cs-cell-time { position: absolute; inset: 0; display: block; width: 100%; height: 100%; margin: 0; overflow: hidden; }
    .cs-cell.cs-cell-unknown:not(.cs-cell-off) .cs-cell-time .cs-undetermined-icon { position: absolute; right: 22%; bottom: 7%; display: block; width: 100%; height: auto; min-height: 100%; max-width: none; object-position: center bottom; transform: scale(0.95); transform-origin: bottom right; }
    .cs-cell.cs-cell-unknown:not(.cs-cell-off) .cs-cell-title { position: absolute; left: 0; right: 0; top: 42px; z-index: 2; display: block; margin: 0; text-align: center; color: #c2cbdd; font-size: 15px; font-weight: 600; letter-spacing: 0.02em; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7); }

    .cs-arrow { background: none; border: none; cursor: pointer; color: #00FFA3;
      font-size: 20px; line-height: 1; padding: 2px 4px; }
    .cs-arrow:disabled { color: #4a4c52; cursor: default; }
    .cs-view-toggle { position: relative; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid #3a3c40; border-radius: 7px;
      background: #232427; color: #c9cacd; padding: 0; font-size: 14px; font-weight: 800; cursor: pointer; white-space: nowrap; }
    .cs-view-toggle:hover, .cs-view-toggle:focus-visible, .cs-view-toggle.cs-open { color: #efeff1; background: #2b2d31; border-color: #4a4c52; }
    .cs-view-icon { line-height: 1; font-size: 18px; pointer-events: none; }
    .cs-view-icon svg { display: block; width: 21px; height: 21px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .cs-view-icon img { display: block; width: 23px; height: 23px; object-fit: contain; }
    .cs-view-toggle.cs-open .cs-view-icon img { filter: none; }
    .cs-view-tip { position: absolute; right: 0; bottom: calc(100% + 6px); z-index: 10; min-width: max-content; max-width: 160px; padding: 5px 7px; border: 1px solid #3a3c40; border-radius: 7px; background: #232427; color: #efeff1; font-size: 12px; font-weight: 800; line-height: 1.2; box-shadow: 0 4px 14px rgba(0,0,0,0.25); opacity: 0; visibility: hidden; transform: translateY(3px); transition: opacity .12s ease, transform .12s ease, visibility .12s ease; pointer-events: none; }
    .cs-view-toggle:hover .cs-view-tip, .cs-view-toggle:focus-visible .cs-view-tip { opacity: 1; visibility: visible; transform: translateY(0); }
    .cs-view-toggle.cs-open { color: #062b20; background: #00c878; border-color: #00c878; }
    .cs-lol-log-toggle { flex: 0 0 auto; min-height: 28px; padding: 0 10px; border: 1px solid #3a3c40; border-radius: 7px; background: #232427; color: #c9cacd; font-size: 12px; font-weight: 800; line-height: 1; cursor: pointer; white-space: nowrap; }
    .cs-lol-log-toggle:hover, .cs-lol-log-toggle:focus-visible, .cs-lol-log-toggle.cs-open { color: #062b20; background: #00c878; border-color: #00c878; }
    .cs-lol-rank-toggle { display: inline-flex; align-items: center; gap: 5px; min-height: 30px; padding: 2px 8px 2px 5px; color: #dfe4ec; background: rgba(35,36,39,0.96); border-color: rgba(96,165,250,0.34); }
    .cs-lol-rank-toggle:hover, .cs-lol-rank-toggle:focus-visible { color: #ffffff; background: #2b2d31; border-color: rgba(96,165,250,0.56); }
    .cs-lol-toggle-emblem { flex: 0 0 auto; display: block; width: 26px; height: 26px; object-fit: contain; filter: drop-shadow(0 2px 5px rgba(0,0,0,0.38)); }
    .cs-lol-toggle-emblem-fallback { width: 24px; height: 24px; border: 1px solid rgba(96,165,250,0.32); border-radius: 6px; background: rgba(96,165,250,0.10); }
    .cs-lol-toggle-division { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 4px; border: 1px solid rgba(250,204,21,0.42); border-radius: 6px; background: rgba(250,204,21,0.10); color: #fde68a; font-size: 10px; font-weight: 950; line-height: 1; }
    .cs-lol-toggle-id { min-width: 0; max-width: 116px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 900; line-height: 1; }
    .cs-lol-rank-badge { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; min-height: 24px; padding: 0 8px; border: 1px solid rgba(96,165,250,0.34); border-radius: 7px; background: rgba(37,99,235,0.13); color: #bfdbfe; font-size: 12px; font-weight: 900; line-height: 1; white-space: nowrap; }
    .cs-lol-rank-badge span { color: #93c5fd; font-size: 11px; }
    .cs-month-label { position: absolute; left: 50%; top: 13px; transform: translateX(-50%); color: #c9cacd; font-size: 18px; line-height: 1; font-weight: 900; white-space: nowrap; pointer-events: none; }

    .cs-lol-summary { display: grid; grid-template-columns: 132px repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }
    .cs-lol-summary-stat, .cs-lol-summary-champs { min-width: 0; border: 1px solid #303238; border-radius: 8px; background: rgba(255,255,255,0.025); padding: 9px 10px; }
    .cs-lol-summary-stat { display: flex; flex-direction: column; gap: 5px; min-height: 76px; }
    .cs-lol-summary-bottom { text-align: left; }
    .cs-lol-summary-bottom > strong { margin-top: auto; }
    .cs-lol-summary-rank-card { grid-row: span 2; min-height: 162px; align-items: center; text-align: center; padding: 10px 8px 12px; }
    .cs-lol-summary-stat span, .cs-lol-summary-champs > span { color: #8f939b; font-size: 11px; font-weight: 900; line-height: 1.2; }
    .cs-lol-summary-stat strong { min-width: 0; color: #efeff1; font-size: 14px; font-weight: 950; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cs-lol-summary-rank { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; width: 100%; }
    .cs-lol-summary-rank-emblem { width: 88px; height: 88px; display: grid; place-items: center; }
    .cs-lol-summary-rank img { width: 88px; height: 88px; object-fit: contain; filter: drop-shadow(0 5px 12px rgba(0,0,0,0.42)); }
    .cs-lol-summary-rank strong { max-width: 100%; font-size: 13px; line-height: 1.25; text-align: center; white-space: normal; }
    .cs-lol-summary-stat small { color: #aeb1b8; font-size: 12px; font-weight: 800; line-height: 1.2; }
    .cs-lol-tier-trend { min-width: 0; flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
    .cs-lol-tier-trend svg { display: block; width: 100%; height: 44px; overflow: visible; }
    .cs-lol-tier-trend polyline { fill: none; stroke: #60a5fa; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; filter: drop-shadow(0 2px 6px rgba(37,99,235,0.34)); }
    .cs-lol-tier-trend small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cs-lol-summary-champs { grid-column: 2 / -1; display: flex; flex-direction: column; gap: 8px; }
    .cs-lol-summary-champs > div { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr)); gap: 8px; }
    .cs-lol-summary-champ { min-width: 0; display: grid; grid-template-columns: 34px minmax(0, 1fr); align-items: center; gap: 8px; min-height: 42px; border-radius: 7px; background: rgba(255,255,255,0.045); padding: 4px 6px; }
    .cs-lol-summary-champ img, .cs-lol-summary-champ > span { width: 34px; height: 34px; border-radius: 7px; object-fit: cover; background: #111216; }
    .cs-lol-summary-champ > span { display: grid; place-items: center; color: #9d9ea3; font-size: 13px; font-weight: 900; }
    .cs-lol-summary-champ div { min-width: 0; display: flex; align-items: baseline; gap: 6px; }
    .cs-lol-summary-champ strong { color: #efeff1; font-size: 13px; font-weight: 950; line-height: 1.2; white-space: nowrap; }
    .cs-lol-summary-champ small { margin-left: auto; color: #aeb1b8; font-size: 12px; font-weight: 800; line-height: 1.2; text-align: right; white-space: nowrap; }
    .cs-lol-summary-muted { color: #9d9ea3; font-size: 12px; font-weight: 800; }
    .cs-lol-log { display: flex; flex-direction: column; gap: 0; max-height: 456px; overflow-y: auto; overscroll-behavior: contain; padding-right: 4px; border: 1px solid #303238; border-radius: 8px; background: rgba(255,255,255,0.025); }
    .cs-lol-log::-webkit-scrollbar { width: 8px; }
    .cs-lol-log::-webkit-scrollbar-thumb { border-radius: 999px; background: rgba(157,158,163,0.38); }
    .cs-lol-log::-webkit-scrollbar-track { background: transparent; }
    .cs-lol-log-day { display: block; min-width: 0; }
    .cs-lol-log-date { position: sticky; top: 0; z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 10px; height: 36px; padding: 0 10px 0 13px; border-bottom: 1px solid #343741; background: #25272d; color: #efeff1; font-size: 13px; font-weight: 900; box-shadow: 0 1px 0 rgba(255,255,255,0.04); }
    .cs-lol-log-date::before { content: ""; position: absolute; left: 0; top: 8px; bottom: 8px; width: 3px; border-radius: 0 999px 999px 0; background: #00c878; }
    .cs-lol-log-date span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cs-lol-log-date small { flex: 0 0 auto; color: #8fffd5; font-size: 11px; font-weight: 900; line-height: 1; }
    .cs-lol-log-day + .cs-lol-log-day .cs-lol-log-date { border-top: 1px solid #343741; }
    .cs-lol-log-row { display: grid; grid-template-columns: 58px 46px minmax(0, 1fr); gap: 10px; align-items: center; height: 84px; min-height: 84px; padding: 9px 10px; }
    .cs-lol-log-row + .cs-lol-log-row { border-top: 1px solid rgba(255,255,255,0.06); }
    .cs-lol-log-time { color: #9d9ea3; font-size: 12px; font-weight: 800; line-height: 1.2; }
    .cs-lol-log-visual { position: relative; width: 44px; height: 44px; }
    .cs-lol-champion-portrait { display: block; width: 44px; height: 44px; border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; background: #111216; object-fit: cover; }
    .cs-lol-champion-fallback { display: grid; place-items: center; color: #9d9ea3; font-size: 14px; font-weight: 900; }
    .cs-lol-position-icon { position: absolute; right: -4px; bottom: -4px; z-index: 1; width: 20px; height: 20px; padding: 2px; border: 1px solid rgba(96,165,250,0.44); border-radius: 6px; background: rgba(15,23,42,0.92); box-shadow: 0 2px 8px rgba(0,0,0,0.28); }
    .cs-lol-log-main { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
    .cs-lol-log-title { min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #efeff1; font-size: 13px; font-weight: 900; line-height: 1.35; }
    .cs-lol-log-title-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cs-lol-result { flex: 0 0 auto; color: #9d9ea3; font-size: 12px; font-weight: 900; }
    .cs-lol-result.cs-win { color: #60a5fa; }
    .cs-lol-result.cs-loss { color: #fb7185; }
    .cs-lol-log-meta { min-width: 0; display: flex; flex-wrap: wrap; gap: 6px; color: #aeb1b8; font-size: 12px; font-weight: 700; line-height: 1.35; }
    .cs-lol-log-meta span { display: inline-flex; align-items: center; min-height: 18px; padding: 0 6px; border-radius: 6px; background: rgba(255,255,255,0.055); }
    .cs-lol-loadout { position: relative; min-width: 0; max-width: 100%; width: max-content; display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 3px 5px; border: 1px solid rgba(255,255,255,0.10); border-radius: 7px; background: rgba(255,255,255,0.045); overflow: visible; box-shadow: inset 0 1px 0 rgba(255,255,255,0.035); }
    .cs-lol-loadout-runes, .cs-lol-loadout-items { min-width: 0; display: inline-flex; align-items: center; gap: 4px; }
    .cs-lol-loadout-runes { flex: 0 0 auto; }
    .cs-lol-loadout-items { flex: 1 1 auto; overflow: visible; }
    .cs-lol-loadout-divider { flex: 0 0 auto; width: 1px; height: 19px; border-radius: 999px; background: rgba(255,255,255,0.14); }
    .cs-lol-loadout-slot { position: relative; flex: 0 0 auto; display: inline-flex; width: 22px; height: 22px; }
    .cs-lol-rune-icon, .cs-lol-item-icon { flex: 0 0 auto; display: block; width: 22px; height: 22px; border: 1px solid rgba(255,255,255,0.12); border-radius: 5px; background: #111216; object-fit: cover; }
    .cs-lol-loadout-tip { position: absolute; left: 50%; bottom: calc(100% + 7px); z-index: 8; width: max-content; max-width: 180px; padding: 5px 7px; border: 1px solid #3a3c40; border-radius: 7px; background: #232427; color: #efeff1; font-size: 12px; font-weight: 800; line-height: 1.2; box-shadow: 0 4px 14px rgba(0,0,0,0.25); opacity: 0; visibility: hidden; transform: translate(-50%, 3px); transition: opacity .12s ease, transform .12s ease, visibility .12s ease; pointer-events: none; white-space: nowrap; }
    .cs-lol-loadout-slot:hover .cs-lol-loadout-tip, .cs-lol-loadout-slot:focus-visible .cs-lol-loadout-tip { opacity: 1; visibility: visible; transform: translate(-50%, 0); }
    .cs-lol-rune-slot { position: relative; display: inline-flex; flex: 0 0 auto; }
    .cs-lol-summary-champ { position: relative; }
    .cs-lol-summary-champ > .cs-lol-champion-tip { display: block; width: max-content; height: auto; background: #232427; }
    .cs-lol-log-visual > .cs-lol-loadout-tip, .cs-lol-rune-slot > .cs-lol-loadout-tip { top: calc(100% + 7px); bottom: auto; left: 0; transform: translateY(-3px); }
    .cs-lol-log-visual:hover > .cs-lol-loadout-tip, .cs-lol-log-visual:focus-visible > .cs-lol-loadout-tip,
    .cs-lol-rune-slot:hover > .cs-lol-loadout-tip, .cs-lol-rune-slot:focus-visible > .cs-lol-loadout-tip { opacity: 1; visibility: visible; transform: translateY(0); }
    .cs-lol-summary-champ:hover > .cs-lol-loadout-tip, .cs-lol-summary-champ:focus-visible > .cs-lol-loadout-tip { opacity: 1; visibility: visible; transform: translate(-50%, 0); }
    .cs-lol-log-visual:focus-visible, .cs-lol-rune-slot:focus-visible, .cs-lol-summary-champ:focus-visible { outline: 2px solid #03a950; outline-offset: 2px; }
    .cs-lol-rune-primary { border-color: rgba(250,204,21,0.58); box-shadow: 0 0 0 1px rgba(250,204,21,0.12); }
    .cs-lol-empty-slot { background: rgba(17,18,22,0.56); border-color: rgba(255,255,255,0.075); }
    .cs-lol-damage { gap: 5px; }
    .cs-lol-damage b { color: #8f939b; font-size: 11px; font-weight: 900; }
    .cs-lol-damage i { position: relative; display: block; width: 42px; height: 5px; border-radius: 999px; overflow: hidden; background: rgba(255,255,255,0.10); }
    .cs-lol-damage em { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: linear-gradient(90deg, #f97316, #facc15); }
    .cs-lol-damage strong { color: #fcd34d; font-size: 12px; font-weight: 900; }
    .cs-lol-kda-stat, .cs-lol-cs-stat, .cs-lol-gold-stat, .cs-lol-share-stat, .cs-lol-kp-stat, .cs-lol-vision-stat, .cs-lol-ward-stat { gap: 4px; }
    .cs-lol-kda-stat b, .cs-lol-cs-stat b, .cs-lol-gold-stat b, .cs-lol-share-stat b, .cs-lol-kp-stat b, .cs-lol-vision-stat b, .cs-lol-ward-stat b { color: #8f939b; font-size: 11px; font-weight: 900; }
    .cs-lol-kda-stat strong { color: #efeff1; font-size: 12px; font-weight: 950; }
    .cs-lol-cs-stat strong { color: #8fffd5; font-size: 12px; font-weight: 950; }
    .cs-lol-gold-stat strong { color: #fde68a; font-size: 12px; font-weight: 950; }
    .cs-lol-share-stat strong { color: #93c5fd; font-size: 12px; font-weight: 950; }
    .cs-lol-kp-stat strong { color: #c4b5fd; font-size: 12px; font-weight: 950; }
    .cs-lol-vision-stat strong { color: #a7f3d0; font-size: 12px; font-weight: 950; }
    .cs-lol-ward-stat strong { color: #f0abfc; font-size: 12px; font-weight: 950; }
    .cs-lol-lp.cs-lp-up { color: #86efac; background: rgba(34,197,94,0.12); }
    .cs-lol-lp.cs-lp-down { color: #fda4af; background: rgba(244,63,94,0.12); }
    .cs-lol-log-empty { display: flex; align-items: center; justify-content: center; min-height: 150px; border: 1px dashed #34363a; border-radius: 8px; color: #9d9ea3; font-size: 13px; font-weight: 800; text-align: center; padding: 18px; }
    @media (max-width: 560px) {
      .cs-lol-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .cs-lol-summary-rank-card { grid-row: span 1; min-height: 150px; }
      .cs-lol-summary-rank-emblem, .cs-lol-summary-rank img { width: 74px; height: 74px; }
      .cs-lol-summary-champs { grid-column: 1 / -1; }
      .cs-lol-summary-champs > div { grid-template-columns: 1fr; }
      .cs-lol-log { max-height: 456px; }
    }

    .cs-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
    .cs-month-grid { grid-template-columns: repeat(7, minmax(0, 1fr)); }
    .cs-month-weekday { color: #6b6d73; font-size: 12px; font-weight: 700; text-align: center; padding: 2px 0 4px; }
    .cs-month-blank { min-height: 88px; border-radius: 8px; background: rgba(255,255,255,0.02); }
    .cs-month-grid .cs-month-cell { min-height: 130px; padding: 9px 8px 35px; text-align: left; }
    .cs-month-grid .cs-month-cell.cs-cell-off { position: relative; gap: 0; padding: 0; overflow: hidden; }
    .cs-month-cell .cs-cell-date { font-size: 12px; font-weight: 700; }
    .cs-month-cell.cs-cell-off .cs-cell-date { position: absolute; left: 0; right: 0; top: 7px; z-index: 2; text-align: center; }
    .cs-month-cell .cs-cell-time { margin-top: 7px; font-size: 12px; }
    .cs-month-cell .cs-cell-title { margin-top: 4px; font-size: 12px; line-height: 1.35; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .cs-month-cell .cs-cell-center-body { text-align: center; }
    .cs-month-cell.cs-cell-off .cs-cell-center-body { position: absolute; inset: 0; display: grid; place-items: end center; }
    .cs-month-cell.cs-cell-off .cs-cell-time { position: absolute; inset: 0; display: block; width: 100%; height: 100%; margin: 0; overflow: hidden; }
    .cs-month-cell.cs-cell-off .cs-cell-time .cs-break-icon { position: absolute; left: 50%; bottom: 0; display: block; width: 100%; height: auto; min-height: 100%; max-width: none; object-fit: cover; object-position: center bottom; transform: translateX(-50%) scale(1.3); transform-origin: bottom center; }
    .cs-month-cell.cs-cell-off .cs-cell-title { top: 24px; }
    .cs-month-cell .cs-cell-part { gap: 4px; margin-top: 4px; }
    .cs-month-cell .cs-part-tag { font-size: 12px; padding: 2px 4px; border-radius: 6px; }
    .cs-month-cell .cs-part-text { font-size: 12px; line-height: 1.35; }
    .cs-game-summary { margin: 10px 0 0; }
    .cs-game-stats { position: relative; z-index: 1; min-width: 0; overflow: hidden; cursor: grab; user-select: none; touch-action: pan-y; }
    .cs-game-stats:not(.swiper-initialized) { overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; scrollbar-color: rgba(0,255,163,0.42) rgba(9,10,12,0.62); }
    .cs-game-stats .swiper-wrapper { position: relative; z-index: 1; display: flex; align-items: stretch; width: 100%; height: 100%; box-sizing: content-box; transform: translate3d(0,0,0); transition-property: transform; transition-timing-function: var(--swiper-wrapper-transition-timing-function, initial); }
    .cs-game-stats .swiper-slide { position: relative; display: block; flex-shrink: 0; width: min(210px, calc(42% - 4px)); min-width: 150px; height: auto; transition-property: transform; }
    .cs-game-stats.swiper-grabbing { cursor: grabbing; }
    .cs-game-stats:not(.swiper-initialized)::-webkit-scrollbar { height: 8px; }
    .cs-game-stats:not(.swiper-initialized)::-webkit-scrollbar-track { border-radius: 999px; background: rgba(255,255,255,0.05); }
    .cs-game-stats:not(.swiper-initialized)::-webkit-scrollbar-thumb { border-radius: 999px; background: rgba(0,255,163,0.34); }
    .cs-game-stat { width: 100%; height: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; min-width: 0; border: 1px solid #34363a; border-radius: 8px; background: #222327; color: #c9cacd; padding: 7px 8px; cursor: pointer; text-align: left; touch-action: manipulation; }
    .cs-game-stat:hover, .cs-game-stat.cs-selected { border-color: #00c878; background: rgba(0,200,120,0.14); color: #efeff1; }
    .cs-game-stat.cs-muted { opacity: 0.48; }
    .cs-game-stat.cs-muted:hover { opacity: 0.78; }
    .cs-game-stat-main { min-width: 0; display: flex; align-items: center; gap: 7px; }
    .cs-game-rank { flex: 0 0 auto; color: #00FFA3; font-size: 12px; font-weight: 800; }
    .cs-game-stat-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 800; }
    .cs-game-stat-count { color: #9d9ea3; font-size: 12px; font-weight: 800; white-space: nowrap; }
    .cs-game-chip-list { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; align-items: center; min-width: 0; }
    .cs-game-chip { min-width: 0; max-width: 100%; display: block; border: 1px solid rgba(0,255,163,0.28); border-radius: 7px; background: rgba(0,255,163,0.11); color: #c9cacd; padding: 4px 6px; font-size: 12px; font-weight: 800; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; }
    .cs-game-chip.cs-selected { color: #062b20; background: #00c878; border-color: #00c878; }
    .cs-game-chip.cs-muted { color: #777a80; background: rgba(127,127,127,0.08); border-color: rgba(127,127,127,0.18); }
    .cs-month-cell .cs-game-chip-list { gap: 3px; margin-top: 5px; flex-direction: column; align-items: stretch; flex-wrap: nowrap; }
    .cs-month-cell .cs-game-chip { flex: 0 0 auto; width: 100%; max-width: 100%; padding: 3px 4px; font-size: 12px; border-radius: 6px; }
    .cs-game-empty { color: #6b6d73; font-size: 13px; font-weight: 700; margin-top: 10px; text-align: center; }
    .cs-cell { position: relative; background: #232427; border: 1px solid transparent;
      border-radius: 8px; padding: 16px; padding-bottom: 35px; text-align: center; min-height: 183px; }
    .cs-cell-center { display: flex; flex-direction: column; gap: 16px; }
    .cs-cell-center .cs-cell-date,
    .cs-cell-center .cs-cell-date-row { flex: 0 0 auto; }
    .cs-cell-center-body { flex: 1 1 auto; display: flex; flex-direction: column;
      justify-content: center; }
    .cs-cell-center-body .cs-cell-time { margin-top: 0; }
    .cs-cell-date { color: #9d9ea3; font-size: 13px; font-weight: 500; }
    .cs-cell-date-row { display: flex; align-items: baseline; justify-content: space-between;
      gap: 4px; overflow: hidden; }
    .cs-cell-date-row .cs-cell-date { flex: 0 0 auto; min-width: 0;
      white-space: nowrap; overflow: hidden; }
    .cs-cell-date-row .cs-cell-time { flex: 1 1 auto; min-width: 0; margin-top: 0;
      white-space: nowrap; overflow: hidden; text-align: right; }
    .cs-cell-time { color: #c9cacd; font-size: 13px; font-weight: 600; margin-top: 5px; }
    .cs-cell-title { color: #c9cacd; font-size: 14px; margin-top: 6px; font-weight: 500;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cs-cell-part { display: flex; align-items: center; gap: 5px; min-width: 0; margin-top: 5px; text-align: left; overflow: hidden; }
    .cs-cell-date-row + .cs-cell-part { margin-top: 14px; }
    .cs-part-memo-icon { flex: 0 0 auto; color: #8b8d92; font-size: 12px; line-height: 1; opacity: 0.88; }
    .cs-part-tag { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 3px; min-width: 0; max-width: 100%;
      color: #00FFA3; background: rgba(0,255,163,0.12);
      font-size: 12px; font-weight: 500; border-radius: 8px; padding: 4px 6px;
      box-sizing: border-box; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cs-part-tag-collab { color: #c4b5fd; background: rgba(167,139,250,0.22); }
    .cs-part-tag-official { color: #93c5fd; background: rgba(59,130,246,0.16); border: 1px solid rgba(147,197,253,0.28); }
    .cs-part-tag-speculative { color: #e8c268; background: rgba(232,194,104,0.14);
      border: 1px solid rgba(232,194,104,0.28); }
    .cs-part-text { flex: 1 1 auto; min-width: 0; color: #c9cacd; font-size: 14px; font-weight: 500;
      line-height: 24px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cs-inline-profile { display: inline-flex; align-items: center; justify-content: center; gap: 0;
      height: 1.5em; color: #c9cacd; font-size: 13px; line-height: 1; min-width: 0;
      vertical-align: middle; }
    .cs-inline-profile .cs-member-avatar { width: 1.7em; height: 1.7em; align-items: center; line-height: 0; }
    .cs-inline-profile .cs-member-avatar-img { width: 1.7em; height: 1.7em; box-sizing: border-box; }
    .cs-text-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px;
      color: #c4b5fd; background: rgba(167,139,250,0.2); border: 1px solid rgba(167,139,250,0.35);
      min-height: 22px; box-sizing: border-box; font-size: 13px; font-weight: 500; line-height: normal; }
    .cs-text-badge .cs-inline-profile { color: inherit; }
    .cs-text-bold { font-weight: 800; }
    .cs-text-underline { text-decoration: underline; text-underline-offset: 2px; }
    .cs-text-strike { text-decoration: line-through; }
    .cs-text-italic { font-style: italic; }
    .cs-inline-feedback-trigger { display: inline-flex; align-items: center; justify-content: center;
      height: 22px; padding: 0 8px; border: 1px solid rgba(0,255,163,0.35); border-radius: 7px;
      background: rgba(0,255,163,0.1); color: #00d98a; font-size: 12px; font-weight: 700;
      line-height: 20px; vertical-align: middle; cursor: pointer; }
    .cs-inline-feedback-trigger:hover { background: rgba(0,255,163,0.18); }
    .cs-inline-media-trigger { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-width: 0;
      min-height: 20px; padding: 1px 7px 1px 6px; border: 1px solid rgba(147,197,253,0.34); border-radius: 999px;
      background: rgba(147,197,253,0.1); color: #bfdbfe; font: inherit; font-size: 12px; font-weight: 700;
      line-height: 18px; vertical-align: middle; text-decoration: none; cursor: pointer; overflow: hidden; }
    .cs-inline-media-trigger::before { content: "✦"; flex: 0 0 auto; color: #93c5fd; font-size: 0.9em; line-height: 1; }
    .cs-inline-media-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cs-inline-media-trigger:hover, .cs-inline-media-trigger.cs-open { border-color: rgba(147,197,253,0.62); background: rgba(147,197,253,0.18); color: #dbeafe; }
    .cs-inline-text-popup-trigger { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-width: 0;
      min-height: 20px; padding: 1px 7px 1px 6px; border: 1px solid rgba(0,255,163,0.34); border-radius: 999px;
      background: rgba(0,255,163,0.1); color: #8fffd5; font: inherit; font-size: 12px; font-weight: 800;
      line-height: 18px; vertical-align: middle; text-decoration: none; cursor: pointer; overflow: hidden; }
    .cs-inline-text-popup-trigger::before { content: "i"; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 13px; height: 13px; border-radius: 50%; background: rgba(0,255,163,0.18); color: #8fffd5; font-size: 9px; font-weight: 900; line-height: 1; }
    .cs-inline-text-popup-trigger:hover, .cs-inline-text-popup-trigger.cs-open { border-color: rgba(0,255,163,0.58); background: rgba(0,255,163,0.18); color: #d7f7ea; }
    .cs-text-popup-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cs-media-popover { position: absolute; z-index: 2147483647; display: none; width: fit-content; max-width: calc(100% - 16px);
      max-height: min(70vh, 460px); margin: 0; padding: 10px; border: 1px solid #3a3c40; border-radius: 10px;
      background: #1b1c1f; box-shadow: 0 12px 34px rgba(0,0,0,0.48); }
    .cs-media-popover.cs-open { display: block; }
    .cs-media-popover.cs-media-expanded { width: min(760px, 100%); max-height: none; }
    .cs-media-popover.cs-install-guide-popover { width: min(634px, calc(100% - 16px)); max-height: min(80vh, 720px); }
    .cs-media-popover.cs-text-popover { width: auto; min-width: 260px; max-width: calc(100% - 16px); max-height: min(72vh, 520px); }
    .cs-media-popover { overflow: auto; box-sizing: border-box; }
    .cs-media-popover .cs-media-body img, .cs-media-popover .cs-media-body video, .cs-media-popover .cs-media-body iframe { max-width: 100%; }
    .cs-media-popover .cs-media-body video, .cs-media-popover .cs-media-body iframe { width: min(720px, 100%); }
    .cs-media-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .cs-media-title { flex: 1 1 auto; min-width: 0; color: #efeff1; font-size: 12px; font-weight: 700;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cs-media-close { flex: 0 0 auto; border: 0; background: none; color: #9d9ea3; font-size: 18px; line-height: 1; cursor: pointer; }
    .cs-media-body { width: fit-content; max-width: 100%; }
    .cs-media-body img, .cs-media-body video, .cs-media-body iframe { display: block; height: auto; max-width: min(720px, calc(100vw - 72px)); max-height: 360px;
      border: 0; border-radius: 8px; background: #0f1012; object-fit: contain; }
    .cs-media-body img { width: auto; }
    .cs-media-body video, .cs-media-body iframe { width: min(720px, calc(100vw - 72px)); }
    .cs-media-body img.cs-media-expandable { cursor: zoom-in; }
    .cs-media-popover.cs-media-expanded .cs-media-body img.cs-media-expandable { max-height: min(75vh, 720px); cursor: zoom-out; }
    .cs-media-viewer { position: fixed; inset: 0; z-index: 2147483647; display: none; padding: 24px;
      background: rgba(0,0,0,0.78); overflow: hidden; cursor: default; touch-action: none; }
    .cs-media-viewer.cs-open { display: block; }
    .cs-media-viewer-canvas { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; overflow: hidden; }
    .cs-media-viewer img { flex: 0 0 auto; display: block; width: auto; height: auto; max-width: none; max-height: none;
      object-fit: contain; margin: auto; border-radius: 8px; background: #0f1012; box-shadow: 0 18px 48px rgba(0,0,0,0.5); cursor: grab; user-select: none; -webkit-user-drag: none; will-change: transform; }
    .cs-media-viewer img.cs-dragging { cursor: grabbing; }
    .cs-media-viewer-close { position: absolute; top: max(12px, env(safe-area-inset-top)); right: max(12px, env(safe-area-inset-right)); z-index: 2; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border: 1px solid rgba(255,255,255,0.24); border-radius: 50%; background: rgba(15,16,18,0.82); color: #efeff1; font-size: 24px; line-height: 1; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,0.36); }
    .cs-media-viewer-close:hover { background: rgba(43,45,49,0.94); border-color: rgba(255,255,255,0.4); }
    .cs-media-body iframe { aspect-ratio: 16 / 9; height: auto; }
    .cs-media-link { color: #93c5fd; font-size: 12px; overflow-wrap: anywhere; }
    .cs-text-popup-content { width: auto; min-width: 220px; max-width: 100%; max-height: calc(min(72vh, 520px) - 52px); overflow: auto; color: #d7d9de; font-size: 13px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
    .cs-media-popover.cs-update-text-popover .cs-text-popup-content { scrollbar-width: thin; scrollbar-color: rgba(0,255,163,0.68) rgba(15,16,18,0.82); }
    .cs-media-popover.cs-update-text-popover .cs-text-popup-content::-webkit-scrollbar { width: 10px; height: 10px; }
    .cs-media-popover.cs-update-text-popover .cs-text-popup-content::-webkit-scrollbar-track { border-radius: 999px; background: linear-gradient(180deg, rgba(9,10,12,0.82), rgba(24,28,32,0.92)); }
    .cs-media-popover.cs-update-text-popover .cs-text-popup-content::-webkit-scrollbar-thumb { border: 2px solid rgba(15,16,18,0.96); border-radius: 999px; background: linear-gradient(180deg, rgba(0,255,163,0.76), rgba(64,128,255,0.5)); box-shadow: 0 0 10px rgba(0,255,163,0.16); }
    .cs-media-popover.cs-update-text-popover .cs-text-popup-content::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, rgba(0,255,163,0.92), rgba(64,128,255,0.66)); }
    .cs-text-popup-content .cs-text-badge { vertical-align: baseline; }
    .cs-install-guide-trigger { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; min-width: 0;
      min-height: 20px; padding: 1px 7px 1px 6px; border: 1px solid rgba(0,255,163,0.34); border-radius: 999px;
      background: rgba(0,255,163,0.1); color: #8fffd5; font: inherit; font-size: 12px; font-weight: 800;
      line-height: 18px; vertical-align: middle; text-decoration: none; cursor: pointer; overflow: hidden; }
    .cs-install-guide-trigger::before { content: "↗"; flex: 0 0 auto; color: #00ffa3; font-size: 0.92em; line-height: 1; }
    .cs-install-guide-trigger:hover, .cs-install-guide-trigger.cs-open { border-color: rgba(0,255,163,0.58); background: rgba(0,255,163,0.18); color: #d7f7ea; }
    .cs-install-guide-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cs-install-notice { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; white-space: normal; overflow: visible; text-overflow: clip; }
    .cs-install-notice-text { min-width: 0; }
    .cs-install-guide { display: grid; gap: 10px; width: fit-content; max-width: 100%; max-height: min(62vh, 620px); overflow-y: auto; color: #d7d9de; font-size: 12px; line-height: 1.5; }
    .cs-install-guide-popover .cs-install-guide { width: 100%; max-height: calc(min(80vh, 720px) - 48px); }
    .cs-install-guide { scrollbar-width: thin; scrollbar-color: rgba(0,255,163,0.58) rgba(15,16,18,0.7); }
    .cs-install-guide::-webkit-scrollbar { width: 9px; }
    .cs-install-guide::-webkit-scrollbar-track { border-radius: 999px; background: rgba(15,16,18,0.7); }
    .cs-install-guide::-webkit-scrollbar-thumb { border: 2px solid rgba(15,16,18,0.92); border-radius: 999px; background: linear-gradient(180deg, rgba(0,255,163,0.72), rgba(0,200,120,0.46)); }
    .cs-install-guide::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, rgba(0,255,163,0.9), rgba(0,200,120,0.64)); }
    .cs-install-guide-section { display: grid; gap: 6px; width: fit-content; max-width: 100%; padding: 9px; border: 1px solid rgba(157,158,163,0.2); border-radius: 8px; background: rgba(255,255,255,0.035); }
    .cs-install-guide-section h4 { margin: 0; color: #8fffd5; font-size: 12px; line-height: 1.2; }
    .cs-install-guide-section p { margin: 0; color: #b7bac1; font-size: 12px; line-height: 1.5; }
    .cs-install-guide-link { color: #93c5fd; font-weight: 700; text-decoration: none; overflow-wrap: anywhere; }
    .cs-install-guide-link:hover { text-decoration: underline; }
    .cs-install-guide-section img { width: auto; max-width: min(720px, calc(100vw - 92px)); max-height: 300px; object-fit: contain; cursor: zoom-in; }

    .cs-cell-today { background: rgba(0,255,163,0.08); border-color: rgba(0,255,163,0.45); }
    .cs-cell-today .cs-cell-date,
    .cs-cell-today .cs-cell-time { color: #00FFA3; }
    .cs-cell-today .cs-cell-title,
    .cs-cell-today .cs-part-text { color: #efeff1; }

    .cs-cell-hoverable { cursor: pointer; }
    .cs-cell-hoverable:hover { background: #2b2d31; border-color: #4a4c52; }
    .cs-cell-today.cs-cell-hoverable:hover { background: rgba(0,255,163,0.14); }

    /* 지난 일정 + 휴방: 미정과 동일한 스타일로 표시 (배경은 기본 칸 배경, 텍스트는 미정과 같은 톤) */
    .cs-cell-muted .cs-cell-time,
    .cs-cell-muted .cs-cell-title,
    .cs-cell-muted .cs-part-text { color: #6b6d73; }
    .cs-cell-muted .cs-part-tag { color: #7c7d82; background: rgba(124,125,130,0.12); }

    .cs-cell-unknown .cs-cell-title { color: #6b6d73; }

    .cs-memo-dot { position: absolute; top: 6px; right: 6px; width: 5px; height: 5px;
      border-radius: 50%; background: #00FFA3; }
    .cs-time-indicators { position: absolute; right: 8px; bottom: 8px; z-index: 2; display: flex; align-items: center; gap: 5px; }
    .cs-cafe-time-indicator, .cs-video-time-indicator { position: relative; display: inline-flex; align-items: center; justify-content: center; }
    .cs-cafe-time-icon, .cs-video-time-icon { display: block; width: 22px; height: 22px; object-fit: contain; }
    .cs-cafe-time-past .cs-cafe-time-icon, .cs-video-time-past .cs-video-time-icon { filter: grayscale(1); opacity: 0.45; }
    .cs-cafe-time-tip, .cs-video-time-tip { position: absolute; right: 0; bottom: calc(100% + 6px);
      padding: 4px 8px; border: 1px solid #3a3c40; border-radius: 6px;
      background: #1b1c1f; color: #efeff1; font-size: 12px; font-weight: 500;
      line-height: 1.4; white-space: nowrap; opacity: 0; visibility: hidden;
      pointer-events: none; transform: translateY(2px); transition: opacity 0.12s, transform 0.12s; }
    .cs-cafe-time-indicator:hover .cs-cafe-time-tip, .cs-video-time-indicator:hover .cs-video-time-tip { opacity: 1; visibility: visible; transform: translateY(0); }

    .cs-footer { display: flex; align-items: center; justify-content: space-between;
      gap: 6px; padding: 9px 14px; border-top: 1px solid #2e3033; flex-wrap: wrap;
      background: rgba(15,16,18,0.45); }
    .cs-footer:last-child { border-radius: 0 0 10px 10px; }
    .cs-notice { display: flex; flex-direction: column; }
    .cs-schedule-notice { flex: 1 1 auto; min-width: 0; margin-right: 12px; color: #6b6d73;
      font-size: 12px; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cs-schedule-notice + .cs-schedule-notice { margin-top: 5px; }
    .cs-update-history-section { padding: 10px 14px 13px; border-top: 1px solid #2e3033; border-radius: 0 0 10px 10px; background: #17181b; }
    .cs-update-history-section.cs-update-history-collapsed { padding-bottom: 10px; }
    .cs-update-history-head { display: flex; align-items: center; gap: 8px; margin-bottom: 9px; }
    .cs-update-history-section.cs-update-history-collapsed .cs-update-history-head { margin-bottom: 0; }
    .cs-update-history-title { flex: 1 1 auto; min-width: 0; color: #efeff1; font-size: 12px; font-weight: 900; line-height: 1.2; }
    .cs-update-history-controls { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; }
    .cs-update-history-toggle { flex: 0 0 auto; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; padding: 0; border: 1px solid rgba(143,255,213,0.24); border-radius: 6px; background: rgba(255,255,255,0.05); color: #8fffd5; cursor: pointer; }
    .cs-update-history-toggle:hover { background: rgba(0,255,163,0.1); color: #ffffff; }
    .cs-update-history-caret { font-size: 12px; font-weight: 900; line-height: 1; }
    .cs-update-history-arrow { width: 24px; height: 24px; border: 1px solid rgba(143,255,213,0.24); border-radius: 6px; background: rgba(255,255,255,0.05); color: #d7f7ea; font-size: 16px; font-weight: 900; line-height: 1; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .cs-update-history-arrow:hover { background: rgba(0,255,163,0.1); color: #ffffff; }
    .cs-update-history-viewport { min-width: 0; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scroll-snap-type: x proximity; scrollbar-width: none; }
    .cs-update-history-viewport::-webkit-scrollbar { display: none; }
    .cs-update-history-track { display: flex; align-items: stretch; gap: 8px; min-width: max-content; padding: 0 2px 4px 0; }
    .cs-update-history-card.cs-inline-text-popup-trigger { flex: 0 0 auto; width: 142px; min-height: 42px; padding: 8px 10px; border-radius: 8px; scroll-snap-align: start; justify-content: flex-start; white-space: normal; text-align: left; line-height: 1.25; }
    .cs-update-history-card .cs-text-popup-label { display: -webkit-box; white-space: normal; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; text-overflow: ellipsis; }
    .cs-footer-meta-frame { flex: 0 0 auto; align-self: flex-end; display: inline-flex; align-items: center; gap: 8px; }
    .cs-updated { flex-shrink: 0; color: #6b6d73; font-size: 12px; }
    .cs-refresh { background: none; border: none; cursor: pointer; color: #6b6d73;
      font-size: 16px; line-height: 1; padding: 2px; }
    .cs-refresh:hover { color: #9d9ea3; }
    .cs-feedback-open { flex: 0 0 auto; border: 1px solid #3a3c40; border-radius: 7px;
      background: #232427; color: #c9cacd; padding: 5px 9px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .cs-feedback-open:hover, .cs-feedback-open.cs-open { color: #efeff1; background: #2b2d31; }
    .cs-feedback-panel { position: absolute; right: 14px; bottom: 48px; z-index: 2147483646;
      width: 330px; padding: 14px; border: 1px solid #3a3c40; border-radius: 10px;
      background: #1b1c1f; box-shadow: 0 10px 30px rgba(0,0,0,0.48); display: none; }
    .cs-feedback-panel.cs-open { display: block; }
    .cs-feedback-head { display: flex; align-items: center; margin-bottom: 12px; }
    .cs-feedback-title { color: #efeff1; font-size: 15px; font-weight: 700; }
    .cs-feedback-close { margin-left: auto; border: 0; background: none; color: #9d9ea3;
      font-size: 20px; line-height: 1; cursor: pointer; }
    .cs-feedback-label { display: block; margin: 9px 0 5px; color: #9d9ea3; font-size: 12px; font-weight: 600; }
    .cs-feedback-input, .cs-feedback-select, .cs-feedback-textarea { display: block; width: 100%;
      border: 1px solid #3a3c40; border-radius: 7px; outline: none; background: #232427;
      color: #efeff1; padding: 8px 9px; font-size: 12px; line-height: 1.4; }
    .cs-feedback-textarea { min-height: 90px; resize: vertical; }
    .cs-feedback-field-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin: 9px 0 5px; }
    .cs-feedback-field-head .cs-feedback-label { margin: 0; }
    .cs-feedback-limit { flex: 0 0 auto; color: #9d9ea3; font-size: 12px; font-weight: 600; }
    .cs-feedback-count { margin-top: 4px; color: #9d9ea3; font-size: 12px; text-align: right; }
    .cs-feedback-count.cs-near-limit { color: #e8c268; }
    .cs-feedback-input:focus, .cs-feedback-select:focus, .cs-feedback-textarea:focus { border-color: #00c878; }
    .cs-feedback-notice { margin: -1px 0 6px; color: #ff7b7b; font-size: 12px; line-height: 1.45; }
    .cs-feedback-contact-toggle { display: inline-flex; align-items: center; justify-content: center; width: 100%; margin-top: 10px; border: 1px solid rgba(0,255,163,0.28); border-radius: 7px; background: rgba(0,255,163,0.08); color: #8fffd5; padding: 7px 9px; font-size: 12px; font-weight: 700; cursor: pointer; }
    .cs-feedback-contact-toggle:hover, .cs-feedback-contact-toggle.cs-open { background: rgba(0,255,163,0.14); color: #d7f7ea; }
    .cs-feedback-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
    .cs-feedback-status { flex: 1 1 auto; min-width: 0; color: #9d9ea3; font-size: 12px; line-height: 1.35; }
    .cs-feedback-status.cs-error { color: #ff7b7b; }
    .cs-feedback-status.cs-success { color: #00c878; }
    .cs-feedback-submit { flex: 0 0 auto; border: 0; border-radius: 7px; padding: 7px 12px;
      background: #00c878; color: #062b20; font-size: 12px; font-weight: 700; cursor: pointer; }
    .cs-feedback-submit:disabled { background: #4a4c52; color: #8b8d92; cursor: not-allowed; }

    .cs-popover { position: absolute; width: max-content; min-width: 250px; max-width: none; background: #26272b;
      border: 1px solid #3a3c40; border-radius: 10px; padding: 12px 14px;
      z-index: 2147483646; display: none; }
    .cs-popover.cs-open { display: block; }
    .cs-pop-arrow { position: absolute; top: -5px; width: 10px; height: 10px;
      background: #26272b; border-left: 1px solid #3a3c40; border-top: 1px solid #3a3c40;
      transform: rotate(45deg); }
    .cs-pop-date-row { display: flex; align-items: center; justify-content: space-between;
      gap: 8px; margin-bottom: 6px; white-space: nowrap; }
    .cs-pop-date { color: #efeff1; font-size: 12px; font-weight: 600; white-space: nowrap; }
    .cs-pop-title { min-width: 0; margin: 0 0 8px; padding: 7px 9px; border-left: 3px solid #00FFA3; border-radius: 7px; background: rgba(0,255,163,0.1); color: #f4fff9; font-size: 15px; font-weight: 800; line-height: 1.35; white-space: normal; overflow-wrap: anywhere; }
    .cs-pop-row { display: flex; align-items: center; flex-wrap: nowrap; gap: 6px; min-height: 24px; margin-bottom: 4px; }
    .cs-pop-row:last-child { margin-bottom: 0; }
    .cs-pop-icon { display: inline-flex; align-items: center; gap: 3px;
      color: #9d9ea3; font-size: 12px; line-height: 1.5; }
    .cs-pop-icon-collab { color: #c4b5fd; }
    .cs-pop-icon-official { color: #93c5fd; }
    .cs-pop-icon-speculative { color: #e8c268; }
    .cs-pop-part-label { flex: 0 0 auto; min-width: 30px; justify-content: center; padding: 3px 7px; border-radius: 999px; font-weight: 800; line-height: 1.1; color: #7dffcf; background: rgba(0,255,163,0.12); }
    .cs-pop-part-text { font-weight: 800; color: #F2F3F5; }
    .cs-pop-text { color: #c9cacd; font-size: 14px; line-height: 1.5;
      white-space: pre; overflow-wrap: normal; word-break: normal; }
    .cs-pop-part-text .cs-info-mention, .cs-pop-part-text .cs-inline-profile, .cs-pop-part-text .cs-text-badge { color: inherit; }
    .cs-tag-tone, .cs-part-tag.cs-tag-tone, .cs-text-badge.cs-tag-tone { color: var(--cs-tag-color); background: var(--cs-tag-bg); border-color: var(--cs-tag-border); }
    .cs-cell-muted .cs-part-tag.cs-tag-tone { color: #7c7d82; background: rgba(124,125,130,0.12); border-color: transparent; }
    .cs-pop-text.cs-pop-part-text { color: #F2F3F5; }
    .cs-pop-note-box { display: flex; align-items: flex-start; gap: 7px; margin-top: 10px;
      padding: 8px 10px; background: #1f2023; border: 1px solid #3a3c40; border-radius: 8px; }
    .cs-pop-note-box.cs-pop-main-note { position: relative; display: block; margin-top: 12px; padding: 10px 12px 10px 14px; background: rgba(0,255,163,0.06); border-color: rgba(0,255,163,0.24); border-left: 3px solid #00FFA3; }
    .cs-pop-note-head { display: flex; align-items: center; gap: 5px; margin-bottom: 6px; color: #7dffcf; font-size: 11px; font-weight: 900; letter-spacing: 0; }
    .cs-pop-note-list { min-width: max-content; display: flex; flex-direction: column; gap: 6px; }
    .cs-pop-note-text { color: #c9cacd; font-size: 14px; line-height: 1.65;
      white-space: pre; overflow-wrap: normal; word-break: normal; display: flex; align-items: center; }

    .cs-pop-note-box .cs-pop-note-list { min-width: 0; }
    .cs-pop-note-box .cs-pop-note-text { white-space: pre-wrap; overflow-wrap: anywhere; word-break: keep-all; }
    .cs-pop-parts-box { margin-top: 8px; display: flex; flex-direction: column; gap: 7px; }
    .cs-pop-part { min-width: 0; padding: 8px; border: 1px solid rgba(157,158,163,0.18); border-radius: 7px; background: rgba(0,0,0,0.18); }
    .cs-pop-part .cs-pop-row { margin-bottom: 0; }
    .cs-pop-part-main { align-items: center; }
    .cs-pop-members-row { display: flex; align-items: center; gap: 7px; margin: 6px 0 0; min-width: 0; }
    .cs-pop-members-label { flex: 0 0 auto; color: #9d9ea3; font-size: 11px; font-weight: 700; line-height: 1; }
    .cs-pop-members-chip { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 999px; background: rgba(157,158,163,0.14); color: #c9cacd; font-size: 11px; font-weight: 800; line-height: 1; }
    .cs-pop-part-notes { margin: 7px 0 0; padding-top: 7px; border-top: 1px solid rgba(0,255,163,0.16); }
    .cs-pop-members { display: flex; flex-wrap: nowrap; justify-content: flex-start; gap: 6px; margin: 0; }
    .cs-member-avatar { position: relative; flex: 0 0 auto; display: inline-flex; align-items: center;
      justify-content: center; width: 22px; height: 22px; vertical-align: middle; line-height: 0;
      text-decoration: none; cursor: default; box-sizing: border-box; }
    a.cs-member-avatar { cursor: pointer; }
    .cs-member-avatar-img { display: block; width: 22px; height: 22px; border-radius: 50%;
      overflow: hidden; border: 1px solid #3a3c40; }
    .cs-member-avatar-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .cs-member-avatar-fallback { display: flex; align-items: center; justify-content: center;
      background: #3a3c40; color: #efeff1; font-size: 12px; font-weight: 700; }
    .cs-member-tip { position: absolute; bottom: calc(100% + 6px); left: 0;
      background: #1b1c1f; border: 1px solid #3a3c40;
      color: #efeff1; font-size: 12px; line-height: 1.35; padding: 6px 10px; border-radius: 7px;
      white-space: nowrap; opacity: 0; pointer-events: none; transition: opacity 0.12s; }
    .cs-member-avatar:hover .cs-member-tip { opacity: 1; }

    .cs-vod-buttons { display: flex; flex-wrap: wrap; gap: 5px; flex: 0 0 auto; }
    .cs-vod-btn { position: relative; display: inline-flex; align-items: center; justify-content: center;
      width: 20px; height: 20px; flex: 0 0 auto; border-radius: 50%;
      background: rgba(0,255,163,0.12); color: #00FFA3; font-size: 9px;
      text-decoration: none; cursor: pointer; }
    .cs-vod-btn:hover { background: rgba(0,255,163,0.22); }
    .cs-vod-btn .cs-member-tip { left: auto; right: 0; transform: none; }
    .cs-vod-btn:hover .cs-member-tip { opacity: 1; }
    .cs-vod-btn-disabled { background: rgba(157,158,163,0.12); color: #6b6d73; cursor: default; }
    .cs-vod-btn-disabled:hover { background: rgba(157,158,163,0.12); }

    .cs-info-frame { min-width: 0; height: 100%; padding: 12px 13px; border: 1px solid rgba(157,158,163,0.18); border-radius: 8px; background: rgba(255,255,255,0.025); }
    .cs-info-title { color: #efeff1; font-size: 13px; line-height: 1.2; font-weight: 800; margin-bottom: 8px; }
    .cs-info-list { list-style: none; display: flex; flex-direction: column; gap: 0; border-top: 1px solid rgba(255,255,255,0.06); }
    .cs-info-subhead { display: flex; align-items: center; gap: 10px; padding: 14px 0 7px; color: #f2fff9; font-size: 12px; font-weight: 900; line-height: 1.2; }
    .cs-info-subhead:first-child { padding-top: 10px; }
    .cs-info-subhead::after { content: ""; flex: 1 1 auto; height: 1px; background: linear-gradient(90deg, rgba(0,255,163,0.42), rgba(255,255,255,0.05)); }
    .cs-info-subhead-label { flex: 0 1 auto; min-width: 0; overflow-wrap: anywhere; }
    .cs-info-group { padding-top: 13px; }
    .cs-info-group:first-child { padding-top: 10px; }
    .cs-info-group-title { display: flex; align-items: center; gap: 10px; color: #ffffff; font-size: 16px; font-weight: 950; line-height: 1.25; }
    .cs-info-group-title::before { content: ""; width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: #00FFA3; box-shadow: 0 0 0 3px rgba(0,255,163,0.12); }
    .cs-info-group-title::after { content: ""; flex: 1 1 auto; height: 1px; background: linear-gradient(90deg, rgba(0,255,163,0.42), rgba(255,255,255,0.05)); }
    .cs-info-detail { padding: 9px 0; }
    .cs-info-detail:not(:last-child) { border-bottom: 1px solid rgba(255,255,255,0.06); }
    .cs-info-detail-head { display: flex; align-items: center; gap: 7px; min-width: 0; }
    .cs-info-detail-head[data-info-toggle] { margin: -5px -6px; padding: 5px 6px; border-radius: 6px; cursor: pointer; transition: background 0.14s ease, color 0.14s ease; }
    .cs-info-detail-head[data-info-toggle]:hover { background: rgba(0,255,163,0.07); }
    .cs-info-detail-head[data-info-toggle]:hover .cs-info-detail-title { color: #ffffff; }
    .cs-info-detail-title { flex: 1 1 auto; min-width: 0; color: #efeff1; font-size: 13px; font-weight: 400; line-height: 1.95; white-space: pre-line; overflow-wrap: anywhere; }
    .cs-info-detail-toggle { flex: 0 0 auto; width: 24px; height: 24px; border: 1px solid rgba(143,255,213,0.22); border-radius: 6px; background: rgba(255,255,255,0.04); color: #d7f7ea; font-size: 13px; font-weight: 900; line-height: 1; cursor: pointer; }
    .cs-info-detail-toggle:hover { background: rgba(0,255,163,0.1); color: #ffffff; }
    .cs-info-detail-body { display: block; padding: 8px 0 0 13px; color: #c9cacd; font-size: 13px; line-height: 1.55; white-space: pre-line; overflow-wrap: anywhere; }
    .cs-info-detail-body[hidden] { display: none; }
    .cs-info-item { position: relative; display: block; padding: 10px 0 10px 13px; border-bottom: 1px solid rgba(255,255,255,0.06); color: #c9cacd; font-size: 13px; line-height: 1.55; }
    .cs-info-item::before { content: ""; position: absolute; left: 0; top: 16px; bottom: 12px; width: 2px; border-radius: 2px; background: rgba(0,255,163,0.55); }
    .cs-info-dot { display: none; }
    .cs-info-text { display: block; white-space: pre-line; overflow-wrap: anywhere; }
    .cs-info-empty { padding: 10px 0; color: #8b8d92; font-size: 13px; line-height: 1.55; }
    .cs-info-new-frame { display: flex; align-items: center; justify-content: center; width: 102px; height: 40px; padding: 3px 5px; border-radius: 7px; overflow: hidden; cursor: pointer; transition: background 160ms ease; }
    .cs-info-new-frame:hover, .cs-info-new-frame:focus-visible { background: rgba(0,255,163,0.07); outline: none; }
    .cs-info-new-icon { display: block; width: 92px; height: 32px; object-fit: contain; pointer-events: none; transition: transform 160ms ease; }
    .cs-info-new-frame:hover .cs-info-new-icon, .cs-info-new-frame:focus-visible .cs-info-new-icon { transform: scale(1.06); }
    .cs-gnimti-popup { position: fixed; inset: 0; z-index: 2147483647; display: none; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,0.72); overflow: hidden; overscroll-behavior: contain; }
    .cs-gnimti-popup.cs-open { display: flex; }
    .cs-gnimti-dialog { position: relative; display: flex; flex-direction: column; width: min(100%, calc(100vw - 48px)); max-height: calc(100vh - 48px); border: 1px solid rgba(157,158,163,0.26); border-radius: 10px; background: #101113; box-shadow: 0 18px 48px rgba(0,0,0,0.5); overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: rgba(0,255,163,0.52) rgba(9,10,12,0.62); }
    .cs-gnimti-close { position: absolute; top: 10px; right: 10px; z-index: 2; width: 30px; height: 30px; border: 1px solid rgba(255,255,255,0.18); border-radius: 999px; background: rgba(0,0,0,0.55); color: #efeff1; font-size: 20px; line-height: 1; cursor: pointer; }
    .cs-gnimti-close:hover { background: rgba(0,0,0,0.72); }
    .cs-gnimti-visual { position: relative; width: 100%; min-height: 150px; overflow: hidden; }
    .cs-gnimti-visual::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 72%; z-index: 0; pointer-events: none; background: linear-gradient(0deg, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.5) 42%, rgba(0,0,0,0) 100%); }
    .cs-gnimti-image { display: block; width: 100%; height: 150px; max-height: 150px; object-fit: cover; }
    .cs-gnimti-logo { position: absolute; left: 50%; top: 50%; z-index: 1; transform: translate(-50%, -50%); width: min(38%, 260px); object-fit: contain; pointer-events: none; filter: drop-shadow(0 6px 16px rgba(0,0,0,0.52)); }
    .cs-gnimti-button-image { position: absolute; right: -10px; bottom: 14px; width: min(30%, 180px); height: auto; display: block; }
    .cs-gnimti-tabs { position: absolute; left: 14px; bottom: 10px; z-index: 2; display: flex; flex-direction: column; align-items: flex-start; gap: 5px; max-width: calc(100% - 48px); }
    .cs-gnimti-tab-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .cs-gnimti-tab { display: inline-flex; align-items: center; justify-content: center; min-height: 28px; padding: 0 10px; border: 1px solid rgba(255,255,255,0.16); border-radius: 999px; background: rgba(8,9,12,0.72); color: #c9cacd; font-size: 12px; font-weight: 800; line-height: 1; cursor: pointer; backdrop-filter: blur(4px); transition: background 140ms ease, border-color 140ms ease, color 140ms ease, transform 140ms ease; }
    .cs-gnimti-tab:hover { transform: translateY(-1px); border-color: rgba(0,255,163,0.34); color: #efeff1; }
    .cs-gnimti-tab.cs-active { border-color: rgba(0,255,163,0.56); background: rgba(0,255,163,0.16); color: #bfffe7; }
    .cs-gnimti-placeholder { grid-column: 1 / -1; display: flex; align-items: center; justify-content: center; width: 100%; min-height: min(520px, calc(100vh - 230px)); border: 1px solid rgba(157,158,163,0.18); border-radius: 8px; background: rgba(255,255,255,0.035); color: #9d9ea3; font-size: 13px; font-weight: 800; }
    .cs-gnimti-tierlist, .cs-gnimti-roster-board { grid-column: 1 / -1; min-width: 0; max-height: calc(100vh - 210px); border: 1px solid rgba(157,158,163,0.18); border-radius: 8px; background: rgba(0,0,0,0.24); overflow: auto; overscroll-behavior: contain; padding: 10px; scrollbar-width: thin; scrollbar-color: rgba(0,255,163,0.52) rgba(9,10,12,0.62); }
    .cs-gnimti-tierlist img, .cs-gnimti-roster-board img { display: block; width: auto; max-height: 600px; border-radius: 6px; object-fit: contain; margin: 0 auto; }
    .cs-gnimti-roster-board { display: flex; flex-direction: column; gap: 12px; }
    .cs-gnimti-roster-board img { display: block; width: 100%; height: auto; max-height: 600px; }
    .cs-gnimti-tierlist::-webkit-scrollbar, .cs-gnimti-roster-board::-webkit-scrollbar { width: 10px; height: 10px; }
    .cs-gnimti-tierlist::-webkit-scrollbar-track, .cs-gnimti-roster-board::-webkit-scrollbar-track { background: linear-gradient(180deg, rgba(9,10,12,0.8), rgba(20,22,26,0.86)); border-left: 1px solid rgba(255,255,255,0.05); }
    .cs-gnimti-tierlist::-webkit-scrollbar-thumb, .cs-gnimti-roster-board::-webkit-scrollbar-thumb { background: linear-gradient(180deg, rgba(0,255,163,0.62), rgba(82,118,255,0.44)); border: 2px solid rgba(13,14,17,0.96); border-radius: 999px; box-shadow: 0 0 10px rgba(0,255,163,0.16); }
    .cs-gnimti-tierlist::-webkit-scrollbar-thumb:hover, .cs-gnimti-roster-board::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, rgba(0,255,163,0.78), rgba(82,118,255,0.58)); }
    .cs-gnimti-content { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 0.5fr); gap: 14px; padding: 16px; min-height: 0; overflow: visible; }
    .cs-gnimti-dialog::-webkit-scrollbar { width: 10px; height: 10px; }
    .cs-gnimti-dialog::-webkit-scrollbar-track { background: linear-gradient(180deg, rgba(9,10,12,0.8), rgba(20,22,26,0.86)); border-left: 1px solid rgba(255,255,255,0.05); }
    .cs-gnimti-dialog::-webkit-scrollbar-thumb { background: linear-gradient(180deg, rgba(0,255,163,0.62), rgba(82,118,255,0.44)); border: 2px solid rgba(13,14,17,0.96); border-radius: 999px; box-shadow: 0 0 10px rgba(0,255,163,0.16); }
    .cs-gnimti-dialog::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, rgba(0,255,163,0.78), rgba(82,118,255,0.58)); }
    .cs-gnimti-roster { min-width: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; overflow: visible; padding-right: 2px; }
    .cs-gnimti-column { min-width: 0; border: 1px solid rgba(157,158,163,0.18); border-radius: 8px; background: rgba(255,255,255,0.035); overflow: hidden; }
    .cs-gnimti-position { padding: 9px 8px; border-bottom: 1px solid rgba(255,255,255,0.07); color: #efeff1; font-size: 12px; font-weight: 800; line-height: 1.2; text-align: center; }
    .cs-gnimti-members { display: flex; flex-direction: column; gap: 0; padding: 5px; }
    .cs-gnimti-member { position: relative; z-index: 0; display: flex; align-items: center; gap: 7px; width: 100%; min-width: 0; padding: 7px 5px; border: 0; border-radius: 7px; background: transparent; text-decoration: none; cursor: pointer; text-align: left; }
    .cs-gnimti-member:hover, .cs-gnimti-member.cs-selected { background: rgba(255,255,255,0.06); }
    .cs-gnimti-member:hover { z-index: 1; }
    .cs-gnimti-member.cs-selected { z-index: 2; box-shadow: inset 0 0 0 1px rgba(0,255,163,0.34); }
    .cs-gnimti-avatar { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.12); background: #2b2d31; color: #c9cacd; font-size: 12px; font-weight: 800; overflow: hidden; }
    .cs-gnimti-avatar .cs-member-avatar-img, .cs-gnimti-avatar .cs-member-avatar-img img { width: 100%; height: 100%; border: 0; border-radius: 50%; }
    .cs-gnimti-name { flex: 1 1 auto; min-width: 0; color: #c9cacd; font-size: 12px; font-weight: 600; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cs-gnimti-member-tier-bg { position: relative; isolation: isolate; overflow: hidden; background-image: linear-gradient(90deg, rgba(16,17,19,0.86) 0%, rgba(16,17,19,0.54) 58%, rgba(16,17,19,0.16) 100%), var(--gnimti-tier-bg); background-size: auto 136%, cover; background-position: right 70%; background-repeat: no-repeat; }
    .cs-gnimti-member-tier-bg:hover, .cs-gnimti-member-tier-bg.cs-selected { background-image: linear-gradient(90deg, rgba(22,24,28,0.78) 0%, rgba(22,24,28,0.46) 55%, rgba(22,24,28,0.08) 100%), var(--gnimti-tier-bg); background-size: auto 136%, cover; background-position: right 70%; background-repeat: no-repeat; }
    .cs-gnimti-detail { align-self: flex-start; min-width: 0; display: flex; flex-direction: column; gap: 10px; border: 1px solid rgba(157,158,163,0.18); border-radius: 8px; background: rgba(255,255,255,0.035); padding: 12px; overflow: hidden; }
    .cs-gnimti-detail-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .cs-gnimti-detail-title { flex: 1 1 auto; min-width: 0; color: #efeff1; font-size: 15px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cs-gnimti-images { flex: 1 1 auto; min-height: 0; display: flex; }
    .cs-gnimti-card { min-width: 0; min-height: 0; width: 100%; display: flex; gap: 30px; align-items: center; border-radius: 8px; background: rgba(0,0,0,0.24); overflow: hidden; padding: 24px 10%; }
    .cs-gnimti-stat-item { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
    .cs-gnimti-stat-label { display: flex; align-items: center; justify-content: center; min-height: 24px; border-radius: 999px; background: rgba(0,255,163,0.11); color: #bfffe7; font-size: 12px; font-weight: 800; padding: 5px 10px; }
    .cs-gnimti-stat-label-team { background: rgba(82,118,255,0.14); color: #c9d4ff; }
    .cs-gnimti-stat-item img { display: block; width: 100%; height: 45%; min-height: 0; object-fit: contain; }
    .cs-gnimti-stat-empty { display: flex; align-items: center; justify-content: center; min-width: 160px; min-height: 220px; padding: 14px; border: 1px dashed rgba(157,158,163,0.22); border-radius: 7px; color: #8b8d92; font-size: 12px; font-weight: 800; text-align: center; }
    .cs-gnimti-empty-detail { margin: auto; color: #8b8d92; font-size: 13px; font-weight: 600; }
    .cs-info-mention { color: #efeff1; font-weight: 700; text-decoration: none; }
    .cs-info-mention:hover { color: #00FFA3; text-decoration: underline; text-underline-offset: 3px; }
    .cs-info-tag { color: #9d9ea3; font-weight: 700; }
    .cs-info-tag::before { content: "#"; color: #6b6d73; margin-right: 1px; }
    .cs-new-tag { display: inline-flex; align-items: center; min-height: 17px; margin-left: 4px; padding: 1px 6px 0; border: 1px solid rgba(251,113,133,0.42); border-radius: 999px; background: rgba(251,113,133,0.14); color: #fb7185; font-size: 10px; font-weight: 950; line-height: 1.35; letter-spacing: 0; text-transform: uppercase; vertical-align: 0.08em; animation: cs-new-tag-pulse 1.55s ease-in-out infinite; box-shadow: 0 0 0 rgba(251,113,133,0); }
    .cs-info-tag.cs-new-tag::before { content: none; }
    @keyframes cs-new-tag-pulse {
      0%, 100% { transform: translateY(0) scale(1); box-shadow: 0 0 0 rgba(251,113,133,0); }
      45% { transform: translateY(-1px) scale(1.04); box-shadow: 0 0 10px rgba(251,113,133,0.34); }
    }
    @media (prefers-reduced-motion: reduce) {
      .cs-new-tag { animation: none; }
    }
    .cs-info-section .cs-inline-feedback-trigger, .cs-info-media-trigger, .cs-info-text-popup-trigger { height: auto; min-height: 0; padding: 0 2px; border: 0; border-radius: 0; background: transparent; color: #93c5fd; font-size: inherit; font-weight: 700; line-height: inherit; vertical-align: baseline; }
    .cs-info-section .cs-inline-feedback-trigger:hover, .cs-info-media-trigger:hover, .cs-info-media-trigger.cs-open, .cs-info-text-popup-trigger:hover, .cs-info-text-popup-trigger.cs-open { background: transparent; color: #bfdbfe; text-decoration: underline; text-underline-offset: 3px; }
    .cs-info-media-trigger::before { content: ""; display: none; }

    /* 비라이브 채널 화면: _action 첫 위치의 일정 버튼 + absolute 패널 */
    .cs-channel-launch { position: relative; display: inline-flex; align-items: center; }
    .cs-channel-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; margin-right: 6px;
      height: 36px; padding: 0 12px; border: 1px solid #3a3c40; border-radius: 17px;
      background: #232427; color: #efeff1; font-size: 13px; font-weight: 600; cursor: pointer; }
    .cs-channel-button:hover, .cs-channel-button.cs-open { background: #2b2d31; border-color: #4a4c52; }
    .cs-channel-button svg { width: 16px; height: 16px; color: #00FFA3; }
    .cs-channel-panel { position: absolute; top: calc(100% + 8px); right: -300%;
      width: min(1330px, calc(100vw - 40px)); z-index: 9999; display: none; }
    .cs-channel-panel.cs-open { display: block; }
    .cs-channel-panel .cs-wrapper { margin: 0; box-shadow: 0 8px 28px rgba(0,0,0,0.5); }
    .cs-channel-panel .cs-update-notice-wrap, .cs-float-panel .cs-update-notice-wrap { margin: 0 0 -1px; }
    .cs-channel-panel .cs-update-notice, .cs-float-panel .cs-update-notice { width: 100%; max-width: 100%; }

    /* 치지직 라이트 모드 */
    :host(.cs-light-theme) .cs-wrapper { background: #ffffff; border-color: #e1e3e6; }
    :host(.cs-light-theme) .cs-update-notice { border-color: rgba(3,169,80,0.32); background: #e8f7ef; color: #276047; box-shadow: 0 -2px 10px rgba(0,0,0,0.07); }
    :host(.cs-light-theme) .cs-update-notice-badge { background: rgba(3,169,80,0.13); color: #047344; }
    :host(.cs-light-theme) .cs-update-notice-strong { color: #153b2a; }
    :host(.cs-light-theme) .cs-update-notice-arrow { border-color: rgba(3,169,80,0.22); background: rgba(3,169,80,0.07); color: #047344; }
    :host(.cs-light-theme) .cs-update-notice-arrow:hover { background: rgba(3,169,80,0.14); color: #035c36; }
    :host(.cs-light-theme) .cs-update-refresh { border-color: rgba(3,169,80,0.28); background: rgba(3,169,80,0.08); color: #047344; }
    :host(.cs-light-theme) .cs-update-refresh:hover { background: rgba(3,169,80,0.15); color: #035c36; }

    :host(.cs-light-theme) .cs-section { color: #1e2024; }
    :host(.cs-light-theme) .cs-info-section { background: #f8f9fa; border-color: #e1e3e6; }
    :host(.cs-light-theme) .cs-info-frame { background: #ffffff; border-color: #e5e7ea; }
    :host(.cs-light-theme) .cs-title,
    :host(.cs-light-theme) .cs-info-title { color: #1e2024; }
    :host(.cs-light-theme) .cs-pill-on { color: #008a43; background: rgba(3,169,80,0.1); }
    :host(.cs-light-theme) .cs-pill-on .cs-dot { background: #03a950; }
    :host(.cs-light-theme) .cs-arrow { color: #008a43; }
    :host(.cs-light-theme) .cs-arrow:disabled { color: #b8bcc1; }
    :host(.cs-light-theme) .cs-extension-collapse { background: #ffffff; border-color: #d8dadd; color: #555a61; }
    :host(.cs-light-theme) .cs-extension-collapse:hover { background: #eceef0; border-color: #c5c8cc; color: #1e2024; }
    :host(.cs-light-theme) .cs-extension-collapse-tip { background: #ffffff; border-color: #d3d6da; color: #1e2024; box-shadow: 0 4px 14px rgba(0,0,0,0.12); }

    :host(.cs-light-theme) .cs-settings-toggle { background: #ffffff; border-color: #d8dadd; color: #555a61; }
    :host(.cs-light-theme) .cs-settings-toggle:hover { background: #eceef0; border-color: #c5c8cc; color: #1e2024; }
    :host(.cs-light-theme) .cs-settings-toggle.cs-open { background: #03a950; border-color: #03a950; color: #ffffff; box-shadow: 0 0 0 3px rgba(3,169,80,0.16), 0 8px 18px rgba(3,169,80,0.2); }
    :host(.cs-light-theme) .cs-settings-tip,
    :host(.cs-light-theme) .cs-settings-panel { background: #ffffff; border-color: #d3d6da; color: #1e2024; box-shadow: 0 8px 24px rgba(0,0,0,0.14); }
    :host(.cs-light-theme) .cs-settings-label { color: #25282d; }
    :host(.cs-light-theme) .cs-settings-row + .cs-settings-row { border-top-color: #eceef0; }
    :host(.cs-light-theme) .cs-settings-switch { background: #c9ccd1; }
    :host(.cs-light-theme) .cs-settings-switch.cs-on { background: #03a950; }
    :host(.cs-light-theme) .cs-view-toggle { background: #ffffff; border-color: #d8dadd; color: #555a61; }
    :host(.cs-light-theme) .cs-view-toggle:not(.cs-open) .cs-view-icon img { filter: brightness(0) saturate(100%) invert(34%) sepia(7%) saturate(472%) hue-rotate(174deg) brightness(92%) contrast(87%); }
    :host(.cs-light-theme) .cs-view-toggle:hover, :host(.cs-light-theme) .cs-view-toggle:focus-visible, :host(.cs-light-theme) .cs-view-toggle.cs-open { background: #eceef0; color: #1e2024; }
    :host(.cs-light-theme) .cs-view-tip { background: #ffffff; border-color: #d3d6da; color: #1e2024; box-shadow: 0 4px 14px rgba(0,0,0,0.12); }
    :host(.cs-light-theme) .cs-view-toggle.cs-open { color: #ffffff; background: #03a950; border-color: #03a950; }
    :host(.cs-light-theme) .cs-lol-log-toggle { background: #ffffff; border-color: #d8dadd; color: #555a61; }
    :host(.cs-light-theme) .cs-lol-log-toggle:hover, :host(.cs-light-theme) .cs-lol-log-toggle:focus-visible, :host(.cs-light-theme) .cs-lol-log-toggle.cs-open { background: #03a950; border-color: #03a950; color: #ffffff; }
    :host(.cs-light-theme) .cs-lol-rank-toggle { background: #ffffff; border-color: rgba(37,99,235,0.24); color: #25282d; }
    :host(.cs-light-theme) .cs-lol-rank-toggle:hover, :host(.cs-light-theme) .cs-lol-rank-toggle:focus-visible { background: #f2f5f9; border-color: rgba(37,99,235,0.42); color: #1e2024; }
    :host(.cs-light-theme) .cs-lol-toggle-emblem-fallback { border-color: rgba(37,99,235,0.22); background: rgba(37,99,235,0.08); }
    :host(.cs-light-theme) .cs-lol-toggle-division { border-color: rgba(180,83,9,0.30); background: rgba(180,83,9,0.08); color: #92400e; }
    :host(.cs-light-theme) .cs-lol-rank-badge { border-color: rgba(37,99,235,0.22); background: rgba(37,99,235,0.08); color: #1d4ed8; }
    :host(.cs-light-theme) .cs-lol-rank-badge span { color: #2563eb; }
    :host(.cs-light-theme) .cs-lol-summary-stat, :host(.cs-light-theme) .cs-lol-summary-champs { background: #f8f9fa; border-color: #e1e3e6; }
    :host(.cs-light-theme) .cs-lol-summary-stat span, :host(.cs-light-theme) .cs-lol-summary-champs > span { color: #6f747b; }
    :host(.cs-light-theme) .cs-lol-summary-stat strong, :host(.cs-light-theme) .cs-lol-summary-champ strong { color: #1e2024; }
    :host(.cs-light-theme) .cs-lol-summary-stat small, :host(.cs-light-theme) .cs-lol-summary-champ small, :host(.cs-light-theme) .cs-lol-summary-muted { color: #6f747b; }
    :host(.cs-light-theme) .cs-lol-summary-champ { background: #eceef0; }
    :host(.cs-light-theme) .cs-lol-summary-champ img, :host(.cs-light-theme) .cs-lol-summary-champ > span { background: #dde1e5; }
    :host(.cs-light-theme) .cs-lol-tier-trend polyline { stroke: #2563eb; filter: drop-shadow(0 2px 5px rgba(37,99,235,0.20)); }
    :host(.cs-light-theme) .cs-lol-log { background: #f8f9fa; border-color: #e1e3e6; }
    :host(.cs-light-theme) .cs-lol-log-date { color: #1e2024; border-color: #dfe3e8; background: #eef1f4; box-shadow: 0 1px 0 rgba(0,0,0,0.035); }
    :host(.cs-light-theme) .cs-lol-log-date::before { background: #03a950; }
    :host(.cs-light-theme) .cs-lol-log-date small { color: #047f42; }
    :host(.cs-light-theme) .cs-lol-log-day + .cs-lol-log-day .cs-lol-log-date { border-top-color: #dfe3e8; }
    :host(.cs-light-theme) .cs-lol-log-row + .cs-lol-log-row { border-top-color: #e6e8eb; }
    :host(.cs-light-theme) .cs-lol-log-time { color: #6f747b; }
    :host(.cs-light-theme) .cs-lol-champion-portrait { border-color: rgba(0,0,0,0.12); background: #eef0f2; }
    :host(.cs-light-theme) .cs-lol-position-icon { border-color: rgba(37,99,235,0.34); background: rgba(15,23,42,0.88); }
    :host(.cs-light-theme) .cs-lol-log-title { color: #1e2024; }
    :host(.cs-light-theme) .cs-lol-log-meta { color: #555a61; }
    :host(.cs-light-theme) .cs-lol-log-meta span { background: #eceef0; }
    :host(.cs-light-theme) .cs-lol-loadout { border-color: #dde1e5; background: #f1f3f5; box-shadow: inset 0 1px 0 rgba(255,255,255,0.70); }
    :host(.cs-light-theme) .cs-lol-loadout-divider { background: #d4d9df; }
    :host(.cs-light-theme) .cs-lol-rune-icon, :host(.cs-light-theme) .cs-lol-item-icon { border-color: rgba(0,0,0,0.13); background: #eef0f2; }
    :host(.cs-light-theme) .cs-lol-loadout-tip { background: #ffffff; border-color: #d3d6da; color: #1e2024; box-shadow: 0 4px 14px rgba(0,0,0,0.12); }
    :host(.cs-light-theme) .cs-lol-summary-champ > .cs-lol-champion-tip { background: #ffffff; }
    :host(.cs-light-theme) .cs-lol-empty-slot { background: #e2e6ea; border-color: #d4d9df; }
    :host(.cs-light-theme) .cs-lol-damage b { color: #6f747b; }
    :host(.cs-light-theme) .cs-lol-damage i { background: rgba(0,0,0,0.09); }
    :host(.cs-light-theme) .cs-lol-damage strong { color: #b45309; }
    :host(.cs-light-theme) .cs-lol-kda-stat b, :host(.cs-light-theme) .cs-lol-cs-stat b, :host(.cs-light-theme) .cs-lol-gold-stat b, :host(.cs-light-theme) .cs-lol-share-stat b, :host(.cs-light-theme) .cs-lol-kp-stat b, :host(.cs-light-theme) .cs-lol-vision-stat b, :host(.cs-light-theme) .cs-lol-ward-stat b { color: #6f747b; }
    :host(.cs-light-theme) .cs-lol-kda-stat strong { color: #1e2024; }
    :host(.cs-light-theme) .cs-lol-cs-stat strong { color: #047f42; }
    :host(.cs-light-theme) .cs-lol-gold-stat strong { color: #b45309; }
    :host(.cs-light-theme) .cs-lol-share-stat strong { color: #2563eb; }
    :host(.cs-light-theme) .cs-lol-kp-stat strong { color: #7c3aed; }
    :host(.cs-light-theme) .cs-lol-vision-stat strong { color: #047857; }
    :host(.cs-light-theme) .cs-lol-ward-stat strong { color: #a21caf; }
    :host(.cs-light-theme) .cs-lol-log-empty { border-color: #d8dadd; color: #6f747b; }
    :host(.cs-light-theme) .cs-month-label { color: #6f747b; }
    :host(.cs-light-theme) .cs-month-weekday { color: #8b9097; }
    :host(.cs-light-theme) .cs-month-blank { background: #fafafa; border: 1px solid #f0f1f2; }
    :host(.cs-light-theme) .cs-cell { background: #f5f6f7; border-color: transparent; }
    :host(.cs-light-theme) .cs-break-icon-dark { display: none !important; }
    :host(.cs-light-theme) .cs-break-icon-light { display: block !important; }
    :host(.cs-light-theme) .cs-cell.cs-cell-off:not(.cs-month-cell) .cs-break-icon-light { transform: translateX(-50%) translateY(1.5%) scale(1.1) !important; }
    :host(.cs-light-theme) .cs-month-cell.cs-cell-off .cs-break-icon-light { transform: translateX(-50%) translateY(1.5%) scale(1.3) !important; }
    :host(.cs-light-theme) .cs-undetermined-icon-dark { display: none !important; }
    :host(.cs-light-theme) .cs-undetermined-icon-light { display: block !important; }
    :host(.cs-light-theme) .cs-cell-hoverable:hover { background: #eceef0; border-color: #d3d6da; }
    :host(.cs-light-theme) .cs-cell-today { background: rgba(0,199,90,0.09); border-color: rgba(0,199,90,0.5); }
    :host(.cs-light-theme) .cs-cell-today.cs-cell-hoverable:hover { background: rgba(0,199,90,0.15); }
    :host(.cs-light-theme) .cs-cell-date,
    :host(.cs-light-theme) .cs-cell-time,
    :host(.cs-light-theme) .cs-cell-title,
    :host(.cs-light-theme) .cs-part-text,
    :host(.cs-light-theme) .cs-pop-text,
    :host(.cs-light-theme) .cs-info-list { border-color: #e6e8eb; }
    :host(.cs-light-theme) .cs-pop-title { border-left-color: #03a950; background: rgba(3,169,80,0.1); color: #083d26; }
    :host(.cs-light-theme) .cs-info-subhead { color: #1e2024; }
    :host(.cs-light-theme) .cs-info-subhead::after { background: linear-gradient(90deg, rgba(3,169,80,0.38), #e6e8eb); }
    :host(.cs-light-theme) .cs-info-group, :host(.cs-light-theme) .cs-info-detail:not(:last-child) { border-color: #e6e8eb; }
    :host(.cs-light-theme) .cs-info-group-title, :host(.cs-light-theme) .cs-info-detail-title { color: #1e2024; }
    :host(.cs-light-theme) .cs-info-group-title::after { background: linear-gradient(90deg, rgba(3,169,80,0.38), #e6e8eb); }
    :host(.cs-light-theme) .cs-info-detail-body { color: #4b4f55; }
    :host(.cs-light-theme) .cs-info-detail-toggle { border-color: rgba(3,169,80,0.22); background: rgba(3,169,80,0.07); color: #047344; }
    :host(.cs-light-theme) .cs-info-detail-head[data-info-toggle]:hover { background: rgba(3,169,80,0.07); }
    :host(.cs-light-theme) .cs-info-detail-head[data-info-toggle]:hover .cs-info-detail-title { color: #0f1720; }
    :host(.cs-light-theme) .cs-info-item { color: #4b4f55; border-color: #e6e8eb; }
    :host(.cs-light-theme) .cs-info-empty { color: #8b9097; }
    :host(.cs-light-theme) .cs-info-new-frame:hover, :host(.cs-light-theme) .cs-info-new-frame:focus-visible { background: rgba(3,169,80,0.07); }
    :host(.cs-light-theme) .cs-gnimti-dialog { background: #ffffff; border-color: rgba(0,0,0,0.12); box-shadow: 0 18px 42px rgba(0,0,0,0.18); }
    :host(.cs-light-theme) .cs-gnimti-tab { background: rgba(255,255,255,0.82); border-color: rgba(0,0,0,0.12); color: #4b4f55; }
    :host(.cs-light-theme) .cs-gnimti-tab:hover { border-color: rgba(3,169,80,0.34); color: #1e2024; }
    :host(.cs-light-theme) .cs-gnimti-tab.cs-active { border-color: rgba(3,169,80,0.48); background: rgba(3,169,80,0.12); color: #007a3a; }
    :host(.cs-light-theme) .cs-gnimti-placeholder { background: #f8f9fa; border-color: #e1e3e6; color: #6f747b; }
    :host(.cs-light-theme) .cs-gnimti-tierlist, :host(.cs-light-theme) .cs-gnimti-roster-board { background: #eef0f2; border-color: #e1e3e6; scrollbar-color: rgba(3,169,80,0.48) rgba(238,240,242,0.96); }
    :host(.cs-light-theme) .cs-gnimti-tierlist::-webkit-scrollbar-track, :host(.cs-light-theme) .cs-gnimti-roster-board::-webkit-scrollbar-track { background: linear-gradient(180deg, #f4f6f8, #e7eaee); border-left-color: rgba(0,0,0,0.06); }
    :host(.cs-light-theme) .cs-gnimti-tierlist::-webkit-scrollbar-thumb, :host(.cs-light-theme) .cs-gnimti-roster-board::-webkit-scrollbar-thumb { background: linear-gradient(180deg, rgba(3,169,80,0.56), rgba(72,93,210,0.36)); border-color: #f8f9fa; box-shadow: none; }
    :host(.cs-light-theme) .cs-gnimti-tierlist::-webkit-scrollbar-thumb:hover, :host(.cs-light-theme) .cs-gnimti-roster-board::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, rgba(3,169,80,0.7), rgba(72,93,210,0.48)); }
    :host(.cs-light-theme) .cs-gnimti-dialog { scrollbar-color: rgba(3,169,80,0.48) rgba(238,240,242,0.96); }
    :host(.cs-light-theme) .cs-gnimti-dialog::-webkit-scrollbar-track { background: linear-gradient(180deg, #f4f6f8, #e7eaee); border-left-color: rgba(0,0,0,0.06); }
    :host(.cs-light-theme) .cs-gnimti-dialog::-webkit-scrollbar-thumb { background: linear-gradient(180deg, rgba(3,169,80,0.56), rgba(72,93,210,0.36)); border-color: #f8f9fa; box-shadow: none; }
    :host(.cs-light-theme) .cs-gnimti-dialog::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, rgba(3,169,80,0.7), rgba(72,93,210,0.48)); }
    :host(.cs-light-theme) .cs-gnimti-column { background: #f8f9fa; border-color: #e1e3e6; }
    :host(.cs-light-theme) .cs-gnimti-position { color: #1e2024; border-color: #e6e8eb; }
    :host(.cs-light-theme) .cs-gnimti-member:hover { background: #eef0f2; }
    :host(.cs-light-theme) .cs-gnimti-avatar { background: #e1e3e6; border-color: #d3d6da; color: #555a61; }
    :host(.cs-light-theme) .cs-gnimti-name { color: #2f343a; }
    :host(.cs-light-theme) .cs-gnimti-member-tier-bg { background-image: linear-gradient(90deg, rgba(248,249,250,0.92) 0%, rgba(248,249,250,0.62) 58%, rgba(248,249,250,0.2) 100%), var(--gnimti-tier-bg); }
    :host(.cs-light-theme) .cs-gnimti-member-tier-bg:hover, :host(.cs-light-theme) .cs-gnimti-member-tier-bg.cs-selected { background-image: linear-gradient(90deg, rgba(238,240,242,0.88) 0%, rgba(238,240,242,0.58) 55%, rgba(238,240,242,0.16) 100%), var(--gnimti-tier-bg); background-size: auto 136%, cover; background-position: right 70%; background-repeat: no-repeat; }
    :host(.cs-light-theme) .cs-gnimti-detail { background: #f8f9fa; border-color: #e1e3e6; }
    :host(.cs-light-theme) .cs-gnimti-detail-title { color: #1e2024; }
    :host(.cs-light-theme) .cs-gnimti-card { background: #eef0f2; }

    :host(.cs-light-theme) .cs-gnimti-stat-label { background: rgba(3,169,80,0.12); color: #007a3a; }
    :host(.cs-light-theme) .cs-gnimti-stat-label-team { background: rgba(72,93,210,0.12); color: #3344aa; }
    :host(.cs-light-theme) .cs-gnimti-stat-empty { border-color: #d3d6da; color: #777c83; }
    :host(.cs-light-theme) .cs-gnimti-member.cs-selected { background: #eef0f2; box-shadow: inset 0 0 0 1px rgba(3,169,80,0.4); }
    :host(.cs-light-theme) .cs-info-item::before { background: rgba(3,169,80,0.55); }
    :host(.cs-light-theme) .cs-info-mention { color: #1e2024; }
    :host(.cs-light-theme) .cs-info-mention:hover { color: #008a43; }
    :host(.cs-light-theme) .cs-info-tag { color: #6f747b; }
    :host(.cs-light-theme) .cs-new-tag { border-color: rgba(225,29,72,0.3); background: rgba(225,29,72,0.1); color: #be123c; }
    :host(.cs-light-theme) .cs-info-section .cs-inline-feedback-trigger, :host(.cs-light-theme) .cs-info-media-trigger, :host(.cs-light-theme) .cs-info-text-popup-trigger { color: #1d4ed8; background: transparent; border: 0; }
    :host(.cs-light-theme) .cs-info-section .cs-inline-feedback-trigger:hover, :host(.cs-light-theme) .cs-info-media-trigger:hover, :host(.cs-light-theme) .cs-info-media-trigger.cs-open, :host(.cs-light-theme) .cs-info-text-popup-trigger:hover, :host(.cs-light-theme) .cs-info-text-popup-trigger.cs-open { color: #1e40af; background: transparent; }
    :host(.cs-light-theme) .cs-cell-today .cs-cell-date,
    :host(.cs-light-theme) .cs-cell-today .cs-cell-time { color: #008a43; }
    :host(.cs-light-theme) .cs-cell-today .cs-cell-title,
    :host(.cs-light-theme) .cs-cell-today .cs-part-text { color: #1e2024; }
    :host(.cs-light-theme) .cs-cell:not(.cs-cell-muted):not(.cs-cell-today):not(.cs-cell-unknown) .cs-cell-title,
    :host(.cs-light-theme) .cs-cell:not(.cs-cell-muted):not(.cs-cell-today):not(.cs-cell-unknown) .cs-part-text { color: #2f343a; }
    :host(.cs-light-theme) .cs-cell:not(.cs-cell-muted):not(.cs-cell-today):not(.cs-cell-unknown) .cs-cell-time { color: #008a43; }
    :host(.cs-light-theme) .cs-cell-muted .cs-cell-time,
    :host(.cs-light-theme) .cs-cell-muted .cs-cell-title,
    :host(.cs-light-theme) .cs-cell-muted .cs-part-text,
    :host(.cs-light-theme) .cs-cell-unknown .cs-cell-title { color: #a3a7ad; }
    :host(.cs-light-theme) .cs-cell.cs-cell-unknown:not(.cs-cell-off) .cs-cell-title { color: #506070; text-shadow: 0 1px 3px rgba(255, 255, 255, 0.72); }
    :host(.cs-light-theme) .cs-cell.cs-cell-off .cs-cell-title { color: #506070; text-shadow: 0 1px 3px rgba(255, 255, 255, 0.72); }
    :host(.cs-light-theme) .cs-part-tag { color: #008f43; background: rgba(0,199,90,0.1); }
    :host(.cs-light-theme) .cs-part-tag-collab { color: #7557c9; background: rgba(117,87,201,0.12); }
    :host(.cs-light-theme) .cs-part-tag-official { color: #2563eb; background: rgba(37,99,235,0.09); border-color: rgba(37,99,235,0.2); }
    :host(.cs-light-theme) .cs-part-tag-speculative { color: #9a6b00; background: rgba(232,194,104,0.2); }
    :host(.cs-light-theme) .cs-cell-muted .cs-part-tag { color: #969ba1; background: #e9ebed; border-color: transparent; }
    :host(.cs-light-theme) .cs-part-memo-icon { color: #8b9097; }
    :host(.cs-light-theme) .cs-pop-part { background: #eef0f2; border-color: #d8dadd; }
    :host(.cs-light-theme) .cs-pop-members-label { color: #6f747b; }
    :host(.cs-light-theme) .cs-pop-members-chip { background: #e1e3e6; color: #555a61; }
    :host(.cs-light-theme) .cs-pop-part-notes { border-top-color: rgba(3,169,80,0.18); }
    :host(.cs-light-theme) .cs-text-badge { color: #7557c9; background: rgba(117,87,201,0.1); border-color: rgba(117,87,201,0.25); }
    :host(.cs-light-theme) .cs-game-stat { background: #ffffff; border-color: #d8dadd; }
    :host(.cs-light-theme) .cs-game-stat { color: #33373c; }
    :host(.cs-light-theme) .cs-game-stat:hover, :host(.cs-light-theme) .cs-game-stat.cs-selected { background: rgba(3,169,80,0.1); border-color: #03a950; }
    :host(.cs-light-theme) .cs-game-stat.cs-muted { opacity: 0.5; }
    :host(.cs-light-theme) .cs-game-chip { color: #33373c; background: rgba(3,169,80,0.08); border-color: rgba(3,169,80,0.24); }
    :host(.cs-light-theme) .cs-game-chip.cs-selected { color: #ffffff; background: #03a950; border-color: #03a950; }
    :host(.cs-light-theme) .cs-game-chip.cs-muted { color: #9ca1a8; background: #eef0f2; border-color: #d8dadd; }
    :host(.cs-light-theme) .cs-game-empty { color: #a3a7ad; }
    :host(.cs-light-theme) .cs-inline-feedback-trigger { color: #008a43; background: rgba(3,169,80,0.08); border-color: rgba(3,169,80,0.28); }
    :host(.cs-light-theme) .cs-inline-feedback-trigger:hover { background: rgba(3,169,80,0.15); }
    :host(.cs-light-theme) .cs-inline-media-trigger { color: #1d4ed8; background: rgba(37,99,235,0.08); border-color: rgba(37,99,235,0.24); }
    :host(.cs-light-theme) .cs-inline-media-trigger::before { color: #2563eb; }
    :host(.cs-light-theme) .cs-inline-media-trigger:hover,
    :host(.cs-light-theme) .cs-inline-media-trigger.cs-open { color: #1e40af; background: rgba(37,99,235,0.14); border-color: rgba(37,99,235,0.42); }
    :host(.cs-light-theme) .cs-memo-dot,
    :host(.cs-light-theme) .cs-info-dot { background: #03a950; }
    :host(.cs-light-theme) .cs-vod-btn { color: #008a43; background: rgba(3,169,80,0.1); }
    :host(.cs-light-theme) .cs-vod-btn:hover { background: rgba(3,169,80,0.17); }
    :host(.cs-light-theme) .cs-vod-btn-disabled,
    :host(.cs-light-theme) .cs-vod-btn-disabled:hover { color: #a3a7ad; background: #e9ebed; }
    :host(.cs-light-theme) .cs-update-history-section { background: #f8f9fa; border-color: #e1e3e6; }
    :host(.cs-light-theme) .cs-update-history-title { color: #1e2024; }
    :host(.cs-light-theme) .cs-update-history-toggle,
    :host(.cs-light-theme) .cs-update-history-arrow { border-color: rgba(3,169,80,0.22); background: rgba(3,169,80,0.07); color: #047344; }
    :host(.cs-light-theme) .cs-update-history-toggle:hover,
    :host(.cs-light-theme) .cs-update-history-arrow:hover { background: rgba(3,169,80,0.14); color: #035c36; }
    :host(.cs-light-theme) .cs-footer { background: #f5f6f7; border-color: #e1e3e6; }
    :host(.cs-light-theme) .cs-schedule-notice,
    :host(.cs-light-theme) .cs-updated { color: #777c83; }
    :host(.cs-light-theme) .cs-refresh { color: #777c83; }
    :host(.cs-light-theme) .cs-refresh:hover { color: #33373c; }
    :host(.cs-light-theme) .cs-feedback-open { background: #ffffff; border-color: #d8dadd; color: #555a61; }
    :host(.cs-light-theme) .cs-feedback-open:hover,
    :host(.cs-light-theme) .cs-feedback-open.cs-open { background: #eceef0; color: #1e2024; }
    :host(.cs-light-theme) .cs-feedback-panel { background: #ffffff; border-color: #d8dadd; box-shadow: 0 10px 30px rgba(0,0,0,0.16); }
    :host(.cs-light-theme) .cs-media-popover.cs-update-text-popover .cs-text-popup-content { scrollbar-color: rgba(3,169,80,0.62) rgba(238,240,242,0.96); }
    :host(.cs-light-theme) .cs-media-popover.cs-update-text-popover .cs-text-popup-content::-webkit-scrollbar-track { background: linear-gradient(180deg, #f4f6f8, #e7eaee); }
    :host(.cs-light-theme) .cs-media-popover.cs-update-text-popover .cs-text-popup-content::-webkit-scrollbar-thumb { border-color: #f8f9fa; background: linear-gradient(180deg, rgba(3,169,80,0.72), rgba(72,93,210,0.42)); box-shadow: none; }
    :host(.cs-light-theme) .cs-media-popover.cs-update-text-popover .cs-text-popup-content::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, rgba(3,169,80,0.88), rgba(72,93,210,0.56)); }
    :host(.cs-light-theme) .cs-install-guide { scrollbar-color: rgba(3,169,80,0.58) rgba(238,240,242,0.9); }
    :host(.cs-light-theme) .cs-install-guide::-webkit-scrollbar-track { background: rgba(238,240,242,0.9); }
    :host(.cs-light-theme) .cs-install-guide::-webkit-scrollbar-thumb { border-color: #f8f9fa; background: linear-gradient(180deg, rgba(3,169,80,0.7), rgba(3,169,80,0.42)); }
    :host(.cs-light-theme) .cs-install-guide::-webkit-scrollbar-thumb:hover { background: linear-gradient(180deg, rgba(3,169,80,0.86), rgba(3,169,80,0.58)); }
    :host(.cs-light-theme) .cs-feedback-title { color: #1e2024; }
    :host(.cs-light-theme) .cs-feedback-label,
    :host(.cs-light-theme) .cs-feedback-status,
    :host(.cs-light-theme) .cs-feedback-limit,
    :host(.cs-light-theme) .cs-feedback-count { color: #6f747b; }
    :host(.cs-light-theme) .cs-feedback-count.cs-near-limit { color: #9a6700; }
    :host(.cs-light-theme) .cs-feedback-status.cs-error { color: #c63d3d; }
    :host(.cs-light-theme) .cs-feedback-status.cs-success { color: #008a43; }
    :host(.cs-light-theme) .cs-feedback-input,
    :host(.cs-light-theme) .cs-feedback-select,
    :host(.cs-light-theme) .cs-feedback-textarea { background: #f7f8f9; border-color: #d8dadd; color: #1e2024; }
    :host(.cs-light-theme) .cs-feedback-contact-toggle { border-color: rgba(3,169,80,0.28); background: rgba(3,169,80,0.08); color: #047344; }
    :host(.cs-light-theme) .cs-feedback-contact-toggle:hover, :host(.cs-light-theme) .cs-feedback-contact-toggle.cs-open { background: rgba(3,169,80,0.14); color: #035c36; }
    :host(.cs-light-theme) .cs-popover { background: #ffffff; border-color: #d8dadd; box-shadow: 0 8px 24px rgba(0,0,0,0.14); }
    :host(.cs-light-theme) .cs-pop-arrow { background: #ffffff; border-color: #d8dadd; }
    :host(.cs-light-theme) .cs-pop-date { color: #1e2024; }
    :host(.cs-light-theme) .cs-pop-text { color: #2f343a; }
    :host(.cs-light-theme) .cs-pop-row .cs-cell-time,
    :host(.cs-light-theme) .cs-pop-icon:not(.cs-pop-icon-collab):not(.cs-pop-icon-official):not(.cs-pop-icon-speculative) { color: #008a43; }
    :host(.cs-light-theme) .cs-pop-icon-official { color: #2563eb; }
    :host(.cs-light-theme) .cs-pop-part-label { color: #007a3a; background: rgba(3,169,80,0.12); }
    :host(.cs-light-theme) .cs-pop-part-text { color: #F2F3F5; }
    :host(.cs-light-theme) .cs-tag-tone, :host(.cs-light-theme) .cs-part-tag.cs-tag-tone, :host(.cs-light-theme) .cs-text-badge.cs-tag-tone { color: var(--cs-tag-light-color); background: var(--cs-tag-light-bg); border-color: var(--cs-tag-light-border); }
    :host(.cs-light-theme) .cs-cell-muted .cs-part-tag.cs-tag-tone { color: #969ba1; background: #e9ebed; border-color: transparent; }
    :host(.cs-light-theme) .cs-pop-text.cs-pop-part-text { color: #F2F3F5; }
    :host(.cs-light-theme) .cs-pop-note-box { background: #f5f6f7; border-color: #dfe1e4; }
    :host(.cs-light-theme) .cs-pop-note-text { color: #4b4f55; }
    :host(.cs-light-theme) .cs-member-avatar-img { border-color: #d3d6da; }
    :host(.cs-light-theme) .cs-member-avatar-fallback { background: #dfe1e4; color: #33373c; }
    :host(.cs-light-theme) .cs-member-tip,
    :host(.cs-light-theme) .cs-cafe-time-tip, :host(.cs-light-theme) .cs-video-time-tip { background: #ffffff; border-color: #d3d6da; color: #1e2024; box-shadow: 0 4px 14px rgba(0,0,0,0.12); }
    :host(.cs-light-theme) .cs-channel-button { background: #ffffff; border-color: #d8dadd; color: #1e2024; }
    :host(.cs-light-theme) .cs-channel-button svg { color: #008a43; }
    :host(.cs-light-theme) .cs-channel-button:hover,
    :host(.cs-light-theme) .cs-channel-button.cs-open { background: #f5f6f7; border-color: #c5c8cc; }
    :host(.cs-light-theme) .cs-channel-panel .cs-wrapper { box-shadow: 0 8px 28px rgba(0,0,0,0.16); }
    :host(.cs-light-theme) .cs-float-btn { background: #03a950; color: #ffffff; }

    @media (max-width: 600px) {
      .cs-header { flex-wrap: wrap; }
      .cs-schedule-toolbar { margin-left: 16px; margin-right: 16px; }
      .cs-month-grid { gap: 4px; }
      .cs-month-grid .cs-month-cell, .cs-month-blank { min-height: 70px; padding: 7px 6px 35px; }
      .cs-month-cell .cs-cell-time, .cs-month-cell .cs-cell-title, .cs-month-cell .cs-part-text { font-size: 12px; }
      .cs-game-stats .swiper-slide { width: min(190px, calc(78vw - 24px)); }
      .cs-gnimti-popup { padding: 14px; }
      .cs-gnimti-dialog { width: calc(100vw - 28px); max-height: calc(100vh - 28px); }
      .cs-gnimti-tabs { left: 10px; right: 42px; bottom: 8px; max-width: none; gap: 4px; }
      .cs-gnimti-tab-row { gap: 5px; }
      .cs-gnimti-logo { width: min(48%, 190px); max-height: 64%; }
      .cs-gnimti-tab { min-height: 26px; padding: 0 8px; font-size: 11px; }
      .cs-gnimti-content { grid-template-columns: 1fr; padding: 12px; overflow: visible; }
      .cs-gnimti-tierlist, .cs-gnimti-roster-board { max-height: calc(100vh - 180px); padding: 8px; }
      .cs-gnimti-roster { grid-template-columns: 1fr; overflow: visible; }
      .cs-gnimti-card { grid-template-columns: 1fr; }
      .cs-gnimti-stat-item img { max-height: 260px; }
      .cs-footer-meta-frame { gap: 6px; }
      .cs-feedback-panel { position: fixed; left: 16px; right: 16px; bottom: 16px; width: auto; max-height: calc(100vh - 32px); overflow-y: auto; }
    }

    /* 플로팅 폴백 */
    .cs-float-btn { position: fixed; left: 20px; bottom: 20px; z-index: 2147483646;
      width: 46px; height: 46px; border-radius: 50%; background: #00FFA3; border: none;
      cursor: pointer; color: #04342c; font-size: 20px; line-height: 1;
      box-shadow: 0 2px 10px rgba(0,0,0,0.4); }
    .cs-float-panel { position: fixed; left: 20px; bottom: 76px; z-index: 2147483646;
      width: 480px; max-width: calc(100vw - 40px); display: none; }
    .cs-float-panel.cs-open { display: block; }
    .cs-float-panel .cs-wrapper { margin: 0; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
  `;

  // ----------------------------------------------------------
  // 렌더링
  // ----------------------------------------------------------
  function gameLabel(entry, game) {
    if (typeof game === "string") return game.trim();
    return String((game && game.label) || (entry && (entry.titleShort || entry.title)) || "게임").trim();
  }

  function gameItems(entry) {
    return ((entry && entry.gameImages) || [])
      .map((item) => ({ label: gameLabel(entry, item), url: item && item.url ? item.url : "" }))
      .filter((item) => item.label);
  }

  function gameChipsHtml(entry, compact) {
    const allGames = gameItems(entry);
    const games = allGames;
    if (!games.length) return compact ? "" : '<div class="cs-game-empty">게임 \uC5C6\uC74C</div>';
    return '<div class="cs-game-chip-list">' + games.map((game) => {
      const chipClass = game.label === state.selectedGame ? " cs-selected" : (state.selectedGame ? " cs-muted" : "");
      return '<span class="cs-game-chip' + chipClass + '" title="' + escapeHtml(game.label) + '">' +
        directiveHtml(game.label, { disableProfileLinks: true }) + "</span>";
    }).join("") + "</div>";
  }

  function monthGameStats(monthBase) {
    const days = new Date(monthBase.getFullYear(), monthBase.getMonth() + 1, 0).getDate();
    const map = new Map();
    for (let day = 1; day <= days; day++) {
      const entry = entryFor(dateKey(new Date(monthBase.getFullYear(), monthBase.getMonth(), day)));
      const games = gameItems(entry);
      if (!games.length) continue;
      const seen = new Set();
      for (const game of games) {
        if (seen.has(game.label)) continue;
        seen.add(game.label);
        const stat = map.get(game.label) || { label: game.label, count: 0 };
        stat.count += 1;
        map.set(game.label, stat);
      }
    }
    return {
      stats: Array.from(map.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko")),
    };
  }

  function gameSummaryHtml(monthBase) {
    const summary = monthGameStats(monthBase);
    if (!summary.stats.length) return '<div class="cs-game-summary"><div class="cs-game-empty">이번 달 게임 없음</div></div>';
    let previousCount = null;
    let previousRank = 0;
    const statsHtml = summary.stats.map((item, idx) => {
      const count = Number(item.count || 0);
      const rank = previousCount === count ? previousRank : idx + 1;
      previousCount = count;
      previousRank = rank;
      const statClass = item.label === state.selectedGame ? " cs-selected" : (state.selectedGame ? " cs-muted" : "");
      return '<div class="swiper-slide"><button type="button" class="cs-game-stat' + statClass + '" data-game-filter="' + escapeHtml(item.label) + '">' +
        '<span class="cs-game-stat-main"><span class="cs-game-rank">#' + rank + '</span><span class="cs-game-stat-name">' + directiveHtml(item.label, { disableProfileLinks: true }) + '</span></span>' +
        '<span class="cs-game-stat-count">' + item.count + '일 방송</span></button></div>';
    }).join("");
    return '<div class="cs-game-summary"><div class="cs-game-stats swiper" data-game-rank-swiper="1"><div class="swiper-wrapper">' + statsHtml + '</div></div></div>';
  }

  function compactCellContentHtml(entry) {
    if (entry.parts && entry.parts.length) {
      return entry.parts.map((p, idx) => {
        const tagClass = p.speculative ? "cs-part-tag cs-part-tag-speculative" :
          p.official && !p.collab ? "cs-part-tag cs-part-tag-official" :
          isSpecialPart(p) ? "cs-part-tag cs-part-tag-collab" : "cs-part-tag";
        const tagLabel = partDisplayLabel(p, idx);
        const firstTag = firstPartTag(p);
        const tagToneClass = firstTag ? " cs-tag-tone" : "";
        const tagToneAttr = firstTag ? tagToneStyleAttr(firstTag) : "";
        let display = '<span class="cs-part-text">' + directiveHtml(p.content) + "</span>";
        if (p.displayType === "tag") display = '<span class="cs-text-badge">' + directiveHtml(p.content) + "</span>";
        if (p.displayType === "profile" && p.profile) display = '<span class="cs-inline-profile">' + channelAvatarLinkHtml(p.profile) + "</span>";
        const tagHtml = tagLabel ? '<span class="' + tagClass + tagToneClass + '"' + tagToneAttr + '>' + escapeHtml(tagLabel) + "</span>" : "";
        return '<div class="cs-cell-part">' + tagHtml + display + "</div>";
      }).join("");
    }
    return '<div class="cs-cell-title">' + directiveHtml(entry.titleShort || entry.title || "") + "</div>";
  }

  function scheduleCellHtml(d, compact) {
    const key = dateKey(d);
    const entry = entryFor(key);
    const isToday = key === state.todayKey;
    const isPast = key < state.todayKey;
    const isOff = !!entry && entry.status === "off";
    const notes = entryNotes(entry);
    const games = gameItems(entry);
    const hasPartNotes = entryHasPartNotes(entry);
    const hoverable = !!entry && (state.gameOnly ? games.length > 0 : (!isOff || notes.length > 0 || hasPartNotes));

    const classes = ["cs-cell"];
    if (compact) classes.push("cs-month-cell");
    if (isToday) classes.push("cs-cell-today");
    if (isPast || isOff) classes.push("cs-cell-muted");
    if (isOff) classes.push("cs-cell-off");
    if (!entry || (state.gameOnly && !games.length)) classes.push("cs-cell-unknown");
    if ((!compact && !entry) || isOff) classes.push("cs-cell-center");
    if (hoverable) classes.push("cs-cell-hoverable");

    const dateLabel = compact ? String(d.getDate()) : ((isToday ? "\uC624\uB298 " : "") + cellDateLabel(d));
    let dateRow = '<div class="cs-cell-date">' + dateLabel + "</div>";
    let body = "";
    if (state.gameOnly) {
      body = gameChipsHtml(entry, compact);
    } else if (!entry) {
      body = compact ? "" : '<div class="cs-cell-center-body">' +
        '<div class="cs-cell-time"><img class="cs-undetermined-icon cs-undetermined-icon-dark" src="' + UNDETERMINED_ICON_URL + '" alt="\uBBF8\uC815" /><img class="cs-undetermined-icon cs-undetermined-icon-light" src="' + UNDETERMINED_LIGHT_ICON_URL + '" alt="\uBBF8\uC815" /></div>' +
        '<div class="cs-cell-title">\uBBF8\uC815</div></div>';
    } else if (isOff) {
      const dot = (notes.length || hasPartNotes) ? '<span class="cs-memo-dot"></span>' : "";
      body = dot + '<div class="cs-cell-center-body"><div class="cs-cell-time"><img class="cs-break-icon cs-break-icon-dark" src="' + BREAK_ICON_URL + '" alt="\uD734\uBC29" /><img class="cs-break-icon cs-break-icon-light" src="' + BREAK_LIGHT_ICON_URL + '" alt="\uD734\uBC29" /></div><div class="cs-cell-title">\uD734\uBC29</div></div>';
    } else if (compact) {
      body = compactCellContentHtml(entry);
    } else if (isPast) {
      body = '<div style="margin-top:12px;">' + cellContentHtml(entry) + "</div>";
    } else {
      const timeText = entry.start ? escapeHtml(entry.start) : "\uC2DC\uAC04 \uBBF8\uC815";
      dateRow = '<div class="cs-cell-date-row"><span class="cs-cell-date">' + dateLabel + "</span>" +
        '<span class="cs-cell-time">' + timeText + "</span></div>";
      body = cellContentHtml(entry);
    }

    return '<div class="' + classes.join(" ") + '" data-date="' + key + '"' +
      (hoverable ? ' data-hoverable="1" role="button" tabindex="0"' : "") + ">" +
      dateRow + body + (state.gameOnly || compact ? "" : timeIndicatorsHtml(entry, isPast)) + "</div>";
  }

  function fiveDayGridHtml(windowStart) {
    let html = "";
    for (let i = 0; i < PAGE_SIZE; i++) html += scheduleCellHtml(addDays(windowStart, i), false);
    return html;
  }

  function monthGridHtml(monthBase) {
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    let html = weekdays.map((day) => '<div class="cs-month-weekday">' + day + "</div>").join("");
    const firstDay = monthBase.getDay();
    const days = new Date(monthBase.getFullYear(), monthBase.getMonth() + 1, 0).getDate();
    for (let i = 0; i < firstDay; i++) html += '<div class="cs-month-blank" aria-hidden="true"></div>';
    for (let day = 1; day <= days; day++) html += scheduleCellHtml(new Date(monthBase.getFullYear(), monthBase.getMonth(), day), true);
    const trailing = (firstDay + days) % 7;
    if (trailing) for (let i = trailing; i < 7; i++) html += '<div class="cs-month-blank" aria-hidden="true"></div>';
    return html;
  }

  function monthHasEntry(monthBase) {
    const firstKey = dateKey(new Date(monthBase.getFullYear(), monthBase.getMonth(), 1));
    const lastKey = dateKey(new Date(monthBase.getFullYear(), monthBase.getMonth() + 1, 0));
    for (const key of state.byDate.keys()) {
      if (key >= firstKey && key <= lastKey) return true;
    }
    return false;
  }

  function render() {
    if (!state.shadow) return;

    const root = state.shadow.getElementById("cs-root");
    if (!root) return;
    const today = parseKey(state.todayKey);
    const anchor = addDays(today, todayAnchorOffset());
    const windowStart = addDays(anchor, state.pageOffset * PAGE_SIZE);
    const monthBase = new Date(today.getFullYear(), today.getMonth() + state.monthOffset, 1);
    const windowStartKey = dateKey(windowStart);
    const windowEndKey = dateKey(addDays(windowStart, PAGE_SIZE - 1));

    const previousMonth = new Date(monthBase.getFullYear(), monthBase.getMonth() - 1, 1);
    const nextMonth = new Date(monthBase.getFullYear(), monthBase.getMonth() + 1, 1);
    const canGoPrev = state.monthExpanded ? monthHasEntry(previousMonth) : hasEntryBefore(windowStartKey);
    const canGoNext = state.monthExpanded ? monthHasEntry(nextMonth) : hasEntryAfter(windowEndKey);

    if (!state.monthExpanded && state.gameOnly) state.gameOnly = false;
    const pill = pillState();
    const cellsHtml = state.monthExpanded ? monthGridHtml(monthBase) : fiveDayGridHtml(windowStart);
    const lolLogMode = state.scheduleViewMode === "lolMatchLogs";
    const gameSummary = !lolLogMode && state.monthExpanded && state.gameOnly ? gameSummaryHtml(monthBase) : "";
    const gridClass = state.monthExpanded ? "cs-grid cs-month-grid" : "cs-grid";
    const monthLabel = state.monthExpanded
      ? '<span class="cs-month-label">' + monthBase.getFullYear() + "." + String(monthBase.getMonth() + 1).padStart(2, "0") + "</span>"
      : "";

    const updatedLabel = formatUpdated();
    const monthToggleLabel = state.monthExpanded ? "주간 보기" : "월간 보기";
    const schedulePillHtml = '<span class="cs-pill ' + pill.cls + '">' + pill.html + '</span>';
    const collapseLabel = "오뱅알 " + (state.extensionCollapsed ? "펼치기" : "접기");
    const settingsLabel = "알림 설정";
    const showNotificationSettings = targetLiveNotificationSettingsVisible();
    if (!showNotificationSettings && state.settingsOpen) state.settingsOpen = false;
    const scheduleToolbarHtml =
      '<div class="cs-schedule-toolbar">' +
      (state.extensionCollapsed ? "" : lolLogToggleHtml(lolLogMode)) +
      (state.extensionCollapsed || lolLogMode ? "" : '<button type="button" class="cs-view-toggle' + (state.monthExpanded ? " cs-open" : "") + '" id="cs-month-toggle" aria-pressed="' + String(state.monthExpanded) + '" aria-label="' + monthToggleLabel + '"><span class="cs-view-icon" aria-hidden="true"><img src="' + CALENDAR_ICON_URL + '" alt="" /></span><span class="cs-view-tip">' + monthToggleLabel + "</span></button>") +
      (showNotificationSettings ? '<button type="button" class="cs-settings-toggle' + (state.settingsOpen ? " cs-open" : "") + '" id="cs-settings-toggle" aria-expanded="' + String(state.settingsOpen) + '" aria-label="' + settingsLabel + '">&#9881;<span class="cs-settings-tip">' + settingsLabel + "</span></button>" : "") +
      '<button type="button" class="cs-extension-collapse" id="cs-extension-collapse" aria-expanded="' + String(!state.extensionCollapsed) + '" aria-label="' + collapseLabel + '">' + (state.extensionCollapsed ? "\u25BC" : "\u25B2") + '<span class="cs-extension-collapse-tip">' + collapseLabel + "</span></button>" +
      "</div>";
    const settingsPanelHtml = showNotificationSettings && state.settingsOpen
      ? '<div class="cs-settings-panel" id="cs-settings-panel">' +
        '<div class="cs-settings-heading"><span>알림 설정</span><button type="button" class="cs-settings-help" popovertarget="cs-notification-guide" aria-label="알림 기능 도움말" title="알림 기능 도움말">?</button></div>' +
        '<div id="cs-notification-guide" class="cs-notification-guide" popover="auto" role="dialog" aria-label="알림 기능 도움말"><div class="cs-notification-guide-heading"><span>알림 기능 도움말</span><button type="button" class="cs-notification-guide-close" popovertarget="cs-notification-guide" popovertargetaction="hide" aria-label="도움말 닫기" autofocus>×</button></div><img src="' + NOTIFICATION_GUIDE_IMAGE_URL + '" alt="효니 방송 시작 알림 안내: 다른 스트리머 방송 시청 중 시작 알림을 받고, 방송보러가기로 이동할 수 있습니다. 설정에서 방송 시작 및 카테고리 변경 알림을 켜거나 끌 수 있습니다." loading="lazy"></div>' +
        (state.targetLiveNotificationsEnabled === false ? '<div class="cs-settings-row"><span class="cs-settings-label">관리자 설정에서 타스트리머 알림이 OFF입니다</span></div>' : "") +
        '<div class="cs-settings-row"><span class="cs-settings-label">방송 시작 알림</span><button type="button" class="cs-settings-switch' + (effectiveLiveStartNoticeEnabled() ? " cs-on" : "") + '" id="cs-live-start-notice-toggle" role="switch" aria-checked="' + String(effectiveLiveStartNoticeEnabled()) + '" aria-label="방송 시작 알림"' + (state.targetLiveNotificationsEnabled === false ? " disabled" : "") + '></button></div>' +
        '<div class="cs-settings-row"><span class="cs-settings-label">카테고리 변경 알림</span><button type="button" class="cs-settings-switch' + (effectiveCategoryChangeNoticeEnabled() ? " cs-on" : "") + '" id="cs-category-change-notice-toggle" role="switch" aria-checked="' + String(effectiveCategoryChangeNoticeEnabled()) + '" aria-label="카테고리 변경 알림"' + (state.targetLiveNotificationsEnabled === false ? " disabled" : "") + '></button></div>' +
        "</div>"
      : "";

    rememberRenderedFingerprint();


    root.innerHTML =
      scheduleToolbarHtml +
      settingsPanelHtml +
      (state.extensionCollapsed ? "" : updateNoticeHtml()) +
      '<div class="cs-wrapper">' +
      '<div class="cs-section cs-schedule-section' + (state.extensionCollapsed ? " cs-collapsed" : "") + '">' +
      (lolLogMode ? "" : '<div class="cs-header">' +
      '<span class="cs-title">방송 일정</span>' +
      schedulePillHtml +
      '<span class="cs-spacer"></span>' +
      (state.extensionCollapsed || lolLogMode ? "" : monthLabel +
        (state.monthExpanded ? '<button type="button" class="cs-view-toggle cs-game-toggle' + (state.gameOnly ? " cs-open" : "") + '" id="cs-game-toggle" aria-pressed="' + String(state.gameOnly) + '" aria-label="' + (state.gameOnly ? "전체 보기" : "간단히 보기") + '"><span class="cs-view-icon" aria-hidden="true"><img src="' + GAMEPAD_ICON_URL + '" alt="" /></span><span class="cs-view-tip">' + (state.gameOnly ? "전체 보기" : "간단히 보기") + "</span></button>" : "") +
        '<button class="cs-arrow" id="cs-prev"' + (canGoPrev ? "" : " disabled") + ">‹</button>" +
        '<button class="cs-arrow" id="cs-next"' + (canGoNext ? "" : " disabled") + ">›</button>") +
      "</div>") +
      '<div class="cs-schedule-body"' + (state.extensionCollapsed ? " hidden" : "") + '>' +
      (lolLogMode ? lolMatchLogHtml() : '<div class="' + gridClass + '" id="cs-grid">' + cellsHtml + "</div>" +
      gameSummary +
      '<div class="cs-popover" id="cs-popover">' +
      '<div class="cs-pop-arrow" id="cs-pop-arrow"></div>' +
      '<div id="cs-pop-body"></div>' +
      "</div>") +
      "</div>" +
      "</div>" +
      (state.extensionCollapsed ? "" : infoSectionHtml() +
      '<div class="cs-footer">' +
      '<div class="cs-notice">' +
            '<p class="cs-schedule-notice" title="◈ 오뱅알 일정은 최대한 확인 가능한 정보를 기준으로 정리되지만, 실제 내용과 다를 수 있습니다.">◈ 오뱅알 일정은 최대한 확인 가능한 정보를 기준으로 정리되지만, 실제 내용과 다를 수 있습니다.</p>' +
      '<p class="cs-schedule-notice" title="◈ 일정 제보·변경·누락·오류는 우측 [문의·제보]를 통해 접수해주세요.">◈ 일정 제보·변경·누락·오류는 우측 [문의·제보]를 통해 접수해주세요.</p>' +
      '<p class="cs-schedule-notice cs-install-notice" title="◈ 모바일 설치 방법은 OS별 버튼을 눌러 확인할 수 있습니다."><span class="cs-install-notice-text">◈ 모바일에서는 홈 화면에 추가해 앱처럼 사용할 수 있습니다.</span>' + installGuideTriggerHtml("Android", "android") + installGuideTriggerHtml("iOS", "ios") + '</p>' +
      '</div>' +
      '<div class="cs-footer-meta-frame">' +
      '<button type="button" class="cs-feedback-open' + (state.feedbackOpen ? " cs-open" : "") + '" id="cs-feedback-open" aria-expanded="' + String(state.feedbackOpen) + '">문의·제보</button>' +
      '<span class="cs-updated">' + updatedLabel + "</span>" +
      '<button class="cs-refresh" id="cs-refresh" title="새로고침">⟳</button>' +
      "</div>" +
      "</div>" +
      updateHistoryHtml() +
      feedbackPanelHtml()) +
      "</div>";

    bindEvents();
  }

  function timeIndicatorsHtml(entry, isPast) {
    if (!entry || (!entry.cafeTime && !entry.videoTime)) return "";
    let html = "";
    if (entry.cafeTime) html += '<span class="cs-cafe-time-indicator' + (isPast ? " cs-cafe-time-past" : "") + '"><img class="cs-cafe-time-icon" src="' + NAVER_CAFE_ICON_URL + '" alt="카페타임" /><span class="cs-cafe-time-tip">카페타임 있음</span></span>';
    if (entry.videoTime) html += '<span class="cs-video-time-indicator' + (isPast ? " cs-video-time-past" : "") + '"><img class="cs-video-time-icon" src="' + VIDEO_DONATION_ICON_URL + '" alt="영도타임" /><span class="cs-video-time-tip">영도타임 있음</span></span>';
    return '<span class="cs-time-indicators">' + html + "</span>";
  }

  function infoSectionTitle(text) {
    const match = String(text || "").trim().match(/^@section\s*:\s*([\s\S]+)$/i);
    return match ? match[1].trim() : "";
  }

  function structuredInfoDataFromText(text) {
    const raw = String(text || "").trim();
    if (!raw.startsWith(INFO_V2_PREFIX)) return null;
    try {
      const parsed = JSON.parse(raw.slice(INFO_V2_PREFIX.length));
      const items = Array.isArray(parsed.items) ? parsed.items.map((entry) => ({
        title: String((entry && entry.title) || ""),
        body: String((entry && entry.body) || ""),
        collapsed: entry && entry.collapsed !== false,
        hasBody: !entry || entry.hasBody !== false,
      })).filter((entry) => entry.title.trim() || (entry.hasBody && entry.body.trim())) : [];
      return { title: String((parsed && parsed.title) || ""), items };
    } catch (_e) {
      return null;
    }
  }

  function structuredInfoHtml(data, infoIndex) {
    if (!data || !data.items.length) return "";
    const title = String(data.title || "").trim();
    const groupTitle = title ? '<div class="cs-info-group-title">' + directiveHtml(title, { infoMode: true }) + '</div>' : "";
    const details = data.items.map((entry, subIndex) => {
      const key = infoIndex + "-" + subIndex;
      const hasBody = !entry || entry.hasBody !== false;
      const defaultExpanded = entry.collapsed === false;
      const expanded = hasBody && (state.infoExpanded.has(key) || (defaultExpanded && !state.infoExpanded.has("closed:" + key)));
      const body = String(entry.body || "").trim();
      const label = expanded ? "\u25b2" : "\u25bc";
      const titleHtml = directiveHtml(String(entry.title || "").trim() || "\uc138\ubd80 \uc18c\uc2dd", { infoMode: true });
      const toggleAttr = hasBody ? ' data-info-toggle="' + escapeHtml(key) + '" aria-expanded="' + String(expanded) + '" aria-label="' + (expanded ? "\uc811\uae30" : "\ud3bc\uce58\uae30") + '"' : "";
      const toggle = hasBody ? '<button type="button" class="cs-info-detail-toggle" data-info-toggle="' + escapeHtml(key) + '" aria-expanded="' + String(expanded) + '" aria-label="' + (expanded ? "\uc811\uae30" : "\ud3bc\uce58\uae30") + '">' + label + '</button>' : "";
      const bodyHtml = hasBody ? '<div class="cs-info-detail-body"' + (expanded ? "" : " hidden") + '>' + directiveHtml(body, { infoMode: true }) + '</div>' : "";
      return '<div class="cs-info-detail' + (hasBody ? "" : " cs-info-detail-title-only") + '" data-info-detail="' + escapeHtml(key) + '">' +
        '<div class="cs-info-detail-head"' + toggleAttr + '>' +
          '<span class="cs-info-detail-title">' + titleHtml + '</span>' +
          toggle +
        '</div>' +
        bodyHtml +
      '</div>';
    }).join("");
    return '<li class="cs-info-group">' + groupTitle + details + '</li>';
  }
  function infoSectionHtml() {
    const items = (state.channel && state.channel.info) || [];
    if (!items.length) return "";

    const itemsHtml = items
      .map((text, index) => {
        const structured = structuredInfoDataFromText(text);
        if (structured) return structuredInfoHtml(structured, index);
        const sectionTitle = infoSectionTitle(text);
        if (sectionTitle) {
          return '<li class="cs-info-subhead"><span class="cs-info-subhead-label">' + directiveHtml(sectionTitle, { infoMode: true }) + "</span></li>";
        }
        return '<li class="cs-info-item"><span class="cs-info-dot"></span>' +
          '<span class="cs-info-text">' + directiveHtml(text, { infoMode: true }) + "</span></li>";
      })
      .join("");

    return (
      '<div class="cs-section cs-info-section">' +
      '<div class="cs-info-layout">' +
      '<div class="cs-info-frame">' +
      '<div class="cs-info-title">소식 및 정보</div>' +
      '<ul class="cs-info-list">' + itemsHtml + "</ul>" +
      "</div>" +
      '<div class="cs-info-content-area">' +
      '<div class="cs-info-new-frame" role="button" tabindex="0" aria-label="그님티">' +
      '<img class="cs-info-new-icon" src="' + GNIMTI_ICON_IMAGE_URL + '" alt="" />' +
      "</div></div></div></div>"
    );
  }

  function compareVersions(a, b) {
    const left = String(a || "0").split(".").map((part) => parseInt(part, 10) || 0);
    const right = String(b || "0").split(".").map((part) => parseInt(part, 10) || 0);
    const len = Math.max(left.length, right.length);
    for (let i = 0; i < len; i++) {
      const diff = (left[i] || 0) - (right[i] || 0);
      if (diff) return diff > 0 ? 1 : -1;
    }
    return 0;
  }

  function shouldShowUpdateNotice() {
    const latest = state.data && state.data.latestExtensionVersion;
    const deployed = state.deployedExtensionVersion;
    return !!latest && !!deployed && compareVersions(latest, EXTENSION_VERSION) > 0 && compareVersions(latest, deployed) === 0;
  }

  function parseUpdateHistoryPayload(raw) {
    const payload = String(raw || "").trim();
    if (!payload) return [];
    try {
      const parsed = JSON.parse(payload);
      const title = String((parsed && parsed.title) || "").trim();
      const body = String((parsed && parsed.body) || "").trim();
      return title || body ? [{ label: title || "업데이트", body }] : [];
    } catch (_e) {}
    const items = [];
    for (let i = 0; i < payload.length; i++) {
      if (payload[i] !== ":") continue;
      const item = parseTextPopupDirectiveAt(payload, i);
      if (!item) continue;
      if (item.body) items.push({ label: item.label || "업데이트", body: item.body });
      i = item.end - 1;
    }
    if (items.length) return items;
    return [{ label: payload.split(/\r?\n/)[0] || "업데이트", body: payload }];
  }

  function updateHistoryItems() {
    return ((state.data && state.data.updateHistories) || [])
      .slice()
      .reverse()
      .flatMap(parseUpdateHistoryPayload)
      .filter((item) => item && String(item.body || "").trim());
  }

  function updateHistoryCardHtml(item) {
    const label = String((item && item.label) || "\uC5C5\uB370\uC774\uD2B8").trim() || "\uC5C5\uB370\uC774\uD2B8";
    const body = String((item && item.body) || "").trim();
    if (!body) return "";
    return '<button type="button" class="cs-update-history-card cs-inline-text-popup-trigger" data-text-popup-label="' + escapeHtml(label) + '" data-text-popup-body="' + escapeHtml(encodeURIComponent(body)) + '"><span class="cs-text-popup-label">' + directiveHtml(label, { disableProfileLinks: true }) + '</span></button>';
  }

  function updateHistoryHtml() {
    return "";
    const items = updateHistoryItems();
    if (!items.length) return "";
    const cards = items.map(updateHistoryCardHtml).filter(Boolean).join("");
    if (!cards) return "";
    const expanded = !!state.updateHistoryExpanded;
    const controls = expanded
      ? '<span class="cs-update-history-controls" aria-label="\uC5C5\uB370\uC774\uD2B8 \uB0B4\uC5ED \uC774\uB3D9">' +
        '<button type="button" class="cs-update-history-arrow" data-update-history-scroll="-1" aria-label="\uC774\uC804 \uC5C5\uB370\uC774\uD2B8">\u2039</button>' +
        '<button type="button" class="cs-update-history-arrow" data-update-history-scroll="1" aria-label="\uB2E4\uC74C \uC5C5\uB370\uC774\uD2B8">\u203A</button>' +
        '</span>'
      : "";
    const toggleLabel = expanded ? "\uC5C5\uB370\uC774\uD2B8 \uB0B4\uC5ED 접기" : "\uC5C5\uB370\uC774\uD2B8 \uB0B4\uC5ED 펼치기";
    return '<div class="cs-section cs-update-history-section' + (expanded ? "" : " cs-update-history-collapsed") + '" aria-label="\uC5C5\uB370\uC774\uD2B8 \uB0B4\uC5ED">' +
      '<div class="cs-update-history-head">' +
      '<span class="cs-update-history-title">\uC5C5\uB370\uC774\uD2B8 \uB0B4\uC5ED</span>' +
      controls +
      '<button type="button" class="cs-update-history-toggle" id="cs-update-history-toggle" aria-expanded="' + String(expanded) + '" aria-label="' + toggleLabel + '" title="' + toggleLabel + '">' +
      '<span class="cs-update-history-caret" aria-hidden="true">' + (expanded ? "\u25B2" : "\u25BC") + '</span>' +
      '</button></div>' +
      (expanded ? '<div class="cs-update-history-viewport" id="cs-update-history-viewport"><div class="cs-update-history-track" id="cs-update-history-track">' + cards + '</div></div>' : "") +
      '</div>';
  }

  function noticeItems() {
    const items = [];
    if (shouldShowUpdateNotice()) {
      items.push({ type: "update", text: "\uc0c8 \ubc84\uc804\uc774 \uc5c5\ub370\uc774\ud2b8\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \uc5c5\ub370\uc774\ud2b8 \ubc84\ud2bc\uc744 \ub20c\ub7ec\uc8fc\uc138\uc694." });
    }
    ((state.data && state.data.notices) || []).forEach((text) => {
      const value = String(text || "").trim();
      if (value) items.push({ type: "notice", text: value });
    });
    return items;
  }

  function updateNoticeHtml() {
    const items = noticeItems();
    if (!items.length) return "";
    const item = items[state.noticeIndex % items.length];
    const action = item.type === "update"
      ? '<button type="button" class="cs-update-refresh" id="cs-update-refresh">\uc5c5\ub370\uc774\ud2b8</button>'
      : "";
    const controls = items.length > 1
      ? '<span class="cs-update-notice-controls" aria-label="\uacf5\uc9c0 \uc774\ub3d9">' +
        '<button type="button" class="cs-update-notice-arrow" id="cs-notice-prev" aria-label="\uc774\uc804 \uacf5\uc9c0">\u2039</button>' +
        '<button type="button" class="cs-update-notice-arrow" id="cs-notice-next" aria-label="\ub2e4\uc74c \uacf5\uc9c0">\u203a</button>' +
        '</span>'
      : "";
    return '<div class="cs-update-notice-wrap"><div class="cs-update-notice" role="note">' +
      '<span class="cs-update-notice-badge">\uacf5\uc9c0</span>' +
      '<span class="cs-update-notice-text"><span class="cs-update-notice-strong">' + directiveHtml(item.text) + '</span></span>' +
      action +
      controls +
      '</div></div>';
  }

  function rotateNoticeIfNeeded() {
    const items = noticeItems();
    if (items.length < 2 || !state.shadow || document.visibilityState !== "visible") return;
    state.noticeIndex = (state.noticeIndex + 1) % items.length;
    render();
  }

  function feedbackPanelHtml() {
    const draft = state.feedbackDraft;
    const option = (value, label) => '<option value="' + value + '"' + (draft.type === value ? " selected" : "") + ">" + (label || value) + "</option>";
    return (
      '<div class="cs-feedback-panel' + (state.feedbackOpen ? " cs-open" : "") + '" id="cs-feedback-panel" role="dialog" aria-label="문의 및 제보">' +
      '<div class="cs-feedback-head"><span class="cs-feedback-title">문의 · 제보</span>' +
      '<button type="button" class="cs-feedback-close" id="cs-feedback-close" aria-label="닫기">×</button></div>' +
      '<label class="cs-feedback-label" for="cs-feedback-type">종류</label>' +
      '<select class="cs-feedback-select" id="cs-feedback-type">' +
      option("일정", "일정 (제보/수정/오류 등)") + option("건의") + option("버그 제보") + option("문의") + option("기타") + "</select>" +
      '<div class="cs-feedback-field-head"><label class="cs-feedback-label" for="cs-feedback-message">내용 (필수)</label><span class="cs-feedback-limit">최대 1000자</span></div>' +
      '<textarea class="cs-feedback-textarea" id="cs-feedback-message" maxlength="1000">' + escapeHtml(draft.message) + "</textarea>" +
      '<div class="cs-feedback-count' + (draft.message.length >= 900 ? " cs-near-limit" : "") + '" id="cs-feedback-count">' + draft.message.length + "/1000</div>" +
      '<div id="cs-feedback-link-field"' + (draft.type === "일정" ? "" : " hidden") + ">" +
      '<label class="cs-feedback-label" for="cs-feedback-link">관련 링크</label>' +
      '<p class="cs-feedback-notice">검증 가능한 링크가 없으면 일정 반영이 제한될 수 있습니다.</p>' +
      '<input class="cs-feedback-input" id="cs-feedback-link" type="url" inputmode="url" placeholder="https://" value="' + escapeHtml(draft.relatedLink) + '" /></div>' +
      '<button type="button" class="cs-feedback-contact-toggle' + (draft.contactOpen ? " cs-open" : "") + '" id="cs-feedback-contact-toggle" aria-expanded="' + String(!!draft.contactOpen) + '">' + (draft.contactOpen ? "회신 메일 입력 닫기" : "회신 받을 메일 추가") + "</button>" +
      '<div id="cs-feedback-contact-field"' + (draft.contactOpen ? "" : " hidden") + ">" +
      '<label class="cs-feedback-label" for="cs-feedback-contact">회신 받을 메일</label>' +
      '<input class="cs-feedback-input" id="cs-feedback-contact" type="email" inputmode="email" autocomplete="email" placeholder="name@example.com" value="' + escapeHtml(draft.contact) + '" /></div>' +
      '<div class="cs-feedback-actions"><span class="cs-feedback-status" id="cs-feedback-status" aria-live="polite"></span>' +
      '<button type="button" class="cs-feedback-submit" id="cs-feedback-submit"' + (draft.message.trim() ? "" : " disabled") + ">보내기</button></div>" +
      "</div>"
    );
  }

  function formatUpdated() {
    const src = (state.data && state.data.updatedAt) || state.fetchedAt;
    if (!src) return "";
    const d = new Date(src);
    if (isNaN(d.getTime())) return "";
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return "업데이트 " + mm + "." + dd + " " + hh + ":" + mi;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function plainDirectiveHtml(value) {
    return String(value || "").split("[문의]").map((part, index, list) =>
      styledTextHtml(part) + (index < list.length - 1
        ? '<button type="button" class="cs-inline-feedback-trigger">문의·제보</button>'
        : "")
    ).join("");
  }

  function styledLineHtml(text) {
    return escapeHtml(text).replace(/\r?\n/g, "<br>");
  }

  function styledTextHtml(value) {
    const specs = [
      { marker: "**", open: '<strong class="cs-text-bold">', close: "</strong>" },
      { marker: "__", open: '<span class="cs-text-underline">', close: "</span>" },
      { marker: "~~", open: '<span class="cs-text-strike">', close: "</span>" },
      { marker: "*", open: '<em class="cs-text-italic">', close: "</em>" },
    ];
    const render = (text) => {
      let best = null;
      for (const spec of specs) {
        let from = 0;
        while (from < text.length) {
          const start = text.indexOf(spec.marker, from);
          if (start < 0) break;
          if (spec.marker === "*" && text[start + 1] === "*") { from = start + 2; continue; }
          const innerStart = start + spec.marker.length;
          const end = text.indexOf(spec.marker, innerStart);
          if (end >= 0 && end > innerStart) {
            if (!best || start < best.start || (start === best.start && spec.marker.length > best.spec.marker.length)) {
              best = { spec, start, end };
            }
            break;
          }
          from = innerStart;
        }
      }
      if (!best) return styledLineHtml(text);
      return styledLineHtml(text.slice(0, best.start)) +
        best.spec.open + render(text.slice(best.start + best.spec.marker.length, best.end)) + best.spec.close +
        render(text.slice(best.end + best.spec.marker.length));
    };
    return render(String(value || ""));
  }
  function plainDirectiveSegmentHtml(text) {
    const raw = String(text || "");
    if (!raw) return "";
    if (/^[ \t\r\n]+$/.test(raw)) {
      return escapeHtml(raw).replace(/ /g, "&nbsp;").replace(/\t/g, "&nbsp;&nbsp;").replace(/\r?\n/g, "<br>");
    }
    return plainDirectiveHtml(raw);
  }
  function mediaTriggerHtml(label, url, options) {
    const safeUrl = safeMediaUrl(url);
    const safeLabel = label || "media";
    const infoMode = !!(options && options.infoMode);
    if (!safeUrl) return directiveHtml(safeLabel, { disableProfileLinks: true, infoMode });
    const cls = "cs-inline-media-trigger" + (infoMode ? " cs-info-media-trigger" : "");
    return '<button type="button" class="' + cls + '" data-media-label="' + escapeHtml(safeLabel) + '" data-media-url="' + escapeHtml(safeUrl) + '"><span class="cs-inline-media-label">' + directiveHtml(safeLabel, { disableProfileLinks: true, infoMode }) + "</span></button>";
  }
  function textPopupTriggerHtml(label, body, options) {
    const safeLabel = String(label || "\uD14D\uC2A4\uD2B8").trim() || "\uD14D\uC2A4\uD2B8";
    const safeBody = String(body || "").trim();
    const infoMode = !!(options && options.infoMode);
    if (!safeBody) return directiveHtml(safeLabel, { disableProfileLinks: true, infoMode });
    const cls = "cs-inline-text-popup-trigger" + (infoMode ? " cs-info-text-popup-trigger" : "");
    return '<button type="button" class="' + cls + '" data-text-popup-label="' + escapeHtml(safeLabel) + '" data-text-popup-body="' + escapeHtml(encodeURIComponent(safeBody)) + '"><span class="cs-text-popup-label">' + directiveHtml(safeLabel, { disableProfileLinks: true, infoMode }) + "</span></button>";
  }
  function installGuideTriggerHtml(label, platform) {
    const safeLabel = String(label || "모바일 설치 방법").trim() || "모바일 설치 방법";
    const safePlatform = String(platform || "").trim().toLowerCase();
    const platformAttr = safePlatform ? ' data-install-platform="' + escapeHtml(safePlatform) + '"' : "";
    return '<button type="button" class="cs-install-guide-trigger" data-install-guide="1" data-install-label="' + escapeHtml(safeLabel) + '"' + platformAttr + '><span class="cs-install-guide-label">' + directiveHtml(safeLabel, { disableProfileLinks: true }) + '</span></button>';
  }

  function parseInstallDirectiveAt(raw, start) {
    if (raw.slice(start, start + 9).toLowerCase() !== ":install[") return null;
    const close = findDirectiveBracketEnd(raw, start + 8);
    if (close < 0) return null;
    return {
      label: raw.slice(start + 9, close).trim() || "모바일 설치 방법",
      end: close + 1,
    };
  }
  function safeMediaUrl(value) {
    try {
      const parsed = new URL(String(value || "").trim());
      if (parsed.protocol !== "https:") return "";
      return parsed.href;
    } catch (_e) {
      return "";
    }
  }


  function parseMediaDirectiveAt(raw, start) {
    if (raw.slice(start, start + 3).toLowerCase() !== ":m[") return null;
    const close = findDirectiveBracketEnd(raw, start + 2);
    if (close < 0) return null;
    const body = raw.slice(start + 3, close);
    const braceClose = body.lastIndexOf("}");
    const braceOpen = braceClose >= 0 ? body.lastIndexOf("{", braceClose) : -1;
    if (braceOpen < 0 || braceClose !== body.length - 1) return null;
    return {
      label: body.slice(0, braceOpen).trim(),
      url: body.slice(braceOpen + 1, braceClose).trim(),
      end: close + 1,
    };
  }

  function parseTextPopupDirectiveAt(raw, start) {
    if (raw.slice(start, start + 3).toLowerCase() !== ":p[") return null;
    const labelStart = start + 3;
    const braceOpen = raw.indexOf("{", labelStart);
    if (braceOpen < 0) return null;
    const close = raw.indexOf("}]", braceOpen + 1);
    if (close < 0) return null;
    return {
      label: raw.slice(labelStart, braceOpen).trim(),
      body: raw.slice(braceOpen + 1, close).trim(),
      end: close + 2,
    };
  }

  function findDirectiveBracketEnd(raw, openIndex) {
    let depth = 1;
    for (let i = openIndex + 1; i < raw.length; i++) {
      if (raw[i] === "[") depth += 1;
      else if (raw[i] === "]") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function tagToneStyleAttr(tag) {
    const text = String(tag || "").trim();
    if (!text) return "";
    const fixed = {
      "언급": [44, 232, 184, 104, 154, 107, 0],
      "합방": [205, 125, 211, 252, 3, 105, 161],
      "공방": [210, 147, 197, 253, 37, 99, 235],
      "타방송": [252, 216, 180, 254, 109, 40, 217],
      "광고": [14, 251, 146, 60, 194, 65, 12],
      "야방": [27, 251, 146, 60, 194, 93, 22],
    };
    const tone = fixed[text];
    if (tone) {
      const [hue, dr, dg, db, lr, lg, lb] = tone;
      return ' style="--cs-tag-color: rgb(' + dr + ' ' + dg + ' ' + db + '); --cs-tag-bg: hsl(' + hue + ' 88% 60% / 0.16); --cs-tag-border: hsl(' + hue + ' 88% 68% / 0.32); --cs-tag-light-color: rgb(' + lr + ' ' + lg + ' ' + lb + '); --cs-tag-light-bg: hsl(' + hue + ' 85% 50% / 0.13); --cs-tag-light-border: hsl(' + hue + ' 72% 42% / 0.24);"';
    }
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    const hue = Math.abs(hash) % 360;
    return ' style="--cs-tag-color: hsl(' + hue + ' 88% 76%); --cs-tag-bg: hsl(' + hue + ' 88% 60% / 0.16); --cs-tag-border: hsl(' + hue + ' 88% 68% / 0.32); --cs-tag-light-color: hsl(' + hue + ' 72% 32%); --cs-tag-light-bg: hsl(' + hue + ' 85% 50% / 0.13); --cs-tag-light-border: hsl(' + hue + ' 72% 42% / 0.24);"';
  }

  function firstPartTag(p) {
    if (!p) return "";
    if (p.speculative) return "언급";
    const flags = partFlagLabels(p);
    return flags.length ? flags[0] : "";
  }

  function parseNewTagText(text) {
    const value = String(text || "").trim();
    const match = value.match(/^new(?:@(\d+))?$/i);
    if (!match) return null;
    const createdAt = match[1] ? Number(match[1]) : 0;
    return { createdAt: Number.isFinite(createdAt) ? createdAt : 0 };
  }

  function shouldRenderNewTag(text) {
    const parsed = parseNewTagText(text);
    if (!parsed) return false;
    if (!parsed.createdAt) return true;
    return Date.now() - parsed.createdAt < NEW_TAG_MAX_AGE_MS;
  }

  function renderDirectiveToken(kind, text, profiles, options) {
    const newTag = kind === "t" ? parseNewTagText(text) : null;
    if (newTag) {
      return shouldRenderNewTag(text) ? '<span class="cs-new-tag" aria-label="새 업데이트">NEW</span>' : "";
    }
    const profile = profiles[text] || { channelId: "", channelName: text, channelImageUrl: "" };
    if (options && options.infoMode) {
      if (kind === "t") return '<span class="cs-info-tag">' + styledTextHtml(text) + "</span>";
      return infoProfileTextHtml(profile, options && options.disableProfileLinks);
    }
    if (kind === "t") {
      const toneClass = options && options.tagTone ? " cs-tag-tone" : "";
      const toneAttr = options && options.tagTone ? tagToneStyleAttr(text) : "";
      return '<span class="cs-text-badge' + toneClass + '"' + toneAttr + '>' + directiveHtml(text, options) + "</span>";
    }
    return '<span class="cs-inline-profile">' + channelAvatarLinkHtml(profile, options && options.disableProfileLinks) + "</span>";
  }  function directiveHtml(value, options) {
    const raw = String(value || "");
    const profiles = (state.data && state.data.directiveProfiles) || {};
    const trimmed = raw.trim();
    const wholeMedia = parseMediaDirectiveAt(trimmed, 0);
    if (wholeMedia && wholeMedia.end === trimmed.length) return mediaTriggerHtml(wholeMedia.label, wholeMedia.url, options);
    const wholeTextPopup = parseTextPopupDirectiveAt(trimmed, 0);
    if (wholeTextPopup && wholeTextPopup.end === trimmed.length) return textPopupTriggerHtml(wholeTextPopup.label, wholeTextPopup.body, options);
    const wholeInstall = parseInstallDirectiveAt(trimmed, 0);
    if (wholeInstall && wholeInstall.end === trimmed.length) return installGuideTriggerHtml(wholeInstall.label);
    const wholeBracket = trimmed.match(/^:(s|t)\[/i);
    if (wholeBracket) {
      const end = findDirectiveBracketEnd(trimmed, 2);
      if (end === trimmed.length - 1) {
        return renderDirectiveToken(wholeBracket[1].toLowerCase(), trimmed.slice(3, end).trim(), profiles, options);
      }
    }
    const wholeSpace = trimmed.match(/^:(s|t)\s+(.+)$/i);
    if (wholeSpace) return renderDirectiveToken(wholeSpace[1].toLowerCase(), wholeSpace[2].trim(), profiles, options);

    let html = "";
    let plainStart = 0;
    let i = 0;
    const flushPlain = (end) => {
      if (end > plainStart) html += plainDirectiveSegmentHtml(raw.slice(plainStart, end));
    };
    while (i < raw.length) {
      const install = parseInstallDirectiveAt(raw, i);
      if (install) {
        flushPlain(i);
        html += installGuideTriggerHtml(install.label);
        i = install.end;
        plainStart = i;
        continue;
      }
      const textPopup = parseTextPopupDirectiveAt(raw, i);
      if (textPopup) {
        flushPlain(i);
        html += textPopupTriggerHtml(textPopup.label, textPopup.body, options);
        i = textPopup.end;
        plainStart = i;
        continue;
      }
      const media = parseMediaDirectiveAt(raw, i);
      if (media) {
        flushPlain(i);
        html += mediaTriggerHtml(media.label, media.url, options);
        i = media.end;
        plainStart = i;
        continue;
      }
      if (raw.slice(i, i + 3).toLowerCase() === ":p[") {
        const braceOpen = raw.indexOf("{", i + 3);
        const close = braceOpen >= 0 ? raw.indexOf("}]", braceOpen + 1) : -1;
        if (braceOpen > i && close > braceOpen) {
          const label = raw.slice(i + 3, braceOpen).trim();
          flushPlain(i);
          if (label) html += directiveHtml(label, options);
          i = close + 2;
          plainStart = i;
          continue;
        }
      }
      if (raw.slice(i, i + 3).toLowerCase() === ":m[") {
        const end = findDirectiveBracketEnd(raw, i + 2);
        if (end > i) {
          const body = raw.slice(i + 3, end);
          const braceOpen = body.lastIndexOf("{");
          const label = (braceOpen >= 0 ? body.slice(0, braceOpen) : body).trim();
          flushPlain(i);
          if (label) html += directiveHtml(label, options);
          i = end + 1;
          plainStart = i;
          continue;
        }
      }
      const bracket = raw.slice(i).match(/^:(s|t)\[/i);
      if (bracket) {
        const end = findDirectiveBracketEnd(raw, i + 2);
        if (end > i) {
          flushPlain(i);
          html += renderDirectiveToken(bracket[1].toLowerCase(), raw.slice(i + 3, end).trim(), profiles, options);
          i = end + 1;
          plainStart = i;
          continue;
        }
      }
      const inline = raw.slice(i).match(/^:(s|t)\s+([^\s:]+)/i);
      if (inline) {
        flushPlain(i);
        html += renderDirectiveToken(inline[1].toLowerCase(), inline[2].trim(), profiles, options);
        i += inline[0].length;
        plainStart = i;
        continue;
      }
      i += 1;
    }
    flushPlain(raw.length);
    return html;
  }
  // 프로필 사진이 없는 멤버(스트리머가 아닌 사람)는 이니셜 원형으로 대체 표시
  function memberAvatarImgHtml(m) {
    if (m.channelImageUrl) {
      return '<span class="cs-member-avatar-img"><img src="' + escapeHtml(m.channelImageUrl) + '" alt="" /></span>';
    }
    const initial = (m.channelName || "?").trim().charAt(0) || "?";
    return '<span class="cs-member-avatar-img cs-member-avatar-fallback">' + escapeHtml(initial) + "</span>";
  }

  // 합방 멤버 / 공방·타방송 진행 채널 공용 아바타. 실제 치지직 채널(channelId 있음)이면
  // 그 방송으로 이동하는 링크를 걸고, 아니면(직접 추가한 비스트리머) 그냥 표시만 한다.

  function isRealChzzkChannelRef(c) {
    const id = String((c && c.channelId) || "").trim();
    return /^[0-9a-f]{32}$/i.test(id);
  }

  function channelDisplayName(c) {
    return String((c && c.channelName) || "").trim() || "이름 없음";
  }

  function infoProfileTextHtml(c, disableLink) {
    if (!c) return "";
    const name = channelDisplayName(c);
    if (!disableLink && isRealChzzkChannelRef(c)) {
      const url = "https://chzzk.naver.com/" + encodeURIComponent(c.channelId);
      return '<a class="cs-info-mention" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(name) + "</a>";
    }
    return '<span class="cs-info-mention">' + escapeHtml(name) + "</span>";
  }
  function channelAvatarLinkHtml(c, disableLink) {
    if (!c) return "";
    const tip = '<span class="cs-member-tip">' + escapeHtml(channelDisplayName(c)) + "</span>";
    if (!disableLink && isRealChzzkChannelRef(c)) {
      const url = "https://chzzk.naver.com/" + encodeURIComponent(c.channelId);
      return '<a class="cs-member-avatar" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' +
        memberAvatarImgHtml(c) + tip + "</a>";
    }
    return '<span class="cs-member-avatar">' + memberAvatarImgHtml(c) + tip + "</span>";
  }


  // 칸 본문: 부별 컨텐츠(entry.parts)가 있으면 부마다 한 줄, 없으면 기존 짧은명/제목 한 줄
  // 합방 멤버는 그리드에는 노출하지 않고 팝오버에서만 보여준다.
  // 부에 붙는 특수 표시(합방/공방/타방송/광고/야방). 여러 개가 동시에 켜져 있을 수 있음.
  function partFlagLabels(p) {
    const labels = [];
    if (p.collab) labels.push("합방");
    if (p.official) labels.push("공방");
    if (p.otherChannel) labels.push("타방송");
    if (p.ad) labels.push("광고");
    if (p.outdoor) labels.push("야방");
    return labels;
  }

  function partDisplayLabel(p, index) {
    const flags = partFlagLabels(p);
    if (p.speculative) return ["언급"].concat(flags).join("/");
    if (p.hidePartLabel) return flags.join("/");
    const baseLabel = p.label || (index + 1) + "부";
    return flags.length ? baseLabel + "/" + flags.join("/") : baseLabel;
  }

  function isSpecialPart(p) {
    return !!(p.collab || p.official || p.otherChannel || p.ad || p.outdoor || p.speculative);
  }

  function cellContentHtml(entry) {
    if (entry.parts && entry.parts.length) {
      return entry.parts
        .map((p, idx) => {
          const tagClass = p.speculative ? "cs-part-tag cs-part-tag-speculative" :
            p.official && !p.collab ? "cs-part-tag cs-part-tag-official" :
            isSpecialPart(p) ? "cs-part-tag cs-part-tag-collab" : "cs-part-tag";
          const tagLabel = partDisplayLabel(p, idx);
          const firstTag = firstPartTag(p);
          const tagToneClass = firstTag ? " cs-tag-tone" : "";
          const tagToneAttr = firstTag ? tagToneStyleAttr(firstTag) : "";
          let display = '<span class="cs-part-text">' + directiveHtml(p.content) + "</span>";
          if (p.displayType === "tag") display = '<span class="cs-text-badge">' + directiveHtml(p.content) + "</span>";
          if (p.displayType === "profile" && p.profile) {
            display = '<span class="cs-inline-profile">' + channelAvatarLinkHtml(p.profile) + "</span>";
          }
          const tagHtml = tagLabel ? '<span class="' + tagClass + tagToneClass + '"' + tagToneAttr + '>' + escapeHtml(tagLabel) + "</span>" : "";
          const memoDot = partNotes(p).length ? '<span class="cs-part-memo-icon" title="메모 있음" aria-label="메모 있음">✎</span>' : "";
          return '<div class="cs-cell-part">' + tagHtml + display + memoDot + "</div>";
        })
        .join("");
    }
    return '<div class="cs-cell-title">' + directiveHtml(entry.titleShort || entry.title || "") + "</div>";
  }

  // ----------------------------------------------------------
  // 이벤트 (화살표 / 새로고침 / 팝오버 호버)
  // ----------------------------------------------------------
  function bindEvents() {
    const s = state.shadow;
    const root = s.getElementById("cs-root");
    const prev = s.getElementById("cs-prev");
    const next = s.getElementById("cs-next");
    const refresh = s.getElementById("cs-refresh");
    const updateRefresh = s.getElementById("cs-update-refresh");
    const noticePrev = s.getElementById("cs-notice-prev");
    const noticeNext = s.getElementById("cs-notice-next");
    const updateHistoryViewport = s.getElementById("cs-update-history-viewport");
    const updateHistoryToggle = s.getElementById("cs-update-history-toggle");
    const monthToggle = s.getElementById("cs-month-toggle");
    const lolLogToggle = s.getElementById("cs-lol-log-toggle");
    const extensionCollapse = s.getElementById("cs-extension-collapse");
    const settingsToggle = s.getElementById("cs-settings-toggle");
    const settingsPanel = s.getElementById("cs-settings-panel");
    const liveStartNoticeToggle = s.getElementById("cs-live-start-notice-toggle");
    const categoryChangeNoticeToggle = s.getElementById("cs-category-change-notice-toggle");
    const gameToggle = s.getElementById("cs-game-toggle");
    const grid = s.getElementById("cs-grid");
    const popover = s.getElementById("cs-popover");
    const feedbackOpen = s.getElementById("cs-feedback-open");
    const feedbackPanel = s.getElementById("cs-feedback-panel");
    const feedbackClose = s.getElementById("cs-feedback-close");
    const feedbackType = s.getElementById("cs-feedback-type");
    const feedbackMessage = s.getElementById("cs-feedback-message");
    const feedbackLinkField = s.getElementById("cs-feedback-link-field");
    const feedbackLink = s.getElementById("cs-feedback-link");
    const feedbackContactToggle = s.getElementById("cs-feedback-contact-toggle");
    const feedbackContactField = s.getElementById("cs-feedback-contact-field");
    const feedbackContact = s.getElementById("cs-feedback-contact");
    const feedbackStatus = s.getElementById("cs-feedback-status");
    const feedbackCount = s.getElementById("cs-feedback-count");
    const feedbackSubmit = s.getElementById("cs-feedback-submit");

    if (prev) prev.addEventListener("click", () => {
      if (state.monthExpanded) {
        state.monthOffset -= 1;
        state.selectedGame = "";
        state.gameRankTranslate = 0;
      } else {
        state.pageOffset -= 1;
      }
      render();
    });
    if (next) next.addEventListener("click", () => {
      if (state.monthExpanded) {
        state.monthOffset += 1;
        state.selectedGame = "";
        state.gameRankTranslate = 0;
      } else {
        state.pageOffset += 1;
      }
      render();
    });
    if (monthToggle) monthToggle.addEventListener("click", () => { closePopover(); state.monthExpanded = !state.monthExpanded; if (!state.monthExpanded) { state.gameOnly = false; state.selectedGame = ""; state.gameRankTranslate = 0; } render(); });
    if (lolLogToggle) lolLogToggle.addEventListener("click", () => {
      closePopover();
      state.settingsOpen = false;
      state.scheduleViewMode = state.scheduleViewMode === "lolMatchLogs" ? "schedule" : "lolMatchLogs";
      render();
    });
    if (extensionCollapse) extensionCollapse.addEventListener("click", () => {
      closePopover();
      state.settingsOpen = false;
      state.extensionCollapsed = !state.extensionCollapsed;
      saveExtensionCollapsed(state.extensionCollapsed);
      render();
    });
    if (settingsToggle) settingsToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      closePopover();
      state.settingsOpen = !state.settingsOpen;
      render();
    });
    if (settingsPanel) settingsPanel.addEventListener("click", (event) => event.stopPropagation());
    if (liveStartNoticeToggle) liveStartNoticeToggle.addEventListener("click", () => {
      state.liveStartNoticeEnabled = !state.liveStartNoticeEnabled;
      saveNotificationSetting(LIVE_START_NOTICE_KEY, state.liveStartNoticeEnabled);
      render();
    });
    if (categoryChangeNoticeToggle) categoryChangeNoticeToggle.addEventListener("click", () => {
      state.categoryChangeNoticeEnabled = !state.categoryChangeNoticeEnabled;
      saveNotificationSetting(CATEGORY_CHANGE_NOTICE_KEY, state.categoryChangeNoticeEnabled);
      render();
    });
    if (gameToggle) gameToggle.addEventListener("click", () => {
      closePopover();
      state.gameOnly = !state.gameOnly;
      if (!state.gameOnly) {
        state.selectedGame = "";
        state.gameRankTranslate = 0;
      }
      render();
    });
    const gameRankSwiper = s.querySelector('[data-game-rank-swiper="1"]');
    const SwiperCtor = typeof Swiper === "function" ? Swiper : (typeof window !== "undefined" && typeof window.Swiper === "function" ? window.Swiper : null);
    if (gameRankSwiper && SwiperCtor) {
      const gameRankInstance = new SwiperCtor(gameRankSwiper, {
        slidesPerView: "auto",
        spaceBetween: 6,
        freeMode: {
          enabled: true,
          momentum: true,
          momentumRatio: 1,
          momentumVelocityRatio: 1,
          momentumBounce: false,
          sticky: false,
          minimumVelocity: 0.01,
        },
        grabCursor: true,
        watchOverflow: true,
        resistanceRatio: 0,
        threshold: 0,
        touchRatio: 1,
        longSwipes: false,
        normalizeSlideIndex: false,
        roundLengths: false,
        speed: 220,
        preventClicks: true,
        preventClicksPropagation: true,
        touchStartPreventDefault: false,
        on: {
          sliderFirstMove: () => { gameRankSwiper.dataset.swiping = "1"; },
          setTranslate: (swiper, translate) => {
            if (Number.isFinite(translate)) state.gameRankTranslate = translate;
          },
          touchEnd: (swiper) => {
            if (swiper && Number.isFinite(swiper.translate)) state.gameRankTranslate = swiper.translate;
            if (gameRankSwiper.dataset.swiping === "1") {
              gameRankSwiper.dataset.suppressClick = "1";
              setTimeout(() => { delete gameRankSwiper.dataset.suppressClick; delete gameRankSwiper.dataset.swiping; }, 180);
            }
          },
        },
      });
      if (Number.isFinite(state.gameRankTranslate) && state.gameRankTranslate) {
        requestAnimationFrame(() => {
          if (!gameRankInstance || typeof gameRankInstance.setTranslate !== "function") return;
          const minTranslate = typeof gameRankInstance.maxTranslate === "function" ? gameRankInstance.maxTranslate() : state.gameRankTranslate;
          const maxTranslate = typeof gameRankInstance.minTranslate === "function" ? gameRankInstance.minTranslate() : 0;
          const translate = Math.max(minTranslate, Math.min(maxTranslate, state.gameRankTranslate));
          gameRankInstance.setTranslate(translate);
          if (typeof gameRankInstance.updateProgress === "function") gameRankInstance.updateProgress(translate);
          if (typeof gameRankInstance.updateActiveIndex === "function") gameRankInstance.updateActiveIndex();
          if (typeof gameRankInstance.updateSlidesClasses === "function") gameRankInstance.updateSlidesClasses();
        });
      }
      gameRankSwiper.addEventListener("click", (event) => {
        if (gameRankSwiper.dataset.suppressClick !== "1") return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }
    s.querySelectorAll("[data-game-filter]").forEach((el) => {
      el.addEventListener("click", (event) => {
        const swiperRoot = el.closest('[data-game-rank-swiper="1"]');
        if (swiperRoot && swiperRoot.dataset.suppressClick === "1") {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (swiperRoot && swiperRoot.swiper && Number.isFinite(swiperRoot.swiper.translate)) {
          state.gameRankTranslate = swiperRoot.swiper.translate;
        }
        const label = el.getAttribute("data-game-filter") || "";
        state.selectedGame = state.selectedGame === label ? "" : label;
        closePopover();
        render();
      });
    });
    if (refresh) refresh.addEventListener("click", async () => {
      refresh.textContent = "...";
      await refreshData(true);
      render();
    });
    if (updateRefresh) updateRefresh.addEventListener("click", handleUpdate);
    if (noticePrev) noticePrev.addEventListener("click", () => {
      const items = noticeItems();
      if (items.length < 2) return;
      state.noticeIndex = (state.noticeIndex - 1 + items.length) % items.length;
      render();
    });
    if (noticeNext) noticeNext.addEventListener("click", () => {
      const items = noticeItems();
      if (items.length < 2) return;
      state.noticeIndex = (state.noticeIndex + 1) % items.length;
      render();
    });
    if (updateHistoryToggle) updateHistoryToggle.addEventListener("click", () => {
      state.updateHistoryExpanded = !state.updateHistoryExpanded;
      closeMediaPopover();
      render();
    });
    s.querySelectorAll("[data-update-history-scroll]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!updateHistoryViewport) return;
        const dir = Number(button.getAttribute("data-update-history-scroll") || 1) || 1;
        const amount = Math.max(150, Math.floor(updateHistoryViewport.clientWidth * 0.78));
        updateHistoryViewport.scrollBy({ left: dir * amount, behavior: "smooth" });
      });
    });

    if (grid) {
      grid.addEventListener("mouseover", (ev) => {
        const cell = ev.target.closest ? ev.target.closest("[data-hoverable]") : null;
        if (!cell || !grid.contains(cell)) return;
        if (cell.contains(ev.relatedTarget)) return;
        scheduleOpenPopover(cell, { pinned: false });
      });
      grid.addEventListener("mouseout", (ev) => {
        const cell = ev.target.closest ? ev.target.closest("[data-hoverable]") : null;
        if (!cell || !grid.contains(cell)) return;
        if (cell.contains(ev.relatedTarget)) return;
        scheduleClosePopover();
      });
      grid.addEventListener("click", (ev) => {
        const cell = ev.target.closest ? ev.target.closest("[data-hoverable]") : null;
        if (!cell || !grid.contains(cell)) return;
        ev.preventDefault();
        ev.stopPropagation();
        scheduleOpenPopover(cell, { pinned: true });
      });
      grid.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " " && ev.code !== "Space" && ev.code !== "Spacebar") return;
        const cell = ev.target.closest ? ev.target.closest("[data-hoverable]") : null;
        if (!cell || !grid.contains(cell)) return;
        ev.preventDefault();
        ev.stopPropagation();
        scheduleOpenPopover(cell, { pinned: true });
      });
    }

    if (popover) {
      popover.addEventListener("mouseenter", () => {
        if (state.popoverCloseTimer) clearTimeout(state.popoverCloseTimer);
      });
      popover.addEventListener("mouseleave", scheduleClosePopover);
    }

    if (!state.scheduleOutsideHandler) {
      state.scheduleOutsideHandler = (event) => {
        if (!state.host || !state.shadow) return;
        const path = event.composedPath ? event.composedPath() : [];
        if (path.includes(state.host)) return;
        closePopover();
      };
      document.addEventListener("mousedown", state.scheduleOutsideHandler);
    }
    const setFeedbackOpen = (open) => {
      state.feedbackOpen = open;
      if (open) closePopover();
      if (feedbackPanel) feedbackPanel.classList.toggle("cs-open", open);
      if (feedbackOpen) {
        feedbackOpen.classList.toggle("cs-open", open);
        feedbackOpen.setAttribute("aria-expanded", String(open));
      }
      if (open && feedbackMessage) setTimeout(() => feedbackMessage.focus(), 0);
    };
    if (root) root.onclick = (event) => {
      const infoToggle = event.target.closest && event.target.closest("[data-info-toggle]");
      const infoInlineAction = event.target.closest && event.target.closest(".cs-inline-media-trigger, .cs-inline-text-popup-trigger, .cs-install-guide-trigger, a");
      if (infoToggle && !infoInlineAction) {
        event.preventDefault();
        event.stopPropagation();
        const key = infoToggle.getAttribute("data-info-toggle") || "";
        if (!key) return;
        const expandedNow = infoToggle.getAttribute("aria-expanded") === "true";
        if (expandedNow) {
          state.infoExpanded.delete(key);
          state.infoExpanded.add("closed:" + key);
        } else {
          state.infoExpanded.add(key);
          state.infoExpanded.delete("closed:" + key);
        }
        render();
        return;
      }
      const mediaImage = event.target.closest && event.target.closest(".cs-media-expandable");
      if (mediaImage) {
        event.preventDefault();
        event.stopPropagation();
        showOriginalImage(mediaImage);
        return;
      }
      const installTrigger = event.target.closest && event.target.closest(".cs-install-guide-trigger");
      if (installTrigger) {
        event.preventDefault();
        event.stopPropagation();
        if (installTrigger.classList.contains("cs-open")) closeMediaPopover();
        else showInstallGuidePopover(installTrigger);
        return;
      }
      const textPopupTrigger = event.target.closest && event.target.closest(".cs-inline-text-popup-trigger");
      if (textPopupTrigger) {
        event.preventDefault();
        event.stopPropagation();
        if (textPopupTrigger.classList.contains("cs-open")) closeMediaPopover();
        else showTextPopupPopover(textPopupTrigger);
        return;
      }
      const mediaTrigger = event.target.closest && event.target.closest(".cs-inline-media-trigger");
      if (mediaTrigger) {
        event.preventDefault();
        event.stopPropagation();
        if (mediaTrigger.classList.contains("cs-open")) closeMediaPopover();
        else showMediaPopover(mediaTrigger);
        return;
      }
      if (!(event.target.closest && (event.target.closest("[data-hoverable]") || event.target.closest("#cs-popover")))) closePopover();
      if (!(event.target.closest && event.target.closest(".cs-media-popover"))) closeMediaPopover();
    };
    const gnimtiFrame = s.querySelector(".cs-info-new-frame");
    if (gnimtiFrame) {
      gnimtiFrame.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showGnimtiPopup();
      });
      gnimtiFrame.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " " && event.code !== "Space" && event.code !== "Spacebar") return;
        event.preventDefault();
        showGnimtiPopup();
      });
    }
    if (feedbackOpen) feedbackOpen.addEventListener("click", () => setFeedbackOpen(!state.feedbackOpen));
    s.querySelectorAll(".cs-inline-feedback-trigger").forEach((trigger) => {
      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setFeedbackOpen(!state.feedbackOpen);
      });
    });
    if (popover) popover.addEventListener("click", (event) => {
      const trigger = event.target.closest && event.target.closest(".cs-inline-feedback-trigger");
      if (!trigger) return;
      event.preventDefault();
      event.stopPropagation();
      setFeedbackOpen(!state.feedbackOpen);
    });
    if (feedbackClose) feedbackClose.addEventListener("click", () => setFeedbackOpen(false));
    if (feedbackPanel) feedbackPanel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); setFeedbackOpen(false); if (feedbackOpen) feedbackOpen.focus(); return; }
      if (event.key === " " || event.code === "Space" || event.code === "Spacebar") {
        event.stopPropagation();
      }
    });
    if (feedbackType) feedbackType.addEventListener("change", () => {
      state.feedbackDraft.type = feedbackType.value;
      const scheduleType = feedbackType.value === "일정";
      if (feedbackLinkField) feedbackLinkField.hidden = !scheduleType;
      if (!scheduleType) {
        state.feedbackDraft.relatedLink = "";
        if (feedbackLink) feedbackLink.value = "";
      }
    });
    if (feedbackMessage) feedbackMessage.addEventListener("input", () => {
      state.feedbackDraft.message = feedbackMessage.value;
      if (feedbackCount) {
        feedbackCount.textContent = feedbackMessage.value.length + "/1000";
        feedbackCount.classList.toggle("cs-near-limit", feedbackMessage.value.length >= 900);
      }
      if (feedbackSubmit) feedbackSubmit.disabled = !feedbackMessage.value.trim();
    });
    if (feedbackLink) feedbackLink.addEventListener("input", () => { state.feedbackDraft.relatedLink = feedbackLink.value; });
    if (feedbackContactToggle) feedbackContactToggle.addEventListener("click", () => {
      const open = !state.feedbackDraft.contactOpen;
      state.feedbackDraft.contactOpen = open;
      if (!open) state.feedbackDraft.contact = "";
      render();
      if (open && state.shadow) setTimeout(() => {
        const input = state.shadow.getElementById("cs-feedback-contact");
        if (input) input.focus();
      }, 0);
    });
    if (feedbackContact) feedbackContact.addEventListener("input", () => { state.feedbackDraft.contact = feedbackContact.value; });
    if (feedbackSubmit) feedbackSubmit.addEventListener("click", async () => {
      const draft = state.feedbackDraft;
      if (!draft.message.trim()) return;
      if (draft.type === "일정" && draft.relatedLink.trim()) {
        try {
          const parsed = new URL(draft.relatedLink.trim());
          if (parsed.protocol !== "https:") throw new Error("invalid");
        } catch (_e) {
          feedbackStatus.textContent = "관련 링크 주소를 확인해주세요.";
          feedbackStatus.className = "cs-feedback-status cs-error";
          feedbackLink.focus();
          return;
        }
      }
      const replyContact = draft.contactOpen ? String(draft.contact || "").trim() : "";
      if (replyContact && feedbackContact && !feedbackContact.checkValidity()) {
        feedbackStatus.textContent = "회신 메일 주소를 확인해주세요.";
        feedbackStatus.className = "cs-feedback-status cs-error";
        feedbackContact.focus();
        return;
      }
      feedbackSubmit.disabled = true;
      feedbackStatus.textContent = "보내는 중…";
      feedbackStatus.className = "cs-feedback-status";
      const result = await sendRuntimeMessage({
        type: "submitFeedback",
        payload: { feedbackType: draft.type, message: draft.message, relatedLink: draft.relatedLink, contact: replyContact },
      });
      if (!result || !result.ok) {
        feedbackStatus.textContent = "전송 실패: " + ((result && result.error) || "알 수 없는 오류");
        feedbackStatus.className = "cs-feedback-status cs-error";
        feedbackSubmit.disabled = false;
        return;
      }
      feedbackStatus.textContent = "전달되었습니다. 감사합니다!";
      feedbackStatus.className = "cs-feedback-status cs-success";
      state.feedbackDraft = { type: "일정", message: "", relatedLink: "", contact: "", contactOpen: false };
      setTimeout(() => { state.feedbackOpen = false; if (state.shadow) render(); }, 1200);
    });

    if (state.feedbackOutsideHandler) document.removeEventListener("mousedown", state.feedbackOutsideHandler);
    state.feedbackOutsideHandler = (event) => {
      if (!state.feedbackOpen) return;
      const path = event.composedPath ? event.composedPath() : [];
      if (path.includes(feedbackPanel) || path.includes(feedbackOpen)) return;
      setFeedbackOpen(false);
    };
    document.addEventListener("mousedown", state.feedbackOutsideHandler);
  }

  function scheduleOpenPopover(cell, options) {
    if (state.popoverTimer) clearTimeout(state.popoverTimer);
    if (state.popoverCloseTimer) clearTimeout(state.popoverCloseTimer);
    const pinned = !!(options && options.pinned);
    const key = cell && cell.getAttribute("data-date");
    const popover = state.shadow && state.shadow.getElementById("cs-popover");
    const sameOpen = !!(key && popover && popover.classList.contains("cs-open") && state.activePopoverDate === key);
    if (!pinned && state.schedulePopoverPinned) return;
    if (pinned && sameOpen && state.schedulePopoverPinned) {
      closePopover();
      return;
    }
    state.schedulePopoverPinned = pinned;
    openPopover(cell);
  }

  function scheduleClosePopover() {
    if (state.popoverTimer) clearTimeout(state.popoverTimer);
    if (state.popoverCloseTimer) clearTimeout(state.popoverCloseTimer);
    if (state.schedulePopoverPinned) return;
    state.popoverCloseTimer = setTimeout(closePopover, 180);
  }

  function openPopover(cell) {
    const s = state.shadow;
    const popover = s.getElementById("cs-popover");
    const body = s.getElementById("cs-pop-body");
    const arrow = s.getElementById("cs-pop-arrow");
    const section = popover ? popover.closest(".cs-schedule-section") : null;
    if (!popover || !body || !section) return;

    const key = cell.getAttribute("data-date");
    const entry = entryFor(key);
    if (!entry) return;

    const d = parseKey(key);
    const isPast = key < state.todayKey;
    const isOff = entry.status === "off";
    const notes = entryNotes(entry);

    let html = '<div class="cs-pop-date-row"><span class="cs-pop-date">' + popoverDateLabel(d) + "</span>";
    // 다시보기 링크가 없어도 항상 같은 자리에 버튼을 두되, 비활성(회색) 상태로 표시.
    // 어드민에서 링크를 넣으면 그 개수만큼 활성(민트색) 버튼으로 바뀐다.
    if (entry.vods && entry.vods.length) {
      html += '<div class="cs-vod-buttons">' +
        entry.vods
          .map((v) => {
            const safeVodUrl = safeMediaUrl(v.url);
            if (!safeVodUrl) {
              return '<span class="cs-vod-btn cs-vod-btn-disabled" aria-disabled="true">▶</span>';
            }
            return '<a class="cs-vod-btn" href="' + escapeHtml(safeVodUrl) + '" target="_blank" rel="noopener noreferrer">' +
              "▶" +
              '<span class="cs-member-tip">' + directiveHtml(v.label || "방송 다시보기") + "</span>" +
              "</a>";
          })
          .join("") +
        "</div>";
    } else {
      html += '<div class="cs-vod-buttons">' +
        '<span class="cs-vod-btn cs-vod-btn-disabled" aria-disabled="true">▶</span>' +
        "</div>";
    }
    html += "</div>";

    const titleText = String(entry.title || entry.titleShort || "").trim();
    if (titleText) {
      html += '<div class="cs-pop-title">' + directiveHtml(titleText, { tagTone: true }) + "</div>";
    }

    let detailHtml = "";

    // 시간 줄: 과거 일정과 휴방에서는 생략
    if (!isPast && !isOff) {
      const timeText = entry.start
        ? escapeHtml(entry.start + (entry.end ? " ~ " + entry.end : " ~"))
        : "시간 미정";
      detailHtml += '<div class="cs-pop-row"><span class="cs-pop-icon">◷</span>' +
        '<span class="cs-pop-text">' + timeText + "</span></div>";
    }

    // 부메모는 각 세부 일정 카드 안에 유지하고, 전체 메모는 상세 일정 아래 단독 섹션으로 노출한다.
    if (!isOff && entry.parts && entry.parts.length) {
      detailHtml += '<div class="cs-pop-parts-box">' + entry.parts
        .map((p, idx) => {
          const iconClass = p.speculative ? "cs-pop-icon cs-pop-icon-speculative" :
            p.official && !p.collab ? "cs-pop-icon cs-pop-icon-official" :
            isSpecialPart(p) ? "cs-pop-icon cs-pop-icon-collab" : "cs-pop-icon";
          const firstTag = firstPartTag(p);
          const tagToneAttr = tagToneStyleAttr(firstTag);
          const tagToneClass = firstTag ? " cs-tag-tone" : "";
          const partLabelClass = iconClass + " cs-pop-part-label" + tagToneClass;
          const label = partDisplayLabel(p, idx);
          let popContent = '<span class="cs-pop-text cs-pop-part-text">' + directiveHtml(p.content, { tagTone: true }) + "</span>";
          if (p.displayType === "tag") {
            const contentToneAttr = firstTag ? tagToneAttr : tagToneStyleAttr(p.content);
            popContent = '<span class="cs-text-badge cs-pop-part-text cs-tag-tone"' + contentToneAttr + '>' + directiveHtml(p.content, { tagTone: true }) + "</span>";
          }
          if (p.displayType === "profile" && p.profile) {
            popContent = '<span class="cs-inline-profile">' + channelAvatarLinkHtml(p.profile) + "</span>";
          }
          let group = '<div class="cs-pop-part">' +
            '<div class="cs-pop-row cs-pop-part-main">' + (label ? '<span class="' + partLabelClass + '"' + tagToneAttr + '>' + escapeHtml(label) + "</span>" : "") +
            popContent + "</div>";
          if ((p.official || p.otherChannel) && p.hostChannel) {
            const hostLabel = p.otherChannel ? "송출" : "진행";
            const hostLabelClass = p.otherChannel ? "cs-pop-members-chip" : "cs-pop-members-label";
            group += '<div class="cs-pop-members-row"><span class="' + hostLabelClass + '">' + hostLabel + '</span><div class="cs-pop-members">' + channelAvatarLinkHtml(p.hostChannel) + "</div></div>";
          }
          if (p.collab && p.members && p.members.length) {
            group += '<div class="cs-pop-members-row"><span class="cs-pop-members-chip">멤버</span><div class="cs-pop-members">' +
              p.members.map((member) => channelAvatarLinkHtml(member)).join("") +
              "</div></div>";
          }
          const notesForPart = partNotes(p);
          if (notesForPart.length) {
            group += '<div class="cs-pop-part-notes"><div class="cs-pop-note-list">' + notesForPart.map((note) =>
              '<div class="cs-pop-note-text">' + directiveHtml(note, { tagTone: true }) + "</div>"
            ).join("") + "</div></div>";
          }
          group += "</div>";
          return group;
        })
        .join("") + "</div>";
    }

    const notesHtml = notes.length
      ? '<section class="cs-pop-note-box cs-pop-main-note" aria-label="\uBA54\uBAA8"><div class="cs-pop-note-head"><span class="cs-pop-icon">&#9998;</span><span>\uBA54\uBAA8</span></div>' +
        '<div class="cs-pop-note-list">' + notes.map((note) =>
          '<div class="cs-pop-note-text">' + directiveHtml(note, { tagTone: true }) + "</div>"
        ).join("") + "</div></section>"
      : "";

    html += detailHtml + notesHtml;
    body.innerHTML = html;
    popover.style.width = "max-content";
    state.activePopoverDate = key;
    popover.classList.add("cs-open");

    // 위치 계산: 팝오버의 실제 absolute 기준인 일정 섹션을 사용한다.
    // 본문(.cs-schedule-body)을 기준으로 계산하면 헤더 높이만큼 위로
    // 당겨져 팝오버가 hover 중인 일정 칸을 가리게 된다.
    const sectionRect = section.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const popW = popover.offsetWidth || 250;
    const cellCenter = cellRect.left - sectionRect.left + cellRect.width / 2;
    let left = cellCenter - popW / 2;
    left = Math.max(4, Math.min(left, sectionRect.width - popW - 4));
    const top = cellRect.bottom - sectionRect.top + 6;

    popover.style.left = left + "px";
    popover.style.top = top + "px";
    if (arrow) arrow.style.left = Math.max(10, Math.min(cellCenter - left - 5, popW - 20)) + "px";
  }

  function youtubeEmbedUrl(url) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, "");
      let id = "";
      if (host === "youtu.be") id = parsed.pathname.split("/").filter(Boolean)[0] || "";
      if (host === "youtube.com" || host === "m.youtube.com") {
        if (parsed.pathname === "/watch") id = parsed.searchParams.get("v") || "";
        else if (parsed.pathname.startsWith("/shorts/") || parsed.pathname.startsWith("/embed/")) id = parsed.pathname.split("/").filter(Boolean)[1] || "";
      }
      return id ? "https://www.youtube.com/embed/" + encodeURIComponent(id) : "";
    } catch (_e) {
      return "";
    }
  }

  function gnimtiAdminContent() {
    const byChannel = (state.data && state.data.gnimtiContentByChannel) || {};
    return byChannel[state.channelId] || (state.data && state.data.gnimtiContent) || {};
  }

  function gnimtiMonthData(month) {
    const content = gnimtiAdminContent();
    const data = content && content[month];
    return data && typeof data === "object" ? data : {};
  }

  function gnimtiSeptemberMembers() {
    const data = gnimtiMonthData("september");
    return Array.isArray(data.members) ? data.members.map((member) => ({
      name: String((member && (member.name || member.channelName || member.channel_name)) || "").trim(),
      channelId: String((member && (member.channelId || member.channel_id)) || "").trim(),
      channelName: String((member && (member.channelName || member.channel_name || member.name)) || "").trim(),
      channelImageUrl: String((member && (member.channelImageUrl || member.channel_image_url)) || "").trim(),
      position: String((member && member.position) || "").trim(),
      tier: String((member && member.tier) || "").trim().toUpperCase(),
      selfImageUrl: String((member && member.selfImageUrl) || "").trim(),
      analysisImageUrl: String((member && member.analysisImageUrl) || "").trim(),
    })).filter((member) => member.name) : [];
  }

  function gnimtiRosterColumns(month) {
    if (month === "september") {
      const order = ["탑", "정글", "미드", "원딜", "서포터"];
      const columns = order.map((position) => ({ position, folder: "", members: [] }));
      const extra = { position: "기타", folder: "", members: [] };
      gnimtiSeptemberMembers().forEach((member) => {
        const column = columns.find((item) => item.position === member.position) || extra;
        column.members.push(member.name);
      });
      return extra.members.length ? columns.concat(extra) : columns;
    }
    return [
      { position: "탑", folder: "TOP", members: ["김뿡", "김호러", "러너", "룩삼", "승우아빠", "울프", "윤가놈", "인간젤리", "철면수심", "캡틴잭", "크랭크", "푸린", "한동숙"] },
      { position: "정글", folder: "JG", members: ["꼴랑이", "멋사", "삼식", "소우릎", "플레임", "헤징"] },
      { position: "미드", folder: "MID", members: ["네클릿", "뱅", "샘웨", "앰비션", "크캣", "햇살살"] },
      { position: "원딜", folder: "AD", members: ["괴물쥐", "눈꽃", "명예훈장", "실프", "이선생", "플러리"] },
      { position: "서포터", folder: "SUP", members: ["갱맘", "니니아", "던", "두니주니", "서새봄냥", "채현찌", "초승달", "큐베", "피닉스박"] },
    ];
  }

  function gnimtiMemberData(name, month) {
    if (month !== "september") return null;
    const key = String(name || "").trim();
    return gnimtiSeptemberMembers().find((member) => member.name === key) || null;
  }

  function gnimtiMemberInfo(name, month) {
    const adminMember = gnimtiMemberData(name, month);
    if (adminMember) return { name, position: adminMember.position, folder: "" };
    for (const column of gnimtiRosterColumns()) {
      if (column.members.includes(name)) return { name, position: column.position, folder: column.folder };
    }
    return { name, position: "", folder: "" };
  }

  function gnimtiMemberImages(name, month) {
    const adminMember = gnimtiMemberData(name, month);
    if (adminMember) {
      return [
        { label: "본인 평가", url: adminMember.selfImageUrl, team: false },
        { label: "분석관팀 평가", url: adminMember.analysisImageUrl, team: true },
      ];
    }
    const info = gnimtiMemberInfo(name);
    if (!info.folder) return [];
    return [1, 2].map((index) => ({
      label: index === 1 ? "본인 평가" : "분석관팀 평가",
      url: api.runtime.getURL("images/gnimti/" + info.folder + "/" + name + index + ".png"),
      team: index !== 1,
    }));
  }

  const GNIMTI_MEMBER_TIERS = Object.freeze({
    "김뿡": "A",
    "김호러": "C",
    "러너": "B",
    "룩삼": "B",
    "승우아빠": "C",
    "울프": "A",
    "윤가놈": "D",
    "인간젤리": "A",
    "철면수심": "D",
    "캡틴잭": "A",
    "크랭크": "D",
    "푸린": "B",
    "한동숙": "C",
    "꼴랑이": "B",
    "멋사": "C",
    "삼식": "B",
    "소우릎": "S",
    "플레임": "S",
    "헤징": "B",
    "네클릿": "S",
    "뱅": "S",
    "샘웨": "B",
    "앰비션": "S",
    "크캣": "A",
    "햇살살": "D",
    "괴물쥐": "S",
    "눈꽃": "A",
    "명예훈장": "B",
    "실프": "B",
    "이선생": "C",
    "플러리": "B",
    "갱맘": "S",
    "니니아": "C",
    "던": "B",
    "두니주니": "D",
    "서새봄냥": "D",
    "채현찌": "C",
    "초승달": "D",
    "큐베": "S",
    "피닉스박": "A",
  });

  function gnimtiMemberTier(name, month) {
    const adminMember = gnimtiMemberData(name, month);
    const tier = adminMember ? adminMember.tier : (GNIMTI_MEMBER_TIERS[String(name || "").trim()] || "");
    const imageUrl = GNIMTI_TIER_BACK_IMAGE_URLS[tier];
    return imageUrl ? { tier, imageUrl } : null;
  }
  function gnimtiMemberProfile(name, month) {
    const adminMember = gnimtiMemberData(name, month);
    if (adminMember && (adminMember.channelId || adminMember.channelName || adminMember.channelImageUrl)) {
      return {
        channelId: adminMember.channelId || "",
        channelName: adminMember.channelName || adminMember.name || name,
        channelImageUrl: adminMember.channelImageUrl || "",
      };
    }
    const profiles = (state.data && state.data.gnimtiProfiles) || {};
    return profiles[name] || profiles[String(name || "").trim()] || { channelId: "", channelName: name, channelImageUrl: "" };
  }


  function gnimtiMemberHtml(name, selectedName, month) {
    const profile = gnimtiMemberProfile(name, month);
    const displayName = String((profile && profile.channelName) || name || "").trim();
    const tier = gnimtiMemberTier(name, month);
    const avatar = '<span class="cs-gnimti-avatar">' + memberAvatarImgHtml(profile) + '</span>';
    const nameHtml = '<span class="cs-gnimti-name">' + escapeHtml(displayName) + '</span>';
    const className = "cs-gnimti-member" + (tier ? " cs-gnimti-member-tier-bg" : "") + (name === selectedName ? " cs-selected" : "");
    const style = tier ? ' style="--gnimti-tier-bg: url(' + escapeHtml(tier.imageUrl) + ')" title="' + escapeHtml(tier.tier + " 티어") + '"' : "";
    return '<button type="button" class="' + className + '" data-gnimti-member="' + escapeHtml(name) + '"' + style + '>' + avatar + nameHtml + '</button>';
  }
  function gnimtiMemberDetailHtml(name, month) {
    if (!name) return '<aside class="cs-gnimti-detail"><div class="cs-gnimti-empty-detail">멤버를 선택하세요</div></aside>';
    const profile = gnimtiMemberProfile(name, month);
    const displayName = String((profile && profile.channelName) || name || "").trim();
    const info = gnimtiMemberInfo(name, month);
    const images = gnimtiMemberImages(name, month);
    return '<aside class="cs-gnimti-detail" data-gnimti-detail="1">' +
      '<div class="cs-gnimti-detail-head">' +
      '<span class="cs-gnimti-avatar">' + memberAvatarImgHtml(profile) + '</span>' +
      '<div class="cs-gnimti-detail-title">' + escapeHtml(displayName) + (info.position ? ' · ' + escapeHtml(info.position) : '') + '</div>' +
      '</div>' +
      '<div class="cs-gnimti-images"><div class="cs-gnimti-card">' + images.map((item) => {
        const labelClass = item.team ? "cs-gnimti-stat-label cs-gnimti-stat-label-team" : "cs-gnimti-stat-label";
        const media = item.url
          ? '<img src="' + escapeHtml(item.url) + '" alt="' + escapeHtml(displayName + ' ' + item.label) + '" />'
          : '<div class="cs-gnimti-stat-empty">이미지 준비 중</div>';
        return '<figure class="cs-gnimti-stat-item"><figcaption class="' + labelClass + '">' + escapeHtml(item.label) + '</figcaption>' + media + '</figure>';
      }).join("") + '</div></div></aside>';
  }

  function gnimtiTabs() {
    return [
      { id: "members", month: "august", label: "8\uC6D4 \uADF8\uB2D8\uD2F0 \uD3C9\uAC00" },
      { id: "tier", month: "august", label: "8\uC6D4 \uD2F0\uC5B4\uB9AC\uC2A4\uD2B8" },
      { id: "roster", month: "august", label: "8\uC6D4 \uB85C\uC2A4\uD130" },
      { id: "september-members", month: "september", label: "9\uC6D4 \uADF8\uB2D8\uD2F0 \uD3C9\uAC00" },
      { id: "september-tier", month: "september", label: "9\uC6D4 \uD2F0\uC5B4\uB9AC\uC2A4\uD2B8" },
      { id: "september-roster", month: "september", label: "9\uC6D4 \uB85C\uC2A4\uD130" },
    ];
  }

  function gnimtiTabMonth(tab) {
    return String(tab || "").startsWith("september") ? "september" : "august";
  }

  function gnimtiTabsHtml(activeTab) {
    const current = activeTab || "members";
    const tabs = gnimtiTabs();
    const rowHtml = (month) => '<div class="cs-gnimti-tab-row">' + tabs.filter((tab) => tab.month === month).map((tab) =>
      '<button type="button" class="cs-gnimti-tab' + (tab.id === current ? " cs-active" : "") + '" data-gnimti-tab="' + tab.id + '" role="tab" aria-selected="' + (tab.id === current ? "true" : "false") + '">' + tab.label + '</button>'
    ).join("") + '</div>';
    return '<div class="cs-gnimti-tabs" role="tablist" aria-label="\uADF8\uB2D8\uD2F0 \uBA54\uB274">' + rowHtml("august") + rowHtml("september") + '</div>';
  }

  function gnimtiPlaceholderHtml(label) {
    return '<div class="cs-gnimti-content"><div class="cs-gnimti-placeholder">' + escapeHtml(label) + '</div></div>';
  }
  function gnimtiTierlistHtml(month) {
    if (month === "september") {
      const url = String(gnimtiMonthData("september").tierlistImageUrl || "").trim();
      return url ? '<div class="cs-gnimti-content"><div class="cs-gnimti-tierlist"><img src="' + escapeHtml(url) + '" alt="9월 티어리스트" /></div></div>' : gnimtiPlaceholderHtml("9월 티어리스트 준비 중");
    }
    return '<div class="cs-gnimti-content"><div class="cs-gnimti-tierlist"><img src="' + GNIMTI_TIERLIST_IMAGE_URL + '" alt="8\uC6D4 \uD2F0\uC5B4\uB9AC\uC2A4\uD2B8" /></div></div>';
  }

  function gnimtiRosterBoardHtml(month) {
    const urls = month === "september" ? ((gnimtiMonthData("september").rosterImageUrls || []).filter(Boolean)) : GNIMTI_ROSTER_IMAGE_URLS;
    if (!urls.length) return gnimtiPlaceholderHtml(month === "september" ? "9월 로스터 준비 중" : "8월 로스터 준비 중");
    return '<div class="cs-gnimti-content"><div class="cs-gnimti-roster-board">' + urls.map((src, index) =>
      '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml((month === "september" ? "9월" : "8월") + ' 로스터 ' + (index + 1)) + '" />'
    ).join("") + '</div></div>';
  }

  function gnimtiContentHtml(tab, selectedName) {
    if (tab === "september-members") return gnimtiSeptemberMembers().length ? gnimtiRosterHtml(selectedName, "september") : gnimtiPlaceholderHtml("9월 그님티 평가 준비 중");
    if (tab === "september-tier") return gnimtiTierlistHtml("september");
    if (tab === "september-roster") return gnimtiRosterBoardHtml("september");
    if (tab === "tier") return gnimtiTierlistHtml("august");
    if (tab === "roster") return gnimtiRosterBoardHtml("august");
    return gnimtiRosterHtml(selectedName, "august");
  }
  function gnimtiRosterHtml(selectedName, month) {
    const currentMonth = month || "august";
    const columns = gnimtiRosterColumns(currentMonth);
    const firstColumn = columns.find((column) => column.members && column.members.length);
    const activeName = selectedName || (firstColumn && firstColumn.members[0]) || "";
    const roster = '<div class="cs-gnimti-roster">' + columns.map((column) =>
      '<section class="cs-gnimti-column">' +
      '<div class="cs-gnimti-position">' + escapeHtml(column.position) + '</div>' +
      '<div class="cs-gnimti-members">' + column.members.map((name) => gnimtiMemberHtml(name, activeName, currentMonth)).join("") + '</div></section>'
    ).join("") + '</div>';
    return '<div class="cs-gnimti-content">' + roster + gnimtiMemberDetailHtml(activeName, currentMonth) + '</div>';
  }

  function renderGnimtiTab(pop, tab) {
    if (!pop) return;
    const tabs = gnimtiTabs();
    const nextTab = tabs.some((item) => item.id === tab) ? tab : ((tabs[0] && tabs[0].id) || "members");
    pop.setAttribute("data-gnimti-tab", nextTab);
    pop.querySelectorAll("[data-gnimti-tab]").forEach((button) => {
      const active = button.getAttribute("data-gnimti-tab") === nextTab;
      button.classList.toggle("cs-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    const content = pop.querySelector(".cs-gnimti-content");
    if (content) content.outerHTML = gnimtiContentHtml(nextTab);
    const dialog = pop.querySelector(".cs-gnimti-dialog");
    if (dialog) dialog.scrollTop = 0;
  }
  function updateGnimtiDetail(pop, name) {
    const activeTab = pop && pop.getAttribute("data-gnimti-tab") || "members";
    const month = gnimtiTabMonth(activeTab);
    const current = pop && pop.querySelector(".cs-gnimti-detail");
    if (current) current.outerHTML = gnimtiMemberDetailHtml(name, month);
    if (pop) pop.querySelectorAll(".cs-gnimti-member").forEach((button) => {
      button.classList.toggle("cs-selected", button.getAttribute("data-gnimti-member") === name);
    });
  }
  function mediaEmbedHtml(url, label) {
    const safeUrl = safeMediaUrl(url);
    if (!safeUrl) return '<span class="cs-media-link">' + escapeHtml(url) + "</span>";
    const path = new URL(safeUrl).pathname.toLowerCase();
    const yt = youtubeEmbedUrl(safeUrl);
    if (yt) return '<iframe src="' + escapeHtml(yt) + '" title="' + escapeHtml(label || "동영상") + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>';
    if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(path)) return '<img class="cs-media-expandable" src="' + escapeHtml(safeUrl) + '" alt="' + escapeHtml(label || "이미지") + '" title="클릭해서 확대" />';
    if (/\.(mp4|webm|ogg|mov|m4v)$/.test(path)) return '<video src="' + escapeHtml(safeUrl) + '" controls playsinline></video>';
    return '<a class="cs-media-link" href="' + escapeHtml(safeUrl) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(safeUrl) + "</a>";
  }

  function closeGnimtiPopup() {
    const pop = state.shadow && state.shadow.getElementById("cs-gnimti-popup");
    if (pop) pop.classList.remove("cs-open");
  }

  function ensureGnimtiPopup() {
    const s = state.shadow;
    let pop = s && s.getElementById("cs-gnimti-popup");
    if (pop) return pop;
    pop = document.createElement("div");
    pop.id = "cs-gnimti-popup";
    pop.className = "cs-gnimti-popup";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-modal", "true");
    pop.setAttribute("aria-label", "그님티");
    pop.innerHTML =
      '<div class="cs-gnimti-dialog">' +
      '<button type="button" class="cs-gnimti-close" id="cs-gnimti-close" aria-label="닫기">×</button>' +
      '<div class="cs-gnimti-visual">' +
      '<img class="cs-gnimti-image" src="' + GNIMTI_POPUP_IMAGE_URL + '" alt="" />' +
      '<img class="cs-gnimti-logo" src="' + GNIMTI_LOGO_IMAGE_URL + '" alt="" />' +
      gnimtiTabsHtml("members") +
      '</div>' +
      gnimtiContentHtml("members") +
      '</div>';
    pop.addEventListener("click", (event) => {
      if (event.target === pop) closeGnimtiPopup();
    });
    pop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeGnimtiPopup();
    });
    const close = pop.querySelector("#cs-gnimti-close");
    if (close) close.addEventListener("click", closeGnimtiPopup);
    const dialog = pop.querySelector(".cs-gnimti-dialog");
    if (dialog) dialog.addEventListener("click", (event) => {
      const tabButton = event.target.closest && event.target.closest("[data-gnimti-tab]");
      if (tabButton && dialog.contains(tabButton)) {
        event.preventDefault();
        event.stopPropagation();
        renderGnimtiTab(pop, tabButton.getAttribute("data-gnimti-tab") || "members");
        return;
      }
      const member = event.target.closest && event.target.closest("[data-gnimti-member]");
      if (member && dialog.contains(member)) {
        event.preventDefault();
        updateGnimtiDetail(pop, member.getAttribute("data-gnimti-member") || "");
      }
      event.stopPropagation();
    });
    s.appendChild(pop);
    return pop;
  }

  function showGnimtiPopup() {
    closeMediaPopover();
    closePopover();
    const pop = ensureGnimtiPopup();
    const activeTab = pop.getAttribute("data-gnimti-tab") || "members";
    renderGnimtiTab(pop, activeTab);
    pop.classList.add("cs-open");
    const close = pop.querySelector("#cs-gnimti-close");
    if (close) setTimeout(() => close.focus(), 0);
  }
  function closeOriginalImage() {
    const viewer = state.shadow && state.shadow.getElementById("cs-media-viewer");
    if (viewer) viewer.classList.remove("cs-open");
  }

  function ensureOriginalImageViewer() {
    const s = state.shadow;
    let viewer = s && s.getElementById("cs-media-viewer");
    if (viewer) return viewer;
    viewer = document.createElement("div");
    viewer.id = "cs-media-viewer";
    viewer.className = "cs-media-viewer";
    viewer.innerHTML = '<button type="button" class="cs-media-viewer-close" id="cs-media-viewer-close" aria-label="닫기">×</button><div class="cs-media-viewer-canvas" id="cs-media-viewer-canvas"><img id="cs-media-viewer-img" alt="" draggable="false" /></div>';
    viewer.addEventListener("click", (event) => {
      if (event.target === viewer || event.target.id === "cs-media-viewer-canvas") closeOriginalImage();
    });
    const img = viewer.querySelector("#cs-media-viewer-img");
    const close = viewer.querySelector("#cs-media-viewer-close");
    if (close) close.addEventListener("click", closeOriginalImage);
    const applyImageTransform = () => {
      if (!img) return;
      const zoom = Number(img.dataset.zoom || 1);
      const panX = Number(img.dataset.panX || 0);
      const panY = Number(img.dataset.panY || 0);
      img.style.transform = "translate3d(" + panX + "px," + panY + "px,0) scale(" + zoom + ")";
    };
    if (img) img.addEventListener("click", (event) => event.stopPropagation());
    viewer.addEventListener("wheel", (event) => {
      if (!img || !viewer.classList.contains("cs-open")) return;
      const baseWidth = Number(img.dataset.baseWidth || 0);
      const baseHeight = Number(img.dataset.baseHeight || 0);
      if (!baseWidth || !baseHeight) return;
      event.preventDefault();
      const currentZoom = Number(img.dataset.zoom || 1);
      const nextZoom = Math.max(1, Math.min(5, currentZoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12)));
      if (Math.abs(nextZoom - currentZoom) < 0.001) return;
      const canvas = viewer.querySelector("#cs-media-viewer-canvas");
      const canvasRect = canvas.getBoundingClientRect();
      const centerX = canvasRect.left + canvasRect.width / 2;
      const centerY = canvasRect.top + canvasRect.height / 2;
      const currentPanX = Number(img.dataset.panX || 0);
      const currentPanY = Number(img.dataset.panY || 0);
      const imagePointX = (event.clientX - centerX - currentPanX) / currentZoom;
      const imagePointY = (event.clientY - centerY - currentPanY) / currentZoom;
      img.dataset.zoom = String(nextZoom);
      img.dataset.panX = String(event.clientX - centerX - imagePointX * nextZoom);
      img.dataset.panY = String(event.clientY - centerY - imagePointY * nextZoom);
      applyImageTransform();
    }, { passive: false });
    if (img) {
      img.addEventListener("pointerdown", (event) => {
        if (Number(img.dataset.zoom || 1) <= 1) return;
        event.preventDefault();
        img.setPointerCapture(event.pointerId);
        img.dataset.dragStartX = String(event.clientX);
        img.dataset.dragStartY = String(event.clientY);
        img.dataset.dragPanX = img.dataset.panX || "0";
        img.dataset.dragPanY = img.dataset.panY || "0";
        img.classList.add("cs-dragging");
      });
      img.addEventListener("pointermove", (event) => {
        if (!img.classList.contains("cs-dragging")) return;
        img.dataset.panX = String(Number(img.dataset.dragPanX || 0) + event.clientX - Number(img.dataset.dragStartX || 0));
        img.dataset.panY = String(Number(img.dataset.dragPanY || 0) + event.clientY - Number(img.dataset.dragStartY || 0));
        applyImageTransform();
      });
      const stopDragging = (event) => {
        if (!img.classList.contains("cs-dragging")) return;
        img.classList.remove("cs-dragging");
        if (event && img.hasPointerCapture(event.pointerId)) img.releasePointerCapture(event.pointerId);
      };
      img.addEventListener("pointerup", stopDragging);
      img.addEventListener("pointercancel", stopDragging);
    }
    s.appendChild(viewer);
    return viewer;
  }

  function showOriginalImage(image) {
    const viewer = ensureOriginalImageViewer();
    const img = viewer.querySelector("#cs-media-viewer-img");
    if (!img) return;
    img.alt = image.alt || "이미지 원본";
    const fitImage = () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const horizontalPadding = 48;
      const verticalPadding = 48;
      const availableWidth = Math.max(1, viewer.clientWidth - horizontalPadding);
      const availableHeight = Math.max(1, viewer.clientHeight - verticalPadding);
      const fitScale = Math.min(availableWidth / img.naturalWidth, availableHeight / img.naturalHeight);
      const baseWidth = Math.max(1, img.naturalWidth * fitScale);
      const baseHeight = Math.max(1, img.naturalHeight * fitScale);
      img.dataset.baseWidth = String(baseWidth);
      img.dataset.baseHeight = String(baseHeight);
      img.dataset.zoom = "1";
      img.dataset.panX = "0";
      img.dataset.panY = "0";
      img.style.width = baseWidth + "px";
      img.style.height = baseHeight + "px";
      img.style.transform = "translate3d(0,0,0) scale(1)";
    };
    img.onload = fitImage;
    viewer.classList.add("cs-open");
    img.src = image.currentSrc || image.src;
    if (img.complete) requestAnimationFrame(fitImage);
  }
  function ensureMediaPopover() {
    const s = state.shadow;
    let pop = s && s.getElementById("cs-media-popover");
    if (pop) return pop;
    pop = document.createElement("div");
    pop.id = "cs-media-popover";
    pop.className = "cs-media-popover";
    pop.innerHTML = '<div class="cs-media-head"><span class="cs-media-title" id="cs-media-title"></span><button type="button" class="cs-media-close" id="cs-media-close" aria-label="닫기">×</button></div><div class="cs-media-body" id="cs-media-body"></div>';
    const root = s && s.getElementById("cs-root");
    (root || s).appendChild(pop);
    const close = pop.querySelector("#cs-media-close");
    if (close) close.addEventListener("click", closeMediaPopover);
    return pop;
  }

  function closeMediaPopover() {
    const pop = state.shadow && state.shadow.getElementById("cs-media-popover");
    if (pop) {
      pop.classList.remove("cs-open", "cs-media-expanded", "cs-install-guide-popover", "cs-text-popover", "cs-update-text-popover");
      pop.style.width = "";
    }
    closeOriginalImage();
    if (state.shadow) state.shadow.querySelectorAll(".cs-inline-media-trigger.cs-open, .cs-inline-text-popup-trigger.cs-open, .cs-install-guide-trigger.cs-open").forEach((el) => el.classList.remove("cs-open"));
  }

  function mediaPopoverBounds() {
    const root = state.shadow && state.shadow.getElementById("cs-root");
    const rect = root ? root.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    return { root, rect, margin: 8 };
  }

  function clampMediaPopoverPosition(pop, left, top) {
    const bounds = mediaPopoverBounds();
    const rootRect = bounds.rect;
    const margin = bounds.margin;
    const maxWidth = Math.max(120, rootRect.width - margin * 2);
    const maxHeight = Math.max(120, rootRect.height - margin * 2);
    pop.style.maxWidth = maxWidth + "px";
    pop.style.maxHeight = maxHeight + "px";
    const popRect = pop.getBoundingClientRect();
    const maxLeft = Math.max(margin, rootRect.width - popRect.width - margin);
    const maxTop = Math.max(margin, rootRect.height - popRect.height - margin);
    pop.style.left = Math.max(margin, Math.min(left, maxLeft)) + "px";
    pop.style.top = Math.max(margin, Math.min(top, maxTop)) + "px";
  }
  function showMediaPopover(trigger) {
    const url = trigger.getAttribute("data-media-url") || "";
    const label = trigger.getAttribute("data-media-label") || "미디어";
    const pop = ensureMediaPopover();
    pop.style.width = "";
    const title = pop.querySelector("#cs-media-title");
    const body = pop.querySelector("#cs-media-body");
    if (title) title.textContent = label;
    if (body) body.innerHTML = mediaEmbedHtml(url, label);
    pop.classList.remove("cs-install-guide-popover", "cs-text-popover", "cs-update-text-popover");
    state.shadow.querySelectorAll(".cs-inline-media-trigger.cs-open, .cs-inline-text-popup-trigger.cs-open, .cs-install-guide-trigger.cs-open").forEach((el) => el.classList.remove("cs-open"));
    trigger.classList.add("cs-open");
    pop.classList.add("cs-open");

    const bounds = mediaPopoverBounds();
    const root = bounds.root;
    const rootRect = bounds.rect;
    const margin = bounds.margin;
    if (root && pop.parentElement !== root) root.appendChild(pop);
    const rect = trigger.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const rightLeft = rect.right - rootRect.left + margin;
    const leftFallback = rect.left - rootRect.left - popRect.width - margin;
    const left = rightLeft + popRect.width <= rootRect.width - margin ? rightLeft : leftFallback;
    const top = rect.top - rootRect.top;
    clampMediaPopoverPosition(pop, left, top);
  }
  function textPopupPreferredWidth(text, rootWidth, maxLimit, extraWidth) {
    const availableWidth = Math.max(260, Math.floor((rootWidth || window.innerWidth || 680) - 16));
    const maxWidth = Math.max(260, Math.min(maxLimit || 680, availableWidth));
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    const measurer = document.createElement("span");
    measurer.style.position = "fixed";
    measurer.style.left = "-10000px";
    measurer.style.top = "-10000px";
    measurer.style.visibility = "hidden";
    measurer.style.whiteSpace = "pre";
    measurer.style.fontSize = "13px";
    measurer.style.lineHeight = "1.65";
    measurer.style.fontFamily = "Arial, sans-serif";
    document.body.appendChild(measurer);
    let longest = 0;
    lines.forEach((line) => {
      measurer.textContent = line || " ";
      longest = Math.max(longest, Math.ceil(measurer.getBoundingClientRect().width));
    });
    measurer.remove();
    return Math.max(260, Math.min(maxWidth, longest + (extraWidth || 48)));
  }

  function showTextPopupPopover(trigger) {
    const label = trigger.getAttribute("data-text-popup-label") || "\uD14D\uC2A4\uD2B8";
    const rawText = trigger.getAttribute("data-text-popup-body") || "";
    let text = rawText;
    try { text = decodeURIComponent(rawText); } catch (_e) {}
    const pop = ensureMediaPopover();
    const title = pop.querySelector("#cs-media-title");
    const body = pop.querySelector("#cs-media-body");
    if (title) title.textContent = label;
    if (body) body.innerHTML = '<div class="cs-text-popup-content">' + directiveHtml(text) + '</div>';
    pop.classList.remove("cs-install-guide-popover", "cs-media-expanded", "cs-update-text-popover");
    pop.classList.add("cs-text-popover");
    state.shadow.querySelectorAll(".cs-inline-media-trigger.cs-open, .cs-inline-text-popup-trigger.cs-open, .cs-install-guide-trigger.cs-open").forEach((el) => el.classList.remove("cs-open"));
    trigger.classList.add("cs-open");

    const bounds = mediaPopoverBounds();
    const root = bounds.root;
    const rootRect = bounds.rect;
    const margin = bounds.margin;
    if (root && pop.parentElement !== root) root.appendChild(pop);
    const maxPopupWidth = Math.max(260, rootRect.width - margin * 2 + 12);
    const isUpdatePopup = trigger.classList.contains("cs-update-history-card");
    pop.classList.toggle("cs-update-text-popover", isUpdatePopup);
    const preferredWidth = Math.min(textPopupPreferredWidth(text, rootRect.width, isUpdatePopup ? maxPopupWidth : 680, isUpdatePopup ? 84 : 48), maxPopupWidth);
    pop.style.width = preferredWidth + "px";
    const contentEl = body && body.querySelector(".cs-text-popup-content");
    if (contentEl) contentEl.style.width = Math.max(220, preferredWidth - 22) + "px";
    pop.classList.add("cs-open");

    const rect = trigger.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    let left;
    let top;
    if (trigger.classList.contains("cs-update-history-card")) {
      left = rect.left - rootRect.left + rect.width / 2 - popRect.width / 2;
      top = rect.bottom - rootRect.top + margin;
    } else {
      const rightLeft = rect.right - rootRect.left + margin;
      const leftFallback = rect.left - rootRect.left - popRect.width - margin;
      left = rightLeft + popRect.width <= rootRect.width - margin ? rightLeft : leftFallback;
      top = rect.top - rootRect.top;
    }
    clampMediaPopoverPosition(pop, left, top);
  }
  function installGuideSectionHtml(platform) {
    const isAndroid = platform === "android";
    const title = isAndroid ? "Android" : "iOS";
    const imageUrl = isAndroid ? OBAL_ANDROID_GUIDE_IMAGE_URL : OBAL_IOS_GUIDE_IMAGE_URL;
    const description = isAndroid
      ? "Android 모바일 브라우저에서 먼저 모바일 링크에 접속한 뒤, 브라우저 메뉴에서 홈 화면에 추가하세요."
      : "iPhone Safari에서 먼저 모바일 링크에 접속한 뒤, 공유 버튼에서 홈 화면에 추가하세요.";
    const link = '<a class="cs-install-guide-link" href="' + OBAL_MOBILE_LINK_URL + '" target="_blank" rel="noopener noreferrer">' + OBAL_MOBILE_LINK_URL + '</a>';
    return '<section class="cs-install-guide-section"><h4>' + title + '</h4>' +
      '<p>' + description + " " + link + '</p>' +
      '<img class="cs-media-expandable" src="' + imageUrl + '" alt="' + title + ' 오뱅알 설치 방법" title="클릭해서 확대" />' +
      '</section>';
  }

  function installGuideHtml(platform) {
    const normalized = String(platform || "").trim().toLowerCase();
    if (normalized === "android" || normalized === "ios") {
      return '<div class="cs-install-guide">' + installGuideSectionHtml(normalized) + '</div>';
    }
    return '<div class="cs-install-guide">' + installGuideSectionHtml("ios") + installGuideSectionHtml("android") + '</div>';
  }

  function showInstallGuidePopover(trigger) {
    const label = trigger.getAttribute("data-install-label") || "모바일 설치 방법";
    const platform = trigger.getAttribute("data-install-platform") || "";
    const pop = ensureMediaPopover();
    pop.style.width = "";
    const title = pop.querySelector("#cs-media-title");
    const body = pop.querySelector("#cs-media-body");
    if (title) title.textContent = label;
    if (body) body.innerHTML = installGuideHtml(platform);
    pop.classList.remove("cs-text-popover", "cs-media-expanded", "cs-update-text-popover");
    pop.classList.add("cs-install-guide-popover");
    state.shadow.querySelectorAll(".cs-inline-media-trigger.cs-open, .cs-inline-text-popup-trigger.cs-open, .cs-install-guide-trigger.cs-open").forEach((el) => el.classList.remove("cs-open"));
    trigger.classList.add("cs-open");
    pop.classList.add("cs-open");

    const bounds = mediaPopoverBounds();
    const root = bounds.root;
    const rootRect = bounds.rect;
    const margin = bounds.margin;
    if (root && pop.parentElement !== root) root.appendChild(pop);
    const rect = trigger.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const rightLeft = rect.right - rootRect.left + margin;
    const leftFallback = rect.left - rootRect.left - popRect.width - margin;
    const left = rightLeft + popRect.width <= rootRect.width - margin ? rightLeft : leftFallback;
    const top = rect.top - rootRect.top;
    clampMediaPopoverPosition(pop, left, top);
  }
  function closePopover() {
    if (state.popoverTimer) clearTimeout(state.popoverTimer);
    if (state.popoverCloseTimer) clearTimeout(state.popoverCloseTimer);
    state.activePopoverDate = "";
    state.schedulePopoverPinned = false;
    const popover = state.shadow && state.shadow.getElementById("cs-popover");
    if (popover) popover.classList.remove("cs-open");
  }

  // ----------------------------------------------------------
  // 마운팅 (인라인 → 실패 시 플로팅 폴백)
  // ----------------------------------------------------------
  function explicitPageTheme() {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      const attrs = [el.getAttribute("data-theme"), el.getAttribute("data-color-scheme"), el.getAttribute("color-scheme")]
        .filter(Boolean).join(" ").toLowerCase();
      if (/(^|[\s_-])light([\s_-]|$)/.test(attrs)) return "light";
      if (/(^|[\s_-])dark([\s_-]|$)/.test(attrs)) return "dark";
      const classes = Array.from(el.classList).join(" ").toLowerCase();
      if (/(^|[\s_-])light([\s_-]|$)/.test(classes)) return "light";
      if (/(^|[\s_-])dark([\s_-]|$)/.test(classes)) return "dark";
    }
    return null;
  }

  function backgroundPageTheme() {
    const candidates = [];
    let current = state.host && state.host.parentElement;
    while (current && candidates.length < 8) {
      candidates.push(current);
      current = current.parentElement;
    }
    candidates.push(document.querySelector("main"), document.body, document.documentElement);
    for (const el of candidates) {
      if (!el) continue;
      const color = getComputedStyle(el).backgroundColor;
      const match = color && color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i);
      if (!match || (match[4] !== undefined && Number(match[4]) < 0.2)) continue;
      const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      return luminance > 0.58 ? "light" : "dark";
    }
    return null;
  }

  function syncPageTheme() {
    if (!state.host) return;
    const theme = explicitPageTheme() || backgroundPageTheme() ||
      (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    if (theme === state.pageTheme && state.host.classList.contains("cs-light-theme") === (theme === "light")) return;
    state.pageTheme = theme;
    state.host.classList.toggle("cs-light-theme", theme === "light");
    state.host.classList.toggle("cs-dark-theme", theme !== "light");
  }

  let fullscreenWasActive = false;
  let fullscreenRestorePending = false;
  let fullscreenRestoreTimer = null;

  function isFullscreenActive() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function isLargeChatLayoutActive() {
    const showChatElements = document.querySelectorAll('[class*="_show_chat"]');
    for (const showChatElement of showChatElements) {
      if (!hasClassPrefix(showChatElement, "_show_chat")) continue;
      if (hasClassPrefix(showChatElement, "_is_large")) return true;

      const largeElements = showChatElement.querySelectorAll('[class*="_is_large"]');
      for (const largeElement of largeElements) {
        if (hasClassPrefix(largeElement, "_is_large")) return true;
      }
    }
    return false;
  }

  function syncFullscreenVisibility() {
    if (state.host) {
      state.host.classList.toggle("cs-large-chat-hidden", isLargeChatLayoutActive());
    }

    const active = isFullscreenActive();
    if (active) {
      fullscreenWasActive = true;
      fullscreenRestorePending = false;
      if (fullscreenRestoreTimer) clearTimeout(fullscreenRestoreTimer);
      if (state.host) state.host.classList.add("cs-fullscreen-hidden");
      return;
    }

    if (fullscreenWasActive) {
      fullscreenWasActive = false;
      fullscreenRestorePending = true;
      if (state.host) state.host.classList.add("cs-fullscreen-hidden");
      if (fullscreenRestoreTimer) clearTimeout(fullscreenRestoreTimer);
      // 치지직이 전체화면용 DOM을 원래 채널 DOM으로 되돌린 뒤, 정상 앵커를 다시 탐색한다.
      fullscreenRestoreTimer = setTimeout(() => {
        fullscreenRestorePending = false;
        unmount();
        anchorRetries = 0;
        tryMount();
      }, 450);
      return;
    }

    if (state.host) state.host.classList.toggle("cs-fullscreen-hidden", fullscreenRestorePending);
  }

  function createHost() {
    const host = document.createElement("div");
    host.id = "오뱅알-host";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    shadow.appendChild(style);
    const root = document.createElement("div");
    root.id = "cs-root";
    shadow.appendChild(root);
    state.host = host;
    state.shadow = shadow;
    syncFullscreenVisibility();
    return host;
  }

  // 사용자 지정 구조 규칙:
  // "_thumbnail*" 클래스를 함께 가진 요소를 찾고,
  // 그 조상 중 "_details*" 클래스를 가진 요소를 앵커로 사용 (그 다음에 삽입)


  function findDetailsAnchor() {
    const nodes = document.querySelectorAll('[class*="_thumbnail"]');
    for (const el of nodes) {
      const cls = (el.getAttribute("class") || "").split(/\s+/);
      const hasThumb = cls.some((c) => c.startsWith("_thumbnail"));
      if (!hasThumb) continue;
      let p = el.parentElement;
      while (p && p !== document.body) {
        const pcls = (p.getAttribute("class") || "").split(/\s+/);
        if (pcls.some((c) => c.startsWith("_details"))) return p;
        p = p.parentElement;
      }
    }
    return null;
  }

  function hasClassPrefix(el, prefix) {
    return (el.getAttribute("class") || "").split(/\s+/).some((name) => name.startsWith(prefix));
  }

  function findOfflineActionAnchor() {
    if (/^\/live\//.test(location.pathname)) return null;
    const controls = document.querySelectorAll('[class*="_control"]');
    for (const control of controls) {
      if (!hasClassPrefix(control, "_control")) continue;
      const actions = control.querySelectorAll('[class*="_action"]');
      for (const action of actions) {
        if (hasClassPrefix(action, "_action")) return action;
      }
    }
    return null;
  }

  function findAnchor() {
    // 0) config.js에서 직접 지정한 선택자가 있으면 최우선
    const manual =
      (typeof CHZZK_SCHEDULE_CONFIG !== "undefined" &&
        CHZZK_SCHEDULE_CONFIG.anchorSelector) || "";
    if (manual) {
      const el = document.querySelector(manual);
      if (el) return el;
    }

    // 1) 지정 구조: _thumbnail + _is_live 요소의 조상 _details
    const details = findDetailsAnchor();
    if (details) return details;

    // 2) 구형 클래스 (과거/다른 빌드 대비)
    for (const sel of ANCHOR_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }

    // 3) 신형 해시 클래스 (_information_xxxxx_n) 구조 휴리스틱:
    //    "제목(_title_)과 프로필(_profile_)을 함께 담고 있고, 플레이어 바깥에 있는
    //     _information_ 블록" 중 가장 안쪽 요소 = 방송 정보 컴포넌트
    //    해시가 바뀌어도 구조는 유지되므로 치지직 재배포에 강함
    let best = null;
    const candidates = document.querySelectorAll('[class*="_information_"]');
    for (const el of candidates) {
      if (el.closest('[class*="pzp"]')) continue;      // 비디오 플레이어 내부 제외
      if (el.querySelector("video")) continue;          // 영상 컨테이너 제외
      if (el.offsetWidth && el.offsetWidth < 300) continue;               // 툴팁/미니 UI 제외
      const hasTitle = el.querySelector('[class*="_title_"]');
      const hasProfile = el.querySelector('[class*="_profile_"]');
      if (!hasTitle || !hasProfile) continue;
      if (!best || best.contains(el)) best = el;        // 더 안쪽 요소를 선호
    }
    return best;
  }




  function getCurrentDataChannelId() {
    if (state.channelId) return state.channelId;
    if (typeof isChzzkVodPage === "function" && isChzzkVodPage()) return targetChannelId();
    return state.channelId;
  }

  function liveKeyFromVod(vod) {
    return String((vod && (vod.liveKey || vod.live_key)) || "").trim();
  }

  function titleHistoryItemsForVodMatch(list, vodMatch) {
    if (!Array.isArray(list) || !vodMatch || !vodMatch.entry) return [];
    const liveKey = liveKeyFromVod(vodMatch.vod);
    const scheduleDate = String((vodMatch.entry && vodMatch.entry.date) || "").trim();
    return list.filter((item) => {
      if (!item) return false;
      if (liveKey) return String(item.liveKey || item.live_key || "").trim() === liveKey;
      return !!scheduleDate && String(item.scheduleDate || item.schedule_date || "").trim() === scheduleDate;
    });
  }

  function titleHistoryItemsForRecentBroadcast(list) {
    if (!Array.isArray(list) || !list.length) return [];
    const latest = list.find((item) => item && (String(item.liveKey || item.live_key || "").trim() || String(item.startedAt || item.started_at || "").trim() || String(item.scheduleDate || item.schedule_date || "").trim()));
    if (!latest) return [];
    const liveKey = String(latest.liveKey || latest.live_key || "").trim();
    if (liveKey) return list.filter((item) => item && String(item.liveKey || item.live_key || "").trim() === liveKey);
    const startedAt = String(latest.startedAt || latest.started_at || "").trim();
    if (startedAt) return list.filter((item) => item && sameStartedAt(String(item.startedAt || item.started_at || "").trim(), startedAt));
    const scheduleDate = String(latest.scheduleDate || latest.schedule_date || "").trim();
    if (scheduleDate) return list.filter((item) => item && String(item.scheduleDate || item.schedule_date || "").trim() === scheduleDate);
    return [];
  }

  function currentLiveTitleText(scopedList) {
    const anchor = findTitleHistoryTitleAnchor();
    const visibleTitle = String((anchor && anchor.textContent) || "").replace(/\s+/g, " ").trim();
    if (visibleTitle) return visibleTitle;
    const latest = Array.isArray(scopedList) ? scopedList[0] : null;
    return String((latest && latest.title) || "").replace(/\s+/g, " ").trim();
  }

  function getTitleHistoryItems() {
    const dataChannelId = getCurrentDataChannelId();
    const histories = state.data && state.data.titleHistories;
    const list = histories && dataChannelId ? histories[dataChannelId] : [];
    if (!Array.isArray(list)) return [];
    const vodMatch = (typeof isChzzkVodPage === "function" && isChzzkVodPage()) ? currentVodScheduleMatch() : null;
    const scopedList = vodMatch ? titleHistoryItemsForVodMatch(list, vodMatch) : titleHistoryItemsForRecentBroadcast(list);
    const currentTitleKey = vodMatch ? "" : currentLiveTitleText(scopedList).toLowerCase();
    const filtered = [];
    const sorted = scopedList.slice().sort((a, b) => String(a.changedAt || '').localeCompare(String(b.changedAt || '')) || String(a.id || '').localeCompare(String(b.id || '')));
    for (const item of sorted) {
      if (item && (item.hidden === true || item.categoryHidden === true || item.category_hidden === true)) continue;
      const title = String((item && item.title) || '').trim();
      if (!title) continue;
      const key = title.replace(/\s+/g, ' ').trim().toLowerCase();
      if (currentTitleKey && key === currentTitleKey) continue;
      filtered.push(item);
      if (filtered.length >= 80) break;
    }
    return filtered;
  }

  function formatTitleHistoryTime(value) {
    const d = new Date(value || "");
    if (isNaN(d.getTime())) return "";
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return mm + "." + dd + " " + hh + ":" + mi;
  }

  function titleHistoryCategoryKey(item) {
    const label = String((item && item.categoryLabel) || '').trim();
    if (label) return 'LABEL|' + label.toLowerCase();
    const id = String((item && item.categoryId) || '').trim();
    const type = String((item && item.categoryType) || '').trim();
    return 'EMPTY|' + (id || type || 'NONE').toLowerCase();
  }

  function renderTitleHistoryPopover() {
    const items = getTitleHistoryItems();
    if (!items.length) {
      return '<div class="oth-sheet-handle" aria-hidden="true"></div><div class="oth-popover-head"><strong>\uC774\uC804 \uBC29\uC81C</strong><button type="button" class="oth-close" id="oth-close" aria-label="\uB2EB\uAE30">&times;</button></div><div class="oth-sheet-body"><div class="oth-empty">\uC544\uC9C1 \uAE30\uB85D\uB41C \uBC29\uC81C \uBCC0\uACBD\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.</div></div>';
    }
    const groups = [];
    items.forEach((item) => {
      const key = titleHistoryCategoryKey(item);
      const last = groups[groups.length - 1];
      if (last && last.key === key) {
        const type = String(item.categoryType || '').trim();
        last.items.push(item);
        if (String(item.changedAt || '') > last.latest) last.latest = String(item.changedAt || '');
        if (!last.first || String(item.changedAt || '') < last.first) last.first = String(item.changedAt || '');
        if (last.type && type && last.type !== type) last.type = '';
        return;
      }
      groups.push({
        key,
        label: String(item.categoryLabel || '\uCE74\uD14C\uACE0\uB9AC').trim() || '\uCE74\uD14C\uACE0\uB9AC \uC5C6\uC74C',
        type: String(item.categoryType || '').trim(),
        latest: String(item.changedAt || ''),
        first: String(item.changedAt || ''),
        items: [item],
      });
    });
    let previousRenderedTitle = '';
    const html = groups
      .sort((a, b) => String(a.first || '').localeCompare(String(b.first || '')) || String(a.latest || '').localeCompare(String(b.latest || '')))
      .map((group) => {
        const rows = group.items
          .slice()
          .sort((a, b) => String(a.changedAt || "").localeCompare(String(b.changedAt || "")) || String(a.id || "").localeCompare(String(b.id || "")))
          .filter((item) => {
            const titleKey = String((item && item.title) || '').trim().toLowerCase();
            if (titleKey && titleKey === previousRenderedTitle) return false;
            previousRenderedTitle = titleKey;
            return true;
          })
          .map((item) => {
            const title = String(item.title || "").trim();
            const time = formatTitleHistoryTime(item.changedAt);
            return '<li class="oth-title-row"><span class="oth-time">' + escapeHtml(time) + '</span><span class="oth-title-text">' + escapeHtml(title) + '</span></li>';
          }).join("");
        if (!rows) return '';
        return '<section class="oth-group"><div class="oth-category"><span>' + escapeHtml(group.label) + '</span></div><ol class="oth-list">' + rows + '</ol></section>';
      }).join("");
    return '<div class="oth-sheet-handle" aria-hidden="true"></div><div class="oth-popover-head"><strong>\uC774\uC804 \uBC29\uC81C</strong><button type="button" class="oth-close" id="oth-close" aria-label="\uB2EB\uAE30">&times;</button></div><div class="oth-sheet-body">' + html + '</div>';
  }


  function titleHistoryPopoverStyleHtml() {
    return '<style>' +
      ':host{position:fixed;inset:0;z-index:2147483601;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
      '.oth-popover{position:fixed;left:50%;right:auto;top:auto;bottom:0;width:min(720px,calc(100vw - 24px));max-height:min(58vh,520px);overflow:hidden;padding:10px 14px 14px;border:1px solid rgba(124,255,183,.42);border-bottom:0;border-radius:16px 16px 0 0;background:rgba(12,16,20,.98);color:#f5fff9;box-shadow:0 -18px 52px rgba(0,0,0,.45);box-sizing:border-box;transform:translate(-50%,100%);opacity:1;animation:oth-popover-up .2s cubic-bezier(.2,.8,.2,1) forwards;pointer-events:auto}' +
      '.oth-popover[hidden]{display:none}.oth-sheet-handle{width:42px;height:4px;margin:0 auto 10px;border-radius:999px;background:rgba(255,255,255,.24)}.oth-sheet-body{max-height:calc(min(58vh,520px) - 58px);overflow:auto;padding:0 2px 2px}.oth-sheet-body::-webkit-scrollbar{width:8px}.oth-sheet-body::-webkit-scrollbar-thumb{border-radius:999px;background:rgba(120,255,181,.36)}.oth-sheet-body::-webkit-scrollbar-track{background:rgba(255,255,255,.05)}.oth-close{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;margin-left:4px;border:1px solid rgba(255,255,255,.12);border-radius:7px;background:rgba(255,255,255,.06);color:#dce7e1;font-size:18px;line-height:1;cursor:pointer}.oth-close:hover{border-color:rgba(124,255,183,.42);background:rgba(124,255,183,.12);color:#fff}@keyframes oth-popover-up{to{transform:translate(-50%,0)}}' +
      '.oth-popover-head{display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:13px}.oth-popover-head strong{flex:1 1 auto}' +
      '.oth-group{padding:10px 0;border-top:1px solid rgba(255,255,255,.08)}.oth-group:first-of-type{border-top:0;padding-top:0}' +
      '.oth-category{display:flex;align-items:center;gap:7px;margin-bottom:8px;color:#91ffbd;font-size:12px;font-weight:800}' +
      '.oth-list{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none}.oth-title-row{display:grid;grid-template-columns:65px minmax(0,1fr);gap:8px;align-items:start;padding:7px 9px;border:1px solid rgba(255,255,255,.07);border-radius:8px;background:rgba(255,255,255,.035);font-size:12px;line-height:1.45}.oth-time{color:#8f9d97;font-variant-numeric:tabular-nums}.oth-title-text{color:#fff;font-weight:700;white-space:normal;overflow-wrap:anywhere}' +
      '.oth-empty{padding:8px 2px;color:#aeb8b3;font-size:12px;white-space:nowrap}' +
      '@media (max-width:520px){.oth-popover{width:100vw;max-width:100vw;border-left:0;border-right:0}}' +
      '</style>';
  }

  function ensureTitleHistoryPopoverHost() {
    if (state.titleHistoryPopoverHost && state.titleHistoryPopoverHost.isConnected) return state.titleHistoryPopoverHost;
    const host = document.createElement("div");
    host.id = "obaengal-title-history-popover-host";
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483601";
    host.style.pointerEvents = "none";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = titleHistoryPopoverStyleHtml() + '<div class="oth-popover" id="oth-popover" hidden></div>';
    (document.body || document.documentElement).appendChild(host);
    state.titleHistoryPopoverHost = host;
    return host;
  }

  function titleHistoryPopoverShadow() {
    const host = ensureTitleHistoryPopoverHost();
    return host && host.shadowRoot;
  }

  function positionTitleHistoryPopover(shadow) {
    const popover = shadow && shadow.getElementById("oth-popover");
    if (!popover || popover.hidden) return;
    popover.style.left = "50%";
    popover.style.right = "auto";
    popover.style.top = "auto";
    popover.style.bottom = "0";
  }


  function closeTitleHistoryPopover() {
    state.titleHistoryOpen = false;
    const buttonHost = state.titleHistoryHost;
    const buttonShadow = buttonHost && buttonHost.shadowRoot;
    const popoverHost = state.titleHistoryPopoverHost;
    const popoverShadow = popoverHost && popoverHost.shadowRoot;
    const button = buttonShadow && buttonShadow.getElementById("oth-button");
    const popover = popoverShadow && popoverShadow.getElementById("oth-popover");
    if (button) button.setAttribute("aria-expanded", "false");
    if (popover) popover.hidden = true;
  }

  function toggleTitleHistoryPopover() {
    const host = state.titleHistoryHost;
    const buttonShadow = host && host.shadowRoot;
    const popoverShadow = titleHistoryPopoverShadow();
    if (!buttonShadow || !popoverShadow) return;
    const button = buttonShadow.getElementById("oth-button");
    const popover = popoverShadow.getElementById("oth-popover");
    if (!button || !popover) return;
    state.titleHistoryOpen = !state.titleHistoryOpen;
    button.setAttribute("aria-expanded", String(state.titleHistoryOpen));
    if (state.titleHistoryOpen) {
      popover.innerHTML = renderTitleHistoryPopover();
      const close = popoverShadow.getElementById("oth-close");
      if (close) close.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeTitleHistoryPopover();
      });
      popover.hidden = false;
      positionTitleHistoryPopover(popoverShadow);
    } else {
      popover.hidden = true;
    }
  }

  function findTitleHistoryTitleAnchor() {
    const detailsCandidates = [];
    const primary = findDetailsAnchor();
    if (primary) detailsCandidates.push(primary);
    document.querySelectorAll('[class*="_details"]').forEach((details) => {
      if (detailsCandidates.includes(details)) return;
      if (!hasClassPrefix(details, "_details")) return;
      if (details.closest('[class*="pzp"]')) return;
      detailsCandidates.push(details);
    });

    for (const details of detailsCandidates) {
      const directTitle = Array.from(details.children || []).find((child) =>
        child.id !== "obaengal-title-history-host" && hasClassPrefix(child, "_title")
      );
      if (directTitle) return directTitle;

      const titles = details.querySelectorAll('[class*="_title"]');
      for (const title of titles) {
        if (title.id === "obaengal-title-history-host" || title.closest("#obaengal-title-history-host")) continue;
        if (hasClassPrefix(title, "_title")) return title;
      }
    }
    return null;
  }

  function removeTitleHistoryHost() {
    if (state.titleHistoryOutsideHandler) {
      document.removeEventListener("mousedown", state.titleHistoryOutsideHandler, true);
      state.titleHistoryOutsideHandler = null;
    }
    if (state.titleHistoryHost && state.titleHistoryHost.isConnected) state.titleHistoryHost.remove();
    if (state.titleHistoryPopoverHost && state.titleHistoryPopoverHost.isConnected) state.titleHistoryPopoverHost.remove();
    state.titleHistoryHost = null;
    state.titleHistoryPopoverHost = null;
    state.titleHistoryOpen = false;
  }

  function syncTitleHistoryButton() {
    if (!state.channelId || !state.channel) {
      removeTitleHistoryHost();
      return;
    }
    const anchor = findTitleHistoryTitleAnchor();
    if (!anchor || !getTitleHistoryItems().length) {
      removeTitleHistoryHost();
      return;
    }
    if (state.titleHistoryHost && state.titleHistoryHost.isConnected && state.titleHistoryHost.previousElementSibling === anchor) {
      return;
    }
    removeTitleHistoryHost();
    const host = document.createElement("span");
    host.id = "obaengal-title-history-host";
    host.style.display = "inline-flex";
    host.style.verticalAlign = "middle";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<style>' +
      ':host{position:relative;display:inline-flex;vertical-align:middle;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;z-index:2147483600}' +
      '.oth-wrap{position:relative;display:inline-flex;align-items:center}' +
      '.oth-button{height:28px;padding:0 10px;border:1px solid rgba(81,214,139,.46);border-radius:7px;background:rgba(13,18,22,.88);color:#e9fff3;font-size:12px;font-weight:700;line-height:1;white-space:nowrap;cursor:pointer;box-shadow:0 8px 20px rgba(0,0,0,.18);transition:background .16s ease,border-color .16s ease,transform .16s ease}' +
      '.oth-button:hover{background:rgba(25,35,41,.96);border-color:rgba(107,239,166,.9);transform:translateY(-1px)}' +
      '.oth-button[aria-expanded="true"]{background:#163123;border-color:#72f0aa;color:#fff}' +
      '</style><span class="oth-wrap"><button type="button" class="oth-button" id="oth-button" aria-expanded="false">\uC774\uC804 \uBC29\uC81C \uD655\uC778</button></span>';
    shadow.getElementById("oth-button").addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleTitleHistoryPopover();
    });
    state.titleHistoryOutsideHandler = (event) => {
      if (!state.titleHistoryOpen) return;
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      if (path.includes(host) || path.includes(state.titleHistoryPopoverHost)) return;
      closeTitleHistoryPopover();
    };
    document.addEventListener("mousedown", state.titleHistoryOutsideHandler, true);
    anchor.insertAdjacentElement("afterend", host);
    state.titleHistoryHost = host;
  }


  function getCategoryHistoryItems() {
    const dataChannelId = getCurrentDataChannelId();
    const histories = state.data && state.data.categoryHistories;
    const list = histories && dataChannelId ? histories[dataChannelId] : [];
    return Array.isArray(list) ? list.filter((item) => item && item.hidden !== true && String(item.categoryLabel || "").trim()) : [];
  }

  function videoNoFromUrl(url) {
    const raw = String(url || "").trim();
    const match = raw.match(/(?:^|\/)video\/([0-9]+)/i);
    return match ? match[1] : "";
  }

  function sameVodLink(a, b) {
    const aNo = videoNoFromUrl(a);
    const bNo = videoNoFromUrl(b);
    if (aNo && bNo) return aNo === bNo;
    const clean = (value) => String(value || "").trim().replace(/[?#].*$/, "").replace(/\/+$/, "");
    return !!clean(a) && clean(a) === clean(b);
  }

  function currentVodScheduleMatch() {
    const dataChannelId = getCurrentDataChannelId();
    const channel = state.data && state.data.channels && dataChannelId ? state.data.channels[dataChannelId] : null;
    const schedule = channel && Array.isArray(channel.schedule) ? channel.schedule : [];
    const currentUrl = location.href;
    for (const entry of schedule) {
      const vods = entry && Array.isArray(entry.vods) ? entry.vods : [];
      const vodIndex = vods.findIndex((item) => item && sameVodLink(item.url, currentUrl));
      if (vodIndex >= 0) return { entry, vod: vods[vodIndex], vodIndex };
    }
    return null;
  }

  function categoryHistoryLiveKey(item) {
    return String((item && (item.liveKey || item.live_key)) || "").trim();
  }

  function categoryHistoryStartedAt(item) {
    return String((item && (item.startedAt || item.started_at)) || "").trim();
  }

  function vodStartedAt(vod) {
    return String((vod && (vod.startedAt || vod.started_at)) || "").trim();
  }

  function timestampMsValue(value) {
    const ms = Date.parse(String(value || "").trim());
    return Number.isFinite(ms) ? ms : 0;
  }

  function sameStartedAt(a, b) {
    const left = timestampMsValue(a);
    const right = timestampMsValue(b);
    return !!left && !!right && Math.abs(left - right) <= 10 * 60 * 1000;
  }

  function categoryItemsForVodStartedAt(items, vod) {
    const startedAt = vodStartedAt(vod);
    if (!startedAt) return [];
    return items.filter((item) => sameStartedAt(categoryHistoryStartedAt(item), startedAt));
  }

  function categoryGroupsByLiveKey(items) {
    const groups = [];
    const byKey = new Map();
    items.slice().sort((a, b) =>
      String(a.changedAt || "").localeCompare(String(b.changedAt || "")) ||
      String(a.id || "").localeCompare(String(b.id || ""))
    ).forEach((item) => {
      const key = categoryHistoryLiveKey(item);
      if (!key) return;
      if (!byKey.has(key)) {
        const group = { liveKey: key, items: [] };
        byKey.set(key, group);
        groups.push(group);
      }
      byKey.get(key).items.push(item);
    });
    return groups;
  }

  function dateCategoryGroupForVod(items, vodMatch, scheduleDate) {
    const dateItems = items.filter((item) => String(item.scheduleDate || item.schedule_date || "").trim() === scheduleDate);
    if (!dateItems.length) return [];
    const groups = categoryGroupsByLiveKey(dateItems);
    if (!groups.length) return dateItems;
    const vods = vodMatch && vodMatch.entry && Array.isArray(vodMatch.entry.vods) ? vodMatch.entry.vods : [];
    const vodIndex = Number(vodMatch && vodMatch.vodIndex);
    if (Number.isInteger(vodIndex) && vods.length > 1) {
      return groups[vodIndex] ? groups[vodIndex].items : [];
    }
    return groups.length === 1 ? groups[0].items : [];
  }

  function vodCategoryGroup(vodMatch) {
    const items = getCategoryHistoryItems();
    const scheduleEntry = vodMatch && vodMatch.entry;
    const vod = vodMatch && vodMatch.vod;
    const liveKey = liveKeyFromVod(vod);
    const scheduleDate = String((scheduleEntry && scheduleEntry.date) || "").trim();
    if (!items.length || (!liveKey && !vodStartedAt(vod) && !scheduleDate)) return [];
    const liveKeyGroup = liveKey ? items.filter((item) => item && categoryHistoryLiveKey(item) === liveKey) : [];
    const startedAtGroup = liveKeyGroup.length ? [] : categoryItemsForVodStartedAt(items, vod);
    const scopedGroup = liveKeyGroup.length ? liveKeyGroup : (startedAtGroup.length ? startedAtGroup : dateCategoryGroupForVod(items, vodMatch, scheduleDate));
    const seen = new Set();
    return scopedGroup.slice().sort((a, b) => String(a.changedAt || "").localeCompare(String(b.changedAt || "")) || String(a.id || "").localeCompare(String(b.id || ""))).filter((item) => {
      const key = String(item.categoryType || "") + "|" + String(item.categoryId || "") + "|" + String(item.categoryLabel || "").trim().toLowerCase() + "|" + String(item.offsetSeconds ?? "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 10);
  }

  function isChzzkVodPage() {
    return /^\/[0-9a-f]{32}\/videos(?:\/|$)?/i.test(location.pathname) || /^\/video\/[0-9]+(?:\/|$)?/i.test(location.pathname);
  }

  function formatVodOffset(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  }

  function findLatestVodCardSlots() {
    const detailsList = Array.from(document.querySelectorAll('[class*="_details"]')).filter((el) => {
      if (!hasClassPrefix(el, "_details")) return false;
      if (el.closest("#obaengal-vod-category-host")) return false;
      if (el.closest('[class*="pzp"]')) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 120 && rect.height > 0;
    });
    for (const details of detailsList) {
      const parent = details.parentElement;
      if (!parent) continue;
      const children = Array.from(parent.children || []);
      const index = children.indexOf(details);
      if (index < 0) continue;
      const container = children.slice(index + 1).find((child) => hasClassPrefix(child, "_container"));
      const card = details.closest("a") || parent.closest("a") || parent;
      if (container) return { details, container, parent, card, insertBefore: container };
      if (/^\/video\/[0-9]+(?:\/|$)?/i.test(location.pathname)) return { details, container: null, parent, card, insertAfter: details };
    }

    if (/^\/video\/[0-9]+(?:\/|$)?/i.test(location.pathname)) {
      const title = Array.from(document.querySelectorAll('[class*="_title"]')).find((el) => {
        if (!hasClassPrefix(el, "_title")) return false;
        if (el.closest("#obaengal-vod-category-host") || el.closest('[class*="pzp"]')) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 120 && rect.height > 0;
      });
      if (title && title.parentElement) return { details: title, container: null, parent: title.parentElement, card: title.parentElement, insertAfter: title };

      const player = document.querySelector(".webplayer-internal-video") || document.querySelector("video");
      const anchor = player && (player.closest('[class*="_container"], [class*="_player"], [class*="video"]') || player.parentElement);
      if (anchor && anchor.parentElement) return { details: anchor, container: null, parent: anchor.parentElement, card: anchor.parentElement, insertAfter: anchor };

      const main = document.querySelector("main") || document.body;
      if (main) return { details: main.firstElementChild || main, container: null, parent: main, card: main, appendTo: main };
    }
    return null;
  }

  function findVodCardUrl(card) {
    const link = card && (card.matches && card.matches("a") ? card : card.querySelector && card.querySelector('a[href*="/video/"]'));
    const href = link && link.getAttribute("href");
    if (!href) return "";
    try { return new URL(href, location.origin).href; } catch (_e) { return href; }
  }

  function seekVideoToOffset(offsetSeconds) {
    const seconds = Math.max(0, Math.floor(Number(offsetSeconds) || 0));
    const videos = Array.from(document.querySelectorAll("video"));
    const target = videos.map((video) => ({ video, rect: video.getBoundingClientRect() })).filter((item) => item.rect.width >= 240 && item.rect.height >= 120).sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0];
    if (!target) return false;
    try {
      target.video.currentTime = seconds;
      const playResult = target.video.play && target.video.play();
      if (playResult && typeof playResult.catch === "function") playResult.catch(() => {});
      return true;
    } catch (_e) { return false; }
  }

  function schedulePendingVodSeek(offsetSeconds) {
    try { sessionStorage.setItem(VOD_CATEGORY_SEEK_KEY, JSON.stringify({ offsetSeconds: Math.max(0, Math.floor(Number(offsetSeconds) || 0)), createdAt: Date.now() })); } catch (_e) {}
  }

  function applyPendingVodSeek() {
    let payload = null;
    try { payload = JSON.parse(sessionStorage.getItem(VOD_CATEGORY_SEEK_KEY) || "null"); } catch (_e) { payload = null; }
    if (!payload || Date.now() - Number(payload.createdAt || 0) > 120000) return;
    if (seekVideoToOffset(payload.offsetSeconds)) {
      try { sessionStorage.removeItem(VOD_CATEGORY_SEEK_KEY); } catch (_e) {}
    }
  }

  function handleVodCategoryClick(item, card) {
    const offsetSeconds = Math.max(0, Math.floor(Number(item && item.offsetSeconds) || 0));
    if (seekVideoToOffset(offsetSeconds)) return;
    schedulePendingVodSeek(offsetSeconds);
    const url = findVodCardUrl(card);
    if (url) window.location.href = url;
  }

  function removeVodCategoryInfoPopover() {
    clearTimeout(state.vodCategoryInfoHideTimer);
    state.vodCategoryInfoHideTimer = null;
    if (state.vodCategoryInfoPopover && state.vodCategoryInfoPopover.isConnected) state.vodCategoryInfoPopover.remove();
    state.vodCategoryInfoPopover = null;
  }

  function showVodCategoryInfoPopover(anchor) {
    clearTimeout(state.vodCategoryInfoHideTimer);
    let pop = state.vodCategoryInfoPopover;
    if (!pop || !pop.isConnected) {
      pop = document.createElement("div");
      pop.id = "obaengal-vod-category-info-popover";
      pop.setAttribute("role", "tooltip");
      pop.textContent = "\uBC29\uC1A1 \uC911 \uC2A4\uD2B8\uB9AC\uBA38\uAC00 \uCE74\uD14C\uACE0\uB9AC\uB97C \uBCC0\uACBD\uD588\uB358 \uC2DC\uC810\uC744 \uAE30\uC900\uC73C\uB85C \uCC55\uD130\uAC00 \uC0DD\uC131\uB429\uB2C8\uB2E4.";
      pop.style.cssText = "position:fixed;z-index:2147483647;box-sizing:border-box;width:max-content;max-width:min(300px,calc(100vw - 24px));padding:8px 10px;border:1px solid rgba(132,255,193,.42);border-radius:7px;background:rgba(8,12,16,.98);color:#effff7;font:700 11px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:0 12px 32px rgba(0,0,0,.38);pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .14s ease,transform .14s ease;";
      document.body.appendChild(pop);
      state.vodCategoryInfoPopover = pop;
    }
    const rect = anchor.getBoundingClientRect();
    pop.style.opacity = "0";
    pop.style.left = "0px";
    pop.style.top = "0px";
    requestAnimationFrame(() => {
      if (!pop || !pop.isConnected) return;
      const margin = 12;
      const popRect = pop.getBoundingClientRect();
      const left = Math.max(margin, Math.min(window.innerWidth - popRect.width - margin, rect.left + rect.width / 2 - popRect.width / 2));
      const top = rect.top >= popRect.height + margin + 8 ? rect.top - popRect.height - 8 : rect.bottom + 8;
      pop.style.left = left + "px";
      pop.style.top = Math.max(margin, Math.min(window.innerHeight - popRect.height - margin, top)) + "px";
      pop.style.opacity = "1";
      pop.style.transform = "translateY(0)";
    });
  }

  function hideVodCategoryInfoPopover() {
    clearTimeout(state.vodCategoryInfoHideTimer);
    state.vodCategoryInfoHideTimer = setTimeout(removeVodCategoryInfoPopover, 80);
  }

  function removeVodCategoryHost() {
    removeVodCategoryInfoPopover();
    if (state.vodCategoryHost && state.vodCategoryHost.isConnected) state.vodCategoryHost.remove();
    state.vodCategoryHost = null;
  }

  function syncVodCategoryButtons() {
    if (!isChzzkVodPage()) {
      removeVodCategoryHost();
      applyPendingVodSeek();
      return;
    }
    const vodMatch = currentVodScheduleMatch();
    const items = vodMatch ? vodCategoryGroup(vodMatch) : [];
    const slot = items.length ? findLatestVodCardSlots() : null;
    if (!slot) {
      removeVodCategoryHost();
      return;
    }
    if (state.vodCategoryHost && state.vodCategoryHost.isConnected && ((slot.insertBefore && state.vodCategoryHost.previousElementSibling === slot.details && state.vodCategoryHost.nextElementSibling === slot.insertBefore) || (slot.insertAfter && state.vodCategoryHost.previousElementSibling === slot.insertAfter) || (slot.appendTo && state.vodCategoryHost.parentElement === slot.appendTo))) return;
    removeVodCategoryHost();
    const host = document.createElement("div");
    host.id = "obaengal-vod-category-host";
    host.style.display = "block";
    const shadow = host.attachShadow({ mode: "open" });
    const buttons = items.map((item, index) => {
      const label = escapeHtml(String(item.categoryLabel || "\uCE74\uD14C\uACE0\uB9AC").trim());
      const time = item.offsetSeconds === null || item.offsetSeconds === undefined ? "" : '<span class="ovc-time">' + escapeHtml(formatVodOffset(item.offsetSeconds)) + '</span>';
      return '<button type="button" class="ovc-button" data-index="' + index + '" aria-label="' + label + ' \uC2DC\uC810\uC73C\uB85C \uC774\uB3D9">' + time + '<span class="ovc-label">' + label + '</span><span class="ovc-tip" role="tooltip">\uC774 \uC2DC\uC810\uC73C\uB85C \uC774\uB3D9</span></button>';
    }).join("");
    shadow.innerHTML = '<style>' +
      ':host{display:block;margin:8px 0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
      '.ovc-wrap{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.ovc-heading-group{position:relative;display:inline-flex;align-items:center;gap:4px;min-height:28px;padding:0 7px 0 9px;border-radius:7px;background:rgba(255,255,255,.08);color:#d9e8df;font-size:12px;font-weight:800;line-height:1;white-space:nowrap}.ovc-info{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:17px;height:17px;border:1px solid rgba(217,232,223,.34);border-radius:50%;background:rgba(255,255,255,.06);color:#aee8ce;font-size:11px;font-weight:900;line-height:1;cursor:default}.ovc-info:hover,.ovc-info:focus-visible{border-color:rgba(134,244,187,.82);background:rgba(0,255,163,.14);color:#effff7;outline:none}' +
      '.ovc-button{appearance:none;position:relative;display:inline-flex;align-items:center;gap:6px;min-height:28px;padding:0 10px;border:1px solid rgba(0,255,163,.45);border-radius:999px;background:rgba(9,14,18,.92);color:#f2fff8;font-size:12px;font-weight:750;line-height:1;white-space:nowrap;cursor:pointer;box-shadow:0 6px 16px rgba(0,0,0,.18);transition:transform .14s ease,border-color .14s ease,background .14s ease}' +
      '.ovc-button:hover{transform:translateY(-1px);border-color:rgba(108,255,190,.92);background:rgba(16,31,29,.98)}' +
      '.ovc-time{color:#86f4bb;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums}.ovc-label{display:inline-flex;min-width:0}.ovc-tip{position:absolute;left:50%;bottom:calc(100% + 8px);z-index:2;display:block;width:max-content;max-width:220px;padding:7px 9px;border:1px solid rgba(132,255,193,.38);border-radius:7px;background:rgba(8,12,16,.96);color:#effff7;font-size:11px;font-weight:700;line-height:1.35;box-shadow:0 10px 28px rgba(0,0,0,.34);opacity:0;visibility:hidden;transform:translate(-50%,4px);transition:opacity .14s ease,transform .14s ease,visibility .14s ease;pointer-events:none}.ovc-tip:after{content:"";position:absolute;left:50%;top:100%;width:8px;height:8px;background:rgba(8,12,16,.96);border-right:1px solid rgba(132,255,193,.38);border-bottom:1px solid rgba(132,255,193,.38);transform:translate(-50%,-4px) rotate(45deg)}.ovc-button:hover .ovc-tip,.ovc-button:focus-visible .ovc-tip{opacity:1;visibility:visible;transform:translate(-50%,0)}' +
      '</style><div class="ovc-wrap"><span class="ovc-heading-group"><span class="ovc-heading">\uCC55\uD130 \uC774\uB3D9</span><button type="button" class="ovc-info" aria-label="\uCC55\uD130 \uC0DD\uC131 \uAE30\uC900" tabindex="0">i</button></span>' + buttons + '</div>';
    const infoButton = shadow.querySelector(".ovc-info");
    if (infoButton) {
      infoButton.addEventListener("mouseenter", () => showVodCategoryInfoPopover(infoButton));
      infoButton.addEventListener("mouseleave", hideVodCategoryInfoPopover);
      infoButton.addEventListener("focus", () => showVodCategoryInfoPopover(infoButton));
      infoButton.addEventListener("blur", hideVodCategoryInfoPopover);
      infoButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
    }
    shadow.querySelectorAll(".ovc-button").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const index = Number(button.getAttribute("data-index"));
        handleVodCategoryClick(items[index], slot.card);
      });
    });
    if (slot.insertBefore && slot.insertBefore.parentElement) slot.insertBefore.parentElement.insertBefore(host, slot.insertBefore);
    else if (slot.insertAfter && slot.insertAfter.parentElement) slot.insertAfter.insertAdjacentElement("afterend", host);
    else if (slot.appendTo) slot.appendTo.appendChild(host);
    else return;
    state.vodCategoryHost = host;
  }

  function setChannelSchedulePanelOpen(open) {
    if (!state.shadow) return false;
    const button = state.shadow.getElementById("cs-channel-button");
    const panel = state.shadow.getElementById("cs-channel-panel");
    if (button && panel) {
      panel.classList.toggle("cs-open", open);
      button.classList.toggle("cs-open", open);
      button.setAttribute("aria-expanded", String(open));
      return true;
    }
    const floatPanel = state.shadow.getElementById("cs-float-panel");
    if (floatPanel) {
      floatPanel.classList.toggle("cs-open", open);
      return true;
    }
    if (state.extensionCollapsed && open) {
      state.extensionCollapsed = false;
      saveExtensionCollapsed(false);
      render();
    }
    return false;
  }

  async function applyPendingScheduleOpenRequest() {
    if (state.openScheduleRequestConsumed || !state.channelId || !state.host) return;
    const response = await sendRuntimeMessage({ type: "consumeOpenScheduleRequest", channelId: state.channelId });
    state.openScheduleRequestConsumed = true;
    if (response && response.ok && response.open) {
      state.schedulePanelForcedOpen = true;
      setChannelSchedulePanelOpen(true);
    }
  }
  function mountInline(anchor) {
    const host = createHost();
    anchor.insertAdjacentElement("afterend", host);
    state.mode = "inline";
    syncPageTheme();
    render();
    if (state.schedulePanelForcedOpen) setChannelSchedulePanelOpen(true);
    syncTitleHistoryButton();
    syncVodCategoryButtons();
    applyPendingScheduleOpenRequest();
  }

  function mountChannelButton(action) {
    const host = createHost();
    action.insertBefore(host, action.firstChild);
    state.mode = "channel-button";
    syncPageTheme();

    const root = state.shadow.getElementById("cs-root");
    const launch = document.createElement("div");
    launch.className = "cs-channel-launch";
    launch.innerHTML =
      '<button type="button" class="cs-channel-button" id="cs-channel-button" aria-expanded="false">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4M8 3v4M3 10h18"></path></svg>' +
      '<span>일정보기</span></button>' +
      '<div class="cs-channel-panel" id="cs-channel-panel"></div>';
    state.shadow.insertBefore(launch, root);
    state.shadow.getElementById("cs-channel-panel").appendChild(root);

    const button = state.shadow.getElementById("cs-channel-button");
    const panel = state.shadow.getElementById("cs-channel-panel");
    button.addEventListener("click", () => {
      const open = panel.classList.toggle("cs-open");
      state.schedulePanelForcedOpen = open;
      button.classList.toggle("cs-open", open);
      button.setAttribute("aria-expanded", String(open));
    });
    render();
    if (state.schedulePanelForcedOpen) setChannelSchedulePanelOpen(true);
    syncTitleHistoryButton();
    syncVodCategoryButtons();
    applyPendingScheduleOpenRequest();
  }

  function mountFloating() {
    const host = createHost();
    document.body.appendChild(host);
    state.mode = "floating";
    syncPageTheme();

    const root = state.shadow.getElementById("cs-root");
    const wrap = document.createElement("div");
    wrap.innerHTML =
      '<button class="cs-float-btn" id="cs-float-btn" title="방송 일정">▦</button>' +
      '<div class="cs-float-panel" id="cs-float-panel"><div id="cs-root-inner"></div></div>';
    state.shadow.insertBefore(wrap, root);

    // 플로팅 모드에서는 패널 내부를 렌더 타깃으로 교체
    root.remove();
    const inner = state.shadow.getElementById("cs-root-inner");
    inner.id = "cs-root";

    const btn = state.shadow.getElementById("cs-float-btn");
    const panel = state.shadow.getElementById("cs-float-panel");
    btn.addEventListener("click", () => {
      const open = panel.classList.toggle("cs-open");
      state.schedulePanelForcedOpen = open;
    });

    render();
    if (state.schedulePanelForcedOpen) setChannelSchedulePanelOpen(true);
    syncTitleHistoryButton();
    syncVodCategoryButtons();
    applyPendingScheduleOpenRequest();
  }

  function unmount() {
    if (state.feedbackOutsideHandler) {
      document.removeEventListener("mousedown", state.feedbackOutsideHandler);
      state.feedbackOutsideHandler = null;
    }
    if (state.scheduleOutsideHandler) {
      document.removeEventListener("mousedown", state.scheduleOutsideHandler);
      state.scheduleOutsideHandler = null;
    }
    removeTitleHistoryHost();
    removeVodCategoryHost();
    if (state.host && state.host.isConnected) state.host.remove();
    state.host = null;
    state.shadow = null;
    state.mode = null;
  }

  // ----------------------------------------------------------
  // 데이터 로드 + 초기화 + SPA 감시
  // ----------------------------------------------------------
  async function refreshData(force) {
    const res = await loadSchedule(force);
    if (res && res.ok && res.data) {
      state.data = res.data;
      state.targetLiveNotificationsEnabled = res.data.targetLiveNotificationsEnabled !== false;
      state.targetLiveNotificationsPublicEnabled = res.data.targetLiveNotificationsPublicEnabled === true;
      const announcedVersion = String(res.data.latestExtensionVersion || "").trim();
      if (announcedVersion && compareVersions(announcedVersion, EXTENSION_VERSION) > 0) {
        const updateCheck = await sendRuntimeMessage({
          type: state.updateCheckAttempted ? "getDeployedUpdate" : "checkDeployedUpdate",
        });
        state.updateCheckAttempted = true;
        state.deployedExtensionVersion = String((updateCheck && updateCheck.version) || "").trim();
      } else {
        state.deployedExtensionVersion = "";
      }
      state.fetchedAt = res.fetchedAt;
      const dataChannelId = getCurrentDataChannelId();
      state.channel =
        (res.data.channels && dataChannelId && res.data.channels[dataChannelId]) || null;
      indexSchedule();
      return true;
    }
    return false;
  }

  let anchorRetries = 0;
  const MAX_ANCHOR_RETRIES = 10; // 약 8초간 인라인 앵커를 기다린 뒤 플로팅 폴백
  let lastLoadAttempt = 0;
  let loggedMissingChannel = false;

  async function tryMount() {
    if (state.host) return;

    const channelId = getChannelIdFromUrl();
    if (!channelId) return;

    if (state.channelId !== channelId) {
      state.channelId = channelId;
      state.channel = null;
      state.pageOffset = 0;
      state.openScheduleRequestConsumed = false;
      state.schedulePanelForcedOpen = false;
      loggedMissingChannel = false;
    }

    // 데이터가 없거나 채널을 못 찾은 상태면 3초 간격으로 계속 재시도
    // (백그라운드 워커가 늦게 깨어나거나 일시적 네트워크 오류여도 복구됨)
    if (!state.channel) {
      const now = Date.now();
      if (now - lastLoadAttempt < 3000) return;
      lastLoadAttempt = now;

      const ok = await refreshData(false);
      if (!ok) {
        return;
      }
      if (!state.channel) {
        if (!loggedMissingChannel) {
          loggedMissingChannel = true;
          const keys = Object.keys((state.data && state.data.channels) || {});
        }
        return;
      }
    }

    const offlineAction = findOfflineActionAnchor();
    const anchor = findAnchor();
    if (offlineAction) {
      anchorRetries = 0;
      mountChannelButton(offlineAction);
    } else if (anchor) {
      anchorRetries = 0;
      mountInline(anchor);
    } else if (anchorRetries >= MAX_ANCHOR_RETRIES) {
      mountFloating();
    } else {
      anchorRetries += 1;
    }
  }

  function watch() {
    let lastHref = "";
    setInterval(() => {
      syncFullscreenVisibility();
      // 전체화면 DOM을 기준으로 앵커를 다시 잡지 않도록 마운트 감시를 일시 중단한다.
      if (isFullscreenActive() || fullscreenRestorePending) return;

      // 1) 날짜가 바뀌면 (자정) 오늘 기준으로 다시 렌더
      const nowKey = dateKey(todayDate());
      if (nowKey !== state.todayKey) {
        state.todayKey = nowKey;
        state.pageOffset = 0;
        if (state.shadow) render();
      }

      // 2) SPA 페이지 이동 감지
      if (location.href !== lastHref) {
        lastHref = location.href;
        const channelId = getChannelIdFromUrl();
        if (channelId !== state.channelId || !channelId) {
          unmount();
          state.channelId = null;
          state.channel = null;
          anchorRetries = 0;
        }
      }

      // 3) 마운트 유지: 치지직이 DOM을 갈아끼워 host가 사라졌으면 재마운트
      if (isChzzkVodPage()) {
        const now = Date.now();
        if (!state.data && now - lastLoadAttempt >= 3000) {
          lastLoadAttempt = now;
          refreshData(false).then(() => syncVodCategoryButtons()).catch(() => syncVodCategoryButtons());
        } else {
          syncVodCategoryButtons();
        }
        applyPendingVodSeek();
      }

      if (state.host && !state.host.isConnected) {
        state.host = null;
        state.shadow = null;
        anchorRetries = 0;
      }
      if (!state.host) tryMount();
      if (state.host) {
        syncPageTheme();
        applyPendingScheduleOpenRequest();
        syncTitleHistoryButton();
        syncVodCategoryButtons();
      }

      // 비라이브 채널은 _action 버튼 모드, 라이브 화면은 기존 인라인 모드로 자동 전환
      const offlineAction = findOfflineActionAnchor();
      if (state.host && offlineAction && state.mode !== "channel-button") {
        unmount();
        mountChannelButton(offlineAction);
      } else if (state.host && !offlineAction && state.mode === "channel-button") {
        unmount();
        anchorRetries = 0;
        tryMount();
      }

      // 4) 플로팅 모드로 뜬 뒤에도 앵커가 나타나면 인라인으로 자동 승격
      if (state.mode === "floating" && !offlineAction) {
        const anchor = findAnchor();
        if (anchor) {
          unmount();
          mountInline(anchor);
        }
      }
    }, 800);
  }

  let autoRefreshInFlight = false;
  let lastAutoRefreshAttempt = 0;

  async function runAutoRefreshIfDue() {
    if (document.visibilityState !== "visible" || isFullscreenActive() || fullscreenRestorePending ||
        !state.channelId || !state.host || autoRefreshInFlight) return;
    const cfg = typeof CHZZK_SCHEDULE_CONFIG !== "undefined" ? CHZZK_SCHEDULE_CONFIG : {};
    const minutes = Math.max(0.5, Number(cfg.autoRefreshMinutes || cfg.cacheTtlMinutes || 0.5) || 0.5);
    const interval = minutes * 60 * 1000;
    const fetchedAt = typeof state.fetchedAt === "number" ? state.fetchedAt : Date.parse(state.fetchedAt || "") || 0;
    if (Date.now() - Math.max(fetchedAt, lastAutoRefreshAttempt) < interval) return;

    lastAutoRefreshAttempt = Date.now();
    autoRefreshInFlight = true;
    try {
      const beforeFingerprint = currentViewFingerprint();
      const lolScrollTop = state.scheduleViewMode === "lolMatchLogs" ? captureLolLogScroll() : 0;
      const updated = await refreshData(true);
      if (updated && state.shadow && shouldRenderAfterAutoRefresh(beforeFingerprint)) {
        render();
        restoreLolLogScroll(lolScrollTop);
      }
    } catch (e) {
    } finally {
      autoRefreshInFlight = false;
    }
  }

  function startAutoRefresh() {
    setInterval(runAutoRefreshIfDue, 5000);
    setInterval(rotateNoticeIfNeeded, 3000);
    setInterval(applyPendingVodSeek, 700);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") runAutoRefreshIfDue();
    });
  }

  state.todayKey = dateKey(todayDate());
  document.addEventListener("fullscreenchange", syncFullscreenVisibility);
  document.addEventListener("webkitfullscreenchange", syncFullscreenVisibility);
  watch();
  startAutoRefresh();
  startLiveStartWatcher();
})();
