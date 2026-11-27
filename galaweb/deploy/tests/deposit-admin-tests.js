'use strict';

/* =========================================================
   Pruebas — Tarea 11: panel admin del depósito del 30 %.
   Comportamiento: assets/js/admin-deposit.js se carga en un
   sandbox `vm` y se afirma sobre el HTML que devuelve.
   Fuente: ganchos en admin.js y admin.html.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const BASE = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }

const depSrc = read('assets/js/admin-deposit.js');
const adminJs = read('assets/js/admin.js');
const html = read('admin.html');

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function load(over) {
  const sandbox = { window: {}, console: console, Promise: Promise };
  vm.createContext(sandbox);
  vm.runInContext(depSrc, sandbox);
  const calls = [];
  const toasts = [];
  const deps = Object.assign({
    ES: true, escapeHtml: esc,
    money: function (c) { return c == null ? '—' : '$' + (c / 100).toFixed(0); },
    fmtDate: function (s) { return s ? 'D(' + s + ')' : '—'; },
    fmtDT: function (s) { return s ? 'T(' + s + ')' : '—'; },
    canWrite: function () { return true; },
    adminToast: function (m) { toasts.push(m); },
    apiPost: function (url, body) { calls.push({ url: url, body: body }); return Promise.resolve({ ok: true, status: 200, data: { ok: true } }); }
  }, over || {});
  return { api: sandbox.window.ghaAdminDeposit(deps), calls: calls, toasts: toasts, deps: deps, sandbox: sandbox };
}

const DEP = {
  id: 'b1', payment_plan: 'deposit', payment_status: 'deposit_paid', booking_status: 'confirmed',
  amount_cents: 120000, deposit_cents: 36000, balance_cents: 84000, balance_due_date: '2027-03-05',
  deposit_refundable_until: '2027-02-02', balance_refundable_until: '2027-02-17',
  deposit_paid_at: '2026-11-27T10:00:00Z', balance_paid_at: null, balance_payment_method: null, balance_offline_note: null,
  needs_review_reason: null, cancel_reason: null, auto_cancelled_at: null
};
function dep(over) { return Object.assign({}, DEP, over || {}); }

(async function () {
  /* ---- 1 · etiquetas ---- */
  const es = load().api, en = load({ ES: false }).api;
  ok('1 etiqueta ES deposit_paid = "Depósito pagado"', es.payLabel('deposit_paid') === 'Depósito pagado');
  ok('2 etiqueta EN deposit_paid = "Deposit paid"', en.payLabel('deposit_paid') === 'Deposit paid');
  ok('3 otros estados no cambian', es.payLabel('paid') === 'paid');
  ok('4 BK_PAY_KIND tiene deposit_paid', /BK_PAY_KIND\s*=\{[^}]*deposit_paid:'warn'/.test(adminJs));

  /* ---- 2 · línea de la tabla ---- */
  const line = es.tableLine(DEP);
  ok('5 tabla: "Depósito pagado · saldo $840 vence"', /Depósito pagado · saldo \$840 vence D\(2027-03-05\)/.test(line));
  ok('6 tabla EN', /Deposit paid · balance \$840 due D\(2027-03-05\)/.test(en.tableLine(DEP)));
  ok('7 tabla: saldo pagado', /Saldo pagado/.test(es.tableLine(dep({ balance_paid_at: '2027-01-01T00:00:00Z', payment_status: 'paid' }))));
  ok('8 tabla: reserva completa no muestra línea', es.tableLine(dep({ payment_plan: 'full', payment_status: 'paid' })) === '');
  ok('9 tabla: cancelada por saldo = depósito retenido', /depósito retenido/.test(es.tableLine(dep({ booking_status: 'cancelled', cancel_reason: 'balance_unpaid' }))));

  /* ---- 3 · detalle ---- */
  const d = es.detailHtml(DEP);
  ok('10 detalle: plan, depósito, saldo y vencimiento', /Plan de pago/.test(d) && /\$360/.test(d) && /\$840/.test(d) && /2027-03-05/.test(d) && /23:59 Galápagos/.test(d));
  ok('11 detalle: saldo pendiente', /Pendiente/.test(d));
  ok('12 detalle: 30 % reembolsable hasta', /30 % reembolsable hasta 2027-02-02/.test(d));
  ok('13 detalle: sin 70 % si el saldo no está pagado', !/70 % reembolsable/.test(d));
  const dPaid = es.detailHtml(dep({ balance_paid_at: '2027-01-10T00:00:00Z', balance_payment_method: 'cash', balance_offline_note: 'Recibido en oficina', payment_status: 'paid' }));
  ok('14 detalle: 70 % reembolsable hasta con saldo pagado', /70 % reembolsable hasta 2027-02-17/.test(dPaid));
  ok('15 detalle: saldo pagado con método y nota', /Pagado/.test(dPaid) && /Efectivo/.test(dPaid) && /Recibido en oficina/.test(dPaid));
  const dCancel = es.detailHtml(dep({ booking_status: 'cancelled', cancel_reason: 'balance_unpaid', auto_cancelled_at: '2027-02-28T05:00:00Z' }));
  ok('16 detalle: cancelación automática con fecha y depósito retenido', /Cancelación automática/.test(dCancel) && /T\(2027-02-28T05:00:00Z\)/.test(dCancel) && /depósito retenido/.test(dCancel));
  ok('17 detalle EN', /30 % refundable until 2027-02-02/.test(en.detailHtml(DEP)) && /Balance due/.test(en.detailHtml(DEP)));
  ok('18 detalle: reserva completa no agrega bloque de depósito', es.detailHtml(dep({ payment_plan: 'full' })) === '');
  ok('19 detalle: escapa la nota del saldo', /&lt;script&gt;/.test(es.detailHtml(dep({ balance_paid_at: 'x', balance_offline_note: '<script>alert(1)</script>' }))) && !/<script>/.test(es.detailHtml(dep({ balance_paid_at: 'x', balance_offline_note: '<script>alert(1)</script>' }))));

  /* ---- 4 · alerta roja ---- */
  ['balance_paid_after_cancel', 'balance_paid_twice', 'refund_review'].forEach(function (r, i) {
    const a = es.alertHtml(dep({ needs_review_reason: r }));
    ok('20.' + i + ' alerta roja ' + r, /dep-alert/.test(a) && /--a-bad-/.test(a) && /role="alert"/.test(a) && es.reasonText(r).length > 20 && a.indexOf(esc(es.reasonText(r))) !== -1);
    ok('21.' + i + ' alerta EN ' + r, en.reasonText(r) !== es.reasonText(r) && /REVIEW/.test(en.alertHtml(dep({ needs_review_reason: r }))));
    ok('22.' + i + ' marcador en la fila ' + r, /dep-review/.test(es.reviewMarker(dep({ needs_review_reason: r }))));
  });
  ok('23 alerta: textos clave', /reembolsas en Stripe o la reactivas/.test(es.reasonText('balance_paid_after_cancel'))
    && /otro medio Y además se pagó en Stripe/.test(es.reasonText('balance_paid_twice'))
    && /no aplicó automáticamente/.test(es.reasonText('refund_review')));
  ok('24 sin motivo: sin alerta ni marcador', es.alertHtml(DEP) === '' && es.reviewMarker(DEP) === '');
  ok('25 la alerta va en el detalle', /dep-alert/.test(es.detailHtml(dep({ needs_review_reason: 'refund_review' }))));
  ok('25b alerta también en reserva completa', /dep-alert/.test(es.detailHtml(dep({ payment_plan: 'full', needs_review_reason: 'refund_review' }))));

  /* ---- 5 · botón del owner ---- */
  ok('26 botón: owner + depósito pagado + no cancelada', es.canOffline(DEP) === true);
  ok('27 botón oculto a no owner', load({ canWrite: function () { return false; } }).api.canOffline(DEP) === false);
  ok('28 botón oculto en plan completo', es.canOffline(dep({ payment_plan: 'full' })) === false);
  ok('29 botón oculto si ya está pagado', es.canOffline(dep({ payment_status: 'paid' })) === false);
  ok('30 botón oculto si está cancelada', es.canOffline(dep({ booking_status: 'cancelled' })) === false);
  ok('31 etiqueta del botón', es.buttonLabel() === 'Saldo pagado por otro medio');

  /* ---- 6 · validación y envío ---- */
  ok('32 sin método -> error', es.validateOffline('', 'nota ok') !== '');
  ok('33 método inválido -> error', es.validateOffline('zelle', 'nota ok') !== '');
  ok('34 nota vacía -> error', es.validateOffline('cash', '   ') !== '');
  ok('35 nota de 2 caracteres -> error', es.validateOffline('cash', ' ab ') !== '');
  ok('36 nota de 3 caracteres -> válida', es.validateOffline('cash', ' abc ') === '');
  ok('37 nota de 500 válida, 501 inválida', es.validateOffline('transfer', 'x'.repeat(500)) === '' && es.validateOffline('transfer', 'x'.repeat(501)) !== '');

  let L = load();
  let res = await L.api.submitOffline(DEP, 'cash', '  Pagó en efectivo  ');
  ok('38 envía a /api/admin-booking-balance-offline con nota recortada', L.calls.length === 1 && L.calls[0].url === '/api/admin-booking-balance-offline'
    && L.calls[0].body.booking_id === 'b1' && L.calls[0].body.method === 'cash' && L.calls[0].body.note === 'Pagó en efectivo' && res.kind === 'ok');
  L = load();
  res = await L.api.submitOffline(DEP, '', 'nota');
  ok('39 entrada inválida no llama a la red', L.calls.length === 0 && res.kind === 'invalid');
  L = load({ apiPost: function () { return Promise.resolve({ ok: false, status: 409, data: { code: 'BALANCE_NOT_DUE' } }); } });
  res = await L.api.submitOffline(DEP, 'cash', 'nota');
  ok('40 409 BALANCE_NOT_DUE -> mensaje claro', res.kind === 'not_due' && res.message === 'Esta reserva ya no tiene saldo pendiente');
  L = load({ apiPost: function () { return Promise.resolve({ ok: false, status: 403, data: {} }); } });
  ok('41 403 -> forbidden', (await L.api.submitOffline(DEP, 'cash', 'nota')).kind === 'forbidden');
  L = load({ apiPost: function () { return Promise.resolve({ ok: false, status: 400, data: {} }); } });
  ok('42 400 -> invalid', (await L.api.submitOffline(DEP, 'cash', 'nota')).kind === 'invalid');
  L = load({ apiPost: function () { return Promise.reject(new Error('net')); } });
  ok('43 fallo de red -> error', (await L.api.submitOffline(DEP, 'cash', 'nota')).kind === 'error');

  /* ---- 7 · formulario (host simulado) ---- */
  function fakeHost(initial) {
    const handlers = {};
    const els = {
      '[data-dep-err]': { textContent: '' },
      '[data-dep-note]': { value: '' },
      '[data-dep-confirm]': { disabled: false, addEventListener: function (e, f) { handlers.confirm = f; } },
      '[data-dep-cancel]': { addEventListener: function (e, f) { handlers.cancel = f; } }
    };
    const radios = [{ value: 'cash', checked: false }, { value: 'transfer', checked: false }];
    return {
      innerHTML: '', els: els, radios: radios, handlers: handlers,
      querySelector: function (s) { return els[s]; },
      querySelectorAll: function () { return radios; }
    };
  }
  L = load();
  let host = fakeHost();
  let done = null;
  L.api.renderOfflineForm(host, DEP, function (r) { done = r; });
  ok('44 formulario: radios sin método por defecto', /type="radio"/.test(host.innerHTML) && !/checked/.test(host.innerHTML) && /value="cash"/.test(host.innerHTML) && /value="transfer"/.test(host.innerHTML));
  ok('45 formulario: nota obligatoria 3-500 y botones', /data-dep-note/.test(host.innerHTML) && /maxlength="500"/.test(host.innerHTML) && /data-dep-confirm/.test(host.innerHTML) && /data-dep-cancel/.test(host.innerHTML));
  ok('46 formulario: explica que marca todo pagado y detiene la cancelación', /marca la reserva como pagada por completo y detiene la cancelación automática/.test(host.innerHTML));
  host.handlers.confirm();
  ok('47 confirmar sin método: error y sin envío', host.els['[data-dep-err]'].textContent !== '' && L.calls.length === 0);
  host.radios[0].checked = true; host.els['[data-dep-note]'].value = 'ab';
  host.handlers.confirm();
  ok('48 nota corta: error y sin envío', host.els['[data-dep-err]'].textContent !== '' && L.calls.length === 0);
  host.els['[data-dep-note]'].value = 'Recibido en caja';
  host.handlers.confirm();
  await new Promise(function (r) { setTimeout(r, 5); });
  ok('49 envío válido: toast y refresco (onDone ok)', L.calls.length === 1 && L.toasts.length === 1 && done && done.kind === 'ok');
  L = load({ apiPost: function () { return Promise.resolve({ ok: false, status: 409, data: { code: 'BALANCE_NOT_DUE' } }); } });
  host = fakeHost(); done = null;
  L.api.renderOfflineForm(host, DEP, function (r) { done = r; });
  host.radios[1].checked = true; host.els['[data-dep-note]'].value = 'Transferencia 123';
  host.handlers.confirm();
  await new Promise(function (r) { setTimeout(r, 5); });
  ok('50 409: toast con el mensaje claro y refresco', L.toasts[0] === 'Esta reserva ya no tiene saldo pendiente' && done && done.kind === 'not_due');
  host.handlers.cancel();
  ok('51 cancelar limpia el formulario', host.innerHTML === '');
  host = fakeHost();
  load({ ES: false }).api.renderOfflineForm(host, DEP);
  ok('52 formulario EN', /fully paid and stops the automatic cancellation/.test(host.innerHTML));

  /* ---- 8 · finanzas ---- */
  function tile(l, v, c) { return '<T ' + l + '|' + v + '|' + (c || '') + '>'; }
  const fin = es.financeTilesHtml({ collected_cents: 50000, pending_cents: 84000, retained_deposits_cents: 36000, retained_deposits_count: 2 }, tile, function (c) { return '$' + c / 100; });
  ok('53 finanzas: Cobrado / Por cobrar / Depósitos retenidos', /Cobrado\|\$500/.test(fin) && /Por cobrar\|\$840/.test(fin) && /Depósitos retenidos\|\$360/.test(fin) && /\(2\)/.test(fin));
  ok('54 finanzas EN', /Collected/.test(en.financeTilesHtml({ collected_cents: 1, pending_cents: 1, retained_deposits_cents: 1, retained_deposits_count: 0 }, tile, function (c) { return c; })));
  ok('55 finanzas sin datos nuevos no pinta nada', es.financeTilesHtml({ revenue: {} }, tile) === '');
  ok('56 "Cobrado por método"', es.methodLabel() === 'Cobrado por método' && en.methodLabel() === 'Collected by method');
  ok('57 admin.js: finanzas usan los helpers', /financeTilesHtml\(/.test(adminJs) && /methodLabel\(\)/.test(adminJs));

  /* ---- 9 · recordatorios ---- */
  ok('58 aviso ES de recordatorios', es.reminderWarning() === 'También revisa los depósitos: una reserva con saldo sin pagar a 5 días o menos del viaje se cancela automáticamente.');
  ok('59 aviso EN de recordatorios', /unpaid balance 5 days or less/.test(en.reminderWarning()));
  ok('60 admin.js: el aviso se muestra junto al barrido', /reminderWarning\(\)/.test(adminJs));

  /* ---- 10 · ganchos en admin.js y admin.html ---- */
  ok('61 admin.js: BK_PAY_KIND y etiqueta en detalle y tabla', /bkPayLabel\(b\.payment_status\)/.test(adminJs) && (adminJs.match(/bkPayLabel\(b\.payment_status\)/g) || []).length >= 2);
  ok('62 admin.js: detalle usa detailHtml', /DEPOSIT\.detailHtml\(b\)/.test(adminJs));
  ok('63 admin.js: tabla usa tableLine y marcador', /DEPOSIT\.tableLine\(b\)/.test(adminJs) && /DEPOSIT\.reviewMarker\(b\)/.test(adminJs));
  ok('64 admin.js: botón solo con canOffline y renderOfflineForm', /DEPOSIT\.canOffline\(b\)/.test(adminJs) && /renderOfflineForm\(/.test(adminJs));
  ok('65 admin.js: filtro de pago incluye deposit_paid', (adminJs.match(/\['deposit_paid',/g) || []).length >= 2);
  ok('66 admin.js: crea la instancia con las dependencias', /window\.ghaAdminDeposit\(\{/.test(adminJs) && /canWrite:canWrite/.test(adminJs) && /apiPost:apiPost/.test(adminJs));
  ok('67 admin-deposit.js: escapa con escapeHtml y no usa innerHTML sin escapar la nota', /esc\(b\.balance_offline_note\)/.test(depSrc));
  ok('68 admin-deposit.js < 500 líneas', depSrc.split('\n').length < 500);
  ok('69 admin.html: admin-deposit.js antes de admin.js, con cache-buster', html.indexOf('assets/js/admin-deposit.js?v=dep30') !== -1
    && html.indexOf('assets/js/admin-deposit.js?v=dep30') < html.indexOf('assets/js/admin.js?v='));
  ok('70 admin.html: admin.js?v=dep30', /assets\/js\/admin\.js\?v=dep30/.test(html) && !/reviews26/.test(html));

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
