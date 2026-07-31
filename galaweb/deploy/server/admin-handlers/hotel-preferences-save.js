'use strict';

/* =========================================================
   POST /api/admin-hotel-preferences-save (action=hotel-preferences-save)
   ---------------------------------------------------------
   Crea o actualiza un hotel preferido. owner/admin (staff → 403).
   La identidad real del hotel la resolverá el conector autorizado durante
   la búsqueda; aquí NO se asume ID de Booking/Google/Expedia.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, isUuid, isNonEmptyString, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');

const ALLOWED_KEYS = ['id', 'destination', 'hotel_name', 'priority', 'active', 'preference_notes', 'search_aliases', 'provider_reference'];
const DESTINATIONS = ['quito', 'guayaquil', 'san_cristobal', 'santa_cruz', 'isabela'];
const MAX_NAME = 160, MAX_NOTES = 1000, MAX_PRIORITY = 100000, MAX_ALIASES = 25, MAX_ALIAS_LEN = 120;

function validAliases(v) {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > MAX_ALIASES) return null;
  const out = [];
  for (const a of v) { if (typeof a !== 'string' || a.length > MAX_ALIAS_LEN) return null; out.push(a); }
  return out;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireWriter(req, res);   // Fase 9: escritura = SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('hotel-preferences-save', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');

  if (body.id != null && !isUuid(body.id)) return sendError(res, 400, 'INVALID_ID', 'id must be a UUID');
  if (DESTINATIONS.indexOf(body.destination) === -1) return sendError(res, 400, 'INVALID_DESTINATION', 'Invalid destination');
  if (!isNonEmptyString(body.hotel_name, 2, MAX_NAME)) return sendError(res, 400, 'INVALID_HOTEL_NAME', 'hotel_name is required');
  let priority = body.priority == null ? 1 : body.priority;
  if (!Number.isInteger(priority) || priority < 1 || priority > MAX_PRIORITY) return sendError(res, 400, 'INVALID_PRIORITY', 'priority out of range');
  if (typeof body.active !== 'boolean') return sendError(res, 400, 'INVALID_ACTIVE', 'active must be boolean');
  if (body.preference_notes != null && (typeof body.preference_notes !== 'string' || body.preference_notes.length > MAX_NOTES)) {
    return sendError(res, 400, 'INVALID_NOTES', 'preference_notes is too long');
  }
  const aliases = validAliases(body.search_aliases);
  if (aliases === null) return sendError(res, 400, 'INVALID_ALIASES', 'search_aliases invalid');
  const providerRef = (body.provider_reference == null) ? null
    : (typeof body.provider_reference === 'object' && !Array.isArray(body.provider_reference) ? body.provider_reference : undefined);
  if (providerRef === undefined) return sendError(res, 400, 'INVALID_PROVIDER_REF', 'provider_reference must be an object');

  try {
    const supabase = getSupabase();
    const now = new Date().toISOString();
    const fields = {
      destination: body.destination, hotel_name: String(body.hotel_name).trim(),
      priority: priority, active: body.active,
      preference_notes: (body.preference_notes && body.preference_notes.trim()) ? body.preference_notes.trim() : null,
      search_aliases: aliases, provider_reference: providerRef,
      updated_by_user_id: session.user_id, updated_at: now
    };

    if (body.id) {
      const up = await supabase.from('hotel_search_preferences').update(fields)
        .eq('id', body.id).eq('tenant_id', tenant).select();
      if (up.error || !up.data || up.data.length !== 1) { logServer('hotel-preferences-save', (up.error && up.error.message) || 'update rows'); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
      return sendJson(res, 200, { saved: true, preference: up.data[0] });
    }

    fields.tenant_id = tenant;
    fields.created_by_user_id = session.user_id;
    const ins = await supabase.from('hotel_search_preferences').insert(fields).select().single();
    if (ins.error) {
      if (ins.error.code === '23505') return sendError(res, 409, 'DUPLICATE', 'That hotel already exists for this destination');
      logServer('hotel-preferences-save', ins.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
    }
    return sendJson(res, 200, { saved: true, preference: ins.data });
  } catch (err) {
    logServer('hotel-preferences-save', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
