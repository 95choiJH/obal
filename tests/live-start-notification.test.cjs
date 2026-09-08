const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');
const now = Date.parse('2026-09-05T12:02:00+09:00');
function harness(previous) {
  let clockNow = now;
  let saved = { targetLiveStartState: previous };
  let response;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clockNow])); }
    static now() { return clockNow; }
  }
  const ctx = vm.createContext({
    Date: Clock,
    defaultChannelId: () => 'target',
    targetChannelName: () => 'test',
    storageGet: async () => structuredClone(saved),
    storageSet: async values => { saved = { ...saved, ...values }; },
    fetchTargetLiveStatus: async () => response,
    fetchTargetChannelProfile: async () => ({ channelName: 'test' }),
  });
  vm.runInContext(source.match(/const TARGET_LIVE_START_RECOVERY_MAX_AGE = [^;]+;/)[0] +
    '\nconst TARGET_LIVE_STATE_KEY = "targetLiveStartState";\n' +
    source.slice(source.indexOf('function normalizeLiveStatusPayload('), source.indexOf('async function fetchTargetChannelProfile(')) +
    source.slice(source.indexOf('function liveStartedAt('), source.indexOf('async function openDefaultChannelWithSchedule(')), ctx);
  let listener;
  ctx.api = { runtime: { getURL: value => 'extension://' + value, onMessage: { addListener: callback => { listener = callback; } } } };
  vm.runInContext(source.slice(source.indexOf('api.runtime.onMessage.addListener(')), ctx);
  return {
    advance: milliseconds => { clockNow += milliseconds; },
    resetWorkerMemory: () => vm.runInContext('multiTabLiveSimulation = null;', ctx),
    enableDesktop: (firefox = false) => {
      const notices = [];
      if (firefox) ctx.browser = {};
      ctx.api.notifications = { create: (id, details, callback) => {
        notices.push({ id, details });
        if (callback) callback(id);
        else return Promise.resolve(id);
      } };
      return notices;
    },
    async poll(contexts) {
      const delivered = [];
      ctx.api.tabs = {
        query: async () => contexts.map((_, index) => ({ id: index + 1 })),
        sendMessage: (tabId, message, callback) => {
          if (message.type === 'getLiveNotificationContext') callback(contexts[tabId - 1]);
          else { delivered.push({ tabId, ...message }); callback({ ok: true }); }
        },
      };
      await ctx.pollLiveNotificationTabs();
      return delivered;
    },
    dispatch: (message, tabId) => new Promise(resolve => listener(message, tabId === undefined ? {} : { tab: { id: tabId } }, resolve)),
    setResponse: content => { response = ctx.normalizeLiveStatusPayload({ content }); },
    async check(content, options, channel = 'other') {
      response = content.error ? { ok: false, error: content.error } : ctx.normalizeLiveStatusPayload({ content });
      return ctx.checkTargetLiveStart(channel, options);
    },
    state: () => saved.targetLiveStartState,
  };
}
const old = { live: true, liveKey: '100', categoryKey: 'old game', lastNotifiedLiveKey: '100' };
const live = { status: 'OPEN', liveId: 101, openDate: '2026-09-05 12:00:00', liveTitle: 'New title', categoryType: 'GAME', liveCategoryValue: 'New game' };

test('multi-tab simulation survives background worker memory reset', async () => {
  const h = harness(old);
  await h.dispatch({ type: 'simulateTargetLiveStart', scenario: 'multi-tab', isWatchingVod: true }, 1);
  h.advance(30000);
  h.resetWorkerMemory();
  const result = await h.dispatch({ type: 'checkTargetLiveStart', isWatchingVod: true }, 1);
  assert.equal(result.notify, true);
  assert.equal(result.simulation.scenario, 'multi-tab');
  assert.deepEqual(h.state(), old);
});

test('Firefox Promise notification API handles hidden tab alerts', async () => {
  const h = harness();
  const notices = h.enableDesktop(true);
  const request = { type: 'checkTargetLiveStart', isWatchingVod: true, pageVisible: false };
  h.setResponse({ status: 'CLOSE' });
  await h.dispatch(request, 1);
  h.setResponse(live);
  assert.equal((await h.dispatch(request, 1)).notify, true);
  assert.equal(notices.length, 1);
});

