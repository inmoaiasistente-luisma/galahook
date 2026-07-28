'use strict';

/* =========================================================
   LOAN-IX Booking Engine — modo de ejecución
   ---------------------------------------------------------
   Determina si el sistema opera con Stripe en modo PRUEBA a
   partir del prefijo de STRIPE_SECRET_KEY (sk_test_...).

   REGLA DE SEGURIDAD: nunca devuelve, registra ni expone la
   clave; solo un booleano. Se usa para marcar automáticamente
   is_test=true en las operaciones NUEVAS mientras el sistema
   esté en TEST. Al pasar a sk_live_, las nuevas operaciones
   quedan is_test=false sin tocar filas históricas.
   ========================================================= */

function isStripeTestMode() {
  const k = process.env.STRIPE_SECRET_KEY || '';
  return k.indexOf('sk_test_') === 0;
}

module.exports = { isStripeTestMode };
