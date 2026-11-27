'use strict';

/* =========================================================
   Plantillas de correo — depósito del 30 %.
   ---------------------------------------------------------
   · Cliente → BILINGÜE (inglés primero, español después).
   · Internos → español.
   Los helpers llegan por parámetro desde email-templates.js
   (evita un require circular). Todo valor del usuario pasa
   por esc(); rows() NO escapa la columna de valores.
   ========================================================= */

function buildDepositTemplates(h) {
  const { shell, h1, rows, para, ctaButton, money, esc, textBlock, bookingPairs,
    replyTo, siteUrl, qrBlock, adminLink, methodLabel } = h;

  const due = function (b) { return b.balance_due_date || '—'; };
  const footerText = function () {
    return textBlock([replyTo() ? ('Contact / Contacto: ' + replyTo()) : null, siteUrl() || null]);
  };

  /* Filas de montos para el cliente. */
  function moneyRows(b) {
    return rows(bookingPairs(b, { name: true }).concat([
      ['Total', esc(money(b.amount_cents, b.currency))],
      ['Deposit paid / Depósito pagado', esc(money(b.deposit_cents, b.currency))],
      ['Balance due / Saldo pendiente', esc(money(b.balance_cents, b.currency))],
      ['Pay by / Pagar antes de', esc(due(b)) + ' (23:59 Galápagos)']
    ]));
  }
  function moneyText(b) {
    return [
      'Booking code / Código: ' + (b.booking_code || ''),
      'Tour: ' + (b.tour_name || ''),
      'Date / Fecha: ' + (b.booking_date || ''),
      'Total: ' + money(b.amount_cents, b.currency),
      'Deposit paid / Depósito pagado: ' + money(b.deposit_cents, b.currency),
      'Balance due / Saldo pendiente: ' + money(b.balance_cents, b.currency),
      'Pay by / Pagar antes de: ' + due(b) + ' (23:59 Galápagos)'
    ];
  }
  function payText(ctx) {
    return ctx.balanceUrl ? ['Pay balance / Pagar saldo: ' + ctx.balanceUrl] : [];
  }

  /* --- 1. Cliente: reserva confirmada con depósito (con QR) --- */
  function customerDepositConfirmation(b, ctx) {
    ctx = ctx || {};
    const subject = 'Your booking is confirmed (30% deposit) — ' + (b.booking_code || '');
    const html = shell(subject,
      h1('Booking confirmed with a 30% deposit', 'Reserva confirmada con depósito del 30 %')
      + para('Thank you, ' + (b.customer_name || '') + '. We received your deposit and your booking is confirmed. The remaining balance must be paid by ' + due(b) + ' (until 23:59 Galápagos time).',
             'Gracias, ' + (b.customer_name || '') + '. Recibimos tu depósito y tu reserva está confirmada. El saldo restante debe pagarse a más tardar el ' + due(b) + ' (hasta las 23:59 hora de Galápagos).')
      + moneyRows(b)
      + ctaButton(ctx.balanceUrl, 'Pagar saldo / Pay balance')
      + para('Cancellation rules: if you cancel more than 30 days before your trip, your deposit is refunded. If you cancel 30 days or less before your trip, the deposit is lost.',
             'Reglas de cancelación: si cancelas con más de 30 días de anticipación, se te reembolsa el depósito. Si cancelas con 30 días o menos, el depósito se pierde.')
      + para('If the balance is not paid by the due date, your booking is cancelled automatically and the deposit is lost.',
             'Si el saldo no se paga a más tardar en la fecha límite, tu reserva es cancelada automáticamente y el depósito se pierde.')
      + (ctx.qrUrl ? qrBlock(ctx.qrUrl, ctx.cid) : '')
      + para('See you in San Cristóbal!', '¡Nos vemos en San Cristóbal!'));
    const text = textBlock([
      'BOOKING CONFIRMED (30% DEPOSIT) / RESERVA CONFIRMADA (DEPÓSITO 30 %)', ''
    ].concat(moneyText(b), [''], payText(ctx), [
      '',
      'If you cancel more than 30 days before your trip, your deposit is refunded. With 30 days or less, it is lost.',
      'Si cancelas con más de 30 días de anticipación, se te reembolsa el depósito. Con 30 días o menos, se pierde.',
      'If the balance is not paid by the due date, the booking is cancelled automatically and the deposit is lost.',
      'Si el saldo no se paga a tiempo, la reserva es cancelada automáticamente y el depósito se pierde.',
      '',
      ctx.qrUrl ? ('QR: ' + ctx.qrUrl) : null, '',
      footerText()
    ]));
    return { subject: subject, html: html, text: text };
  }

  /* --- 2. Cliente: recordatorio del saldo (7 días antes) --- */
  function balanceReminderD7(b, ctx) {
    ctx = ctx || {};
    const subject = 'Reminder: your balance is due by ' + due(b) + ' — ' + (b.booking_code || '');
    const html = shell(subject,
      h1('Your balance is due soon', 'Tu saldo vence pronto')
      + para('Hi ' + (b.customer_name || '') + ', this is a reminder that the balance of your booking must be paid by ' + due(b) + ' (until 23:59 Galápagos time).',
             'Hola ' + (b.customer_name || '') + ', te recordamos que el saldo de tu reserva debe pagarse a más tardar el ' + due(b) + ' (hasta las 23:59 hora de Galápagos).')
      + moneyRows(b)
      + ctaButton(ctx.balanceUrl, 'Pagar saldo / Pay balance')
      + para('If the balance is not paid in time, the booking is cancelled automatically and the deposit is lost.',
             'Si el saldo no se paga a tiempo, la reserva es cancelada automáticamente y el depósito se pierde.'));
    const text = textBlock([
      'BALANCE REMINDER / RECORDATORIO DE SALDO', ''
    ].concat(moneyText(b), [''], payText(ctx), [
      '',
      'If the balance is not paid in time, the booking is cancelled automatically and the deposit is lost.',
      'Si el saldo no se paga a tiempo, la reserva es cancelada automáticamente y el depósito se pierde.', '',
      footerText()
    ]));
    return { subject: subject, html: html, text: text };
  }

  /* --- 3. Cliente: último aviso (hoy es el último día) --- */
  function balanceReminderD6(b, ctx) {
    ctx = ctx || {};
    const subject = 'Last day to pay your balance — ' + (b.booking_code || '');
    const html = shell(subject,
      h1('Last notice: today is the last day to pay', 'Último aviso: hoy es el último día para pagar')
      + para('Hi ' + (b.customer_name || '') + ', today is the last day to pay the balance of your booking (until 23:59 Galápagos time). Tomorrow the booking is cancelled automatically and the deposit is lost.',
             'Hola ' + (b.customer_name || '') + ', hoy es el último día para pagar el saldo de tu reserva (hasta las 23:59 hora de Galápagos). Mañana la reserva es cancelada automáticamente y el depósito se pierde.')
      + moneyRows(b)
      + ctaButton(ctx.balanceUrl, 'Pagar saldo / Pay balance'));
    const text = textBlock([
      'LAST NOTICE / ÚLTIMO AVISO', '',
      'Hi ' + (b.customer_name || '') + ', today is the last day to pay the balance (until 23:59 Galápagos time). Tomorrow the booking is cancelled automatically and the deposit is lost.',
      'Hola ' + (b.customer_name || '') + ', hoy es el último día para pagar el saldo (hasta las 23:59 hora de Galápagos). Mañana la reserva es cancelada automáticamente y el depósito se pierde.', ''
    ].concat(moneyText(b), [''], payText(ctx), ['', footerText()]));
    return { subject: subject, html: html, text: text };
  }

  /* --- 4. Cliente: reserva cancelada por saldo impago --- */
  function customerDepositCancelled(b) {
    const subject = 'Your booking was cancelled — ' + (b.booking_code || '');
    const html = shell(subject,
      h1('Booking cancelled', 'Reserva cancelada')
      + para('Hi ' + (b.customer_name || '') + ', your booking was cancelled because the balance was not paid by ' + due(b) + '. The deposit is non-refundable.',
             'Hola ' + (b.customer_name || '') + ', tu reserva fue cancelada porque el saldo no se pagó a más tardar el ' + due(b) + '. El depósito no es reembolsable.')
      + rows(bookingPairs(b, { name: true }))
      + para('If you think this is a mistake, please contact us' + (h.replyTo() ? ' at ' + h.replyTo() : '') + '.',
             'Si crees que es un error, contáctanos' + (h.replyTo() ? ' en ' + h.replyTo() : '') + '.'));
    const text = textBlock([
      'BOOKING CANCELLED / RESERVA CANCELADA', '',
      'Booking code / Código: ' + (b.booking_code || ''),
      'Your booking was cancelled because the balance was not paid by ' + due(b) + '. The deposit is non-refundable.',
      'Tu reserva fue cancelada porque el saldo no se pagó a más tardar el ' + due(b) + '. El depósito no es reembolsable.', '',
      footerText()
    ]);
    return { subject: subject, html: html, text: text };
  }

  /* --- 5. Cliente: recibo del saldo --- */
  function customerBalanceReceipt(b) {
    const subject = 'Balance received, your booking is fully paid — ' + (b.booking_code || '');
    const html = shell(subject,
      h1('Balance received', 'Saldo recibido')
      + para('Thank you, ' + (b.customer_name || '') + '. We received your balance and your booking is now fully paid.',
             'Gracias, ' + (b.customer_name || '') + '. Recibimos tu saldo y tu reserva está pagada por completo.')
      + rows(bookingPairs(b, { name: true }).concat([
        ['Balance paid / Saldo pagado', esc(money(b.balance_cents, b.currency))],
        ['Total', esc(money(b.amount_cents, b.currency))]
      ]))
      + para('See you in San Cristóbal!', '¡Nos vemos en San Cristóbal!'));
    const text = textBlock([
      'BALANCE RECEIVED / SALDO RECIBIDO', '',
      'Booking code / Código: ' + (b.booking_code || ''),
      'Tour: ' + (b.tour_name || ''),
      'Date / Fecha: ' + (b.booking_date || ''),
      'Balance paid / Saldo pagado: ' + money(b.balance_cents, b.currency),
      'Total: ' + money(b.amount_cents, b.currency),
      'Your booking is now fully paid. / Tu reserva está pagada por completo.', '',
      footerText()
    ]);
    return { subject: subject, html: html, text: text };
  }

  /* --- Internos (español) --- */
  function ownerRows(b, extra) {
    return rows([
      ['Código', esc(b.booking_code)],
      ['Cliente', esc(b.customer_name)],
      ['Email', esc(b.customer_email || '—')],
      ['Tour', esc(b.tour_name)],
      ['Fecha', esc(b.booking_date)],
      ['Total', esc(money(b.amount_cents, b.currency))]
    ].concat(extra || []));
  }
  function ownerText(b, lines) {
    return textBlock([
      'Código: ' + (b.booking_code || ''),
      'Cliente: ' + (b.customer_name || ''),
      'Tour: ' + (b.tour_name || ''),
      'Fecha: ' + (b.booking_date || '')
    ].concat(lines || [], ['', siteUrl() ? (siteUrl() + '/admin.html') : null]));
  }

  function ownerDepositNotification(b) {
    const subject = 'Nueva reserva con depósito — ' + (b.booking_code || '') + ' — ' + (b.tour_name || '');
    const html = shell(subject,
      h1('Nueva reserva con depósito del 30 %', 'Canal: web · Stripe')
      + ownerRows(b, [
        ['Depósito pagado', esc(money(b.deposit_cents, b.currency))],
        ['Saldo pendiente', esc(money(b.balance_cents, b.currency))],
        ['Vence el', esc(due(b)) + ' (23:59 Galápagos)']
      ])
      + adminLink());
    const text = 'NUEVA RESERVA CON DEPÓSITO\n\n' + ownerText(b, [
      'Total: ' + money(b.amount_cents, b.currency),
      'Depósito pagado: ' + money(b.deposit_cents, b.currency),
      'Saldo pendiente: ' + money(b.balance_cents, b.currency),
      'Vence el: ' + due(b) + ' (23:59 Galápagos)'
    ]);
    return { subject: subject, html: html, text: text };
  }

  function ownerBalanceReceived(b) {
    const subject = 'Saldo recibido — ' + (b.booking_code || '') + ' — ' + (b.tour_name || '');
    const hasMethod = !!b.balance_payment_method;
    const html = shell(subject,
      h1('Saldo recibido', 'La reserva quedó pagada por completo')
      + ownerRows(b, [
        ['Saldo cobrado', esc(money(b.balance_cents, b.currency))],
        hasMethod ? ['Método', esc(methodLabel(b.balance_payment_method))] : null
      ])
      + adminLink());
    const text = 'SALDO RECIBIDO\n\n' + ownerText(b, [
      'Saldo cobrado: ' + money(b.balance_cents, b.currency),
      hasMethod ? ('Método: ' + methodLabel(b.balance_payment_method)) : null
    ]);
    return { subject: subject, html: html, text: text };
  }

  function ownerDepositCancelled(b) {
    const subject = 'Reserva cancelada por saldo impago — ' + (b.booking_code || '');
    const html = shell(subject,
      h1('Cancelada automáticamente: saldo no pagado', 'El depósito queda retenido')
      + ownerRows(b, [
        ['Depósito retenido', esc(money(b.deposit_cents, b.currency))],
        ['Saldo impago', esc(money(b.balance_cents, b.currency))],
        ['Venció el', esc(due(b))]
      ])
      + adminLink());
    const text = 'CANCELADA POR SALDO IMPAGO (depósito retenido)\n\n' + ownerText(b, [
      'Depósito retenido: ' + money(b.deposit_cents, b.currency),
      'Saldo impago: ' + money(b.balance_cents, b.currency),
      'Venció el: ' + due(b)
    ]);
    return { subject: subject, html: html, text: text };
  }

  function ownerPaymentReview(b) {
    const subject = 'REVISAR: pago de saldo después de la cancelación — ' + (b.booking_code || '');
    const html = shell(subject,
      h1('Revisar pago: llegó DESPUÉS de la cancelación', 'Hay que reembolsar o reactivar')
      + '<p style="margin:0 0 14px;color:#11302f;">Entró un pago de saldo cuando la reserva ya estaba cancelada automáticamente. Revisa y decide si reembolsar o reactivar la reserva. No se reactivó nada automáticamente.</p>'
      + ownerRows(b, [
        ['Saldo recibido', esc(money(b.balance_cents, b.currency))]
      ])
      + adminLink());
    const text = 'REVISAR PAGO DE SALDO\n\n'
      + 'Llegó un pago de saldo DESPUÉS de que la reserva fue cancelada automáticamente. Revisa y decide: reembolsar o reactivar. No se reactivó nada automáticamente.\n\n'
      + ownerText(b, ['Saldo recibido: ' + money(b.balance_cents, b.currency)]);
    return { subject: subject, html: html, text: text };
  }

  return {
    customer_deposit_confirmation: { build: customerDepositConfirmation, qr: true },
    balance_reminder_d7: { build: balanceReminderD7, qr: false },
    balance_reminder_d6: { build: balanceReminderD6, qr: false },
    customer_deposit_cancelled: { build: customerDepositCancelled, qr: false },
    customer_balance_receipt: { build: customerBalanceReceipt, qr: false },
    owner_deposit_notification: { build: ownerDepositNotification, qr: false },
    owner_balance_received: { build: ownerBalanceReceived, qr: false },
    owner_deposit_cancelled: { build: ownerDepositCancelled, qr: false },
    owner_payment_review: { build: ownerPaymentReview, qr: false }
  };
}

module.exports = { buildDepositTemplates };