test('background polling delivers to hidden tabs without their page timers and deduplicates desktop notice', async () => {
  const h = harness();
  const notices = h.enableDesktop();
  const contexts = [
    { eligible: true, isWatchingVod: true, pageVisible: false },
    { eligible: true, currentChannelId: 'other', pageVisible: false },
    { eligible: false },
  ];
  h.setResponse({ status: 'CLOSE' });
  assert.equal((await h.poll(contexts)).length, 0);
  h.setResponse(live);
  const received = await h.poll(contexts);
  assert.deepEqual(received.map(item => item.tabId), [1, 2]);
  assert.equal(notices.length, 1);
  assert.equal((await h.poll(contexts)).length, 0);
  assert.equal(notices.length, 1);
});

test('foreground tab only receives in-page notification', async () => {
  const h = harness();
  const notices = h.enableDesktop();
  const contexts = [{ eligible: true, isWatchingVod: true, pageVisible: true }];
  h.setResponse({ status: 'CLOSE' });
  await h.poll(contexts);
  h.setResponse(live);
  assert.equal((await h.poll(contexts)).length, 1);
  assert.equal(notices.length, 0);
});

test('page and background checks cannot both consume the same tab transition', async () => {
  const h = harness();
  const request = { type: 'checkTargetLiveStart', isWatchingVod: true };
  h.setResponse({ status: 'CLOSE' });
  await h.dispatch(request, 1);
  h.setResponse(live);
  const results = await Promise.all([h.dispatch(request, 1), h.dispatch(request, 1)]);
  assert.deepEqual(results.map(result => result.notify), [true, false]);
});

test('all five tabs get live and category alerts once, including identical channels and VODs', async () => {
  const h = harness(old);
  const request = { type: 'checkTargetLiveStart', currentChannelId: 'same-channel' };
  h.setResponse({ status: 'CLOSE' });
  for (let tab = 1; tab <= 5; tab++) await h.dispatch({ ...request, isWatchingVod: tab > 3 }, tab);
  h.setResponse(live);
  for (let tab = 1; tab <= 5; tab++) {
    assert.equal((await h.dispatch(request, tab)).notify, true);
    assert.equal((await h.dispatch(request, tab)).notify, false);
  }
  // 새로 연 탭에는 지난 방송 시작 알림을 보내지 않는다.
  assert.equal((await h.dispatch(request, 6)).notify, false);
  h.setResponse({ ...live, liveCategoryValue: 'Another game' });
  for (let tab = 1; tab <= 6; tab++) {
    const result = await h.dispatch(request, tab);
    assert.equal(result.notify, true);
    assert.equal(result.notificationType, 'categoryChange');
    assert.equal((await h.dispatch(request, tab)).notify, false);
  }
});

test('one tab disabling notifications cannot consume another tab alert', async () => {
  const h = harness();
  const request = { type: 'checkTargetLiveStart', isWatchingVod: true };
  h.setResponse({ status: 'CLOSE' });
  await h.dispatch(request, 1);
  await h.dispatch(request, 2);
  h.setResponse(live);
  assert.equal((await h.dispatch({ ...request, liveStartNoticeEnabled: false }, 1)).notify, false);
  assert.equal((await h.dispatch(request, 2)).notify, true);
});

test('multi-tab simulation notifies both tabs once and expires without changing real state', async () => {
  const h = harness(old);
  const start = await h.dispatch({ type: 'simulateTargetLiveStart', scenario: 'multi-tab', currentChannelId: 'other-a' }, 1);
  assert.equal(start.notify, false);
  assert.equal((await h.dispatch({ type: 'checkTargetLiveStart', currentChannelId: 'other-b' }, 2)).notify, false);
  h.advance(16000);
  const first = await h.dispatch({ type: 'checkTargetLiveStart', currentChannelId: 'other-a' }, 1);
  const second = await h.dispatch({ type: 'checkTargetLiveStart', currentChannelId: 'other-b' }, 2);
  assert.equal(first.notify, true);
  assert.equal(second.notify, true);
  assert.equal((await h.dispatch({ type: 'checkTargetLiveStart', currentChannelId: 'other-a' }, 1)).notify, false);
  assert.equal((await h.dispatch({ type: 'checkTargetLiveStart', currentChannelId: 'other-b' }, 2)).notify, false);
  assert.deepEqual(h.state(), old);
  h.advance(45000);
  await h.check({ error: 'real API marker' });
  const resumed = await h.dispatch({ type: 'checkTargetLiveStart', currentChannelId: 'other-b' });
  assert.equal(resumed.error, 'real API marker');
  assert.equal(resumed.simulation, undefined);
});

