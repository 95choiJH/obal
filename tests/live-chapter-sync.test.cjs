const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const source = stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,
  '../supabase/functions/sync-live-category/index.ts'), 'utf8'));
const observedAt = '2026-09-14T12:00:05.000Z';
const category = { label: 'Game', categoryId: 'game', categoryType: 'GAME', posterImageUrl: '' };
const live = { live: true, date: '2026-09-14', liveKey: 'session',
  startedAt: '2026-09-14T12:00:00Z', title: 'Title', category, observedAt };

function harness(overrides = {}, extra = {}) {
  let handler;
  const context = vm.createContext({ Request, Response, URL, console, ...extra,
    Deno: { env: { get: key => ({ SUPABASE_URL: 'https://db.example',
      SUPABASE_SERVICE_ROLE_KEY: 'service', LIVE_CATEGORY_SYNC_SECRET: 'secret' })[key] },
      serve: callback => { handler = callback; } },
  });
  vm.runInContext(source, context);
  context.overrides = overrides;
  for (const key of Object.keys(overrides)) vm.runInContext(`${key} = overrides.${key}`, context);
  return { context, request: mode => handler(new Request(`https://example.test/?mode=${mode}`, {
    method: 'POST', headers: { 'x-sync-secret': 'secret' }, body: '{}',
  })) };
}

test('chapters mode records the observation without replay or schedule work', async () => {
  const calls = [];
  const forbidden = async () => { throw new Error('Heavy work in chapter collector'); };
  const h = harness({
    currentLiveCategory: async () => live,
    resolveLiveSession: async () => ({ date: live.date, liveKey: live.liveKey }),
    safeRecordLiveCategoryChange: async (...args) => {
      assert.equal(args[8], observedAt); calls.push('chapter'); return { recorded: true };
    },
    safeRecordLiveTitleChange: async () => { calls.push('title'); return { recorded: true }; },
    loadAutoLiveCategorySyncEnabled: forbidden,
    loadPendingVodSessions: forbidden, syncRecentReplayVodsToSchedule: forbidden,
    syncCategoriesToSchedule: forbidden,
  });
  const response = await h.request('chapters');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).categoryHistory.recorded, true);
  assert.deepEqual(calls, ['chapter', 'title']);
});

test('offline collector marks the session ended without looking up replays', async () => {
  let ended = false;
  const h = harness({
    currentLiveCategory: async () => ({ ...live, live: false }),
    markLiveSessionEndedIfNeeded: async () => { ended = true; return { updated: true }; },
    loadPendingVodSessions: async () => { throw new Error('Unexpected replay request'); },
  });
  const response = await h.request('chapters');
  assert.equal(response.status, 200);
  assert.equal(ended, true);
  assert.equal((await response.json()).categoryHistory.reason, 'not-live');
});

test('maintenance discovers replays and syncs the schedule without changing live history', async () => {
  const calls = [];
  const forbidden = async () => { throw new Error('Maintenance mutated live history'); };
  const h = harness({
    loadAutoLiveCategorySyncEnabled: async () => ({ enabled: true }),
    currentLiveCategory: async () => live,
    loadLiveSessionStateByKey: async () => ({ schedule_date: '2026-09-13', live_key: 'session' }),
    resolveLiveSession: forbidden, markLiveSessionEndedIfNeeded: forbidden,
    safeRecordLiveCategoryChange: forbidden, safeRecordLiveTitleChange: forbidden,
    loadPendingVodSessions: async () => [],
    syncRecentReplayVodsToSchedule: async () => { calls.push('replays'); return []; },
    syncCategoriesToSchedule: async (_channel, date) => {
      assert.equal(date, '2026-09-13'); calls.push('schedule'); return { synced: true };
    },
  });
  const response = await h.request('maintenance');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).synced, true);
  assert.deepEqual(calls, ['replays', 'schedule']);
});

