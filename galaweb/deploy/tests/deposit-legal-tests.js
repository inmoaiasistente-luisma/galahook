'use strict';

/* =========================================================
   Pruebas — Depósito del 30 %: textos legales y registro de
   cumplimiento (Tarea 12). Sin red, sin DB: lee terms.html,
   content.js, el resto de páginas y docs/loanix/WEB_COMPLIANCE.md.
   Copia aprobada por el owner el 2026-11-27 («Sí, apruebo»).
   ========================================================= */

const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..');
const read = function (f) { return fs.readFileSync(path.join(BASE, f), 'utf8'); };
const exists = function (f) { return fs.existsSync(path.join(BASE, f)); };

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name); } }

/* Texto A1–A7 aprobado, literal (no reformular). */
const A = {
  A1: { es: "Para reservar pagas el total, o un depósito del 30 % si faltan más de 30 días para tu viaje (paquetes, tours de día y charters de pesca con precio en línea).", en: "To book, you pay the full price, or a 30% deposit if your trip is more than 30 days away (packages, day tours and fishing charters priced online)." },
  A2: { es: "Pago completo: cancelación con más de 15 días de anticipación, reembolso del 100 %.", en: "Full payment: cancellation more than 15 days before the activity, 100% refund." },
  A3: { es: "Pago completo: cancelación con 15 días o menos de anticipación, sin reembolso.", en: "Full payment: cancellation 15 days or less before the activity, no refund." },
  A4: { es: "Depósito del 30 %: se reembolsa si cancelas con más de 30 días de anticipación; con 30 días o menos no se reembolsa.", en: "30% deposit: refunded if you cancel more than 30 days before the trip; not refunded at 30 days or less." },
  A5: { es: "Saldo (70 %): vence 6 días antes del viaje, hasta las 23:59 hora de Galápagos. Te enviamos el enlace de pago por correo, con un recordatorio 7 días antes y un último aviso 6 días antes. Puedes pagarlo antes.", en: "Balance (70%): due 6 days before the trip, by 11:59 p.m. Galápagos time. We email you the payment link, with a reminder 7 days before and a last notice 6 days before. You can pay it early." },
  A6: { es: "Si el saldo no se paga a tiempo, la reserva se cancela automáticamente 5 días antes del viaje y el depósito no se reembolsa.", en: "If the balance is not paid on time, the booking is cancelled automatically 5 days before the trip and the deposit is not refunded." },
  A7: { es: "Una vez pagado, el saldo sigue la regla de 15 días: se reembolsa si cancelas con más de 15 días de anticipación.", en: "Once paid, the balance follows the 15-day rule: it is refunded if you cancel more than 15 days before the trip." }
};
const terms = read('terms.html');
const content = read('assets/js/content.js');
const keys = Object.keys(A);

/* ---------------- 1 · terms.html y content.js ---------------- */
keys.forEach(function (k, i) {
  ok((i * 2 + 1) + ' terms.html contiene ' + k + ' en ES y EN',
    terms.indexOf('data-es="' + A[k].es + '"') >= 0 && terms.indexOf('data-en="' + A[k].en + '"') >= 0 && terms.indexOf('>' + A[k].en + '</li>') >= 0);
  ok((i * 2 + 2) + ' content.js contiene ' + k + ' como { en, es }',
    content.indexOf('en: ' + JSON.stringify(A[k].en)) >= 0 && content.indexOf('es: ' + JSON.stringify(A[k].es)) >= 0);
});
ok('15 desaparece la antigua primera viñeta (pago completo obligatorio) de terms.html y content.js',
  !/Full payment is required to reserve your place\./.test(terms) && !/Se requiere el pago completo/.test(terms) &&
  !/Full payment is required to reserve your place\./.test(content) && !/Se requiere el pago completo/.test(content));
ok('16 se conserva la viñeta de 15 días o menos no reembolsable (terms y content)',
  /Una reserva hecha y confirmada con 15 días o menos de anticipación no es reembolsable\./.test(terms) &&
  /Una reserva hecha y confirmada con 15 días o menos de anticipación no es reembolsable\./.test(content));
