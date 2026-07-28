'use strict';

/* =========================================================
   LOAN-IX Booking Engine — plantillas de correo
   ---------------------------------------------------------
   · Cliente  → BILINGÜE: inglés primero, español después.
   · Internos → español.
   Todo valor introducido por el usuario pasa por esc().
   Sin JavaScript y sin imágenes externas obligatorias.
   ========================================================= */

const BRAND = 'Galápagos Hook Adventure';
const INK = '#11302f', GOLD = '#cf9f54', PAPER = '#fbf8f1', SOFT = '#3c534f', LINE = '#e2ddd0';

/* ---------------- utilidades ---------------- */
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function money(cents, currency) {
  if (cents == null) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || 'usd').toUpperCase() })
      .format(Number(cents) / 100);
  } catch (e) { return '$' + (Number(cents) / 100).toFixed(2); }
}
function methodLabel(m) {
  const map = { cash: 'Efectivo / Cash', card: 'Tarjeta / Card', bank_transfer: 'Transferencia / Bank transfer', zelle: 'Zelle', other: 'Otro / Other', stripe: 'Stripe' };
  return map[m] || (m || '—');
}
function siteUrl() { return String(process.env.PUBLIC_SITE_URL || '').replace(/\/+$/, ''); }
function replyTo() { return process.env.EMAIL_REPLY_TO || ''; }
/* Logo oficial servido por URL pública ESTABLE (PUBLIC_SITE_URL): nunca base64
   ni ruta local, y no se adjunta. En Production PUBLIC_SITE_URL debe ser el
   dominio canónico, no una URL de Preview. El QR sigue yendo como adjunto. */
function logoUrl() { const u = siteUrl(); return u ? (u + '/assets/img/logo.png') : ''; }

/* ---------------- envoltorio HTML ---------------- */
function shell(title, innerHtml) {
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc(title) + '</title></head>'
    + '<body style="margin:0;padding:0;background:' + PAPER + ';">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + PAPER + ';padding:24px 12px;">'
    + '<tr><td align="center">'
    + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ' + LINE + ';border-radius:12px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;">'
    /* Encabezado en TABLA (no flex/background-image): logo por <img> real +
       texto. El texto queda visible aunque la imagen no cargue; el alt lleva
       la marca. Compatible con Outlook desktop y móvil (usa width/height y
       valign en atributos, no solo CSS). */
    + '<tr><td style="background:' + INK + ';padding:18px 26px;">'
    + '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
    + (logoUrl()
        ? ('<td valign="middle" style="vertical-align:middle;padding-right:14px;">'
           + '<img src="' + esc(logoUrl()) + '" alt="' + esc(BRAND) + '" width="50" height="50" '
           + 'style="display:block;width:50px;height:50px;border-radius:50%;background:' + PAPER + ';border:0;outline:none;text-decoration:none;">'
           + '</td>')
        : '')
    + '<td valign="middle" style="vertical-align:middle;">'
    + '<div style="color:' + PAPER + ';font-size:19px;font-weight:700;letter-spacing:.02em;">' + BRAND + '</div>'
    + '<div style="color:' + GOLD + ';font-size:12px;letter-spacing:.14em;text-transform:uppercase;margin-top:4px;">San Cristóbal · Galápagos</div>'
    + '</td>'
    + '</tr></table>'
    + '</td></tr>'
    + '<tr><td style="padding:26px;color:' + INK + ';font-size:15px;line-height:1.6;">' + innerHtml + '</td></tr>'
    + '<tr><td style="background:' + PAPER + ';padding:18px 26px;border-top:1px solid ' + LINE + ';color:' + SOFT + ';font-size:12px;line-height:1.6;">'
    + (replyTo() ? ('Contact / Contacto: <a href="mailto:' + esc(replyTo()) + '" style="color:' + INK + ';">' + esc(replyTo()) + '</a><br>') : '')
    + (siteUrl() ? ('<a href="' + esc(siteUrl()) + '" style="color:' + INK + ';">' + esc(siteUrl()) + '</a>') : '')
    + '</td></tr></table></td></tr></table></body></html>';
}
function h1(en, es) {
  return '<div style="font-size:22px;font-weight:700;color:' + INK + ';margin:0 0 4px;">' + esc(en) + '</div>'
    + '<div style="font-size:15px;color:' + SOFT + ';margin:0 0 20px;">' + esc(es) + '</div>';
}
function rows(pairs) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ' + LINE + ';border-radius:8px;overflow:hidden;margin:6px 0 18px;">'
    + pairs.filter(Boolean).map(function (p, i) {
      return '<tr style="background:' + (i % 2 ? '#faf8f3' : '#ffffff') + ';">'
        + '<td style="padding:9px 14px;color:' + SOFT + ';font-size:12px;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;">' + esc(p[0]) + '</td>'
        + '<td style="padding:9px 14px;color:' + INK + ';font-weight:600;">' + p[1] + '</td></tr>';
    }).join('') + '</table>';
}
function para(en, es) {
  return '<p style="margin:0 0 6px;color:' + INK + ';">' + esc(en) + '</p>'
    + '<p style="margin:0 0 18px;color:' + SOFT + ';">' + esc(es) + '</p>';
}
/* Bloque del QR: imagen inline por CID cuando el cliente lo soporta,
   más el adjunto y la URL de respaldo, que siempre están disponibles. */
