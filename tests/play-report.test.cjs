const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../content.js'), 'utf8');

test('ranking buttons fit their content without ellipsizing game names', () => {
  assert.match(source, /\.cs-game-stats \.swiper-slide \{[^}]*width: auto;[^}]*max-width: 100%/);
  assert.match(source, /\.cs-game-stat \{[^}]*width: auto;[^}]*max-width: 100%/);
  assert.match(source, /\.cs-game-stat-name \{[^}]*overflow-wrap: anywhere;[^}]*white-space: nowrap/);
  assert.doesNotMatch(source, /\.cs-game-stat-name \{[^}]*text-overflow: ellipsis/);
});

test('monthly ranking is compact-only while play report is always available', () => {
  assert.match(source, /const gameRanking = !specialMode && state\.monthExpanded && state\.gameOnly \? gameSummaryHtml\(monthBase\) : "";/);
  assert.match(source, /const playReport = !specialMode && state\.monthExpanded \? playReportHtml\(monthBase\) : "";/);
});

test('play status image uses at least 24 canvas pixels for a 12px scaled preview', () => {
  assert.match(source, /const reportFontSize = Math\.max\(24, Number\(size\) \|\| 0\)/);
  assert.match(source, /ctx\.font = `\$\{weight\} \$\{reportFontSize\}px/);
});

function harness() {
  const entries = {};
  const text = [];
  const ctx = new Proxy({ createLinearGradient: () => ({ addColorStop() {} }),
    measureText: value => ({ width: value.length * 12 }), fillText: value => text.push(value) },
    { get: (target, key) => key in target ? target[key] : () => {} });
  const context = vm.createContext({
    state: { todayKey: '2026-10-05' },
    entryFor: key => entries[key],
    dateKey: date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-'),
    escapeHtml: value => value,
    directiveHtml: value => value,
    document: { createElement: () => ({ setAttribute() {}, getContext: () => ctx }) },
  });
  vm.runInContext(source.slice(source.indexOf('  function playReportAvailable('), source.indexOf('  function compactCellContentHtml(')), context);
  return { context, entries, text };
}
const part = (label, start, end, extra = {}) => ({ categoryLabel: label, categoryType: 'GAME', categoryStartTime: start, categoryEndTime: end, ...extra });

test('play report totals all intervals and ranks by time instead of broadcast days', () => {
  const { context, entries, text } = harness();
  entries['2026-10-01'] = { parts: [part('A', '00:00:00', '01:00:00'), part('A', '02:00:00', '02:30:00'), part('B', '03:00:00', '07:00:00'), part('Talk', '07:00:00', '07:20:30', { categoryType: 'ETC' })] };
  entries['2026-10-02'] = { parts: [part('A', '00:00:00', '01:00:00'), part('Hidden', '00:00:00', '90:00:00', { hiddenFromFront: true })] };
  const month = new Date(2026, 9, 1);
  const stats = context.monthPlayStats(month).stats;
  assert.equal(stats[0].label, 'B');
  assert.equal(stats[0].seconds, 14400);
  assert.equal(stats[1].seconds, 9000);
  assert.equal(stats[1].days.length, 2);
  assert.equal(context.monthPlayStats(month, true).stats[2].seconds, 1230);
  context.rankingImageCanvas(month);
  assert.ok(text.includes('10월 플레이 현황'));
  assert.ok(text.includes('약 4시간 0분'));
  assert.ok(text.includes('약 0시간 20분'));
  assert.ok(text.includes('2일 방송'));
  assert.ok(!text.includes('플레이 시간'));
  assert.ok(text.includes('10.01 ~ 10.02'));
  assert.equal(text.filter(value => value === '10.01 ~ 10.02').length, 1);
  assert.ok(!text.includes('총 플레이 시간'));
  assert.ok(text.includes('오뱅알'));
  assert.ok(!text.includes('OBAENGAL'));
  assert.ok(!text.some(value => value.includes('기록된 시간 기준의 근사치')));
  assert.ok(!text.some(value => value.includes('방송일 ·') || /\d초/.test(value)));
  assert.equal(context.monthPlayStats(new Date(2026, 8, 1)).stats.length, 0);
  assert.throws(() => context.rankingImageCanvas(new Date(2026, 8, 1)));
});

test('empty reports render without invalid ranking bars', () => {
  const { context, text } = harness();
  context.rankingImageCanvas(new Date(2026, 9, 1));
  assert.ok(text.includes('기록된 플레이 시간 없음'));
});

test('one incomplete category excludes that entire day and every later day for all rankings', () => {
  const { context, entries, text } = harness();
  entries['2026-10-01'] = { parts: [part('A', '00:00:00', '01:00:00')] };
  entries['2026-10-03'] = { parts: [part('A', '00:00:00', '04:00:00'), part('Talk', '', '', { categoryType: 'ETC' })] };
  entries['2026-10-04'] = { parts: [part('B', '00:00:00', '10:00:00')] };
  for (const all of [false, true]) {
    const report = context.monthPlayStats(new Date(2026, 9, 1), all);
    assert.equal(report.throughDate, '2026-10-01');
    assert.equal(report.stats.length, 1);
    assert.equal(report.stats[0].seconds, 3600);
    assert.equal(report.stats[0].days.length, 1);
  }
  context.rankingImageCanvas(new Date(2026, 9, 1));
  assert.ok(text.includes('10.01 ~ 10.01'));
});

test('first-day missing times produce no totals and future entries are excluded', () => {
  const { context, entries } = harness();
  entries['2026-10-01'] = { parts: [part('A', '02:00:00', '01:00:00')] };
  const report = context.monthPlayStats(new Date(2026, 9, 1));
  assert.equal(report.throughDate, null);
  assert.equal(report.stats.length, 0);
  delete entries['2026-10-01'];
  entries['2026-10-06'] = { parts: [part('Future', '00:00:00', '01:00:00')] };
  assert.equal(context.monthPlayStats(new Date(2026, 9, 1)).stats.length, 0);
  assert.equal(context.monthPlayStats(new Date(2026, 9, 1)).throughDate, null);
});

test('monthly ranking displays and orders recorded play time instead of broadcast-day counts', () => {
  const { context, entries } = harness();
  entries['2026-10-01'] = { parts: [part('Many days', '00:00:00', '01:00:00'), part('Long play', '01:00:00', '05:00:00')] };
  entries['2026-10-02'] = { parts: [part('Many days', '00:00:00', '01:00:00')] };
  const html = context.gameSummaryHtml(new Date(2026, 9, 1));
  assert.ok(html.indexOf('Long play') < html.indexOf('Many days'));
  assert.match(html, /cs-game-rank">#1<\/span><span class="cs-game-stat-name">Long play/);
  assert.match(html, /cs-game-rank">#2<\/span><span class="cs-game-stat-name">Many days/);
  assert.ok(html.includes('약 4시간 0분'));
  assert.ok(html.includes('약 2시간 0분'));
  assert.ok(!html.includes('일 방송'));
  assert.ok(!html.includes('게임 카테고리 · 기록된 플레이 시간순'));
});

test('play report uses the admin schedule date even when the broadcast start is in another month', () => {
  const { context, entries } = harness();
  context.state.todayKey = '2026-10-31';
  entries['2026-09-30'] = {
    vods: [{ startedAt: '2026-09-30T16:30:00Z' }],
    parts: [part('October', '00:00:00', '02:00:00')],
  };
  entries['2026-10-31'] = {
    vods: [{ startedAt: '2026-10-31T16:30:00Z' }],
    parts: [part('November', '00:00:00', '03:00:00')],
  };
  entries['2026-10-01'] = {
    vods: [{ startedAt: '2026-10-01T12:00:00Z' }],
    parts: [part('October', '00:00:00', '01:00:00')],
  };
  const october = context.monthPlayStats(new Date(2026, 9, 1));
  assert.equal(october.stats.length, 2);
  assert.equal(october.stats[0].label, 'November');
  assert.equal(october.stats[0].seconds, 10800);
  assert.equal(october.stats[0].days[0], 31);
  assert.equal(october.stats[1].label, 'October');
  assert.equal(october.stats[1].seconds, 3600);
  assert.equal(october.throughDate, '2026-10-31');
});

test('report basis is the latest admin schedule date with recorded play time', () => {
  const { context, entries, text } = harness();
  entries['2026-10-05'] = {
    vods: [{ startedAt: '2026-10-05T14:30:00Z' }],
    parts: [part('Late stream', '00:00:00', '05:00:00')],
  };
  const report = context.monthPlayStats(new Date(2026, 9, 1));
  assert.equal(report.throughDate, '2026-10-05');
  context.rankingImageCanvas(new Date(2026, 9, 1));
  assert.ok(text.includes('10.01 ~ 10.05'));
});

test('empty current-day schedules do not advance the report basis', () => {
  const { context, entries } = harness();
  entries['2026-10-03'] = { parts: [part('Played', '00:00:00', '01:00:00')] };
  entries['2026-10-05'] = { parts: [] };
  assert.equal(context.monthPlayStats(new Date(2026, 9, 1)).throughDate, '2026-10-03');
});

test('past off days and excluded-only days count as completed report dates', () => {
  const { context, entries } = harness();
  entries['2026-10-01'] = { parts: [part('Played', '00:00:00', '01:00:00')] };
  entries['2026-10-03'] = { status: 'off', parts: [] };
  entries['2026-10-04'] = { parts: [part('Excluded', '', '', { excludeFromPlayReport: true })] };
  const report = context.monthPlayStats(new Date(2026, 9, 1));
  assert.equal(report.throughDate, '2026-10-04');
  assert.equal(report.incompleteDate, null);
  assert.equal(report.stats[0].seconds, 3600);
});

test('categories excluded from the play report remain visible but do not affect totals or completeness', () => {
  const { context, entries } = harness();
  entries['2026-10-05'] = { parts: [
    part('Counted', '00:00:00', '01:00:00'),
    part('Excluded', '', '', { excludeFromPlayReport: true }),
  ] };
  const report = context.monthPlayStats(new Date(2026, 9, 1));
  assert.equal(report.incompleteDate, null);
  assert.deepEqual(JSON.parse(JSON.stringify(report.stats)), [{ label: 'Counted', seconds: 3600, days: [5] }]);
});
