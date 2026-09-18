// Sync active and completed League of Legends solo-rank matches.
// Deploy: supabase functions deploy sync-lol-match-logs
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RIOT_API_KEY, LOL_MATCH_LOG_SYNC_SECRET
// Optional env: LIVE_CATEGORY_SYNC_SECRET, reused by Supabase cron jobs

const ACCOUNT_TABLE = "lol_streamer_accounts";
const MATCH_LOG_TABLE = "lol_match_logs";
const LIVE_SESSION_STATE_TABLE = "live_session_state";
const SOLO_RANK_QUEUE_ID = 420;
const MATCH_LIST_PAGE_SIZE = 100;
const MAX_MATCH_LIST_PAGES = 10;
const MATCH_LOOKBACK_DAYS = 30;

type LiveSessionState = {
  channel_id: string;
  live_key: string | null;
  schedule_date: string | null;
  started_at: string | null;
  is_live: boolean | null;
  updated_at: string | null;
};

type StreamerAccount = {
  id: number;
  channel_id: string;
  riot_puuid: string | null;
  riot_game_name: string | null;
  riot_tag_line: string | null;
  platform_region: string | null;
  regional_routing: string | null;
  enabled: boolean | null;
  latest_tier: string | null;
  latest_rank: string | null;
  latest_league_points: number | null;
};

type LeagueEntry = {
  queueType?: string;
  tier?: string;
  rank?: string;
  leaguePoints?: number;
  wins?: number;
  losses?: number;
};

type RankSnapshot = {
  tier: string;
  rank: string;
  leaguePoints: number | null;
};

type ParticipantDto = {
  puuid?: string;
  championId?: number;
  championName?: string;
  teamPosition?: string;
  individualPosition?: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  totalDamageDealtToChampions?: number;
  teamId?: number;
  goldEarned?: number;
  visionScore?: number;
  wardsKilled?: number;
  totalMinionsKilled?: number;
  neutralMinionsKilled?: number;
  item0?: number;
  item1?: number;
  item2?: number;
  item3?: number;
  item4?: number;
  item5?: number;
  item6?: number;
  perks?: {
    styles?: Array<{
      style?: number;
      selections?: Array<{ perk?: number }>;
    }>;
  };
  win?: boolean;
};

type MatchDto = {
  metadata?: { participants?: string[] };
  info?: {
    queueId?: number;
    gameStartTimestamp?: number;
    gameEndTimestamp?: number;
    gameDuration?: number;
    participants?: ParticipantDto[];
  };
};

type ActiveGameDto = {
  gameId?: number;
  platformId?: string;
  gameQueueConfigId?: number;
  gameStartTime?: number;
  participants?: Array<{
    puuid?: string;
    championId?: number;
    perks?: { perkIds?: number[]; perkSubStyle?: number };
  }>;
};

