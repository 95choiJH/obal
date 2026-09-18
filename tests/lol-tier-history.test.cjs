const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync('supabase/functions/sync-lol-match-logs/index.ts', 'utf8');
function server() {
  const ctx = vm.createContext({ console, Deno: { serve() {} } });
  vm.runInContext(stripTypeScriptTypes(source), ctx);
  return ctx;
}
test('rescanning preserves captured rank and clears unreliable legacy rank', () => {
  const ctx = server();
  const old = { tier_after: 'GOLD', rank_after: 'II', lp_after: 35, metadata: { rankCapturedAt: '2026-09-18T01:00:00Z' } };
  const payload = { tier_after: 'DIAMOND', lp_after: 90, metadata: {} };
  ctx.preserveMatchRank(payload, old, '2026-09-18T02:00:00Z');
  assert.equal(payload.tier_after, 'GOLD');
  assert.equal(payload.lp_after, 35);
  assert.equal(payload.metadata.rankCapturedAt, old.metadata.rankCapturedAt);
  ctx.preserveMatchRank(payload, { ...old, metadata: {} }, '2026-09-18T03:00:00Z');
  assert.equal(payload.tier_after, null);
  assert.equal(payload.lp_after, null);
  assert.equal(payload.metadata.rankCapturedAt, null);
  assert.equal(ctx.rankSnapshotFromAccount({ latest_league_points: null }).leaguePoints, null);
});
test('batch import captures only newest match and preserves it on next scan', async () => {
  const ctx = server();
  let currentLp = 35;
  const rows = new Map();
  Object.assign(ctx, {
    loadActiveSession: async () => null,
    resolveAccountPuuid: async () => 'player',
    fetchSoloRank: async () => ({ tier: 'GOLD', rank: 'II', leaguePoints: currentLp }),
    updateAccountRank: async () => {},
    fetchSoloRankMatchIds: async () => ['newest', 'oldest'],
    existingMatchIds: async () => rows,
    riotFetch: async (_region, path) => path.includes('spectator') ? null : {
      info: { queueId: 420, gameStartTimestamp: Date.now() - 3600000, gameDuration: 1800,
        participants: [{ puuid: 'player', win: true }] }
    },
    supabaseFetch: async (_path, options) => {
      const row = JSON.parse(options.body);
      rows.set(row.match_id, row);
      return [];
    }
  });
  await ctx.scanAccount({ channel_id: 'channel', latest_tier: 'GOLD', latest_rank: 'II', latest_league_points: 10 }, {});
  assert.equal(rows.get('newest').lp_after, 35);
  assert.ok(rows.get('newest').metadata.rankCapturedAt);
  assert.equal(rows.get('oldest').lp_after, null);
  const capturedAt = rows.get('newest').metadata.rankCapturedAt;
  currentLp = 80;
  await ctx.scanAccount({ channel_id: 'channel' }, {});
  assert.equal(rows.get('newest').lp_after, 35);
  assert.equal(rows.get('newest').metadata.rankCapturedAt, capturedAt);
  assert.equal(rows.get('oldest').lp_after, null);
});
test('graph excludes legacy values and orders captured rank snapshots', () => {
  const client = fs.readFileSync('content.js', 'utf8');
  const ctx = vm.createContext({});
  for (const name of ['lolTierScore', 'lolTierShortLabel', 'lolTierTrendPoints']) {
    const body = client.slice(client.indexOf('  function ' + name + '('));
    const end = /\r?\n  }\r?\n/.exec(body);
    vm.runInContext(body.slice(0, end.index + end[0].length), ctx);
  }
  const points = ctx.lolTierTrendPoints([
    { tierAfter: 'GOLD', rankAfter: 'II', lpAfter: 80, rankCapturedAt: '2026-09-18T02:00:00Z' },
    { tierAfter: 'GOLD', rankAfter: 'II', lpAfter: 999 },
    { tierAfter: 'GOLD', rankAfter: 'II', lpAfter: 35, rankCapturedAt: '2026-09-18T01:00:00Z' }
  ]);
  assert.equal(points.length, 2);
  assert.equal(points[1].score - points[0].score, 45);
});
