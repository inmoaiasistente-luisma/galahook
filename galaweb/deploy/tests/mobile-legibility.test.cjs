// Run with Node's test runner and Playwright available (PLAYWRIGHT_MODULE can
// point to an existing installation). BROWSER_CHANNEL may select Edge/Chrome.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdir, readFile } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const origin = 'http://galapagos.test';
const types = { html: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json', webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml', woff2: 'font/woff2' };

async function open(context, route, lang) {
  const page = await context.newPage();
  await page.route('**/*', async request => {
    const url = new URL(request.request().url());
    if (url.origin !== origin || request.request().method() !== 'GET' || url.pathname.startsWith('/api/')) return request.abort();
    const file = path.resolve(root, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    const type = types[path.extname(file).slice(1)];
    if (!file.startsWith(root + path.sep) || !type) return request.abort();
    try { await request.fulfill({ body: await readFile(file), contentType: type }); }
    catch (err) { if (err.code !== 'ENOENT') throw err; await request.fulfill({ status: 404 }); }
  });
  await page.addInitScript(value => localStorage.setItem('GHA_LANG', value), lang);
  await page.goto(`${origin}/${route}`, { waitUntil: 'load' });
  return page;
}

function contrast(fg, bg, opacity) {
  const rgb = color => color.match(/[\d.]+/g).map(Number);
  const background = rgb(bg);
  const foreground = rgb(fg);
  const alpha = (foreground[3] ?? 1) * opacity;
  const luminance = color => color.map(n => n / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
    .reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
  const a = luminance(background), b = luminance(background.map((v, i) => v * (1 - alpha) + foreground[i] * alpha));
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

test('Galápagos: interior legibility, touch targets and mobile reflow in Spanish and English', async t => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL });
  t.after(() => browser.close());

  await t.test('hero labels stay readable and pause has a full-size touch target', async () => {
    const context = await browser.newContext({ viewport: { width: 320, height: 720 } });
    try {
      const page = await open(context, 'about.html', 'es');
      const size = selector => page.locator(selector).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      const dock = await size('.ph-dock');
      const breadcrumb = await size('.ph .breadcrumb');
      const pauseButton = page.getByRole('button', { name: 'Pausar video' });
      const pause = await pauseButton.boundingBox();
      assert.ok(dock >= 12 && breadcrumb >= 12 && pause?.width >= 44 && pause.height >= 44,
        `320px: dock ${dock}px, breadcrumb ${breadcrumb}px, pause ${pause?.width}×${pause?.height}px`);
      await pauseButton.press('Space');
      assert.equal(await page.getByRole('button', { name: 'Reproducir video' }).getAttribute('aria-pressed'), 'true');
    } finally { await context.close(); }
  });

  await t.test('legal update dates are readable on their actual paper surface', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    try {
      for (const route of ['legal.html', 'security-policy.html']) {
        const page = await open(context, route, 'es');
        const ratio = contrast(...await page.locator('.legal-doc .updated').first().evaluate(el => {
          const style = getComputedStyle(el);
          return [style.color, getComputedStyle(el.closest('.paper-bg')).backgroundColor, Number(style.opacity)];
        }));
        assert.ok(ratio >= 4.5, `${route}: effective date contrast ${ratio.toFixed(2)}:1`);
        await page.close();
      }
    } finally { await context.close(); }
  });

  await t.test('contact form keeps usable interior width without losing its inset', async () => {
    const context = await browser.newContext({ viewport: { width: 320, height: 720 }, reducedMotion: 'reduce' });
    try {
      const page = await open(context, 'contact.html', 'es');
      const padding = await page.locator('form[data-contact]').evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
      const input = page.locator('input[name=email]');
      const width = (await input.boundingBox()).width;
      const font = await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      assert.ok(padding >= 16 && width >= 240 && font >= 16, `320px: form padding ${padding}px, input ${width}px wide, font ${font}px`);
      const label = await input.evaluate(el => {
        const form = el.closest('form');
        return { fg: getComputedStyle(el, '::placeholder').color, surfaces: [el, form, form.closest('section')].map(node => getComputedStyle(node).backgroundColor) };
      });
      const background = label.surfaces.map(color => color.match(/[\d.]+/g).map(Number)).reduceRight((base, layer) =>
        base ? base.map((n, i) => n * (1 - (layer[3] ?? 1)) + layer[i] * (layer[3] ?? 1)) : layer, null);
      assert.ok(contrast(label.fg, `rgb(${background.join(',')})`, 1) >= 4.5, 'Placeholder must contrast with both dark layers');
    } finally { await context.close(); }
  });

  await t.test('mobile menu has usable language controls even after scrolling', async () => {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 }, reducedMotion: 'reduce', hasTouch: true });
    try {
      const page = await open(context, 'about.html', 'en');
      await page.evaluate(() => scrollTo(0, 260));
      await page.locator('#site-header.scrolled').waitFor();
      await page.locator('#navToggle').tap();
      const switcher = page.locator('.mobile-lang [data-lang=es]');
      assert.ok(await switcher.isVisible(), 'Spanish switch is not visible in the mobile menu');
      const target = await switcher.boundingBox();
      assert.ok(target.width >= 44 && target.height >= 44, 'Language switch target is smaller than 44×44');
      await switcher.tap();
      assert.equal(await page.locator('html').getAttribute('lang'), 'es');
    } finally { await context.close(); }
  });

  await t.test('public pages reflow in both languages without clipping content', async () => {
    for (const width of [320, 375, 390, 430, 620, 621, 768, 1366]) {
      const context = await browser.newContext({ viewport: { width, height: width >= 768 ? 900 : 844 }, reducedMotion: 'reduce', hasTouch: width < 768 });
      try {
        for (const lang of ['en', 'es']) {
          for (const route of ['', 'about.html', 'conservation.html', 'contact.html', 'packages.html', 'legal.html', 'security-policy.html']) {
            const page = await open(context, route, lang);
            const details = await page.evaluate(() => {
              const h1 = document.querySelector('h1');
              const range = document.createRange();
              range.selectNodeContents(h1);
              const { left, right } = range.getBoundingClientRect();
              return { lang: document.documentElement.lang, overflow: document.documentElement.scrollWidth - innerWidth, headingFits: left >= -1 && right <= innerWidth + 1 };
            });
            assert.deepEqual(details, { lang, overflow: 0, headingFits: true }, `${width}px ${lang} /${route}`);
            if (process.env.QA_SCREENSHOTS && lang === 'es' && width === 390 && ['about.html', 'contact.html', 'legal.html'].includes(route)) {
              await mkdir(process.env.QA_SCREENSHOTS, { recursive: true });
              if (route === 'contact.html') await page.locator('form[data-contact]').scrollIntoViewIfNeeded();
              if (route === 'legal.html') await page.locator('.legal-doc .updated').first().scrollIntoViewIfNeeded();
              await page.screenshot({ path: path.join(process.env.QA_SCREENSHOTS, `${route.slice(0, -5)}-390.png`), animations: 'disabled' });
            }
            await page.close();
          }
        }
      } finally { await context.close(); }
    }
  });
});