function payloadFromActiveGame(
  account: StreamerAccount,
  puuid: string,
  session: LiveSessionState | null,
  game: ActiveGameDto | null,
) {
  if (!game || game.gameQueueConfigId !== SOLO_RANK_QUEUE_ID) return null;
  const participant = (game.participants || []).find((item) => item.puuid === puuid);
  const runeIds = (participant?.perks?.perkIds || []).filter((id) => finitePositiveInteger(id));
  if (!participant?.championId || !runeIds.length || !finitePositiveInteger(game.gameId) || !game.gameStartTime) return null;
  const matchSession = activeSessionForMatch(session, game.gameStartTime);
  return {
    channel_id: account.channel_id,
    match_id: cleanRegion(game.platformId || account.platform_region, "kr").toUpperCase() + "_" + game.gameId,
    live_key: matchSession?.live_key || null,
    schedule_date: matchSession?.schedule_date || scheduleDateFromTimestampMs(game.gameStartTime),
    queue_id: SOLO_RANK_QUEUE_ID,
    queue_label: "솔로랭크",
    game_start_at: dateFromTimestampMs(game.gameStartTime),
    game_end_at: null,
    champion_id: participant.championId,
    primary_rune_id: runeIds[0],
    secondary_style_id: finitePositiveInteger(participant.perks?.perkSubStyle),
    rune_ids: runeIds,
    win: null,
    metadata: { source: "riot-spectator-v5" },
    updated_at: new Date().toISOString(),
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function bearerToken(request: Request) {
  const value = request.headers.get("authorization") || "";
  const match = value.match(/^Bearers+(.+)$/i);
  return match ? match[1] : "";
}

function isAuthorized(
  request: Request,
  serviceRoleKey: string,
  syncSecrets: string[],
) {
  const provided = request.headers.get("x-sync-secret") || bearerToken(request);
  return !!provided &&
    (provided === serviceRoleKey ||
      syncSecrets.some((secret) => secret && provided === secret));
}

function cleanRegion(value: unknown, fallback: string) {
  const raw = String(value || "").trim().toLowerCase();
  return /^[a-z0-9-]+$/.test(raw) ? raw : fallback;
}

function timestampSeconds(value: unknown) {
  const time = value ? new Date(String(value)).getTime() : NaN;
  return Number.isFinite(time) ? Math.floor(time / 1000) : 0;
}

function dateFromTimestampMs(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return new Date(number).toISOString();
}

function scheduleDateFromTimestampMs(value: unknown, offsetHours = 9) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return new Date(number + offsetHours * 60 * 60 * 1000).toISOString().slice(
    0,
    10,
  );
}

function lookbackStartSeconds(days = MATCH_LOOKBACK_DAYS) {
  return Math.floor(
    (Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000) / 1000,
  );
}

function activeSessionForMatch(
  session: LiveSessionState | null,
  gameStartTimestamp: unknown,
) {
  if (!session || !session.live_key || !session.started_at) return null;
  const sessionStarted = timestampSeconds(session.started_at);
  const matchStarted = Math.floor(Number(gameStartTimestamp || 0) / 1000);
  if (!sessionStarted || !matchStarted || matchStarted < sessionStarted) {
    return null;
  }
  return session;
}

async function supabaseFetch(
  path: string,
  options: RequestInit,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const response = await fetch(supabaseUrl.replace(/\/+$/, "") + path, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function riotFetch(
  host: string,
  path: string,
  riotApiKey: string,
  allowNotFound = false,
) {
  const response = await fetch(`https://${host}.api.riotgames.com${path}`, {
    headers: { "X-Riot-Token": riotApiKey, Accept: "application/json" },
  });
  if (allowNotFound && response.status === 404) return null;
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Riot HTTP ${response.status} ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function loadAccounts(supabaseUrl: string, serviceRoleKey: string) {
  const query = "/rest/v1/" + ACCOUNT_TABLE +
    "?select=*&enabled=eq.true&order=channel_id.asc";
  const rows = await supabaseFetch(
    query,
    { method: "GET" },
    supabaseUrl,
    serviceRoleKey,
  ) as StreamerAccount[];
  return Array.isArray(rows)
    ? rows.filter((row) =>
      row.channel_id &&
      (row.riot_puuid || (row.riot_game_name && row.riot_tag_line))
    )
    : [];
}

async function loadActiveSession(
  channelId: string,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const query = "/rest/v1/" + LIVE_SESSION_STATE_TABLE +
    "?select=channel_id,live_key,schedule_date,started_at,is_live,updated_at&channel_id=eq." +
    encodeURIComponent(channelId) +
    "&is_live=eq.true&order=updated_at.desc&limit=1";
  const rows = await supabaseFetch(
    query,
    { method: "GET" },
    supabaseUrl,
    serviceRoleKey,
  ) as LiveSessionState[];
  return rows && rows[0] ? rows[0] : null;
}

function soloRankEntry(entries: LeagueEntry[]) {
  return (entries || []).find((entry) =>
    entry.queueType === "RANKED_SOLO_5x5"
  ) || null;
}

async function resolveAccountPuuid(
  account: StreamerAccount,
  riotApiKey: string,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const existing = String(account.riot_puuid || "").trim();
  if (existing) return existing;
  const gameName = String(account.riot_game_name || "").trim();
  const tagLine = String(account.riot_tag_line || "").trim();
  if (!gameName || !tagLine) return "";
  const regional = cleanRegion(account.regional_routing, "asia");
  const resolved = await riotFetch(
    regional,
    "/riot/account/v1/accounts/by-riot-id/" + encodeURIComponent(gameName) +
      "/" + encodeURIComponent(tagLine),
    riotApiKey,
  ) as { puuid?: string; gameName?: string; tagLine?: string } | null;
  const puuid = String((resolved && resolved.puuid) || "").trim();
  if (!puuid) return "";
  account.riot_puuid = puuid;
  await supabaseFetch(
    "/rest/v1/" + ACCOUNT_TABLE + "?id=eq." +
      encodeURIComponent(String(account.id)),
    {
      method: "PATCH",
      body: JSON.stringify({
        riot_puuid: puuid,
        riot_game_name: resolved && resolved.gameName
          ? resolved.gameName
          : gameName,
        riot_tag_line: resolved && resolved.tagLine
          ? resolved.tagLine
          : tagLine,
        updated_at: new Date().toISOString(),
      }),
    },
    supabaseUrl,
    serviceRoleKey,
  );
  return puuid;
}

async function fetchSoloRank(
  account: StreamerAccount,
  puuid: string,
  riotApiKey: string,
) {
  const platform = cleanRegion(account.platform_region, "kr");
  const entries = await riotFetch(
    platform,
    "/lol/league/v4/entries/by-puuid/" + encodeURIComponent(puuid),
    riotApiKey,
  ) as LeagueEntry[];
  return soloRankEntry(Array.isArray(entries) ? entries : []);
}

async function updateAccountRank(
  account: StreamerAccount,
  rank: LeagueEntry | null,
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  const payload: Record<string, unknown> = {
    latest_rank_updated_at: new Date().toISOString(),
    last_scanned_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (rank) {
    payload.latest_tier = rank.tier || null;
    payload.latest_rank = rank.rank || null;
    payload.latest_league_points = Number.isFinite(Number(rank.leaguePoints))
      ? Number(rank.leaguePoints)
      : null;
    payload.latest_wins = Number.isFinite(Number(rank.wins))
      ? Number(rank.wins)
      : null;
    payload.latest_losses = Number.isFinite(Number(rank.losses))
      ? Number(rank.losses)
      : null;
  }
  await supabaseFetch(
    "/rest/v1/" + ACCOUNT_TABLE + "?id=eq." +
      encodeURIComponent(String(account.id)),
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
    supabaseUrl,
    serviceRoleKey,
  );
}

async function existingMatchIds(
  channelId: string,
  ids: string[],
  supabaseUrl: string,
  serviceRoleKey: string,
) {
  if (!ids.length) return new Map<string, Record<string, unknown>>();
  const inList = "(" +
    ids.map((id) => JSON.stringify(id)).join(",") + ")";
  const query = "/rest/v1/" + MATCH_LOG_TABLE +
    "?select=match_id,lp_before,lp_after,lp_delta,tier_before,rank_before,tier_after,rank_after,metadata&channel_id=eq." + encodeURIComponent(channelId) +
    "&win=not.is.null" +
    "&match_id=in." + encodeURIComponent(inList);
  const rows = await supabaseFetch(
    query,
    { method: "GET" },
    supabaseUrl,
    serviceRoleKey,
  ) as Array<Record<string, unknown>>;
  return new Map(
    (rows || []).filter((row) => row.match_id).map((row) => [String(row.match_id), row] as [string, Record<string, unknown>]),
  );
}

async function fetchSoloRankMatchIds(
  regional: string,
  puuid: string,
  startTime: number,
  riotApiKey: string,
) {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_MATCH_LIST_PAGES; page += 1) {
    const start = page * MATCH_LIST_PAGE_SIZE;
    const idsPath = "/lol/match/v5/matches/by-puuid/" +
      encodeURIComponent(puuid) +
      "/ids?queue=" + SOLO_RANK_QUEUE_ID + "&start=" + start + "&count=" +
      MATCH_LIST_PAGE_SIZE + (startTime ? "&startTime=" + startTime : "");
    const matchIds = await riotFetch(
      regional,
      idsPath,
      riotApiKey,
    ) as string[];
    const pageIds = Array.isArray(matchIds)
      ? matchIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    for (const id of pageIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (pageIds.length < MATCH_LIST_PAGE_SIZE) break;
  }
  return ids;
}

function rankSnapshotFromAccount(account: StreamerAccount): RankSnapshot {
  const leaguePoints = account.latest_league_points == null ? NaN : Number(account.latest_league_points);
  return {
    tier: String(account.latest_tier || "").trim().toUpperCase(),
    rank: String(account.latest_rank || "").trim().toUpperCase(),
    leaguePoints: Number.isFinite(leaguePoints) ? leaguePoints : null,
  };
}

function lpDeltaFromSnapshots(
  before: RankSnapshot | null,
  after: LeagueEntry | null,
) {
  if (!before || before.leaguePoints === null || !after) {
    return { lpBefore: null, lpDelta: null };
  }
  const afterTier = String(after.tier || "").trim().toUpperCase();
  const afterRank = String(after.rank || "").trim().toUpperCase();
  const afterLp = Number(after.leaguePoints);
  if (
    !afterTier || before.tier !== afterTier || before.rank !== afterRank ||
    !Number.isFinite(afterLp)
  ) {
    return { lpBefore: before.leaguePoints, lpDelta: null };
  }
  return {
    lpBefore: before.leaguePoints,
    lpDelta: afterLp - before.leaguePoints,
  };
}

function finitePositiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function itemIdsFromParticipant(participant: ParticipantDto) {
  return [
    participant.item0,
    participant.item1,
    participant.item2,
    participant.item3,
    participant.item4,
    participant.item5,
    participant.item6,
  ].map(finitePositiveInteger).filter((value): value is number =>
    value !== null
  );
}

function runeInfoFromParticipant(participant: ParticipantDto) {
  const styles = Array.isArray(participant.perks?.styles)
    ? participant.perks.styles
    : [];
  const primaryStyle = styles[0] || null;
  const secondaryStyle = styles[1] || null;
  const runeIds = styles.flatMap((style) =>
    (Array.isArray(style.selections) ? style.selections : [])
      .map((selection) => finitePositiveInteger(selection.perk))
      .filter((value): value is number => value !== null)
  );
  return {
    primaryRuneId: finitePositiveInteger(primaryStyle?.selections?.[0]?.perk),
    secondaryStyleId: finitePositiveInteger(secondaryStyle?.style),
    runeIds,
  };
}

function payloadFromMatch(
  account: StreamerAccount,
  puuid: string,
  session: LiveSessionState | null,
  matchId: string,
  match: MatchDto,
  rank: LeagueEntry | null,
  beforeRank: RankSnapshot | null,
) {
  const info = match.info || {};
  if (info.queueId !== SOLO_RANK_QUEUE_ID) return null;
  const participant = (info.participants || []).find((item) =>
    item.puuid === puuid
  );
  if (!participant) return null;
  const startAt = dateFromTimestampMs(info.gameStartTimestamp);
  const gameDurationSeconds = Number(info.gameDuration || 0);
  const endAt = dateFromTimestampMs(
    info.gameEndTimestamp ||
      (Number(info.gameStartTimestamp || 0) +
        gameDurationSeconds * 1000),
  );
  const totalCs = Number(participant.totalMinionsKilled || 0) +
    Number(participant.neutralMinionsKilled || 0);
  const participantDamage = Number(participant.totalDamageDealtToChampions);
  const damageToChampions = Number.isFinite(participantDamage)
    ? participantDamage
    : null;
  const teamId = Number(participant.teamId);
  const teamParticipants = Number.isFinite(teamId)
    ? (info.participants || []).filter((item) => Number(item.teamId) === teamId)
    : [];
  const teamDamageToChampions = teamParticipants.length
    ? teamParticipants.reduce((sum, item) => {
      const damage = Number(item.totalDamageDealtToChampions);
      return sum + (Number.isFinite(damage) ? damage : 0);
    }, 0)
    : null;
  const teamKills = teamParticipants.length
    ? teamParticipants.reduce((sum, item) => {
      const kills = Number(item.kills);
      return sum + (Number.isFinite(kills) ? kills : 0);
    }, 0)
    : null;
  const goldEarned = Number(participant.goldEarned);
  const visionScore = Number(participant.visionScore);
  const wardsKilled = Number(participant.wardsKilled);
  const csPerMinute = gameDurationSeconds > 0
    ? Math.round((totalCs / (gameDurationSeconds / 60)) * 10) / 10
    : null;
  const goldPerMinute = gameDurationSeconds > 0 && Number.isFinite(goldEarned)
    ? Math.round((goldEarned / (gameDurationSeconds / 60)) * 10) / 10
    : null;
  const teamDamageShare = damageToChampions !== null &&
      teamDamageToChampions !== null && teamDamageToChampions > 0
    ? Math.round((damageToChampions / teamDamageToChampions) * 1000) / 10
    : null;
  const killParticipation = teamKills !== null && teamKills > 0
    ? Math.round(
      ((Number(participant.kills || 0) + Number(participant.assists || 0)) /
        teamKills) * 1000,
    ) / 10
    : null;
  const visionScorePerMinute =
    gameDurationSeconds > 0 && Number.isFinite(visionScore)
      ? Math.round((visionScore / (gameDurationSeconds / 60)) * 10) / 10
      : null;
  const matchSession = activeSessionForMatch(session, info.gameStartTimestamp);
  const scheduleDate = matchSession && matchSession.schedule_date
    ? matchSession.schedule_date
    : scheduleDateFromTimestampMs(info.gameStartTimestamp);
  if (!scheduleDate) return null;
  const lpChange = lpDeltaFromSnapshots(beforeRank, rank);
  const runeInfo = runeInfoFromParticipant(participant);
  const itemIds = itemIdsFromParticipant(participant);
  return {
    channel_id: account.channel_id,
    live_key: matchSession && matchSession.live_key
      ? matchSession.live_key
      : null,
    schedule_date: scheduleDate,
    match_id: matchId,
    queue_id: SOLO_RANK_QUEUE_ID,
    queue_label: "\uC194\uB85C\uB7AD\uD06C",
    game_start_at: startAt || null,
    game_end_at: endAt || null,
    team_position: participant.teamPosition || participant.individualPosition ||
      null,
    champion_name: participant.championName || null,
    champion_id: participant.championId || null,
    kills: participant.kills || 0,
    deaths: participant.deaths || 0,
    assists: participant.assists || 0,
    damage_to_champions: damageToChampions,
    total_cs: totalCs,
    cs_per_minute: csPerMinute,
    team_id: Number.isFinite(teamId) ? teamId : null,
    gold_earned: Number.isFinite(goldEarned) ? goldEarned : null,
    gold_per_minute: goldPerMinute,
    team_damage_to_champions: teamDamageToChampions,
    team_damage_share: teamDamageShare,
    team_kills: teamKills,
    kill_participation: killParticipation,
    vision_score: Number.isFinite(visionScore) ? visionScore : null,
    vision_score_per_minute: visionScorePerMinute,
    wards_killed: Number.isFinite(wardsKilled) ? wardsKilled : null,
    primary_rune_id: runeInfo.primaryRuneId,
    secondary_style_id: runeInfo.secondaryStyleId,
    rune_ids: runeInfo.runeIds,
    item_ids: itemIds,
    game_duration_seconds:
      Number.isFinite(gameDurationSeconds) && gameDurationSeconds > 0
        ? gameDurationSeconds
        : null,
    win: typeof participant.win === "boolean" ? participant.win : null,
    lp_before: lpChange.lpBefore,
    lp_after: rank && Number.isFinite(Number(rank.leaguePoints))
      ? Number(rank.leaguePoints)
      : null,
    lp_delta: lpChange.lpDelta,
    tier_before: beforeRank && beforeRank.tier ? beforeRank.tier : null,
    rank_before: beforeRank && beforeRank.rank ? beforeRank.rank : null,
    tier_after: rank && rank.tier ? rank.tier : null,
    rank_after: rank && rank.rank ? rank.rank : null,
    metadata: {
      source: "riot-match-v5",
      liveCaptured: !!(matchSession && matchSession.live_key),
      riotGameName: account.riot_game_name || null,
      riotTagLine: account.riot_tag_line || null,
    },
    updated_at: new Date().toISOString(),
  };
}

function preserveMatchRank(
  payload: NonNullable<ReturnType<typeof payloadFromMatch>>,
  existing: Record<string, unknown> | undefined,
  capturedAt: string,
) {
  const metadata = (existing?.metadata || {}) as Record<string, unknown>;
  const fields = ["lp_before", "lp_after", "lp_delta", "tier_before", "rank_before", "tier_after", "rank_after"] as const;
  if (existing) {
    // Only marked snapshots are trustworthy; legacy ranks were overwritten.
    for (const field of fields) {
      (payload as Record<string, unknown>)[field] = metadata.rankCapturedAt ? existing[field] ?? null : null;
    }
  }
  Object.assign(payload.metadata, {
    rankCapturedAt: existing ? metadata.rankCapturedAt || null : payload.tier_after ? capturedAt : null,
  });
}

async function scanAccount(
  account: StreamerAccount,
  env: { supabaseUrl: string; serviceRoleKey: string; riotApiKey: string },
) {
  const session = await loadActiveSession(
    account.channel_id,
    env.supabaseUrl,
    env.serviceRoleKey,
  );

  const platform = cleanRegion(account.platform_region, "kr");
  const regional = cleanRegion(account.regional_routing, "asia");
  const puuid = await resolveAccountPuuid(
    account,
    env.riotApiKey,
    env.supabaseUrl,
    env.serviceRoleKey,
  );
  if (!puuid) {
    return {
      channelId: account.channel_id,
      inserted: 0,
      skipped: "missing-puuid",
    };
  }
  // A spectator failure must not prevent completed match collection.
  let activeGameError: string | null = null;
  try {
    const game = await riotFetch(platform,
      "/lol/spectator/v5/active-games/by-summoner/" + encodeURIComponent(puuid),
      env.riotApiKey, true) as ActiveGameDto | null;
    const activePayload = payloadFromActiveGame(account, puuid, session, game);
    if (activePayload) {
      await supabaseFetch(
        "/rest/v1/" + MATCH_LOG_TABLE + "?on_conflict=channel_id,match_id",
        {
          method: "POST",
          // Never overwrite a completed record with a stale spectator response.
          headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
          body: JSON.stringify(activePayload),
        }, env.supabaseUrl, env.serviceRoleKey,
      );
    }
  } catch (error) {
    activeGameError = String((error as Error).message || error);
    console.error("lol active game scan failed", account.channel_id, error);
  }
  const beforeRankSnapshot = rankSnapshotFromAccount(account);
  const rank = await fetchSoloRank(account, puuid, env.riotApiKey);
  const rankCapturedAt = new Date().toISOString();
  await updateAccountRank(account, rank, env.supabaseUrl, env.serviceRoleKey);

  const startTime = lookbackStartSeconds();
  const ids = await fetchSoloRankMatchIds(
    regional,
    puuid,
    startTime,
    env.riotApiKey,
  );
  const existing = await existingMatchIds(
    account.channel_id,
    ids,
    env.supabaseUrl,
    env.serviceRoleKey,
  );
  const newIds = ids.filter((matchId) => !existing.has(matchId));
  const beforeRank = newIds.length === 1 ? beforeRankSnapshot : null;
  let inserted = 0;
  let updated = 0;

  for (const matchId of ids) {
    const match = await riotFetch(
      regional,
      "/lol/match/v5/matches/" + encodeURIComponent(matchId),
      env.riotApiKey,
    ) as MatchDto;
    const payload = payloadFromMatch(
      account,
      puuid,
      session,
      matchId,
      match,
      !existing.has(matchId) && matchId === ids[0] ? rank : null,
      !existing.has(matchId) && matchId === ids[0] ? beforeRank : null,
    );
    if (!payload) continue;
    preserveMatchRank(payload, existing.get(matchId), rankCapturedAt);
    await supabaseFetch(
      "/rest/v1/" + MATCH_LOG_TABLE + "?on_conflict=channel_id,match_id",
      {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(payload),
      },
      env.supabaseUrl,
      env.serviceRoleKey,
    );
    if (existing.has(matchId)) updated += 1;
    else inserted += 1;
  }

  return {
    channelId: account.channel_id,
    inserted,
    updated,
    checked: ids.length,
    activeGameError,
    lookbackDays: MATCH_LOOKBACK_DAYS,
    pagesLimit: MAX_MATCH_LIST_PAGES,
    live: !!(session && session.live_key),
    platform,
    regional,
  };
}

Deno.serve(async (request) => {
  if (!["GET", "POST"].includes(request.method)) {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const riotApiKey = Deno.env.get("RIOT_API_KEY");
  const syncSecrets = [
    Deno.env.get("LOL_MATCH_LOG_SYNC_SECRET") || "",
    Deno.env.get("LIVE_CATEGORY_SYNC_SECRET") || "",
  ].filter(Boolean);
  if (!supabaseUrl || !serviceRoleKey || !riotApiKey || !syncSecrets.length) {
    return jsonResponse({ error: "Missing server configuration" }, 500);
  }
  if (!isAuthorized(request, serviceRoleKey, syncSecrets)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const accounts = await loadAccounts(supabaseUrl, serviceRoleKey);
    const results = [];
    for (const account of accounts) {
      try {
        results.push(
          await scanAccount(account, {
            supabaseUrl,
            serviceRoleKey,
            riotApiKey,
          }),
        );
      } catch (error) {
        console.error("lol account scan failed", account.channel_id, error);
        results.push({
          channelId: account.channel_id,
          inserted: 0,
          error: String((error && (error as Error).message) || error),
        });
      }
    }
    return jsonResponse({
      ok: true,
      queueId: SOLO_RANK_QUEUE_ID,
      accounts: accounts.length,
      results,
    });
  } catch (error) {
    console.error("lol match log sync failed", error);
    return jsonResponse({ error: "Sync failed" }, 502);
  }
});
