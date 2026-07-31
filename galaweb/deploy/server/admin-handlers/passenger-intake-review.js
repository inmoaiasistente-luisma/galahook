'use strict';

/* =========================================================
   POST /api/admin-passenger-intake-review (action=passenger-intake-review)
   ---------------------------------------------------------
   owner/admin marcan un formulario como revisado o completo (staff → 403).
   Body: { form_id, action: 'reviewed' | 'complete' }.
   'complete' envía el correo de cierre al cliente y deja la reserva
   en logistics_ready. No toca booking_status ni payment_status.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, isUuid, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const { syncBookingIntakeStatus } = require('../lib/passenger-intake');
const { sendCompleted } = require('../lib/passenger-intake-emails');

const ALLOWED_KEYS = ['form_id', 'action'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireWriter(req, res);   // Fase 9: escritura = SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('intake-review', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.form_id)) return sendError(res, 400, 'INVALID_FORM_ID', 'form_id must be a UUID');
  if (body.action !== 'reviewed' && body.action !== 'complete') return sendError(res, 400, 'INVALID_ACTION', 'action must be reviewed or complete');

  try {
    const supabase = getSupabase();
    const fq = await supabase.from('booking_passenger_forms').select('*')
      .eq('id', body.form_id).eq('tenant_id', tenant).maybeSingle();
    if (fq.error) { logServer('intake-review', fq.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!fq.data) return sendError(res, 404, 'NOT_FOUND', 'Passenger form not found');
    const form = fq.data;

    // Debe haberse enviado antes de revisar/completar.
    if (['submitted', 'reviewed', 'complete'].indexOf(form.status) === -1) {
      return sendError(res, 409, 'INVALID_STATE', 'The form has not been submitted yet');
    }
    const newStatus = body.action === 'reviewed' ? 'reviewed' : 'complete';

    const patch = { status: newStatus, reviewed_at: new Date().toISOString(), reviewed_by_user_id: session.user_id };
    const up = await supabase.from('booking_passenger_forms').update(patch)
      .eq('id', form.id).eq('tenant_id', tenant).select().single();
    if (up.error) { logServer('intake-review', up.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

    await syncBookingIntakeStatus(form.booking_id, newStatus).catch(function () {});

    if (newStatus === 'complete') {
      try {
        const bq = await supabase.from('bookings')
          .select('id,tenant_id,booking_code,tour_name,booking_date,guests,customer_name,customer_email')
          .eq('id', form.booking_id).maybeSingle();
        if (bq.data) await sendCompleted(bq.data, up.data);
      } catch (e) { logServer('intake-review', 'completed email failed'); }
    }

    return sendJson(res, 200, { saved: true, status: newStatus });
  } catch (err) {
    logServer('intake-review', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
