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
  const BREAK_ICON_URL = api.runtime.getURL("icons/on_break.png");
  const UNDETERMINED_ICON_URL = api.runtime.getURL("icons/undetermined.png");
  const NAVER_CAFE_ICON_URL = api.runtime.getURL("icons/naver_cafe.png");
  const VIDEO_DONATION_ICON_URL = api.runtime.getURL("icons/video_donation.png");

  // ----------------------------------------------------------
  // 상태
  // ----------------------------------------------------------
  const state = {
    data: null,          // schedule.json 전체
    fetchedAt: null,
    channelId: null,     // 현재 페이지의 채널 ID
    channel: null,       // data.channels[channelId]
    byDate: new Map(),   // "YYYY-MM-DD" -> entry
    pageOffset: 0,       // 0 = 오늘 페이지, -1 = 5일 전 페이지 ...
    monthExpanded: false,
    monthOffset: 0,
    gameOnly: false,
    host: null,          // shadow host element
    shadow: null,
    mode: null,          // "inline" | "floating"
    todayKey: null,
    popoverTimer: null,
    popoverCloseTimer: null,
    pageTheme: null,
    feedbackOpen: false,
    feedbackDraft: { type: "일정", message: "", relatedLink: "", contact: "" },
    feedbackOutsideHandler: null,
  };

  const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];
  const PAGE_SIZE = 5;

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

  function loadSchedule(force) {
    return sendRuntimeMessage({ type: "getSchedule", force: !!force });
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
      return { cls: "cs-pill-unknown", html: '<img class="cs-undetermined-icon cs-undetermined-icon-pill" src="' + UNDETERMINED_ICON_URL + '" alt="" />오늘 방송 미정' };
    }
    if (e.status === "off") {
      return { cls: "cs-pill-off", html: '<img class="cs-break-icon cs-break-icon-pill" src="' + BREAK_ICON_URL + '" alt="" />오늘 휴방' };
    }
    if (e.start) {
      return { cls: "cs-pill-on", html: '<span class="cs-dot"></span>오늘 방송 ' + escapeHtml(e.start) };
    }
    return { cls: "cs-pill-on", html: '<span class="cs-dot"></span>오늘 방송 예정 (시간 미정)' };
  }

  // ----------------------------------------------------------
  // 스타일 (Shadow DOM 내부에만 적용)
  // ----------------------------------------------------------
  const STYLE = `
    :host { all: initial; }
    :host(.cs-fullscreen-hidden) { display: none !important; }
    * { box-sizing: border-box; margin: 0; padding: 0;
        font-family: "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
    #cs-root { position: relative; }

    .cs-wrapper { position: relative; background: #1b1c1f; border: 1px solid #2e3033;
      border-radius: 10px; margin: 0 30px 20px; }
    .cs-section { position: relative; padding: 12px 14px; }
    .cs-schedule-section { border-radius: 10px; }
    .cs-info-section { padding: 14px; border-top: 1px solid #2e3033;
      background: rgba(15,16,18,0.28); }

    .cs-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .cs-title { color: #efeff1; font-size: 16px; font-weight: 600; }
    .cs-spacer { flex: 1; }

    .cs-pill { display: inline-flex; align-items: center; gap: 5px; font-size: 13px;
      font-weight: 600; padding: 3px 10px; border-radius: 10px; line-height: 1.4; }
    .cs-pill-on { background: rgba(0,255,163,0.12); color: #00FFA3; }
    .cs-pill-on .cs-dot { background: #00FFA3; }
    .cs-pill-unknown { background: rgba(232,194,104,0.12); color: #e8c268; }
    .cs-pill-unknown .cs-dot { background: #e8c268; }
    .cs-pill-off { background: rgba(157,158,163,0.12); color: #9d9ea3; }
    .cs-dot { width: 5px; height: 5px; border-radius: 50%; }
    .cs-break-icon { display: block; object-fit: contain; border-radius: 4px; }
    .cs-break-icon-pill { width: 16px; height: 16px; }
    .cs-cell-time .cs-break-icon { width: 31%; height: 100%; margin: 0 auto; }
    .cs-undetermined-icon { display: block; object-fit: contain; }
    .cs-undetermined-icon-pill { width: 16px; height: 16px; }
    .cs-cell-time .cs-undetermined-icon { width: 31%; height: 100%; margin: 0 auto; }

    .cs-arrow { background: none; border: none; cursor: pointer; color: #00FFA3;
      font-size: 20px; line-height: 1; padding: 2px 4px; }
    .cs-arrow:disabled { color: #4a4c52; cursor: default; }
    .cs-view-toggle { flex: 0 0 auto; border: 1px solid #3a3c40; border-radius: 7px;
      background: #232427; color: #c9cacd; padding: 5px 9px; font-size: 11px; font-weight: 700; cursor: pointer; white-space: nowrap; }
    .cs-view-toggle:hover, .cs-view-toggle.cs-open { color: #efeff1; background: #2b2d31; border-color: #4a4c52; }
    .cs-game-toggle.cs-open { color: #062b20; background: #00c878; border-color: #00c878; }
    .cs-month-label { color: #9d9ea3; font-size: 12px; font-weight: 700; white-space: nowrap; }

    .cs-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
    .cs-month-grid { grid-template-columns: repeat(7, minmax(0, 1fr)); }
    .cs-month-weekday { color: #6b6d73; font-size: 11px; font-weight: 700; text-align: center; padding: 2px 0 4px; }
    .cs-month-blank { min-height: 88px; border-radius: 8px; background: rgba(255,255,255,0.02); }
    .cs-month-grid .cs-month-cell { min-height: 88px; padding: 9px 8px 24px; text-align: left; }
    .cs-month-cell .cs-cell-date { font-size: 12px; font-weight: 700; }
    .cs-month-cell .cs-cell-time { margin-top: 7px; font-size: 12px; }
    .cs-month-cell .cs-cell-title { margin-top: 4px; font-size: 12px; line-height: 1.35; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    .cs-month-cell .cs-cell-part { gap: 4px; margin-top: 4px; }
    .cs-month-cell .cs-part-tag { font-size: 10px; padding: 2px 4px; border-radius: 6px; }
    .cs-month-cell .cs-part-text { font-size: 12px; line-height: 1.35; }
    .cs-game-list { display: grid; grid-template-columns: repeat(var(--cs-game-count, 1), minmax(0, 1fr)); gap: 5px; margin-top: 8px; align-content: start; }
    .cs-game-list-many { height: 92px; overflow: hidden; }
    .cs-game-card { min-width: 0; text-decoration: none; color: inherit; overflow: hidden; }
    .cs-game-card img { display: block; width: 200%; max-width: none; height: 92px; object-fit: cover; object-position: center center; margin-left: 50%; transform: translateX(-50%); border-radius: 6px; border: 1px solid #3a3c40; background: #111214; }
    .cs-game-list-many .cs-game-card img { width: calc(var(--cs-game-count, 1) * 200%); }
    .cs-game-name { display: block; margin-top: 3px; color: #c9cacd; font-size: 10px; font-weight: 700; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cs-game-list-many .cs-game-name { display: none; }
    .cs-month-cell .cs-game-list { grid-template-columns: repeat(var(--cs-game-count, 1), minmax(0, 1fr)); gap: 3px; margin-top: 5px; }
    .cs-month-cell .cs-game-list-many { height: 48px; overflow: hidden; }
    .cs-month-cell .cs-game-card img { height: 48px; border-radius: 4px; }
    .cs-month-cell .cs-game-list-many .cs-game-card img { width: calc(var(--cs-game-count, 1) * 200%); }
    .cs-month-cell .cs-game-name { display: none; }
    .cs-game-empty { color: #6b6d73; font-size: 13px; font-weight: 700; margin-top: 10px; text-align: center; }
    .cs-pop-game-image { display: block; max-width: 240px; max-height: 135px; margin: 6px 0 8px; border: 1px solid #3a3c40; border-radius: 8px; object-fit: cover; background: #111214; }

    .cs-cell { position: relative; background: #232427; border: 1px solid transparent;
      border-radius: 8px; padding: 16px; padding-right: 30px; text-align: center; min-height: 66px; }
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
    .cs-cell-part { display: flex; align-items: center; gap: 5px; margin-top: 5px; text-align: left; }
    .cs-cell-date-row + .cs-cell-part { margin-top: 14px; }
    .cs-part-tag { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 3px;
      color: #00FFA3; background: rgba(0,255,163,0.12);
      font-size: 12px; font-weight: 500; border-radius: 8px; padding: 4px 6px; }
    .cs-part-tag-collab { color: #c4b5fd; background: rgba(167,139,250,0.22); }
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
      background: rgba(147,197,253,0.1); color: #bfdbfe; font: inherit; font-size: 0.92em; font-weight: 700;
      line-height: 18px; vertical-align: middle; text-decoration: none; cursor: pointer; overflow: hidden; }
    .cs-inline-media-trigger::before { content: "✦"; flex: 0 0 auto; color: #93c5fd; font-size: 0.9em; line-height: 1; }
    .cs-inline-media-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cs-inline-media-trigger:hover, .cs-inline-media-trigger.cs-open { border-color: rgba(147,197,253,0.62); background: rgba(147,197,253,0.18); color: #dbeafe; }
    .cs-media-popover { position: absolute; z-index: 2147483647; display: none; width: min(420px, calc(100% - 16px));
      max-height: min(70vh, 460px); margin: 0; padding: 10px; border: 1px solid #3a3c40; border-radius: 10px;
      background: #1b1c1f; box-shadow: 0 12px 34px rgba(0,0,0,0.48); }
    .cs-media-popover.cs-open { display: block; }
    .cs-media-popover.cs-media-expanded { width: min(760px, 100%); max-height: none; }
    .cs-media-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .cs-media-title { flex: 1 1 auto; min-width: 0; color: #efeff1; font-size: 12px; font-weight: 700;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cs-media-close { flex: 0 0 auto; border: 0; background: none; color: #9d9ea3; font-size: 18px; line-height: 1; cursor: pointer; }
    .cs-media-body img, .cs-media-body video, .cs-media-body iframe { display: block; width: 100%; max-height: 360px;
      border: 0; border-radius: 8px; background: #0f1012; object-fit: contain; }
    .cs-media-body img.cs-media-expandable { cursor: zoom-in; }
    .cs-media-popover.cs-media-expanded .cs-media-body img.cs-media-expandable { max-height: min(75vh, 720px); cursor: zoom-out; }
    .cs-media-viewer { position: fixed; inset: 0; z-index: 2147483647; display: none; padding: 24px;
      background: rgba(0,0,0,0.78); overflow: auto; cursor: zoom-out; }
    .cs-media-viewer.cs-open { display: block; }
    .cs-media-viewer img { display: block; width: auto; height: auto; max-width: none; max-height: none;
      margin: 0 auto; border-radius: 8px; background: #0f1012; box-shadow: 0 18px 48px rgba(0,0,0,0.5); cursor: default; }
    .cs-media-body iframe { aspect-ratio: 16 / 9; height: auto; }
    .cs-media-link { color: #93c5fd; font-size: 12px; overflow-wrap: anywhere; }

    .cs-cell-today { background: rgba(0,255,163,0.08); border-color: rgba(0,255,163,0.45); }
    .cs-cell-today .cs-cell-date,
    .cs-cell-today .cs-cell-time { color: #00FFA3; }
    .cs-cell-today .cs-cell-title,
    .cs-cell-today .cs-part-text { color: #efeff1; }

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

    .cs-footer { display: flex; align-items: center; justify-content: flex-end;
      gap: 6px; padding: 9px 14px; border-top: 1px solid #2e3033;
      border-radius: 0 0 10px 10px; background: rgba(15,16,18,0.45); }
    .cs-notice { display: flex; flex-direction: column; width: 100%; }
    .cs-schedule-notice { flex: 1 1 auto; min-width: 0; margin-right: 12px; color: #6b6d73;
      font-size: 12px; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cs-schedule-notice + .cs-schedule-notice { margin-top: 5px; }
    .cs-updated { flex-shrink: 0; color: #6b6d73; font-size: 11px; }
    .cs-refresh { background: none; border: none; cursor: pointer; color: #6b6d73;
      font-size: 16px; line-height: 1; padding: 2px; }
    .cs-refresh:hover { color: #9d9ea3; }
    .cs-feedback-open { flex: 0 0 auto; border: 1px solid #3a3c40; border-radius: 7px;
      background: #232427; color: #c9cacd; padding: 5px 9px; font-size: 11px; font-weight: 600; cursor: pointer; }
    .cs-feedback-open:hover, .cs-feedback-open.cs-open { color: #efeff1; background: #2b2d31; }
    .cs-feedback-panel { position: absolute; right: 14px; bottom: 48px; z-index: 2147483646;
      width: 330px; padding: 14px; border: 1px solid #3a3c40; border-radius: 10px;
      background: #1b1c1f; box-shadow: 0 10px 30px rgba(0,0,0,0.48); display: none; }
    .cs-feedback-panel.cs-open { display: block; }
    .cs-feedback-head { display: flex; align-items: center; margin-bottom: 12px; }
    .cs-feedback-title { color: #efeff1; font-size: 15px; font-weight: 700; }
    .cs-feedback-close { margin-left: auto; border: 0; background: none; color: #9d9ea3;
      font-size: 20px; line-height: 1; cursor: pointer; }
    .cs-feedback-label { display: block; margin: 9px 0 5px; color: #9d9ea3; font-size: 11px; font-weight: 600; }
    .cs-feedback-input, .cs-feedback-select, .cs-feedback-textarea { display: block; width: 100%;
      border: 1px solid #3a3c40; border-radius: 7px; outline: none; background: #232427;
      color: #efeff1; padding: 8px 9px; font-size: 12px; line-height: 1.4; }
    .cs-feedback-textarea { min-height: 90px; resize: vertical; }
    .cs-feedback-field-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin: 9px 0 5px; }
    .cs-feedback-field-head .cs-feedback-label { margin: 0; }
    .cs-feedback-limit { flex: 0 0 auto; color: #9d9ea3; font-size: 11px; font-weight: 600; }
    .cs-feedback-count { margin-top: 4px; color: #9d9ea3; font-size: 11px; text-align: right; }
    .cs-feedback-count.cs-near-limit { color: #e8c268; }
    .cs-feedback-input:focus, .cs-feedback-select:focus, .cs-feedback-textarea:focus { border-color: #00c878; }
    .cs-feedback-notice { margin: -1px 0 6px; color: #ff7b7b; font-size: 11px; line-height: 1.45; }
    .cs-feedback-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
    .cs-feedback-status { flex: 1 1 auto; min-width: 0; color: #9d9ea3; font-size: 11px; line-height: 1.35; }
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
    .cs-pop-row { display: flex; align-items: center; flex-wrap: nowrap; gap: 6px; min-height: 24px; margin-bottom: 4px; }
    .cs-pop-row:last-child { margin-bottom: 0; }
    .cs-pop-icon { display: inline-flex; align-items: center; gap: 3px;
      color: #9d9ea3; font-size: 12px; line-height: 1.5; }
    .cs-pop-icon-collab { color: #c4b5fd; }
    .cs-pop-icon-speculative { color: #e8c268; }
    .cs-pop-text { color: #c9cacd; font-size: 14px; line-height: 1.5;
      white-space: pre; overflow-wrap: normal; word-break: normal; }
    .cs-pop-note-box { display: flex; align-items: flex-start; gap: 7px; margin-top: 10px;
      padding: 8px 10px; background: #1f2023; border: 1px solid #3a3c40; border-radius: 8px; }
    .cs-pop-note-list { min-width: max-content; display: flex; flex-direction: column; gap: 6px; }
    .cs-pop-note-text { color: #c9cacd; font-size: 14px; line-height: 1.5;
      white-space: pre; overflow-wrap: normal; word-break: normal; }

    .cs-pop-parts-box { margin-top: 8px; padding: 8px 10px; background: #1f2023;
      border: 1px solid #3a3c40; border-radius: 8px; }
    .cs-pop-members { display: flex; flex-wrap: nowrap; justify-content: flex-start; gap: 6px; margin: 4px 0; }
    .cs-member-avatar { position: relative; flex: 0 0 auto; display: inline-flex; align-items: center;
      justify-content: center; width: 22px; height: 22px; vertical-align: middle; line-height: 0;
      text-decoration: none; cursor: default; box-sizing: border-box; }
    a.cs-member-avatar { cursor: pointer; }
    .cs-member-avatar-img { display: block; width: 22px; height: 22px; border-radius: 50%;
      overflow: hidden; border: 1px solid #3a3c40; }
    .cs-member-avatar-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .cs-member-avatar-fallback { display: flex; align-items: center; justify-content: center;
      background: #3a3c40; color: #efeff1; font-size: 11px; font-weight: 700; }
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

    .cs-info-title { color: #efeff1; font-size: 16px; font-weight: 600; margin-bottom: 10px; }
    .cs-info-list { list-style: none; display: flex; flex-direction: column; gap: 8px; }
    .cs-info-item { display: flex; align-items: flex-start; gap: 8px;
      color: #c9cacd; font-size: 14px; line-height: 2; }
    .cs-info-dot { flex: 0 0 auto; width: 5px; height: 5px; border-radius: 50%;
      background: #00FFA3; margin-top: 14px; }
    .cs-info-text { white-space: pre-line; overflow-wrap: anywhere; }

    /* 비라이브 채널 화면: _action 첫 위치의 일정 버튼 + absolute 패널 */
    .cs-channel-launch { position: relative; display: inline-flex; align-items: center; }
    .cs-channel-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; margin-right: 6px;
      height: 36px; padding: 0 12px; border: 1px solid #3a3c40; border-radius: 17px;
      background: #232427; color: #efeff1; font-size: 13px; font-weight: 600; cursor: pointer; }
    .cs-channel-button:hover, .cs-channel-button.cs-open { background: #2b2d31; border-color: #4a4c52; }
    .cs-channel-button svg { width: 16px; height: 16px; color: #00FFA3; }
    .cs-channel-panel { position: absolute; top: calc(100% + 8px); right: -300%;
      width: min(1200px, calc(100vw - 40px)); z-index: 9999; display: none; }
    .cs-channel-panel.cs-open { display: block; }
    .cs-channel-panel .cs-wrapper { margin: 0; box-shadow: 0 8px 28px rgba(0,0,0,0.5); }

    /* 치지직 라이트 모드 */
    :host(.cs-light-theme) .cs-wrapper { background: #ffffff; border-color: #e1e3e6; }
    :host(.cs-light-theme) .cs-section { color: #1e2024; }
    :host(.cs-light-theme) .cs-info-section { background: #f8f9fa; border-color: #e1e3e6; }
    :host(.cs-light-theme) .cs-title,
    :host(.cs-light-theme) .cs-info-title { color: #1e2024; }
    :host(.cs-light-theme) .cs-pill-on { color: #008a43; background: rgba(3,169,80,0.1); }
    :host(.cs-light-theme) .cs-pill-on .cs-dot { background: #03a950; }
    :host(.cs-light-theme) .cs-arrow { color: #008a43; }
    :host(.cs-light-theme) .cs-arrow:disabled { color: #b8bcc1; }
    :host(.cs-light-theme) .cs-view-toggle { background: #ffffff; border-color: #d8dadd; color: #555a61; }
    :host(.cs-light-theme) .cs-view-toggle:hover, :host(.cs-light-theme) .cs-view-toggle.cs-open { background: #eceef0; color: #1e2024; }
    :host(.cs-light-theme) .cs-game-toggle.cs-open { color: #ffffff; background: #03a950; border-color: #03a950; }
    :host(.cs-light-theme) .cs-month-label { color: #6f747b; }
    :host(.cs-light-theme) .cs-month-weekday { color: #8b9097; }
    :host(.cs-light-theme) .cs-month-blank { background: #fafafa; border: 1px solid #f0f1f2; }
    :host(.cs-light-theme) .cs-cell { background: #f5f6f7; border-color: transparent; }
    :host(.cs-light-theme) .cs-cell-hoverable:hover { background: #eceef0; border-color: #d3d6da; }
    :host(.cs-light-theme) .cs-cell-today { background: rgba(0,199,90,0.09); border-color: rgba(0,199,90,0.5); }
    :host(.cs-light-theme) .cs-cell-today.cs-cell-hoverable:hover { background: rgba(0,199,90,0.15); }
    :host(.cs-light-theme) .cs-cell-date,
    :host(.cs-light-theme) .cs-cell-time,
    :host(.cs-light-theme) .cs-cell-title,
    :host(.cs-light-theme) .cs-part-text,
    :host(.cs-light-theme) .cs-pop-text,
    :host(.cs-light-theme) .cs-info-item { color: #4b4f55; }
    :host(.cs-light-theme) .cs-cell-today .cs-cell-date,
    :host(.cs-light-theme) .cs-cell-today .cs-cell-time { color: #008a43; }
    :host(.cs-light-theme) .cs-cell-today .cs-cell-title,
    :host(.cs-light-theme) .cs-cell-today .cs-part-text { color: #1e2024; }
    :host(.cs-light-theme) .cs-cell-muted .cs-cell-time,
    :host(.cs-light-theme) .cs-cell-muted .cs-cell-title,
    :host(.cs-light-theme) .cs-cell-muted .cs-part-text,
    :host(.cs-light-theme) .cs-cell-unknown .cs-cell-title { color: #a3a7ad; }
    :host(.cs-light-theme) .cs-part-tag { color: #008f43; background: rgba(0,199,90,0.1); }
    :host(.cs-light-theme) .cs-part-tag-collab { color: #7557c9; background: rgba(117,87,201,0.12); }
    :host(.cs-light-theme) .cs-part-tag-speculative { color: #9a6b00; background: rgba(232,194,104,0.2); }
    :host(.cs-light-theme) .cs-cell-muted .cs-part-tag { color: #969ba1; background: #e9ebed; border-color: transparent; }
    :host(.cs-light-theme) .cs-text-badge { color: #7557c9; background: rgba(117,87,201,0.1); border-color: rgba(117,87,201,0.25); }
    :host(.cs-light-theme) .cs-game-card img, :host(.cs-light-theme) .cs-pop-game-image { border-color: #d3d6da; background: #f2f3f4; }
    :host(.cs-light-theme) .cs-game-name { color: #33373c; }
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
    :host(.cs-light-theme) .cs-footer { background: #f5f6f7; border-color: #e1e3e6; }
    :host(.cs-light-theme) .cs-schedule-notice,
    :host(.cs-light-theme) .cs-updated { color: #777c83; }
    :host(.cs-light-theme) .cs-refresh { color: #777c83; }
    :host(.cs-light-theme) .cs-refresh:hover { color: #33373c; }
    :host(.cs-light-theme) .cs-feedback-open { background: #ffffff; border-color: #d8dadd; color: #555a61; }
    :host(.cs-light-theme) .cs-feedback-open:hover,
    :host(.cs-light-theme) .cs-feedback-open.cs-open { background: #eceef0; color: #1e2024; }
    :host(.cs-light-theme) .cs-feedback-panel { background: #ffffff; border-color: #d8dadd; box-shadow: 0 10px 30px rgba(0,0,0,0.16); }
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
    :host(.cs-light-theme) .cs-popover { background: #ffffff; border-color: #d8dadd; box-shadow: 0 8px 24px rgba(0,0,0,0.14); }
    :host(.cs-light-theme) .cs-pop-arrow { background: #ffffff; border-color: #d8dadd; }
    :host(.cs-light-theme) .cs-pop-date { color: #1e2024; }
    :host(.cs-light-theme) .cs-pop-parts-box,
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
      .cs-month-grid { gap: 4px; }
      .cs-month-grid .cs-month-cell, .cs-month-blank { min-height: 70px; padding: 7px 6px 22px; }
      .cs-month-cell .cs-cell-time, .cs-month-cell .cs-cell-title, .cs-month-cell .cs-part-text { font-size: 11px; }
      .cs-month-cell .cs-game-name { font-size: 10px; }
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
  function gameItems(entry) {
    return ((entry && entry.gameImages) || []).filter((item) => item && safeMediaUrl(item.url));
  }

  function gameImagesHtml(entry, compact) {
    const games = gameItems(entry);
    if (!games.length) return compact ? "" : '<div class="cs-game-empty">\uAC8C\uC784 \uC5C6\uC74C</div>';
    const classes = ["cs-game-list"];
    if (compact) classes.push("cs-game-list-compact");
    if (games.length >= 2) classes.push("cs-game-list-many");
    if (games.length >= 5) classes.push("cs-game-list-dense");
    return '<div class="' + classes.join(" ") + '" style="--cs-game-count:' + games.length + '">' + games.map((game) => {
      const url = safeMediaUrl(game.url);
      const name = game.label || entry.titleShort || entry.title || "\uAC8C\uC784";
      return '<span class="cs-game-card"><img src="' + escapeHtml(url) + '" alt="' + escapeHtml(name) + '" loading="lazy" />' +
        '<span class="cs-game-name">' + directiveHtml(name, { disableProfileLinks: true }) + "</span></span>";
    }).join("") + "</div>";
  }

  function compactCellContentHtml(entry) {
    if (entry.parts && entry.parts.length) {
      return entry.parts.slice(0, 2).map((p, idx) => {
        const tagClass = p.speculative ? "cs-part-tag cs-part-tag-speculative" :
          isSpecialPart(p) ? "cs-part-tag cs-part-tag-collab" : "cs-part-tag";
        const tagLabel = partDisplayLabel(p, idx);
        let display = '<span class="cs-part-text">' + directiveHtml(p.content) + "</span>";
        if (p.displayType === "tag") display = '<span class="cs-text-badge">' + directiveHtml(p.content) + "</span>";
        if (p.displayType === "profile" && p.profile) display = '<span class="cs-inline-profile">' + channelAvatarLinkHtml(p.profile) + "</span>";
        const tagHtml = tagLabel ? '<span class="' + tagClass + '">' + tagLabel + "</span>" : "";
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
    const hoverable = !!entry && (state.gameOnly ? games.length > 0 : (!isOff || notes.length > 0));

    const classes = ["cs-cell"];
    if (compact) classes.push("cs-month-cell");
    if (isToday) classes.push("cs-cell-today");
    if (isPast || isOff) classes.push("cs-cell-muted");
    if (!entry || (state.gameOnly && !games.length)) classes.push("cs-cell-unknown");
    if (!compact && (!entry || isOff)) classes.push("cs-cell-center");
    if (hoverable) classes.push("cs-cell-hoverable");

    const dateLabel = compact ? String(d.getDate()) : ((isToday ? "\uC624\uB298 " : "") + cellDateLabel(d));
    let dateRow = '<div class="cs-cell-date">' + dateLabel + "</div>";
    let body = "";
    if (state.gameOnly) {
      body = gameImagesHtml(entry, compact);
    } else if (!entry) {
      body = compact ? "" : '<div class="cs-cell-center-body">' +
        '<div class="cs-cell-time"><img class="cs-undetermined-icon" src="' + UNDETERMINED_ICON_URL + '" alt="\uBBF8\uC815" /></div>' +
        '<div class="cs-cell-title">\uBBF8\uC815</div></div>';
    } else if (isOff) {
      const dot = notes.length ? '<span class="cs-memo-dot"></span>' : "";
      body = dot + (compact
        ? '<div class="cs-cell-title">\uD734\uBC29</div>'
        : '<div class="cs-cell-center-body"><div class="cs-cell-time"><img class="cs-break-icon" src="' + BREAK_ICON_URL + '" alt="\uD734\uBC29" /></div><div class="cs-cell-title">\uD734\uBC29</div></div>');
    } else if (compact) {
      body = (entry.start ? '<div class="cs-cell-time">' + escapeHtml(entry.start) + "</div>" : "") + compactCellContentHtml(entry);
    } else if (isPast) {
      body = '<div style="margin-top:12px;">' + cellContentHtml(entry) + "</div>";
    } else {
      const timeText = entry.start ? escapeHtml(entry.start) : "\uC2DC\uAC04 \uBBF8\uC815";
      dateRow = '<div class="cs-cell-date-row"><span class="cs-cell-date">' + dateLabel + "</span>" +
        '<span class="cs-cell-time">' + timeText + "</span></div>";
      body = cellContentHtml(entry);
    }

    return '<div class="' + classes.join(" ") + '" data-date="' + key + '"' +
      (hoverable ? ' data-hoverable="1"' : "") + ">" +
      dateRow + body + (state.gameOnly ? "" : timeIndicatorsHtml(entry, isPast)) + "</div>";
  }

  function fiveDayGridHtml(windowStart) {
    let html = "";
    for (let i = 0; i < PAGE_SIZE; i++) html += scheduleCellHtml(addDays(windowStart, i), false);
    return html;
  }

  function monthGridHtml(monthBase) {
    const weekdays = ["\uC77C", "\uC6D4", "\uD654", "\uC218", "\uBAA9", "\uAE08", "\uD1A0"];
    let html = weekdays.map((day) => '<div class="cs-month-weekday">' + day + "</div>").join("");
    const firstDay = monthBase.getDay();
    const days = new Date(monthBase.getFullYear(), monthBase.getMonth() + 1, 0).getDate();
    for (let i = 0; i < firstDay; i++) html += '<div class="cs-month-blank" aria-hidden="true"></div>';
    for (let day = 1; day <= days; day++) html += scheduleCellHtml(new Date(monthBase.getFullYear(), monthBase.getMonth(), day), true);
    const trailing = (firstDay + days) % 7;
    if (trailing) for (let i = trailing; i < 7; i++) html += '<div class="cs-month-blank" aria-hidden="true"></div>';
    return html;
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

    const canGoPrev = state.monthExpanded || hasEntryBefore(windowStartKey);
    const canGoNext = state.monthExpanded || hasEntryAfter(windowEndKey);

    const pill = pillState();
    const cellsHtml = state.monthExpanded ? monthGridHtml(monthBase) : fiveDayGridHtml(windowStart);
    const gridClass = state.monthExpanded ? "cs-grid cs-month-grid" : "cs-grid";
    const monthLabel = state.monthExpanded
      ? '<span class="cs-month-label">' + monthBase.getFullYear() + "." + String(monthBase.getMonth() + 1).padStart(2, "0") + "</span>"
      : "";

    const updatedLabel = formatUpdated();

    root.innerHTML =
      '<div class="cs-wrapper">' +
      '<div class="cs-section cs-schedule-section">' +
      '<div class="cs-header">' +
      '<span class="cs-title">방송 일정</span>' +
      '<span class="cs-pill ' + pill.cls + '">' + pill.html + "</span>" +
      '<span class="cs-spacer"></span>' +
      monthLabel +
      '<button type="button" class="cs-view-toggle cs-game-toggle' + (state.gameOnly ? " cs-open" : "") + '" id="cs-game-toggle" aria-pressed="' + String(state.gameOnly) + '">' + (state.gameOnly ? "\uC804\uCCB4 \uBCF4\uAE30" : "\uAC8C\uC784\uB9CC \uBCF4\uAE30") + "</button>" +
      '<button type="button" class="cs-view-toggle' + (state.monthExpanded ? " cs-open" : "") + '" id="cs-month-toggle" aria-pressed="' + String(state.monthExpanded) + '">' + (state.monthExpanded ? "5\uC77C \uBCF4\uAE30" : "\uC6D4\uAC04 \uBCF4\uAE30") + "</button>" +
      '<button class="cs-arrow" id="cs-prev"' + (canGoPrev ? "" : " disabled") + ">‹</button>" +
      '<button class="cs-arrow" id="cs-next"' + (canGoNext ? "" : " disabled") + ">›</button>" +
      "</div>" +
      '<div class="' + gridClass + '" id="cs-grid">' + cellsHtml + "</div>" +
      '<div class="cs-popover" id="cs-popover">' +
      '<div class="cs-pop-arrow" id="cs-pop-arrow"></div>' +
      '<div id="cs-pop-body"></div>' +
      "</div>" +
      "</div>" +
      infoSectionHtml() +
      '<div class="cs-footer">' +
      '<div class="cs-notice">' +
            '<p class="cs-schedule-notice" title="◈ 오뱅알 일정은 최대한 확인 가능한 정보를 기준으로 정리되지만, 실제 내용과 다를 수 있습니다.">◈ 오뱅알 일정은 최대한 확인 가능한 정보를 기준으로 정리되지만, 실제 내용과 다를 수 있습니다.</p>' +
      '<p class="cs-schedule-notice" title="◈ 일정 제보·변경·누락·오류는 우측 [문의·제보]를 통해 접수해주세요.">◈ 일정 제보·변경·누락·오류는 우측 [문의·제보]를 통해 접수해주세요.</p>' +
      '</div>' +
      '<button type="button" class="cs-feedback-open' + (state.feedbackOpen ? " cs-open" : "") + '" id="cs-feedback-open" aria-expanded="' + String(state.feedbackOpen) + '">문의·제보</button>' +
      '<span class="cs-updated">' + updatedLabel + "</span>" +
      '<button class="cs-refresh" id="cs-refresh" title="새로고침">⟳</button>' +
      "</div>" +
      feedbackPanelHtml() +
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

  function infoSectionHtml() {
    const items = (state.channel && state.channel.info) || [];
    if (!items.length) return "";

    const itemsHtml = items
      .map((text) =>
        '<li class="cs-info-item"><span class="cs-info-dot"></span>' +
        '<span class="cs-info-text">' + directiveHtml(text) + "</span></li>"
      )
      .join("");

    return (
      '<div class="cs-section cs-info-section">' +
      '<div class="cs-info-title">소식 및 정보</div>' +
      '<ul class="cs-info-list">' + itemsHtml + "</ul>" +
      "</div>"
    );
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
      // '<label class="cs-feedback-label" for="cs-feedback-contact">이메일 (선택)</label>' +
      // '<input class="cs-feedback-input" id="cs-feedback-contact" type="email" value="' + escapeHtml(draft.contact) + '" />' +
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
  function mediaTriggerHtml(label, url) {
    const safeUrl = safeMediaUrl(url);
    const safeLabel = label || "media";
    if (!safeUrl) return directiveHtml(safeLabel, { disableProfileLinks: true });
    return '<button type="button" class="cs-inline-media-trigger" data-media-label="' + escapeHtml(safeLabel) + '" data-media-url="' + escapeHtml(safeUrl) + '"><span class="cs-inline-media-label">' + directiveHtml(safeLabel, { disableProfileLinks: true }) + "</span></button>";
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

  function renderDirectiveToken(kind, text, profiles, options) {
    if (kind === "t") return '<span class="cs-text-badge">' + directiveHtml(text, options) + "</span>";
    const profile = profiles[text] || { channelId: "", channelName: text, channelImageUrl: "" };
    return '<span class="cs-inline-profile">' + channelAvatarLinkHtml(profile, options && options.disableProfileLinks) + "</span>";
  }
  function directiveHtml(value, options) {
    const raw = String(value || "");
    const profiles = (state.data && state.data.directiveProfiles) || {};
    const trimmed = raw.trim();
    const wholeMedia = parseMediaDirectiveAt(trimmed, 0);
    if (wholeMedia && wholeMedia.end === trimmed.length) return mediaTriggerHtml(wholeMedia.label, wholeMedia.url);
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
      if (end > plainStart) html += plainDirectiveHtml(raw.slice(plainStart, end));
    };
    while (i < raw.length) {
      const media = parseMediaDirectiveAt(raw, i);
      if (media) {
        flushPlain(i);
        html += mediaTriggerHtml(media.label, media.url);
        i = media.end;
        plainStart = i;
        continue;
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

  function channelAvatarLinkHtml(c, disableLink) {
    if (!c) return "";
    const tip = '<span class="cs-member-tip">' + escapeHtml(c.channelName || "이름 없음") + "</span>";
    if (!disableLink && isRealChzzkChannelRef(c)) {
      const url = "https://chzzk.naver.com/live/" + encodeURIComponent(c.channelId);
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
            isSpecialPart(p) ? "cs-part-tag cs-part-tag-collab" : "cs-part-tag";
          const tagLabel = partDisplayLabel(p, idx);
          let display = '<span class="cs-part-text">' + directiveHtml(p.content) + "</span>";
          if (p.displayType === "tag") display = '<span class="cs-text-badge">' + directiveHtml(p.content) + "</span>";
          if (p.displayType === "profile" && p.profile) {
            display = '<span class="cs-inline-profile">' + channelAvatarLinkHtml(p.profile) + "</span>";
          }
          const tagHtml = tagLabel ? '<span class="' + tagClass + '">' + tagLabel + "</span>" : "";
          return '<div class="cs-cell-part">' + tagHtml + display + "</div>";
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
    const monthToggle = s.getElementById("cs-month-toggle");
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
    const feedbackContact = s.getElementById("cs-feedback-contact");
    const feedbackStatus = s.getElementById("cs-feedback-status");
    const feedbackCount = s.getElementById("cs-feedback-count");
    const feedbackSubmit = s.getElementById("cs-feedback-submit");

    if (prev) prev.addEventListener("click", () => { if (state.monthExpanded) state.monthOffset -= 1; else state.pageOffset -= 1; render(); });
    if (next) next.addEventListener("click", () => { if (state.monthExpanded) state.monthOffset += 1; else state.pageOffset += 1; render(); });
    if (monthToggle) monthToggle.addEventListener("click", () => { closePopover(); state.monthExpanded = !state.monthExpanded; render(); });
    if (gameToggle) gameToggle.addEventListener("click", () => { closePopover(); state.gameOnly = !state.gameOnly; render(); });
    if (refresh) refresh.addEventListener("click", async () => {
      refresh.textContent = "…";
      await refreshData(true);
      render();
    });

    if (grid) {
      grid.addEventListener("mouseover", (ev) => {
        const cell = ev.target.closest ? ev.target.closest("[data-hoverable]") : null;
        if (cell && grid.contains(cell)) scheduleOpenPopover(cell);
      });
      grid.addEventListener("mouseout", (ev) => {
        const cell = ev.target.closest ? ev.target.closest("[data-hoverable]") : null;
        if (cell) scheduleClosePopover();
      });
    }

    if (popover) {
      // 팝오버 위로 마우스가 이동하면 닫힘 취소 (긴 메모 읽기 대비)
      popover.addEventListener("mouseenter", () => {
        if (state.popoverCloseTimer) clearTimeout(state.popoverCloseTimer);
      });
      popover.addEventListener("mouseleave", scheduleClosePopover);
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
      const mediaImage = event.target.closest && event.target.closest(".cs-media-expandable");
      if (mediaImage) {
        event.preventDefault();
        event.stopPropagation();
        showOriginalImage(mediaImage);
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
      if (!(event.target.closest && event.target.closest(".cs-media-popover"))) closeMediaPopover();
    };
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
      feedbackSubmit.disabled = true;
      feedbackStatus.textContent = "보내는 중…";
      feedbackStatus.className = "cs-feedback-status";
      const result = await sendRuntimeMessage({
        type: "submitFeedback",
        payload: { feedbackType: draft.type, message: draft.message, relatedLink: draft.relatedLink, contact: draft.contact },
      });
      if (!result || !result.ok) {
        feedbackStatus.textContent = "전송 실패: " + ((result && result.error) || "알 수 없는 오류");
        feedbackStatus.className = "cs-feedback-status cs-error";
        feedbackSubmit.disabled = false;
        return;
      }
      feedbackStatus.textContent = "전달되었습니다. 감사합니다!";
      feedbackStatus.className = "cs-feedback-status cs-success";
      state.feedbackDraft = { type: "일정", message: "", relatedLink: "", contact: "" };
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

  function scheduleOpenPopover(cell) {
    if (state.popoverTimer) clearTimeout(state.popoverTimer);
    if (state.popoverCloseTimer) clearTimeout(state.popoverCloseTimer);
    state.popoverTimer = setTimeout(() => openPopover(cell), 150);
  }

  function scheduleClosePopover() {
    if (state.popoverTimer) clearTimeout(state.popoverTimer);
    if (state.popoverCloseTimer) clearTimeout(state.popoverCloseTimer);
    state.popoverCloseTimer = setTimeout(closePopover, 200);
  }

  function openPopover(cell) {
    const s = state.shadow;
    const popover = s.getElementById("cs-popover");
    const body = s.getElementById("cs-pop-body");
    const arrow = s.getElementById("cs-pop-arrow");
    const section = popover ? popover.parentElement : null;
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

    // 시간 줄: 과거 일정과 휴방에서는 생략
    if (!isPast && !isOff) {
      const timeText = entry.start
        ? escapeHtml(entry.start + (entry.end ? " ~ " + entry.end : " ~"))
        : "시간 미정";
      html += '<div class="cs-pop-row"><span class="cs-pop-icon">◷</span>' +
        '<span class="cs-pop-text">' + timeText + "</span></div>";
    }

    // 부별 컨텐츠: 칸에서 말줄임된 내용을 전체 표시. 합방이면 멤버 아바타도 여기서만 노출.
    if (!isOff && entry.parts && entry.parts.length) {
      html += '<div class="cs-pop-parts-box">' + entry.parts
        .map((p, idx) => {
          const iconClass = p.speculative ? "cs-pop-icon cs-pop-icon-speculative" :
            isSpecialPart(p) ? "cs-pop-icon cs-pop-icon-collab" : "cs-pop-icon";
          const label = partDisplayLabel(p, idx);
          let popContent = '<span class="cs-pop-text">' + directiveHtml(p.content) + "</span>";
          if (p.displayType === "tag") popContent = '<span class="cs-text-badge">' + directiveHtml(p.content) + "</span>";
          if (p.displayType === "profile" && p.profile) {
            popContent = '<span class="cs-inline-profile">' + channelAvatarLinkHtml(p.profile) + "</span>";
          }
          let group = '<div class="cs-pop-part">' +
            '<div class="cs-pop-row">' + (label ? '<span class="' + iconClass + '">' + label + "</span>" : "") +
            popContent + "</div>";
          if ((p.official || p.otherChannel) && p.hostChannel) {
            group += '<div class="cs-pop-members">' + channelAvatarLinkHtml(p.hostChannel) + "</div>";
          }
          if (p.collab && p.members && p.members.length) {
            group += '<div class="cs-pop-members">' +
              p.members.map((member) => channelAvatarLinkHtml(member)).join("") +
              "</div>";
          }
          group += "</div>";
          return group;
        })
        .join("") + "</div>";
    }

    if (notes.length) {
      html += '<div class="cs-pop-note-box"><span class="cs-pop-icon">✎</span>' +
        '<div class="cs-pop-note-list">' + notes.map((note) =>
          '<div class="cs-pop-note-text">' + directiveHtml(note) + "</div>"
        ).join("") + "</div></div>";
    }

    body.innerHTML = html;
    popover.style.width = "max-content";
    popover.classList.add("cs-open");

    // 위치 계산: 해당 칸 바로 아래, 섹션 좌우로 벗어나지 않게 보정
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
    viewer.innerHTML = '<img id="cs-media-viewer-img" alt="" />';
    viewer.addEventListener("click", (event) => {
      if (event.target === viewer) closeOriginalImage();
    });
    const img = viewer.querySelector("#cs-media-viewer-img");
    if (img) img.addEventListener("click", (event) => event.stopPropagation());
    s.appendChild(viewer);
    return viewer;
  }

  function showOriginalImage(image) {
    const viewer = ensureOriginalImageViewer();
    const img = viewer.querySelector("#cs-media-viewer-img");
    if (!img) return;
    img.src = image.currentSrc || image.src;
    img.alt = image.alt || "이미지 원본";
    viewer.classList.add("cs-open");
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
    if (pop) pop.classList.remove("cs-open", "cs-media-expanded");
    closeOriginalImage();
    if (state.shadow) state.shadow.querySelectorAll(".cs-inline-media-trigger.cs-open").forEach((el) => el.classList.remove("cs-open"));
  }

  function showMediaPopover(trigger) {
    const url = trigger.getAttribute("data-media-url") || "";
    const label = trigger.getAttribute("data-media-label") || "미디어";
    const pop = ensureMediaPopover();
    const title = pop.querySelector("#cs-media-title");
    const body = pop.querySelector("#cs-media-body");
    if (title) title.textContent = label;
    if (body) body.innerHTML = mediaEmbedHtml(url, label);
    state.shadow.querySelectorAll(".cs-inline-media-trigger.cs-open").forEach((el) => el.classList.remove("cs-open"));
    trigger.classList.add("cs-open");
    pop.classList.add("cs-open");

    const root = state.shadow && state.shadow.getElementById("cs-root");
    if (root && pop.parentElement !== root) root.appendChild(pop);
    const rect = trigger.getBoundingClientRect();
    const rootRect = root ? root.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const popRect = pop.getBoundingClientRect();
    const maxLeft = Math.max(8, rootRect.width - popRect.width - 8);
    const rightLeft = rect.right - rootRect.left + 8;
    const leftFallback = rect.left - rootRect.left - popRect.width - 8;
    const left = rightLeft + popRect.width <= rootRect.width - 8 ? rightLeft : Math.max(8, Math.min(leftFallback, maxLeft));
    const maxTop = Math.max(8, rootRect.height - popRect.height - 8);
    const top = Math.max(8, Math.min(rect.top - rootRect.top, maxTop));
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }
  function closePopover() {
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

  function syncFullscreenVisibility() {
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
  // "_thumbnail*"와 "_is_live*" 클래스를 함께 가진 요소를 찾고,
  // 그 조상 중 "_details*" 클래스를 가진 요소를 앵커로 사용 (그 다음에 삽입)
  function findDetailsAnchor() {
    const nodes = document.querySelectorAll('[class*="_thumbnail"]');
    for (const el of nodes) {
      const cls = (el.getAttribute("class") || "").split(/\s+/);
      const hasThumb = cls.some((c) => c.startsWith("_thumbnail"));
      const hasLive = cls.some((c) => c.startsWith("_is_live"));
      if (!hasThumb || !hasLive) continue;
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


  function mountInline(anchor) {
    const host = createHost();
    anchor.insertAdjacentElement("afterend", host);
    state.mode = "inline";
    syncPageTheme();
    render();
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
      button.classList.toggle("cs-open", open);
      button.setAttribute("aria-expanded", String(open));
    });
    render();
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
    btn.addEventListener("click", () => panel.classList.toggle("cs-open"));

    render();
  }

  function unmount() {
    if (state.feedbackOutsideHandler) {
      document.removeEventListener("mousedown", state.feedbackOutsideHandler);
      state.feedbackOutsideHandler = null;
    }
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
      state.fetchedAt = res.fetchedAt;
      state.channel =
        (res.data.channels && state.channelId && res.data.channels[state.channelId]) || null;
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
      if (state.host && !state.host.isConnected) {
        state.host = null;
        state.shadow = null;
        anchorRetries = 0;
      }
      if (!state.host) tryMount();
      if (state.host) syncPageTheme();

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
    const minutes = Math.max(1, Number(cfg.autoRefreshMinutes || cfg.cacheTtlMinutes || 1) || 1);
    const interval = minutes * 60 * 1000;
    const fetchedAt = typeof state.fetchedAt === "number" ? state.fetchedAt : Date.parse(state.fetchedAt || "") || 0;
    if (Date.now() - Math.max(fetchedAt, lastAutoRefreshAttempt) < interval) return;

    lastAutoRefreshAttempt = Date.now();
    autoRefreshInFlight = true;
    try {
      const updated = await refreshData(true);
      if (updated && state.shadow) {
        render();
      }
    } catch (e) {
    } finally {
      autoRefreshInFlight = false;
    }
  }

  function startAutoRefresh() {
    setInterval(runAutoRefreshIfDue, 30000);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") runAutoRefreshIfDue();
    });
  }

  state.todayKey = dateKey(todayDate());
  document.addEventListener("fullscreenchange", syncFullscreenVisibility);
  document.addEventListener("webkitfullscreenchange", syncFullscreenVisibility);
  watch();
  startAutoRefresh();
})();
































