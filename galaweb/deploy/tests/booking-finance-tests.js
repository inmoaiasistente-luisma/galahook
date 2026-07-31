'use strict';

/* =========================================================
   Pruebas — Finanzas reales por reserva (Fase 9, Etapa 3)
   ---------------------------------------------------------
   Cubre la lib PURA de cálculo (server-side) + verificación estructural de
   endpoints, router, vercel y migración 0018. Sin red, sin DB.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const BASE = path.resolve(__dirname, '..');
const bf = require(BASE + '/server/lib/booking-finance');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }

/* ---------------- lib pura: validateCostLine ---------------- */
ok('1 categorías: 16 valores esperados', bf.COST_CATEGORIES.length === 16 &&
  bf.COST_CATEGORIES.indexOf('flight') !== -1 && bf.COST_CATEGORIES.indexOf('hotel_galapagos') !== -1 &&
  bf.COST_CATEGORIES.indexOf('interisland_boat') !== -1 && bf.COST_CATEGORIES.indexOf('bait_ice') !== -1 &&
  bf.COST_CATEGORIES.indexOf('commission') !== -1 && bf.COST_CATEGORIES.indexOf('other') !== -1);

ok('2 sale_sources: web/agency/phone/in_person/partner/other', bf.SALE_SOURCES.length === 6 &&
  bf.SALE_SOURCES.indexOf('phone') !== -1 && bf.SALE_SOURCES.indexOf('in_person') !== -1 && bf.SALE_SOURCES.indexOf('partner') !== -1);

const okLine = bf.validateCostLine({ category: 'flight', quantity: 2, unit_cost_cents: 10900, vendor: 'Avianca', description: 'GYE-GPS', notes: 'ida' });
ok('3 línea válida: total = cantidad × unitario', okLine.ok === true && okLine.line.total_cents === 21800 && okLine.line.quantity === 2 && okLine.line.currency === 'usd' && okLine.line.vendor === 'Avianca');

const frac = bf.validateCostLine({ category: 'fuel', quantity: 1.5, unit_cost_cents: 500 });
ok('4 cantidad fraccionaria: round(1.5 × 500) = 750', frac.ok === true && frac.line.total_cents === 750 && frac.line.quantity === 1.5);

const defQty = bf.validateCostLine({ category: 'guide', unit_cost_cents: 3000 });
ok('5 cantidad por defecto = 1', defQty.ok === true && defQty.line.quantity === 1 && defQty.line.total_cents === 3000);

ok('6 categoría inválida → INVALID_CATEGORY', bf.validateCostLine({ category: 'spaceship', unit_cost_cents: 1 }).code === 'INVALID_CATEGORY');
ok('7 cantidad 0 → INVALID_QUANTITY', bf.validateCostLine({ category: 'food', quantity: 0, unit_cost_cents: 1 }).code === 'INVALID_QUANTITY');
ok('8 cantidad negativa → INVALID_QUANTITY', bf.validateCostLine({ category: 'food', quantity: -3, unit_cost_cents: 1 }).code === 'INVALID_QUANTITY');
ok('9 unitario negativo → INVALID_UNIT_COST', bf.validateCostLine({ category: 'food', unit_cost_cents: -100 }).code === 'INVALID_UNIT_COST');
ok('10 unitario no entero → INVALID_UNIT_COST', bf.validateCostLine({ category: 'food', unit_cost_cents: 10.5 }).code === 'INVALID_UNIT_COST');
ok('11 unitario fuera de rango → INVALID_UNIT_COST', bf.validateCostLine({ category: 'food', unit_cost_cents: bf.MAX_UNIT_COST_CENTS + 1 }).code === 'INVALID_UNIT_COST');
ok('12 sanea/recorta strings vacíos a null', (function () { const r = bf.validateCostLine({ category: 'other', unit_cost_cents: 1, description: '   ', vendor: '' }); return r.ok && r.line.description === null && r.line.vendor === null; })());

/* ---------------- lib pura: computeFinance ---------------- */
const lines = [{ total_cents: 10000 }, { total_cents: 5000 }, { total_cents: 2500, active: false }];
const f1 = bf.computeFinance(50000, lines);
ok('13 suma solo líneas activas (ignora active:false)', f1.cost_total_cents === 15000 && f1.line_count === 2);
ok('14 utilidad = cobrado − costo', f1.profit_cents === 35000);
ok('15 margen = utilidad / cobrado × 100 (1 decimal)', f1.margin_percent === 70);

const f2 = bf.computeFinance(null, [{ total_cents: 1000 }]);
ok('16 sin importe cobrado → utilidad/margen null (costo sí suma)', f2.cost_total_cents === 1000 && f2.profit_cents === null && f2.margin_percent === null);

const f3 = bf.computeFinance(50000, []);
ok('17 sin líneas → costo 0, utilidad/margen null (no se asume 0 de utilidad)', f3.cost_total_cents === 0 && f3.line_count === 0 && f3.profit_cents === null && f3.margin_percent === null);

const f4 = bf.computeFinance(10000, [{ total_cents: 15000 }]);
ok('18 utilidad negativa permitida', f4.profit_cents === -5000 && f4.margin_percent === -50);

const f5 = bf.computeFinance(30000, [{ total_cents: 10000 }]);
ok('19 margen redondeado a 1 decimal', f5.margin_percent === 66.7);

ok('20 deriveCostStatus: confirmado > líneas > vacío',
  bf.deriveCostStatus(3, true) === 'confirmed' && bf.deriveCostStatus(3, false) === 'estimated' && bf.deriveCostStatus(0, false) === 'unset');

