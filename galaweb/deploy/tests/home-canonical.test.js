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

test('the published Trivia entry links Home and the logo to the root without dropping campaign data', () => {
  const entry = read('trivia/index.html').match(/<script\b[^>]*type="module"[^>]*src="\/(trivia\/[^"]+\.js)"/);
  assert.ok(entry, 'Trivia module entry must exist');
  const bundle = read(entry[1]);
  assert.doesNotMatch(bundle, /index\.html/);
  assert.match(bundle, /utm_source=trivia&utm_medium=game&utm_campaign=site_nav/);
});
