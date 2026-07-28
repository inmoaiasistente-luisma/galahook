'use strict';

/* =========================================================
   POST /api/admin-passenger-intake-request-changes
        (action=passenger-intake-request-changes)
   ---------------------------------------------------------
   owner/admin solicitan cambios al cliente (staff → 403).
   Incrementa review_cycle, deja el formulario editable y envía un correo
   (evento nuevo por ciclo). Body: { form_id, note }.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, isUuid, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');
const { syncBookingIntakeStatus } = require('../lib/passenger-intake');
const { sendChangesRequested } = require('../lib/passenger-intake-emails');

const ALLOWED_KEYS = ['form_id', 'note'];
const MAX_NOTE = 1000;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('intake-changes', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.form_id)) return sendError(res, 400, 'INVALID_FORM_ID', 'form_id must be a UUID');
  if (body.note != null && (typeof body.note !== 'string' || body.note.length > MAX_NOTE)) return sendError(res, 400, 'INVALID_NOTE', 'note is too long');
  const note = (body.note && body.note.trim()) ? body.note.trim() : null;

  try {
    const supabase = getSupabase();
    const fq = await supabase.from('booking_passenger_forms').select('*')
      .eq('id', body.form_id).eq('tenant_id', tenant).maybeSingle();
    if (fq.error) { logServer('intake-changes', fq.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!fq.data) return sendError(res, 404, 'NOT_FOUND', 'Passenger form not found');
    const form = fq.data;

    if (['submitted', 'reviewed', 'changes_requested', 'complete'].indexOf(form.status) === -1) {
      return sendError(res, 409, 'INVALID_STATE', 'The form has not been submitted yet');
    }

    const patch = {
      status: 'changes_requested',
      review_cycle: (form.review_cycle || 0) + 1,
      changes_requested_note: note,
      reviewed_by_user_id: session.user_id,
      reviewed_at: new Date().toISOString()
    };
    const up = await supabase.from('booking_passenger_forms').update(patch)
      .eq('id', form.id).eq('tenant_id', tenant).select().single();
    if (up.error) { logServer('intake-changes', up.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

    await syncBookingIntakeStatus(form.booking_id, 'changes_requested').catch(function () {});

    try {
      const bq = await supabase.from('bookings')
        .select('id,tenant_id,booking_code,tour_name,booking_date,guests,customer_name,customer_email')
        .eq('id', form.booking_id).maybeSingle();
      if (bq.data) await sendChangesRequested(bq.data, up.data);
    } catch (e) { logServer('intake-changes', 'email failed'); }

    return sendJson(res, 200, { saved: true, status: 'changes_requested', review_cycle: up.data.review_cycle });
  } catch (err) {
    logServer('intake-changes', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