test('multi-tab simulation supports simultaneous requests from separate tabs', async () => {
  const h = harness(old);
  await h.dispatch({ type: 'simulateTargetLiveStart', scenario: 'multi-tab', isWatchingVod: true }, 1);
  await h.dispatch({ type: 'checkTargetLiveStart', isWatchingVod: true }, 2);
  h.advance(16000);
  const results = await Promise.all([
    h.dispatch({ type: 'checkTargetLiveStart', currentChannelId: 'other-a' }, 1),
    h.dispatch({ type: 'checkTargetLiveStart', currentChannelId: 'other-b' }, 2),
  ]);
  assert.deepEqual(results.map(result => result.notify), [true, true]);
  assert.deepEqual(h.state(), old);
});

test('separate browser simulations do not consume each other notifications', async () => {
  const chrome = harness(old);
  const firefox = harness(old);
  for (const h of [chrome, firefox]) {
    await h.dispatch({ type: 'simulateTargetLiveStart', scenario: 'multi-tab', isWatchingVod: true });
    h.advance(16000);
    assert.equal((await h.dispatch({ type: 'checkTargetLiveStart', isWatchingVod: true })).notify, true);
  }
});

test('missed offline: legacy stored ID detects recent new broadcast once', async () => {
  const h = harness(old);
  const result = await h.check(live);
  assert.equal(result.notify, true);
  assert.equal(result.notificationType, 'liveStart');
  assert.equal((await h.check(live)).notify, false);
  assert.equal(h.state().liveId, '101');
});

test('simulation message uses actual detector and leaves real stored state intact', async () => {
  for (const scenario of ['offline-to-live', 'recovery']) {
    const h = harness(old);
    const result = await h.dispatch({ type: 'simulateTargetLiveStart', isWatchingVod: true, scenario });
    assert.equal(result.ok, true);
    assert.equal(result.notify, true);
    assert.equal(result.notificationType, 'liveStart');
    assert.equal(result.simulation.beforeNotify, false);
    assert.equal(result.simulation.startedNotify, true);
    assert.equal(result.simulation.repeatedNotify, false);
    assert.deepEqual(h.state(), old);
  }
});
test('simulation message preserves real alert settings and page restrictions', async () => {
  const h = harness(old);
  const disabled = await h.dispatch({ type: 'simulateTargetLiveStart', isWatchingVod: true, liveStartNoticeEnabled: false });
  assert.equal(disabled.notify, false);
  const excluded = await h.dispatch({ type: 'simulateTargetLiveStart', currentChannelId: 'target' });
  assert.equal(excluded.notify, false);
  assert.deepEqual(h.state(), old);
});

test('simulation passes through page request, background handler and toast call', async () => {
  const content = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
  const h = harness(old);
  const shown = [];
  const messages = [];
  const ctx = vm.createContext({
    location: { pathname: '/video/12345' }, Date, document: { visibilityState: 'visible' },
    console: { info() {}, warn() {} },
    targetChannelId: () => 'target',
    state: { liveStartNoticeEnabled: false, categoryChangeNoticeEnabled: false, targetLiveNotificationsEnabled: true, targetLiveNotificationsPublicEnabled: false, targetLiveNotificationsQcEnabled: true },
    sendRuntimeMessage: msg => { messages.push(msg); return h.dispatch(msg); },
    showLiveStartToast: (...args) => shown.push(args),
  });
  vm.runInContext('let liveStartCheckInFlight = false; let lastLiveStartCheckAt = 0; const LIVE_START_CHECK_INTERVAL = 10000;\n' +
    content.slice(content.indexOf('function getChannelIdFromUrl('), content.indexOf('function sendRuntimeMessage(')) +
    content.slice(content.indexOf('function targetLiveNotificationsAvailable('), content.indexOf('function startLiveStartWatcher(')), ctx);
  await ctx.checkTargetLiveStartToast(true, 'recovery');
  assert.equal(messages[0].type, 'simulateTargetLiveStart');
  assert.equal(shown.length, 1);
  assert.match(shown[0][2], /방송을 시작했습니다/);
  assert.deepEqual(h.state(), old);
});
test('ordinary offline to live transition still notifies once', async () => {
  const h = harness(old);
  assert.equal((await h.check({ status: 'CLOSE' })).notify, false);
  assert.equal((await h.check(live)).notify, true);
  assert.equal((await h.check(live)).notify, false);
});
test('initial observation of an ongoing live only establishes a baseline', async () => {
  assert.equal((await harness().check(live)).notify, false);
});
test('old or unknown start time cannot generate a recovered start notification', async () => {
  for (const openDate of ['2026-09-05 10:00:00', '', 'invalid', '2026-09-05 12:10:00']) {
    assert.equal((await harness(old).check({ ...live, openDate })).notify, false);
  }
});
test('Korean and explicitly zoned timestamps describe the same recent start', async () => {
  for (const openDate of ['2026-09-05 12:00:00', '2026-09-05T03:00:00Z', '2026-09-05T12:00:00+09:00']) {
    assert.equal((await harness(old).check({ ...live, openDate })).notify, true);
  }
});
test('same session game change remains a category notification', async () => {
  const result = await harness({ ...old, liveId: '101' }).check(live);
  assert.equal(result.notify, true);
  assert.equal(result.notificationType, 'categoryChange');
});
test('title changes without a stable session identity do not trigger start alerts', async () => {
  const h = harness({ live: true, liveKey: 'Old title', categoryKey: 'new game' });
  assert.equal((await h.check({ ...live, liveId: null, openDate: '' })).notify, false);
});
test('start time identifies new sessions when liveId is unavailable', async () => {
  const h = harness({ ...old, liveKey: '2026-09-04 12:00:00' });
  assert.equal((await h.check({ ...live, liveId: null })).notify, true);
});
test('query failure preserves session identity for recovery', async () => {
  const h = harness(old);
  assert.equal((await h.check({ error: 'network failure' })).notify, false);
  assert.equal(h.state().liveKey, '100');
  assert.equal((await h.check(live)).notify, true);
});
test('disabled start alerts do not turn new sessions into category alerts', async () => {
  const h = harness(old);
  assert.equal((await h.check(live, { liveStartNoticeEnabled: false })).notify, false);
  assert.equal((await h.check(live)).notify, false);
});
test('already notified session and target channel suppress start alerts', async () => {
  assert.equal((await harness({ ...old, lastNotifiedLiveKey: '101' }).check(live)).notify, false);
  assert.equal((await harness(old).check(live, {}, 'target')).notify, false);
});

