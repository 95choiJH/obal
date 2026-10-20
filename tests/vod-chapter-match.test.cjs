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

test('multiple legacy replays without identity never infer chapters from array order', () => {
  const h = harness(items);
  const [first, second] = matches([{}, {}]);
  assert.equal(h.vodCategoryGroup(first).length, 0);
  assert.equal(h.vodCategoryGroup(second).length, 0);
});

test('visible chapters are scoped independently for both broadcasts', () => {
  const h = harness([...items, { ...items[0], id: 46, categoryLabel: 'First game', hidden: false, offsetSeconds: 90 }]);
  const [first, second] = matches([{ liveKey: firstKey }, { liveKey: secondKey }]);
  assert.deepEqual(Array.from(h.vodCategoryGroup(first), item => item.id), [46]);
  assert.deepEqual(Array.from(h.vodCategoryGroup(second), item => item.id), [45]);
});

test('replay includes a chapter captured under an immediately preceding session key', () => {
  const replayKey = '2026-09-21 20:33:42';
  const earlierKey = '2026-09-21 20:31:42';
  const h = harness([
    { id: 56, liveKey: earlierKey, scheduleDate: date, categoryLabel: 'talk', hidden: true, offsetSeconds: 0 },
    { id: 57, liveKey: earlierKey, scheduleDate: date, categoryLabel: 'Baseball', hidden: false, offsetSeconds: 0 },
    { id: 58, liveKey: replayKey, scheduleDate: date, categoryLabel: 'Volleyball', hidden: false, offsetSeconds: 1795 },
  ]);
  const [match] = matches([{ liveKey: replayKey, startedAt: replayKey }]);
  assert.deepEqual(Array.from(h.vodCategoryGroup(match), item => item.id), [57, 58]);
});

test('normal chapter queries still exclude hidden records', () => {
  const h = harness(items);
  assert.deepEqual(Array.from(h.getCategoryHistoryItems(), item => item.id), [45]);
  assert.equal(h.getCategoryHistoryItems(true).length, 3);
});

test('explicit video binding wins over keys and excludes chapters bound to another video', () => {
  const h = harness([
    { id: 1, vodVideoNo: '100', liveKey: secondKey, scheduleDate: date, categoryLabel: 'First', offsetSeconds: 90 },
    { id: 2, vodVideoNo: '200', liveKey: firstKey, scheduleDate: date, categoryLabel: 'Second', offsetSeconds: 10 },
  ]);
  const [first, second] = matches([
    { url: 'https://chzzk.naver.com/video/100', liveKey: firstKey },
    { url: 'https://chzzk.naver.com/video/200', liveKey: secondKey },
  ]);
  assert.deepEqual(Array.from(h.vodCategoryGroup(first), x => x.id), [1]);
  assert.deepEqual(Array.from(h.vodCategoryGroup(second), x => x.id), [2]);
});

test('shared source broadcast key cannot leak unbound chapters into multiple replay videos', () => {
  const h = harness([
    { id: 1, liveKey: firstKey, scheduleDate: date, categoryLabel: 'Unassigned', offsetSeconds: 10 },
    { id: 2, vodVideoNo: '100', liveKey: firstKey, scheduleDate: date, categoryLabel: 'Bound', offsetSeconds: 20 },
  ]);
  const [first, second] = matches([
    { url: 'https://chzzk.naver.com/video/100', liveKey: firstKey },
    { url: 'https://chzzk.naver.com/video/200', liveKey: firstKey },
  ]);
  assert.deepEqual(Array.from(h.vodCategoryGroup(first), x => x.id), [2]);
  assert.equal(h.vodCategoryGroup(second).length, 0);
});

test('manual chapters waiting for a video stay unpublished even when only one replay exists', () => {
  const h = harness([{ id: 1, liveKey: date + '-manual', scheduleDate: date, categoryLabel: 'Waiting', offsetSeconds: 10 }]);
  const [match] = matches([{ url: 'https://chzzk.naver.com/video/100' }]);
  assert.equal(h.vodCategoryGroup(match).length, 0);
});
