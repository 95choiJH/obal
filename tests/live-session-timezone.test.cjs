const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

test('session writes UTC instants for Korean starts and matches replay after DB round trip', async () => {
  const writes = [];
  const context = vm.createContext({ console, Deno: { serve() {} } });
  vm.runInContext(stripTypeScriptTypes(fs.readFileSync(
    'supabase/functions/sync-live-category/index.ts', 'utf8')), context);
  context.loadLiveSessionStateByKey = async () => null;
  context.loadLatestLiveSessionState = async () => null;
  context.supabaseFetch = async (url, init) => { writes.push(JSON.parse(init.body)); };
  for (const start of ['2026-10-16 20:30:12', '2026-10-16T20:30:12+09:00', '2026-10-16T11:30:12Z']) {
    await context.resolveLiveSession('channel', '2026-10-16', '2026-10-16 20:30:12', start, 'title', 9, 'db', 'key');
    const saved = writes.at(-1);
    assert.equal(saved.started_at, '2026-10-16T11:30:12.000Z');
    assert.equal(saved.schedule_date, '2026-10-16');
    assert.equal(saved.live_key, '2026-10-16 20:30:12');
    const roundTrip = { ...saved, started_at: '2026-10-16T11:30:12+00:00' };
    assert.equal(context.videoMatchesEndedSession({ liveOpenDate: '2026-10-16 20:30:12' }, roundTrip, 9), true);
    assert.equal(context.sessionMatchesReplayStart(roundTrip, '2026-10-16 20:30:12', 9), true);
    assert.equal(context.videoMatchesEndedSession({ liveOpenDate: '2026-10-16 21:30:12' }, roundTrip, 9), false);
  }
});

test('future broadcasts register replays after publication across Korean date boundaries', async () => {
  for (const [start, date] of [
    ['2026-10-17 20:30:12', '2026-10-17'],
    ['2026-10-19 01:30:00', '2026-10-18'],
    ['2026-10-19 02:00:00', '2026-10-19'],
    ['2027-01-01 00:30:00', '2026-12-31'],
  ]) {
    const context = vm.createContext({ console, Deno: { serve() {} } });
    vm.runInContext(stripTypeScriptTypes(fs.readFileSync(
      'supabase/functions/sync-live-category/index.ts', 'utf8')), context);
    let session = null;
    let schedule = { id: 200, date, vods: [] };
    context.loadLiveSessionStateByKey = async () => session;
    context.loadLatestLiveSessionState = async () => session;
    context.supabaseFetch = async (url, init) => {
      if (url.includes('/live_session_state')) {
        session = { id: 100, ...session, ...JSON.parse(init.body) };
        return [];
      }
      if (init.method === 'GET') {
        assert.ok(url.includes('date=eq.' + date));
        return [schedule];
      }
      schedule = { ...schedule, ...JSON.parse(init.body) };
      return [];
    };
    const actualDate = context.scheduleDateFromLiveStart(start, 9);
    assert.equal(actualDate, date);
    await context.resolveLiveSession('channel', actualDate, start, start, 'future broadcast', 9, 'db', 'key');
    session = { ...session, is_live: false, ended_at: new Date(Date.parse(session.started_at) + 3600000).toISOString() };
    let published = false;
    context.fetchLatestReplayVideos = async () => published ? [{ videoNo: '999' }] : [];
    context.fetchVideoDetail = async () => ({ liveOpenDate: start });
    const pending = await context.syncReplayVodToSchedule('channel', session, 9, 'db', 'key');
    assert.equal(pending.reason, 'vod-not-ready');
    assert.equal(schedule.vods.length, 0);
    published = true;
    const result = await context.syncReplayVodToSchedule('channel', session, 9, 'db', 'key');
    assert.equal(result.reason, 'added');
    assert.equal(result.date, date);
    assert.equal(schedule.vods.length, 1);
    assert.equal(schedule.vods[0].url, 'https://chzzk.naver.com/video/999');
    assert.equal(schedule.vods[0].startedAt, session.started_at);
    assert.ok(session.vod_saved_at);
    const repeated = await context.syncReplayVodToSchedule('channel', session, 9, 'db', 'key');
    assert.equal(repeated.reason, 'already-saved');
    assert.equal(schedule.vods.length, 1);
  }
});
