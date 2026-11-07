'use strict';

/* =========================================================
   Pruebas — Reseñas por QR (lo que llega al navegador)
   ---------------------------------------------------------
   Revisa los archivos que se publican: que nada del mockup se cuele,
   que el texto de un pasajero nunca se pinte como HTML, y que QR,
   volante, panel y privacidad estén conectados. El comportamiento real
   se comprueba además en el navegador.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const BASE = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(BASE, rel)); }

const page = read('resena.html');
const pageJs = read('assets/js/resena.js');
const wallJs = read('assets/js/reviews.js');
const css = read('assets/css/reviews.css');
const home = read('index.html');
const adminJs = read('assets/js/admin-reviews.js');
const adminCss = read('assets/css/admin-reviews.css');
const adminHtml = read('admin.html');
const adminMain = read('assets/js/admin.js');
const privacy = read('security-policy.html');
const sitemap = read('sitemap.xml');

/* ---------------- nada del mockup ---------------- */
const shipped = { 'resena.html': page, 'resena.js': pageJs, 'reviews.js': wallJs, 'reviews.css': css, 'index.html': home, 'admin-reviews.js': adminJs, 'admin-reviews.css': adminCss };
Object.keys(shipped).forEach(function (f) {
  const t = shipped[f];
  ok('1 ' + f + ' sin rastros del mockup', !/mockup|demo-note|rv-sample|rs-demo|admin-demo|qa\.js/i.test(t));
  ok('2 ' + f + ' sin reseñas de ejemplo', !/Camila|Daniel M\.|Mariana G\.|Anna K\.|Peter W\./.test(t));
  ok('3 ' + f + ' sin modos de prueba', !/[?&]error=1|[?&]vacio=1|failOnce/.test(t));
});

