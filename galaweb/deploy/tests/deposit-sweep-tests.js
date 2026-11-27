'use strict';

/* =========================================================
   Pruebas — Tarea 7: barrido diario del saldo (depósito 30 %).
   ========================================================= */

process.env.QR_SIGNING_SECRET = 't';
process.env.PUBLIC_SITE_URL = 'https://example.test';

const fs = require('fs');
const path = require('path');
const { createFakeSupabase } = require('./helpers/fake-supabase');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }

const T = '2026-11-26';
function plus(n) { return require('../server/lib/pretrip-reminders').shiftYmd(T, n); }

function mkBooking(over) {
  return Object.assign({
    id: 'b1', tenant_id: 'ten', booking_date: plus(5), customer_email: ' Ana@Example.com ',
    payment_plan: 'deposit', payment_status: 'deposit_paid', booking_status: 'confirmed',
    balance_payment_intent_id: null, balance_paid_at: null, is_test: false, request_type: 'booking'
  }, over || {});
}

/* Dobles con registro. El libro de correos rechaza duplicados (reserva+tipo+destinatario). */
function mkHarness(rowsSeed, piMap, opts) {
  const o = opts || {};
  const sb = createFakeSupabase({ bookings: rowsSeed });
  const emails = [], notifies = [], audits = [], ledger = {};
  const stripeCalls = [];
  const stripe = o.noStripe ? null : {
    paymentIntents: {
      retrieve: async function (id) {
        stripeCalls.push(['retrieve', id]);
        if (o.retrieveThrows) throw new Error('stripe down');
        return { id: id, status: piMap[id] };
      },
      cancel: async function (id) {
        stripeCalls.push(['cancel', id]);
        if (o.cancelThrows) throw new Error('cancel fail');
        return { id: id, status: 'canceled' };
      }
    }
  };
  async function sendBookingEmail(a) {
    emails.push(a);
    const k = a.booking.id + '|' + a.type + '|' + a.recipient;
    if (ledger[k]) return { duplicate: true };
    ledger[k] = true;
    return { sent: true };
  }
  async function notifyBooking(b, c, ow, ctx) {
    const k = b.id + '|' + c;
    if (ledger[k]) return { customer: { duplicate: true }, owner: { duplicate: true } };
    ledger[k] = true;
    notifies.push([b, c, ow, ctx]);
    return o.notifyResult || { customer: { sent: true }, owner: { sent: true } };
  }
  async function audit(e) { audits.push(e); }
  return { sb, emails, notifies, audits, stripeCalls, stripe, sendBookingEmail, notifyBooking, audit };
}

/* Los logs del servidor se capturan en un arreglo (no se silencia console.error). */
const logs = [];
async function run(h, rows, extra) {
  const { runDepositSweep } = require('../server/lib/deposit-sweep');
  const orig = console.error;
  console.error = function () { logs.push([].slice.call(arguments).join(' ')); };
  try { return await runDepositSweep(Object.assign({
    supabase: h.sb, stripe: h.stripe, rows: rows, today: T, includeTest: false,
    sendBookingEmail: h.sendBookingEmail, notifyBooking: h.notifyBooking, audit: h.audit
  }, extra || {})); } finally { console.error = orig; }
}

