'use strict';

/* =========================================================
   GET /api/admin-booking-notifications?booking_id=...
   ---------------------------------------------------------
   Estado de los correos de una reserva. Solo owner y admin.
   Devuelve el destinatario ENMASCARADO y nunca el contenido del
   correo, el error interno completo ni identificadores del proveedor.
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId } = require('./_lib/http');
const { getSupabase } = require('./_lib/supabase');
const { requireAdmin } = require('./_lib/admin-auth');

function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { const u = new URL(req.url, 'http://localhost'); const o = {}; u.searchParams.forEach(function (v, k) { o[k] = v; }); return o; }
  catch (e) { return {}; }
}
/** j***@dominio.com */
function maskEmail(e) {
  const s = String(e || '');
  const at = s.indexOf('@');
  if (at < 1) return '***';
  const name = s.slice(0, at), dom = s.slice(at);
  return (name.length <= 1 ? name : name[0] + '***') + dom;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('booking-notifications', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to load notifications'); }

  const bookingId = getQuery(req).booking_id;
  if (typeof bookingId !== 'string' || !bookingId) return sendError(res, 400, 'INVALID_BOOKING_ID', 'booking_id is required');

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('email_notifications')
      .select('id,notification_type,recipient_email,status,attempts,sent_at,created_at')
      .eq('booking_id', bookingId).eq('tenant_id', tenant)
      .order('created_at', { ascending: true });
    if (error) { logServer('booking-notifications', error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to load notifications'); }

    const notifications = (data || []).map(function (n) {
      return {
        id: n.id,
        notification_type: n.notification_type,
        recipient_email: maskEmail(n.recipient_email),
        status: n.status,
        attempts: n.attempts,
        sent_at: n.sent_at,
        created_at: n.created_at
      };
    });
    return sendJson(res, 200, { notifications: notifications });
  } catch (err) {
    logServer('booking-notifications', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to load notifications');
  }
};
