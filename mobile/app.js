(() => {
  "use strict";

  const cfg = OBAENGAL_MOBILE_CONFIG;
  const state = { channelId: "", channelName: "", rows: [], infoRows: [], updatedAt: null, monthOffset: 0, selectedDate: todayKey() };
  const $ = (id) => document.getElementById(id);
  const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function todayKey() { return dateKey(new Date()); }

  function parseDate(key) {
    const [y, m, d] = String(key || "").split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  function displayDate(key, includeToday) {
    const d = parseDate(key);
    const label = `${d.getMonth() + 1}/${d.getDate()} (${WEEK[d.getDay()]})`;
    return includeToday && key === todayKey() ? `오늘 ${label}` : label;
  }

  function fullDateLabel(key) {
    const d = parseDate(key);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WEEK[d.getDay()]}요일`;
  }

  function apiBase() { return cfg.supabaseUrl.replace(/\/+$/, ""); }

  async function restFetch(path, params) {
    const url = new URL(`${apiBase()}/rest/v1/${path}`);
    Object.entries(params || {}).forEach(([key, value]) => url.searchParams.set(key, value));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url.toString(), {
        headers: { apikey: cfg.supabaseKey, Authorization: `Bearer ${cfg.supabaseKey}` },
        cache: "no-cache",
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Supabase HTTP ${res.status}`);
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeChannelRef(channel) {
    if (!channel || typeof channel !== "object") return null;
    if (!channel.channelId && !channel.channelName) return null;
    return { channelId: channel.channelId || "", channelName: channel.channelName || "", channelImageUrl: channel.channelImageUrl || "" };
  }

  function normalizePart(part) {
    if (typeof part === "string") return { content: part, label: "", displayType: "text", members: [] };
    if (!part || typeof part !== "object") return { content: "", label: "", displayType: "text", members: [] };
    return {
      content: part.content || "",
      label: part.label || "",
      hidePartLabel: !!part.hidePartLabel,
      displayType: part.displayType || "text",
      profile: normalizeChannelRef(part.profile),
      collab: !!part.collab,
      official: !!part.official,
      otherChannel: !!part.otherChannel,
      ad: !!part.ad,
      outdoor: !!part.outdoor,
      speculative: !!part.speculative,
      members: Array.isArray(part.members) ? part.members.map(normalizeChannelRef).filter(Boolean) : [],
      hostChannel: normalizeChannelRef(part.hostChannel),
      notes: normalizeNotes(part.notes),
    };
  }

  function normalizeNotes(value) {
    const normalize = (item) => {
      if (item && typeof item === "object") {
        const content = String(item.content || item.text || item.note || "").trim();
        return content && !item.hidden ? content : "";
      }
      return String(item || "").trim();
    };
    if (Array.isArray(value)) return value.map(normalize).filter(Boolean);
    if (typeof value !== "string" || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(normalize).filter(Boolean);
      const single = normalize(parsed);
      return single ? [single] : [];
    } catch (_e) {
      return [value.trim()];
    }
  }

  function rowToInfo(row) {
    return {
      id: row.id || 0,
      content: String(row.content || "").trim(),
      updatedAt: row.updated_at || row.created_at || null,
    };
  }


  function rowToEntry(row) {
    return {
      date: row.date,
      start: row.start_time || "",
      end: row.end_time || "",
      title: row.title || "",
      titleShort: row.title_short || "",
      status: row.status || "",
      parts: Array.isArray(row.parts) ? row.parts.map(normalizePart).filter((p) => p.content || p.profile) : [],
      notes: normalizeNotes(row.note),
      updatedAt: row.updated_at || row.created_at || null,
    };
  }

  function partFlagLabels(part) {
    const labels = [];
    if (part.collab) labels.push("합방");
    if (part.official) labels.push("공방");
    if (part.otherChannel) labels.push("타방송");
    if (part.ad) labels.push("광고");
    if (part.outdoor) labels.push("야방");
    return labels;
  }

  function tagToneStyleAttr(tag) {
    const text = String(tag || "").trim();
    if (!text) return "";
    const fixed = {
      "언급": [44, 232, 184, 104, 154, 107, 0],
      "합방": [205, 125, 211, 252, 3, 105, 161],
      "공방": [222, 191, 96, 165, 37, 99, 235],
      "타방송": [252, 216, 180, 254, 109, 40, 217],
      "광고": [340, 251, 113, 133, 180, 35, 82],
      "야방": [27, 251, 146, 60, 194, 93, 22],
    };
    const tone = fixed[text];
    if (tone) {
      const [hue, dr, dg, db, lr, lg, lb] = tone;
      return ' style="--cs-tag-color: rgb(' + dr + ' ' + dg + ' ' + db + '); --cs-tag-bg: hsl(' + hue + ' 88% 60% / 0.16); --cs-tag-border: hsl(' + hue + ' 88% 68% / 0.32); --cs-tag-light-color: rgb(' + lr + ' ' + lg + ' ' + lb + '); --cs-tag-light-bg: hsl(' + hue + ' 85% 50% / 0.13); --cs-tag-light-border: hsl(' + hue + ' 72% 42% / 0.24);"';
    }
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    const hue = Math.abs(hash) % 360;
    return ' style="--cs-tag-color: hsl(' + hue + ' 88% 76%); --cs-tag-bg: hsl(' + hue + ' 88% 60% / 0.16); --cs-tag-border: hsl(' + hue + ' 88% 68% / 0.32); --cs-tag-light-color: hsl(' + hue + ' 72% 32%); --cs-tag-light-bg: hsl(' + hue + ' 85% 50% / 0.13); --cs-tag-light-border: hsl(' + hue + ' 72% 42% / 0.24);"';
  }

  function firstPartTag(part) {
    if (!part) return "";
    if (part.speculative) return "언급";
    const flags = partFlagLabels(part);
    return flags.length ? flags[0] : "";
  }
  function partLabel(part, index) {
    const flags = partFlagLabels(part);
    if (part.speculative) return ["언급"].concat(flags).join("/");
    if (part.hidePartLabel) return flags.join("/");
    const base = part.label || `${index + 1}부`;
    return flags.length ? `${base}/${flags.join("/")}` : base;
  }

  function findDirectiveBracketEnd(raw, openIndex) {
    let depth = 1;
    for (let i = openIndex + 1; i < raw.length; i += 1) {
      if (raw[i] === "[") depth += 1;
      else if (raw[i] === "]") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function mediaDirectiveText(raw) {
    let text = "";
    let plainStart = 0;
    let i = 0;
    while (i < raw.length) {
      const media = parseMediaDirectiveAt(raw, i);
      if (media) {
        text += raw.slice(plainStart, i) + media.label;
        i = media.end;
        plainStart = i;
        continue;
      }
      if (raw.slice(i, i + 3).toLowerCase() === ":m[") {
        const end = findDirectiveBracketEnd(raw, i + 2);
        if (end > i) {
          const body = raw.slice(i + 3, end);
          const braceOpen = body.lastIndexOf("{");
          const label = (braceOpen >= 0 ? body.slice(0, braceOpen) : body).trim();
          text += raw.slice(plainStart, i) + label;
          i = end + 1;
          plainStart = i;
          continue;
        }
      }
      i += 1;
    }
    return text + raw.slice(plainStart);
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
      label: body.slice(0, braceOpen).trim() || "미디어",
      url: body.slice(braceOpen + 1, braceClose).trim(),
      end: close + 1,
    };
  }

  function mediaTriggerHtml(label) {
    return directiveInlineHtml(label || url || "미디어");
  }
  function closeInfoPopup() {
    const popup = $("infoPopup");
    if (!popup) return;
    popup.hidden = true;
    popup.classList.remove("open");
    const btn = $("infoBtn");
    if (btn) btn.classList.remove("open");
    document.body.classList.remove("info-popup-open");
  }

  function openInfoPopup() {
    const popup = $("infoPopup");
    if (!popup) return;
    renderInfoSection();
    popup.hidden = false;
    popup.classList.add("open");
    const btn = $("infoBtn");
    if (btn) btn.classList.add("open");
    document.body.classList.add("info-popup-open");
  }

  function toggleInfoPopup() {
    const popup = $("infoPopup");
    if (popup && !popup.hidden) closeInfoPopup();
    else openInfoPopup();
  }

  function directiveText(value) {
    return mediaDirectiveText(String(value || ""))
      .replace(/:t(?:\[([^\]]+)\]|\s+([^\s:]+))/gi, (_m, bracket, plain) => bracket || plain || "")
      .replace(/:s(?:\[([^\]]+)\]|\s+([^\s:]+))/gi, (_m, bracket, plain) => bracket || plain || "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function streamerBadgeHtml(name) {
    const text = String(name || "").trim();
    return text ? `<span class="schedule-inline-streamer">${esc(text)}</span>` : "";
  }

  function hasStreamerDirective(value) {
    return /:s(?:\[|\s+[^\s:]+)/i.test(String(value || ""));
  }

  function directiveInlineHtml(value) {
    const raw = String(value || "");
    let html = "";
    let plainStart = 0;
    let i = 0;
    const flushPlain = (end) => {
      if (end > plainStart) html += esc(raw.slice(plainStart, end));
    };
    while (i < raw.length) {
      const media = parseMediaDirectiveAt(raw, i);
      if (media) {
        flushPlain(i);
        html += mediaTriggerHtml(media.label);
        i = media.end;
        plainStart = i;
        continue;
      }
      if (raw.slice(i, i + 3).toLowerCase() === ":m[") {
        const end = findDirectiveBracketEnd(raw, i + 2);
        if (end > i) {
          const body = raw.slice(i + 3, end);
          const braceOpen = body.lastIndexOf("{");
          const label = (braceOpen >= 0 ? body.slice(0, braceOpen) : body).trim();
          flushPlain(i);
          if (label) html += directiveInlineHtml(label);
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
          const text = raw.slice(i + 3, end).trim();
          if (bracket[1].toLowerCase() === "t") {
            html += hasStreamerDirective(text) ? directiveInlineHtml(text) : `<span class="schedule-inline-tag schedule-tag-tone"${tagToneStyleAttr(text)}>${directiveInlineHtml(text)}</span>`;
          } else {
            html += streamerBadgeHtml(text);
          }
          i = end + 1;
          plainStart = i;
          continue;
        }
      }
      const inline = raw.slice(i).match(/^:(s|t)\s+([^\s:]+)/i);
      if (inline) {
        flushPlain(i);
        html += inline[1].toLowerCase() === "t"
          ? `<span class="schedule-inline-tag schedule-tag-tone"${tagToneStyleAttr(inline[2].trim())}>${esc(inline[2].trim())}</span>`
          : streamerBadgeHtml(inline[2].trim());
        i += inline[0].length;
        plainStart = i;
        continue;
      }
      i += 1;
    }
    flushPlain(raw.length);
    return html;
  }

  function entryTitle(entry) {
    if (!entry) return "";
    if (entry.status === "off") return "휴방";
    if (entry.parts && entry.parts.length) return directiveText(entry.parts[0].content || entry.parts[0].profile?.channelName || "");
    return directiveText(entry.titleShort || entry.title || "방송 예정");
  }


  function entriesByDate() {
    return new Map(state.rows.map((entry) => [entry.date, entry]));
  }

  function monthBaseDate() {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth() + state.monthOffset, 1);
  }

  function monthIndexFromDateKey(key) {
    const d = parseDate(key);
    return d.getFullYear() * 12 + d.getMonth();
  }

  function currentMonthIndex() {
    const base = monthBaseDate();
    return base.getFullYear() * 12 + base.getMonth();
  }

  function scheduleMonthBounds() {
    const months = state.rows
      .filter((entry) => entry && entry.date)
      .map((entry) => monthIndexFromDateKey(entry.date));
    if (!months.length) {
      const current = currentMonthIndex();
      return { min: current, max: current };
    }
    return { min: Math.min(...months), max: Math.max(...months) };
  }

  function updateMonthNavState() {
    const bounds = scheduleMonthBounds();
    const current = currentMonthIndex();
    $("prevMonthBtn").disabled = current <= bounds.min;
    $("nextMonthBtn").disabled = current >= bounds.max;
  }

  function setSelectedDate(key) {
    state.selectedDate = key || todayKey();
    const selected = parseDate(state.selectedDate);
    const today = new Date();
    state.monthOffset = (selected.getFullYear() - today.getFullYear()) * 12 + selected.getMonth() - today.getMonth();
    renderAll();
  }

  function renderHeader() {
    const updated = state.updatedAt ? new Date(state.updatedAt) : null;
    $("updatedLabel").textContent = updated && !Number.isNaN(updated.getTime())
      ? `업데이트 ${updated.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })}`
      : "업데이트 확인 중";
  }

  function scheduleNotesHtml(entry) {
    if (!entry || !entry.notes || !entry.notes.length) return "";
    return `<section class="schedule-card-notes" aria-label="메모">
      <div class="schedule-card-notes-title">메모</div>
      ${entry.notes.map((note) => `<span class="schedule-card-note">${directiveInlineHtml(note)}</span>`).join("")}
    </section>`;
  }

  function detailHostHtml(part) {
    if (!part || !part.otherChannel || !part.hostChannel) return "";
    const name = String(part.hostChannel.channelName || "이름 없음").trim();
    return name ? `<div class="schedule-detail-members-row"><span class="schedule-detail-members-chip">송출</span><div class="schedule-detail-members schedule-detail-members-plain"><span class="schedule-detail-member-text">${esc(name)}</span></div></div>` : "";
  }

  function detailMembersHtml(part) {
    if (!part || !part.collab || !part.members || !part.members.length) return "";
    return `<div class="schedule-detail-members-row"><span class="schedule-detail-members-chip">멤버</span><div class="schedule-detail-members schedule-detail-members-plain">${part.members.map((member) => `<span class="schedule-detail-member-text">${esc(member.channelName || "이름 없음")}</span>`).join("")}</div></div>`;
  }

  function detailPartNotesHtml(part) {
    if (!part || !part.notes || !part.notes.length) return "";
    return `<div class="schedule-detail-part-notes">${part.notes.map((note) => `<div class="schedule-detail-note-text">${directiveInlineHtml(note)}</div>`).join("")}</div>`;
  }

  function detailPartHtml(part, index) {
    const label = partLabel(part, index);
    const firstTag = firstPartTag(part);
    const tagToneAttr = tagToneStyleAttr(firstTag);
    const tagToneClass = firstTag ? " schedule-tag-tone" : "";
    const tagClass = part && part.speculative ? " speculative" :
      part && (part.collab || part.official || part.otherChannel || part.ad || part.outdoor) ? " special" : "";
    const textHtml = part.displayType === "profile" && part.profile ? esc(part.profile.channelName) : directiveInlineHtml(part.content);
    return `<div class="schedule-detail-part">
      <div class="schedule-detail-part-scroll">
        <div class="schedule-detail-row schedule-detail-part-main">
          ${label ? `<span class="schedule-detail-part-label${tagClass}${tagToneClass}"${tagToneAttr}>${esc(label)}</span>` : ""}
          <span class="schedule-detail-part-text">${textHtml || "내용 미정"}</span>
        </div>
        ${detailHostHtml(part)}
        ${detailMembersHtml(part)}
        ${detailPartNotesHtml(part)}
      </div>
    </div>`;
  }

  function scheduleDetailHtml(key, entry) {
    const isToday = key === todayKey();
    if (!entry) {
      return `<article class="schedule-detail empty">
        <p class="schedule-detail-empty-text">등록된 일정이 없습니다.</p>
      </article>`;
    }
    if (entry.status === "off") {
      return `<article class="schedule-detail off">
        <p class="schedule-detail-empty-text">휴방으로 표시된 날입니다.</p>
        ${scheduleNotesHtml(entry)}
      </article>`;
    }
    const title = directiveInlineHtml(entry.titleShort || entry.title || entryTitle(entry) || "방송 예정");
    const partsHtml = entry.parts && entry.parts.length
      ? `<div class="schedule-detail-parts">${entry.parts.map(detailPartHtml).join("")}</div>`
      : `<div class="schedule-detail-parts"><div class="schedule-detail-part"><div class="schedule-detail-part-scroll"><div class="schedule-detail-row schedule-detail-part-main"><span class="schedule-detail-part-label">일정</span><span class="schedule-detail-part-text">${title}</span></div></div></div></div>`;
    return `<article class="schedule-detail${isToday ? " today" : ""}">
      ${partsHtml}
      ${scheduleNotesHtml(entry)}
    </article>`;
  }
  function renderSelectedSchedule() {
    const key = state.selectedDate || todayKey();
    const entry = entriesByDate().get(key) || null;
    $("selectedScheduleHeading").textContent = key === todayKey() ? "오늘 일정" : fullDateLabel(key);
    $("scheduleList").innerHTML = scheduleDetailHtml(key, entry);
  }

  function renderInfoSection() {
    const list = $("infoList");
    if (!list) return;
    const items = state.infoRows.filter((item) => item.content);
    list.innerHTML = items.length
      ? items.map((item) => `<article class="mobile-info-card"><span class="mobile-info-marker" aria-hidden="true"></span><div class="mobile-info-text">${directiveInlineHtml(item.content)}</div></article>`).join("")
      : `<div class="empty-state"><strong>등록된 소식이 없습니다.</strong><span>관리자 페이지에서 소식이 등록되면 표시됩니다.</span></div>`;
  }

  function renderMonth() {
    const map = entriesByDate();
    const base = monthBaseDate();
    const year = base.getFullYear();
    const month = base.getMonth();
    const firstDay = base.getDay();
    const days = new Date(year, month + 1, 0).getDate();
    $("monthHeading").textContent = `${year}.${String(month + 1).padStart(2, "0")}`;
    let html = WEEK.map((day) => `<div class="month-weekday">${day}</div>`).join("");
    for (let i = 0; i < firstDay; i += 1) html += `<div class="month-cell month-blank" aria-hidden="true"></div>`;
    for (let day = 1; day <= days; day += 1) {
      const key = dateKey(new Date(year, month, day));
      const entry = map.get(key) || null;
      const isToday = key === todayKey();
      const isOff = entry && entry.status === "off";
      const hasEntry = !!entry;
      html += `
        <button class="month-cell${key === state.selectedDate ? " selected" : ""}${isToday ? " today" : ""}${isOff ? " off" : ""}${hasEntry ? " has-entry" : " empty"}" type="button" data-calendar-date="${esc(key)}" aria-label="${esc(displayDate(key, false))} 선택">
          <div class="month-day-row">
            <span class="month-day">${day}</span>
          </div>
          ${hasEntry ? `<span class="month-dot" aria-hidden="true"></span>` : ""}
        </button>
      `;
    }
    $("monthGrid").innerHTML = html;
    updateMonthNavState();
  }

  function renderViews() {
    $("weekView").classList.add("active");
    $("monthView").classList.add("active");
  }

  function renderAll() {
    renderHeader();
    renderViews();
    renderMonth();
    renderSelectedSchedule();
    renderInfoSection();
  }

  function setLoading(loading) {
    $("refreshBtn").disabled = loading;
    if (loading) {
      $("updatedLabel").textContent = "최신 데이터를 확인하고 있습니다.";
      const infoList = $("infoList");
      if (infoList && !state.infoRows.length) infoList.innerHTML = `<div class="mobile-info-card loading"><div class="skeleton line wide"></div><div class="skeleton block"></div></div>`;
    }
  }

  function readInitialChannel() {
    const params = new URLSearchParams(location.search);
    const fromUrl = params.get("channel");
    if (fromUrl && /^[0-9a-f]{32}$/i.test(fromUrl)) return { id: fromUrl, name: params.get("name") || cfg.defaultChannelName };
    return { id: cfg.defaultChannelId, name: cfg.defaultChannelName };
  }

  async function loadChannel(channel) {
    state.channelId = channel.id;
    state.channelName = channel.name || cfg.defaultChannelName;
    renderAll();
    setLoading(true);
    try {
      const [scheduleRows, infoRows] = await Promise.all([
        restFetch(cfg.tableName || "schedule", { select: "*", channel_id: `eq.${state.channelId}`, order: "date.asc" }),
        restFetch(cfg.upcomingContentTableName || "upcoming_content", { select: "id,content,hidden,sort_order,created_at", channel_id: `eq.${state.channelId}`, hidden: "is.false", order: "sort_order.asc,id.asc" }).catch(() => []),
      ]);
      state.rows = (scheduleRows || []).map(rowToEntry);
      state.infoRows = (infoRows || []).map(rowToInfo).filter((item) => item.content);
      const rowChannelName = (scheduleRows || []).find((row) => row.channel_name)?.channel_name;
      if (rowChannelName) state.channelName = rowChannelName;
      const scheduleUpdatedAt = state.rows.reduce((latest, row) => row.updatedAt && (!latest || row.updatedAt > latest) ? row.updatedAt : latest, null);
      const infoUpdatedAt = state.infoRows.reduce((latest, row) => row.updatedAt && (!latest || row.updatedAt > latest) ? row.updatedAt : latest, null);
      state.updatedAt = [scheduleUpdatedAt, infoUpdatedAt].filter(Boolean).sort().pop() || null;
      renderAll();
    } catch (error) {
      $("scheduleList").innerHTML = `<div class="empty-state"><strong>일정을 불러오지 못했습니다.</strong><span>${esc(error.message || error)}</span></div>`;
      $("monthGrid").innerHTML = `<div class="empty-state month-error"><strong>월간 일정을 불러오지 못했습니다.</strong><span>${esc(error.message || error)}</span></div>`;
    } finally {
      setLoading(false);
    }
  }

  function bindActions() {
    $("refreshBtn").addEventListener("click", () => loadChannel({ id: state.channelId, name: state.channelName }));
    const infoBtn = $("infoBtn");
    if (infoBtn) infoBtn.addEventListener("click", toggleInfoPopup);
    $("prevMonthBtn").addEventListener("click", () => { if ($("prevMonthBtn").disabled) return; state.monthOffset -= 1; renderAll(); });
    $("nextMonthBtn").addEventListener("click", () => { if ($("nextMonthBtn").disabled) return; state.monthOffset += 1; renderAll(); });
    document.addEventListener("click", (event) => {
      if (event.target.closest && event.target.closest("[data-info-close]")) {
        closeInfoPopup();
        return;
      }
      const infoPopup = $("infoPopup");
      if (infoPopup && !infoPopup.hidden && event.target === infoPopup) {
        closeInfoPopup();
        return;
      }
      const calendarDay = event.target.closest && event.target.closest("[data-calendar-date]");
      if (calendarDay) {
        setSelectedDate(calendarDay.getAttribute("data-calendar-date"));
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
            closeInfoPopup();
      }
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    });
  }

  function init() {
    bindActions();
    registerServiceWorker();
    loadChannel(readInitialChannel());
  }

  init();
})();