test('chapter offset uses observation time even if saving is delayed', async () => {
  let payload;
  const h = harness({ supabaseFetch: async (route, options) => {
    assert.equal(route, '/rest/v1/rpc/record_live_chapter_observation');
    payload = JSON.parse(options.body).observation;
    return { recorded: true, offsetSeconds: payload.offset_seconds };
  } });
  const result = await h.context.recordLiveCategoryChange('channel', live.date, live.liveKey,
    live.startedAt, category, 9, 'https://db.example', 'service', observedAt);
  assert.equal(payload.changed_at, observedAt);
  assert.equal(payload.offset_seconds, 5);
  assert.equal(result.offsetSeconds, 5);
});

test('observation timestamp precedes a slow category metadata response', async () => {
  let clock = Date.parse(observedAt);
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const h = harness({ fetchJson: async url => {
    if (url.includes('/live-status')) return { content: { status: 'OPEN',
      liveCategoryValue: 'Game', liveCategory: 'game', categoryType: 'GAME',
      openDate: live.startedAt, liveId: 'session' } };
    clock += 15000;
    return { content: { categoryValue: 'Game', posterImageUrl: 'https://image.test/game.png' } };
  } }, { Date: Clock });
  const result = await h.context.currentLiveCategory('channel', 9);
  assert.equal(result.observedAt, observedAt);
  assert.equal(result.category.posterImageUrl, 'https://image.test/game.png');
});

test('invalid collection mode is rejected', async () => {
  assert.equal((await harness().request('invalid')).status, 400);
});


test('recent replay backfill uses continued live session schedule date', async () => {
  const calls = [];
  const h = harness({
    fetchLatestReplayVideos: async () => [{ videoNo: '100', publishDateAt: '2026-09-05T01:00:00Z' }],
    fetchVideoDetail: async () => ({ liveOpenDate: '2026-09-05 00:10:00' }),
    loadRecentLiveSessionStates: async () => [{
      channel_id: 'channel', live_key: 'continued', schedule_date: '2026-09-04',
      started_at: '2026-09-05 00:10:00', last_seen_at: null, ended_at: null,
      title: null, vod_url: null, vod_video_no: null, vod_saved_at: null,
      vod_checked_at: null, is_live: false, updated_at: null,
    }],
    supabaseFetch: async (route, options) => {
      calls.push({ route, method: options.method, body: options.body ? JSON.parse(options.body) : null });
      if (route.includes('/rest/v1/schedule?select=id,date,vods')) return [];
      if (route.includes('date=eq.2026-09-04')) return [{ id: 1, vods: [] }];
      if (route.includes('/rest/v1/schedule?id=eq.1')) return [{ id: 1 }];
      throw new Error('Unexpected route ' + route);
    },
  }, { Date: class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-09-05T02:00:00Z'])); }
    static now() { return Date.parse('2026-09-05T02:00:00Z'); }
  } });

  const result = await h.context.syncRecentReplayVodsToSchedule('channel', 9, 'https://db.example', 'service');
  assert.equal(result[0].synced, true);
  assert.equal(result[0].date, '2026-09-04');
  assert.ok(calls.some(call => call.route.includes('date=eq.2026-09-04')));
  assert.ok(!calls.some(call => call.route.includes('date=eq.2026-09-05')));
});

test('recent replay append skips vod already saved on another schedule date', async () => {
  const calls = [];
  const h = harness({
    supabaseFetch: async (route, options) => {
      calls.push({ route, method: options.method });
      if (route.includes('/rest/v1/schedule?select=id,date,vods')) {
        return [{ id: 2, date: '2026-09-05', vods: [{ url: 'https://chzzk.naver.com/video/100', label: '방송 다시보기' }] }];
      }
      throw new Error('Unexpected write ' + route);
    },
  });

  const result = await h.context.appendReplayVodToSchedule('channel', '2026-09-04', {
    videoNo: '100', url: 'https://chzzk.naver.com/video/100/', startedAt: '2026-09-05 00:10:00',
  }, 'https://db.example', 'service');
  assert.equal(result.synced, false);
  assert.equal(result.reason, 'already-present');
  assert.equal(result.date, '2026-09-05');
  assert.equal(calls.length, 1);
});
