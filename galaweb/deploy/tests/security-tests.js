'use strict';

/* =========================================================
   Pruebas de regresión de SEGURIDAD (endurecimiento sec/hardening)
   ---------------------------------------------------------
   Fijan los arreglos de la auditoría para que no regresen:
   IP confiable, rate-limit, login sin enumeración, cabeceras/CSP,
   XSS body_html en iframe, staff sin cuerpo de comms, guarda de webhook,
   allowlist de búsqueda y self-hosting de d3/topojson.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const BASE = path.resolve(__dirname, '..');
const vt = require(BASE + '/server/lib/visit-tracking');
const http = require(BASE + '/server/lib/http');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }

/* ---- IP de cliente CONFIABLE (no el primer hop falsificable) ---- */
ok('1 clientIp: ignora el primer hop falsificable de XFF (usa el último)',
  http.clientIp({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }) === '203.0.113.9');
ok('2 clientIp: prefiere x-vercel-forwarded-for', http.clientIp({ 'x-vercel-forwarded-for': '1.1.1.1', 'x-forwarded-for': '6.6.6.6' }) === '1.1.1.1');
ok('3 clientIp: prefiere x-real-ip sobre XFF', http.clientIp({ 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '6.6.6.6' }) === '2.2.2.2');
ok('4 visit-tracking reexporta el clientIp confiable', vt.clientIp === http.clientIp);
ok('5 rateBucket: no contiene la IP en claro', vt.rateBucket('203.0.113.9').indexOf('203.0.113.9') === -1 && /^track:[0-9a-f]{40}$/.test(vt.rateBucket('x')));

/* ---- sanitizePath: sin metacaracteres HTML (defensa en profundidad) ---- */
ok('6 sanitizePath quita < > " \' `', vt.sanitizePath('/a<img src=x onerror=alert(1)>') && !/[<>"\'`]/.test(vt.sanitizePath('/a<img src=x onerror=alert(1)>')));

/* ---- login: sin enumeración + throttle durable + IP confiable ---- */
const login = read('server/admin-handlers/login.js');
ok('7 login importa clientIp confiable de http', /clientIp\s*}\s*=\s*require\('\.\.\/lib\/http'\)/.test(login) || /getTenantId, clientIp/.test(login));
ok('8 login: 401 idéntico (ya NO responde 403 NO_ACCESS que revelaba la cuenta)', !/NO_ACCESS/.test(login) && (login.match(/INVALID_CREDENTIALS/g) || []).length >= 2);
ok('9 login: throttle DURABLE respaldado en BD (rate_limit_hits) + 429', /rate_limit_hits/.test(login) && /TOO_MANY_ATTEMPTS/.test(login));

/* ---- cabeceras de seguridad + CSP ---- */
const vercel = JSON.parse(read('vercel.json'));
const globalRule = (vercel.headers || []).find(function (h) { return h.source === '/(.*)'; });
const gk = globalRule ? globalRule.headers.reduce(function (m, x) { m[x.key] = x.value; return m; }, {}) : {};
ok('10 X-Frame-Options: DENY (clickjacking)', gk['X-Frame-Options'] === 'DENY');
ok('11 X-Content-Type-Options: nosniff', gk['X-Content-Type-Options'] === 'nosniff');
ok('12 HSTS presente', /max-age=\d+/.test(gk['Strict-Transport-Security'] || ''));
ok('13 Referrer-Policy presente', /strict-origin/.test(gk['Referrer-Policy'] || ''));
ok('14 Permissions-Policy permite payment a Stripe', /payment=\(self "https:\/\/js\.stripe\.com"\)/.test(gk['Permissions-Policy'] || ''));
const adminRule = (vercel.headers || []).find(function (h) { return h.source === '/admin.html'; });
const csp = adminRule ? (adminRule.headers.find(function (x) { return x.key === 'Content-Security-Policy'; }) || {}).value || '' : '';
ok('15 CSP admin: script-src \'self\' (sin unsafe-inline → bloquea XSS)', /script-src 'self'(;| )/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp));
ok('16 CSP admin: frame-ancestors none + object-src none', /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp));
ok('17 CSP admin: connect a Supabase (subida) y frame-src self (iframe del correo)', /connect-src 'self' https:\/\/\*\.supabase\.co/.test(csp) && /frame-src 'self'/.test(csp));

/* ---- XSS body_html en iframe aislado ---- */
const adm = read('assets/js/admin.js');
ok('18 admin.js: el body_html YA NO se inyecta crudo en innerHTML', !/'<div class="bk-msg-body">'\+m\.body_html/.test(adm));
ok('19 admin.js: body_html se renderiza en iframe sandbox (sin allow-scripts)', /setAttribute\('sandbox','allow-same-origin'\)/.test(adm) && /f\.srcdoc\s*=\s*m\.body_html/.test(adm));

/* ---- staff sin cuerpo de comunicaciones ---- */
const detail = read('server/admin-handlers/booking-communication-detail.js');
ok('20 comm-detail: staff no recibe body_html/body_text', /isStaff \? null : \(d\.body_html/.test(detail) && /isStaff \? null :/.test(detail));

/* ---- guarda de estado terminal en el webhook ---- */
const wh = read('api/stripe-webhook.js');
ok('21 webhook: succeeded no re-confirma reserva reembolsada/cancelada',
  /payment_status === 'refunded' \|\| booking\.booking_status === 'cancelled'/.test(wh));

/* ---- allowlist de búsqueda (.or() sin breakout) ---- */
['bookings', 'test-data-list', 'notifications-list'].forEach(function (f, i) {
  const src = read('server/admin-handlers/' + f + '.js');
  ok('22.' + (i + 1) + ' ' + f + ': sanitizeSearch usa ALLOWLIST', /\[\^0-9A-Za-zÀ-ÿ @\._-\]/.test(src));
});

/* ---- supply chain: d3/topojson auto-alojados ---- */
const idx = read('index.html');
ok('23 index.html: sin scripts de cdn.jsdelivr (auto-alojados)', !/cdn\.jsdelivr\.net/.test(idx) && /assets\/js\/vendor\/d3\.min\.js/.test(idx));
ok('24 vendor: d3 y topojson presentes en el repo', fs.existsSync(path.join(BASE, 'assets/js/vendor/d3.min.js')) && fs.existsSync(path.join(BASE, 'assets/js/vendor/topojson-client.min.js')));

/* ---- higiene: README de pagos fuera de /assets (no se sirve al navegador) ---- */
ok('25 PAYMENTS-README ya no está en /assets', !fs.existsSync(path.join(BASE, 'assets/PAYMENTS-README.txt')));

/* ------------------------------------------------------------------ */
console.log('\n' + pass + ' PASS · ' + fail + ' FAIL');
if (fail) process.exit(1);
