'use strict';

/* =========================================================
   POST /api/admin-passenger-intake-renew (action=passenger-intake-renew)
   ---------------------------------------------------------
   owner/admin renuevan el enlace del formulario (staff → 403).
   Rota el token (token_version + 1 → invalida el anterior), reinicia
   expires_at = now + 30 días, reactiva el formulario y envía una NUEVA
   invitación (evento nuevo por versión). Body: { form_id }.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, isUuid, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const { computeExpiry, buildFormUrlForAccess } = require('../lib/passenger-intake');
const { sendInvitation } = require('../lib/passenger-intake-emails');

const ALLOWED_KEYS = ['form_id'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireWriter(req, res);   // Fase 9: escritura = SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('intake-renew', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.form_id)) return sendError(res, 400, 'INVALID_FORM_ID', 'form_id must be a UUID');

  try {
    const supabase = getSupabase();
    const fq = await supabase.from('booking_passenger_forms').select('*')
      .eq('id', body.form_id).eq('tenant_id', tenant).maybeSingle();
    if (fq.error) { logServer('intake-renew', fq.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!fq.data) return sendError(res, 404, 'NOT_FOUND', 'Passenger form not found');
    const form = fq.data;

    const patch = {
      token_version: (form.token_version || 1) + 1,
      expires_at: computeExpiry(),
      active: true, revoked_at: null
    };
    const up = await supabase.from('booking_passenger_forms').update(patch)
      .eq('id', form.id).eq('tenant_id', tenant).select().single();
    if (up.error) { logServer('intake-renew', up.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

    let formUrl = null;
    try { formUrl = buildFormUrlForAccess(up.data); } catch (e) { logServer('intake-renew', 'url build failed'); }

    try {
      const bq = await supabase.from('bookings')
        .select('id,tenant_id,booking_code,tour_name,booking_date,guests,customer_name,customer_email')
        .eq('id', form.booking_id).maybeSingle();
      if (bq.data) await sendInvitation(bq.data, up.data);
    } catch (e) { logServer('intake-renew', 'invitation failed'); }

    return sendJson(res, 200, { renewed: true, form_url: formUrl, expires_at: up.data.expires_at, token_version: up.data.token_version });
  } catch (err) {
    logServer('intake-renew', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