function qrBlock(qrUrl, cid) {
  return '<div style="text-align:center;border:1px solid ' + LINE + ';border-radius:10px;padding:18px;margin:6px 0 18px;background:#faf8f3;">'
    + (cid ? '<img src="cid:' + esc(cid) + '" alt="QR" width="220" style="display:block;margin:0 auto 12px;width:220px;max-width:100%;height:auto;">' : '')
    + '<div style="font-weight:700;color:' + INK + ';margin-bottom:2px;">Show this QR code to the Hook Adventure team on the day of your tour.</div>'
    + '<div style="color:' + SOFT + ';margin-bottom:12px;">Muestra este código QR al equipo de Hook Adventure el día de tu tour.</div>'
    + '<div style="color:' + SOFT + ';font-size:12px;">The QR image is also attached to this email. / La imagen del QR también va adjunta.</div>'
    + '<div style="margin-top:10px;word-break:break-all;font-size:12px;"><a href="' + esc(qrUrl) + '" style="color:' + INK + ';">' + esc(qrUrl) + '</a></div>'
    + '</div>';
}
function adminLink() {
  const u = siteUrl();
  return u ? ('<p style="margin:14px 0 0;"><a href="' + esc(u) + '/admin.html" style="background:' + GOLD + ';color:' + INK + ';padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block;">Abrir panel</a></p>') : '';
}

/* ---------------- datos comunes ---------------- */
function bookingPairs(b, opts) {
  opts = opts || {};
  const out = [
    ['Booking code / Código', esc(b.booking_code)],
    ['Tour', esc(b.tour_name)],
    ['Date / Fecha', esc(b.booking_date)],
    ['Guests / Pax', esc(b.guests)]
  ];
  if (opts.name) out.push(['Name / Nombre', esc(b.customer_name)]);
  if (opts.amount && b.amount_cents != null) out.push(['Total', esc(money(b.amount_cents, b.currency))]);
  if (opts.method && b.payment_method) out.push(['Payment / Pago', esc(methodLabel(b.payment_method))]);
  return out;
}
function textBlock(lines) { return lines.filter(function (l) { return l != null; }).join('\n'); }

/* =====================================================================
   PLANTILLAS
   ===================================================================== */

