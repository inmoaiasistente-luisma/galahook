'use strict';

/* =========================================================
   Hook Adventure — auditoria de acceso a documentos de pasajero
   ---------------------------------------------------------
   Registro persistente y OBLIGATORIO antes de revelar un numero de
   documento. Si no se puede escribir la auditoria, NO se revela.

   NUNCA guarda: numero de documento, ciphertext, token ni secretos.
   Solo metadatos: quien, cuando, por que, resultado, IP enmascarada.
   ========================================================= */

const { getSupabase } = require('./supabase');

/* Enmascara la IP conservando solo el prefijo de red (privacidad). */
function maskIp(ip) {
  const s = String(ip == null ? '' : ip).split(',')[0].trim();
  if (!s) return '';
  if (s.indexOf(':') >= 0) {                        // IPv6: 3 primeros grupos
    const g = s.split(':').filter(function (x) { return x !== ''; });
    return (g.slice(0, 3).join(':') || '::') + '::';
  }
  const p = s.split('.');                            // IPv4: /24
  if (p.length === 4) return p[0] + '.' + p[1] + '.' + p[2] + '.0';
  return '';
}

function sanitizeUserAgent(ua) {
  return String(ua == null ? '' : ua).replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/* Extrae la IP del cliente de las cabeceras de Vercel (ya enmascarada). */
function clientIpMasked(req) {
  const h = (req && req.headers) || {};
  const raw = h['x-forwarded-for'] || h['x-real-ip'] || '';
  return maskIp(raw);
}

/**
 * Escribe una fila de auditoria. Lanza si la escritura falla, para que el
 * llamador aborte la revelacion cuando no se puede auditar.
 * @param {object} o
 * @returns {Promise<{id:string}>}
 */
async function writeDocumentAudit(o) {
  o = o || {};
  const supabase = getSupabase();
  const row = {
    tenant_id: o.tenant,
    passenger_id: o.passengerId || null,
    passenger_form_id: o.formId || null,
    booking_id: o.bookingId || null,
    accessed_by_user_id: o.userId || null,
    accessed_by_role: o.role || null,
    action: o.action,
    access_reason: o.reason ? String(o.reason).slice(0, 500) : null,
    result: o.result,
    masked_ip: o.ip || null,
    user_agent_sanitized: o.userAgent ? sanitizeUserAgent(o.userAgent) : null
  };
  const ins = await supabase.from('passenger_document_access_audit').insert(row).select('id').single();
  if (ins.error) throw new Error('audit write failed');
  return ins.data;
}

module.exports = { maskIp, sanitizeUserAgent, clientIpMasked, writeDocumentAudit };
