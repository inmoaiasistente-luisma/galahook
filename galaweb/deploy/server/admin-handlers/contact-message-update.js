'use strict';

/* =========================================================
   POST /api/admin-contact-message-update  (action=contact-message-update)
   body: { id: <uuid>, status: 'new'|'read'|'replied'|'archived' }
   ---------------------------------------------------------
   Cambia el estado de un mensaje de la bandeja. La usan OWNER y ADMIN
   (requireOwnerOrAdmin); staff → 403. sameOrigin como defensa CSRF.

   Registra QUIÉN lo atendió: al pasar a read/replied/archived se fija
   handled_by = email del que actúa y handled_at = now(). Al volver a 'new'
   se limpian. El navegador no elige tenant ni usuario.
   ========================================================= */

const { sendJson, sendError, logServer, readJsonBody, rejectUnknownKeys, isUuid, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireOwnerOrAdmin, sameOrigin } = require('../lib/admin-auth');

const STATUSES = ['new', 'read', 'replied', 'archived'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed'); }
  const session = await requireOwnerOrAdmin(req, res);   // owner Y admin
  if (!session) return;
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('contact-message-update', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
  if (rejectUnknownKeys(body, ['id', 'status'])) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
  if (!isUuid(body.id)) return sendError(res, 400, 'INVALID_ID', 'id must be a UUID');
  if (STATUSES.indexOf(body.status) === -1) return sendError(res, 400, 'INVALID_STATUS', 'Invalid status');

  const patch = { status: body.status };
  if (body.status === 'new') {
    patch.handled_by = null;
    patch.handled_at = null;
  } else {
    patch.handled_by = session.email;
    patch.handled_at = new Date().toISOString();
  }

  try {
    const supabase = getSupabase();
    const upd = await supabase.from('contact_messages')
      .update(patch)
      .eq('tenant_id', tenant).eq('id', body.id)
      .select('id,status,handled_by,handled_at').single();
    if (upd.error) {
      if (upd.error.code === 'PGRST116') return sendError(res, 404, 'NOT_FOUND', 'Message not found');
      logServer('contact-message-update', upd.error.message);
      return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
    }
    return sendJson(res, 200, { ok: true, row: upd.data });
  } catch (err) {
    logServer('contact-message-update', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
