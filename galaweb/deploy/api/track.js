'use strict';

/* =========================================================
   POST /api/track     body: { path, vid, ref }
   ---------------------------------------------------------
   Registrador de visitas del sitio PÚBLICO. Lo llama un beacon minúsculo
   en cada página (navigator.sendBeacon). Escribe una fila en page_views y
   responde 204 SIEMPRE (es un beacon: nunca debe molestar al visitante ni
   filtrar nada). El panel "Visitas" (solo owner) lee estos datos.

   PRIVACIDAD: no guarda IP, ni identidad, ni la ruta completa con query.
   Solo país aproximado (cabecera geo del servidor), tipo de dispositivo y un
   id anónimo de primera parte. Los bots se marcan is_bot para excluirlos.

   Defensa: sameOrigin (bloquea llamadas de otros sitios) + rate-limit por IP
   hasheada (fail-open). El endpoint es de solo-escritura acotada: nunca lee ni
   devuelve datos.
   ========================================================= */

const { sendError, logServer, readJsonBody, rejectUnknownKeys, getTenantId } = require('../server/lib/http');
const { getSupabase } = require('../server/lib/supabase');
const { sameOrigin } = require('../server/lib/admin-auth');
const { checkRateLimit } = require('../server/lib/rate-limit');
const {
  isBotUA, classifyDevice, sanitizePath, isAdminPath,
  refHost, countryFromHeaders, clientIp, rateBucket
} = require('../server/lib/visit-tracking');

const VID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** 204 sin cuerpo: el beacon no espera respuesta. */
function noContent(res) { res.statusCode = 204; res.end(); }

module.exports = async function handler(req, res) {
  // Solo POST (sendBeacon usa POST). Cualquier otro método: 405.
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  // Cross-site → fuera. Las páginas propias sí pasan (mismo host).
  if (!sameOrigin(req)) return noContent(res);

  // A partir de aquí cualquier fallo termina en 204 silencioso.
  try {
    let body;
    try { body = await readJsonBody(req); } catch (e) { return noContent(res); }
    if (rejectUnknownKeys(body, ['path', 'vid', 'ref'])) return noContent(res);

    const path = sanitizePath(body && body.path);
    if (!path) return noContent(res);
    if (isAdminPath(path)) return noContent(res);   // el panel no se cuenta

    let tenant;
    try { tenant = getTenantId(); } catch (e) { return noContent(res); }

    const headers = req.headers || {};
    const ua = headers['user-agent'] || '';

    // Rate-limit por IP hasheada (nunca IP en claro). Fail-open.
    try {
      const rl = await checkRateLimit({ tenant: tenant, bucketKey: rateBucket(clientIp(headers)), limit: 120, windowSeconds: 60 });
      if (rl && rl.allowed === false) return noContent(res);
    } catch (e) { /* fail-open */ }

    const vidRaw = body && typeof body.vid === 'string' ? body.vid : '';
    const visitorId = VID_RE.test(vidRaw) ? vidRaw : null;

    const row = {
      tenant_id: tenant,
      path: path,
      visitor_id: visitorId,
      country: countryFromHeaders(headers),
      device: classifyDevice(ua),
      referrer_host: refHost((body && body.ref) || headers['referer'] || ''),
      is_bot: isBotUA(ua)
    };

    try {
      const supabase = getSupabase();
      await supabase.from('page_views').insert(row);
    } catch (e) { logServer('track', e && e.message); }   // best-effort

    return noContent(res);
  } catch (err) {
    logServer('track', err && err.message);
    return noContent(res);
  }
};
