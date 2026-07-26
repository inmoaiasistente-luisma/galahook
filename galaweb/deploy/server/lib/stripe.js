'use strict';

const Stripe = require('stripe');

let _client = null;

/**
 * Cliente Stripe SERVER-ONLY. Usa únicamente process.env.STRIPE_SECRET_KEY.
 * Init único (memoizado). Falla de forma clara si falta la variable.
 * Nunca imprime ni expone la clave al navegador.
 */
function getStripe() {
  if (_client) return _client;

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY no está configurada');
  }

  _client = new Stripe(secretKey, {
    appInfo: { name: 'LOAN-IX Booking Engine', version: '1.0.0' }
  });

  return _client;
}

module.exports = { getStripe };
