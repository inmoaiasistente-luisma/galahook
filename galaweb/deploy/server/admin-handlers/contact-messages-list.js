'use strict';

/* =========================================================
   GET /api/admin-contact-messages   (action=contact-messages)
   ---------------------------------------------------------
   Bandeja "Mensajes": lista los mensajes de contacto del sitio público
   (formulario + aviso de visitante recurrente). La ven OWNER y ADMIN
   (requireOwnerOrAdmin); staff → 403.

   Devuelve las filas (con email/teléfono reales para poder responder) y
   `counts.new` para la insignia del menú. Filtros opcionales: status, source.

   Tolerante: si la migración 0023 aún no está aplicada (tabla ausente),
   responde ready:false con listas vacías — el panel muestra "aún no
   activado" en lugar de un error.
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireOwnerOrAdmin } = require('../lib/admin-auth');

const FIELDS = 'id,created_at,name,email,phone,interest,message,source,source_page,lang,country,status,handled_by,handled_at';
const STATUSES = ['new', 'read', 'replied', 'archived'];
const SOURCES = ['contact_form', 'visit_nudge'];
const MAX_LIMIT = 100;

function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { const u = new URL(req.url, 'http://localhost'); const o = {}; u.searchParams.forEach(function (v, k) { o[k] = v; }); return o; }
  catch (e) { return {}; }
}

/* ¿El error de Supabase indica que la migración 0023 falta? */
function isMissing(err) {
  if (!err) return false;
  if (err.code === '42P01') return true;   // tabla inexistente
  const m = String(err.message || '').toLowerCase();
  return m.indexOf('contact_messages') !== -1 || m.indexOf('does not exist') !== -1 || m.indexOf('schema cache') !== -1;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireOwnerOrAdmin(req, res);   // owner Y admin
  if (!session) return;
  // GET de solo lectura: la cookie es SameSite=Strict; no muta nada (sin sameOrigin,
  // como el resto de handlers de lectura del panel).

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('contact-messages', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  const q = getQuery(req);
  let page = parseInt(q.page, 10); if (!Number.isInteger(page) || page < 1) page = 1;
  let limit = parseInt(q.limit, 10); if (!Number.isInteger(limit) || limit < 1) limit = 50; if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const status = q.status;   // undefined | uno de STATUSES
  if (status !== undefined && STATUSES.indexOf(status) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid status');
  const source = q.source;
  if (source !== undefined && SOURCES.indexOf(source) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid source');

  try {
    const supabase = getSupabase();

    // Insignia: total de mensajes 'new' (independiente del filtro actual).
    const newCount = await supabase.from('contact_messages')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant).eq('status', 'new');
    if (newCount.error) {
      if (isMissing(newCount.error)) return sendJson(res, 200, { ready: false, role: session.role, rows: [], counts: { new: 0 }, pagination: { page: 1, limit: limit, total: 0, totalPages: 1 } });
      logServer('contact-messages', newCount.error.message);
      return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
    }

    let query = supabase.from('contact_messages').select(FIELDS, { count: 'exact' }).eq('tenant_id', tenant);
    if (status) query = query.eq('status', status);
    if (source) query = query.eq('source', source);
    query = query.order('created_at', { ascending: false });
    const fromIdx = (page - 1) * limit;
    query = query.range(fromIdx, fromIdx + limit - 1);

    const { data, error, count } = await query;
    if (error) {
      if (isMissing(error)) return sendJson(res, 200, { ready: false, role: session.role, rows: [], counts: { new: 0 }, pagination: { page: 1, limit: limit, total: 0, totalPages: 1 } });
      logServer('contact-messages', error.message);
      return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
    }

    const total = count || 0;
    return sendJson(res, 200, {
      ready: true,
      role: session.role,
      rows: data || [],
      counts: { new: newCount.count || 0 },
      pagination: { page: page, limit: limit, total: total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    });
  } catch (err) {
    if (isMissing(err)) return sendJson(res, 200, { ready: false, role: session.role, rows: [], counts: { new: 0 }, pagination: { page: 1, limit: 50, total: 0, totalPages: 1 } });
    logServer('contact-messages', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
