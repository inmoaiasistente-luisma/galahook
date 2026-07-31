'use strict';

/* =========================================================
   POST /api/admin-discount-rule-save (action=discount-rule-save)
   ---------------------------------------------------------
   Crea (sin id) o edita (con id) una regla de descuento. owner y admin
   (staff → 403). No borra: para retirar una regla se usa el toggle
   (active=false). Las validaciones reflejan los constraints de la
   migración 0010. Cambiar reglas NO afecta reservas ya creadas.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, isNonEmptyString, isUuid, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');
const catalog = require('../lib/tour-catalog');

const ALLOWED_KEYS = ['id', 'name', 'tour_id', 'discount_type', 'percentage_bps', 'amount_cents',
  'min_guests', 'max_guests', 'starts_at', 'ends_at', 'priority', 'active'];
const TYPES = ['percentage', 'fixed_total', 'fixed_per_pax'];
const MAX_AMOUNT_CENTS = 100000000;
const MAX_GUESTS = 100;

function isIsoOrNull(v) {
  if (v == null || v === '') return true;
  if (typeof v !== 'string') return false;
  const d = new Date(v);
  return !isNaN(d.getTime());
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireWriter(req, res);   // Fase 9: escritura = SOLO owner
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('discount-rule-save', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let b;
  try { b = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(b, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');

  if (b.id != null && !isUuid(b.id)) return sendError(res, 400, 'INVALID_ID', 'id must be a valid UUID');
  if (!isNonEmptyString(b.name, 2, 120)) return sendError(res, 400, 'INVALID_NAME', 'name is required');
  if (TYPES.indexOf(b.discount_type) === -1) return sendError(res, 400, 'INVALID_TYPE', 'Invalid discount_type');

  // tour_id: null = todos los pagables; o un tour pagable del catálogo.
  let tourId = null;
  if (b.tour_id != null && b.tour_id !== '') {
    const t = catalog.getTour(b.tour_id);
    if (!t || t.requiresQuote || t.priceCents == null) return sendError(res, 400, 'INVALID_TOUR', 'Unknown or non-payable tour_id');
    tourId = t.id;
  }

  // valor según tipo (refleja chk_discount_value)
  let percentageBps = null, amountCents = null;
  if (b.discount_type === 'percentage') {
    if (!Number.isInteger(b.percentage_bps) || b.percentage_bps < 1 || b.percentage_bps > 10000) {
      return sendError(res, 400, 'INVALID_PERCENTAGE', 'percentage_bps must be between 1 and 10000');
    }
    percentageBps = b.percentage_bps;
  } else {
    if (!Number.isInteger(b.amount_cents) || b.amount_cents < 1 || b.amount_cents > MAX_AMOUNT_CENTS) {
      return sendError(res, 400, 'INVALID_AMOUNT', 'amount_cents must be > 0');
    }
    amountCents = b.amount_cents;
  }

  // guests
  const minGuests = b.min_guests == null ? 1 : b.min_guests;
  if (!Number.isInteger(minGuests) || minGuests < 1 || minGuests > MAX_GUESTS) return sendError(res, 400, 'INVALID_MIN_GUESTS', 'min_guests out of range');
  let maxGuests = null;
  if (b.max_guests != null && b.max_guests !== '') {
    if (!Number.isInteger(b.max_guests) || b.max_guests < minGuests || b.max_guests > MAX_GUESTS) return sendError(res, 400, 'INVALID_MAX_GUESTS', 'max_guests must be >= min_guests');
    maxGuests = b.max_guests;
  }

  // fechas
  if (!isIsoOrNull(b.starts_at) || !isIsoOrNull(b.ends_at)) return sendError(res, 400, 'INVALID_DATES', 'starts_at/ends_at must be ISO or null');
  const startsAt = (b.starts_at && b.starts_at !== '') ? new Date(b.starts_at).toISOString() : null;
  const endsAt = (b.ends_at && b.ends_at !== '') ? new Date(b.ends_at).toISOString() : null;
  if (startsAt && endsAt && endsAt <= startsAt) return sendError(res, 400, 'INVALID_DATES', 'ends_at must be after starts_at');

  const priority = b.priority == null ? 0 : b.priority;
  if (!Number.isInteger(priority) || priority < 0 || priority > 100000) return sendError(res, 400, 'INVALID_PRIORITY', 'priority out of range');
  const active = b.active == null ? true : b.active;
  if (typeof active !== 'boolean') return sendError(res, 400, 'INVALID_ACTIVE', 'active must be boolean');

  const fields = {
    tenant_id: tenant, name: b.name.trim(), tour_id: tourId, discount_type: b.discount_type,
    percentage_bps: percentageBps, amount_cents: amountCents,
    min_guests: minGuests, max_guests: maxGuests,
    starts_at: startsAt, ends_at: endsAt, priority: priority, active: active,
    updated_by_user_id: session.user_id
  };

  try {
    const supabase = getSupabase();
    if (b.id) {
      const up = await supabase.from('discount_rules')
        .update(Object.assign({}, fields, { updated_at: new Date().toISOString() }))
        .eq('id', b.id).eq('tenant_id', tenant).select();
      if (up.error) { logServer('discount-rule-save', up.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
      if (!up.data || up.data.length !== 1) return sendError(res, 404, 'NOT_FOUND', 'Rule not found');
      return sendJson(res, 200, { saved: true, rule: up.data[0] });
    }
    const ins = await supabase.from('discount_rules')
      .insert(Object.assign({}, fields, { created_by_user_id: session.user_id }))
      .select().single();
    if (ins.error) { logServer('discount-rule-save', ins.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    return sendJson(res, 200, { saved: true, rule: ins.data });
  } catch (err) {
    logServer('discount-rule-save', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
