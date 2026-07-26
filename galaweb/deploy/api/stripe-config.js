'use strict';

/* =========================================================
   GET /api/stripe-config
   ---------------------------------------------------------
   Entrega SOLO la clave publicable de Stripe al frontend
   (es pública por diseño). Nunca expone la secret key ni
   ninguna otra variable de entorno.
   ========================================================= */

const { sendJson, sendError, logServer } = require('../server/lib/http');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed');
    }

    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (typeof key !== 'string' || !(key.indexOf('pk_test_') === 0 || key.indexOf('pk_live_') === 0)) {
      logServer('stripe-config', new Error('publishable key missing or invalid prefix'));
      return sendError(res, 500, 'CONFIG_UNAVAILABLE', 'Payment configuration unavailable');
    }

    // Clave pública → se puede cachear brevemente en el navegador.
    res.setHeader('Cache-Control', 'public, max-age=300');
    return sendJson(res, 200, { publishableKey: key });
  } catch (err) {
    logServer('stripe-config', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to process the request');
  }
};
