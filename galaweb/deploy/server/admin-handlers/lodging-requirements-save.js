'use strict';

/* =========================================================
   POST /api/admin-lodging-save (action=lodging-requirements-save)
   ---------------------------------------------------------
   Crea o actualiza un requerimiento de alojamiento por destino.
   owner/admin (staff → 403). Sirve para completar los destinos del
   itinerario (San Cristóbal, Santa Cruz, Isabela) y para resolver
   connection_tbd a quito/guayaquil.

   nights se calcula server-side desde las fechas (no puede contradecirlas).
   connection_tbd NO puede pasar a búsqueda hasta resolverse.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, isUuid, isRealYmd, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');

const ALLOWED_KEYS = ['id', 'form_id', 'destination', 'lodging_required', 'check_in_date', 'check_out_date',
  'guest_count', 'rooms_required', 'room_preferences', 'approximate_budget_cents',
  'accessibility_notes', 'lodging_notes', 'source', 'status', 'active'];
const DESTINATIONS = ['quito', 'guayaquil', 'san_cristobal', 'santa_cruz', 'isabela', 'connection_tbd'];
const SOURCES = ['customer', 'itinerary', 'owner'];
const STATUSES = ['pending', 'ready_for_search', 'options_found', 'selected', 'booked', 'not_required'];
const MAX_TEXT = 1000, MAX_NIGHTS = 366, MAX_ROOMS = 100, MAX_GUESTS = 100, MAX_BUDGET = 100000000;

function daysBetween(a, b) {
  const pa = a.split('-'), pb = b.split('-');
  const da = Date.UTC(+pa[0], +pa[1] - 1, +pa[2]);
  const db = Date.UTC(+pb[0], +pb[1] - 1, +pb[2]);
  return Math.round((db - da) / 86400000);
}
function optText(v, max) { return v == null ? null : (typeof v === 'string' && v.length <= max ? (v.trim() || null) : undefined); }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('lodging-save', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');

  if (body.id != null && !isUuid(body.id)) return sendError(res, 400, 'INVALID_ID', 'id must be a UUID');
  if (!isUuid(body.form_id)) return sendError(res, 400, 'INVALID_FORM_ID', 'form_id must be a UUID');
  if (DESTINATIONS.indexOf(body.destination) === -1) return sendError(res, 400, 'INVALID_DESTINATION', 'Invalid destination');
  const source = body.source == null ? 'owner' : body.source;
  if (SOURCES.indexOf(source) === -1) return sendError(res, 400, 'INVALID_SOURCE', 'Invalid source');
  const status = body.status == null ? 'pending' : body.status;
  if (STATUSES.indexOf(status) === -1) return sendError(res, 400, 'INVALID_STATUS', 'Invalid status');
  if (typeof body.lodging_required !== 'boolean') return sendError(res, 400, 'INVALID_REQUIRED', 'lodging_required must be boolean');

  // connection_tbd no puede pasar a búsqueda hasta resolverse.
  if (body.destination === 'connection_tbd' && status !== 'pending' && status !== 'not_required') {
    return sendError(res, 400, 'TBD_NOT_RESOLVED', 'Resolve connection_tbd to a real city before advancing status');
  }

  const ci = body.check_in_date, co = body.check_out_date;
  if (ci != null && !isRealYmd(ci)) return sendError(res, 400, 'INVALID_CHECK_IN', 'check_in_date invalid');
  if (co != null && !isRealYmd(co)) return sendError(res, 400, 'INVALID_CHECK_OUT', 'check_out_date invalid');
  if (ci && co && !(co > ci)) return sendError(res, 400, 'INVALID_DATES', 'check_out_date must be after check_in_date');
  const nights = (ci && co) ? daysBetween(ci, co) : null;
  if (nights != null && (nights < 0 || nights > MAX_NIGHTS)) return sendError(res, 400, 'INVALID_NIGHTS', 'nights out of range');

  let guestCount = body.guest_count;
  if (guestCount != null && (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > MAX_GUESTS)) return sendError(res, 400, 'INVALID_GUESTS', 'guest_count out of range');
  let rooms = body.rooms_required;
  if (rooms != null && (!Number.isInteger(rooms) || rooms < 0 || rooms > MAX_ROOMS)) return sendError(res, 400, 'INVALID_ROOMS', 'rooms_required out of range');
  let budget = body.approximate_budget_cents;
  if (budget != null && (!Number.isInteger(budget) || budget < 0 || budget > MAX_BUDGET)) return sendError(res, 400, 'INVALID_BUDGET', 'approximate_budget_cents out of range');

  const roomPrefs = optText(body.room_preferences, MAX_TEXT);
  const accessNotes = optText(body.accessibility_notes, MAX_TEXT);
  const lodgingNotes = optText(body.lodging_notes, MAX_TEXT);
  if (roomPrefs === undefined || accessNotes === undefined || lodgingNotes === undefined) return sendError(res, 400, 'INVALID_TEXT', 'A text field is too long');

  const active = (typeof body.active === 'boolean') ? body.active : true;

  try {
    const supabase = getSupabase();

    // El formulario debe existir y pertenecer al tenant (la FK compuesta también lo exige).
    const form = await supabase.from('booking_passenger_forms').select('id,tenant_id')
      .eq('id', body.form_id).eq('tenant_id', tenant).maybeSingle();
    if (form.error) { logServer('lodging-save', form.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!form.data) return sendError(res, 404, 'FORM_NOT_FOUND', 'Passenger form not found');

    const fields = {
      destination: body.destination, lodging_required: body.lodging_required,
      check_in_date: ci || null, check_out_date: co || null, nights: nights,
      guest_count: guestCount == null ? null : guestCount,
      rooms_required: rooms == null ? null : rooms,
      room_preferences: roomPrefs, approximate_budget_cents: budget == null ? null : budget,
      accessibility_notes: accessNotes, lodging_notes: lodgingNotes,
      source: source, status: status, active: active, updated_at: new Date().toISOString()
    };

    if (body.id) {
      const up = await supabase.from('booking_lodging_requirements').update(fields)
        .eq('id', body.id).eq('tenant_id', tenant).select();
      if (up.error) {
        if (up.error.code === '23505') return sendError(res, 409, 'DUPLICATE', 'An identical active lodging requirement already exists');
        logServer('lodging-save', up.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
      }
      if (!up.data || up.data.length !== 1) return sendError(res, 404, 'NOT_FOUND', 'Lodging requirement not found');
      return sendJson(res, 200, { saved: true, lodging: up.data[0] });
    }

    fields.tenant_id = tenant;
    fields.passenger_form_id = body.form_id;
    const ins = await supabase.from('booking_lodging_requirements').insert(fields).select().single();
    if (ins.error) {
      if (ins.error.code === '23505') return sendError(res, 409, 'DUPLICATE', 'An identical active lodging requirement already exists');
      logServer('lodging-save', ins.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
    }
    return sendJson(res, 200, { saved: true, lodging: ins.data });
  } catch (err) {
    logServer('lodging-save', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
