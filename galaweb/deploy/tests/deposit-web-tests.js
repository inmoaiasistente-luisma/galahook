'use strict';

/* =========================================================
   Pruebas — Depósito del 30 %: UI del checkout y página /saldo
   (Tarea 10). Sin red, sin DB: carga content.js y deposit-ui.js
   en un vm con un DOM mínimo y revisa el código fuente de
   app.js, saldo.js y las páginas.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(BASE, rel)); }

/* ---- content.js + deposit-ui.js en un sandbox ---- */
const box = { window: {} };
vm.runInNewContext(read('assets/js/content.js'), box);
const S = box.window.GHA_DEFAULT;
const D = S.deposit || {};

/* DOM mínimo: guarda el HTML y captura el listener de 'change'. */
function makeEl() {
  const el = { innerHTML: '', handlers: {} };
  el.addEventListener = function (ev, fn) { el.handlers[ev] = fn; };
  el.querySelector = function () { return null; };
  el.querySelectorAll = function () { return []; };
  return el;
}
function loadUi() {
  const sb = { window: {}, console: console };
  sb.window.window = sb.window;
  vm.runInNewContext(read('assets/js/deposit-ui.js'), sb);
  return sb.window.GHADeposit;
}

/* ---------------- 1 · S.deposit bilingüe ---------------- */
const keys = Object.keys(D);
ok('1 S.deposit existe y tiene claves', keys.length >= 15);
ok('2 cada clave de S.deposit tiene EN y ES no vacíos',
  keys.length > 0 && keys.every(function (k) { return D[k] && typeof D[k].en === 'string' && D[k].en.trim() && typeof D[k].es === 'string' && D[k].es.trim(); }));
ok('3 el texto de aceptación usa {deposit} {balance} {due} en EN y ES',
  ['en', 'es'].every(function (l) { const a = (D.ack || {})[l] || ''; return /\{deposit\}/.test(a) && /\{balance\}/.test(a) && /\{due\}/.test(a); }));
ok('4 el ES de la aceptación menciona 30 %, cancelación y depósito sin reembolso',
  /30 %/.test((D.ack || {}).es || '') && /se cancela/.test((D.ack || {}).es || '') && /no se reembolsa/.test((D.ack || {}).es || ''));

/* ---------------- 2 · GHADeposit.render ---------------- */
ok('5 deposit-ui.js existe', exists('assets/js/deposit-ui.js'));
const G = exists('assets/js/deposit-ui.js') ? loadUi() : null;
ok('6 expone render/plan/ack/reset', !!G && ['render', 'plan', 'ack', 'reset'].every(function (f) { return typeof G[f] === 'function'; }));

const INFO = { eligible: true, reason: null, pct: 30, depositCents: 36000, balanceCents: 84000, balanceDueDate: '2027-03-04', depositRefundableUntil: '2027-02-02', termsVersion: '2026-11-26' };
let el = makeEl(), html = '';
if (G) { G.reset(); G.render(el, INFO, 'es', S); html = el.innerHTML; }
const radios = html.match(/<input[^>]*type="radio"[^>]*>/g) || [];
ok('7 elegible: dos radios (full y deposit)', radios.length === 2 && /value="full"/.test(radios[0]) && /value="deposit"/.test(radios[1]));
ok('8 elegible: "full" viene marcado por defecto y "deposit" no', /checked/.test(radios[0] || '') && !/checked/.test(radios[1] || ''));
const ackIn = (html.match(/<input[^>]*id="bkDepAck"[^>]*>/) || [''])[0];
ok('9 elegible: casilla de aceptación presente, sin marcar', /type="checkbox"/.test(ackIn) && !/checked/.test(ackIn));
ok('10 elegible: muestra depósito $360, saldo $840 y la fecha límite', /\$360/.test(html) && /\$840/.test(html) && /2027/.test(html) && /mar/i.test(html));
ok('11 elegible: no quedan placeholders sin sustituir', !/\{(deposit|balance|due|total|amount)\}/.test(html));
ok('12 elegible: el total ($1,200) aparece en la opción de pago completo', /\$1,200/.test(html));
ok('13 por defecto plan() es full y ack() es null', !!G && G.plan() === 'full' && G.ack() === null);

