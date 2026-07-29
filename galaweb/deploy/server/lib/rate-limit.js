'use strict';

/* =========================================================
   Hook Adventure — rate limiting simple respaldado por BD
   ---------------------------------------------------------
   Ventana deslizante: cuenta las peticiones por bucket_key dentro de
   los ultimos `windowSeconds`. Sirve para el endpoint publico del
   formulario de pasajeros (serverless, sin memoria compartida).

   Fail-open: si el limitador falla (error de BD), NO bloquea al usuario
   legitimo — se registra y se permite. La seguridad real del endpoint la
   dan el token firmado, sameOrigin y las validaciones.
   ========================================================= */

const { getSupabase } = require('./supabase');
const { logServer } = require('./http');

/**
 * @param {object} o { tenant, bucketKey, limit, windowSeconds }
 * @returns {Promise<{allowed:boolean, retryAfter?:number}>}
 */
async function checkRateLimit(o) {
  o = o || {};
  const bucketKey = String(o.bucketKey || '').slice(0, 200);
  const limit = o.limit || 30;
  const windowSeconds = o.windowSeconds || 60;
  if (!bucketKey) return { allowed: true };

  try {
    const supabase = getSupabase();
    const sinceMs = Date.now() - windowSeconds * 1000;
    const sinceIso = new Date(sinceMs).toISOString();

    const cnt = await supabase.from('rate_limit_hits')
      .select('id', { count: 'exact', head: true })
      .eq('bucket_key', bucketKey)
      .gte('created_at', sinceIso);
    if (cnt.error) { logServer('rate-limit', cnt.error.message); return { allowed: true }; }

    if ((cnt.count || 0) >= limit) return { allowed: false, retryAfter: windowSeconds };

    await supabase.from('rate_limit_hits').insert({ tenant_id: o.tenant, bucket_key: bucketKey });

    /* Limpieza perezosa best-effort: borra huellas viejas (10 ventanas). */
    const cutoff = new Date(Date.now() - windowSeconds * 1000 * 10).toISOString();
    supabase.from('rate_limit_hits').delete().lt('created_at', cutoff).then(function () {}, function () {});

    return { allowed: true };
  } catch (e) {
    logServer('rate-limit', e && e.message);
    return { allowed: true };
  }
}

module.exports = { checkRateLimit };
