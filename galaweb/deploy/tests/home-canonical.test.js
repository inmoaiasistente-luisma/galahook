const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');

const read = (path) => readFileSync(join(__dirname, '..', path), 'utf8');

test('only the old home path redirects permanently to the root', () => {
  const { redirects, rewrites } = JSON.parse(read('vercel.json'));
  const legacy = redirects.filter(({ source }) => source === '/index.html');
  assert.deepEqual(legacy, [{ source: '/index.html', destination: '/', permanent: true }]);
  assert.ok(!redirects.some(({ source }) => source === '/'));
  assert.ok(rewrites.some(({ source, destination }) =>
    source === '/trivia/(.*)' && destination === '/trivia/index.html'));
});

test('the site navigation, breadcrumbs, reviews and admin links go directly home', () => {
  const pages = ['about', 'conservation', 'contact', 'legal', 'packages',
    'security-policy', 'sport-fishing', 'terms', 'tours', 'resena'];
  const paths = [...pages.map((page) => page + '.html'), 'assets/js/app.js', 'assets/js/admin.js'];
  const obsolete = paths.flatMap((path) =>
    /\bhref\s*[:=]\s*["']\/?index\.html(?=[#?"'])/i.test(read(path)) ? [path] : []);
  assert.deepEqual(obsolete, []);
  for (const path of paths) assert.match(read(path), /\bhref\s*[:=]\s*["']\/["']/, path);
});