/* --- 1. Cliente: reserva web pagada (con QR) --- */
function customerBookingConfirmation(b, ctx) {
  ctx = ctx || {};
  const subject = 'Your Galápagos booking is confirmed — ' + (b.booking_code || '');
  const html = shell(subject,
    h1('Booking confirmed', 'Reserva confirmada')
    + para('Thank you, ' + (b.customer_name || '') + '. Your payment was received and your booking is confirmed.',
           'Gracias, ' + (b.customer_name || '') + '. Recibimos tu pago y tu reserva está confirmada.')
    + rows(bookingPairs(b, { name: true, amount: true }))
    + (ctx.qrUrl ? qrBlock(ctx.qrUrl, ctx.cid) : '')
    + para('See you in San Cristóbal!', '¡Nos vemos en San Cristóbal!'));
  const text = textBlock([
    'BOOKING CONFIRMED / RESERVA CONFIRMADA', '',
    'Booking code / Código: ' + (b.booking_code || ''),
    'Tour: ' + (b.tour_name || ''),
    'Date / Fecha: ' + (b.booking_date || ''),
    'Guests / Pax: ' + (b.guests || ''),
    'Total: ' + money(b.amount_cents, b.currency), '',
    ctx.qrUrl ? 'Show this QR code to the Hook Adventure team on the day of your tour.' : null,
    ctx.qrUrl ? 'Muestra este código QR al equipo de Hook Adventure el día de tu tour.' : null,
    ctx.qrUrl ? ctx.qrUrl : null, '',
    replyTo() ? ('Contact / Contacto: ' + replyTo()) : null,
    siteUrl() || null
  ]);
  return { subject: subject, html: html, text: text };
}

/* --- 2. Interno: nueva reserva web pagada --- */
function ownerBookingNotification(b) {
  const subject = 'Nueva reserva pagada — ' + (b.booking_code || '') + ' — ' + (b.tour_name || '');
  const html = shell(subject,
    h1('Nueva reserva pagada', 'Canal: web · Stripe')
    + rows([
      ['Código', esc(b.booking_code)],
      ['Cliente', esc(b.customer_name)],
      ['Email', esc(b.customer_email || '—')],
      ['Teléfono', esc(b.customer_phone || '—')],
      ['Tour', esc(b.tour_name)],
      ['Fecha', esc(b.booking_date)],
      ['Pax', esc(b.guests)],
      ['Monto', esc(money(b.amount_cents, b.currency))],
      ['Canal', esc(b.sales_channel || 'web')],
      ['Pagado', esc(b.paid_at || '—')]
    ])
    + adminLink());
  const text = textBlock([
    'NUEVA RESERVA PAGADA', '',
    'Código: ' + (b.booking_code || ''),
    'Cliente: ' + (b.customer_name || ''),
    'Email: ' + (b.customer_email || '—'),
    'Teléfono: ' + (b.customer_phone || '—'),
    'Tour: ' + (b.tour_name || ''),
    'Fecha: ' + (b.booking_date || ''),
    'Pax: ' + (b.guests || ''),
    'Monto: ' + money(b.amount_cents, b.currency),
    'Canal: ' + (b.sales_channel || 'web'),
    'Pagado: ' + (b.paid_at || '—'), '',
    siteUrl() ? (siteUrl() + '/admin.html') : null
  ]);
  return { subject: subject, html: html, text: text };
}

/* --- 3. Cliente: cotización recibida (sin QR) --- */
function customerQuoteAcknowledgement(b) {
  const subject = 'We received your request — ' + (b.booking_code || '');
  const html = shell(subject,
    h1('Request received', 'Solicitud recibida')
    + para('Thank you, ' + (b.customer_name || '') + '. We received your request and our team will contact you shortly with a personalized quote.',
           'Gracias, ' + (b.customer_name || '') + '. Recibimos tu solicitud y nuestro equipo te contactará en breve con una cotización personalizada.')
    + rows(bookingPairs(b, { name: true }))
    + para('This is not a confirmed or paid booking yet.',
           'Esta solicitud todavía no es una reserva confirmada ni pagada.'));
  const text = textBlock([
    'REQUEST RECEIVED / SOLICITUD RECIBIDA', '',
    'Booking code / Código: ' + (b.booking_code || ''),
    'Tour: ' + (b.tour_name || ''),
    'Date / Fecha: ' + (b.booking_date || ''),
    'Guests / Pax: ' + (b.guests || ''), '',
    'This is not a confirmed or paid booking yet.',
    'Esta solicitud todavía no es una reserva confirmada ni pagada.', '',
    replyTo() ? ('Contact / Contacto: ' + replyTo()) : null
  ]);
  return { subject: subject, html: html, text: text };
}