test('VOD viewing allows alerts without a channel ID and on the target channel', async () => {
  for (const channel of [null, 'target', 'other']) {
    const result = await harness(old).check(live, { isWatchingVod: true }, channel);
    assert.equal(result.notify, true);
    assert.equal(result.notificationType, 'liveStart');
  }
  assert.equal((await harness(old).check(live, {}, null)).notify, false);
});
test('VOD category alerts respect both notification settings', async () => {
  const previous = { ...old, liveId: '101' };
  const result = await harness(previous).check(live, { isWatchingVod: true }, null);
  assert.equal(result.notificationType, 'categoryChange');
  assert.equal(result.notify, true);
  assert.equal((await harness(previous).check(live, { isWatchingVod: true, categoryChangeNoticeEnabled: false }, null)).notify, false);
  assert.equal((await harness(old).check(live, { isWatchingVod: true, liveStartNoticeEnabled: false }, null)).notify, false);
});

test('content script requests and displays VOD alerts, retaining page exclusions', async () => {
  const content = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
  const target = 'a'.repeat(32);
  for (const [pathname, expected, vod] of [
    ['/video/12345', true, true],
    ['/video/12345/', true, true],
    ['/live/' + 'b'.repeat(32), true, false],
    ['/live/' + target, false, false],
    ['/', false, false],
    ['/video/invalid', false, false],
  ]) {
    const messages = [];
    const shown = [];
    const ctx = vm.createContext({
      location: { pathname }, Date, document: { visibilityState: 'visible' },
      targetChannelId: () => target,
      state: { liveStartNoticeEnabled: true, categoryChangeNoticeEnabled: true, targetLiveNotificationsEnabled: true, targetLiveNotificationsPublicEnabled: true, targetLiveNotificationsQcEnabled: false },
      sendRuntimeMessage: async msg => {
        messages.push(msg);
        return { notify: true, notificationType: 'liveStart', channelName: 'test' };
      },
      showLiveStartToast: (...args) => shown.push(args),
    });
    vm.runInContext('let liveStartCheckInFlight = false; let lastLiveStartCheckAt = 0; const LIVE_START_CHECK_INTERVAL = 10000;\n' +
      content.slice(content.indexOf('function getChannelIdFromUrl('), content.indexOf('function sendRuntimeMessage(')) +
      content.slice(content.indexOf('function targetLiveNotificationsAvailable('), content.indexOf('function startLiveStartWatcher(')), ctx);
    await ctx.checkTargetLiveStartToast(true);
    assert.equal(messages.length, expected ? 1 : 0, pathname);
    assert.equal(shown.length, expected ? 1 : 0, pathname);
    if (expected) assert.equal(messages[0].isWatchingVod, vod, pathname);
  }
});
