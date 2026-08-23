'use strict';

/* =========================================================
   Pruebas — Admin PWA (icono de app + diseño móvil Diseño 3)
   ---------------------------------------------------------
   A) Manifest + iconos (el icono de la app es el logo, no la "A").
   B) Layout móvil: lista de secciones → panel a pantalla completa + "← Menú".
      El escritorio NO cambia. Sin datos/permisos tocados.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const BASE = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }

/* =======================================================================
   A) MANIFEST + ICONOS
   ======================================================================= */
ok('1 app-icon.png existe', fs.existsSync(path.join(BASE, 'assets/img/app-icon.png')));
ok('2 app-icon.png es PNG 512x512', (function () {
  const b = fs.readFileSync(path.join(BASE, 'assets/img/app-icon.png'));
  return b.slice(1, 4).toString() === 'PNG' && b.readUInt32BE(16) === 512 && b.readUInt32BE(20) === 512;
})());

const man = JSON.parse(read('admin-manifest.json'));
ok('3 manifest short_name Hook Admin', man.short_name === 'Hook Admin');
ok('4 manifest display standalone', man.display === 'standalone');
ok('5 manifest start_url /admin.html', man.start_url === '/admin.html');
ok('6 manifest theme/background de marca', man.theme_color === '#08201f' && man.background_color === '#0d2b2a');
ok('7 manifest icono = app-icon.png', Array.isArray(man.icons) && man.icons.some(function (i) { return i.src === '/assets/img/app-icon.png'; }));
ok('8 manifest incluye icono maskable', man.icons.some(function (i) { return String(i.purpose || '').indexOf('maskable') !== -1; }));

const html = read('admin.html');
ok('9 admin.html enlaza el manifest', /rel="manifest"\s+href="\/admin-manifest\.json"/.test(html));
ok('10 admin.html apple-touch-icon = app-icon', /rel="apple-touch-icon"\s+href="\/assets\/img\/app-icon\.png"/.test(html));
ok('11 admin.html theme-color verde marca', /name="theme-color"\s+content="#08201f"/.test(html));
ok('12 admin.html apple-mobile-web-app-capable', /apple-mobile-web-app-capable"\s+content="yes"/.test(html));
ok('13 admin.html título de app "Hook Admin"', /apple-mobile-web-app-title"\s+content="Hook Admin"/.test(html));
ok('14 admin.html viewport-fit=cover (notch/safe-area)', /viewport-fit=cover/.test(html));

/* =======================================================================
   B) LAYOUT MÓVIL (CSS)
   ======================================================================= */
ok('15 CSS: al abrir panel se oculta la lista', /\.admin-body\.panel-open \.admin-nav\{display:none/.test(html));
ok('16 CSS: sin panel abierto se oculta el contenido (muestra la lista)', /\.admin-body:not\(\.panel-open\) \.admin-main\{display:none/.test(html));
ok('17 CSS: botón "← Menú" oculto en escritorio, visible en móvil',
  /\.adm-back\{display:none;/.test(html) && /\.adm-back\{display:inline-flex;\}/.test(html));
ok('18 CSS: filas de lista con chevron a la derecha', /\.admin-nav button::after\{content:'\\203a'/.test(html));
ok('19 CSS: filas altas y a ancho completo (móvil)', /\.admin-nav button\{width:100%;[^}]*min-height:52px/.test(html));
ok('20 CSS: declutter topbar (nombre y View site fuera en móvil)', /\.top-who,\.top-view\{display:none;\}/.test(html));
ok('21 CSS: reglas solo dentro de @media max-width:760',
  (function () { const i = html.indexOf('@media(max-width:760px)'); return i !== -1 && html.indexOf('.admin-body.panel-open') > i; })());
ok('22 admin.html cache-buster nuevo (pwa3)', /admin\.js\?v=pwa3/.test(html));

/* =======================================================================
   C) LAYOUT MÓVIL (JS admin.js)
   ======================================================================= */
const adm = read('assets/js/admin.js');
ok('23 admin.js: botón back con clase adm-back', /class="adm-back"/.test(adm));
ok('24 admin.js: backToList quita panel-open', /function backToList\(\)\{[^}]*classList\.remove\('panel-open'\)/.test(adm));
ok('25 admin.js: open() marca panel-open', /classList\.add\('panel-open'\)/.test(adm));
ok('26 admin.js: móvil arranca en la lista (no abre panel)', /matchMedia\('\(max-width:760px\)'\)/.test(adm) && /if\(mobileNav\)\{[^}]*remove\('panel-open'\)/.test(adm));
ok('27 admin.js: escritorio sigue abriendo el primer panel', /else \{ open\(PANELS\[0\]\.id\); \}/.test(adm));
ok('28 admin.js: clases top-who / top-view para declutter', /class="top-who"/.test(adm) && /mini-btn top-view/.test(adm));

/* ------------------------------------------------------------------ */
console.log('\n' + pass + ' PASS · ' + fail + ' FAIL');
if (fail) process.exit(1);
