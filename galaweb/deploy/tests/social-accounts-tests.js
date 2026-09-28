'use strict';

/* =========================================================
   Pruebas — Retiro de la segunda cuenta de Instagram y TikTok
   ---------------------------------------------------------
   El negocio pidió retirar la SEGUNDA cuenta ("Adventure
   Galápagos"): Instagram @adventuregalapagos y TikTok
   @galadventure. Solo deben quedar las cuentas ORIGINALES
   (@galapagoshookadventure / @galapagoshookadve) en: content.js
   (fuente de verdad), pie de página (app.js), sección "Síguenos"
   del inicio, tarjeta digital (botones + vCard) y el editor
   de /admin.
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

/* --- A) content.js: la 2ª cuenta ya no existe como fuente de verdad --- */
ok('1 content.js ya NO define meta.instagram2', !/instagram2\s*:/.test(content));
ok('2 content.js ya NO define meta.tiktok2', !/tiktok2\s*:/.test(content));
ok('3 conserva la cuenta principal de Instagram', /instagram:\s*"galapagoshookadventure"/.test(content));
ok('4 conserva la cuenta principal de TikTok', /tiktok:\s*"galapagoshookadve"/.test(content));

/* --- B) app.js: el pie ya no referencia la 2ª cuenta ------------------ */
ok('5 pie: ya NO referencia m.instagram2', !/m\.instagram2/.test(app));
ok('6 pie: ya NO referencia m.tiktok2', !/m\.tiktok2/.test(app));
ok('7 pie: conserva el link de la Instagram principal', /instagram\.com\/'\+m\.instagram\+/.test(app));
ok('8 pie: conserva el link de la TikTok principal', /tiktok\.com\/@'\+m\.tiktok\+/.test(app));
ok('9 cabecera sigue sin usar S.meta.instagram2 / S.meta.tiktok2', !/S\.meta\.instagram2/.test(app) && !/S\.meta\.tiktok2/.test(app));

/* --- C) inicio: sección "Síguenos" solo con las cuentas originales ---- */
ok('10 inicio: ya NO hay botón a adventuregalapagos', !/instagram\.com\/adventuregalapagos/.test(index));
ok('11 inicio: ya NO hay botón a @galadventure', !/tiktok\.com\/@galadventure/.test(index));
ok('12 inicio: conserva los botones principales', /instagram\.com\/galapagoshookadventure/.test(index) && /tiktok\.com\/@galapagoshookadve/.test(index));

/* --- D) tarjeta digital: botones + vCard sin la 2ª cuenta ------------- */
ok('13 tarjeta: ya NO hay botón a @adventuregalapagos', !/adventuregalapagos/.test(tarjeta));
ok('14 tarjeta: ya NO hay botón a @galadventure', !/galadventure/.test(tarjeta));
ok('15 tarjeta: conserva los botones principales', /instagram\.com\/galapagoshookadventure/.test(tarjeta) && /tiktok\.com\/@galapagoshookadve/.test(tarjeta));
ok('16 tarjeta vCard: solo la Instagram principal como X-SOCIALPROFILE', /X-SOCIALPROFILE;TYPE=instagram:https:\/\/instagram\.com\/galapagoshookadventure/.test(tarjeta) && !/X-SOCIALPROFILE;TYPE=instagram:https:\/\/instagram\.com\/adventuregalapagos/.test(tarjeta));
ok('17 tarjeta vCard: solo la TikTok principal como X-SOCIALPROFILE', /X-SOCIALPROFILE;TYPE=tiktok:https:\/\/tiktok\.com\/@galapagoshookadve/.test(tarjeta) && !/X-SOCIALPROFILE;TYPE=tiktok:https:\/\/tiktok\.com\/@galadventure/.test(tarjeta));

/* --- E) admin: los campos editables de la 2ª cuenta ya no existen ----- */
ok('18 admin: ya NO tiene campo "Instagram handle (2nd account)"', !/Instagram handle \(2nd account\)/.test(admin));
ok('19 admin: ya NO tiene campo "TikTok handle (2nd account)"', !/TikTok handle \(2nd account\)/.test(admin));
ok('20 admin: conserva los campos de la cuenta principal', /strField\('Instagram handle',m,'instagram'\)/.test(admin) && /strField\('TikTok handle',m,'tiktok'\)/.test(admin));

/* --- F) cache-busting: páginas públicas en hp10 ------------------------ */
ok('21 inicio en ?v=hp10', /\?v=hp10/.test(index));
ok('22 contacto en ?v=hp10', (function () { const c = read('contact.html'); return /\?v=hp10/.test(c); })());

/* ------------------------------------------------------------------ */
console.log('\n' + pass + ' PASS · ' + fail + ' FAIL');
if (fail) process.exit(1);
