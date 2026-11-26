'use strict';

/* =========================================================
   Pruebas — Nota de disponibilidad del tour Kicker Rock — León
   Dormido ($195). Pedido del owner (2026-11-25): el tour NO se
   quita, pero se avisa que depende de la lancha, que por lo
   general sale en charters de buceo. Sin red, sin DB.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.resolve(__dirname, '..');
const catalog = require(BASE + '/server/lib/tour-catalog');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }

const box = { window: {} };
vm.runInNewContext(read('assets/js/content.js'), box);
const C = box.window.GHA_DEFAULT;
const tour = function (id) { return C.tours.find(function (x) { return x.id === id; }); };
const kicker = tour('kicker');
const both = function (o) { return !!(o && o.en && o.es); };

/* ---------------- el tour sigue a la venta, igual ---------------- */
ok('1 el tour León Dormido sigue en la página a $195 por persona',
  !!kicker && kicker.price === 195 && kicker.priceLabel.es === 'por persona' && /León Dormido/.test(kicker.name.es));
ok('2 el catálogo del servidor (lo que cobra Stripe) no cambia: $195 por persona',
  catalog.getTour('kicker').priceCents === 19500 && catalog.getTour('kicker').unit === 'person' && !catalog.getTour('kicker').requiresQuote);
ok('3 buceo y 360° siguen en la página sin nota',
  !!tour('diving') && !!tour('t360') && !tour('diving').note && !tour('t360').note);

/* ---------------- la nota, en los dos idiomas ---------------- */
const n = kicker.note || {};
ok('4 la nota tiene título, versión corta y texto completo en inglés y español',
  both(n.title) && both(n.short) && both(n.body));
ok('5 la nota dice que depende de la lancha, que suele salir en charters de buceo',
  /disponibilidad de la lancha/.test(n.title.es) && /lancha/.test(n.short.es) && /charters de buceo/.test(n.short.es) &&
  /charters de buceo/.test(n.body.es) && /boat availability/i.test(n.title.en) && /diving charters/.test(n.short.en) &&
  /diving charters/.test(n.body.en));
ok('6 el texto completo repite la política publicada: aviso en 24 horas, otra fecha o reembolso',
  /24 horas/.test(n.body.es) && /otra fecha/.test(n.body.es) && /reembolso/.test(n.body.es) &&
  /24 hours/.test(n.body.en) && /another date/.test(n.body.en) && /refund/.test(n.body.en));
ok('7 solo el tour León Dormido lleva esta nota',
  C.tours.filter(function (x) { return x.note; }).map(function (x) { return x.id; }).join() === 'kicker');

/* ---------------- tourCard (app.js) ---------------- */
const app = read('assets/js/app.js').replace(/\r\n/g, '\n');
function cut(from, to) { const a = app.indexOf(from); return app.slice(a, app.indexOf(to, a)); }
function cardFor(id, lang) {
  const src = cut('function detailBtn(', 'function bookMsg(') + cut('function esc(', 'function bookBtn(') + cut('function bookBtn(', '/* =====');
  const ctx = {
    L: lang, GHA_DETAILS: box.window.GHA_DETAILS || { tours: {} }, window: { GHA_DETAILS: { tours: { kicker: {} } } },
    t: function (x) { return x == null ? '' : (typeof x === 'string' ? x : (x[lang] || x.en)); },
    svg: function (name) { return '<svg data-i="' + name + '"></svg>'; },
    money: function (v) { return '$' + v; }
  };
  ctx.GHA_DETAILS = ctx.window.GHA_DETAILS;
  vm.runInNewContext(src + '\n;__out = tourCard(__tr);', Object.assign(ctx, { __tr: tour(id) }));
  return ctx.__out;
}
const es = cardFor('kicker', 'es'), en = cardFor('kicker', 'en');
ok('8 la tarjeta del León Dormido muestra la nota (es)',
  /class="tcard-note"/.test(es) && es.indexOf('Sujeto a disponibilidad de la lancha.') !== -1 && es.indexOf(n.short.es) !== -1);
ok('9 la tarjeta del León Dormido muestra la nota (en)',
  /class="tcard-note"/.test(en) && en.indexOf('Subject to boat availability.') !== -1 && en.indexOf(n.short.en) !== -1);
ok('10 la nota va entre la descripción y el precio, y el botón Reservar sigue',
  es.indexOf('tcard-note') > es.indexOf(kicker.blurb.es) && es.indexOf('tcard-note') < es.indexOf('tcard-foot') && /js-book/.test(es));
ok('11 las tarjetas de buceo y 360° no muestran nota',
  !/tcard-note/.test(cardFor('diving', 'es')) && !/tcard-note/.test(cardFor('t360', 'es')));

/* ---------------- ventana "Ver más" ---------------- */
const detail = cut('function openDetail(', 'function renderTours(');
ok('12 la ventana "Ver más" muestra el título y el texto completo de la nota',
  /src\.note\?'<div class="dt-rosita dt-note">'/.test(detail) && /t\(src\.note\.title\)/.test(detail) && /t\(src\.note\.body\)/.test(detail));

/* ---------------- estilos legibles ---------------- */
const css = read('assets/css/site.css');
ok('13 la nota usa texto oscuro (--ink) sobre fondo claro',
  /\.tcard-note\{[^}]*color:var\(--ink\)/.test(css) && /\.dt-note p\{color:var\(--ink\);\}/.test(css));

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
