const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('content.js', 'utf8');

test('recent registrations follow saved order regardless of score, name, or filters', () => {
  const ratings = [
    { id: 'new', name: 'New game', score: 40, recentRegistration: true },
    { id: 'second', name: '하늘의 궤적 the 2nd', score: 80 },
    { id: 'third', name: 'Third game', score: 90 },
    { id: 'old', name: '귀무자', score: 150 },
  ];
  const context = vm.createContext({
    state: { gameRatingFilters: { genre: '전체', search: 'absent', range: '', visible: 5 } },
    currentGameRatings: () => ratings,
    gameNameMatchesSearch: (name, query) => name.includes(query),
    gameRatingPosterHtml: () => '', escapeHtml: String,
    GAME_RATING_RANGES: [],
  });
  const start = source.indexOf('  function gameRatingsHtml()');
  const end = source.indexOf('  function bindGameRatingControls(', start);
  vm.runInContext(source.slice(start, end), context);
  const html = context.gameRatingsHtml();
  const recent = html.slice(html.indexOf('<section class="cs-rating-recent">'));
  assert.deepEqual([...recent.matchAll(/id="cs-rating-recent-([^"]+)"/g)].map(m => m[1]),
    ['new', 'second', 'old']);
  ratings.shift();
  const initial = context.gameRatingsHtml().split('<section class="cs-rating-recent">')[1];
  assert.deepEqual([...initial.matchAll(/id="cs-rating-recent-([^"]+)"/g)].map(m => m[1]),
    ['second', 'old']);
  ratings.length = 0;
  assert.doesNotThrow(() => context.gameRatingsHtml());
});