ok('17 las viñetas A1–A7 van en orden (A4–A7 justo después de A3, antes de la viñeta de 15 días o menos)', (function () {
  const p = keys.map(function (k) { return terms.indexOf('data-en="' + A[k].en + '"'); });
  const q = keys.map(function (k) { return content.indexOf('en: ' + JSON.stringify(A[k].en)); });
  const inc = function (a) { return a.every(function (v, i) { return v > 0 && (i === 0 || v > a[i - 1]); }); };
  return inc(p) && inc(q) && p[6] < terms.indexOf('data-en="A reservation made and confirmed 15 days') && q[6] < content.indexOf('en: "A reservation made and confirmed 15 days');
})());
ok('18 fecha de actualización: noviembre de 2026', /Last updated: November 2026/.test(terms) && /Última actualización: noviembre de 2026/.test(terms) && !/October 2026/.test(terms) && !/octubre de 2026/.test(terms));

/* ---------------- 2 · sin marcadores pendientes en páginas públicas ---------------- */
const pages = fs.readdirSync(BASE).filter(function (f) { return /\.html$/.test(f); });
ok('19 ningún *.html público tiene [PENDIENTE ni [PENDING', pages.length > 5 && pages.every(function (f) { return !/\[PENDIENTE|\[PENDING/i.test(read(f)); }));

/* ---------------- 3 · WEB_COMPLIANCE.md ---------------- */
const doc = exists('docs/loanix/WEB_COMPLIANCE.md') ? read('docs/loanix/WEB_COMPLIANCE.md') : '';
const row = function (re) { return doc.split(/\r?\n/).some(function (l) { return re.test(l) && /PENDING/.test(l); }); };
ok('20 WEB_COMPLIANCE.md existe', doc.length > 500);
ok('21 lista 559.927 y 559.935 con PENDING', row(/559\.927/) && /559\.935/.test(doc));
ok('22 lista LODC art. 45 con PENDING', row(/LODC/));
ok('23 etiqueta de versión aprobada y DEPOSIT_TERMS_VERSION', /Aprobado por el owner el 2026-11-27 \(«Sí, apruebo»\)/.test(doc) && /DEPOSIT_TERMS_VERSION 2026-11-26/.test(doc));
ok('24 incluye A1–A7 literales (ES y EN) en el registro', keys.every(function (k) { return doc.indexOf(A[k].es) >= 0 && doc.indexOf(A[k].en) >= 0; }));
ok('25 declaración del owner literal y regla de no publicar número de registro',
  doc.indexOf('no estamos registrados en florida, nuestros viajes son fuera de EE. UU.') >= 0 && /nunca publicar un número de registro de Florida/i.test(doc));
ok('26 nota de revisión preliminar literal',
  doc.indexOf('revisión preliminar del 2026-11-26, no es asesoría legal: no se encontró una exención aplicable en 559.935 para viajes fuera de EE. UU.; pendiente de abogado') >= 0);
ok('27 fuentes oficiales y puntos abiertos (flsenate.gov, LODC, GDPR)', /flsenate\.gov\/Laws\/Statutes/.test(doc) && /Ley Orgánica de Defensa del Consumidor/.test(doc) && /GDPR/.test(doc));

/* ---------------- 4 · cache-busters ---------------- */
const withContent = pages.filter(function (f) { return /content\.js\?v=/.test(read(f)); });
ok('28 todas las páginas que cargan content.js lo piden en ?v=hp12 (incluye admin.html)',
  withContent.indexOf('admin.html') >= 0 && withContent.indexOf('terms.html') >= 0 && withContent.every(function (f) { const h = read(f); return /content\.js\?v=hp12/.test(h) && !/content\.js\?v=hp11/.test(h); }));
ok('29 app.js y deposit-ui.js siguen en hp11', pages.every(function (f) { const h = read(f); return !/(app|deposit-ui)\.js\?v=(?!hp11)/.test(h); }));

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