/* interacción: el listener de change cambia el plan y la aceptación */
if (G && el.handlers.change) {
  el.handlers.change({ target: { name: 'bkPlanOpt', value: 'deposit', checked: true } });
  const p1 = G.plan(), a1 = G.ack();
  el.handlers.change({ target: { id: 'bkDepAck', checked: true } });
  const a2 = G.ack();
  ok('14 elegir depósito: plan()=deposit y ack() sigue null hasta marcar la casilla', p1 === 'deposit' && a1 === null);
  ok('15 marcar la casilla: ack() = {accepted:true, version}', !!a2 && a2.accepted === true && a2.version === '2026-11-26');
  el.handlers.change({ target: { name: 'bkPlanOpt', value: 'full', checked: true } });
  ok('16 volver a pago completo anula ack()', G.plan() === 'full' && G.ack() === null);
} else { ok('14 listener de change registrado', false); ok('15 ack tras marcar', false); ok('16 volver a full', false); }

/* reset limpia plan y aceptación */
if (G && el.handlers.change) {
  el.handlers.change({ target: { name: 'bkPlanOpt', value: 'deposit', checked: true } });
  el.handlers.change({ target: { id: 'bkDepAck', checked: true } });
  G.reset();
  ok('17 reset(): plan full y sin aceptación', G.plan() === 'full' && G.ack() === null);
} else ok('17 reset', false);

/* si cambia el monto/fecha, la aceptación se limpia */
if (G) {
  const e2 = makeEl(); G.reset(); G.render(e2, INFO, 'en', S);
  e2.handlers.change({ target: { name: 'bkPlanOpt', value: 'deposit', checked: true } });
  e2.handlers.change({ target: { id: 'bkDepAck', checked: true } });
  G.render(e2, Object.assign({}, INFO, { balanceDueDate: '2027-03-10' }), 'en', S);
  ok('18 si cambia la fecha límite, la aceptación se borra', G.plan() === 'deposit' && G.ack() === null);
} else ok('18 aceptación se borra', false);

/* no elegible */
if (G) {
  const e3 = makeEl(); G.reset();
  G.render(e3, { eligible: false, reason: 'too_close', pct: 30, termsVersion: '2026-11-26' }, 'es', S);
  const h3 = e3.innerHTML;
  ok('19 no elegible: sin radio de depósito y con la línea de "paga 100 % ahora"', !/value="deposit"/.test(h3) && !!D.notEligible && h3.indexOf(D.notEligible.es) >= 0);
  ok('20 no elegible: plan() vuelve a full y ack() es null', G.plan() === 'full' && G.ack() === null);
  const e4 = makeEl(); G.render(e4, null, 'en', S);
  ok('21 sin bloque deposit: no se muestra nada', e4.innerHTML === '');
  const e5 = makeEl(); G.render(e5, { eligible: false, reason: 'quote_only' }, 'en', S);
  ok('22 cotización (quote_only): no se muestra nada', e5.innerHTML === '');
  /* si estaba en deposit y la fecha deja de ser elegible, se reinicia */
  const e6 = makeEl(); G.render(e6, INFO, 'en', S);
  e6.handlers.change({ target: { name: 'bkPlanOpt', value: 'deposit', checked: true } });
  G.render(e6, { eligible: false, reason: 'too_close' }, 'en', S);
  ok('23 de elegible a no elegible: el plan se reinicia a full', G.plan() === 'full');
} else { for (let i = 19; i <= 23; i++) ok(i + ' no elegible', false); }

