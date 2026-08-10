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

  function normalizeVod(item) {
    if (!item || typeof item !== "object") return null;
    const url = String(item.url || "").trim();
    if (!url) return null;
    return { url, label: String(item.label || "방송 다시보기").trim() || "방송 다시보기" };
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
      vods: Array.isArray(row.vods) ? row.vods.map(normalizeVod).filter(Boolean) : [],
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
    if (part.outdoor) labels.push("야외");
    return labels;
  }

  function partLabel(part, index) {
    const flags = partFlagLabels(part);
    if (part.speculative) return ["추정"].concat(flags).join("/");
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

  function mediaTriggerHtml(label, url) {
    const safe = safeUrl(url);
    if (!safe) return directiveInlineHtml(label || url || "미디어");
    return `<button type="button" class="mobile-media-trigger" data-media-label="${esc(label || "미디어")}" data-media-url="${esc(safe)}"><span class="mobile-media-label">${directiveInlineHtml(label || "미디어")}</span></button>`;
  }

  function youtubeEmbedUrl(value) {
    try {
      const url = new URL(String(value || "").trim());
      let id = "";
      if (url.hostname === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] || "";
      else if (/youtube\.com$/i.test(url.hostname) || /(^|\.)youtube-nocookie\.com$/i.test(url.hostname)) {
        if (url.pathname === "/watch") id = url.searchParams.get("v") || "";
        else {
          const parts = url.pathname.split("/").filter(Boolean);
          if (["embed", "shorts", "live"].includes(parts[0])) id = parts[1] || "";
        }
      }
      return id && /^[A-Za-z0-9_-]{6,}$/.test(id) ? `https://www.youtube.com/embed/${encodeURIComponent(id)}` : "";
    } catch (_e) {
      return "";
    }
  }

  function mediaEmbedHtml(url, label) {
    const safe = safeUrl(url);
    if (!safe) return `<span class="mobile-media-link">${esc(url)}</span>`;
    const path = new URL(safe).pathname.toLowerCase();
    const yt = youtubeEmbedUrl(safe);
    if (yt) return `<iframe src="${esc(yt)}" title="${esc(label || "동영상")}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
    if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(path)) return `<img class="mobile-media-image" src="${esc(safe)}" alt="${esc(label || "이미지")}" />`;
    if (/\.(mp4|webm|ogg|mov|m4v)$/.test(path)) return `<video src="${esc(safe)}" controls playsinline></video>`;
    return `<a class="mobile-media-link" href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(safe)}</a>`;
  }

  function closeMediaPopup() {
    const popup = $("mediaPopup");
    if (!popup) return;
    popup.hidden = true;
    popup.classList.remove("open");
    const body = $("mediaPopupBody");
    if (body) body.innerHTML = "";
    document.querySelectorAll(".mobile-media-trigger.open").forEach((el) => el.classList.remove("open"));
    document.body.classList.remove("media-popup-open");
  }

  function openMediaPopup(trigger) {
    const popup = $("mediaPopup");
    const title = $("mediaPopupTitle");
    const body = $("mediaPopupBody");
    if (!popup || !title || !body) return;
    const label = trigger.getAttribute("data-media-label") || "미디어";
    const url = trigger.getAttribute("data-media-url") || "";
    title.textContent = label;
    body.innerHTML = mediaEmbedHtml(url, label);
    document.querySelectorAll(".mobile-media-trigger.open").forEach((el) => el.classList.remove("open"));
    trigger.classList.add("open");
    popup.hidden = false;
    popup.classList.add("open");
    document.body.classList.add("media-popup-open");
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
    closeMediaPopup();
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
        html += mediaTriggerHtml(media.label, media.url);
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
          html += bracket[1].toLowerCase() === "t"
            ? `<span class="schedule-inline-tag">${directiveInlineHtml(text)}</span>`
            : esc(text);
          i = end + 1;
          plainStart = i;
          continue;
        }
      }
      const inline = raw.slice(i).match(/^:(s|t)\s+([^\s:]+)/i);
      if (inline) {
        flushPlain(i);
        html += inline[1].toLowerCase() === "t"
          ? `<span class="schedule-inline-tag">${esc(inline[2].trim())}</span>`
          : esc(inline[2].trim());
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

  function monthEntryLines(entry) {
    if (!entry) return ["미정"];
    if (entry.status === "off") return ["휴방"];
    if (entry.parts && entry.parts.length) {
      const lines = entry.parts.map((part) => {
        if (part.displayType === "profile" && part.profile) return part.profile.channelName;
        return directiveText(part.content);
      }).filter(Boolean);
      return lines.length ? lines : ["방송 예정"];
    }
    return [entryTitle(entry) || "방송 예정"];
  }
  function timeText(entry) {
    if (!entry || entry.status === "off") return "";
    if (!entry.start) return "시간 미정";
    return entry.end ? `${entry.start} ~ ${entry.end}` : `${entry.start} ~`;
  }

  function safeUrl(value) {
    try {
      const parsed = new URL(String(value || "").trim());
      return parsed.protocol === "https:" ? parsed.href : "";
    } catch (_e) {
      return "";
    }
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

  function renderEntryBody(entry) {
    if (!entry) return `<p class="muted">등록된 일정이 없습니다.</p>`;
    if (entry.status === "off") return `<p class="muted">휴방으로 표시된 날입니다.</p>`;
    if (entry.parts.length) {
      return `<div class="content-lines">${entry.parts.map((part, index) => {
        const label = partLabel(part, index);
        const textHtml = part.displayType === "profile" && part.profile ? esc(part.profile.channelName) : directiveInlineHtml(part.content);
        return `<div class="part-line">${label ? `<span class="part-tag">${esc(label)}</span>` : ""}<span class="part-text">${textHtml || "내용 미정"}</span></div>`;
      }).join("")}</div>`;
    }
    return `<p class="part-text">${directiveInlineHtml(entry.titleShort || entry.title || entryTitle(entry))}</p>`;
  }

  function scheduleNotesHtml(entry) {
    if (!entry || !entry.notes || !entry.notes.length) return "";
    return `<section class="schedule-card-notes" aria-label="메모">
      <div class="schedule-card-notes-title">메모</div>
      ${entry.notes.map((note) => `<span class="schedule-card-note">${directiveInlineHtml(note)}</span>`).join("")}
    </section>`;
  }

  function collabMembersHtml(part) {
    if (!part || !part.collab || !part.members || !part.members.length) return "";
    return `<div class="schedule-card-members" aria-label="합방 멤버">${part.members.map((member) =>
      `<span class="schedule-card-member">${esc(member.channelName || "이름 없음")}</span>`
    ).join("")}</div>`;
  }

  function scheduleCardHtml(key, entry, part, index) {
    const isToday = key === todayKey();
    const isOff = entry && entry.status === "off";
    const hasEntry = !!entry;
    const label = part ? partLabel(part, index) : "";
    const titleHtml = part
      ? (part.displayType === "profile" && part.profile ? esc(part.profile.channelName) : directiveInlineHtml(part.content))
      : (entry ? directiveInlineHtml(entry.titleShort || entry.title || entryTitle(entry)) : "");
    const badge = isOff ? "휴방" : label || (hasEntry ? "일정" : "미정");
    const tagText = badge;
    const tagClass = part && part.speculative ? " speculative" :
      part && (part.collab || part.official || part.otherChannel || part.ad || part.outdoor) ? " special" : "";
    return `
      <article class="schedule-card${isToday ? " today" : ""}${isOff ? " off" : ""}${!hasEntry ? " empty" : ""}">
        <div class="schedule-card-tag${tagClass}">${esc(tagText)}</div>
        <div class="schedule-card-main">
          <div class="timeline-card-head">
            <div>
              <div class="date-label">${titleHtml || "등록된 일정 없음"}</div>
            </div>
          </div>
          ${collabMembersHtml(part)}
          ${!part && !hasEntry ? `<p class="muted">등록된 일정이 없습니다.</p>` : ""}
          ${!part && hasEntry && !entry.parts.length ? renderEntryBody(entry) : ""}
        </div>
      </article>
    `;
  }

  function renderSelectedSchedule() {
    const key = state.selectedDate || todayKey();
    const entry = entriesByDate().get(key) || null;
    $("selectedScheduleHeading").textContent = key === todayKey() ? "오늘 일정" : fullDateLabel(key);
    if (entry && entry.parts && entry.parts.length && entry.status !== "off") {
      $("scheduleList").innerHTML = entry.parts.map((part, index) =>
        scheduleCardHtml(key, entry, part, index)
      ).join("") + scheduleNotesHtml(entry);
      return;
    }
    $("scheduleList").innerHTML = scheduleCardHtml(key, entry, null, 0) + scheduleNotesHtml(entry);
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
      const mediaTrigger = event.target.closest && event.target.closest(".mobile-media-trigger");
      if (mediaTrigger) {
        event.preventDefault();
        if (mediaTrigger.classList.contains("open")) closeMediaPopup();
        else openMediaPopup(mediaTrigger);
        return;
      }
      if (event.target.closest && event.target.closest("[data-media-close]")) {
        closeMediaPopup();
        return;
      }
      if (event.target.closest && event.target.closest("[data-info-close]")) {
        closeInfoPopup();
        return;
      }
      const infoPopup = $("infoPopup");
      if (infoPopup && !infoPopup.hidden && event.target === infoPopup) {
        closeInfoPopup();
        return;
      }
      const popup = $("mediaPopup");
      if (popup && !popup.hidden && event.target === popup) {
        closeMediaPopup();
        return;
      }
      const calendarDay = event.target.closest && event.target.closest("[data-calendar-date]");
      if (calendarDay) {
        setSelectedDate(calendarDay.getAttribute("data-calendar-date"));
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeMediaPopup();
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





