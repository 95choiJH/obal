const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
function harness(items) {
  const context = vm.createContext({
    state: { channelId: 'channel', data: { categoryHistories: { channel: items } } },
    getCurrentDataChannelId: () => 'channel',
  });
  for (const [start, end] of [
    ['  function liveKeyFromVod(', '  function titleHistoryItemsForVodMatch('],
    ['  function getCategoryHistoryItems(', '  function videoNoFromUrl('],
    ['  function categoryHistoryLiveKey(', '  function isChzzkVodPage('],
  ]) vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))), context);
  return context;
}
const date = '2026-09-17';
const firstKey = date + ' 19:40:25';
const secondKey = date + ' 19:45:02';
const items = [
  { id: 43, liveKey: firstKey, scheduleDate: date, startedAt: date + 'T19:40:25+00:00', changedAt: date + 'T10:40:32Z', categoryLabel: 'talk', hidden: true, offsetSeconds: 0 },
  { id: 44, liveKey: secondKey, scheduleDate: date, startedAt: date + 'T19:45:02+00:00', changedAt: date + 'T10:45:23Z', categoryLabel: 'talk', hidden: true, offsetSeconds: 0 },
  { id: 45, liveKey: secondKey, scheduleDate: date, startedAt: date + 'T19:45:02+00:00', changedAt: date + 'T11:03:46Z', categoryLabel: 'Game', hidden: false, offsetSeconds: 1124 },
];
function matches(vods) {
  const entry = { date, vods };
  return vods.map((vod, vodIndex) => ({ entry, vod, vodIndex }));
}

test('hidden-only first replay does not borrow the second broadcast chapters', () => {
  const h = harness(items);
  const [first, second] = matches([{ liveKey: firstKey, startedAt: firstKey }, { liveKey: secondKey, startedAt: secondKey }]);
  assert.equal(h.vodCategoryGroup(first).length, 0);
  const group = h.vodCategoryGroup(second);
  assert.deepEqual(Array.from(group, item => item.id), [45]);
  assert.equal(group[0].offsetSeconds, 1124);
});

test('unknown explicit broadcast key never falls back to another session', () => {
  const h = harness(items);
  const [match] = matches([{ liveKey: 'missing', startedAt: items[2].startedAt }]);
  assert.equal(h.vodCategoryGroup(match).length, 0);
});

test('legacy replay order includes hidden-only sessions before filtering', () => {
  const h = harness(items);
  const [first, second] = matches([{}, {}]);
  assert.equal(h.vodCategoryGroup(first).length, 0);
  assert.deepEqual(Array.from(h.vodCategoryGroup(second), item => item.id), [45]);
});

test('visible chapters are scoped independently for both broadcasts', () => {
  const h = harness([...items, { ...items[0], id: 46, categoryLabel: 'First game', hidden: false, offsetSeconds: 90 }]);
  const [first, second] = matches([{ liveKey: firstKey }, { liveKey: secondKey }]);
  assert.deepEqual(Array.from(h.vodCategoryGroup(first), item => item.id), [46]);
  assert.deepEqual(Array.from(h.vodCategoryGroup(second), item => item.id), [45]);
});

test('normal chapter queries still exclude hidden records', () => {
  const h = harness(items);
  assert.deepEqual(Array.from(h.getCategoryHistoryItems(), item => item.id), [45]);
  assert.equal(h.getCategoryHistoryItems(true).length, 3);
});
