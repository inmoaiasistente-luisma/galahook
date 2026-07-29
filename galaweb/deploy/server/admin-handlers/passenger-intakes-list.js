'use strict';

/* =========================================================
   GET /api/admin-passenger-intakes (action=passenger-intakes-list)
   ---------------------------------------------------------
   Lista los formularios de intake con su resumen operativo.
   owner/admin ven todo; staff ve una vista reducida (sin email del
   cliente, sin presupuesto, sin documentos). Alertas por datos faltantes.
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin } = require('../lib/admin-auth');

const MAX_LIMIT = 100;

function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { const u = new URL(req.url, 'http://localhost'); const o = {}; u.searchParams.forEach(function (v, k) { o[k] = v; }); return o; }
  catch (e) { return {}; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin', 'staff']);
  if (!session) return;
  const isStaff = session.role === 'staff';

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('intakes-list', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  const q = getQuery(req);
  let page = parseInt(q.page, 10); if (!Number.isInteger(page) || page < 1) page = 1;
  let limit = parseInt(q.limit, 10); if (!Number.isInteger(limit) || limit < 1) limit = 25; if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  try {
    const supabase = getSupabase();
    const fromIdx = (page - 1) * limit;

    let fq = supabase.from('booking_passenger_forms')
      .select('id,booking_id,public_id,status,preferred_connection_city,ecuador_arrival_date,arrival_airport,submitted_at,expires_at,active,updated_at', { count: 'exact' })
      .eq('tenant_id', tenant);
    if (q.status) fq = fq.eq('status', String(q.status));
    fq = fq.order('updated_at', { ascending: false }).range(fromIdx, fromIdx + limit - 1);

    const { data: forms, error, count } = await fq;
    if (error) { logServer('intakes-list', error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

    const list = forms || [];
    const bookingIds = list.map(function (f) { return f.booking_id; });
    const formIds = list.map(function (f) { return f.id; });

    let bookingsById = {};
    let passengersByForm = {};
    let lodgingByForm = {};

    if (bookingIds.length) {
      const bq = await supabase.from('bookings')
        .select('id,booking_code,tour_name,booking_date,guests,customer_name,customer_email')
        .in('id', bookingIds);
      (bq.data || []).forEach(function (b) { bookingsById[b.id] = b; });

      const pq = await supabase.from('booking_passengers')
        .select('passenger_form_id,legal_first_name,legal_last_name,active')
        .in('passenger_form_id', formIds).eq('active', true);
      (pq.data || []).forEach(function (p) {
        const k = p.passenger_form_id;
        if (!passengersByForm[k]) passengersByForm[k] = { total: 0, completed: 0 };
        passengersByForm[k].total += 1;
        if (String(p.legal_first_name || '').trim() && String(p.legal_last_name || '').trim()) passengersByForm[k].completed += 1;
      });

      const lq = await supabase.from('booking_lodging_requirements')
        .select('passenger_form_id,destination,lodging_required,status,active')
        .in('passenger_form_id', formIds).eq('active', true);
      (lq.data || []).forEach(function (l) {
        const k = l.passenger_form_id;
        if (!lodgingByForm[k]) lodgingByForm[k] = [];
        lodgingByForm[k].push(l);
      });
    }

    const items = list.map(function (f) {
      const b = bookingsById[f.booking_id] || {};
      const pax = passengersByForm[f.id] || { total: 0, completed: 0 };
      const lodging = lodgingByForm[f.id] || [];
      const expected = b.guests || 0;
      const alerts = [];
      if (pax.completed < expected) alerts.push('missing_passengers');
      if (lodging.some(function (l) { return l.destination === 'connection_tbd'; })) alerts.push('connection_tbd_unresolved');
      if (!f.ecuador_arrival_date && f.status !== 'pending') alerts.push('missing_arrival');

      const item = {
        form_id: f.id,
        booking_code: b.booking_code || null,
        customer_name: b.customer_name || null,
        tour_name: b.tour_name || null,
        booking_date: b.booking_date || null,
        pax_expected: expected,
        pax_completed: pax.completed,
        preferred_connection_city: f.preferred_connection_city,
        status: f.status,
        ecuador_arrival_date: f.ecuador_arrival_date,
        needs_lodging: lodging.some(function (l) { return l.lodging_required === true; }),
        alerts: alerts,
        updated_at: f.updated_at
      };
      // owner/admin ven además el email del cliente y la expiración/enlace.
      if (!isStaff) {
        item.customer_email = b.customer_email || null;
        item.expires_at = f.expires_at;
        item.form_active = f.active;
      }
      return item;
    });

    const total = count || 0;
    return sendJson(res, 200, {
      intakes: items,
      pagination: { page: page, limit: limit, total: total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    });
  } catch (err) {
    logServer('intakes-list', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