/* ---------------- /resena ---------------- */
ok('4 /resena no se indexa', /<meta name="robots" content="noindex">/.test(page));
ok('5 /resena fuera del sitemap', sitemap.indexOf('resena') === -1);
ok('6 botones de idioma EN y ES', /data-lang="en"/.test(page) && /data-lang="es"/.test(page));
ok('7 honeypot presente', /name="company"/.test(page));
ok('8 aviso menciona traducción en ES', /traducida si hace falta/.test(page));
ok('9 aviso menciona traducción en EN', /translated if needed/.test(page));
ok('10 enlace a privacidad', /href="security-policy\.html"/.test(page));
ok('11 límites iguales al servidor', /id="rsText"[^>]*maxlength="1000"/.test(page) && /id="rsName"[^>]*maxlength="80"/.test(page));
ok('12 sin JavaScript queda un camino a Google', /<noscript>[\s\S]*writereview\?placeid=[\s\S]*<\/noscript>/.test(page));
ok('13 guarda de verdad en /api/reviews', /fetch\('\/api\/reviews'/.test(pageJs));
ok('14 el guardado sobrevive a salir hacia Google', /keepalive:\s*true/.test(pageJs));
ok('15 sin guardado simulado', pageJs.indexOf('setTimeout') === -1);
ok('16 reintenta con la misma clave', /client_key:\s*clientKey/.test(pageJs));
ok('17 enlace real de Google', pageJs.indexOf('writereview?placeid=ChIJ5VCfRXvpAJARW1i9n5H4ht4') !== -1);
ok('18 mismo idioma guardado que el sitio', /GHA_LANG/.test(pageJs));
ok('19 el nombre y el texto se pintan como texto', /\$\('rsOutText'\)\.textContent/.test(pageJs) && /\$\('rsOutName'\)\.textContent/.test(pageJs));
ok('19b si toca Google durante el guardado, el panel igual se entera', /if\(viaGoogle&&!sentGoogle\)\{save\(\);return;\}/.test(pageJs));

/* ---------------- inicio ---------------- */
ok('20 sección en el inicio', /<section class="section rv" id="resenas">/.test(home));
ok('21 va después del mosaico y antes del cierre', home.indexOf('id="mosaic"') < home.indexOf('id="resenas"') && home.indexOf('id="resenas"') < home.indexOf('Ready when you are'));
ok('22 arranca vacía hasta que llegan datos', /class="rv-wall is-empty" id="rvWall"/.test(home));
ok('23 la nota de Google arranca oculta', /class="rv-score" id="rvScore" hidden/.test(home));
ok('24 hoja y script cargados', /assets\/css\/reviews\.css/.test(home) && /assets\/js\/reviews\.js/.test(home));
ok('25 script después de app.js', home.indexOf('assets/js/app.js') < home.indexOf('assets/js/reviews.js'));
ok('26 el muro lee /api/reviews', /fetch\('\/api\/reviews'/.test(wallJs));
ok('27 ABUSO el muro nunca usa innerHTML', wallJs.indexOf('innerHTML') === -1 && wallJs.indexOf('insertAdjacentHTML') === -1);
ok('28 las tarjetas nuevas no usan .reveal', wallJs.indexOf('reveal') === -1);
ok('29 texto traducible por el mecanismo del sitio', /dataset\.en/.test(wallJs) && /dataset\.es/.test(wallJs));
ok('30 data-html nunca entra en el muro', wallJs.indexOf('data-html') === -1);
ok('31 oculta la nota si no hay datos', /\.rv-score\[hidden\]/.test(css));

/* ---------------- panel ---------------- */
ok('32 CSS del panel cargado', /assets\/css\/admin-reviews\.css/.test(adminHtml));
ok('33 panel cargado antes de admin.js', adminHtml.indexOf('assets/js/admin-reviews.js') < adminHtml.indexOf('assets/js/admin.js') && adminHtml.indexOf('assets/js/admin-reviews.js') !== -1);
ok('34 entrada en el menú', /id:'reviews'/.test(adminMain) && /ghaPanelReviews/.test(adminMain));
ok('35 insignia de pendientes', /rvBadge/.test(adminMain));
ok('36 ABUSO el panel pinta reseñas solo como texto', adminJs.indexOf('innerHTML') === -1 && adminJs.indexOf('insertAdjacentHTML') === -1);
ok('37 todos los endpoints del panel', ['/api/admin-reviews', '/api/admin-review-update', '/api/admin-review-translate', '/api/admin-review-settings-save'].every(function (u) { return adminJs.indexOf(u) !== -1; }));
ok('38 nunca dice que publicó en Google', /Abrió Google/.test(adminJs) && !/Publicó en Google/i.test(adminJs));
ok('39 recuerda que una nota baja no se rechaza', /nota baja no es motivo/.test(adminJs));
ok('40 motivos iguales al servidor', ['spam', 'abuse', 'third_party_data', 'not_passenger'].every(function (k) { return adminJs.indexOf(k) !== -1; }));
ok('41 viajes iguales al servidor', ['day_tour', 'sport_fishing', 'all_inclusive', 'diving', 'private_trip'].every(function (k) { return adminJs.indexOf(k) !== -1 && wallJs.indexOf(k) !== -1; }));
ok('42 solo el owner ve acciones', /canWrite/.test(adminJs));

/* ---------------- QR y volante ---------------- */
ok('43 QR en el sitio', exists('assets/img/qr-resena.svg'));
ok('44 QR como una sola forma', (read('assets/img/qr-resena.svg').match(/<path/g) || []).length === 1);
ok('45 volante en el sitio', exists('assets/volante-resenas-a5.pdf'));

/* ---------------- privacidad ---------------- */
ok('46 privacidad cubre reseñas EN', /Reviews\./.test(privacy) && /Reseñas\./.test(privacy));
ok('47 privacidad nombra a Anthropic', /Anthropic/.test(privacy));
ok('48 privacidad nombra a Google en terceros', /Google Reviews|reseñas de Google/.test(privacy));

/* ---------------- secretos ---------------- */
Object.keys(shipped).forEach(function (f) {
  ok('49 ' + f + ' sin secretos', !/ANTHROPIC_API_KEY|sb_secret_|sk-ant-/.test(shipped[f]));
});

console.log('\n' + pass + ' PASS, ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
