'use strict';

/* =========================================================
   Milu Turismo — feature flags SERVER-ONLY
   ---------------------------------------------------------
   Nunca se confía en flags enviados por el navegador. Durante 8C
   todos por defecto en false: el módulo se prueba en rama y en tests
   pero no ejecuta proveedores reales ni se activa públicamente.
     · MILU_TOURISM_ENABLED                 (módulo activo)
     · MILU_TOURISM_WORKER_ENABLED          (worker procesa)
     · MILU_TOURISM_DUFFEL_ENABLED          (adapter vuelos real)
     · MILU_TOURISM_HOTEL_PROVIDER_ENABLED  (adapter hotelero real)
     · MILU_TOURISM_SONNET_ENABLED          (modelo Sonnet — futuro)
   ========================================================= */

function isTrue(v) { return String(v == null ? '' : v).trim().toLowerCase() === 'true'; }

function getMiluFlags(env) {
  env = env || process.env;
  return {
    enabled: isTrue(env.MILU_TOURISM_ENABLED),
    worker_enabled: isTrue(env.MILU_TOURISM_WORKER_ENABLED),
    duffel_enabled: isTrue(env.MILU_TOURISM_DUFFEL_ENABLED),
    hotel_provider_enabled: isTrue(env.MILU_TOURISM_HOTEL_PROVIDER_ENABLED),
    sonnet_enabled: isTrue(env.MILU_TOURISM_SONNET_ENABLED)
  };
}

/** Estado legible para el panel: 'not_connected' | 'sandbox' | 'live'. */
function providerState(env, which) {
  const f = getMiluFlags(env);
  if (which === 'flights') return f.duffel_enabled ? 'sandbox' : 'not_connected';
  if (which === 'hotels') return f.hotel_provider_enabled ? 'sandbox' : 'not_connected';
  return 'not_connected';
}

module.exports = { getMiluFlags, providerState };
