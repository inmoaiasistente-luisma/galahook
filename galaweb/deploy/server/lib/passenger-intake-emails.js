'use strict';

/* =========================================================
   Hook Adventure — correos del intake de pasajeros
   ---------------------------------------------------------
   Envuelven sendBookingEmail con la idempotency_key del EVENTO logico.
   Fire-and-forget: nunca lanzan (un fallo de correo no afecta al pago
   ni al ciclo del formulario). El reintento de un evento no duplica un
   envio exitoso; una ronda nueva usa una clave distinta.
   ========================================================= */

const { sendBookingEmail } = require('./booking-email-service');
const { getMailConfig } = require('./resend');
const { buildFormUrlForAccess } = require('./passenger-intake');
const { normalizeEmail, logServer } = require('./http');

async function safe(fn) {
  try { return await fn(); }
  catch (e) { logServer('intake-emails', e && e.message); return { failed: true }; }
}

/* invitation:{form_id}:v{token_version} */
function sendInvitation(booking, form) {
  return safe(async function () {
    const recipient = normalizeEmail((booking && booking.customer_email) || '');
    if (!recipient) return { skipped: true, reason: 'no_recipient' };
    return sendBookingEmail({
      booking: booking, type: 'customer_passenger_form_invitation', recipient: recipient,
      idempotencyKey: 'invitation:' + form.id + ':v' + form.token_version,
      ctx: { formUrl: buildFormUrlForAccess(form) }
    });
  });
}

/* submitted:{form_id}:v{submission_version} */
function sendOwnerSubmitted(booking, form) {
  return safe(async function () {
    const recipient = normalizeEmail((getMailConfig().notifyTo) || '');
    if (!recipient) return { skipped: true, reason: 'no_internal_recipient' };
    return sendBookingEmail({
      booking: booking, type: 'owner_passenger_form_submitted', recipient: recipient,
      idempotencyKey: 'submitted:' + form.id + ':v' + form.submission_version,
      ctx: { form: form }
    });
  });
}

/* changes_requested:{form_id}:cycle:{review_cycle} */
function sendChangesRequested(booking, form) {
  return safe(async function () {
    const recipient = normalizeEmail((booking && booking.customer_email) || '');
    if (!recipient) return { skipped: true, reason: 'no_recipient' };
    return sendBookingEmail({
      booking: booking, type: 'customer_passenger_form_changes_requested', recipient: recipient,
      idempotencyKey: 'changes_requested:' + form.id + ':cycle:' + form.review_cycle,
      ctx: { formUrl: buildFormUrlForAccess(form), note: form.changes_requested_note }
    });
  });
}

/* completed:{form_id} */
function sendCompleted(booking, form) {
  return safe(async function () {
    const recipient = normalizeEmail((booking && booking.customer_email) || '');
    if (!recipient) return { skipped: true, reason: 'no_recipient' };
    return sendBookingEmail({
      booking: booking, type: 'customer_passenger_form_completed', recipient: recipient,
      idempotencyKey: 'completed:' + form.id
    });
  });
}

module.exports = { sendInvitation, sendOwnerSubmitted, sendChangesRequested, sendCompleted };
