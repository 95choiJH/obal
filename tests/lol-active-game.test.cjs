const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const server = fs.readFileSync(require('node:path').join(__dirname, '../supabase/functions/sync-lol-match-logs/index.ts'), 'utf8');
const context = vm.createContext({ console, Deno: { serve() {} } });
vm.runInContext(stripTypeScriptTypes(server), context);
const account = { channel_id: 'channel', platform_region: 'kr' };
const game = { gameId: 123, platformId: 'KR', gameQueueConfigId: 420,
  gameStartTime: Date.parse('2026-09-16T12:00:00Z'),
  participants: [{ puuid: 'player', championId: 103, perks: { perkIds: [8112, 8139], perkSubStyle: 8200 } }] };

test('active game records champion and runes without a result', () => {
  const row = context.payloadFromActiveGame(account, 'player', null, game);
  assert.equal(row.match_id, 'KR_123');
  assert.equal(row.champion_id, 103);
  assert.equal(row.primary_rune_id, 8112);
  assert.equal(row.secondary_style_id, 8200);
  assert.equal(row.win, null);
  assert.equal(row.game_end_at, null);
  assert.equal(row.schedule_date, '2026-09-16');
});

test('missing game, player, runes or unsupported queue creates no pending record', () => {
  for (const value of [null, { ...game, participants: [] }, { ...game, gameQueueConfigId: 450 },
    { ...game, participants: [{ puuid: 'player', championId: 103 }] }]) {
    assert.equal(context.payloadFromActiveGame(account, 'player', null, value), null);
  }
});

test('completed match uses the same record key and replaces pending fields', () => {
  const pending = context.payloadFromActiveGame(account, 'player', null, game);
  const row = context.payloadFromMatch(account, 'player', null, pending.match_id,
    { info: { queueId: 420, gameStartTimestamp: game.gameStartTime, gameDuration: 1800,
      participants: [{ puuid: 'player', championId: 103, win: true, kills: 5, deaths: 2, assists: 8 }] } }, null, null);
  assert.equal(row.match_id, pending.match_id);
  assert.equal(row.win, true);
  assert.ok(row.game_end_at);
  assert.equal(row.kills, 5);
});

const client = fs.readFileSync(require('node:path').join(__dirname, '../content.js'), 'utf8');
function clientFunction(name) {
  const start = client.indexOf('  function ' + name + '(');
  const body = client.slice(start);
  const end = /\r?\n  }\r?\n/.exec(body);
  return body.slice(0, end.index + end[0].length);
}
const ui = vm.createContext({ state: { data: {}, channelId: 'channel' } });
for (const name of ['LOL_CHAMPION_NAMES_KO', 'LOL_RUNE_NAMES_KO']) {
  vm.runInContext(client.match(new RegExp('  const ' + name + ' = .*;'))[0], ui);
}
for (const name of ['lolChampionPortraitUrl', 'lolMatchInProgress', 'lolRecentSummaryHtml']) {
  vm.runInContext(clientFunction(name), ui);
}

test('pending UI requires champion and runes and clears when result arrives', () => {
  const item = { championId: 103, primaryRuneId: 8112, win: null };
  assert.equal(ui.lolMatchInProgress(item), true);
  assert.equal(ui.lolMatchInProgress({ ...item, primaryRuneId: null }), false);
  assert.equal(ui.lolMatchInProgress({ ...item, win: false }), false);
  assert.equal(ui.lolMatchInProgress({ ...item, gameEndAt: '2026-09-16T12:30:00Z' }), false);
});

test('summary excludes the active game before computing statistics', () => {
  let received;
  ui.lolRecentDaysMatchLogs = logs => { received = logs; return logs; };
  assert.equal(ui.lolRecentSummaryHtml([{ championId: 103, primaryRuneId: 8112, win: null }]), '');
  assert.equal(received.length, 0);
});

test('active row keeps portrait and runes while missing data uses skeletons', () => {
  for (const name of ['lolChampionName', 'lolRuneSlotHtml', 'lolMatchTimeLabel', 'lolMatchVisualHtml', 'lolPositionLabel', 'lolPositionIconSvg',
    'lolQueueLabel', 'lolLoadoutHtml', 'lolCoreStatsHtml', 'lolSupportPosition', 'lolMatchLogHtml']) {
    vm.runInContext(clientFunction(name), ui);
  }
  Object.assign(ui, {
    escapeHtml: value => String(value),
    lolRuneIconUrl: id => id ? 'rune/' + id : '',
    lolDamageCap: () => 1,
    lolMatchDateLabel: value => value,
    lolRecentMatchLogs: () => [{ scheduleDate: '2026-09-16', championId: 103, primaryRuneId: 8112, secondaryStyleId: 8200, win: null }],
  });
  const html = ui.lolMatchLogHtml();
  assert.match(html, /champion\/103\/square/);
  assert.match(html, /rune\/8112/);
  assert.match(html, /rune\/8200/);
  assert.match(html, /아리/);
  assert.match(html, /role="tooltip">감전/);
  assert.match(html, /role="tooltip">마법/);
  assert.doesNotMatch(ui.lolMatchVisualHtml({ championId: 103, championName: 'Ahri' }), /title=/);
  assert.equal(ui.lolChampionName({ championName: 'Ahri' }), '아리');
  assert.equal(ui.lolQueueLabel({ queueId: 420, queueLabel: '솔로랭크' }), '랭크');
  assert.match(html, /cs-lol-position-icon cs-lol-skeleton/);
  assert.match(html, /aria-busy="true"/);
  assert.equal((html.match(/class="cs-lol-skeleton cs-lol-skeleton-item"/g) || []).length, 7);
  assert.match(html, /cs-lol-skeleton-result/);
  assert.match(html, /cs-lol-skeleton-value/);
  assert.equal((html.match(/class="cs-lol-scramble"/g) || []).length, 5);
  assert.doesNotMatch(html, /KDA|총 딜량|분당 CS|분당 골드|팀 내 피해|킬 관여율|분당 시야|와드 제거/);
  assert.match(html, /class="cs-lol-live-note"[^>]*>경기 종료 후 통계 반영까지 잠시만 기다려주세요\./);
  assert.doesNotMatch(html, /cs-lol-live-background|cs-lol-live-message|0\/0\/0/);
});
