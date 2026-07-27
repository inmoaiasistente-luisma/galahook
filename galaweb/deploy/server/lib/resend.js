'use strict';

/* =========================================================
   LOAN-IX Booking Engine — cliente Resend (server-only)
   ---------------------------------------------------------
   Init único desde RESEND_API_KEY. Falla de forma clara si falta
   la variable. La clave nunca se imprime ni se devuelve.
   ========================================================= */

const { Resend } = require('resend');

let _client = null;

function getResend() {
  if (_client) return _client;
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY no está configurada');
  _client = new Resend(key);
  return _client;
}

/** Remitente y contacto verificados. Lanza si falta el remitente. */
function getMailConfig() {
  const from = process.env.EMAIL_FROM;
  if (!from) throw new Error('EMAIL_FROM no está configurada');
  return {
    from: from,
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
    notifyTo: process.env.BOOKING_NOTIFICATION_EMAIL || ''
  };
}

module.exports = { getResend, getMailConfig };
