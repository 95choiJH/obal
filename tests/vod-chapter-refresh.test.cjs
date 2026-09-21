const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../content.js'), 'utf8');

function extract(name, next) {
  return source.slice(source.indexOf(`  function ${name}(`), source.indexOf(`  function ${next}(`));
}

test('mounted chapters update labels, seek targets, additions and removals without remounting unchanged data', () => {
  let items = [{ categoryLabel: 'Old', offsetSeconds: 240 }];
  let created = 0;
  let seek;
  const parent = { appendChild(host) { host.parentElement = parent; host.isConnected = true; } };
  const state = { vodCategoryHost: null };
  const context = vm.createContext({
    state, location: { href: '/video/15287994' },
    isChzzkVodPage: () => true, currentVodScheduleMatch: () => ({}),
    vodCategoryGroup: () => items, findLatestVodCardSlots: () => ({ appendTo: parent }),
    removeVodCategoryHost: () => { state.vodCategoryHost = null; },
    escapeHtml: s => s, formatVodOffset: s => String(s),
    handleVodCategoryClick: item => { seek = item.offsetSeconds; },
    document: { createElement() {
      created++;
      const buttons = items.map((_, i) => ({ getAttribute: () => String(i), addEventListener: (_, fn) => { buttons[i].click = fn; } }));
      const shadow = { innerHTML: '', querySelector: () => null, querySelectorAll: () => buttons };
      return { dataset: {}, style: {}, shadow, buttons, attachShadow: () => shadow };
    } },
  });
  vm.runInContext(extract('syncVodCategoryButtons', 'setChannelSchedulePanelOpen'), context);
  const sync = () => vm.runInContext('syncVodCategoryButtons()', context);
  sync(); sync();
  assert.equal(created, 1);
  items = [{ categoryLabel: 'Edited', offsetSeconds: 231 }, { categoryLabel: 'Added', offsetSeconds: 1905 }];
  sync();
  assert.equal(created, 2);
  assert.match(state.vodCategoryHost.shadow.innerHTML, /Edited/);
  assert.match(state.vodCategoryHost.shadow.innerHTML, /Added/);
  state.vodCategoryHost.buttons[0].click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(seek, 231);
  items = [items[1]];
  sync();
  assert.doesNotMatch(state.vodCategoryHost.shadow.innerHTML, /Edited/);
  items = [];
  sync();
  assert.equal(state.vodCategoryHost, null);
});

test('VOD pages refresh chapters without a mounted schedule panel', async () => {
  let refreshed = 0;
  let synced = 0;
  const context = vm.createContext({
    document: { visibilityState: 'visible' }, isFullscreenActive: () => false,
    fullscreenRestorePending: false, isChzzkVodPage: () => true,
    state: { channelId: null, host: null, fetchedAt: 0 },
    currentViewFingerprint: () => '', refreshData: async force => { assert.equal(force, true); refreshed++; return true; },
    syncVodCategoryButtons: () => { synced++; },
  });
  vm.runInContext(source.slice(source.indexOf('  let autoRefreshInFlight = false;'), source.indexOf('  function startAutoRefresh()')), context);
  await vm.runInContext('runAutoRefreshIfDue()', context);
  assert.equal(refreshed, 1);
  assert.equal(synced, 1);
  await vm.runInContext('runAutoRefreshIfDue()', context);
  assert.equal(refreshed, 1);
});
