'use strict';

/* =========================================================
   POST /api/admin-tour-notes-save (action=tour-notes-save)
   ---------------------------------------------------------
   Crea o actualiza una nota importante de paquete. owner/admin (staff → 403).
   Body estricto. tour_id debe existir en el catálogo. Cambiar una nota NO
   altera reservas históricas (cada reserva conserva su snapshot).
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, isUuid, isNonEmptyString, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin, sameOrigin } = require('../lib/admin-auth');
const catalog = require('../lib/tour-catalog');

const ALLOWED_KEYS = ['id', 'tour_id', 'title_en', 'title_es', 'content_en', 'content_es',
  'active', 'requires_acknowledgement', 'display_order'];
const MAX_TITLE = 160, MAX_CONTENT = 4000, MAX_ORDER = 100000;

function optStr(v, max) { return v == null ? '' : (typeof v === 'string' && v.length <= max ? v : null); }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin']);
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('tour-notes-save', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');

  if (body.id != null && !isUuid(body.id)) return sendError(res, 400, 'INVALID_ID', 'id must be a UUID');
  const tour = catalog.getTour(body.tour_id);
  if (!tour) return sendError(res, 400, 'INVALID_TOUR', 'Unknown tour_id');

  const title_en = optStr(body.title_en, MAX_TITLE);
  const title_es = optStr(body.title_es, MAX_TITLE);
  const content_en = optStr(body.content_en, MAX_CONTENT);
  const content_es = optStr(body.content_es, MAX_CONTENT);
  if (title_en === null || title_es === null || content_en === null || content_es === null) {
    return sendError(res, 400, 'INVALID_TEXT', 'Title/content too long or invalid');
  }
  if (!(title_en.trim() || title_es.trim())) return sendError(res, 400, 'INVALID_TITLE', 'At least one title is required');
  if (!(content_en.trim() || content_es.trim())) return sendError(res, 400, 'INVALID_CONTENT', 'At least one content is required');

  if (typeof body.active !== 'boolean') return sendError(res, 400, 'INVALID_ACTIVE', 'active must be boolean');
  if (typeof body.requires_acknowledgement !== 'boolean') return sendError(res, 400, 'INVALID_ACK', 'requires_acknowledgement must be boolean');
  let displayOrder = body.display_order == null ? 0 : body.display_order;
  if (!Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > MAX_ORDER) return sendError(res, 400, 'INVALID_ORDER', 'display_order out of range');

  try {
    const supabase = getSupabase();
    const now = new Date().toISOString();
    const fields = {
      tour_id: tour.id, title_en: title_en, title_es: title_es,
      content_en: content_en, content_es: content_es,
      active: body.active, requires_acknowledgement: body.requires_acknowledgement,
      display_order: displayOrder, updated_by_user_id: session.user_id, updated_at: now
    };

    if (body.id) {
      const up = await supabase.from('tour_important_notes').update(fields)
        .eq('id', body.id).eq('tenant_id', tenant).select();
      if (up.error || !up.data || up.data.length !== 1) { logServer('tour-notes-save', (up.error && up.error.message) || 'update rows'); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
      return sendJson(res, 200, { saved: true, note: up.data[0] });
    }

    fields.tenant_id = tenant;
    fields.created_by_user_id = session.user_id;
    const ins = await supabase.from('tour_important_notes').insert(fields).select().single();
    if (ins.error) { logServer('tour-notes-save', ins.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    return sendJson(res, 200, { saved: true, note: ins.data });
  } catch (err) {
    logServer('tour-notes-save', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