async function main() {
  console.log('\n--- 7 · barrido ---');
  const { balanceUrl } = require('../server/lib/deposit-policy');

  /* 7.1 día 7 → recordatorio con enlace */
  {
    const b = mkBooking({ booking_date: plus(7) });
    const h = mkHarness([b], {});
    const r = await run(h, [b]);
    ok('7.1 día 7: un correo balance_reminder_d7 con balanceUrl y correo normalizado',
      h.emails.length === 1 && h.emails[0].type === 'balance_reminder_d7' &&
      h.emails[0].recipient === 'ana@example.com' && h.emails[0].ctx.balanceUrl === balanceUrl('b1') &&
      r.reminded === 1 && r.cancelled === 0 && r.failed === 0);
    ok('7.1b día 7: no cancela ni audita', b.booking_status === 'confirmed' && h.audits.length === 0);
  }

  /* 7.2 día 6 */
  {
    const b = mkBooking({ booking_date: plus(6) });
    const h = mkHarness([b], {});
    const r = await run(h, [b]);
    ok('7.2 día 6: balance_reminder_d6', h.emails.length === 1 && h.emails[0].type === 'balance_reminder_d6' && r.reminded === 1);
  }

  /* 7.3 recordatorio dos veces: el duplicado no cuenta */
  {
    const b = mkBooking({ booking_date: plus(7) });
    const h = mkHarness([b], {});
    await run(h, [b]);
    const r2 = await run(h, [b]);
    ok('7.3 segundo run: duplicado no cuenta como reminded', r2.reminded === 0 && r2.failed === 0 && h.emails.length === 2);
  }

  /* 7.4 sin correo de cliente: se omite */
  {
    const b = mkBooking({ booking_date: plus(7), customer_email: '' });
    const h = mkHarness([b], {});
    const r = await run(h, [b]);
    ok('7.4 sin correo: no envía', h.emails.length === 0 && r.reminded === 0 && r.failed === 0);
  }

  /* 7.5 día 5 sin PI: cancela condicional */
  {
    const b = mkBooking();
    const h = mkHarness([b], {});
    const r = await run(h, [b]);
    const w = h.sb.db.writes.filter(function (x) { return x.table === 'bookings' && x.op === 'update'; });
    ok('7.5 día 5: update condicional con los campos exactos',
      w.length === 1 && w[0].payload.booking_status === 'cancelled' && w[0].payload.cancel_reason === 'balance_unpaid' &&
      /^\d{4}-\d{2}-\d{2}T/.test(w[0].payload.auto_cancelled_at));
    ok('7.5b fila realmente cancelada', b.booking_status === 'cancelled' && b.cancel_reason === 'balance_unpaid' && !!b.auto_cancelled_at);
    ok('7.5c notifyBooking cliente+dueño con la fila actualizada',
      h.notifies.length === 1 && h.notifies[0][1] === 'customer_deposit_cancelled' &&
      h.notifies[0][2] === 'owner_deposit_cancelled' && h.notifies[0][0].booking_status === 'cancelled');
    ok('7.5d auditoría booking.auto_cancel',
      h.audits.length === 1 && h.audits[0].action === 'booking.auto_cancel' && h.audits[0].entity_type === 'booking' &&
      h.audits[0].entity_id === 'b1' && h.audits[0].before.payment_status === 'deposit_paid' &&
      h.audits[0].after.cancel_reason === 'balance_unpaid');
    ok('7.5e contadores', r.cancelled === 1 && r.reminded === 0 && r.skippedProcessing === 0 && r.failed === 0 && h.stripeCalls.length === 0);
  }

  /* 7.6 PI processing / succeeded: no cancelar */
  for (const st of ['processing', 'succeeded']) {
    const b = mkBooking({ balance_payment_intent_id: 'pi_1' });
    const h = mkHarness([b], { pi_1: st });
    const r = await run(h, [b]);
    ok('7.6 PI ' + st + ': no cancela, skippedProcessing 1',
      r.skippedProcessing === 1 && r.cancelled === 0 && b.booking_status === 'confirmed' &&
      h.notifies.length === 0 && h.audits.length === 0 && !h.stripeCalls.some(function (c) { return c[0] === 'cancel'; }));
  }

  /* 7.7 PI cancelables: cancela el PI primero, luego la reserva */
  for (const st of ['requires_payment_method', 'requires_confirmation', 'requires_action', 'requires_capture']) {
    const b = mkBooking({ balance_payment_intent_id: 'pi_2' });
    const h = mkHarness([b], { pi_2: st });
    const r = await run(h, [b]);
    ok('7.7 PI ' + st + ': cancela PI y luego la reserva',
      JSON.stringify(h.stripeCalls) === JSON.stringify([['retrieve', 'pi_2'], ['cancel', 'pi_2']]) &&
      b.booking_status === 'cancelled' && r.cancelled === 1);
  }

  /* 7.8 PI ya canceled: procede sin volver a cancelar */
  {
    const b = mkBooking({ balance_payment_intent_id: 'pi_3' });
    const h = mkHarness([b], { pi_3: 'canceled' });
    const r = await run(h, [b]);
    ok('7.8 PI canceled: cancela la reserva sin cancelar el PI',
      b.booking_status === 'cancelled' && r.cancelled === 1 && !h.stripeCalls.some(function (c) { return c[0] === 'cancel'; }));
  }

  /* 7.9 error de Stripe en retrieve / cancel / sin cliente */
  {
    const b1 = mkBooking({ balance_payment_intent_id: 'pi_4' });
    const h1 = mkHarness([b1], {}, { retrieveThrows: true });
    const r1 = await run(h1, [b1]);
    ok('7.9 error en retrieve: failed, no cancela', r1.failed === 1 && r1.cancelled === 0 && b1.booking_status === 'confirmed' && h1.notifies.length === 0);

    const b2 = mkBooking({ balance_payment_intent_id: 'pi_5' });
    const h2 = mkHarness([b2], { pi_5: 'requires_payment_method' }, { cancelThrows: true });
    const r2 = await run(h2, [b2]);
    ok('7.9b error en cancel del PI: failed, reserva intacta', r2.failed === 1 && r2.cancelled === 0 && b2.booking_status === 'confirmed');

    const b3 = mkBooking({ balance_payment_intent_id: 'pi_6' });
    const h3 = mkHarness([b3], {}, { noStripe: true });
    const r3 = await run(h3, [b3]);
    ok('7.9c sin cliente Stripe y con PI: failed, reserva intacta', r3.failed === 1 && r3.cancelled === 0 && b3.booking_status === 'confirmed');
  }

  /* 7.10 correr dos veces cancela una sola vez y manda un solo correo */
  {
    const b = mkBooking();
    const h = mkHarness([b], {});
    const r1 = await run(h, [b]);
    const r2 = await run(h, [Object.assign({}, b, { booking_status: 'confirmed' })]); // fila vieja leída antes
    ok('7.10 dos corridas: una cancelación, un par de correos, una auditoría',
      r1.cancelled === 1 && r2.cancelled === 0 && h.notifies.length === 1 && h.audits.length === 1);
  }

  /* 7.11 update de 0 filas (la webhook ganó): sin correo */
  {
    const b = mkBooking();
    const h = mkHarness([b], {});
    b.balance_paid_at = '2026-11-25T00:00:00Z';                     // la webhook marcó pagado en la DB
    const stale = Object.assign({}, b, { balance_paid_at: null });   // fila leída antes
    const r = await run(h, [stale]);
    ok('7.11 0 filas: sin correo, sin auditoría, no cuenta', r.cancelled === 0 && h.notifies.length === 0 && h.audits.length === 0 && b.booking_status === 'confirmed');
  }

  /* 7.12 is_test solo con includeTest */
  {
    const b = mkBooking({ is_test: true });
    const h = mkHarness([b], {});
    const r = await run(h, [b]);
    ok('7.12 is_test omitido sin includeTest', r.cancelled === 0 && b.booking_status === 'confirmed');
    const r2 = await run(h, [b], { includeTest: true });
    ok('7.12b is_test procesado con includeTest', r2.cancelled === 1 && b.booking_status === 'cancelled');
  }

  /* 7.13 balanceUrl sin configuración: failed, sin correo */
  {
    const saved = process.env.QR_SIGNING_SECRET;
    delete process.env.QR_SIGNING_SECRET;
    try {
      const b = mkBooking({ booking_date: plus(7) });
      const h = mkHarness([b], {});
      const r = await run(h, [b]);
      ok('7.13 sin QR_SIGNING_SECRET: failed 1, ningún correo', r.failed === 1 && r.reminded === 0 && h.emails.length === 0);
    } finally { process.env.QR_SIGNING_SECRET = saved; }
  }

  /* 7.14 una reserva que lanza no frena la siguiente */
  {
    const bad = mkBooking({ id: 'bad', booking_date: plus(7) });
    const good = mkBooking({ id: 'good', booking_date: plus(5) });
    const h = mkHarness([bad, good], {});
    const r = await run(h, [bad, good], { sendBookingEmail: async function () { throw new Error('boom'); } });
    ok('7.14 la que lanza cuenta failed y la siguiente se cancela',
      r.failed === 1 && r.cancelled === 1 && good.booking_status === 'cancelled' && bad.booking_status === 'confirmed');
  }

  /* 7.15 pre-trip dueFor */
  {
    const rem = require('../server/lib/pretrip-reminders');
    const base = { id: 'x', customer_email: 'a@b.co', payment_plan: 'deposit', payment_status: 'deposit_paid', booking_status: 'confirmed' };
    const d7 = rem.dueFor(Object.assign({}, base, { booking_date: plus(7) }), T);
    const d5 = rem.dueFor(Object.assign({}, base, { booking_date: plus(5) }), T);
    const d3 = rem.dueFor(Object.assign({}, base, { booking_date: plus(3) }), T);
    const paid7 = rem.dueFor(Object.assign({}, base, { payment_status: 'paid', booking_date: plus(7) }), T);
    const full7 = rem.dueFor({ id: 'y', customer_email: 'a@b.co', booking_date: plus(7), payment_status: 'paid' }, T);
    ok('7.15 dueFor omite d7 y d5 con saldo pendiente (balance_pending)',
      d7.due === false && d7.reason === 'balance_pending' && d7.type === null && d5.due === false && d5.reason === 'balance_pending');
    ok('7.15b dueFor sigue enviando d3 con saldo pendiente', d3.due === true && d3.type === 'pretrip_reminder_d3');
    ok('7.15c depósito con saldo pagado y reserva normal reciben d7', paid7.due === true && full7.due === true);
  }

  /* 7.16 fuente de reminders-run */
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'admin-handlers', 'reminders-run.js'), 'utf8');
    const i = src.indexOf("eq('payment_plan', 'deposit')");
    const j = src.indexOf('if (onlyBookingId) dq', i);
    const seg = (i === -1 || j === -1) ? '' : src.slice(src.lastIndexOf('let dq', i), j);
    ok('7.16 consulta del barrido con payment_plan/payment_status/booking_status', seg !== '' && /deposit_paid/.test(seg) && /confirmed/.test(seg));
    ok('7.16b consulta del barrido sin reminders_paused', seg !== '' && !/reminders_paused/.test(seg));
    ok('7.16c consulta acotada por onlyBookingId', /if \(onlyBookingId\) dq = dq\.eq\('id', onlyBookingId\)/.test(src));
    ok('7.16d el barrido no está dentro de un if (!onlyBookingId)', !/if \(!onlyBookingId\)/.test(src) && /runDepositSweep\(/.test(src));
    ok('7.16e summary.deposit', /summary\.deposit\s*=/.test(src));
  }

  /* 7.18 la fila vieja no tenía PI pero la DB ya tiene uno (cliente pagando): 0 filas, sin correo */
  {
    const b = mkBooking();
    const h = mkHarness([b], {});
    const stale = Object.assign({}, b);                     // leída antes de que apareciera el PI
    b.balance_payment_intent_id = 'pi_late';                // el cliente abrió /saldo
    const r = await run(h, [stale]);
    ok('7.18 PI aparecido tras la lectura: no cancela, sin correo ni auditoría',
      r.cancelled === 0 && b.booking_status === 'confirmed' && h.notifies.length === 0 && h.audits.length === 0);
  }
  /* 7.18b la fila vieja tenía PI y cambió en la DB: tampoco cancela */
  {
    const b = mkBooking({ balance_payment_intent_id: 'pi_old' });
    const h = mkHarness([b], { pi_old: 'canceled' });
    const stale = Object.assign({}, b);
    b.balance_payment_intent_id = 'pi_new';
    const r = await run(h, [stale]);
    ok('7.18b PI distinto al leído: 0 filas, no cancela', r.cancelled === 0 && b.booking_status === 'confirmed' && h.notifies.length === 0);
  }

  /* 7.19 aviso de cancelación fallido: se cuenta, se registra, la reserva sigue cancelada */
  {
    const b = mkBooking();
    const h = mkHarness([b], {}, { notifyResult: { customer: { failed: true }, owner: { sent: true } } });
    const before = logs.length;
    const r = await run(h, [b]);
    ok('7.19 notifyFailed 1, reserva cancelada y contada', r.notifyFailed === 1 && r.cancelled === 1 && b.booking_status === 'cancelled');
    ok('7.19b línea de log capturada con el id', logs.slice(before).some(function (l) { return l.indexOf('b1') !== -1 && /aviso/i.test(l); }));
    ok('7.19c auditoría con el resultado de los avisos',
      h.audits.length === 1 && h.audits[0].after.notify && h.audits[0].after.notify.customer === 'failed' && h.audits[0].after.notify.owner === 'sent');
    const b2 = mkBooking({ id: 'b2' });
    const h2 = mkHarness([b2], {});
    const r2 = await run(h2, [b2]);
    ok('7.19d avisos correctos: notifyFailed 0', r2.notifyFailed === 0 && r2.cancelled === 1);
  }

  ok('7.17 los fallos esperados quedaron registrados en el log', logs.length >= 5);

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) {
  fail++;
  console.log('FAIL  excepción no controlada: ' + ((e && e.stack) || e));
  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(1);
});