/* ---------------- migración 0018 (preparada, no aplicada) ---------------- */
const M = read('supabase/migrations/0018_booking_finance_lines.sql').replace(/\s+/g, ' ');
ok('21 0018: tabla booking_cost_lines', /create table public\.booking_cost_lines \(/.test(M));
ok('22 0018: total_cents GENERATED = round(cantidad × unitario)',
  /total_cents\s+integer generated always as \(round\(quantity \* unit_cost_cents\)::integer\) stored/.test(M));
ok('23 0018: FK compuesta (booking_id, tenant_id) → bookings(id, tenant_id)',
  /foreign key \(booking_id, tenant_id\) references public\.bookings \(id, tenant_id\) on delete restrict/.test(M));
ok('24 0018: CHECK de 16 categorías', /chk_bcl_category check \(category in \([^)]*'flight'[^)]*'other'\)\)/.test(M) &&
  /'hotel_mainland'/.test(M) && /'hotel_galapagos'/.test(M) && /'entrance_fees'/.test(M));
ok('25 0018: cost_status unset/estimated/confirmed', /cost_status text not null default 'unset'/.test(M) &&
  /check \(cost_status in \('unset', 'estimated', 'confirmed'\)\)/.test(M));
ok('26 0018: columna sale_source + CHECK', /add column if not exists sale_source text/.test(M) &&
  /sale_source is null or sale_source in \('web', 'agency', 'phone', 'in_person', 'partner', 'other'\)/.test(M));
ok('27 0018: backfill SOLO etiqueta (estimated) sin cambiar montos', /set cost_status = 'estimated' where cost_cents is not null/.test(M));
ok('28 0018: RLS revoke (solo servidor) + trigger updated_at',
  /revoke all on table public\.booking_cost_lines from anon, authenticated;/.test(M) && /trg_bcl_updated_at before update/.test(M));
ok('29 0018: CHECKs cantidad>0 y unitario>=0', /chk_bcl_quantity check \(quantity > 0\)/.test(M) && /chk_bcl_unit_cost check \(unit_cost_cents >= 0\)/.test(M));

/* ---------------- endpoints (estructura + gating) ---------------- */
const add = read('server/admin-handlers/booking-cost-line-add.js');
const del = read('server/admin-handlers/booking-cost-line-delete.js');
const conf = read('server/admin-handlers/booking-costs-confirm.js');
const get = read('server/admin-handlers/booking-finance.js');
ok('30 add: owner/admin + sameOrigin + POST + valida vía lib', /requireAdmin\(req, res, \['owner', 'admin'\]\)/.test(add) && /sameOrigin\(req\)/.test(add) && /bf\.validateCostLine\(body\)/.test(add) && /'POST'/.test(add));
ok('31 add: NO envía total_cents (columna GENERATED)', !/total_cents:/.test(add.slice(add.indexOf('.insert('), add.indexOf('.select()'))));
ok('32 add: agregar deja cost_status estimated', /cost_status: 'estimated'/.test(add));
ok('33 delete: baja lógica active=false + recomputa estado', /active: false/.test(del) && /'estimated'/.test(del) && /'unset'/.test(del) && /requireAdmin\(req, res, \['owner', 'admin'\]\)/.test(del));
ok('34 confirm: fija cost_cents = suma + cost_status confirmed + actor/fecha',
  /cost_cents: fin\.cost_total_cents/.test(conf) && /cost_status: 'confirmed'/.test(conf) && /cost_confirmed_at:/.test(conf) && /cost_confirmed_by_user_id: session\.user_id/.test(conf));
const confUpdate = (conf.match(/\.update\(\{([\s\S]*?)\}\)/) || [null, ''])[1];
ok('35 confirm: el update fija cost_cents pero NO amount_cents (no cambia el importe cobrado)',
  /cost_cents:/.test(confUpdate) && !/amount_cents:/.test(confUpdate));
ok('36 get: owner/admin + GET + cálculo en servidor (computeFinance)', /requireAdmin\(req, res, \['owner', 'admin'\]\)/.test(get) && /'GET'/.test(get) && /bf\.computeFinance\(/.test(get));
ok('37 endpoints validan booking_id/line_id como UUID', /isUuid\(body\.booking_id\)/.test(add) && /isUuid\(body\.line_id\)/.test(del) && /isUuid\(body\.booking_id\)/.test(conf) && /isUuid\(q\.booking_id\)/.test(get));

/* ---------------- router + vercel ---------------- */
const router = read('api/admin-router.js');
const vercel = read('vercel.json');
['booking-finance', 'booking-cost-line-add', 'booking-cost-line-delete', 'booking-costs-confirm'].forEach(function (a, i) {
  ok((38 + i) + ' router mapea ' + a, new RegExp("ROUTES\\['" + a + "'\\] = require").test(router));
  ok((42 + i) + ' vercel rewrite /api/admin-' + a, new RegExp('"/api/admin-' + a.replace('booking-costs-confirm', 'booking-costs-confirm') + '"').test(vercel) && new RegExp('action=' + a).test(vercel));
});

/* ---------------- no rompe el contrato de finance-summary (aún) ---------------- */
const fsum = read('server/admin-handlers/finance-summary.js');
ok('46 finance-summary intacto en esta etapa (contrato null=missing conservado)', /cost_cents/.test(fsum));

console.log('\n=== RESULTADO BOOKING-FINANCE: ' + pass + ' PASS · ' + fail + ' FAIL ===');
if (fail > 0) process.exit(1);
