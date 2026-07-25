'use strict';

/* =========================================================
   LOAN-IX Booking Engine — lector de cuerpo RAW
   ---------------------------------------------------------
   Devuelve el cuerpo EXACTO de la petición como Buffer, sin
   parsear. Necesario para verificar la firma de Stripe con
   stripe.webhooks.constructEvent(rawBody, ...).

   Requiere que el body parser de la función esté desactivado
   (module.exports.config = { api: { bodyParser: false } }).
   ========================================================= */

async function readRawBody(req) {
  // Si el runtime ya entregó un Buffer, úsalo tal cual (no re-parsear).
  if (Buffer.isBuffer(req.body)) return req.body;

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = { readRawBody };