/* --- 4. Interno: nueva cotización --- */
function ownerQuoteNotification(b) {
  const subject = 'Nueva solicitud de cotización — ' + (b.booking_code || '');
  const html = shell(subject,
    h1('Nueva solicitud de cotización', 'Requiere respuesta del equipo')
    + rows([
      ['Código', esc(b.booking_code)],
      ['Cliente', esc(b.customer_name)],
      ['Email', esc(b.customer_email || '—')],
      ['Teléfono', esc(b.customer_phone || '—')],
      ['Experiencia', esc(b.tour_name)],
      ['Fecha', esc(b.booking_date)],
      ['Pax', esc(b.guests)],
      b.notes ? ['Notas', esc(b.notes)] : null
    ])
    + adminLink());
  const text = textBlock([
    'NUEVA SOLICITUD DE COTIZACIÓN', '',
    'Código: ' + (b.booking_code || ''),
    'Cliente: ' + (b.customer_name || ''),
    'Email: ' + (b.customer_email || '—'),
    'Teléfono: ' + (b.customer_phone || '—'),
    'Experiencia: ' + (b.tour_name || ''),
    'Fecha: ' + (b.booking_date || ''),
    'Pax: ' + (b.guests || ''),
    b.notes ? ('Notas: ' + b.notes) : null, '',
    siteUrl() ? (siteUrl() + '/admin.html') : null
  ]);
  return { subject: subject, html: html, text: text };
}

/* --- 5. Cliente: venta directa de agencia (con QR, sin mencionar Stripe) --- */
function customerAgencyConfirmation(b, ctx) {
  ctx = ctx || {};
  const subject = 'Your booking is confirmed — ' + (b.booking_code || '');
  const html = shell(subject,
    h1('Booking confirmed', 'Reserva confirmada')
    + para('Thank you, ' + (b.customer_name || '') + '. Your booking has been recorded and your payment was received.',
           'Gracias, ' + (b.customer_name || '') + '. Tu reserva quedó registrada y tu pago fue recibido.')
    + rows(bookingPairs(b, { name: true, amount: true, method: true }))
    + (ctx.qrUrl ? qrBlock(ctx.qrUrl, ctx.cid) : '')
    + para('See you in San Cristóbal!', '¡Nos vemos en San Cristóbal!'));
  const text = textBlock([
    'BOOKING CONFIRMED / RESERVA CONFIRMADA', '',
    'Booking code / Código: ' + (b.booking_code || ''),
    'Tour: ' + (b.tour_name || ''),
    'Date / Fecha: ' + (b.booking_date || ''),
    'Guests / Pax: ' + (b.guests || ''),
    'Total: ' + money(b.amount_cents, b.currency),
    'Payment / Pago: ' + methodLabel(b.payment_method), '',
    ctx.qrUrl ? 'Show this QR code to the Hook Adventure team on the day of your tour.' : null,
    ctx.qrUrl ? 'Muestra este código QR al equipo de Hook Adventure el día de tu tour.' : null,
    ctx.qrUrl ? ctx.qrUrl : null, '',
    replyTo() ? ('Contact / Contacto: ' + replyTo()) : null
  ]);
  return { subject: subject, html: html, text: text };
}

/* --- 6. Interno: venta directa registrada --- */
function ownerAgencyNotification(b) {
  const subject = 'Venta directa registrada — ' + (b.booking_code || '') + ' — ' + (b.created_by_name || '');
  const html = shell(subject,
    h1('Venta directa registrada', 'Canal: agencia')
    + rows([
      ['Código', esc(b.booking_code)],
      ['Cliente', esc(b.customer_name)],
      ['Teléfono', esc(b.customer_phone || '—')],
      ['Email', esc(b.customer_email || '—')],
      ['Tour / destino', esc(b.tour_name)],
      ['Fecha', esc(b.booking_date)],
      ['Pax', esc(b.guests)],
      ['Monto', esc(money(b.amount_cents, b.currency))],
      ['Método', esc(methodLabel(b.payment_method))],
      ['Vendido', esc(b.sold_at || '—')],
      ['Registró', esc(b.created_by_name || '—')]
    ])
    + adminLink());
  const text = textBlock([
    'VENTA DIRECTA REGISTRADA', '',
    'Código: ' + (b.booking_code || ''),
    'Cliente: ' + (b.customer_name || ''),
    'Teléfono: ' + (b.customer_phone || '—'),
    'Email: ' + (b.customer_email || '—'),
    'Tour / destino: ' + (b.tour_name || ''),
    'Fecha: ' + (b.booking_date || ''),
    'Pax: ' + (b.guests || ''),
    'Monto: ' + money(b.amount_cents, b.currency),
    'Método: ' + methodLabel(b.payment_method),
    'Vendido: ' + (b.sold_at || '—'),
    'Registró: ' + (b.created_by_name || '—'), '',
    siteUrl() ? (siteUrl() + '/admin.html') : null
  ]);
  return { subject: subject, html: html, text: text };
}

