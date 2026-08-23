'use strict';

/* =========================================================
   Pruebas — Segunda cuenta de Instagram y TikTok
   ---------------------------------------------------------
   El negocio añade una SEGUNDA cuenta:
     · Instagram @adventuregalapagos
     · TikTok    @galadventure
   Aparecen en: tarjeta digital (/tarjeta), sección "Síguenos"
   del inicio y el pie de página. La BARRA SUPERIOR se deja con
   las cuentas principales (no se duplican íconos idénticos).
   Editables desde /admin (campos 2ª cuenta → pie dinámico).
   Sin red ni BD: regex estructural sobre el código fuente.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const BASE = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }

const content = read('assets/js/content.js');
const app = read('assets/js/app.js');
const admin = read('assets/js/admin.js');
const index = read('index.html');
const tarjeta = read('tarjeta.html');

/* --- A) content.js: fuente de verdad de la 2ª cuenta ------------------ */
ok('1 content.js meta.instagram2 = adventuregalapagos', /instagram2:\s*"adventuregalapagos"/.test(content));
ok('2 content.js meta.tiktok2 = galadventure', /tiktok2:\s*"galadventure"/.test(content));
ok('3 conserva la cuenta principal de Instagram', /instagram:\s*"galapagoshookadventure"/.test(content));
ok('4 conserva la cuenta principal de TikTok', /tiktok:\s*"galapagoshookadve"/.test(content));

/* --- B) app.js: pie muestra la 2ª cuenta, cabecera NO ----------------- */
ok('5 pie: 2ª Instagram condicional a m.instagram2', /m\.instagram2\?'<a href="https:\/\/instagram\.com\/'\+m\.instagram2/.test(app));
ok('6 pie: 2ª TikTok condicional a m.tiktok2', /m\.tiktok2\?'<a href="https:\/\/tiktok\.com\/@'\+m\.tiktok2/.test(app));
ok('7 pie: si el handle está vacío NO se pinta (ternario :\'\')', /m\.instagram2\?[^]*?:''\)/.test(app) && /m\.tiktok2\?[^]*?:''\)/.test(app));
ok('8 pie: íconos con aria-label/título que incluye el @handle', /aria-label="Instagram @'\+m\.instagram2/.test(app) && /title="TikTok @'\+m\.tiktok2/.test(app));
ok('9 cabecera intacta: NO usa S.meta.instagram2 / S.meta.tiktok2', !/S\.meta\.instagram2/.test(app) && !/S\.meta\.tiktok2/.test(app));

/* --- C) inicio: sección "Síguenos" con las dos cuentas nuevas --------- */
ok('10 inicio: botón 2ª Instagram → adventuregalapagos', /instagram\.com\/adventuregalapagos/.test(index));
ok('11 inicio: botón 2ª TikTok → @galadventure', /tiktok\.com\/@galadventure/.test(index));
ok('12 inicio: conserva los botones principales', /instagram\.com\/galapagoshookadventure/.test(index) && /tiktok\.com\/@galapagoshookadve/.test(index));

/* --- D) tarjeta digital: botones + vCard ------------------------------ */
ok('13 tarjeta: botón 2ª Instagram con @adventuregalapagos visible', /@adventuregalapagos/.test(tarjeta) && /instagram\.com\/adventuregalapagos/.test(tarjeta));
ok('14 tarjeta: botón 2ª TikTok con @galadventure visible', /@galadventure/.test(tarjeta) && /tiktok\.com\/@galadventure/.test(tarjeta));
ok('15 tarjeta vCard: ambas Instagram como X-SOCIALPROFILE', /X-SOCIALPROFILE;TYPE=instagram:https:\/\/instagram\.com\/galapagoshookadventure/.test(tarjeta) && /X-SOCIALPROFILE;TYPE=instagram:https:\/\/instagram\.com\/adventuregalapagos/.test(tarjeta));
ok('16 tarjeta vCard: ambas TikTok como X-SOCIALPROFILE', /X-SOCIALPROFILE;TYPE=tiktok:https:\/\/tiktok\.com\/@galapagoshookadve/.test(tarjeta) && /X-SOCIALPROFILE;TYPE=tiktok:https:\/\/tiktok\.com\/@galadventure/.test(tarjeta));

/* --- E) admin: campos editables de la 2ª cuenta ----------------------- */
ok('17 admin: campo "Instagram handle (2nd account)" ligado a instagram2', /strField\('Instagram handle \(2nd account\)',m,'instagram2'\)/.test(admin));
ok('18 admin: campo "TikTok handle (2nd account)" ligado a tiktok2', /strField\('TikTok handle \(2nd account\)',m,'tiktok2'\)/.test(admin));

/* --- F) cache-busting: páginas públicas en hp9 ------------------------ */
ok('19 inicio actualizado a ?v=hp9 (no queda hp8)', /\?v=hp9/.test(index) && !/\?v=hp8/.test(index));
ok('20 contacto actualizado a ?v=hp9 (no queda hp8)', (function () { const c = read('contact.html'); return /\?v=hp9/.test(c) && !/\?v=hp8/.test(c); })());

/* ------------------------------------------------------------------ */
console.log('\n' + pass + ' PASS · ' + fail + ' FAIL');
if (fail) process.exit(1);
