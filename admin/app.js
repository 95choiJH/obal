// app.js — 관리자 페이지 로직 (Supabase Auth + 일정 편집/저장)

(() => {
  "use strict";

  const cfg = ADMIN_CONFIG;
  const sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
  const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
  const INFO_SECTION_PREFIX = "@section:";
  const STRUCTURED_INFO_PREFIX = "@info-v2:";
  const UPDATE_HISTORY_PREFIX = "@update:";
  const AUTO_LIVE_CATEGORY_SYNC_SETTING_KEY = "auto_live_category_sync";
  const GNIMTI_CONTENT_SETTING_KEY = "gnimti_content";
  const GNIMTI_IMAGE_BUCKET = cfg.gnimtiImageBucketName || "game-images";

  // ---- 상태 ----
  let rows = [];         // 현재 편집 중인 일정 (로컬)
  let info = [];         // 현재 편집 중인 소식/예정 컨텐츠 (로컬)
  let feedback = [];     // 문의·제보함 (읽기 전용)
  let feedbackFilter = "all";
  let feedbackTypeFilter = "all";
  let activeAdminMenu = "schedule";
  let selectedScheduleDate = "";
  let scheduleMonthOffset = 0;
  let original = "";     // 원본 스냅샷 (dirty 판정용)
  let deletedIds = [];    // 저장 시 삭제할 기존 일정 행 id
  let deletedInfoIds = []; // 저장 시 삭제할 기존 소식/예정 컨텐츠 행 id
  let canManage = false;
  let adminSettings = { autoLiveCategorySync: false, gnimtiContent: emptyGnimtiContent() };
  let adminSettingsLoadError = "";
  const gameCategoryCache = new Map();

  // ---- DOM ----
  const $ = (id) => document.getElementById(id);
  const loginView = $("login");
  const appView = $("app");

  // ---- 유틸 ----
  const todayKey = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  };
  function fmtDate(key) {
    const [y, m, d] = key.split("-").map(Number);
    const wd = new Date(y, m - 1, d).getDay();
    return m + "/" + d + " (" + WEEK[wd] + ")";
  }
  function snapshot() {
    const scheduleSnap = rows.map((r) => ({
      date: r.date, start: r.start_time || "", end: r.end_time || "",
      title: r.title || "",
      parts: (r.parts || []).map((p) => ({
        content: p.content || "",
        label: p.label || "",
        hidePartLabel: !!p.hidePartLabel,
        displayType: p.displayType || "text",
        profile: (p.profile && p.profile.channelId) || (p.profile && p.profile.channelName) || "",
        collab: !!p.collab,
        official: !!p.official,
        otherChannel: !!p.otherChannel,
        ad: !!p.ad,
        outdoor: !!p.outdoor,
        speculative: !!p.speculative,
        members: (p.members || []).map((m) => m.channelId),
        hostChannel: (p.hostChannel && p.hostChannel.channelId) || "",
        notes: normalizeNotes(p.notes),
      })),
      gameImages: (r.gameImages || r.game_images || []).map((g) => ({ url: g.url || "", label: g.label || "", categoryId: g.categoryId || "", categoryType: g.categoryType || "", posterImageUrl: g.posterImageUrl || "" })),
      vods: (r.vods || []).map((v) => ({ url: v.url || "", label: v.label || "" })),
      status: r.status || "", cafe_time: !!r.cafe_time, video_time: !!r.video_time, notes: r.notes || normalizeNotes(r.note),
    })).sort(compareScheduleDate);
    // 순서 자체가 의미 있는 데이터라 정렬하지 않고 배열 순서 그대로 비교
    const infoSnap = info.map((u) => ({ id: u.id || 0, content: u.content || "", hidden: !!u.hidden }));
    return (
      JSON.stringify(scheduleSnap) + "|" + deletedIds.join(",") +
      "||" + JSON.stringify(infoSnap) + "|" + deletedInfoIds.join(",") +
      "||" + JSON.stringify(adminSettings)
    );
  }
  function markDirty() {
    const dirty = snapshot() !== original;
    const st = $("saveStatus");
    $("saveBtn").disabled = !canManage || !dirty;
    if (!canManage) {
      st.textContent = "읽기 전용: admin_users 권한 필요";
      st.classList.add("dirty");
      return;
    }
    st.textContent = dirty ? "저장되지 않은 변경 있음" : "변경 없음";
    st.classList.toggle("dirty", dirty);
  }
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2200);
  }

  function backupTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }

  function backupDraftRows() {
    return rows.map((r) => ({
      ...r,
      parts: (r.parts || []).map((p) => ({
        ...p,
        notes: normalizeNotes(p.notes || p.note),
      })),
      notes: normalizeNotes(r.notes || r.note),
    }));
  }

  async function createScheduleBackup(reason) {
    const infoTable = cfg.upcomingContentTableName || "upcoming_content";
    const [{ data: scheduleData, error: scheduleError }, { data: infoData, error: infoError }] = await Promise.all([
      sb.from(cfg.tableName).select("*").order("date", { ascending: true }),
      sb.from(infoTable).select("*").order("sort_order", { ascending: true }).order("id", { ascending: true }),
    ]);
    if (scheduleError) throw scheduleError;
    if (infoError) throw infoError;

    const payload = {
      version: 1,
      reason: reason || "before-save",
      createdAt: new Date().toISOString(),
      channelId: cfg.channelId,
      tables: {
        [cfg.tableName]: scheduleData || [],
        [infoTable]: infoData || [],
      },
      draft: {
        rows: backupDraftRows(),
        info: info.map((item) => ({ ...item })),
        deletedIds: [...deletedIds],
        deletedInfoIds: [...deletedInfoIds],
      },
    };

    const filePath = cfg.channelId + "/" + backupTimestamp() + "-" + (reason || "before-save") + ".json";
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const { error: uploadError } = await sb.storage
      .from("schedule-backups")
      .upload(filePath, blob, { contentType: "application/json;charset=utf-8", upsert: false });
    if (uploadError) throw uploadError;
    return filePath;
  }

  // ---- 로그인 ----
  async function doLogin() {
    const email = $("email").value.trim();
    const password = $("password").value;
    const err = $("loginErr");
    const btn = $("loginBtn");
    err.textContent = "";
    if (!email || !password) { err.textContent = "이메일과 비밀번호를 입력하세요."; return; }
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>';
    const { error } = await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    btn.textContent = "로그인";
    if (error) {
      err.textContent = "로그인에 실패했습니다. 이메일과 비밀번호를 확인하세요.";
      return;
    }
    enterApp();
  }

  async function doLogout() {
    if (snapshot() !== original && !confirm("저장하지 않은 변경이 있습니다. 로그아웃할까요?")) return;
    await sb.auth.signOut();
    appView.classList.add("hidden");
    setFeedbackDrawer(false);
    loginView.classList.remove("hidden");
    $("password").value = "";
  }

  async function checkAdminAccess() {
    const { data: sessionData } = await sb.auth.getSession();
    const uid = sessionData && sessionData.session && sessionData.session.user && sessionData.session.user.id;
    if (!uid) { canManage = false; return; }
    const { data, error } = await sb
      .from("admin_users")
      .select("user_id")
      .eq("user_id", uid)
      .maybeSingle();
    canManage = !error && !!data;
    if (!canManage) toast("관리자 UID가 admin_users에 없어 읽기 전용으로 열렸습니다.");
  }

  // ---- 일정 + 소식/예정 컨텐츠 로드 ----
  async function loadAll() {
    const { data, error } = await sb
      .from(cfg.tableName)
      .select("*")
      .eq("channel_id", cfg.channelId)
      .order("date", { ascending: false });
    if (error) { toast("\uBD88\uB7EC\uC624\uAE30 \uC2E4\uD328: " + error.message); return; }
    rows = (data || []).map((r) => ({
      ...r,
      notes: normalizeNotes(r.note),
      parts: Array.isArray(r.parts) ? r.parts.map(normalizePart) : [],
      gameImages: Array.isArray(r.game_images) ? r.game_images.map(normalizeGameImage).filter(Boolean) : [],
      vods: Array.isArray(r.vods) ? r.vods.map(normalizeVod).filter(Boolean) : [],
    })).sort(compareScheduleDate);

    // 소식 테이블은 아직 없을 수 있으므로(선택 기능) 실패해도 일정 로드는 유지
    const { data: infoData, error: infoError } = await sb
      .from(cfg.upcomingContentTableName)
      .select("*")
      .eq("channel_id", cfg.channelId)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    info = infoError ? [] : (infoData || []).map((u) => ({ id: u.id, content: u.content || "", hidden: !!u.hidden }));
    await loadAdminSettings();

    deletedIds = [];
    deletedInfoIds = [];
    original = snapshot();
    render();
    markDirty();
    loadFeedback();
  }


  function emptyGnimtiMember() {
    return { name: "", position: "탑", tier: "", selfImageUrl: "", analysisImageUrl: "" };
  }

  function emptyGnimtiContent() {
    return { version: 1, september: { members: [], tierlistImageUrl: "", rosterImageUrls: [] } };
  }

  function normalizeGnimtiContent(value) {
    const base = emptyGnimtiContent();
    const source = value && typeof value === "object" ? value : {};
    const september = source.september && typeof source.september === "object" ? source.september : {};
    base.september.members = Array.isArray(september.members) ? september.members.map((member) => ({
      name: String((member && member.name) || ""),
      position: String((member && member.position) || "탑"),
      tier: String((member && member.tier) || "").toUpperCase(),
      selfImageUrl: String((member && (member.selfImageUrl || member.self_image_url)) || ""),
      analysisImageUrl: String((member && (member.analysisImageUrl || member.analysis_image_url)) || ""),
    })) : [];
    base.september.tierlistImageUrl = String(september.tierlistImageUrl || september.tierlist_image_url || "");
    base.september.rosterImageUrls = Array.isArray(september.rosterImageUrls || september.roster_image_urls)
      ? (september.rosterImageUrls || september.roster_image_urls).map((url) => String(url || ""))
      : [];
    return base;
  }
  function adminSettingsTableName() {
    return cfg.adminSettingsTableName || "admin_settings";
  }

  function autoLiveCategorySyncEnabledFromValue(value) {
    if (typeof value === "boolean") return value;
    if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "enabled")) return value.enabled === true;
    return false;
  }

  async function loadAdminSettings() {
    adminSettings = { autoLiveCategorySync: false, gnimtiContent: emptyGnimtiContent() };
    adminSettingsLoadError = "";
    const { data, error } = await sb
      .from(adminSettingsTableName())
      .select("key,value")
      .eq("channel_id", cfg.channelId)
      .in("key", [AUTO_LIVE_CATEGORY_SYNC_SETTING_KEY, GNIMTI_CONTENT_SETTING_KEY]);
    if (error) {
      adminSettingsLoadError = error.message || String(error);
      console.warn("[admin] 설정 로드 실패:", error);
      return;
    }
    (data || []).forEach((row) => {
      if (row.key === AUTO_LIVE_CATEGORY_SYNC_SETTING_KEY) adminSettings.autoLiveCategorySync = autoLiveCategorySyncEnabledFromValue(row.value);
      if (row.key === GNIMTI_CONTENT_SETTING_KEY) adminSettings.gnimtiContent = normalizeGnimtiContent(row.value);
    });
  }

  async function saveAdminSettings() {
    if (adminSettingsLoadError) return;
    const now = new Date().toISOString();
    const payload = [
      {
        channel_id: cfg.channelId,
        key: AUTO_LIVE_CATEGORY_SYNC_SETTING_KEY,
        value: { enabled: !!adminSettings.autoLiveCategorySync },
        updated_at: now,
      },
      {
        channel_id: cfg.channelId,
        key: GNIMTI_CONTENT_SETTING_KEY,
        value: normalizeGnimtiContent(adminSettings.gnimtiContent),
        updated_at: now,
      },
    ];
    const { error } = await sb
      .from(adminSettingsTableName())
      .upsert(payload, { onConflict: "channel_id,key" });
    if (error) throw error;
  }
  async function loadFeedback() {
    const list = $("feedbackList");
    const count = $("feedbackCount");
    const refresh = $("feedbackRefresh");
    if (!list) return;
    refresh.disabled = true;
    list.innerHTML = '<div class="empty" style="padding:18px 0;">불러오는 중…</div>';
    const { data, error } = await sb
      .from(cfg.feedbackTableName || "feedback")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    refresh.disabled = false;
    if (error) {
      feedback = [];
      count.textContent = "";
      $("feedbackToggleCount").textContent = "0";
      list.innerHTML = '<div class="feedback-error">문의·제보를 조회할 수 없습니다.<br>Supabase에 관리자 SELECT 정책이 설정되어 있는지 확인해주세요.</div>';
      return;
    }
    feedback = data || [];
    count.textContent = feedback.length + "건";
    $("feedbackToggleCount").textContent = String(feedback.filter((item) => (item.status || "new") !== "done").length);
    renderFeedbackTypeFilters();
    renderFeedbackList();
  }

  function feedbackTypeOf(item) {
    return String(item && item.type || "기타").trim() || "기타";
  }

  function renderFeedbackTypeFilters() {
    const filters = $("feedbackTypeFilters");
    if (!filters) return;
    const preferredOrder = ["일정", "건의", "버그 제보", "문의", "기타"];
    const types = [...new Set(feedback.map(feedbackTypeOf))].sort((a, b) => {
      const ai = preferredOrder.indexOf(a);
      const bi = preferredOrder.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? preferredOrder.length : ai) - (bi === -1 ? preferredOrder.length : bi);
      return a.localeCompare(b, "ko");
    });
    if (feedbackTypeFilter !== "all" && !types.includes(feedbackTypeFilter)) feedbackTypeFilter = "all";
    filters.innerHTML = '<span class="feedback-filter-label">종류</span>' +
      '<button class="feedback-filter' + (feedbackTypeFilter === "all" ? " active" : "") +
      '" data-feedback-type-filter="all">전체</button>' +
      types.map((type) => '<button class="feedback-filter' + (feedbackTypeFilter === type ? " active" : "") +
        '" data-feedback-type-filter="' + esc(type) + '">' + esc(type) + "</button>").join("");
    filters.querySelectorAll("[data-feedback-type-filter]").forEach((button) => {
      button.onclick = () => {
        feedbackTypeFilter = button.getAttribute("data-feedback-type-filter") || "all";
        renderFeedbackTypeFilters();
        renderFeedbackList();
      };
    });
  }

  function renderFeedbackList() {
    const list = $("feedbackList");
    if (!list) return;
    const visible = feedback.filter((item) =>
      (feedbackFilter === "all" || (item.status || "new") === feedbackFilter) &&
      (feedbackTypeFilter === "all" || feedbackTypeOf(item) === feedbackTypeFilter));
    list.innerHTML = visible.length ? visible.map(feedbackItemHtml).join("") :
      '<div class="empty" style="padding:18px 0;">선택한 조건에 해당하는 문의·제보가 없습니다.</div>';
    bindFeedbackCards();
  }

  function feedbackItemHtml(item) {
    const created = item.created_at ? new Date(item.created_at).toLocaleString("ko-KR", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }) : "";
    let safeLink = "";
    if (item.related_link) {
      try {
        const parsed = new URL(item.related_link);
        if (parsed.protocol === "http:" || parsed.protocol === "https:") safeLink = parsed.href;
      } catch (_e) { /* 잘못된 링크는 버튼을 만들지 않음 */ }
    }
    const link = safeLink ? '<a href="' + esc(safeLink) + '" target="_blank" rel="noopener noreferrer">관련 링크 열기</a>' : "";
    const contact = item.contact ? '<span>이메일: ' + esc(item.contact) + "</span>" : "";
    const status = ["new", "checking", "hold", "done"].includes(item.status) ? item.status : "new";
    const statusButton = (value, label) => '<button type="button" class="feedback-status-btn' +
      (status === value ? " active" : "") + '" data-feedback-id="' + esc(item.id) + '" data-status="' + value + '">' + label + "</button>";
    const deleteButton = '<button type="button" class="feedback-delete-btn" data-feedback-delete="' + esc(item.id) + '" aria-label="문의 삭제">삭제</button>';
    return '<article class="feedback-card feedback-status-' + status + '">' +
      '<div class="feedback-meta"><span class="feedback-type">' + esc(item.type || "기타") + '</span>' +
      '<span class="feedback-date">' + esc(created) + "</span>" + deleteButton + "</div>" +
      '<div class="feedback-message">' + esc(item.message || "") + "</div>" +
      ((link || contact) ? '<div class="feedback-details">' + link + contact + "</div>" : "") +
      '<div class="feedback-status-actions">' + statusButton("new", "접수") +
      statusButton("checking", "확인중") + statusButton("hold", "보류") + statusButton("done", "처리완료") + "</div>" +
      "</article>";
  }

  function bindFeedbackCards() {
    document.querySelectorAll("[data-feedback-delete]").forEach((button) => {
      button.onclick = async () => {
        const id = button.getAttribute("data-feedback-delete");
        if (!id) return;
        if (!confirm("이 문의·제보를 삭제할까요?")) return;
        button.disabled = true;
        const { error } = await sb.from(cfg.feedbackTableName || "feedback").delete().eq("id", id);
        if (error) {
          toast("문의 삭제 실패: " + error.message);
          button.disabled = false;
          return;
        }
        feedback = feedback.filter((entry) => String(entry.id) !== String(id));
        $("feedbackCount").textContent = feedback.length + "건";
        $("feedbackToggleCount").textContent = String(feedback.filter((entry) => (entry.status || "new") !== "done").length);
        renderFeedbackTypeFilters();
        renderFeedbackList();
        toast("문의·제보를 삭제했습니다.");
      };
    });
    document.querySelectorAll("[data-feedback-id][data-status]").forEach((button) => {
      button.onclick = async () => {
        const id = button.getAttribute("data-feedback-id");
        const status = button.getAttribute("data-status");
        button.disabled = true;
        const { error } = await sb.from(cfg.feedbackTableName || "feedback").update({ status }).eq("id", id);
        if (error) {
          toast("\ubb38\uc758 \uc0c1\ud0dc \ubcc0\uacbd \uc2e4\ud328: " + error.message);
          button.disabled = false;
          return;
        }
        const item = feedback.find((entry) => String(entry.id) === String(id));
        if (item) item.status = status;
        $("feedbackToggleCount").textContent = String(feedback.filter((entry) => (entry.status || "new") !== "done").length);
        renderFeedbackList();
      };
    });
  }

  // ---- 렌더 ----
  function compareScheduleDate(a, b) {
    if (a._newlyAdded !== b._newlyAdded) return a._newlyAdded ? -1 : 1;
    return String(b.date || "").localeCompare(String(a.date || ""));
  }

  function monthKeyFromOffset(offset) {
    const baseKey = selectedScheduleDate || todayKey();
    const [y, m] = baseKey.split("-").map(Number);
    const d = new Date(y, (m || 1) - 1 + offset, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  function scheduleCalendarHtml() {
    const month = monthKeyFromOffset(scheduleMonthOffset);
    const byDate = new Map(rows.map((row, index) => [row.date, { row, index }]));
    const first = new Date(month.year, month.month - 1, 1);
    const days = new Date(month.year, month.month, 0).getDate();
    let html = '<section class="admin-schedule-calendar">' +
      '<div class="admin-calendar-head">' +
        '<button type="button" class="admin-calendar-arrow" data-admin-month="prev" aria-label="이전 달">‹</button>' +
        '<div class="admin-calendar-title">' + month.year + "." + String(month.month).padStart(2, "0") + '</div>' +
        '<button type="button" class="admin-calendar-arrow" data-admin-month="next" aria-label="다음 달">›</button>' +
      '</div>' +
      '<div class="admin-calendar-grid">' + WEEK.map((day) => '<div class="admin-calendar-weekday">' + day + '</div>').join("");
    for (let i = 0; i < first.getDay(); i++) html += '<div class="admin-calendar-blank"></div>';
    for (let day = 1; day <= days; day++) {
      const key = month.year + "-" + String(month.month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
      const item = byDate.get(key);
      const row = item && item.row;
      const classes = ["admin-calendar-day"];
      if (key === todayKey()) classes.push("is-today");
      if (key === selectedScheduleDate) classes.push("is-selected");
      if (row) classes.push("has-schedule");
      if (row && row.status === "off") classes.push("is-off");
      const label = row ? (row.status === "off" ? "휴방" : (row.start_time || "미정")) : "";
      html += '<button type="button" class="' + classes.join(" ") + '" data-admin-date="' + key + '">' +
        '<span class="admin-calendar-date">' + day + '</span>' +
        (label ? '<span class="admin-calendar-chip">' + esc(label) + '</span>' : '') +
      '</button>';
    }
    const used = first.getDay() + days;
    const trailing = used % 7;
    if (trailing) for (let i = trailing; i < 7; i++) html += '<div class="admin-calendar-blank"></div>';
    return html + '</div></section>';
  }

  function selectedScheduleIndex() {
    if (!selectedScheduleDate) return -1;
    return rows.findIndex((row) => row.date === selectedScheduleDate);
  }

  function selectedScheduleDetailHtml() {
    const index = selectedScheduleIndex();
    const label = selectedScheduleDate ? fmtDate(selectedScheduleDate) : "날짜 선택";
    if (index < 0) {
      return '<section class="admin-schedule-detail"><div class="admin-detail-empty">' +
        '<strong>' + esc(label) + '</strong>' +
        '<span>등록된 일정이 없습니다.</span>' +
        '<button type="button" class="add-btn" data-add-selected-date="1">이 날짜에 일정 추가</button>' +
      '</div></section>';
    }
    return '<section class="admin-schedule-detail"><div class="admin-detail-title">' + esc(label) + '</div>' + cardHtml(rows[index], index) + '</section>';
  }
  function render() {
    const list = $("list");
    rows.sort(compareScheduleDate);
    if (!selectedScheduleDate) selectedScheduleDate = rows.find((row) => row.date === todayKey()) ? todayKey() : ((rows[0] && rows[0].date) || todayKey());

    if (list) {
      const addHeader = '<div class="schedule-group-head"><p class="group-label">\uc77c\uc815</p><button type="button" class="add-btn schedule-add-btn" data-addrow="1">+ \ub0a0\uc9dc</button></div>';
      list.innerHTML = addHeader + scheduleCalendarHtml() + selectedScheduleDetailHtml();
      bindCards();
    }

    renderInfo();
    renderNotice();
    renderUpdates();
    renderSettings();
    renderGnimtiAdmin();
    setActiveAdminMenu(activeAdminMenu);
    bindDirectiveAutocompletes();
  }


  function renderSettings() {
    const list = $("settingsList");
    if (!list) return;
    const enabled = !!adminSettings.autoLiveCategorySync;
    const warning = adminSettingsLoadError
      ? '<div class="settings-warning">설정 테이블을 확인할 수 없습니다. SQL 설정 전까지 자동 동기화는 기본 OFF로 동작합니다.</div>'
      : '';
    list.innerHTML =
      '<div class="schedule-group-head"><p class="group-label">설정</p></div>' +
      '<div class="card settings-card">' +
        '<div class="settings-row">' +
          '<div class="settings-copy">' +
            '<div class="settings-title">자동 카테고리/부 생성</div>' +
            '<div class="settings-desc">방송 카테고리를 감지해 게임 목록과 부 제목을 자동으로 반영합니다.</div>' +
          '</div>' +
          '<button type="button" class="settings-toggle" data-setting-auto-live-sync="1" aria-pressed="' + (enabled ? 'true' : 'false') + '">' +
            '<span class="toggle-label">' + (enabled ? 'ON' : 'OFF') + '</span>' +
            '<span class="toggle' + (enabled ? ' on' : '') + '"><span class="knob"></span></span>' +
          '</button>' +
        '</div>' +
        warning +
      '</div>';
    bindSettingsCards();
  }

  function bindSettingsCards() {
    document.querySelectorAll("[data-setting-auto-live-sync]").forEach((el) => {
      el.onclick = () => {
        adminSettings.autoLiveCategorySync = !adminSettings.autoLiveCategorySync;
        renderSettings();
        markDirty();
      };
    });
  }

  function gnimtiContent() {
    adminSettings.gnimtiContent = normalizeGnimtiContent(adminSettings.gnimtiContent);
    return adminSettings.gnimtiContent;
  }

  function gnimtiSeptember() {
    return gnimtiContent().september;
  }

  function gnimtiPositions() {
    return ["탑", "정글", "미드", "원딜", "서포터"];
  }

  function gnimtiTiers() {
    return ["", "S", "A", "B", "C", "D"];
  }

  function imageFieldHtml(label, value, target, uploadKind) {
    const url = String(value || "");
    return '<div class="gnimti-image-field">' +
      '<label>' + esc(label) + '</label>' +
      '<div class="gnimti-image-row">' +
        '<input type="url" inputmode="url" data-gnimti-url="' + esc(target) + '" value="' + esc(url) + '" placeholder="이미지 URL 또는 업로드" />' +
        '<button type="button" class="add-btn small" data-gnimti-upload="' + esc(target) + '" data-upload-kind="' + esc(uploadKind || "image") + '">업로드</button>' +
      '</div>' +
      (url ? '<div class="gnimti-image-preview"><img src="' + esc(url) + '" alt="" /></div>' : '') +
    '</div>';
  }

  function renderGnimtiAdmin() {
    const list = $("gnimtiList");
    if (!list) return;
    const data = gnimtiSeptember();
    const members = data.members || [];
    const rosters = data.rosterImageUrls && data.rosterImageUrls.length ? data.rosterImageUrls : [""];
    list.innerHTML = '<div class="schedule-group-head"><p class="group-label">9월 그님티</p></div>' +
      '<div class="card gnimti-admin-card">' +
        '<div class="gnimti-admin-head"><div><div class="settings-title">9월 그님티 평가</div><div class="settings-desc">스트리머별 본인 평가/분석관팀 평가 이미지를 업로드합니다.</div></div><button type="button" class="add-btn schedule-add-btn" data-gnimti-add-member="1">+ 스트리머</button></div>' +
        '<div class="gnimti-member-list">' + (members.length ? members.map(gnimtiMemberAdminHtml).join("") : '<div class="empty" style="padding:16px 0;">등록된 스트리머가 없습니다.</div>') + '</div>' +
      '</div>' +
      '<div class="card gnimti-admin-card">' +
        '<div class="settings-title">9월 티어리스트</div>' +
        imageFieldHtml("티어리스트 이미지", data.tierlistImageUrl, "tierlist", "tierlist") +
      '</div>' +
      '<div class="card gnimti-admin-card">' +
        '<div class="gnimti-admin-head"><div><div class="settings-title">9월 로스터</div><div class="settings-desc">여러 장이면 프론트에서 위에서 아래 순서로 표시됩니다.</div></div><button type="button" class="add-btn schedule-add-btn" data-gnimti-add-roster="1">+ 로스터 이미지</button></div>' +
        '<div class="gnimti-roster-list">' + rosters.map((url, index) => gnimtiRosterAdminHtml(url, index, rosters.length)).join("") + '</div>' +
      '</div>';
    bindGnimtiAdmin();
  }

  function gnimtiMemberAdminHtml(member, index) {
    const positionOptions = gnimtiPositions().map((position) => '<option value="' + esc(position) + '"' + (member.position === position ? ' selected' : '') + '>' + esc(position) + '</option>').join("");
    const tierOptions = gnimtiTiers().map((tier) => '<option value="' + esc(tier) + '"' + (member.tier === tier ? ' selected' : '') + '>' + (tier || '티어 없음') + '</option>').join("");
    return '<div class="gnimti-member-card" data-gnimti-member-card="' + index + '">' +
      '<div class="gnimti-member-main">' +
        '<input type="text" data-gnimti-member-field="name" data-mi="' + index + '" value="' + esc(member.name || "") + '" placeholder="스트리머명" />' +
        '<select data-gnimti-member-field="position" data-mi="' + index + '">' + positionOptions + '</select>' +
        '<select data-gnimti-member-field="tier" data-mi="' + index + '">' + tierOptions + '</select>' +
        '<div class="info-card-actions">' +
          '<button class="move-btn" data-gnimti-member-move="up" data-mi="' + index + '"' + (index === 0 ? ' disabled' : '') + ' aria-label="위로 이동">▲</button>' +
          '<button class="move-btn" data-gnimti-member-move="down" data-mi="' + index + '"' + (index === gnimtiSeptember().members.length - 1 ? ' disabled' : '') + ' aria-label="아래로 이동">▼</button>' +
          '<button type="button" class="icon-btn" data-gnimti-member-del="' + index + '" aria-label="삭제">' + trashSvg() + '</button>' +
        '</div>' +
      '</div>' +
      '<div class="gnimti-member-images">' +
        imageFieldHtml("본인 평가", member.selfImageUrl, "member:" + index + ":selfImageUrl", "self") +
        imageFieldHtml("분석관팀 평가", member.analysisImageUrl, "member:" + index + ":analysisImageUrl", "analysis") +
      '</div>' +
    '</div>';
  }

  function gnimtiRosterAdminHtml(url, index, total) {
    return '<div class="gnimti-roster-item">' +
      imageFieldHtml("로스터 이미지 " + (index + 1), url, "roster:" + index, "roster") +
      '<button type="button" class="icon-btn" data-gnimti-roster-del="' + index + '" aria-label="로스터 이미지 삭제"' + (total <= 1 && !url ? ' disabled' : '') + '>' + trashSvg() + '</button>' +
    '</div>';
  }

  function setGnimtiImageValue(target, value) {
    const data = gnimtiSeptember();
    if (target === "tierlist") data.tierlistImageUrl = value;
    else if (target.startsWith("roster:")) {
      const index = Number(target.split(":")[1]);
      data.rosterImageUrls[index] = value;
    } else if (target.startsWith("member:")) {
      const parts = target.split(":");
      const index = Number(parts[1]);
      const field = parts[2];
      data.members[index] = data.members[index] || emptyGnimtiMember();
      data.members[index][field] = value;
    }
  }

  function sanitizeUploadName(name) {
    return String(name || "image").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "image";
  }

  async function uploadGnimtiImage(file, kind) {
    if (!file) return "";
    if (!/^image\//i.test(file.type || "")) throw new Error("이미지 파일만 업로드할 수 있습니다.");
    const ext = (file.name.match(/\.[a-z0-9]+$/i) || [""])[0].toLowerCase();
    const filePath = "gnimti/" + cfg.channelId + "/september/" + (kind || "image") + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8) + ext;
    const { error } = await sb.storage.from(GNIMTI_IMAGE_BUCKET).upload(filePath, file, { contentType: file.type || "image/png", upsert: false });
    if (error) throw error;
    const { data } = sb.storage.from(GNIMTI_IMAGE_BUCKET).getPublicUrl(filePath);
    return data && data.publicUrl ? data.publicUrl : "";
  }

  function chooseGnimtiImage(target, kind, button) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (button) { button.disabled = true; button.textContent = "업로드 중"; }
      try {
        const url = await uploadGnimtiImage(file, kind);
        setGnimtiImageValue(target, url);
        renderGnimtiAdmin();
        markDirty();
        toast("이미지를 업로드했습니다.");
      } catch (error) {
        console.error("[admin] 그님티 이미지 업로드 실패", error);
        const message = (error && (error.message || error.error_description || error.error)) || String(error || "알 수 없는 오류");
        toast("이미지 업로드 실패: " + message);
        if (button) { button.disabled = false; button.textContent = "업로드"; }
      }
    };
    input.click();
  }

  function bindGnimtiAdmin() {
    document.querySelectorAll("[data-gnimti-member-field]").forEach((el) => {
      const index = Number(el.getAttribute("data-mi"));
      const field = el.getAttribute("data-gnimti-member-field");
      el.oninput = el.onchange = () => {
        const data = gnimtiSeptember();
        data.members[index] = data.members[index] || emptyGnimtiMember();
        data.members[index][field] = field === "tier" ? String(el.value || "").toUpperCase() : el.value;
        markDirty();
      };
    });
    document.querySelectorAll("[data-gnimti-url]").forEach((el) => {
      const target = el.getAttribute("data-gnimti-url") || "";
      el.oninput = () => {
        setGnimtiImageValue(target, el.value);
        markDirty();
      };
    });
    document.querySelectorAll("[data-gnimti-upload]").forEach((el) => {
      el.onclick = () => chooseGnimtiImage(el.getAttribute("data-gnimti-upload") || "", el.getAttribute("data-upload-kind") || "image", el);
    });
    document.querySelectorAll("[data-gnimti-add-member]").forEach((el) => {
      el.onclick = () => { gnimtiSeptember().members.unshift(emptyGnimtiMember()); renderGnimtiAdmin(); markDirty(); };
    });
    document.querySelectorAll("[data-gnimti-member-del]").forEach((el) => {
      el.onclick = () => { gnimtiSeptember().members.splice(Number(el.getAttribute("data-gnimti-member-del")), 1); renderGnimtiAdmin(); markDirty(); };
    });
    document.querySelectorAll("[data-gnimti-member-move]").forEach((el) => {
      el.onclick = () => {
        const members = gnimtiSeptember().members;
        const index = Number(el.getAttribute("data-mi"));
        const target = el.getAttribute("data-gnimti-member-move") === "up" ? index - 1 : index + 1;
        if (target < 0 || target >= members.length) return;
        [members[index], members[target]] = [members[target], members[index]];
        renderGnimtiAdmin();
        markDirty();
      };
    });
    document.querySelectorAll("[data-gnimti-add-roster]").forEach((el) => {
      el.onclick = () => { gnimtiSeptember().rosterImageUrls.push(""); renderGnimtiAdmin(); markDirty(); };
    });
    document.querySelectorAll("[data-gnimti-roster-del]").forEach((el) => {
      el.onclick = () => {
        const index = Number(el.getAttribute("data-gnimti-roster-del"));
        const list = gnimtiSeptember().rosterImageUrls;
        if (list.length <= 1 && !list[index]) return;
        list.splice(index, 1);
        if (!list.length) list.push("");
        renderGnimtiAdmin();
        markDirty();
      };
    });
  }
  function sortInfoForVisibility() {
    info.sort((a, b) => Number(!!a.hidden) - Number(!!b.hidden));
  }

  function isNoticeInfoItem(item) {
    return /^@notice\s*:/i.test(String((item && item.content) || "").trim());
  }

  function isExtensionVersionInfoItem(item) {
    return /^@extension-version\s*:/i.test(String((item && item.content) || "").trim());
  }
  function isInfoSectionInfoItem(item) {
    return /^@section\s*:/i.test(String((item && item.content) || "").trim());
  }

  function infoSectionText(item) {
    return String((item && item.content) || "").trim().replace(/^@section\s*:\s*/i, "");
  }

  function infoSectionContent(value) {
    return INFO_SECTION_PREFIX + String(value || "").trim();
  }


  function isStructuredInfoItem(item) {
    return String((item && item.content) || "").trim().startsWith(STRUCTURED_INFO_PREFIX);
  }

  function emptyInfoSubItem(body) {
    return { title: "", body: body || "", collapsed: true, hasBody: true };
  }

  function structuredInfoData(item) {
    const raw = String((item && item.content) || "").trim();
    if (!raw.startsWith(STRUCTURED_INFO_PREFIX)) return null;
    try {
      const parsed = JSON.parse(raw.slice(STRUCTURED_INFO_PREFIX.length));
      const items = Array.isArray(parsed.items) ? parsed.items.map((entry) => ({
        title: String((entry && entry.title) || ""),
        body: String((entry && entry.body) || ""),
        collapsed: entry && entry.collapsed !== false,
        hasBody: !entry || entry.hasBody !== false,
      })) : [];
      return { title: String((parsed && parsed.title) || ""), items };
    } catch (_e) {
      return { title: "", items: [emptyInfoSubItem(raw.slice(STRUCTURED_INFO_PREFIX.length))] };
    }
  }

  function structuredInfoContent(data) {
    const clean = {
      title: String((data && data.title) || ""),
      items: (data && Array.isArray(data.items) ? data.items : []).map((entry) => ({
        title: String((entry && entry.title) || ""),
        body: String((entry && entry.body) || ""),
        collapsed: entry && entry.collapsed !== false,
        hasBody: !entry || entry.hasBody !== false,
      })),
    };
    return STRUCTURED_INFO_PREFIX + JSON.stringify(clean);
  }

  function setStructuredInfoData(index, data) {
    info[index].content = structuredInfoContent(data);
  }

  function infoStructuredKeepContent(data) {
    if (!data) return false;
    return Array.isArray(data.items);
  }
  function noticeText(item) {
    return String((item && item.content) || "").trim().replace(/^@notice\s*:\s*/i, "");
  }

  function noticeContent(value) {
    return "@notice:" + String(value || "").trim();
  }

  function isUpdateInfoItem(item) {
    return /^@update\s*:/i.test(String((item && item.content) || "").trim());
  }

  function updateHistoryPayload(item) {
    return String((item && item.content) || "").trim().replace(/^@update\s*:\s*/i, "");
  }

  function parseUpdateHistoryData(item) {
    const payload = updateHistoryPayload(item);
    if (!payload) return { title: "", body: "" };
    try {
      const parsed = JSON.parse(payload);
      return {
        title: String((parsed && parsed.title) || ""),
        body: String((parsed && parsed.body) || ""),
      };
    } catch (_e) {}
    const legacy = parseEditorPopupToken(payload, 0);
    if (legacy && legacy.end === payload.length) return { title: legacy.label || "", body: legacy.body || "" };
    return { title: payload.split(/\r?\n/)[0] || "", body: payload };
  }

  function updateHistoryContent(data) {
    const clean = {
      title: String((data && data.title) || "").trim(),
      body: String((data && data.body) || "").trim(),
    };
    return UPDATE_HISTORY_PREFIX + JSON.stringify(clean);
  }

  function updateHistoryKeepContent(data) {
    return !!(data && (String(data.title || "").trim() || String(data.body || "").trim()));
  }

  function renderInfo() {
    sortInfoForVisibility();
    const list = $("infoList");
    if (!list) return;
    const visibleItems = info.map((u, i) => ({ u, i })).filter((item) => !isNoticeInfoItem(item.u) && !isUpdateInfoItem(item.u));
    list.innerHTML = visibleItems.length
      ? visibleItems.map((item) => infoItemHtml(item.u, item.i)).join("")
      : '<div class="empty" style="padding:16px 0;">\ub4f1\ub85d\ub41c \uc18c\uc2dd\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.</div>';

    const add = document.createElement("button");
    add.className = "add-btn info-add-card";
    add.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>\ud56d\ubaa9 \ucd94\uac00';
    add.onclick = addInfoRow;
    list.appendChild(add);

    bindInfoCards();
    bindDirectiveAutocompletes();
  }

  function noticeListHtml() {
    const notices = info.map((u, i) => ({ u, i })).filter((item) => isNoticeInfoItem(item.u));
    return notices.length ? notices.map((item) => {
      const text = noticeText(item.u);
      const fieldId = "notice-content-" + item.i;
      return '<div class="card notice-card" data-notice-card="' + item.i + '">' +
        '<div class="notice-field">' +
          '<div class="notice-editor-shell">' +
            '<div class="notice-card-head">' +
              '<div class="notice-card-toolbar"></div>' +
              '<div class="notice-card-actions">' + deleteNoticeBtn(item.i) + '</div>' +
            '</div>' +
            '<textarea id="' + fieldId + '" class="notice-textarea" data-notice-content="' + item.i + '" placeholder="\uacf5\uc9c0 \ub0b4\uc6a9\uc744 \uc785\ub825\ud558\uc138\uc694">' + esc(text) + '</textarea>' +
          '</div>' +
        '</div>' +
      "</div>";
    }).join("") : '<div class="empty" style="padding:16px 0;">\ub4f1\ub85d\ub41c \uacf5\uc9c0\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.</div>';
  }

  function renderNotice() {
    const list = $("noticeList");
    if (!list) return;
    list.innerHTML = '<div class="schedule-group-head"><p class="group-label">\uacf5\uc9c0</p><button type="button" class="add-btn schedule-add-btn" data-add-notice="1">+ \uacf5\uc9c0</button></div>' + noticeListHtml();
    bindNoticeCards();
    bindDirectiveAutocompletes();
  }

  function deleteNoticeBtn(i) {
    return '<button class="icon-btn" data-notice-del="' + i + '" aria-label="\uc0ad\uc81c">' + trashSvg() + "</button>";
  }

  function bindNoticeCards() {
    document.querySelectorAll("[data-add-notice]").forEach((el) => {
      el.onclick = () => {
        info.push({ id: null, content: noticeContent(""), hidden: true });
        renderNotice();
        markDirty();
      };
    });
    document.querySelectorAll("[data-notice-content]").forEach((el) => {
      const i = +el.getAttribute("data-notice-content");
      el.oninput = () => {
        info[i].content = noticeContent(el.value);
        info[i].hidden = true;
        markDirty();
      };
    });
    document.querySelectorAll("[data-notice-del]").forEach((el) => {
      el.onclick = () => {
        const i = +el.getAttribute("data-notice-del");
        if (info[i].id) deletedInfoIds.push(info[i].id);
        info.splice(i, 1);
        renderNotice();
        markDirty();
      };
    });
  }

  function updateHistoryListHtml() {
    const updates = info.map((u, i) => ({ u, i })).filter((item) => isUpdateInfoItem(item.u)).reverse();
    return updates.length ? updates.map((item) => {
      const data = parseUpdateHistoryData(item.u);
      const titleId = "update-title-" + item.i;
      const bodyId = "update-body-" + item.i;
      return '<div class="card notice-card update-card" data-update-card="' + item.i + '">' +
        '<div class="notice-field">' +
          '<div class="notice-editor-shell update-editor-shell">' +
            '<div class="notice-card-head">' +
              '<div class="notice-card-toolbar"></div>' +
              '<div class="notice-card-actions">' + deleteUpdateHistoryBtn(item.i) + '</div>' +
            '</div>' +
            '<div class="update-title-row"><label for="' + titleId + '">제목</label><input id="' + titleId + '" class="update-title-input" data-update-title="' + item.i + '" value="' + esc(data.title || "") + '" placeholder="프론트에 노출될 업데이트 제목" /></div>' +
            '<textarea id="' + bodyId + '" class="notice-textarea update-body-textarea" data-update-body="' + item.i + '" placeholder="클릭 팝업에 표시될 업데이트 내용을 입력하세요">' + esc(data.body || "") + '</textarea>' +
          '</div>' +
        '</div>' +
      "</div>";
    }).join("") : '<div class="empty" style="padding:16px 0;">등록된 업데이트 내역이 없습니다.</div>';
  }

  function renderUpdates() {
    const list = $("updateList");
    if (!list) return;
    list.innerHTML = '<div class="schedule-group-head"><p class="group-label">\uc5c5\ub370\uc774\ud2b8 \ub0b4\uc5ed</p><button type="button" class="add-btn schedule-add-btn" data-add-update="1">+ \uc5c5\ub370\uc774\ud2b8</button></div>' + updateHistoryListHtml();
    bindUpdateHistoryCards();
    bindDirectiveAutocompletes();
  }

  function deleteUpdateHistoryBtn(i) {
    return '<button class="icon-btn" data-update-del="' + i + '" aria-label="\uc0ad\uc81c">' + trashSvg() + "</button>";
  }

  function bindUpdateHistoryCards() {
    document.querySelectorAll("[data-add-update]").forEach((el) => {
      el.onclick = () => {
        info.push({ id: null, content: updateHistoryContent({ title: "", body: "" }), hidden: true });
        renderUpdates();
        markDirty();
      };
    });
    document.querySelectorAll("[data-update-title]").forEach((el) => {
      const i = +el.getAttribute("data-update-title");
      el.oninput = () => {
        const data = parseUpdateHistoryData(info[i]);
        data.title = el.value;
        info[i].content = updateHistoryContent(data);
        info[i].hidden = true;
        markDirty();
      };
    });
    document.querySelectorAll("[data-update-body]").forEach((el) => {
      const i = +el.getAttribute("data-update-body");
      el.oninput = () => {
        const data = parseUpdateHistoryData(info[i]);
        data.body = el.value;
        info[i].content = updateHistoryContent(data);
        info[i].hidden = true;
        markDirty();
      };
    });
    document.querySelectorAll("[data-update-del]").forEach((el) => {
      el.onclick = () => {
        const i = +el.getAttribute("data-update-del");
        if (info[i].id) deletedInfoIds.push(info[i].id);
        info.splice(i, 1);
        renderUpdates();
        markDirty();
      };
    });
  }

  function infoSectionItemHtml(u, i) {
    const title = infoSectionText(u);
    return (
      '<div class="card info-card info-section-card" data-ii="' + i + '">' +
        '<div class="info-section-card-line"></div>' +
        '<input class="info-section-input" data-isection="' + i + '" value="' + esc(title) + '" placeholder="\uad6c\ubd84 \uc81c\ubaa9 \uc608: \uce58\uc988\uc1fc" />' +
        '<div class="info-card-actions">' +
          '<button class="move-btn" data-imove="up" data-ii="' + i + '"' + (i === 0 ? " disabled" : "") + ' aria-label="\uc704\ub85c \uc774\ub3d9">\u25b2</button>' +
          '<button class="move-btn" data-imove="down" data-ii="' + i + '"' + (i === info.length - 1 ? " disabled" : "") + ' aria-label="\uc544\ub798\ub85c \uc774\ub3d9">\u25bc</button>' +
          deleteInfoBtn(i) +
        '</div>' +
      '</div>'
    );
  }


  function structuredInfoItemHtml(u, i) {
    const data = structuredInfoData(u) || { title: "", items: [] };
    const items = data.items.length ? data.items : [emptyInfoSubItem("")];
    const subItems = items.map((entry, si) => structuredInfoSubItemHtml(entry, i, si, items.length)).join("");
    return (
      '<div class="card info-card info-structured-card" data-ii="' + i + '">' +
        '<div class="info-structured-head">' +
          '<input class="info-structured-title" data-structured-title="' + i + '" value="' + esc(data.title) + '" placeholder="\ud070 \ubd84\ub958 \uc608: ENCHANT \ucee8\ud150\uce20" />' +
          '<div class="info-card-actions">' +
            '<button class="move-btn" data-imove="up" data-ii="' + i + '"' + (i === 0 ? " disabled" : "") + ' aria-label="\uc704\ub85c \uc774\ub3d9">\u25b2</button>' +
            '<button class="move-btn" data-imove="down" data-ii="' + i + '"' + (i === info.length - 1 ? " disabled" : "") + ' aria-label="\uc544\ub798\ub85c \uc774\ub3d9">\u25bc</button>' +
            '<button type="button" class="flag-toggle' + (u.hidden ? " on" : "") + '" data-ihiddentoggle="' + i + '" title="\ud655\uc7a5 \ud504\ub85c\uadf8\ub7a8\uc5d0\uc11c \uc774 \uc18c\uc2dd\uc744 \uc228\uae41\ub2c8\ub2e4">\uc228\uae40</button>' +
            deleteInfoBtn(i) +
          '</div>' +
        '</div>' +
        '<div class="info-sub-list">' + subItems + '</div>' +
        '<button type="button" class="add-btn small info-sub-add" data-isub-add="' + i + '">+ \uc138\ubd80 \uc18c\uc2dd \ucd94\uac00</button>' +
      '</div>'
    );
  }

  function structuredInfoSubItemHtml(entry, i, si, total) {
    const fieldId = "info-sub-body-" + i + "-" + si;
    const titleId = "info-sub-title-" + i + "-" + si;
    const hasBody = !entry || entry.hasBody !== false;
    const bodyEditor = hasBody ? (
        '<div class="info-sub-editor-shell">' +
          '<div class="info-sub-toolbar"></div>' +
          '<textarea id="' + fieldId + '" class="info-sub-body" data-isub-body="' + i + '-' + si + '" placeholder="\uc138\ubd80 \uc18c\uc2dd \ubcf8\ubb38\uc744 \uc785\ub825\ud558\uc138\uc694. \ubbf8\ub514\uc5b4 \ubc84\ud2bc\uc73c\ub85c \uc774\ubbf8\uc9c0/\ub9c1\ud06c\ub97c \ucd94\uac00\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4." data-ii="' + i + '" data-si="' + si + '">' + esc(entry.body || "") + '</textarea>' +
        '</div>'
      ) : "";
    return (
      '<div class="info-sub-card' + (hasBody ? "" : " no-body") + '" data-info-sub="' + i + '-' + si + '">' +
        '<div class="info-sub-head">' +
          '<div class="info-sub-title-shell">' +
            '<div class="info-sub-title-toolbar"></div>' +
            '<input id="' + titleId + '" class="info-sub-title" data-isub-title="' + i + '-' + si + '" value="' + esc(entry.title || "") + '" placeholder="\uc138\ubd80 \uc18c\uc2dd \uc81c\ubaa9 \uc608: \uc2a4\ud0c0\ud06c\ub798\ud504\ud2b8" />' +
          '</div>' +
          '<div class="info-card-actions">' +
            '<button class="move-btn" data-isub-move="up" data-ii="' + i + '" data-si="' + si + '"' + (si === 0 ? " disabled" : "") + ' aria-label="\uc138\ubd80 \uc18c\uc2dd \uc704\ub85c \uc774\ub3d9">\u25b2</button>' +
            '<button class="move-btn" data-isub-move="down" data-ii="' + i + '" data-si="' + si + '"' + (si === total - 1 ? " disabled" : "") + ' aria-label="\uc138\ubd80 \uc18c\uc2dd \uc544\ub798\ub85c \uc774\ub3d9">\u25bc</button>' +
            '<button type="button" class="flag-toggle' + (hasBody ? " on" : "") + '" data-isub-has-body="' + i + '-' + si + '" title="\uc138\ubd80 \uc18c\uc2dd \ub0b4\uc6a9 \uc785\ub825 \ubc0f \ud504\ub860\ud2b8 \uc811\uae30/\ud3bc\uce58\uae30 \uc0ac\uc6a9 \uc5ec\ubd80">\ub0b4\uc6a9\uc788\uc74c</button>' +
            (hasBody ? '<button type="button" class="flag-toggle' + (entry.collapsed !== false ? " on" : "") + '" data-isub-collapse="' + i + '-' + si + '" title="\ud504\ub860\ud2b8\uc5d0\uc11c \uae30\ubcf8 \uc811\ud798 \uc0c1\ud0dc\ub85c \ud45c\uc2dc">\uae30\ubcf8\uc811\ud798</button>' : "") +
            '<button type="button" class="icon-btn" data-isub-del="' + i + '-' + si + '" aria-label="\uc138\ubd80 \uc18c\uc2dd \uc0ad\uc81c">' + trashSvg() + '</button>' +
          '</div>' +
        '</div>' +
        bodyEditor +
      '</div>'
    );
  }
  function infoItemHtml(u, i) {
    if (isInfoSectionInfoItem(u)) return infoSectionItemHtml(u, i);
    if (isStructuredInfoItem(u)) return structuredInfoItemHtml(u, i);
    const text = u.content || "";
    const fieldId = "info-content-" + i;
    return (
      '<div class="card info-card" data-ii="' + i + '">' +
        '<div class="info-field">' +
          '<div class="info-editor-shell">' +
            '<div class="info-card-head">' +
              '<div class="info-card-toolbar"></div>' +
              '<div class="info-card-actions">' +
                '<button class="move-btn" data-imove="up" data-ii="' + i + '"' + (i === 0 ? " disabled" : "") + ' aria-label="\uc704\ub85c \uc774\ub3d9">\u25b2</button>' +
                '<button class="move-btn" data-imove="down" data-ii="' + i + '"' + (i === info.length - 1 ? " disabled" : "") + ' aria-label="\uc544\ub798\ub85c \uc774\ub3d9">\u25bc</button>' +
                '<button type="button" class="flag-toggle" data-istructure="' + i + '" title="\uc774 \uc18c\uc2dd\uc744 \uc138\ubd80 \uc18c\uc2dd \ud3b8\uc9d1\uc73c\ub85c \uc804\ud658\ud569\ub2c8\ub2e4">\uc138\ubd80\uc18c\uc2dd</button>' +
                '<button type="button" class="flag-toggle' + (u.hidden ? " on" : "") + '" data-ihiddentoggle="' + i + '" title="\ud655\uc7a5 \ud504\ub85c\uadf8\ub7a8\uc5d0\uc11c \uc774 \uc18c\uc2dd\uc744 \uc228\uae41\ub2c8\ub2e4">\uc228\uae40</button>' +
                deleteInfoBtn(i) +
              '</div>' +
            '</div>' +
            '<textarea id="' + fieldId + '" class="info-textarea" data-if="content" data-ii="' + i + '" placeholder="\uc18c\uc2dd \ub0b4\uc6a9\uc744 \uc785\ub825\ud558\uc138\uc694">' + esc(text) + '</textarea>' +
          '</div>' +
          '<div class="directive-preview" data-info-preview="' + i + '" style="margin:6px 0 0">' + directivePreviewHtml(text, null) + '</div>' +
        '</div>' +
      "</div>"
    );
  }

  function deleteInfoBtn(i) {
    return '<button class="icon-btn" data-idel="' + i + '" aria-label="삭제">' + trashSvg() + "</button>";
  }
  function trashSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
  }

  function bindInfoCards() {
    document.querySelectorAll("[data-if]").forEach((el) => {
      const i = +el.getAttribute("data-ii");
      el.oninput = () => {
        info[i].content = el.value;
        const preview = document.querySelector('[data-info-preview="' + i + '"]');
        if (preview) preview.innerHTML = directivePreviewHtml(el.value, null);
        markDirty();
      };
    });
    document.querySelectorAll("[data-isection]").forEach((el) => {
      const i = +el.getAttribute("data-isection");
      el.oninput = () => {
        info[i].content = infoSectionContent(el.value);
        markDirty();
      };
    });
    document.querySelectorAll("[data-structured-title]").forEach((el) => {
      const i = +el.getAttribute("data-structured-title");
      el.oninput = () => {
        const data = structuredInfoData(info[i]) || { title: "", items: [] };
        data.title = el.value;
        setStructuredInfoData(i, data);
        markDirty();
      };
    });
    document.querySelectorAll("[data-isub-title]").forEach((el) => {
      const [i, si] = el.getAttribute("data-isub-title").split("-").map(Number);
      el.oninput = () => {
        const data = structuredInfoData(info[i]) || { title: "", items: [] };
        data.items[si] = data.items[si] || emptyInfoSubItem("");
        data.items[si].title = el.value;
        setStructuredInfoData(i, data);
        markDirty();
      };
    });
    document.querySelectorAll("[data-isub-body]").forEach((el) => {
      const [i, si] = el.getAttribute("data-isub-body").split("-").map(Number);
      el.oninput = () => {
        const data = structuredInfoData(info[i]) || { title: "", items: [] };
        data.items[si] = data.items[si] || emptyInfoSubItem("");
        data.items[si].body = el.value;
        setStructuredInfoData(i, data);
        markDirty();
      };
    });
    document.querySelectorAll("[data-isub-collapse]").forEach((el) => {
      el.onclick = () => {
        const [i, si] = el.getAttribute("data-isub-collapse").split("-").map(Number);
        const data = structuredInfoData(info[i]) || { title: "", items: [] };
        data.items[si] = data.items[si] || emptyInfoSubItem("");
        data.items[si].collapsed = data.items[si].collapsed === false;
        setStructuredInfoData(i, data);
        renderInfo();
        markDirty();
      };
    });
    document.querySelectorAll("[data-isub-has-body]").forEach((el) => {
      el.onclick = () => {
        const [i, si] = el.getAttribute("data-isub-has-body").split("-").map(Number);
        const data = structuredInfoData(info[i]) || { title: "", items: [] };
        data.items[si] = data.items[si] || emptyInfoSubItem("");
        data.items[si].hasBody = data.items[si].hasBody === false;
        setStructuredInfoData(i, data);
        renderInfo();
        markDirty();
      };
    });
    document.querySelectorAll("[data-isub-move]").forEach((el) => {
      el.onclick = () => {
        const i = +el.getAttribute("data-ii");
        const si = +el.getAttribute("data-si");
        const dir = el.getAttribute("data-isub-move");
        const data = structuredInfoData(info[i]) || { title: "", items: [] };
        const target = dir === "up" ? si - 1 : si + 1;
        if (target < 0 || target >= data.items.length) return;
        [data.items[si], data.items[target]] = [data.items[target], data.items[si]];
        setStructuredInfoData(i, data);
        renderInfo();
        markDirty();
      };
    });
    document.querySelectorAll("[data-isub-del]").forEach((el) => {
      el.onclick = () => {
        const [i, si] = el.getAttribute("data-isub-del").split("-").map(Number);
        const data = structuredInfoData(info[i]) || { title: "", items: [] };
        data.items.splice(si, 1);
        if (!data.items.length) data.items.push(emptyInfoSubItem(""));
        setStructuredInfoData(i, data);
        renderInfo();
        markDirty();
      };
    });
    document.querySelectorAll("[data-isub-add]").forEach((el) => {
      el.onclick = () => {
        const i = +el.getAttribute("data-isub-add");
        const data = structuredInfoData(info[i]) || { title: "", items: [] };
        data.items.push(emptyInfoSubItem(""));
        setStructuredInfoData(i, data);
        renderInfo();
        markDirty();
      };
    });
    document.querySelectorAll("[data-istructure]").forEach((el) => {
      el.onclick = () => {
        const i = +el.getAttribute("data-istructure");
        const current = String((info[i] && info[i].content) || "");
        info[i].content = structuredInfoContent({ title: "", items: [emptyInfoSubItem(current)] });
        renderInfo();
        markDirty();
      };
    });
    document.querySelectorAll("[data-imove]").forEach((el) => {
      el.onclick = () => {
        const i = +el.getAttribute("data-ii");
        const dir = el.getAttribute("data-imove");
        const j = dir === "up" ? i - 1 : i + 1;
        if (j < 0 || j >= info.length) return;
        [info[i], info[j]] = [info[j], info[i]];
        renderInfo();
        markDirty();
      };
    });
    document.querySelectorAll("[data-ihiddentoggle]").forEach((el) => {
      el.onclick = () => {
        const i = +el.getAttribute("data-ihiddentoggle");
        info[i].hidden = !info[i].hidden;
        renderInfo();
        markDirty();
      };
    });
    document.querySelectorAll("[data-idel]").forEach((el) => {
      el.onclick = () => {
        const i = +el.getAttribute("data-idel");
        if (info[i].id) deletedInfoIds.push(info[i].id);
        info.splice(i, 1);
        renderInfo();
        markDirty();
      };
    });
  }

  function addInfoRow() {
    info.push({ id: null, content: structuredInfoContent({ title: "", items: [emptyInfoSubItem("")] }), hidden: false });
    renderInfo();
    markDirty();
  }

  function addInfoSectionAfter(index) {
    const insertIndex = Math.max(0, Math.min(info.length, Number(index) + 1));
    info.splice(insertIndex, 0, { id: null, content: infoSectionContent(""), hidden: false });
    renderInfo();
    markDirty();
  }

  function cardHtml(r, i) {
    const off = r.status === "off";
    const cafeTime = !!r.cafe_time;
    const videoTime = !!r.video_time;
    if (off) {
      return (
        '<div class="card off" data-i="' + i + '">' +
          '<div class="card-head">' +
            '<input class="card-date" type="date" data-f="date" data-i="' + i + '" value="' + esc(r.date) + '" />' +
            '<span class="grow"></span>' +
            '<button type="button" class="flag-toggle cafe-time-toggle' + (cafeTime ? " on" : "") + '" data-cafetoggle="' + i + '">카페타임</button>' +
            '<button type="button" class="flag-toggle video-time-toggle' + (videoTime ? " on" : "") + '" data-videotoggle="' + i + '">영도타임</button>' +
            '<span class="toggle-label">휴방</span>' +
            '<div class="toggle on" data-toggle="' + i + '"><div class="knob"></div></div>' +
            deleteBtn(i) +
          "</div>" +
          notesListHtml(r, i, true) +
        "</div>"
      );
    }
    return (
      '<div class="card" data-i="' + i + '">' +
        '<div class="card-head">' +
          '<input class="card-date" type="date" data-f="date" data-i="' + i + '" value="' + esc(r.date) + '" />' +
          '<span class="grow"></span>' +
          '<button type="button" class="flag-toggle cafe-time-toggle' + (cafeTime ? " on" : "") + '" data-cafetoggle="' + i + '">카페타임</button>' +
          '<button type="button" class="flag-toggle video-time-toggle' + (videoTime ? " on" : "") + '" data-videotoggle="' + i + '">영도타임</button>' +
          '<span class="toggle-label">휴방</span>' +
          '<div class="toggle" data-toggle="' + i + '"><div class="knob"></div></div>' +
          deleteBtn(i) +
        "</div>" +
        '<div class="row">' +
          '<input class="time" type="text" data-f="start_time" data-i="' + i + '" value="' + esc(r.start_time) + '" placeholder="시간" />' +
        "</div>" +
        partsListHtml(r, i) +
        gameImagesListHtml(r, i) +
        vodsListHtml(r, i) +
        notesListHtml(r, i, false) +
        '<p class="hint">시간을 비우면 "시간 미정"으로 표시됩니다</p>' +
      "</div>"
    );
  }

  function notesListHtml(r, i, isOff) {
    const notes = r.notes || [];
    const items = notes.map((note, ni) =>
      '<div class="note-item">' +
        '<div class="note-editor-wrap">' +
          '<textarea data-note="' + i + '-' + ni + '" placeholder="' + (isOff ? "휴방 사유" : "메모") + '">' + esc(note.content || "") + '</textarea>' +
          '<div class="directive-preview" data-note-preview="' + i + '-' + ni + '" style="margin:4px 0 0">' + directivePreviewHtml(note.content || "", null) + '</div>' +
        '</div>' +
        '<button type="button" class="flag-toggle' + (note.hidden ? " on" : "") + '" data-note-hidden="' + i + '-' + ni + '" title="확장 프로그램에서 이 메모를 숨깁니다">숨김</button>' +
        '<button type="button" class="icon-btn" data-del-note="' + i + '-' + ni + '" aria-label="메모 삭제">' + trashSvg() + '</button>' +
      '</div>'
    ).join("");
    return '<div class="notes-wrap schedule-editor-section"><div class="schedule-editor-section-head">' + (isOff ? "휴방 메모" : "메모") + '</div>' + items +
      '<button type="button" class="add-btn small" data-add-note="' + i + '">+ 메모 추가</button></div>';
  }
  function partsListHtml(r, i) {
    const parts = r.parts || [];
    const itemsHtml = parts.map((p, pi) => partItemHtml(i, p, pi, parts.length)).join("");
    return (
      '<div class="parts-wrap schedule-editor-section"><div class="schedule-editor-section-head">컨텐츠</div>' + itemsHtml +
        '<button class="add-btn small" data-addpart="' + i + '">+ 부 추가</button>' +
      "</div>"
    );
  }



  function gameImagesListHtml(r, i) {
    const images = r.gameImages || [];
    const itemsHtml = images.map((g, gi) => gameImageItemHtml(i, g, gi)).join("");
    return (
      '<div class="game-images-wrap schedule-editor-section"><div class="schedule-editor-section-head">게임</div>' + itemsHtml +
        '<button class="add-btn small" data-addgameimg="' + i + '">+ \uAC8C\uC784 \uCD94\uAC00</button>' +
      "</div>"
    );
  }

  function gameImageItemHtml(i, g, gi) {
    return (
      '<div class="game-image-item">' +
        '<div class="game-image-head">' +
          '<div class="game-autocomplete-wrap"><input type="text" data-gif="label" data-i="' + i + '" data-gi="' + gi + '" value="' + esc(g.label || "") + '" placeholder="\uAC8C\uC784\uBA85 (\uC608: \uBC1C\uB85C\uB780\uD2B8)" autocomplete="off" /><div class="member-results game-results" data-game-results="' + i + '-' + gi + '"></div></div>' +
          '<button class="icon-btn" data-delgameimg="' + i + "-" + gi + '" aria-label="\uAC8C\uC784 \uC0AD\uC81C">' + trashSvg() + "</button>" +
        '</div>' +
        '<div class="game-meta-hint">\uCE58\uC9C0\uC9C1 \uCE74\uD14C\uACE0\uB9AC \uAC80\uC0C9 \uACB0\uACFC\uB97C \uC120\uD0DD\uD558\uAC70\uB098 \uC9C1\uC811 \uC785\uB825\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4. \uD504\uB860\uD2B8 \uAC8C\uC784\uB9CC\uBCF4\uAE30\uB294 \uAC8C\uC784\uBA85\uC73C\uB85C \uC9D1\uACC4\uB429\uB2C8\uB2E4.</div>' +
      '</div>'
    );
  }
  function knownGameLabels(excludeInput) {
    const seen = new Set();
    const labels = [];
    rows.forEach((row) => {
      (row.gameImages || []).forEach((game) => {
        const label = String(game && game.label || "").trim();
        if (!label) return;
        const key = label.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        labels.push(label);
      });
    });
    if (excludeInput && excludeInput.value) {
      const exact = excludeInput.value.trim().toLowerCase();
      return labels.filter((label) => label.toLowerCase() !== exact);
    }
    return labels;
  }

  function normalizeGameCategory(item) {
    if (!item || typeof item !== "object") return null;
    const label = String(item.categoryValue || item.label || item.title || item.name || "").trim();
    if (!label) return null;
    return {
      label,
      categoryId: String(item.categoryId || "").trim(),
      categoryType: String(item.categoryType || "").trim(),
      posterImageUrl: String(item.posterImageUrl || item.imageUrl || "").trim(),
    };
  }

  async function searchChzzkCategories(keyword) {
    const key = String(keyword || "").trim();
    if (!key) return { ok: true, error: null, list: [] };
    const cacheKey = key.toLowerCase();
    if (gameCategoryCache.has(cacheKey)) return { ok: true, error: null, list: gameCategoryCache.get(cacheKey) };
    const isLocalAdmin = location.protocol === "http:" && /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
    const url = (isLocalAdmin ? "" : cfg.supabaseUrl.replace(/\/+$/, "")) +
      "/functions/v1/chzzk-category-search?keyword=" + encodeURIComponent(key) + "&size=8";
    try {
      const res = await fetch(url, {
        headers: { apikey: cfg.supabaseKey, Authorization: "Bearer " + cfg.supabaseKey },
      });
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        console.warn("[admin] 치지직 카테고리 검색 HTTP 오류:", res.status, bodyText.slice(0, 200));
        return { ok: false, error: "HTTP " + res.status, list: [] };
      }
      const json = await res.json();
      const rawItems = (json && json.content && Array.isArray(json.content.data) ? json.content.data : (Array.isArray(json.data) ? json.data : []));
      const list = rawItems.map(normalizeGameCategory).filter(Boolean).slice(0, 8);
      gameCategoryCache.set(cacheKey, list);
      return { ok: true, error: null, list };
    } catch (e) {
      console.warn("[admin] 치지직 카테고리 검색 실패:", e);
      return { ok: false, error: String((e && e.message) || e), list: [] };
    }
  }

  function bindGameAutocomplete(input) {
    if (input.dataset.gameAutocompleteBound) return;
    input.dataset.gameAutocompleteBound = "1";
    const results = document.querySelector('[data-game-results="' + input.getAttribute("data-i") + '-' + input.getAttribute("data-gi") + '"]');
    if (!results) return;
    let timer = null;
    let requestSeq = 0;
    let latestOptions = [];
    const close = () => { results.innerHTML = ""; };
    const currentGame = () => {
      const i = +input.getAttribute("data-i");
      const gi = +input.getAttribute("data-gi");
      rows[i].gameImages = rows[i].gameImages || [];
      rows[i].gameImages[gi] = rows[i].gameImages[gi] || { url: "", label: "" };
      return rows[i].gameImages[gi];
    };
    const apply = (item) => {
      const category = typeof item === "string" ? { label: item } : item;
      input.dataset.applyingGameCategory = "1";
      input.value = category.label || "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      delete input.dataset.applyingGameCategory;
      const game = currentGame();
      game.label = category.label || "";
      game.categoryId = category.categoryId || "";
      game.categoryType = category.categoryType || "";
      game.posterImageUrl = category.posterImageUrl || "";
      close();
      markDirty();
      input.blur();
    };
    const mergeOptions = (localLabels, apiItems) => {
      const seen = new Set();
      const options = [];
      localLabels.forEach((label) => {
        const key = label.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        options.push({ source: "local", label });
      });
      apiItems.forEach((item) => {
        const key = item.label.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        options.push({ source: "chzzk", ...item });
      });
      return options.slice(0, 10);
    };
    const renderOptions = (options, statusText) => {
      latestOptions = options;
      if (!options.length && !statusText) { close(); return; }
      const optionHtml = options.map((item, index) => {
        const image = item.posterImageUrl ? '<img class="game-result-poster" src="' + esc(item.posterImageUrl) + '" alt="" />' : '<span class="game-result-poster game-result-poster-empty">' + esc((item.label || "?").charAt(0) || "?") + '</span>';
        const badge = item.source === "chzzk" ? '<span class="game-result-badge">' + esc(item.categoryType || "CHZZK") + '</span>' : '<span class="game-result-badge local">기존</span>';
        return '<button type="button" class="member-result game-result" data-game-pick="' + index + '">' + image + '<span class="game-result-main"><span class="game-result-label">' + esc(item.label) + '</span>' + badge + '</span></button>';
      }).join("");
      results.innerHTML = optionHtml + (statusText ? '<div class="member-result-empty">' + esc(statusText) + '</div>' : "");
      results.querySelectorAll("[data-game-pick]").forEach((button) => {
        bindInstantMemberResult(button, () => apply(latestOptions[+button.getAttribute("data-game-pick")]));
      });
    };
    const localMatches = () => {
      const query = input.value.trim().toLowerCase();
      return knownGameLabels(input)
        .filter((label) => !query || label.toLowerCase().includes(query))
        .slice(0, 5);
    };
    const render = () => {
      clearTimeout(timer);
      if (input.dataset.searchDropdownSuppressed === "1") { close(); return; }
      const keyword = input.value.trim();
      renderOptions(mergeOptions(localMatches(), []), keyword ? "치지직 카테고리 검색 중..." : "");
      if (!keyword) return;
      const seq = ++requestSeq;
      timer = setTimeout(async () => {
        const result = await searchChzzkCategories(keyword);
        if (seq !== requestSeq) return;
        const options = mergeOptions(localMatches(), result.list);
        renderOptions(options, result.ok ? "" : "카테고리 검색 실패: " + result.error);
      }, 220);
    };
    input.addEventListener("input", render);
    input.addEventListener("focus", () => { delete input.dataset.searchDropdownSuppressed; render(); });
    input.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
    input.addEventListener("blur", () => setTimeout(close, 160));
  }
  function vodsListHtml(r, i) {
    const vods = r.vods || [];
    const itemsHtml = vods.map((v, vi) => vodItemHtml(i, v, vi)).join("");
    return (
      '<div class="vods-wrap schedule-editor-section"><div class="schedule-editor-section-head">다시보기</div>' +        itemsHtml +
        '<button class="add-btn small" data-addvod="' + i + '">+ 다시보기 추가</button>' +
      "</div>"
    );
  }

  function vodItemHtml(i, v, vi) {
    return (
      '<div class="vod-item">' +
        '<div class="vod-head">' +
          '<div style="flex:1;min-width:0"><input type="text" data-vf="label" data-i="' + i + '" data-vi="' + vi + '" value="' + esc(v.label) + '" placeholder="제목" />' +
          '<div class="directive-preview" data-vod-preview="' + i + '-' + vi + '" style="margin:4px 0 0">' + directivePreviewHtml(v.label, null) + '</div></div>' +
          deleteVodBtn(i, vi) +
        '</div>' +
        '<div class="vod-fields">' +
          '<input type="text" data-vf="url" data-i="' + i + '" data-vi="' + vi + '" value="' + esc(v.url) + '" placeholder="URL" />' +
        '</div>' +
      '</div>'
    );
  }  function deleteVodBtn(i, vi) {
    return '<button class="icon-btn" data-delvod="' + i + "-" + vi + '" aria-label="다시보기 삭제">' + trashSvg() + "</button>";
  }

  function partNotesListHtml(i, pi, p) {
    const notes = p.notes || [];
    const items = notes.map((note, ni) =>
      '<div class="note-item part-note-item">' +
        '<div class="note-editor-wrap">' +
          '<textarea data-part-note="' + i + '-' + pi + '-' + ni + '" placeholder="이 부에 대한 메모">' + esc(note.content || "") + '</textarea>' +
          '<div class="directive-preview" data-part-note-preview="' + i + '-' + pi + '-' + ni + '" style="margin:4px 0 0">' + directivePreviewHtml(note.content || "", null) + '</div>' +
        '</div>' +
        '<button type="button" class="flag-toggle' + (note.hidden ? " on" : "") + '" data-part-note-hidden="' + i + '-' + pi + '-' + ni + '" title="확장 프로그램에서 이 부 메모를 숨깁니다">숨김</button>' +
        '<button type="button" class="icon-btn" data-del-part-note="' + i + '-' + pi + '-' + ni + '" aria-label="부 메모 삭제">' + trashSvg() + '</button>' +
      '</div>'
    ).join("");
    return '<div class="part-notes-wrap"><div class="schedule-editor-section-head">부 메모</div>' + items +
      '<button type="button" class="add-btn small" data-add-part-note="' + i + '-' + pi + '">+ 부 메모 추가</button></div>';
  }
  function partItemHtml(i, p, pi, partCount) {
    const collabOn = !!p.collab;
    const officialOn = !!p.official;
    const otherOn = !!p.otherChannel;
    const adOn = !!p.ad;
    const outdoorOn = !!p.outdoor;
    const speculativeOn = !!p.speculative;
    const hidePartLabelOn = !!p.hidePartLabel;
    const inputValue = p.displayType === "profile" ? ":s " + p.content : p.displayType === "tag" ? ":t " + p.content : p.content;
    let html =
      '<div class="part-item">' +
        '<div class="part-title-row">' +
          '<input type="text" data-pf="content" data-i="' + i + '" data-pi="' + pi + '" value="' + esc(inputValue) + '" placeholder="컨텐츠명" />' +
          '<input class="part-label-input" type="text" data-pf="label" data-i="' + i + '" data-pi="' + pi + '" value="' + esc(p.label || (pi + 1) + "부") + '" placeholder="부" aria-label="부 표시 이름"' + (speculativeOn ? " disabled" : "") + ' />' +
        '</div>' +
        '<div class="directive-preview" data-directive-preview="' + i + '-' + pi + '">' + directivePreviewHtml(inputValue, p.profile) + '</div>' +
        '<div class="part-tools-row">' +
          '<div class="part-tool-actions">' + partMoveButtons(i, pi, partCount) + deletePartBtn(i, pi) + '</div>' +
        '</div>' +
        '<div class="flag-toggles part-option-toggles">' +
          '<button class="flag-toggle' + (collabOn ? " on" : "") + '" data-collabtoggle="' + i + '-' + pi + '">합방</button>' +
          '<button class="flag-toggle' + (officialOn ? " on" : "") + '" data-officialtoggle="' + i + '-' + pi + '">공방</button>' +
          '<button class="flag-toggle' + (otherOn ? " on" : "") + '" data-othertoggle="' + i + '-' + pi + '">타방송</button>' +
          '<button class="flag-toggle' + (adOn ? " on" : "") + '" data-adtoggle="' + i + '-' + pi + '">광고</button>' +
          '<button class="flag-toggle' + (outdoorOn ? " on" : "") + '" data-outdoortoggle="' + i + '-' + pi + '">야외</button>' +
          '<button class="flag-toggle speculative' + (speculativeOn ? " on" : "") + '" data-speculativetoggle="' + i + '-' + pi + '">예상</button>' +
          '<button class="flag-toggle' + (hidePartLabelOn ? " on" : "") + '" data-hidepartlabeltoggle="' + i + '-' + pi + '">부 숨김</button>' +
        '</div>';
    if (collabOn) {
      html +=
        '<div class="collab-box">' +
          '<div class="host-label">멤버</div>' +
          '<div class="member-chips" id="chips-' + i + '-' + pi + '">' + memberChipsHtml(i, pi, p.members) + '</div>' +
          '<div class="member-search-wrap">' +
            '<input type="text" class="member-search" data-msearch="' + i + '-' + pi + '" placeholder="멤버 검색 (치지직 스트리머 이름)" autocomplete="off" />' +
            '<div class="member-results" id="results-' + i + '-' + pi + '"></div>' +
          '</div>' +
        '</div>';
    }
    html += partNotesListHtml(i, pi, p);
    if (officialOn || otherOn) {
      const hostLabel = otherOn ? "송출" : "진행";
      const hostPlaceholder = otherOn ? "송출 채널 검색 (치지직 스트리머 이름)" : "진행 채널 검색 (치지직 스트리머 이름)";
      html += '<div class="collab-box">' + hostChannelBoxHtml(i, pi, p.hostChannel, hostLabel, hostPlaceholder) + '</div>';
    }
    html += '</div>';
    return html;
  }

  function directivePreviewHtml(raw, savedProfile) {
    const value = (raw || "").trim();
    const whole = value.match(/^:(s|t)(?:\[([^\]]+)\]|\s+(.+))$/i);
    const hasFeedback = !whole && value.includes("[문의]");
    const mediaMatches = Array.from(value.matchAll(/:m\[([^{}\]]+)\{([^}\]]+)\}\]/gi));
    const popupMatches = Array.from(value.matchAll(/:p\[([^{}]+)\{([\s\S]*?)\}\]/gi));
    const installMatches = Array.from(value.matchAll(/:install\[([^\]]+)\]/gi));
    if (!/:(s|t)\b/i.test(value) && !mediaMatches.length && !popupMatches.length && !installMatches.length && !hasFeedback) return "";
    const matches = whole
      ? [{ 1: whole[1], 2: whole[2] || whole[3] }]
      : Array.from(value.matchAll(/:(s|t)(?:\[([^\]]+)\]|\s+([^\s:]+))/gi), (m) => ({ 1: m[1], 2: m[2] || m[3] }));
    if (!matches.length && !mediaMatches.length && !popupMatches.length && !installMatches.length && !hasFeedback) return '<span class="directive-help">명령어를 완성하세요. 예: :s 닉네임 · :m[텍스트{URL}]</span>';
    const previews = matches.map((match) => '<span class="directive-applied">' + esc(match[2].trim()) + '</span>');
    mediaMatches.forEach((match) => previews.push('<span class="directive-applied">' + esc(match[1].trim()) + '</span>'));
    popupMatches.forEach((match) => previews.push('<span class="directive-applied">' + esc(match[1].trim()) + '</span>'));
    installMatches.forEach((match) => previews.push('<span class="directive-applied">' + esc(match[1].trim()) + '</span>'));
    if (hasFeedback) previews.push('<span class="directive-feedback">문의·제보</span>');
    return previews.join('<span style="width:6px"></span>') + '<span class="directive-ok">적용 미리보기</span>';
  }

  function hostChannelBoxHtml(i, pi, hostChannel, label, placeholder) {
    const hostLabel = label || "진행";
    const hostPlaceholder = placeholder || "채널 검색 (치지직 스트리머 이름)";
    let inner = '<div class="host-label">' + esc(hostLabel) + '</div>';
    if (hostChannel) {
      inner +=
        '<span class="member-chip">' +
          memberAvatarImgHtml(hostChannel) +
          '<span class="member-chip-name">' + esc(hostChannel.channelName) + "</span>" +
          '<button class="member-chip-del" data-hostdel="' + i + "-" + pi + '" aria-label="삭제">×</button>' +
        "</span>";
    } else {
      inner +=
        '<div class="member-search-wrap">' +
          '<input type="text" class="member-search" data-hsearch="' + i + "-" + pi + '" placeholder="' + esc(hostPlaceholder) + '" autocomplete="off" />' +
          '<div class="member-results" id="hresults-' + i + "-" + pi + '"></div>' +
        "</div>";
    }
    return inner;
  }

  function memberChipsHtml(i, pi, members) {
    if (!members || !members.length) return '<span class="chips-empty">아직 없음</span>';
    return members
      .map(
        (m) =>
          '<span class="member-chip">' +
            memberAvatarImgHtml(m) +
            '<span class="member-chip-name">' + esc(m.channelName) + "</span>" +
            '<button class="member-chip-del" data-mdel="' + i + "-" + pi + "-" + esc(m.channelId) + '" aria-label="삭제">×</button>' +
          "</span>"
      )
      .join("");
  }

  // 프로필 사진이 없는 멤버(스트리머가 아닌 사람)는 이니셜 원형으로 대체 표시
  function memberAvatarImgHtml(m) {
    if (m.channelImageUrl) return '<img src="' + esc(m.channelImageUrl) + '" alt="" />';
    const initial = (m.channelName || "?").trim().charAt(0) || "?";
    return '<span class="member-avatar-fallback">' + esc(initial) + "</span>";
  }

  function partMoveButtons(i, pi, partCount) {
    return '<div class="move-col" aria-label="부 순서 이동">' +
      '<button type="button" class="move-btn" data-movepart="' + i + '-' + pi + '-up" aria-label="부 위로 이동"' + (pi <= 0 ? " disabled" : "") + '>▲</button>' +
      '<button type="button" class="move-btn" data-movepart="' + i + '-' + pi + '-down" aria-label="부 아래로 이동"' + (pi >= partCount - 1 ? " disabled" : "") + '>▼</button>' +
      '</div>';
  }

  function deletePartBtn(i, pi) {
    return '<button class="icon-btn" data-delpart="' + i + "-" + pi + '" aria-label="부 삭제">' + trashSvg() + "</button>";
  }

  // ---- 합방 멤버 검색 (치지직 검색 API는 브라우저에서 직접 부르면 CORS로 막혀서,
  //      Supabase Edge Function(chzzk-search)을 프록시로 거친다) ----
  async function searchChzzkChannels(keyword) {
    const isLocalAdmin = location.protocol === "http:" && /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
    const url = (isLocalAdmin ? "" : cfg.supabaseUrl.replace(/\/+$/, "")) +
      "/functions/v1/chzzk-search?keyword=" + encodeURIComponent(keyword);
    try {
      const res = await fetch(url, {
        headers: { apikey: cfg.supabaseKey, Authorization: "Bearer " + cfg.supabaseKey },
      });
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        console.warn("[admin] 치지직 채널 검색 HTTP 오류:", res.status, bodyText.slice(0, 200));
        return { ok: false, error: "HTTP " + res.status, list: [] };
      }
      const json = await res.json();
      const items = (json && json.content && json.content.data) || [];
      const list = items
        .map((it) => it && it.channel)
        .filter(Boolean)
        .map((c) => ({
          channelId: c.channelId || "",
          channelName: c.channelName || "",
          channelImageUrl: c.channelImageUrl || "",
        }));
      return { ok: true, error: null, list };
    } catch (e) {
      // fetch가 여기로 떨어지면 대부분 CORS 차단 또는 네트워크 오류 (브라우저가 구체적 사유를 감춤)
      console.warn("[admin] 치지직 채널 검색 실패 (CORS/네트워크 가능성):", e);
      return { ok: false, error: String((e && e.message) || e), list: [] };
    }
  }

  const DIRECTIVE_CARET_CHAR = "\u200b";

  function findDirectiveTokenBracketEnd(raw, openIndex) {
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

  function parseEditorMediaToken(raw, start) {
    if (raw.slice(start, start + 3).toLowerCase() !== ":m[") return null;
    const close = findDirectiveTokenBracketEnd(raw, start + 2);
    if (close < 0) return null;
    const body = raw.slice(start + 3, close);
    const braceClose = body.lastIndexOf("}");
    const braceOpen = braceClose >= 0 ? body.lastIndexOf("{", braceClose) : -1;
    if (braceOpen < 0 || braceClose !== body.length - 1) return null;
    return {
      raw: raw.slice(start, close + 1),
      kind: "m",
      label: body.slice(0, braceOpen).trim() || "media",
      url: body.slice(braceOpen + 1, braceClose).trim(),
      end: close + 1,
    };
  }

  function parseEditorPopupToken(raw, start) {
    if (raw.slice(start, start + 3).toLowerCase() !== ":p[") return null;
    const labelStart = start + 3;
    const braceOpen = raw.indexOf("{", labelStart);
    if (braceOpen < 0) return null;
    const close = raw.indexOf("}]", braceOpen + 1);
    if (close < 0) return null;
    return {
      raw: raw.slice(start, close + 2),
      kind: "p",
      label: raw.slice(labelStart, braceOpen).trim() || "팝업",
      body: raw.slice(braceOpen + 1, close).trim(),
      end: close + 2,
    };
  }

  function parseEditorDirectiveToken(raw, start) {
    const media = parseEditorMediaToken(raw, start);
    if (media) return media;
    const popup = parseEditorPopupToken(raw, start);
    if (popup) return popup;
    const head = raw.slice(start).match(/^:(s|t)\[/i);
    if (head) {
      const close = findDirectiveTokenBracketEnd(raw, start + 2);
      if (close > start) {
        return {
          raw: raw.slice(start, close + 1),
          kind: head[1].toLowerCase(),
          label: raw.slice(start + 3, close).trim(),
          end: close + 1,
        };
      }
    }
    const inline = raw.slice(start).match(/^:(s|t)\s+([^\s:]+)/i);
    if (inline) {
      return { raw: inline[0], kind: inline[1].toLowerCase(), label: inline[2].trim(), end: start + inline[0].length };
    }
    return null;
  }

  function editorDirectiveTokens(value) {
    const raw = String(value || "");
    const tokens = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] !== ":") continue;
      const token = parseEditorDirectiveToken(raw, i);
      if (!token) continue;
      token.index = i;
      tokens.push(token);
      i = token.end - 1;
    }
    return tokens;
  }
  function appendEditorText(parent, text) {
    if (text) parent.appendChild(document.createTextNode(text));
  }

  function appendStyledEditorText(parent, text) {
    const specs = [
      { marker: "***", className: "editor-style-bold editor-style-italic" },
      { marker: "**", className: "editor-style-bold" },
      { marker: "__", className: "editor-style-underline" },
      { marker: "~~", className: "editor-style-strike" },
      { marker: "*", className: "editor-style-italic" },
    ];
    const render = (target, value) => {
      let best = null;
      for (const spec of specs) {
        let from = 0;
        while (from < value.length) {
          const start = value.indexOf(spec.marker, from);
          if (start < 0) break;
          if (spec.marker === "*" && value[start + 1] === "*") { from = start + 2; continue; }
          const innerStart = start + spec.marker.length;
          const stop = value.indexOf(spec.marker, innerStart);
          if (stop > innerStart) {
            if (!best || start < best.start || (start === best.start && spec.marker.length > best.spec.marker.length)) best = { spec, start, stop };
            break;
          }
          from = innerStart;
        }
      }
      if (!best) { appendEditorText(target, value); return; }
      appendEditorText(target, value.slice(0, best.start));
      const span = document.createElement("span");
      span.className = "editor-style-token " + best.spec.className;
      span.dataset.marker = best.spec.marker;
      render(span, value.slice(best.start + best.spec.marker.length, best.stop));
      target.appendChild(span);
      render(target, value.slice(best.stop + best.spec.marker.length));
    };
    render(parent, text || "");
  }
  function directiveInputLabel(kind) {
    if (kind === "t") return "\uD0DC\uADF8";
    if (kind === "s") return "\uC2A4\uD2B8\uB9AC\uBA38";
    if (kind === "m") return "\uBBF8\uB514\uC5B4";
    if (kind === "p") return "\uD14D\uC2A4\uD2B8\uD31D\uC5C5";
    return "\uD56D\uBAA9";
  }
  function cleanInlineDirectiveInput(value, chars) {
    let text = String(value || "").trim();
    chars.forEach((ch) => { text = text.split(ch).join(""); });
    return text;
  }

  function directChildByClass(node, className) {
    return Array.from(node.children || []).find((child) => child.classList && child.classList.contains(className));
  }

  function inlineDirectiveRaw(token) {
    const kind = token.dataset.kind || "t";
    const labelEditor = directChildByClass(token, "directive-token-label-editor");
    const labelInput = directChildByClass(token, "directive-token-label") || token.querySelector('[data-token-label="1"]');
    const urlInput = directChildByClass(token, "directive-token-url") || token.querySelector('[data-token-url="1"]');
    const rawLabel = labelEditor ? serializeDirectiveEditor(labelEditor) : (labelInput ? labelInput.value : "");
    if (kind === "p") {
      const label = cleanInlineDirectiveInput(rawLabel || "\uD31D\uC5C5", ["{"]) || "\uD31D\uC5C5";
      const body = cleanInlineDirectiveInput(token.dataset.popupBody || "", ["}"]);
      return ":p[" + label + "{" + body + "}]";
    }
    if (kind === "m") {
      const label = cleanInlineDirectiveInput(rawLabel || "media", ["{"]) || "media";
      const url = cleanInlineDirectiveInput(urlInput ? urlInput.value : "", ["]", "}"]);
      return ":m[" + label + "{" + url + "}]";
    }
    const label = cleanInlineDirectiveInput(rawLabel, []);
    return ":" + kind + "[" + label + "]";
  }

  function makeInlineDirectiveInput(kind, value, placeholder, widthClass) {
    const input = document.createElement("input");
    input.type = kind === "url" ? "url" : "text";
    input.value = value || "";
    input.placeholder = placeholder || "";
    input.className = widthClass || "";
    input.spellcheck = false;
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); input.blur(); }
    });
    input.addEventListener("mousedown", (event) => event.stopPropagation());
    input.addEventListener("click", (event) => event.stopPropagation());
    return input;
  }

  function renderDirectiveLabelEditor(labelEditor, value, source, editor) {
    labelEditor.innerHTML = "";
    const tokens = editorDirectiveTokens(value);
    let last = 0;
    tokens.forEach((item) => {
      appendStyledEditorText(labelEditor, value.slice(last, item.index));
      labelEditor.appendChild(renderDirectiveInputToken(item, source, editor));
      last = item.end;
    });
    appendStyledEditorText(labelEditor, value.slice(last));
  }

  function bindDirectiveLabelEditor(labelEditor, source, editor) {
    labelEditor.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); insertEditorPlainText(labelEditor, " "); syncEditorToSource(source, editor, false); }
    });
    labelEditor.addEventListener("input", () => { rememberEditorSelection(labelEditor); syncEditorToSource(source, editor, false); });
    labelEditor.addEventListener("keyup", () => rememberEditorSelection(labelEditor));
    labelEditor.addEventListener("mouseup", () => rememberEditorSelection(labelEditor));
    labelEditor.addEventListener("focus", () => { editor._activeLabelEditor = labelEditor; rememberEditorSelection(labelEditor); });
    labelEditor.addEventListener("mousedown", () => { editor._activeLabelEditor = labelEditor; });
  }

  function focusInsertedNestedToken(labelEditor, start) {
    const token = labelEditor.querySelector('.directive-input-token[data-start="' + start + '"]');
    const target = token && directChildByClass(token, "directive-token-label-editor");
    if (target) {
      target.focus();
      setEditorSelectionByOffsets(target, 0, serializeDirectiveEditor(target).length);
    }
  }

  function insertNestedInlineDirective(source, editor, labelEditor, kind) {
    const value = serializeDirectiveEditor(labelEditor);
    const offsets = editorSelectionOffsets(labelEditor);
    const selected = value.slice(offsets.start, offsets.end);
    const baseLabel = selected || (kind === "m" ? "media" : (kind === "p" ? "\uD31D\uC5C5" : ""));
    const insertText = kind === "m" ? ":m[" + cleanInlineDirectiveInput(baseLabel, ["{"]) + "{}]" : (kind === "p" ? ":p[" + cleanInlineDirectiveInput(baseLabel, ["{"]) + "{}]" : ":" + kind + "[" + cleanInlineDirectiveInput(baseLabel, ["]"]) + "]");
    renderDirectiveLabelEditor(labelEditor, value.slice(0, offsets.start) + insertText + value.slice(offsets.end), source, editor);
    syncEditorToSource(source, editor, false);
    focusInsertedNestedToken(labelEditor, offsets.start);
  }

  function removeDirectiveToken(token, source, editor) {
    const host = token.parentElement;
    pushEditorUndo(source);
    token.remove();
    syncEditorToSource(source, editor, false);
    const target = host && host.classList && host.classList.contains("directive-token-label-editor") ? host : editor;
    const nextCaret = Math.min(serializeDirectiveEditor(target).length, +(token.dataset.start || 0));
    target.focus();
    setEditorSelectionByOffsets(target, nextCaret, nextCaret);
  }
  function renderDirectiveInputToken(item, source, editor) {
    const token = document.createElement("span");
    token.className = "directive-token directive-token-" + item.kind + " directive-input-token";
    token.contentEditable = "false";
    token.dataset.kind = item.kind;
    token.dataset.start = String(item.index);
    const name = document.createElement("span");
    name.className = "directive-token-name";
    name.textContent = directiveInputLabel(item.kind);
    token.appendChild(name);

    const label = document.createElement("span");
    label.className = "directive-token-label-editor" + (item.kind === "m" || item.kind === "p" ? " directive-token-label" : "");
    label.contentEditable = "false";
    label.spellcheck = false;
    label.dataset.tokenLabel = "1";
    label.dataset.placeholder = item.kind === "m" || item.kind === "p" ? "\uD45C\uC2DC \uD14D\uC2A4\uD2B8" : "\uD14D\uC2A4\uD2B8";
    renderDirectiveLabelEditor(label, item.label || "", source, editor);
    label.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); openDirectiveTokenEditPopup(source, editor, token); });
    token.appendChild(label);

    if (item.kind === "m") {
      const url = makeInlineDirectiveInput("url", item.url || "", "URL", "directive-token-url");
      url.dataset.tokenUrl = "1";
      url.readOnly = true;
      url.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); openDirectiveTokenEditPopup(source, editor, token); });
      token.appendChild(url);
    }
    if (item.kind === "p") {
      token.dataset.popupBody = item.body || "";
    }
    token.dataset.raw = inlineDirectiveRaw(token);
    token.title = "\uD074\uB9AD\uD574\uC11C \uD3B8\uC9D1";
    token.addEventListener("click", (event) => { event.preventDefault(); event.stopPropagation(); openDirectiveTokenEditPopup(source, editor, token); });
    return token;
  }
  function renderDirectiveEditor(source, editor) {
    const value = source.value || "";
    editor.innerHTML = "";
    const tokens = editorDirectiveTokens(value);
    let last = 0;
    tokens.forEach((item) => {
      appendStyledEditorText(editor, value.slice(last, item.index));
      editor.appendChild(renderDirectiveInputToken(item, source, editor));
      last = item.end;
    });
    appendStyledEditorText(editor, value.slice(last));
    if (value) editor.appendChild(document.createTextNode(DIRECTIVE_CARET_CHAR));
  }
  function serializeDirectiveEditor(editor) {
    let out = "";
    editor.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += (node.nodeValue || "").replaceAll(DIRECTIVE_CARET_CHAR, "");
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.classList.contains("directive-input-token")) {
          node.dataset.raw = inlineDirectiveRaw(node);
          out += node.dataset.raw;
        } else if (node.classList.contains("directive-token")) out += node.dataset.raw || node.textContent || "";
        else if (node.classList.contains("editor-style-token")) out += (node.dataset.marker || "") + serializeDirectiveEditor(node) + (node.dataset.marker || "");
        else out += (node.textContent || "").replaceAll(DIRECTIVE_CARET_CHAR, "");
      }
    });
    return out;
  }
  function editorHasRawDirective(editor) {
    return Array.from(editor.childNodes).some((node) => {
      if (node.nodeType === Node.TEXT_NODE) return editorDirectiveTokens((node.nodeValue || "").replaceAll(DIRECTIVE_CARET_CHAR, "")).length > 0;
      return node.nodeType === Node.ELEMENT_NODE && !node.classList.contains("directive-token") && !node.classList.contains("editor-style-token") && editorDirectiveTokens(node.textContent || "").length > 0;
    });
  }

  function moveCaretToEditorEnd(editor) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function insertEditorPlainText(editor, text) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer)) return;
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    rememberEditorSelection(editor);
  }
  function pushEditorUndo(source) {
    source._undoStack = source._undoStack || [];
    const value = source.value || "";
    if (source._undoStack[source._undoStack.length - 1] !== value) {
      source._undoStack.push(value);
      if (source._undoStack.length > 60) source._undoStack.shift();
    }
  }

  function undoEditorChange(source, editor) {
    const stack = source._undoStack || [];
    if (!stack.length) return false;
    const previous = stack.pop();
    if (previous == null || previous === source.value) return false;
    source.value = previous;
    source.dispatchEvent(new Event("input", { bubbles: true }));
    renderDirectiveEditor(source, editor);
    editor.focus();
    moveCaretToEditorEnd(editor);
    return true;
  }
  function syncEditorToSource(source, editor, rerender) {
    const next = serializeDirectiveEditor(editor);
    if (source.value !== next) {
      pushEditorUndo(source);
      source.value = next;
      source.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (rerender && editorHasRawDirective(editor)) {
      renderDirectiveEditor(source, editor);
      if (document.activeElement === editor) moveCaretToEditorEnd(editor);
    }
  }


  function deleteAdjacentDirectiveToken(editable, source, editor, event) {
    if (!event || (event.key !== "Backspace" && event.key !== "Delete")) return false;
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    if (!editable.contains(range.startContainer)) return false;
    const offsets = editorSelectionOffsets(editable);
    const target = offsets.start;
    let seen = 0;
    let removeNode = null;
    let nextCaret = target;
    for (const child of editable.childNodes) {
      const len = serializedNodeLength(child);
      if (event.key === "Backspace" && seen + len === target && child.nodeType === Node.ELEMENT_NODE && child.classList.contains("directive-token")) {
        removeNode = child;
        nextCaret = seen;
        break;
      }
      if (event.key === "Delete" && seen === target && child.nodeType === Node.ELEMENT_NODE && child.classList.contains("directive-token")) {
        removeNode = child;
        nextCaret = seen;
        break;
      }
      seen += len;
    }
    if (!removeNode) return false;
    event.preventDefault();
    pushEditorUndo(source);
    removeNode.remove();
    syncEditorToSource(source, editor, false);
    editable.focus();
    setEditorSelectionByOffsets(editable, nextCaret, nextCaret);
    return true;
  }
  function markerLengthForNode(node) {
    return node && node.nodeType === Node.ELEMENT_NODE && node.classList.contains("editor-style-token")
      ? (node.dataset.marker || "").length
      : 0;
  }

  function serializedNodeLength(node) {
    if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue || "").replaceAll(DIRECTIVE_CARET_CHAR, "").length;
    if (node.nodeType !== Node.ELEMENT_NODE) return 0;
    if (node.classList.contains("directive-input-token")) return inlineDirectiveRaw(node).length;
    if (node.classList.contains("directive-token")) return (node.dataset.raw || node.textContent || "").length;
    const markerLength = markerLengthForNode(node);
    let total = markerLength * 2;
    node.childNodes.forEach((child) => { total += serializedNodeLength(child); });
    return total;
  }

  function serializedOffsetInside(node, container, offset) {
    if (node === container) {
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.nodeValue || "").slice(0, offset).replaceAll(DIRECTIVE_CARET_CHAR, "").length;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return 0;
      if (node.classList.contains("directive-token")) return offset > 0 ? serializedNodeLength(node) : 0;
      let total = markerLengthForNode(node);
      const children = Array.from(node.childNodes);
      for (let i = 0; i < Math.min(offset, children.length); i++) total += serializedNodeLength(children[i]);
      return total;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return 0;
    if (node.classList.contains("directive-token")) return 0;
    let total = markerLengthForNode(node);
    for (const child of node.childNodes) {
      if (child === container || (child.contains && child.contains(container))) {
        return total + serializedOffsetInside(child, container, offset);
      }
      total += serializedNodeLength(child);
    }
    return total;
  }

  function editorOffsetForPoint(editor, container, offset) {
    let total = 0;
    for (const node of editor.childNodes) {
      if (node === container || (node.contains && node.contains(container))) {
        return total + serializedOffsetInside(node, container, offset);
      }
      total += serializedNodeLength(node);
    }
    return total;
  }
  function currentEditorSelectionOffsets(editor) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
    const start = editorOffsetForPoint(editor, range.startContainer, range.startOffset);
    const end = editorOffsetForPoint(editor, range.endContainer, range.endOffset);
    return start <= end ? { start, end } : { start: end, end: start };
  }

  function rememberEditorSelection(editor) {
    const offsets = currentEditorSelectionOffsets(editor);
    if (offsets) editor._lastSelectionOffsets = offsets;
    return offsets;
  }

  function captureToolbarSelection(editor, event) {
    if (event) event.preventDefault();
    const offsets = currentEditorSelectionOffsets(editor) || editor._lastSelectionOffsets;
    if (offsets) editor._toolbarSelectionOffsets = { start: offsets.start, end: offsets.end };
  }

  function editorSelectionOffsets(editor) {
    const current = rememberEditorSelection(editor);
    if (current) return current;
    if (editor._lastSelectionOffsets) return editor._lastSelectionOffsets;
    const fallback = serializeDirectiveEditor(editor).length;
    return { start: fallback, end: fallback };
  }

  function editorPointForOffset(editor, target) {
    let seen = 0;
    for (const node of editor.childNodes) {
      const len = serializedNodeLength(node);
      if (seen + len >= target) return nodePointForOffset(node, target - seen);
      seen += len;
    }
    return { node: editor, offset: editor.childNodes.length };
  }

  function nodePointForOffset(node, target) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.nodeValue || "").replaceAll(DIRECTIVE_CARET_CHAR, "");
      return { node, offset: Math.min(text.length, Math.max(0, target)) };
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return { node: node.parentNode || node, offset: 0 };
    if (node.classList.contains("directive-token")) {
      const parent = node.parentNode;
      return { node: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) + (target > 0 ? 1 : 0) };
    }
    const markerLength = markerLengthForNode(node);
    let seen = markerLength;
    if (target <= markerLength) return { node, offset: 0 };
    for (const child of node.childNodes) {
      const len = serializedNodeLength(child);
      if (seen + len >= target) return nodePointForOffset(child, target - seen);
      seen += len;
    }
    return { node, offset: node.childNodes.length };
  }

  function setEditorSelectionByOffsets(editor, start, end) {
    const range = document.createRange();
    const a = editorPointForOffset(editor, start);
    const b = editorPointForOffset(editor, end);
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    editor._lastSelectionOffsets = { start, end };
  }
  function setEditorCaretByOffset(editor, target) {
    let seen = 0;
    const range = document.createRange();
    for (const node of editor.childNodes) {
      const len = serializedNodeLength(node);
      if (seen + len >= target) {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = (node.nodeValue || "").replaceAll(DIRECTIVE_CARET_CHAR, "");
          range.setStart(node, Math.min(text.length, Math.max(0, target - seen)));
        } else {
          range.setStartAfter(node);
        }
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return;
      }
      seen += len;
    }
    moveCaretToEditorEnd(editor);
  }

  let directiveInsertPopup = null;
  let directiveInsertPopupStack = [];
  let directiveInsertSearchSeq = 0;

  function selectedEditorText(source, editor) {
    syncEditorToSource(source, editor, false);
    const offsets = editor._toolbarSelectionOffsets || editorSelectionOffsets(editor);
    return (source.value || "").slice(offsets.start, offsets.end);
  }

  function cleanDirectiveValue(value, chars, options) {
    let text = String(value || "");
    if (!(options && options.preserveWhitespace)) text = text.trim();
    chars.forEach((ch) => { text = text.split(ch).join(""); });
    return text;
  }

  function replaceEditorSelection(source, editor, insertText, caretOffset) {
    syncEditorToSource(source, editor, false);
    const offsets = editor._toolbarSelectionOffsets || editorSelectionOffsets(editor);
    editor._toolbarSelectionOffsets = null;
    const value = source.value || "";
    pushEditorUndo(source);
    source.value = value.slice(0, offsets.start) + insertText + value.slice(offsets.end);
    source.dispatchEvent(new Event("input", { bubbles: true }));
    renderDirectiveEditor(source, editor);
    editor.focus();
    setEditorCaretByOffset(editor, offsets.start + (caretOffset == null ? insertText.length : caretOffset));
  }



  function activeDirectiveLabelEditor(editor) {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
    const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
    const startLabel = startElement && startElement.closest && startElement.closest(".directive-token-label-editor");
    const endLabel = endElement && endElement.closest && endElement.closest(".directive-token-label-editor");
    return startLabel && startLabel === endLabel && editor.contains(startLabel) ? startLabel : null;
  }
  function insertInlineDirective(source, editor, kind) {
    const toolbarOffsets = editor._toolbarSelectionOffsets;
    const toolbarLabelEditor = editor._toolbarLabelEditor;
    const labelEditor = toolbarLabelEditor && editor.contains(toolbarLabelEditor) ? toolbarLabelEditor : (toolbarOffsets ? null : activeDirectiveLabelEditor(editor));
    editor._toolbarLabelEditor = null;
    if (labelEditor) {
      editor._toolbarSelectionOffsets = null;
      insertNestedInlineDirective(source, editor, labelEditor, kind);
      return;
    }
    syncEditorToSource(source, editor, false);
    const offsets = toolbarOffsets || editorSelectionOffsets(editor);
    editor._toolbarSelectionOffsets = null;
    const value = source.value || "";
    const selected = value.slice(offsets.start, offsets.end);
    const baseLabel = selected || (kind === "m" ? "media" : (kind === "p" ? "\uD31D\uC5C5" : ""));
    const insertText = kind === "m" ? ":m[" + cleanInlineDirectiveInput(baseLabel, ["{"]) + "{}]" : (kind === "p" ? ":p[" + cleanInlineDirectiveInput(baseLabel, ["{"]) + "{}]" : ":" + kind + "[" + cleanInlineDirectiveInput(baseLabel, ["]"]) + "]");
    pushEditorUndo(source);
    source.value = value.slice(0, offsets.start) + insertText + value.slice(offsets.end);
    source.dispatchEvent(new Event("input", { bubbles: true }));
    renderDirectiveEditor(source, editor);
    const token = editor.querySelector('.directive-input-token[data-start="' + offsets.start + '"]');
    const focusTarget = token && token.querySelector('[data-token-label="1"]');
    if (focusTarget) {
      focusTarget.focus();
      if (focusTarget.select) focusTarget.select();
      else setEditorSelectionByOffsets(focusTarget, 0, serializeDirectiveEditor(focusTarget).length);
    } else {
      editor.focus();
      setEditorCaretByOffset(editor, offsets.start + insertText.length);
    }
  }function getDirectiveInsertPopup() {
    if (directiveInsertPopup) return directiveInsertPopup;
    directiveInsertPopup = document.createElement("div");
    directiveInsertPopup.className = "directive-popup-shell";
    directiveInsertPopup.hidden = true;
    directiveInsertPopup.innerHTML = '<div class="directive-popup-backdrop" data-directive-popup-close="1"></div>' +
      '<div class="directive-popup" role="dialog" aria-modal="true">' +
      '<div class="directive-popup-head"><span class="directive-popup-title"></span>' +
      '<button type="button" class="directive-popup-close" data-directive-popup-close="1" aria-label="닫기">×</button></div>' +
      '<div class="directive-popup-body"></div></div>';
    document.body.appendChild(directiveInsertPopup);
    directiveInsertPopup.addEventListener("mousedown", (event) => {
      if (event.target && event.target.getAttribute("data-directive-popup-close")) closeDirectiveInsertPopup();
    });
    return directiveInsertPopup;
  }

  function saveDirectiveInsertPopupState() {
    const popup = getDirectiveInsertPopup();
    const body = popup.querySelector(".directive-popup-body");
    const fragment = document.createDocumentFragment();
    while (body.firstChild) fragment.appendChild(body.firstChild);
    directiveInsertPopupStack.push({
      title: popup.querySelector(".directive-popup-title").textContent,
      body: fragment,
    });
  }

  function restoreDirectiveInsertPopupState() {
    const state = directiveInsertPopupStack.pop();
    if (!state || !directiveInsertPopup) return false;
    const body = directiveInsertPopup.querySelector(".directive-popup-body");
    body.innerHTML = "";
    body.appendChild(state.body);
    directiveInsertPopup.querySelector(".directive-popup-title").textContent = state.title;
    directiveInsertPopup.hidden = false;
    return true;
  }

  function closeDirectiveInsertPopup() {
    if (restoreDirectiveInsertPopupState()) {
      directiveInsertSearchSeq += 1;
      return;
    }
    if (directiveInsertPopup) directiveInsertPopup.hidden = true;
    directiveInsertPopupStack = [];
    directiveInsertSearchSeq += 1;
  }

  function openDirectiveInsertPopup(title, bodyHtml, onReady) {
    const popup = getDirectiveInsertPopup();
    popup.querySelector(".directive-popup-title").textContent = title;
    popup.querySelector(".directive-popup-body").innerHTML = bodyHtml;
    popup.hidden = false;
    if (onReady) onReady(popup);
  }

  function popupActionsHtml(applyLabel, options) {
    const deleteButton = options && options.allowDelete ? '<button type="button" class="directive-popup-delete" data-popup-delete="1">\uC0AD\uC81C</button>' : "";
    return '<div class="directive-popup-actions">' + deleteButton +
      '<button type="button" class="directive-popup-cancel" data-popup-cancel="1">\uCDE8\uC18C</button>' +
      '<button type="button" class="directive-popup-apply" data-popup-apply="1">' + (applyLabel || "\uD655\uC778") + '</button>' +
      '</div>';
  }

  function bindPopupCancel(popup) {
    const cancel = popup.querySelector('[data-popup-cancel="1"]');
    if (cancel) cancel.onclick = closeDirectiveInsertPopup;
  }

  function bindPopupDelete(popup, context) {
    const remove = popup.querySelector('[data-popup-delete="1"]');
    if (!remove || !context) return;
    remove.onclick = () => {
      applyDirectiveTokenEdit(context, null);
      closeDirectiveInsertPopup();
    };
  }

  function bindInstantMemberResult(button, handler) {
    let handled = false;
    const resultContainer = () => button.closest && button.closest(".member-results, .directive-suggestions, .directive-popup-results");
    const suppressLinkedSearchInput = () => {
      const container = resultContainer();
      if (!container || !container.parentElement) return;
      const input = container.parentElement.querySelector('input[data-gif="label"], input[data-msearch], input[data-hsearch]');
      if (!input) return;
      input.dataset.searchDropdownSuppressed = "1";
      input.blur();
    };
    const closeResultContainer = () => {
      const container = resultContainer();
      if (!container) return;
      if (container.classList && container.classList.contains("directive-suggestions")) container.hidden = true;
      container.innerHTML = "";
    };
    const run = (event) => {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      if (handled) return;
      handled = true;
      suppressLinkedSearchInput();
      closeResultContainer();
      handler();
      setTimeout(() => {
        closeResultContainer();
        handled = false;
      }, 0);
    };
    button.onpointerdown = run;
    button.onmousedown = run;
    button.onclick = run;
  }
  function insertPopupInlineDirective(source, editor, kind) {
    editor._toolbarSelectionOffsets = editor._toolbarSelectionOffsets || currentEditorSelectionOffsets(editor) || editor._lastSelectionOffsets;
    saveDirectiveInsertPopupState();
    const context = { nestedInsert: true };
    if (kind === "t") return openTagInsertPopup(source, editor, context);
    if (kind === "s") return openStreamerInsertPopup(source, editor, context);
    if (kind === "m") return openMediaInsertPopup(source, editor, context);
    if (kind === "p") return openTextPopupInsertPopup(source, editor, context);
  }
  function popupStyleToolbar(source, editor, options) {
    const toolbar = document.createElement("div");
    toolbar.className = "style-toolbar directive-popup-toolbar";
    [
      { label: "B", title: "Bold", prefix: "**", suffix: "**", cls: "bold" },
      { label: "U", title: "Underline", prefix: "__", suffix: "__", cls: "underline" },
      { label: "S", title: "Strike", prefix: "~~", suffix: "~~", cls: "strike" },
      { label: "I", title: "Italic", prefix: "*", suffix: "*", cls: "italic" },
      { label: "\u2192", title: "\uC6B0\uCE21\uD654\uC0B4\uD45C", insert: "\u2192", cls: "arrow" },
    ].forEach((style) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "style-btn " + style.cls;
      button.textContent = style.label;
      button.title = style.title;
      button.onpointerdown = (event) => captureToolbarSelection(editor, event);
      button.onmousedown = (event) => captureToolbarSelection(editor, event);
      button.onclick = () => {
        syncEditorToSource(source, editor, false);
        const offsets = editor._toolbarSelectionOffsets || editorSelectionOffsets(editor);
        editor._toolbarSelectionOffsets = null;
        const value = source.value || "";
        if (style.insert) {
          source.value = value.slice(0, offsets.start) + style.insert + value.slice(offsets.end);
          renderDirectiveEditor(source, editor);
          editor.focus();
          const next = offsets.start + style.insert.length;
          setEditorSelectionByOffsets(editor, next, next);
          return;
        }
        const selected = value.slice(offsets.start, offsets.end) || "text";
        source.value = value.slice(0, offsets.start) + style.prefix + selected + style.suffix + value.slice(offsets.end);
        renderDirectiveEditor(source, editor);
        editor.focus();
        setEditorSelectionByOffsets(editor, offsets.start + style.prefix.length, offsets.start + style.prefix.length + selected.length);
      };
      toolbar.appendChild(button);
    });
    if (options && options.allowInserts) {
      const divider = document.createElement("span");
      divider.className = "style-divider";
      toolbar.appendChild(divider);
      [
        { label: "\uD0DC\uADF8", title: "\uD0DC\uADF8 \uC785\uB825", kind: "t" },
        { label: "\uC2A4\uD2B8\uB9AC\uBA38", title: "\uC2A4\uD2B8\uB9AC\uBA38 \uC785\uB825", kind: "s" },
        { label: "\uBBF8\uB514\uC5B4", title: "\uBBF8\uB514\uC5B4 \uC785\uB825", kind: "m" },
        { label: "\uD31D\uC5C5", title: "\uD14D\uC2A4\uD2B8 \uD31D\uC5C5 \uC785\uB825", kind: "p" },
      ].forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "style-btn insert-btn";
        button.textContent = item.label;
        button.title = item.title;
        button.onmousedown = (event) => {
          editor._toolbarSelectionOffsets = currentEditorSelectionOffsets(editor) || editor._lastSelectionOffsets;
          event.preventDefault();
        };
        button.onclick = () => insertPopupInlineDirective(source, editor, item.kind);
        toolbar.appendChild(button);
      });
    }
    return toolbar;
  }

  function setupPopupDirectiveEditor(popup, slotSelector, initialValue, placeholder, options) {
    const slot = popup.querySelector(slotSelector);
    const source = document.createElement("textarea");
    source.className = "directive-source";
    source.value = initialValue || "";
    const editor = document.createElement("div");
    editor.className = "directive-editor multiline directive-popup-editor";
    editor.contentEditable = "true";
    editor.setAttribute("role", "textbox");
    editor.dataset.placeholder = placeholder || "";
    slot.appendChild(popupStyleToolbar(source, editor, options));
    slot.appendChild(source);
    slot.appendChild(editor);
    renderDirectiveEditor(source, editor);
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        insertEditorPlainText(editor, "\n");
        syncEditorToSource(source, editor, false);
      }
    });
    editor.addEventListener("input", () => {
      rememberEditorSelection(editor);
      syncEditorToSource(source, editor, true);
    });
    editor.addEventListener("keyup", () => rememberEditorSelection(editor));
    editor.addEventListener("mouseup", () => rememberEditorSelection(editor));
    editor.addEventListener("focus", () => rememberEditorSelection(editor));
    return { source, editor };
  }

  function popupEditorValue(instance) {
    syncEditorToSource(instance.source, instance.editor, false);
    return instance.source.value || "";
  }

  function directiveTokenEditContext(source, editor, token) {
    const kind = token.dataset.kind || "t";
    const labelEditor = directChildByClass(token, "directive-token-label-editor");
    const urlInput = directChildByClass(token, "directive-token-url") || token.querySelector('[data-token-url="1"]');
    const bodyInput = directChildByClass(token, "directive-token-body") || token.querySelector('[data-token-body="1"]');
    return {
      source,
      editor,
      token,
      kind,
      label: labelEditor ? serializeDirectiveEditor(labelEditor) : "",
      url: urlInput ? (urlInput.value != null ? urlInput.value : urlInput.textContent || "") : "",
      body: token.dataset.popupBody || (bodyInput ? (bodyInput.value != null ? bodyInput.value : bodyInput.textContent || "") : ""),
    };
  }

  function applyDirectiveTokenEdit(context, rawText) {
    if (!context || !context.token || !context.token.parentElement) return;
    pushEditorUndo(context.source);
    if (rawText == null) context.token.remove();
    else context.token.replaceWith(document.createTextNode(rawText));
    syncEditorToSource(context.source, context.editor, true);
    context.editor.focus();
    moveCaretToEditorEnd(context.editor);
  }

  function openDirectiveTokenEditPopup(source, editor, token) {
    const context = directiveTokenEditContext(source, editor, token);
    if (editor.classList && editor.classList.contains("directive-popup-editor")) saveDirectiveInsertPopupState();
    if (context.kind === "t") return openTagInsertPopup(source, editor, context);
    if (context.kind === "s") return openStreamerInsertPopup(source, editor, context);
    if (context.kind === "m") return openMediaInsertPopup(source, editor, context);
    if (context.kind === "p") return openTextPopupInsertPopup(source, editor, context);
  }

  function openDirectiveInsertModal(source, editor, kind) {
    if (kind === "t") return openTagInsertPopup(source, editor, null);
    if (kind === "s") return openStreamerInsertPopup(source, editor, null);
    if (kind === "m") return openMediaInsertPopup(source, editor, null);
    if (kind === "p") return openTextPopupInsertPopup(source, editor, null);
  }

  function openTagInsertPopup(source, editor, context) {
    const selected = context && context.token ? context.label : selectedEditorText(source, editor);
    openDirectiveInsertPopup("태그 삽입",
      '<div class="directive-popup-field"><label>태그 텍스트</label><div data-tag-editor="1"></div></div>' +
      '<div class="directive-popup-field"><button type="button" class="add-btn small" data-tag-new="1">NEW 태그</button></div>' +
      popupActionsHtml("확인", { allowDelete: !!(context && context.token) }),
      (popup) => {
        bindPopupCancel(popup);
        bindPopupDelete(popup, context);
        const draft = setupPopupDirectiveEditor(popup, '[data-tag-editor="1"]', selected, "태그 텍스트", { allowInserts: true });
        const newTag = popup.querySelector('[data-tag-new="1"]');
        if (newTag) newTag.onclick = () => {
          if (context && context.token) applyDirectiveTokenEdit(context, ":t[New]");
          else replaceEditorSelection(source, editor, ":t[New]");
          closeDirectiveInsertPopup();
        };        const apply = popup.querySelector('[data-popup-apply="1"]');
        apply.onclick = () => {
          const text = cleanDirectiveValue(popupEditorValue(draft), [], { preserveWhitespace: true });
          if (!text.trim()) { draft.editor.focus(); return; }
          if (context && context.token) applyDirectiveTokenEdit(context, ":t[" + text + "]");
          else replaceEditorSelection(source, editor, ":t[" + text + "]");
          closeDirectiveInsertPopup();
        };
        draft.editor.focus();
        setEditorSelectionByOffsets(draft.editor, 0, serializeDirectiveEditor(draft.editor).length);
      });
  }

  function openMediaInsertPopup(source, editor, context) {
    const selected = context && context.token ? context.label : selectedEditorText(source, editor);
    openDirectiveInsertPopup("미디어 삽입",
      '<div class="directive-popup-field"><label>표시 텍스트</label><div data-media-editor="1"></div></div>' +
      '<div class="directive-popup-field"><label>링크</label><input type="url" inputmode="url" data-media-url="1" placeholder="https://" /></div>' +
      popupActionsHtml("확인", { allowDelete: !!(context && context.token) }),
      (popup) => {
        bindPopupCancel(popup);
        bindPopupDelete(popup, context);
        const draft = setupPopupDirectiveEditor(popup, '[data-media-editor="1"]', selected, "표시 텍스트", { allowInserts: true });
        const url = popup.querySelector('[data-media-url="1"]');
        if (context && context.token) url.value = context.url || "";
        const apply = popup.querySelector('[data-popup-apply="1"]');
        apply.onclick = () => {
          const label = cleanDirectiveValue(popupEditorValue(draft), [], { preserveWhitespace: true }) || "미디어";
          const safeUrl = cleanDirectiveValue(url.value, ["]", "}"]);
          if (!safeUrl) { url.focus(); return; }
          if (context && context.token) applyDirectiveTokenEdit(context, ":m[" + label + "{" + safeUrl + "}]");
          else replaceEditorSelection(source, editor, ":m[" + label + "{" + safeUrl + "}]");
          closeDirectiveInsertPopup();
        };
        url.onkeydown = (event) => { if (event.key === "Enter") apply.click(); };
        draft.editor.focus();
        setEditorSelectionByOffsets(draft.editor, 0, serializeDirectiveEditor(draft.editor).length);
      });
  }

  function openTextPopupInsertPopup(source, editor, context) {
    const selected = context && context.token ? context.label : selectedEditorText(source, editor);
    const bodyValue = context && context.token ? context.body : "";
    openDirectiveInsertPopup("\uD14D\uC2A4\uD2B8 \uD31D\uC5C5 \uC785\uB825",
      '<div class="directive-popup-field"><label>\uD45C\uC2DC \uD14D\uC2A4\uD2B8</label><div data-text-popup-label-editor="1"></div></div>' +
      '<div class="directive-popup-field"><label>\uD31D\uC5C5 \uBCF8\uBB38</label><div data-text-popup-body-editor="1"></div></div>' +
      popupActionsHtml("\uD655\uC778", { allowDelete: !!(context && context.token) }),
      (popup) => {
        bindPopupCancel(popup);
        bindPopupDelete(popup, context);
        const labelDraft = setupPopupDirectiveEditor(popup, '[data-text-popup-label-editor="1"]', selected, "\uD45C\uC2DC \uD14D\uC2A4\uD2B8", { allowInserts: true });
        const bodyDraft = setupPopupDirectiveEditor(popup, '[data-text-popup-body-editor="1"]', bodyValue, "\uC5C5\uB370\uC774\uD2B8 \uB0B4\uC6A9 \uB610\uB294 \uC0C1\uC138 \uB0B4\uC6A9\uC744 \uC785\uB825\uD558\uC138\uC694", { allowInserts: true });
        const apply = popup.querySelector('[data-popup-apply="1"]');
        apply.onclick = () => {
          const label = cleanDirectiveValue(popupEditorValue(labelDraft), ["{"], { preserveWhitespace: true }).trim() || "\uD31D\uC5C5";
          const body = cleanDirectiveValue(popupEditorValue(bodyDraft), ["}"], { preserveWhitespace: true });
          if (!body.trim()) { bodyDraft.editor.focus(); return; }
          const raw = ":p[" + label + "{" + body + "}]";
          if (context && context.token) applyDirectiveTokenEdit(context, raw);
          else replaceEditorSelection(source, editor, raw);
          closeDirectiveInsertPopup();
        };
        labelDraft.editor.focus();
        setEditorSelectionByOffsets(labelDraft.editor, 0, serializeDirectiveEditor(labelDraft.editor).length);
      });
  }

  function openStreamerInsertPopup(source, editor, context) {
    const selected = context && context.token ? context.label : selectedEditorText(source, editor);
    openDirectiveInsertPopup("스트리머 삽입",
      '<div class="directive-popup-field"><label>스트리머 검색</label>' +
      '<input type="text" data-streamer-query="1" placeholder="채널명 검색" value="' + esc(selected) + '" />' +
      '<div class="directive-popup-results" data-streamer-results="1"><div class="member-result-empty">검색어를 입력하세요.</div></div></div>' +
      popupActionsHtml("확인", { allowDelete: !!(context && context.token) }),
      (popup) => {
        bindPopupCancel(popup);
        bindPopupDelete(popup, context);
        const input = popup.querySelector('[data-streamer-query="1"]');
        const results = popup.querySelector('[data-streamer-results="1"]');
        const apply = popup.querySelector('[data-popup-apply="1"]');
        const updateSelectedState = (name) => {
          const value = cleanDirectiveValue(name, ["]"]);
          results.querySelectorAll(".member-result").forEach((item) => {
            const label = (item.querySelector("span") && item.querySelector("span").textContent || item.textContent || "").replace(/^입력한 이름 사용:\s*/, "").trim();
            item.classList.toggle("selected", label === value);
          });
        };
        const selectName = (name) => {
          input.value = cleanDirectiveValue(name, ["]"]);
          updateSelectedState(input.value);
          input.focus();
          input.select();
        };
        const renderResults = async () => {
          const keyword = inlineStreamerValue(input).trim();
          const seq = ++directiveInsertSearchSeq;
          if (!keyword) {
            results.innerHTML = '<div class="member-result-empty">검색어를 입력하세요.</div>';
            return;
          }
          results.innerHTML = '<div class="member-result-empty">검색 중...</div>';
          const result = await searchChzzkChannels(keyword);
          if (seq !== directiveInsertSearchSeq || popup.hidden) return;
          if (!result.ok || !result.list.length) {
            results.innerHTML = '<button type="button" class="member-result member-result-manual" data-streamer-manual="1">입력한 이름 사용: ' + esc(keyword) + '</button>';
          } else {
            results.innerHTML = result.list.slice(0, 8).map((channel, index) =>
              '<button type="button" class="member-result" data-streamer-pick="' + index + '">' +
              (channel.channelImageUrl ? '<img src="' + esc(channel.channelImageUrl) + '" alt="" />' : '') +
              '<span>' + esc(channel.channelName) + '</span></button>'
            ).join("") + '<button type="button" class="member-result member-result-manual" data-streamer-manual="1">입력한 이름 사용: ' + esc(keyword) + '</button>';
            results.querySelectorAll('[data-streamer-pick]').forEach((button) => {
              bindInstantMemberResult(button, () => selectName(result.list[+button.getAttribute("data-streamer-pick")].channelName));
            });
          }
          const manual = results.querySelector('[data-streamer-manual="1"]');
          if (manual) bindInstantMemberResult(manual, () => selectName(input.value));
        };
        let timer = null;
        input.oninput = () => { updateSelectedState(""); clearTimeout(timer); timer = setTimeout(renderResults, 250); };
        input.onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); apply.click(); } };
        apply.onclick = () => {
          const text = cleanDirectiveValue(input.value, ["]"]);
          if (!text) { input.focus(); return; }
          if (context && context.token) applyDirectiveTokenEdit(context, ":s[" + text + "]");
          else replaceEditorSelection(source, editor, ":s[" + text + "]");
          closeDirectiveInsertPopup();
        };
        input.focus();
        input.select();
        updateSelectedState(input.value);
        if (input.value.trim()) renderResults();
      });
  }
  function makeStyleToolbar(source, editor) {
    const toolbar = document.createElement("div");
    toolbar.className = "style-toolbar";
    const styles = [
      { label: "B", title: "Bold", prefix: "**", suffix: "**", cls: "bold" },
      { label: "U", title: "Underline", prefix: "__", suffix: "__", cls: "underline" },
      { label: "S", title: "Strike", prefix: "~~", suffix: "~~", cls: "strike" },
      { label: "I", title: "Italic", prefix: "*", suffix: "*", cls: "italic" },
      { label: "\u2192", title: "\uC6B0\uCE21\uD654\uC0B4\uD45C", insert: "\u2192", cls: "arrow" },
    ];
    styles.forEach((style) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "style-btn " + style.cls;
      button.textContent = style.label;
      button.title = style.title;
      button.onpointerdown = (event) => captureToolbarSelection(editor, event);
      button.onmousedown = (event) => captureToolbarSelection(editor, event);
      button.onclick = () => {
        syncEditorToSource(source, editor, false);
        const offsets = editor._toolbarSelectionOffsets || editorSelectionOffsets(editor);
        editor._toolbarSelectionOffsets = null;
        const value = source.value || "";
        pushEditorUndo(source);
        if (style.insert) {
          source.value = value.slice(0, offsets.start) + style.insert + value.slice(offsets.end);
          source.dispatchEvent(new Event("input", { bubbles: true }));
          renderDirectiveEditor(source, editor);
          editor.focus();
          const next = offsets.start + style.insert.length;
          setEditorSelectionByOffsets(editor, next, next);
          return;
        }
        const selected = value.slice(offsets.start, offsets.end) || "text";
        const nextStart = offsets.start + style.prefix.length;
        const nextEnd = nextStart + selected.length;
        source.value = value.slice(0, offsets.start) + style.prefix + selected + style.suffix + value.slice(offsets.end);
        source.dispatchEvent(new Event("input", { bubbles: true }));
        renderDirectiveEditor(source, editor);
        editor.focus();
        setEditorSelectionByOffsets(editor, nextStart, nextEnd);
      };
      toolbar.appendChild(button);
    });

    const divider = document.createElement("span");
    divider.className = "style-divider";
    toolbar.appendChild(divider);

    const inserts = [
      { label: "\uD0DC\uADF8", title: "\uD0DC\uADF8 \uC785\uB825", kind: "t" },
      { label: "\uC2A4\uD2B8\uB9AC\uBA38", title: "\uC2A4\uD2B8\uB9AC\uBA38 \uC785\uB825", kind: "s" },
      { label: "\uBBF8\uB514\uC5B4", title: "\uBBF8\uB514\uC5B4 \uC785\uB825", kind: "m" },
        { label: "\uD31D\uC5C5", title: "\uD14D\uC2A4\uD2B8 \uD31D\uC5C5 \uC785\uB825", kind: "p" },
    ];
    inserts.forEach((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "style-btn insert-btn";
      button.textContent = item.label;
      button.title = item.title;
      button.onmousedown = (event) => {
        editor._toolbarLabelEditor = activeDirectiveLabelEditor(editor);
        editor._toolbarSelectionOffsets = currentEditorSelectionOffsets(editor) || editor._lastSelectionOffsets;
        event.preventDefault();
      };
      button.onclick = () => openDirectiveInsertModal(source, editor, item.kind);
      toolbar.appendChild(button);
    });
    return toolbar;
  }
  function bindDirectiveEditors() {
    const selector = '[data-pf="content"], [data-if="content"], [data-isub-title], [data-isub-body], [data-notice-content], [data-update-body], [data-note], [data-part-note], [data-vf="label"]';
    document.querySelectorAll(selector).forEach((source) => {
      if (source.dataset.directiveEditorBound) return;
      source.dataset.directiveEditorBound = "1";
      source.classList.add("directive-source");

      const editor = document.createElement("div");
      editor.className = "directive-editor " + (source.tagName === "TEXTAREA" ? "multiline" : "singleline");
      editor.contentEditable = "true";
      editor.setAttribute("role", "textbox");
      editor.dataset.placeholder = source.getAttribute("placeholder") || "";
      source.insertAdjacentElement("afterend", editor);
      const toolbar = makeStyleToolbar(source, editor);
      const toolbarSlot = (source.classList.contains("info-textarea") ? source.closest(".info-editor-shell").querySelector(".info-card-toolbar") : (source.classList.contains("notice-textarea") ? source.closest(".notice-editor-shell").querySelector(".notice-card-toolbar") : (source.classList.contains("info-sub-title") ? source.closest(".info-sub-title-shell").querySelector(".info-sub-title-toolbar") : (source.classList.contains("info-sub-body") ? source.closest(".info-sub-editor-shell").querySelector(".info-sub-toolbar") : null))));
      if (toolbarSlot) toolbarSlot.appendChild(toolbar);
      else source.insertAdjacentElement("afterend", toolbar);
      source._directiveEditor = editor;
      editor._directiveSource = source;
      renderDirectiveEditor(source, editor);

      editor.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
          if (undoEditorChange(source, editor)) event.preventDefault();
          return;
        }
        if (!event.ctrlKey && !event.metaKey && !event.altKey && (event.key.length === 1 || event.key === "Backspace" || event.key === "Delete" || event.key === "Enter")) {
          pushEditorUndo(source);
        }
        if (event.key === "Enter" && editor.classList.contains("multiline")) {
          event.preventDefault();
          insertEditorPlainText(editor, "\n");
          syncEditorToSource(source, editor, false);
        }
      });
            editor.addEventListener("input", (event) => {
        const tokenInput = event.target && event.target.closest && event.target.closest(".directive-input-token");
        if (tokenInput) {
          syncEditorToSource(source, editor, false);
          return;
        }
        rememberEditorSelection(editor);
        syncEditorToSource(source, editor, true);
        clearTimeout(directiveSuggestTimer);
        const offsets = editorSelectionOffsets(editor);
        const target = sDirectiveInText(source.value, offsets.end);
        if (!target || target.query.length < 1) { closeDirectiveSuggestions(); return; }
        directiveSuggestTimer = setTimeout(() => showDirectiveSuggestions(source, target), 250);
      });
      editor.addEventListener("keyup", () => rememberEditorSelection(editor));
      editor.addEventListener("mouseup", () => rememberEditorSelection(editor));
      editor.addEventListener("focus", () => rememberEditorSelection(editor));
      editor.addEventListener("blur", () => { rememberEditorSelection(editor); syncEditorToSource(source, editor, false); });
      source.addEventListener("input", () => {
        if (document.activeElement !== editor && !editor.contains(document.activeElement)) renderDirectiveEditor(source, editor);
      });
    });
  }
  let directiveSuggestTimer = null;
  let directiveSuggestSeq = 0;
  let directiveSuggestBox = null;

  function getDirectiveSuggestBox() {
    if (directiveSuggestBox) return directiveSuggestBox;
    directiveSuggestBox = document.createElement("div");
    directiveSuggestBox.className = "directive-suggestions";
    directiveSuggestBox.hidden = true;
    document.body.appendChild(directiveSuggestBox);
    return directiveSuggestBox;
  }

  function closeDirectiveSuggestions() {
    if (directiveSuggestBox) directiveSuggestBox.hidden = true;
  }

  function sDirectiveInText(value, caret) {
    const before = String(value || "").slice(0, caret);
    const open = before.toLowerCase().lastIndexOf(":s[");
    if (open >= 0 && before.indexOf("]", open) < 0) {
      return { start: open, end: caret, query: before.slice(open + 3).trim() };
    }
    const whole = before.match(/^\s*:s\s+(.+)$/i);
    if (whole) return { start: before.toLowerCase().indexOf(":s"), end: caret, query: whole[1].trim() };
    const inline = before.match(/:s\s+([^\s:]*)$/i);
    if (!inline) return null;
    return { start: caret - inline[0].length, end: caret, query: inline[1].trim() };
  }

  function sDirectiveAtCaret(el) {
    const caret = el.selectionStart == null ? el.value.length : el.selectionStart;
    return sDirectiveInText(el.value, caret);
  }
  function positionDirectiveSuggestions(el) {
    const box = getDirectiveSuggestBox();
    const anchor = el._directiveEditor || el;
    const rect = anchor.getBoundingClientRect();
    box.style.left = Math.max(8, rect.left) + "px";
    box.style.top = Math.min(window.innerHeight - 230, rect.bottom + 4) + "px";
    box.style.width = Math.max(220, rect.width) + "px";
  }

  async function showDirectiveSuggestions(el, target) {
    const seq = ++directiveSuggestSeq;
    const box = getDirectiveSuggestBox();
    positionDirectiveSuggestions(el);
    box.hidden = false;
    box.innerHTML = '<div class="member-result-empty">스트리머 검색 중…</div>';
    const result = await searchChzzkChannels(target.query);
    if (seq !== directiveSuggestSeq || !el.isConnected) return;
    if (!result.ok || !result.list.length) {
      box.innerHTML = '<div class="member-result-empty">검색 결과가 없습니다. 비스트리머는 입력한 이름으로 표시됩니다.</div>';
      return;
    }
    box.innerHTML = result.list.slice(0, 8).map((channel, index) =>
      '<button type="button" class="member-result" data-directive-pick="' + index + '">' +
      (channel.channelImageUrl ? '<img src="' + esc(channel.channelImageUrl) + '" alt="" />' : "") +
      '<span>' + esc(channel.channelName) + "</span></button>"
    ).join("");
    box.dataset.activeIndex = "-1";
    box.querySelectorAll("[data-directive-pick]").forEach((button) => {
      bindInstantMemberResult(button, () => {
        const channel = result.list[+button.getAttribute("data-directive-pick")];
        const current = target;
        el.value = el.value.slice(0, current.start) + ":s[" + channel.channelName + "]" + el.value.slice(current.end);
        const nextCaret = current.start + channel.channelName.length + 4;
        el.setSelectionRange(nextCaret, nextCaret);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        if (el.getAttribute("data-pf") === "content") {
          const i = +el.getAttribute("data-i");
          const pi = +el.getAttribute("data-pi");
          if (rows[i] && rows[i].parts && rows[i].parts[pi]) {
            const beforePick = el.value.slice(0, current.start).trim().toLowerCase();
            const isInsideTag = beforePick.startsWith(":t");
            if (isInsideTag) {
              rows[i].parts[pi].content = el.value;
              rows[i].parts[pi].displayType = "text";
              rows[i].parts[pi].profile = null;
            } else {
              rows[i].parts[pi].content = channel.channelName;
              rows[i].parts[pi].displayType = "profile";
              rows[i].parts[pi].profile = channel;
            }
            const preview = document.querySelector('[data-directive-preview="' + i + "-" + pi + '"]');
            if (preview) preview.innerHTML = directivePreviewHtml(el.value, isInsideTag ? null : channel);
            markDirty();
          }
        }
        if (el._directiveEditor) {
          renderDirectiveEditor(el, el._directiveEditor);
          el._directiveEditor.focus();
          moveCaretToEditorEnd(el._directiveEditor);
        } else {
          el.focus();
        }
        closeDirectiveSuggestions();
      });
    });
  }


  function positionInlineDirectiveSuggestions(anchor) {
    const box = getDirectiveSuggestBox();
    const rect = anchor.getBoundingClientRect();
    box.style.left = Math.max(8, rect.left) + "px";
    box.style.top = Math.min(window.innerHeight - 230, rect.bottom + 5) + "px";
    box.style.width = Math.max(240, rect.width + 120) + "px";
  }


  function inlineStreamerValue(input) {
    return input && input.value != null ? input.value : serializeDirectiveEditor(input);
  }

  function setInlineStreamerValue(input, value, source, editor) {
    if (input.value != null) {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      renderDirectiveLabelEditor(input, value, source, editor);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  async function showInlineStreamerSuggestions(input, source, editor) {
    const keyword = inlineStreamerValue(input).trim();
    const seq = ++directiveSuggestSeq;
    const box = getDirectiveSuggestBox();
    positionInlineDirectiveSuggestions(input);
    box.hidden = false;
    if (!keyword) {
      box.innerHTML = '<div class="member-result-empty">스트리머 이름을 입력하세요.</div>';
      return;
    }
    box.innerHTML = '<div class="member-result-empty">스트리머 검색 중...</div>';
    const result = await searchChzzkChannels(keyword);
    if (seq !== directiveSuggestSeq || !input.isConnected || document.activeElement !== input) return;
    if (!result.ok || !result.list.length) {
      box.innerHTML = '<button type="button" class="member-result member-result-manual" data-inline-streamer-manual="1">입력한 이름 사용: ' + esc(keyword) + '</button>';
    } else {
      box.innerHTML = result.list.slice(0, 8).map((channel, index) =>
        '<button type="button" class="member-result" data-inline-streamer-pick="' + index + '">' +
        (channel.channelImageUrl ? '<img src="' + esc(channel.channelImageUrl) + '" alt="" />' : '') +
        '<span>' + esc(channel.channelName) + '</span></button>'
      ).join('') + '<button type="button" class="member-result member-result-manual" data-inline-streamer-manual="1">입력한 이름 사용: ' + esc(keyword) + '</button>';
      box.querySelectorAll('[data-inline-streamer-pick]').forEach((button) => {
        bindInstantMemberResult(button, () => {
          const channel = result.list[+button.getAttribute('data-inline-streamer-pick')];
          setInlineStreamerValue(input, channel.channelName, source, editor);
          syncEditorToSource(source, editor, false);
          input.focus();
          if (input.select) input.select();
          else setEditorSelectionByOffsets(input, 0, serializeDirectiveEditor(input).length);
          closeDirectiveSuggestions();
        });
      });
    }
    const manual = box.querySelector('[data-inline-streamer-manual="1"]');
    if (manual) {
      bindInstantMemberResult(manual, () => {
        setInlineStreamerValue(input, keyword, source, editor);
        syncEditorToSource(source, editor, false);
        input.focus();
        if (input.select) input.select();
        else setEditorSelectionByOffsets(input, 0, serializeDirectiveEditor(input).length);
        closeDirectiveSuggestions();
      });
    }
  }

  function bindInlineStreamerSearch(input, source, editor) {
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => showInlineStreamerSuggestions(input, source, editor), 250);
    });
    input.addEventListener("focus", () => {
      if (inlineStreamerValue(input).trim()) showInlineStreamerSuggestions(input, source, editor);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeDirectiveSuggestions();
    });
    input.addEventListener("blur", () => {
      setTimeout(() => {
        const box = directiveSuggestBox;
        if (!box || !box.contains(document.activeElement)) closeDirectiveSuggestions();
      }, 120);
    });
  }
  function bindDirectiveAutocompletes() {
    bindDirectiveEditors();
    const selector = '[data-pf="content"], [data-if="content"], [data-isub-title], [data-isub-body], [data-notice-content], [data-update-body], [data-note], [data-part-note], [data-vf="label"]';
    document.querySelectorAll(selector).forEach((el) => {
      if (el.dataset.directiveAutocompleteBound) return;
      el.dataset.directiveAutocompleteBound = "1";
      el.addEventListener("input", () => {
        clearTimeout(directiveSuggestTimer);
        const target = sDirectiveAtCaret(el);
        if (!target || target.query.length < 1) { closeDirectiveSuggestions(); return; }
        directiveSuggestTimer = setTimeout(() => showDirectiveSuggestions(el, target), 250);
      });
      el.addEventListener("keydown", (event) => {
        if (event.key === "Escape") { closeDirectiveSuggestions(); return; }
        const box = getDirectiveSuggestBox();
        if (box.hidden || !["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
        const buttons = Array.from(box.querySelectorAll("[data-directive-pick]"));
        if (!buttons.length) return;
        const active = +(box.dataset.activeIndex || -1);
        if (event.key === "Enter" && active >= 0) { event.preventDefault(); buttons[active].click(); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const delta = event.key === "ArrowDown" ? 1 : -1;
          const next = (active + delta + buttons.length) % buttons.length;
          buttons.forEach((button, index) => button.classList.toggle("autocomplete-active", index === next));
          box.dataset.activeIndex = String(next);
          buttons[next].scrollIntoView({ block: "nearest" });
        }
      });
      el.addEventListener("blur", () => setTimeout(closeDirectiveSuggestions, 150));
    });
  }

  function renderMemberResults(container, result, i, pi, keyword) {
    let html = "";
    if (!result.ok) {
      html += '<div class="member-result-empty">검색 실패: ' + esc(result.error) + " (브라우저 콘솔 확인)</div>";
    } else if (!result.list.length) {
      html += '<div class="member-result-empty">검색 결과 없음</div>';
    } else {
      html += result.list
        .map(
          (c) =>
            '<button type="button" class="member-result" data-mpick="' + i + "-" + pi + "-" + esc(c.channelId) + '">' +
              '<img src="' + esc(c.channelImageUrl) + '" alt="" />' +
              '<span>' + esc(c.channelName) + "</span>" +
            "</button>"
        )
        .join("");
    }
    // 치지직 스트리머가 아닌 합방 멤버(게스트 등)는 검색 없이 이름만으로 바로 추가
    html += '<button type="button" class="member-result member-result-manual" data-madd="' + i + "-" + pi + '">' +
      '"' + esc(keyword) + '" 스트리머 아님 · 직접 추가' +
      "</button>";
    container.innerHTML = html;

    const list = result.list;
    container.querySelectorAll("[data-mpick]").forEach((btn) => {
      bindInstantMemberResult(btn, () => {
        const [ri, rpi, channelId] = btn.getAttribute("data-mpick").split("-");
        const chosen = list.find((c) => c.channelId === channelId);
        if (!chosen) return;
        const row = rows[+ri];
        row.parts[+rpi].members = row.parts[+rpi].members || [];
        if (!row.parts[+rpi].members.some((m) => m.channelId === chosen.channelId)) {
          row.parts[+rpi].members.push(chosen);
        }
        render();
        markDirty();
      });
    });
    const addBtn = container.querySelector("[data-madd]");
    if (addBtn) {
      bindInstantMemberResult(addBtn, () => {
        const name = keyword.trim();
        if (!name) return;
        const [ri, rpi] = addBtn.getAttribute("data-madd").split("-").map(Number);
        const row = rows[ri];
        row.parts[rpi].members = row.parts[rpi].members || [];
        row.parts[rpi].members.push({
          // data-mdel/data-mpick은 "i-pi-channelId"를 "-"로 split하므로 channelId엔 "-"를 넣으면 안 됨
          channelId: "manual" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          channelName: name,
          channelImageUrl: "",
        });
        render();
        markDirty();
      });
    }
  }

  // 공방/타방송의 진행 채널 검색 결과 (합방 멤버와 달리 한 명만 고를 수 있음)
  function renderHostResults(container, result, i, pi, keyword) {
    let html = "";
    if (!result.ok) {
      html += '<div class="member-result-empty">검색 실패: ' + esc(result.error) + " (브라우저 콘솔 확인)</div>";
    } else if (!result.list.length) {
      html += '<div class="member-result-empty">검색 결과 없음</div>';
    } else {
      html += result.list
        .map(
          (c) =>
            '<button type="button" class="member-result" data-hpick="' + i + "-" + pi + "-" + esc(c.channelId) + '">' +
              '<img src="' + esc(c.channelImageUrl) + '" alt="" />' +
              '<span>' + esc(c.channelName) + "</span>" +
            "</button>"
        )
        .join("");
    }
    html += '<button type="button" class="member-result member-result-manual" data-hadd="' + i + "-" + pi + '">' +
      '"' + esc(keyword) + '" 스트리머 아님 · 직접 추가' +
      "</button>";
    container.innerHTML = html;

    const list = result.list;
    container.querySelectorAll("[data-hpick]").forEach((btn) => {
      bindInstantMemberResult(btn, () => {
        const [ri, rpi, channelId] = btn.getAttribute("data-hpick").split("-");
        const chosen = list.find((c) => c.channelId === channelId);
        if (!chosen) return;
        rows[+ri].parts[+rpi].hostChannel = chosen;
        render();
        markDirty();
      });
    });
    const addBtn = container.querySelector("[data-hadd]");
    if (addBtn) {
      bindInstantMemberResult(addBtn, () => {
        const name = keyword.trim();
        if (!name) return;
        const [ri, rpi] = addBtn.getAttribute("data-hadd").split("-").map(Number);
        rows[ri].parts[rpi].hostChannel = {
          channelId: "manual" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          channelName: name,
          channelImageUrl: "",
        };
        render();
        markDirty();
      });
    }
  }

  function bindChannelSearchInput(el, resultsId, renderResults) {
    let debounceTimer = null;
    let seq = 0;
    const run = () => {
      clearTimeout(debounceTimer);
      const resultsEl = $(resultsId);
      if (el.dataset.searchDropdownSuppressed === "1") {
        if (resultsEl) resultsEl.innerHTML = "";
        return;
      }
      const keyword = el.value.trim();
      if (!keyword) {
        if (resultsEl) resultsEl.innerHTML = "";
        return;
      }
      if (resultsEl) resultsEl.innerHTML = '<div class="member-result-empty">스트리머 검색 중…</div>';
      const requestSeq = ++seq;
      debounceTimer = setTimeout(async () => {
        const result = await searchChzzkChannels(keyword);
        if (requestSeq !== seq) return;
        const latestKeyword = el.value.trim();
        const el2 = $(resultsId);
        if (el2) renderResults(el2, result, latestKeyword || keyword);
      }, 250);
    };
    el.addEventListener("focus", () => { delete el.dataset.searchDropdownSuppressed; run(); });
    el.oninput = run;
    el.onkeyup = run;
    el.onchange = run;
    el.addEventListener("compositionend", run);
    el.addEventListener("search", run);
  }

  function deleteBtn(i) {
    return '<button class="icon-btn" data-del="' + i + '" aria-label="삭제">' + trashSvg() + "</button>";
  }
  function noteSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>';
  }
  function esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // parts 항목을 {content, collab, members} 형태로 정규화 (구버전은 문자열 하나였음)
  function normalizeChannelRef(c) {
    if (!c || typeof c !== "object") return null;
    if (!c.channelId && !c.channelName) return null;
    return {
      channelId: c.channelId || "",
      channelName: c.channelName || "",
      channelImageUrl: c.channelImageUrl || "",
    };
  }

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
        autoCategory: !!p.autoCategory,
        categoryId: String(p.categoryId || "").trim(),
        categoryType: String(p.categoryType || "").trim(),
      };
    }
    return { content: "", label: "", hidePartLabel: false, displayType: "text", profile: null, collab: false, official: false, otherChannel: false, ad: false, outdoor: false, speculative: false, members: [], hostChannel: null, notes: [] };
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

  function parseWholeDisplayDirective(raw) {
    const value = String(raw || "").trim();
    const bracket = value.match(/^:(s|t)\[/i);
    if (bracket) {
      const end = findDirectiveBracketEnd(value, 2);
      if (end === value.length - 1) {
        return { kind: bracket[1].toLowerCase(), value: value.slice(3, end).trim() };
      }
    }
    const spaced = value.match(/^:(s|t)\s+(.+)$/i);
    return spaced ? { kind: spaced[1].toLowerCase(), value: spaced[2].trim() } : null;
  }

  async function parseDisplayDirective(p) {
    const raw = (p.content || "").trim();
    const match = parseWholeDisplayDirective(raw);
    if (!match) {
      if (p.displayType === "profile" || p.displayType === "tag") return { ...p, content: raw };
      return { ...p, content: raw, displayType: "text", profile: null };
    }
    const value = match.value;
    if (match.kind === "t") {
      return { ...p, content: value, displayType: "tag", profile: null };
    }
    const result = await searchChzzkChannels(value);
    const exact = result.list.find((c) => c.channelName.trim().toLowerCase() === value.toLowerCase());
    const profile = exact || (result.list.length === 1 ? result.list[0] : {
      channelId: "", channelName: value, channelImageUrl: "",
    });
    return { ...p, content: value, displayType: "profile", profile };
  }
  // label이 없으면 "방송 다시보기"가 기본값

  function normalizeGameImage(item) {
    if (typeof item === "string") {
      const value = item.trim();
      if (!value) return null;
      return /^https?:\/\//i.test(value) ? { url: value, label: "" } : { url: "", label: value };
    }
    if (!item || typeof item !== "object") return null;
    const url = String(item.url || item.imageUrl || item.src || "").trim();
    const label = String(item.label || item.categoryValue || item.title || item.name || item.game || "").trim();
    const categoryId = String(item.categoryId || "").trim();
    const categoryType = String(item.categoryType || "").trim();
    const posterImageUrl = String(item.posterImageUrl || item.imageUrl || "").trim();
    return (label || url) ? { url, label, categoryId, categoryType, posterImageUrl } : null;
  }
  function normalizeVod(v) {
    if (!v || typeof v !== "object") return null;
    return { url: v.url || "", label: v.label || "방송 다시보기" };
  }

  function normalizeNoteItem(item) {
    if (item && typeof item === "object") {
      const content = String(item.content || item.text || item.note || "");
      return content.trim() ? { content, hidden: !!item.hidden } : null;
    }
    const content = String(item || "");
    return content.trim() ? { content, hidden: false } : null;
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
    return [{ content: value, hidden: false }];
  }

  function serializeNotes(notes) {
    const clean = (notes || [])
      .map(normalizeNoteItem)
      .filter(Boolean)
      .map((note) => ({ content: note.content.trim(), hidden: !!note.hidden }));
    if (!clean.length) return null;
    if (clean.length === 1 && !clean[0].hidden) return clean[0].content;
    return JSON.stringify(clean);
  }

  function bindCards() {
    document.querySelectorAll("[data-admin-month]").forEach((el) => {
      el.onclick = () => { scheduleMonthOffset += el.getAttribute("data-admin-month") === "prev" ? -1 : 1; render(); };
    });
    document.querySelectorAll("[data-admin-date]").forEach((el) => {
      el.onclick = () => { selectedScheduleDate = el.getAttribute("data-admin-date") || todayKey(); scheduleMonthOffset = 0; render(); };
    });
    document.querySelectorAll("[data-add-selected-date]").forEach((el) => {
      el.onclick = () => addRow(selectedScheduleDate || todayKey());
    });
    document.querySelectorAll("[data-addrow]").forEach((el) => {
      el.onclick = addRow;
    });
    document.querySelectorAll("[data-f]").forEach((el) => {
      const i = +el.getAttribute("data-i");
      const f = el.getAttribute("data-f");
      if (f === "date") {
        el.onchange = () => {
          if (!el.value) { el.value = rows[i].date; return; }
          const dup = rows.some((r, ri) => ri !== i && r.date === el.value);
          if (dup) {
            alert(fmtDate(el.value) + " 날짜는 이미 다른 카드에 있습니다. 두 카드가 같은 날짜일 수 없어요.");
            el.value = rows[i].date;
            return;
          }
          rows[i].date = el.value;
          selectedScheduleDate = el.value;
          render();
          markDirty();
        };
        return;
      }
      el.oninput = () => {
        rows[i][f] = el.value;
        if (f === "note") {
          const preview = document.querySelector('[data-field-preview="' + i + '-note"]');
          if (preview) preview.innerHTML = directivePreviewHtml(el.value, null);
        }
        markDirty();
      };
    });
    document.querySelectorAll("[data-toggle]").forEach((el) => {
      el.onclick = () => {
        const i = +el.getAttribute("data-toggle");
        rows[i].status = rows[i].status === "off" ? "" : "off";
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-note]").forEach((el) => {
      const [i, ni] = el.getAttribute("data-note").split("-").map(Number);
      el.oninput = () => {
        rows[i].notes[ni] = { ...(rows[i].notes[ni] || {}), content: el.value };
        const preview = document.querySelector('[data-note-preview="' + i + "-" + ni + '"]');
        if (preview) preview.innerHTML = directivePreviewHtml(el.value, null);
        markDirty();
      };
    });
    document.querySelectorAll("[data-add-note]").forEach((el) => {
      el.onclick = () => {
        const i = +el.getAttribute("data-add-note");
        rows[i].notes = rows[i].notes || [];
        rows[i].notes.push({ content: "", hidden: false });
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-note-hidden]").forEach((el) => {
      el.onclick = () => {
        const [i, ni] = el.getAttribute("data-note-hidden").split("-").map(Number);
        rows[i].notes[ni] = { ...(rows[i].notes[ni] || {}), hidden: !rows[i].notes[ni].hidden };
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-del-note]").forEach((el) => {
      el.onclick = () => {
        const [i, ni] = el.getAttribute("data-del-note").split("-").map(Number);
        rows[i].notes.splice(ni, 1);
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-part-note]").forEach((el) => {
      const [i, pi, ni] = el.getAttribute("data-part-note").split("-").map(Number);
      el.oninput = () => {
        rows[i].parts[pi].notes = rows[i].parts[pi].notes || [];
        rows[i].parts[pi].notes[ni] = { ...(rows[i].parts[pi].notes[ni] || {}), content: el.value };
        const preview = document.querySelector('[data-part-note-preview="' + i + '-' + pi + '-' + ni + '"]');
        if (preview) preview.innerHTML = directivePreviewHtml(el.value, null);
        markDirty();
      };
    });
    document.querySelectorAll("[data-add-part-note]").forEach((el) => {
      el.onclick = () => {
        const [i, pi] = el.getAttribute("data-add-part-note").split("-").map(Number);
        rows[i].parts[pi].notes = rows[i].parts[pi].notes || [];
        rows[i].parts[pi].notes.push({ content: "", hidden: false });
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-part-note-hidden]").forEach((el) => {
      el.onclick = () => {
        const [i, pi, ni] = el.getAttribute("data-part-note-hidden").split("-").map(Number);
        rows[i].parts[pi].notes[ni] = { ...(rows[i].parts[pi].notes[ni] || {}), hidden: !rows[i].parts[pi].notes[ni].hidden };
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-del-part-note]").forEach((el) => {
      el.onclick = () => {
        const [i, pi, ni] = el.getAttribute("data-del-part-note").split("-").map(Number);
        rows[i].parts[pi].notes.splice(ni, 1);
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-cafetoggle]").forEach((el) => {
      el.onclick = () => {
        const i = +el.getAttribute("data-cafetoggle");
        rows[i].cafe_time = !rows[i].cafe_time;
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-videotoggle]").forEach((el) => {
      el.onclick = () => {
        const i = +el.getAttribute("data-videotoggle");
        rows[i].video_time = !rows[i].video_time;
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-del]").forEach((el) => {
      el.onclick = () => {
        const i = +el.getAttribute("data-del");
        if (!confirm(fmtDate(rows[i].date) + " 일정을 삭제할까요?")) return;
        if (rows[i].id) deletedIds.push(rows[i].id);
        rows.splice(i, 1);
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-pf]").forEach((el) => {
      const i = +el.getAttribute("data-i");
      const pi = +el.getAttribute("data-pi");
      const f = el.getAttribute("data-pf");
      el.oninput = () => {
        rows[i].parts[pi][f] = el.value;
        if (f === "content") {
          rows[i].parts[pi].displayType = "text";
          rows[i].parts[pi].profile = null;
          const preview = document.querySelector('[data-directive-preview="' + i + "-" + pi + '"]');
          if (preview) preview.innerHTML = directivePreviewHtml(el.value, null);
        }
        markDirty();
      };
    });
    document.querySelectorAll("[data-addpart]").forEach((el) => {
      el.onclick = () => {
        const i = +el.getAttribute("data-addpart");
        rows[i].parts = rows[i].parts || [];
        rows[i].parts.push({ content: "", label: "", hidePartLabel: false, displayType: "text", profile: null, collab: false, official: false, otherChannel: false, ad: false, outdoor: false, speculative: false, members: [], hostChannel: null, notes: [] });
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-movepart]").forEach((el) => {
      el.onclick = () => {
        const [iRaw, piRaw, direction] = el.getAttribute("data-movepart").split("-");
        const i = Number(iRaw);
        const pi = Number(piRaw);
        const parts = rows[i] && rows[i].parts;
        if (!Array.isArray(parts)) return;
        const target = direction === "up" ? pi - 1 : pi + 1;
        if (target < 0 || target >= parts.length) return;
        const [moved] = parts.splice(pi, 1);
        parts.splice(target, 0, moved);
        render();
        markDirty();
      };
    });

    document.querySelectorAll("[data-delpart]").forEach((el) => {
      el.onclick = () => {
        const [i, pi] = el.getAttribute("data-delpart").split("-").map(Number);
        rows[i].parts.splice(pi, 1);
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-gif]").forEach((el) => {
      const i = +el.getAttribute("data-i");
      const gi = +el.getAttribute("data-gi");
      const f = el.getAttribute("data-gif");
      el.oninput = () => {
        rows[i].gameImages = rows[i].gameImages || [];
        rows[i].gameImages[gi] = rows[i].gameImages[gi] || { url: "", label: "" };
        const game = rows[i].gameImages[gi];
        game[f] = el.value;
        if (f === "label" && el.dataset.applyingGameCategory !== "1") {
          game.categoryId = "";
          game.categoryType = "";
          game.posterImageUrl = "";
        }
        markDirty();
      };
      if (f === "label") bindGameAutocomplete(el);

    });
    document.querySelectorAll("[data-addgameimg]").forEach((el) => {
      el.onclick = () => {
        const i = +el.getAttribute("data-addgameimg");
        rows[i].gameImages = rows[i].gameImages || [];
        rows[i].gameImages.push({ url: "", label: "", categoryId: "", categoryType: "", posterImageUrl: "" });
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-delgameimg]").forEach((el) => {
      el.onclick = () => {
        const [i, gi] = el.getAttribute("data-delgameimg").split("-").map(Number);
        rows[i].gameImages.splice(gi, 1);
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-vf]").forEach((el) => {
      const i = +el.getAttribute("data-i");
      const vi = +el.getAttribute("data-vi");
      const f = el.getAttribute("data-vf");
      el.oninput = () => {
        rows[i].vods[vi][f] = el.value;
        if (f === "label") {
          const preview = document.querySelector('[data-vod-preview="' + i + "-" + vi + '"]');
          if (preview) preview.innerHTML = directivePreviewHtml(el.value, null);
        }
        markDirty();
      };
    });
    document.querySelectorAll("[data-addvod]").forEach((el) => {
      el.onclick = () => {
        const i = +el.getAttribute("data-addvod");
        rows[i].vods = rows[i].vods || [];
        rows[i].vods.push({ url: "", label: "방송 다시보기" });
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-delvod]").forEach((el) => {
      el.onclick = () => {
        const [i, vi] = el.getAttribute("data-delvod").split("-").map(Number);
        rows[i].vods.splice(vi, 1);
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-collabtoggle]").forEach((el) => {
      el.onclick = () => {
        const [i, pi] = el.getAttribute("data-collabtoggle").split("-").map(Number);
        rows[i].parts[pi].collab = !rows[i].parts[pi].collab;
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-officialtoggle]").forEach((el) => {
      el.onclick = () => {
        const [i, pi] = el.getAttribute("data-officialtoggle").split("-").map(Number);
        rows[i].parts[pi].official = !rows[i].parts[pi].official;
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-othertoggle]").forEach((el) => {
      el.onclick = () => {
        const [i, pi] = el.getAttribute("data-othertoggle").split("-").map(Number);
        rows[i].parts[pi].otherChannel = !rows[i].parts[pi].otherChannel;
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-adtoggle]").forEach((el) => {
      el.onclick = () => {
        const [i, pi] = el.getAttribute("data-adtoggle").split("-").map(Number);
        rows[i].parts[pi].ad = !rows[i].parts[pi].ad;
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-outdoortoggle]").forEach((el) => {
      el.onclick = () => {
        const [i, pi] = el.getAttribute("data-outdoortoggle").split("-").map(Number);
        rows[i].parts[pi].outdoor = !rows[i].parts[pi].outdoor;
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-speculativetoggle]").forEach((el) => {
      el.onclick = () => {
        const [i, pi] = el.getAttribute("data-speculativetoggle").split("-").map(Number);
        rows[i].parts[pi].speculative = !rows[i].parts[pi].speculative;
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-hidepartlabeltoggle]").forEach((el) => {
      el.onclick = () => {
        const [i, pi] = el.getAttribute("data-hidepartlabeltoggle").split("-").map(Number);
        rows[i].parts[pi].hidePartLabel = !rows[i].parts[pi].hidePartLabel;
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-mdel]").forEach((el) => {
      el.onclick = () => {
        const [i, pi, channelId] = el.getAttribute("data-mdel").split("-");
        const row = rows[+i];
        row.parts[+pi].members = (row.parts[+pi].members || []).filter((m) => m.channelId !== channelId);
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-msearch]").forEach((el) => {
      const [i, pi] = el.getAttribute("data-msearch").split("-").map(Number);
      bindChannelSearchInput(el, "results-" + i + "-" + pi, (container, result, keyword) => renderMemberResults(container, result, i, pi, keyword));
    });
    document.querySelectorAll("[data-hostdel]").forEach((el) => {
      el.onclick = () => {
        const [i, pi] = el.getAttribute("data-hostdel").split("-").map(Number);
        rows[i].parts[pi].hostChannel = null;
        render();
        markDirty();
      };
    });
    document.querySelectorAll("[data-hsearch]").forEach((el) => {
      const [i, pi] = el.getAttribute("data-hsearch").split("-").map(Number);
      bindChannelSearchInput(el, "hresults-" + i + "-" + pi, (container, result, keyword) => renderHostResults(container, result, i, pi, keyword));
    });
  }

  function addRow(preferredDate) {
    // 기존에 없는 다음 날짜를 기본값으로
    const existing = new Set(rows.map((r) => r.date));
    let d = preferredDate ? new Date(preferredDate + "T00:00:00") : new Date();
    for (let k = 0; k < 60; k++) {
      const p = (n) => String(n).padStart(2, "0");
      const key = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
      if (!existing.has(key)) {
        rows.forEach((row) => { delete row._newlyAdded; });
        rows.push({ channel_id: cfg.channelId, date: key, start_time: "", title: "", parts: [], gameImages: [], vods: [], status: "", cafe_time: false, video_time: false, notes: [], _newlyAdded: true });
        selectedScheduleDate = key;
        scheduleMonthOffset = 0;
        render();
        markDirty();
        requestAnimationFrame(() => {
          const dateInput = document.querySelector("#list .card-date");
          if (dateInput) {
            dateInput.scrollIntoView({ block: "center", behavior: "smooth" });
            dateInput.focus();
          }
        });
        return;
      }
      d.setDate(d.getDate() + 1);
    }
  }

  // ---- 저장 ----
  async function doSave() {
    if (!canManage) {
      toast("저장 권한이 없습니다. admin_users에 로그인 계정 UID를 추가하세요.");
      return;
    }
    const dateCounts = {};
    rows.forEach((r) => { dateCounts[r.date] = (dateCounts[r.date] || 0) + 1; });
    const dupDate = Object.keys(dateCounts).find((d) => dateCounts[d] > 1);
    if (dupDate) {
      toast(fmtDate(dupDate) + " 날짜가 중복된 카드가 있습니다. 하나를 지우거나 날짜를 바꿔주세요.");
      return;
    }

    const btn = $("saveBtn");
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>';

    try {
      let backupWarning = "";
      try {
        await createScheduleBackup("before-save");
      } catch (backupError) {
        backupWarning = (backupError && backupError.message) || String(backupError || "");
        console.warn("Schedule backup failed", backupError);
      }

      // 1) 삭제 처리
      if (deletedIds.length) {
        const { error } = await sb.from(cfg.tableName).delete().in("id", deletedIds);
        if (error) throw error;
      }
      // 2) 저장 처리 (빈 문자열은 null로 변환, 부 목록은 컨텐츠명이 빈 항목 제외)
      // id가 있는 기존 행은 id로 update (날짜를 바꿔도 같은 행이 이동하며, 새 행이 복제되지 않음).
      // id가 없는 새 행만 upsert(insert)한다.
      for (const r of rows) {
        const parsedParts = await Promise.all((r.parts || []).map(parseDisplayDirective));
        const cleanParts = parsedParts
          .map((p) => ({
            content: (p.content || "").trim(),
            label: (p.label || "").trim(),
            hidePartLabel: !!p.hidePartLabel,
            displayType: p.displayType || "text",
            profile: p.profile || null,
            collab: !!p.collab,
            official: !!p.official,
            otherChannel: !!p.otherChannel,
            ad: !!p.ad,
            outdoor: !!p.outdoor,
            speculative: !!p.speculative,
            members: p.members || [],
            hostChannel: p.hostChannel || null,
            notes: serializeNotes(p.notes),
            autoCategory: !!p.autoCategory,
            categoryId: (p.categoryId || "").trim(),
            categoryType: (p.categoryType || "").trim(),
          }))
          .filter((p) => p.content);
        const cleanGameImages = (r.gameImages || [])
          .map((g) => ({
            url: (g.url || "").trim(),
            label: (g.label || "").trim(),
            categoryId: (g.categoryId || "").trim(),
            categoryType: (g.categoryType || "").trim(),
            posterImageUrl: (g.posterImageUrl || "").trim(),
          }))
          .filter((g) => g.label || g.url);
        const cleanVods = (r.vods || [])
          .map((v) => ({
            url: (v.url || "").trim(),
            label: (v.label || "").trim() || "방송 다시보기",
          }))
          .filter((v) => v.url);
        const payload = {
          channel_id: cfg.channelId,
          date: r.date,
          start_time: r.start_time ? r.start_time.trim() : null,
          end_time: r.end_time ? r.end_time.trim() : null,
          title: r.title ? r.title.trim() : null,
          parts: cleanParts.length ? cleanParts : null,
          game_images: cleanGameImages.length ? cleanGameImages : null,
          vods: cleanVods.length ? cleanVods : null,
          status: r.status || null,
          cafe_time: !!r.cafe_time,
          video_time: !!r.video_time,
          note: serializeNotes(r.notes),
          updated_at: new Date().toISOString(),
        };
        if (r.id) {
          const { error } = await sb.from(cfg.tableName).update(payload).eq("id", r.id);
          if (error) throw error;
        } else {
          const { error } = await sb.from(cfg.tableName).upsert(payload, { onConflict: "channel_id,date" });
          if (error) throw error;
        }
      }

      // 3) 소식 저장: 내용을 비운 기존 항목은 삭제로 취급, 화면 순서를 sort_order로 저장
      const infoTable = cfg.upcomingContentTableName;
      const infoDeleteIds = [...deletedInfoIds];
      const infoToUpdate = [];
      const infoToInsert = [];
      let order = 0;
      for (const u of info) {
        const content = (u.content || "").trim();
        const noticeMatch = content.match(/^@notice\s*:\s*([\s\S]*)$/i);
        const updateMatch = content.match(/^@update\s*:\s*([\s\S]*)$/i);
        const sectionMatch = content.match(/^@section\s*:\s*([\s\S]*)$/i);
        const structuredMatch = isStructuredInfoItem(u) ? structuredInfoData(u) : null;
        const updateData = updateMatch ? parseUpdateHistoryData(u) : null;
        const keepContent = content && (!noticeMatch || noticeMatch[1].trim()) && (!updateMatch || updateHistoryKeepContent(updateData)) && (!sectionMatch || sectionMatch[1].trim()) && (!structuredMatch || infoStructuredKeepContent(structuredMatch));
        if (u.id) {
          if (keepContent) infoToUpdate.push({ id: u.id, content, hidden: (noticeMatch || updateMatch) ? true : !!u.hidden, sort_order: order++ });
          else infoDeleteIds.push(u.id);
        } else if (keepContent) {
          infoToInsert.push({ channel_id: cfg.channelId, content, hidden: (noticeMatch || updateMatch) ? true : !!u.hidden, sort_order: order++ });
        }
      }
      if (infoDeleteIds.length) {
        const { error } = await sb.from(infoTable).delete().in("id", infoDeleteIds);
        if (error) throw error;
      }
      for (const u of infoToUpdate) {
        const { error } = await sb.from(infoTable)
          .update({ content: u.content, hidden: !!u.hidden, sort_order: u.sort_order })
          .eq("id", u.id);
        if (error) throw error;
      }
      if (infoToInsert.length) {
        const { error } = await sb.from(infoTable).insert(infoToInsert);
        if (error) throw error;
      }

      await saveAdminSettings();

      toast(backupWarning ? "\uc800\uc7a5\ub418\uc5c8\uc9c0\ub9cc \ubc31\uc5c5\uc740 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4" : "\uc800\uc7a5\ub418\uc5c8\uc2b5\ub2c8\ub2e4");
      rows.forEach((row) => { delete row._newlyAdded; });
      rows.sort(compareScheduleDate);
      await loadAll();
    } catch (e) {
      toast("저장 실패: " + (e.message || e));
      btn.disabled = false;
      btn.textContent = "저장";
    }
    btn.innerHTML = "저장";
  }

  // ---- 진입 ----
  function setActiveAdminMenu(menu) {
    activeAdminMenu = menu || "schedule";
    document.querySelectorAll("[data-admin-menu]").forEach((button) => {
      const active = button.getAttribute("data-admin-menu") === activeAdminMenu;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
    document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-admin-panel") !== activeAdminMenu;
    });
  }

  function setFeedbackDrawer(open) {
    if (open) setActiveAdminMenu("feedback");
  }

  async function enterApp() {
    loginView.classList.add("hidden");
    appView.classList.remove("hidden");
    $("channelLabel").textContent = cfg.channelName || cfg.channelId;
    await checkAdminAccess();
    loadAll();
  }
  async function init() {
    // 설정 확인
    if (cfg.supabaseUrl.includes("YOUR_PROJECT") || cfg.channelId.includes("YOUR_CHANNEL")) {
      $("loginErr").textContent = "config.js에 Supabase 정보와 채널 ID를 입력하세요.";
    }
    $("loginBtn").onclick = doLogin;
    $("password").onkeydown = (e) => { if (e.key === "Enter") doLogin(); };
    $("logoutBtn").onclick = doLogout;
    $("saveBtn").onclick = doSave;
    $("feedbackRefresh").onclick = loadFeedback;
    document.querySelectorAll("[data-admin-menu]").forEach((button) => {
      button.onclick = () => {
        const menu = button.getAttribute("data-admin-menu");
        setActiveAdminMenu(menu);
        if (menu === "feedback") loadFeedback();
      };
    });
    document.querySelectorAll("[data-feedback-filter]").forEach((button) => {
      button.onclick = () => {
        feedbackFilter = button.getAttribute("data-feedback-filter");
        document.querySelectorAll("[data-feedback-filter]").forEach((item) =>
          item.classList.toggle("active", item === button));
        renderFeedbackList();
      };
    });
    window.addEventListener("beforeunload", (e) => {
      if (snapshot() !== original) { e.preventDefault(); e.returnValue = ""; }
    });

    // 기존 세션이 있으면 바로 편집 화면으로
    const { data } = await sb.auth.getSession();
    if (data && data.session) enterApp();
  }

  init();
})();












