/* Botón de acción reutilizable (sin JS, compatible con clientes de correo). */
function ctaButton(url, label) {
  if (!url) return '';
  return '<p style="margin:16px 0 8px;"><a href="' + esc(url) + '" style="background:' + GOLD + ';color:' + INK + ';padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:700;display:inline-block;">' + esc(label) + '</a></p>';
}
function connectionCityLabel(v) {
  const map = { quito: 'Quito', guayaquil: 'Guayaquil', either: 'Cualquiera / Either', connection_tbd: 'Por definir / TBD' };
  return map[v] || (v || '—');
}

/* --- 7. Cliente: invitación al formulario de pasajeros (sin QR) --- */
function customerPassengerFormInvitation(b, ctx) {
  ctx = ctx || {};
  const url = ctx.formUrl || (siteUrl() ? siteUrl() + '/passengers.html' : '');
  const subject = 'Complete your passenger details — ' + (b.booking_code || '');
  const html = shell(subject,
    h1('Complete your passenger details', 'Completa los datos de tus pasajeros')
    + para('Thank you, ' + (b.customer_name || '') + '. To begin preparing your flight options to San Cristóbal and, when needed, your connection-city hotel, please complete each passenger\'s details.',
           'Gracias, ' + (b.customer_name || '') + '. Para comenzar a preparar tus opciones de vuelos a San Cristóbal y, cuando sea necesario, el hotel en tu ciudad de conexión, completa los datos de cada pasajero.')
    + rows(bookingPairs(b, { name: true }))
    + ctaButton(url, 'Complete passenger details / Completar datos')
    + para('This secure link is personal to your booking — please do not share it.',
           'Este enlace seguro es personal de tu reserva — por favor no lo compartas.'));
  const text = textBlock([
    'COMPLETE YOUR PASSENGER DETAILS / COMPLETA LOS DATOS DE TUS PASAJEROS', '',
    'Booking code / Código: ' + (b.booking_code || ''),
    'Tour: ' + (b.tour_name || ''),
    'Date / Fecha: ' + (b.booking_date || ''),
    'Guests / Pax: ' + (b.guests || ''), '',
    url ? ('Open your secure form / Abre tu formulario seguro: ' + url) : null, '',
    'This secure link is personal to your booking — please do not share it.',
    'Este enlace seguro es personal de tu reserva — por favor no lo compartas.'
  ]);
  return { subject: subject, html: html, text: text };
}

/* --- 8. Interno: formulario de pasajeros recibido (sin documentos) --- */
function ownerPassengerFormSubmitted(b, ctx) {
  ctx = ctx || {};
  const form = ctx.form || {};
  const subject = 'Formulario de pasajeros recibido — ' + (b.booking_code || '');
  const html = shell(subject,
    h1('Formulario de pasajeros recibido', 'Requiere revisión del equipo')
    + rows([
      ['Código', esc(b.booking_code)],
      ['Cliente', esc(b.customer_name)],
      ['Tour', esc(b.tour_name)],
      ['Fecha', esc(b.booking_date)],
      ['Pax', esc(b.guests)],
      ['Ciudad preferida', esc(connectionCityLabel(form.preferred_connection_city))]
    ])
    + '<p style="margin:0 0 12px;color:' + SOFT + ';">Por seguridad, este correo no incluye números de documento. Abre el panel para revisar el expediente completo.</p>'
    + adminLink());
  const text = textBlock([
    'FORMULARIO DE PASAJEROS RECIBIDO', '',
    'Código: ' + (b.booking_code || ''),
    'Cliente: ' + (b.customer_name || ''),
    'Tour: ' + (b.tour_name || ''),
    'Fecha: ' + (b.booking_date || ''),
    'Pax: ' + (b.guests || ''),
    'Ciudad preferida: ' + connectionCityLabel(form.preferred_connection_city), '',
    'Por seguridad, este correo no incluye números de documento.',
    siteUrl() ? (siteUrl() + '/admin.html') : null
  ]);
  return { subject: subject, html: html, text: text };
}

