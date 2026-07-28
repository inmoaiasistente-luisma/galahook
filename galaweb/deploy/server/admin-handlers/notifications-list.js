'use strict';

/* =========================================================
   GET /api/admin-notifications   (action=notifications-list)
   ---------------------------------------------------------
   Centro global de notificaciones. owner y admin (staff → 403).
   Excluye por defecto las notificaciones de reservas archivadas.
   Devuelve el destinatario ENMASCARADO y el error SANEADO; nunca
   contenido del correo, payload del proveedor, claves ni QR.
   ========================================================= */

const { sendJson, sendError, logServer, maskEmail, sanitizeErrorText, isRealYmd, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin } = require('../lib/admin-auth');

const STATUSES = ['pending', 'sending', 'sent', 'failed', 'skipped'];
const TYPES = ['customer_booking_confirmation', 'owner_booking_notification',
  'customer_quote_acknowledgement', 'owner_quote_notification',
  'customer_agency_confirmation', 'owner_agency_notification'];
const MAX_LIMIT = 100;
const MAX_SEARCH = 100;

function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { const u = new URL(req.url, 'http://localhost'); const o = {}; u.searchParams.forEach(function (v, k) { o[k] = v; }); return o; }
  catch (e) { return {}; }
}
function sanitizeSearch(s) {
  return String(s || '').replace(/[,()%*\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('notifications-list', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  const q = getQuery(req);
  let page = parseInt(q.page, 10); if (!Number.isInteger(page) || page < 1) page = 1;
  let limit = parseInt(q.limit, 10); if (!Number.isInteger(limit) || limit < 1) limit = 25; if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const status = q.status, notification_type = q.notification_type;
  if (status && STATUSES.indexOf(status) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid status');
  if (notification_type && TYPES.indexOf(notification_type) === -1) return sendError(res, 400, 'INVALID_FILTER', 'Invalid notification_type');
  const date_from = q.date_from, date_to = q.date_to;
  if (date_from && !isRealYmd(date_from)) return sendError(res, 400, 'INVALID_FILTER', 'Invalid date_from');
  if (date_to && !isRealYmd(date_to)) return sendError(res, 400, 'INVALID_FILTER', 'Invalid date_to');
  const search = sanitizeSearch(q.search);

  try {
    const supabase = getSupabase();

    /* 1) Reservas archivadas del tenant → sus notificaciones se excluyen. */
    const arch = await supabase.from('bookings').select('id').eq('tenant_id', tenant).not('deleted_at', 'is', null);
    if (arch.error) { logServer('notifications-list', arch.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    const archivedIds = (arch.data || []).map(function (r) { return r.id; });

    /* 2) Búsqueda: resuelve booking_code → ids (solo reservas NO archivadas). */
    let codeIds = [];
    if (search) {
      const cm = await supabase.from('bookings').select('id')
        .eq('tenant_id', tenant).is('deleted_at', null).ilike('booking_code', '%' + search + '%');
      if (cm.error) { logServer('notifications-list', cm.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
      codeIds = (cm.data || []).map(function (r) { return r.id; });
    }

    /* 3) Consulta principal sobre email_notifications (solo columnas propias). */
    let query = supabase.from('email_notifications')
      .select('id,booking_id,notification_type,recipient_email,status,attempts,sent_at,created_at,last_error', { count: 'exact' })
      .eq('tenant_id', tenant);
    if (archivedIds.length) query = query.not('booking_id', 'in', '(' + archivedIds.join(',') + ')');
    if (status) query = query.eq('status', status);
    if (notification_type) query = query.eq('notification_type', notification_type);
    if (date_from) query = query.gte('created_at', date_from);
    if (date_to) query = query.lte('created_at', date_to + 'T23:59:59.999Z');
    if (search) {
      const parts = ['recipient_email.ilike.%' + search + '%'];
      if (codeIds.length) parts.push('booking_id.in.(' + codeIds.join(',') + ')');
      query = query.or(parts.join(','));
    }
    query = query.order('created_at', { ascending: false });
    const fromIdx = (page - 1) * limit;
    query = query.range(fromIdx, fromIdx + limit - 1);

    const { data, error, count } = await query;
    if (error) { logServer('notifications-list', error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    const notifs = data || [];

    /* 4) Datos de la reserva para la página (código, cliente, tour). */
    const bookingIds = Array.from(new Set(notifs.map(function (n) { return n.booking_id; })));
    const byId = {};
    if (bookingIds.length) {
      const bk = await supabase.from('bookings').select('id,booking_code,customer_name,tour_name').eq('tenant_id', tenant).in('id', bookingIds);
      if (bk.error) { logServer('notifications-list', bk.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
      (bk.data || []).forEach(function (b) { byId[b.id] = b; });
    }

    const rows = notifs.map(function (n) {
      const b = byId[n.booking_id] || {};
      return {
        id: n.id,
        booking_code: b.booking_code || null,
        customer_name: b.customer_name || null,
        tour_name: b.tour_name || null,
        notification_type: n.notification_type,
        recipient_email: maskEmail(n.recipient_email),
        status: n.status,
        attempts: n.attempts,
        sent_at: n.sent_at,
        created_at: n.created_at,
        last_error: n.last_error ? sanitizeErrorText(n.last_error) : null
      };
    });

    const total = count || 0;
    return sendJson(res, 200, {
      role: session.role,
      rows: rows,
      pagination: { page: page, limit: limit, total: total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    });
  } catch (err) {
    logServer('notifications-list', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
