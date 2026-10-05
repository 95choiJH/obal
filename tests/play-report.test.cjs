const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../content.js'), 'utf8');
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
  assert.ok(text.includes('2026.10.05까지 집계'));
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
    assert.equal(report.throughDate, '2026-10-02');
    assert.equal(report.stats.length, 1);
    assert.equal(report.stats[0].seconds, 3600);
    assert.equal(report.stats[0].days.length, 1);
  }
  context.rankingImageCanvas(new Date(2026, 9, 1));
  assert.ok(text.includes('2026.10.02까지 집계'));
});

test('first-day missing times produce no totals and previous month cutoff; future entries are excluded', () => {
  const { context, entries } = harness();
  entries['2026-10-01'] = { parts: [part('A', '02:00:00', '01:00:00')] };
  const report = context.monthPlayStats(new Date(2026, 9, 1));
  assert.equal(report.throughDate, '2026-09-30');
  assert.equal(report.stats.length, 0);
  delete entries['2026-10-01'];
  entries['2026-10-06'] = { parts: [part('Future', '00:00:00', '01:00:00')] };
  assert.equal(context.monthPlayStats(new Date(2026, 9, 1)).stats.length, 0);
  assert.equal(context.monthPlayStats(new Date(2026, 9, 1)).throughDate, '2026-10-05');
});
