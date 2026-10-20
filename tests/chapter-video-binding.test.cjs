const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const admin = fs.readFileSync('admin/app.js', 'utf8');
function harness(vods) {
  const c = vm.createContext({ rows: [{ date: '2026-10-18', vods }] });
  for (const name of ['timestampMsValue', 'sameChapterStartedAt', 'scheduleChapterSessions', 'chapterVodVideoNo']) {
    const start = admin.indexOf('  function ' + name + '(');
    vm.runInContext(admin.slice(start, admin.indexOf('\n  function ', start + 5)), c);
  }
  return c;
}
const a = { url: 'https://chzzk.naver.com/video/100', liveKey: 'first', startedAt: '2026-10-18T11:00:00Z' };
const b = { url: 'https://chzzk.naver.com/video/200', liveKey: 'second', startedAt: a.startedAt };
test('separate replay cards retain video bindings after order changes, even with identical starts', () => {
  for (const vods of [[a, b], [b, a]]) {
    const c = harness(vods);
    const sessions = c.scheduleChapterSessions('2026-10-18', [
      { id: 1, vod_video_no: '100', live_key: 'second' },
      { id: 2, vod_video_no: '200', live_key: 'first' },
    ]);
    assert.deepEqual(Array.from(sessions.find(s => s.videoNo === '100').items, x => x.id), [1]);
    assert.deepEqual(Array.from(sessions.find(s => s.videoNo === '200').items, x => x.id), [2]);
  }
});
test('ambiguous legacy, unregistered video, and manual chapters stay in connection waiting', () => {
  const c = harness([a, b]);
  const sessions = c.scheduleChapterSessions('2026-10-18', [
    { id: 1, started_at: a.startedAt, live_key: 'unknown' },
    { id: 2, vod_video_no: '300', live_key: 'first' },
    { id: 3, live_key: '2026-10-18-manual', started_at: '2026-10-17T15:00:00Z' },
  ]);
  assert.equal(sessions.filter(s => s.vodIndex >= 0).flatMap(s => s.items).length, 0);
  assert.equal(sessions.filter(s => s.vodIndex < 0).flatMap(s => s.items).length, 3);
});
test('legacy exact keys work but array position is never a binding', () => {
  const c = harness([b, a]);
  const sessions = c.scheduleChapterSessions('2026-10-18', [{ id: 1, live_key: 'first' }, { id: 2, live_key: 'missing' }]);
  assert.equal(sessions.find(s => s.videoNo === '100').items[0].id, 1);
  assert.equal(sessions.find(s => s.vodIndex < 0).items[0].id, 2);
});