/* --- 9. Cliente: se solicitan cambios en el formulario --- */
function customerPassengerFormChangesRequested(b, ctx) {
  ctx = ctx || {};
  const url = ctx.formUrl || (siteUrl() ? siteUrl() + '/passengers.html' : '');
  const note = ctx.note
    ? ('<p style="margin:0 0 10px;color:' + INK + ';"><strong>' + esc(ctx.note) + '</strong></p>')
    : '';
  const subject = 'We need a few changes — ' + (b.booking_code || '');
  const html = shell(subject,
    h1('We need a few changes', 'Necesitamos algunos cambios')
    + para('Thank you for your submission, ' + (b.customer_name || '') + '. Please review and update the passenger details using your secure link.',
           'Gracias por enviar los datos, ' + (b.customer_name || '') + '. Por favor revisa y actualiza la información de los pasajeros con tu enlace seguro.')
    + note
    + rows(bookingPairs(b, { name: true }))
    + ctaButton(url, 'Update passenger details / Actualizar datos'));
  const text = textBlock([
    'WE NEED A FEW CHANGES / NECESITAMOS ALGUNOS CAMBIOS', '',
    ctx.note ? ('Note / Nota: ' + ctx.note) : null,
    'Booking code / Código: ' + (b.booking_code || ''), '',
    url ? ('Update your details / Actualiza tus datos: ' + url) : null
  ]);
  return { subject: subject, html: html, text: text };
}

/* --- 10. Cliente: intake completado --- */
function customerPassengerFormCompleted(b) {
  const subject = 'All passenger details received — ' + (b.booking_code || '');
  const html = shell(subject,
    h1('Thank you — all set', 'Gracias — todo listo')
    + para('Thank you. We received the information for all passengers. Our team will begin preparing flight and accommodation options.',
           'Gracias. Recibimos la información de todos los pasajeros. Nuestro equipo comenzará a preparar las opciones de vuelos y alojamiento.')
    + rows(bookingPairs(b, { name: true })));
  const text = textBlock([
    'ALL PASSENGER DETAILS RECEIVED / DATOS DE PASAJEROS RECIBIDOS', '',
    'Thank you. We received the information for all passengers. Our team will begin preparing flight and accommodation options.',
    'Gracias. Recibimos la información de todos los pasajeros. Nuestro equipo comenzará a preparar las opciones de vuelos y alojamiento.', '',
    'Booking code / Código: ' + (b.booking_code || '')
  ]);
  return { subject: subject, html: html, text: text };
}

/* ---------------- registro ---------------- */
const TEMPLATES = {
  customer_booking_confirmation: { build: customerBookingConfirmation, qr: true },
  owner_booking_notification: { build: ownerBookingNotification, qr: false },
  customer_quote_acknowledgement: { build: customerQuoteAcknowledgement, qr: false },
  owner_quote_notification: { build: ownerQuoteNotification, qr: false },
  customer_agency_confirmation: { build: customerAgencyConfirmation, qr: true },
  owner_agency_notification: { build: ownerAgencyNotification, qr: false },
  customer_passenger_form_invitation: { build: customerPassengerFormInvitation, qr: false },
  owner_passenger_form_submitted: { build: ownerPassengerFormSubmitted, qr: false },
  customer_passenger_form_changes_requested: { build: customerPassengerFormChangesRequested, qr: false },
  customer_passenger_form_completed: { build: customerPassengerFormCompleted, qr: false }
};

module.exports = { TEMPLATES, esc, money, methodLabel };