/* ---------------- 3 · app.js ---------------- */
const app = read('assets/js/app.js');
ok('24 app.js envía booking_date a pricing-preview', /reqBody\.booking_date\s*=/.test(app));
ok('25 el cambio de fecha vuelve a llamar refreshPricing', /#bkDate'\)\.addEventListener\('change',function\(\)\{[^}]*refreshPricing\(\)/.test(app));
ok('26 hay un #bkPlan antes de #bkPolicy', app.indexOf('id="bkPlan"') > 0 && app.indexOf('id="bkPlan"') < app.indexOf('id="bkPolicy"'));
const fp = (app.match(/function bkComputeFingerprint\(\)\{[\s\S]*?\n\}/) || [''])[0];
ok('27 la huella (fingerprint) incluye el plan de pago', /GHADeposit/.test(fp) && /plan\(\)/.test(fp));
ok('28 el payload lleva payment_plan y deposit_ack', /payload\.payment_plan\s*=/.test(app) && /payload\.deposit_ack\s*=/.test(app));
ok('29 payment_plan solo se agrega después de la rama de cotización',
  app.indexOf('payload.payment_plan') > app.indexOf('/api/quote-request'));
ok('30 submitBooking bloquea si el depósito no tiene aceptación', /GHADeposit\.tx\(S,'ackRequired',L\)/.test(app) && /!GHADeposit\.ack\(\)/.test(app));
ok('31 el botón de pago muestra lo que se cobra hoy (depósito)', /GHADeposit\.money\(dep\.depositCents\)/.test(app) && /plan\(\)==='deposit'/.test(app));
ok('32 los errores nuevos del servidor tienen mensaje', ['INVALID_PAYMENT_PLAN', 'DEPOSIT_TERMS_REQUIRED', 'DEPOSIT_NOT_ELIGIBLE'].every(function (c) { return app.indexOf(c) > 0; }));
ok('33 el recibo usa chargeCents y la fecha del saldo', /chargeCents/.test(app) && /balanceDueDate/.test(app));
ok('34 app.js no envía montos al servidor (sin amount en payload)', !/payload\.(amount|total|price)\w*\s*=/.test(app));
ok('35 closeBooking reinicia el plan de depósito', /GHADeposit\.reset\(\)/.test(app));

/* ---------------- 4 · saldo.js ---------------- */
const saldoJs = exists('assets/js/saldo.js') ? read('assets/js/saldo.js') : '';
ok('36 saldo.js existe', !!saldoJs);
ok('37 el token se lee solo de location.hash', /location\.hash/.test(saldoJs) && !/location\.search|URLSearchParams|document\.cookie/.test(saldoJs));
ok('38 saldo.js no usa localStorage ni sessionStorage', !!saldoJs && !/localStorage|sessionStorage/.test(saldoJs));
/* Fix ronda 1 (I1): el fragmento se CONSERVA para que recargar o volver atrás siga funcionando. */
ok('39 saldo.js NO borra el fragmento (sin history.replaceState) y lo lee solo de location.hash', !!saldoJs && !/history\.replaceState/.test(saldoJs) && /location\.hash/.test(saldoJs));
ok('40 saldo.js manda exactamente {mode, token} a create-payment-intent',
  /\/api\/create-payment-intent/.test(saldoJs) && /\{\s*mode:\s*mode\s*,\s*token:\s*token\s*\}/.test(saldoJs) && /["']balance_info["']/.test(saldoJs) && /["']balance["']/.test(saldoJs));
ok('41 saldo.js confirma con GHAPayments.confirmCardPayment', /GHAPayments\.confirmCardPayment/.test(saldoJs) && /GHAPayments\.mount/.test(saldoJs));
ok('42 saldo.js no imprime nada en consola', !!saldoJs && !/console\./.test(saldoJs));
ok('43 saldo.js maneja los estados (paid, cancelled, token inválido, reintento)',
  ['due', 'paid', 'cancelled', 'INVALID_TOKEN', 'BALANCE_NOT_DUE', 'PAYMENT_ATTEMPT_CANCELED', 'PAYMENT_ATTEMPT_UNAVAILABLE', 'alreadyPaid'].every(function (c) { return saldoJs.indexOf(c) >= 0; }));

/* ---------------- 5 · páginas, vercel ---------------- */
const pages = fs.readdirSync(BASE).filter(function (f) { return /\.html$/.test(f); });
const withApp = pages.filter(function (f) { return /assets\/js\/app\.js\?v=hp1\d/.test(read(f)); });
ok('44 las 10 páginas públicas + saldo cargan app.js', withApp.length === 11 && withApp.indexOf('saldo.html') >= 0);
ok('45 todas cargan app.js y content.js en ?v=hp11', withApp.every(function (f) { const h = read(f); return /app\.js\?v=hp11/.test(h) && /content\.js\?v=hp11/.test(h) && !/\?v=hp10/.test(h); }));
ok('46 todas cargan deposit-ui.js?v=hp11 ANTES de app.js', withApp.every(function (f) {
  const h = read(f); const i = h.indexOf('assets/js/deposit-ui.js?v=hp11'); return i > 0 && i < h.indexOf('assets/js/app.js?v=hp11');
}));
ok('47 admin.html también usa content.js?v=hp11', /content\.js\?v=hp11/.test(read('admin.html')));
const sal = exists('saldo.html') ? read('saldo.html') : '';
ok('48 saldo.html es noindex, nofollow', /<meta name="robots" content="noindex, nofollow">/.test(sal));
ok('49 saldo.html carga Stripe, payments.js y saldo.js (saldo.js al final)',
  /js\.stripe\.com\/v3\//.test(sal) && /assets\/js\/payments\.js/.test(sal) && sal.indexOf('assets/js/saldo.js') > sal.indexOf('assets/js/app.js'));
ok('50 saldo.html tiene el contenedor #saldoRoot', /id="saldoRoot"/.test(sal));
const vj = JSON.parse(read('vercel.json'));
ok('51 vercel.json reescribe /saldo → /saldo.html', vj.rewrites.some(function (r) { return r.source === '/saldo' && r.destination === '/saldo.html'; }));
ok('52 no se agregó ningún archivo bajo api/ para el saldo', !exists('api/saldo.js'));

/* ---------------- 6 · Fix ronda 1 ---------------- */
/* I2: en /saldo el checkout nunca se abre y no hay popups autónomos */
ok('53 openBooking es no-op en /saldo', /function openBooking\(opts\)\{[^]{0,260}dataset\.page==='saldo'\) return;/.test(app));
ok('54 el botón "Reservar" del header no se pinta en /saldo', /dataset\.page==='saldo'\?'':'<button type="button" class="btn btn-gold btn-sm js-book"/.test(app));
ok('55 la barra/popup Black Friday no carga en /saldo', /function loadPromo\(\)\{\s*if\(document\.body\.dataset\.page==='saldo'\) return;/.test(app));
ok('56 el aviso a visitantes recurrentes (nudge) excluye /saldo', /var BLOCK=\[[^\]]*'\/saldo'[^\]]*\]/.test(app));
ok('57 saldo.html no carga promo-bf.js', !/promo-bf/.test(sal));

/* C1: política e insignia con la regla del depósito, y restauración exacta */
ok('58 S.deposit.policyBox y badgeDeposit existen en EN y ES con el texto pedido',
  D.policyBox && D.badgeDeposit && D.policyBox.es === 'Depósito: reembolsable si cancelas con más de 30 días de anticipación (hasta el {refund}). Saldo: una vez pagado, sigue la regla de 15 días.' &&
  D.badgeDeposit.es === 'Depósito reembolsable con más de 30 días de anticipación' && /\{refund\}/.test(D.policyBox.en) && D.badgeDeposit.en.length > 10);
ok('59 app.js cambia #bkPolicy y #bkT2 con el plan depósito y restaura los originales', /function setBkPolicy\(dep\)/.test(app) && /setBkPolicy\(depPlan\?dep:null\)/.test(app) && /bkPolicyOrig=\{pol:/.test(app) && /pol\.innerHTML=bkPolicyOrig\.pol; t2\.textContent=bkPolicyOrig\.t2/.test(app));
ok('60 la política con depósito conserva la frase de Términos (ES y EN)', /Al reservar aceptas los <a href="terms\.html"[^]{0,120}Términos y Condiciones<\/a>\.':' By booking you accept the <a href="terms\.html"/.test(app));
if (G) {
  const txt = G.fill(G.tx(S, 'policyBox', 'es'), { refund: G.date('2027-02-02', 'es') });
  ok('61 la política con depósito se rellena con la fecha límite de reembolso', /hasta el 2 feb 2027/.test(txt) && !/\{refund\}/.test(txt));
} else ok('61 política rellenada', false);

/* C2: español natural en la línea de "no elegible" */
ok('62 notEligible ES corregido', D.notEligible && D.notEligible.es === 'Pagas el 100 % ahora. El depósito del 30 % solo se ofrece si faltan más de 30 días para tu viaje.');
ok('63 notEligible EN natural', D.notEligible && /more than 30 days away/.test(D.notEligible.en));

/* C3: cabecera compacta, un solo título, título de la pestaña localizado */
ok('64 saldo.html usa la cabecera compacta y un único h1', /class="pagehero pagehero-compact"/.test(sal) && (sal.match(/<h1/g) || []).length === 1);
ok('65 saldo.js no repite el título "Paga tu saldo" en la tarjeta', !/<h2>' \+ esc\(T\("saldoTitle"\)\)/.test(saldoJs));
ok('66 saldo.js localiza document.title y lo actualiza al cambiar de idioma', /document\.title\s*=\s*T\("saldoTitle"\)/.test(saldoJs) && /if \(b\) setTitle\(\)/.test(saldoJs));
ok('67 el CSS tiene la cabecera compacta', /\.pagehero\.pagehero-compact\{min-height:0;\}/.test(read('assets/css/site.css')));

console.log('\n' + pass + ' PASS · ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
