const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const background = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8');
const admin = fs.readFileSync(path.join(__dirname, '../admin/app.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(background.slice(background.indexOf('function normalizeChannelRef('),
  background.indexOf('function normalizeLiveTitleHistory(')), context);
const editor = vm.createContext({});
vm.runInContext(admin.slice(admin.indexOf('  function categoryTimeSeconds('),
  admin.indexOf('  function normalizePart(')), editor);
vm.runInContext(admin.slice(admin.indexOf('  function partCategoryLabel('),
  admin.indexOf('  function partCategorySelectorHtml(')), editor);
const content = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
const calendar = vm.createContext({
  state: { selectedGame: '' },
  escapeHtml: value => value,
  directiveHtml: value => value,
});
vm.runInContext(content.slice(content.indexOf('  function gameLabel('),
  content.indexOf('  function monthGameStats(')), calendar);

const parts = [
  { content: 'Custom title', categoryLabel: 'New game', categoryId: 'new', categoryType: 'GAME' },
  { content: 'Round two', categoryLabel: 'New game', categoryId: 'new', categoryType: 'GAME' },
  { categoryLabel: 'Talk', categoryType: 'TALK' },
  { categoryLabel: 'Hidden', hiddenFromFront: true },
  { categoryLabel: 'Planned', speculative: true },
];

test('October uses content categories; September keeps the legacy game list', () => {
  const rows = ['2026-09-30', '2026-10-01', '2027-01-01'].map(date => ({
    channel_id: 'test', date, parts, game_images: [{ label: 'Old game' }],
  }));
  const entries = context.rowsToChannels(rows).channels.test.schedule;
  assert.equal(entries[0].gameImages[0].label, 'Old game');
  for (const entry of entries.slice(1)) {
    assert.equal(JSON.stringify(entry.gameImages.map(g => g.label)), '["New game"]');
    assert.equal(JSON.stringify(entry.allCategories.map(g => g.label)), '["New game","Talk"]');
  }
});

test('cleared content categories never fall back to stale game data', () => {
  const entry = context.rowsToChannels([{ channel_id: 'test', date: '2026-10-01',
    parts: [], game_images: [{ label: 'Old game' }] }]).channels.test.schedule[0];
  assert.equal(entry.allCategories.length, 0);
  assert.equal(entry.gameImages, undefined);
});

test('admin save and front derive the same categories, including category-only content', () => {
  assert.equal(JSON.stringify(editor.partGameImages(parts)), JSON.stringify(context.partGameImages(parts)));
  assert.equal(editor.partGameImages(parts).length, 2);
});

test('October simple view displays content categories including non-game categories', () => {
  const entry = { date: '2026-10-01', parts, gameImages: [{ label: 'Old game' }] };
  const html = calendar.gameChipsHtml(entry, true);
  assert.match(html, />New game<\/span>/);
  assert.match(html, />Talk<\/span>/);
  assert.equal((html.match(/>New game<\/span>/g) || []).length, 1);
  assert.doesNotMatch(html, /Old game|Custom title|Hidden|Planned/);
  assert.equal(calendar.gameChipsHtml({ ...entry, parts: [] }, true), '');
  assert.match(calendar.gameChipsHtml({ ...entry, date: '2026-09-30' }, true), /Old game/);
});

test('play duration uses broadcast offsets, supports seconds and over 24 hours, and rejects reversed ranges', () => {
  assert.equal(editor.categoryDurationMinutes('14:00', '15:30'), 90);
  assert.equal(editor.categoryDurationMinutes('23:30:00', '25:15:00'), 105);
  assert.equal(editor.categoryDurationMinutes('23:30', '01:15'), null);
  assert.equal(editor.categoryDurationMinutes('00:00:15', '01:30:45'), 90.5);
  assert.equal(editor.categoryDurationMinutes('10:00', '10:00'), 0);
  assert.equal(editor.categoryDurationMinutes('', '15:00'), null);
  assert.equal(editor.categoryDurationMinutes('14:00', ''), null);
  assert.equal(editor.categoryDurationMinutes('24:00', '15:00'), null);
  assert.match(editor.categoryDurationText({ categoryStartTime: '00:00:15', categoryEndTime: '01:30:45' }), /1시간 30분 30초/);
  assert.equal(editor.categoryTimeSeconds('00:60:00'), null);
});
