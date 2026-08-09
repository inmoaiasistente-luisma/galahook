'use strict';

/* =========================================================
   GET /api/admin-booking-communication-detail
   (action=booking-communication-detail)
   ---------------------------------------------------------
   Abre UN mensaje del historial de la reserva y devuelve su contenido:
   asunto, destinatario, fecha, estado, tipo, adjunto, error saneado y el
   CUERPO completo (si se guardó — llega con 0021).

   Dos fuentes según `kind`:
     · 'comm'  → booking_communications (envíos manuales).
     · 'email' → email_notifications (transaccionales + recordatorios).

   Roles: owner/admin/staff. El staff no puede abrir correos internos del
   owner (owner_*). Todo se valida contra el tenant y la reserva.

   Query: { kind, id, booking_id }
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId, isUuid } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin } = require('../lib/admin-auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin', 'staff']);
  if (!session) return;

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('comm-detail', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  const q = req.query || {};
  const kind = q.kind === 'email' ? 'email' : 'comm';
  if (!isUuid(q.id)) return sendError(res, 400, 'INVALID_ID', 'id must be a UUID');
  if (!isUuid(q.booking_id)) return sendError(res, 400, 'INVALID_BOOKING', 'booking_id must be a UUID');

  const isStaff = session.role === 'staff';

  try {
    const supabase = getSupabase();
    let out = null;

    if (kind === 'comm') {
      const sel = 'id,message_type,recipient,subject,status,error_message,sent_by_name,created_at,document_label,body_html,body_text,body_preview';
      let r = await supabase.from('booking_communications').select(sel)
        .eq('id', q.id).eq('booking_id', q.booking_id).eq('tenant_id', tenant).maybeSingle();
      if (r.error) {
        // 0021 sin aplicar: sin columnas de cuerpo
        r = await supabase.from('booking_communications')
          .select('id,message_type,recipient,subject,status,error_message,sent_by_name,created_at,document_label,body_preview')
          .eq('id', q.id).eq('booking_id', q.booking_id).eq('tenant_id', tenant).maybeSingle();
      }
      if (r.error) { logServer('comm-detail', r.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
      if (!r.data) return sendError(res, 404, 'NOT_FOUND', 'Message not found');
      const d = r.data;
      // Minimización para staff: el cuerpo de las comunicaciones manuales puede
      // contener importes (cotizaciones, recibos). El staff ve los metadatos,
      // no el cuerpo — coherente con "staff = sin dinero".
      out = {
        kind: 'comm', message_type: d.message_type, recipient: d.recipient, subject: d.subject || null,
        status: d.status, error_message: d.error_message || null, sent_by_name: d.sent_by_name || null,
        created_at: d.created_at, document_label: d.document_label || null,
        body_html: isStaff ? null : (d.body_html || null),
        body_text: isStaff ? null : (d.body_text || d.body_preview || null),
        body_restricted: isStaff || undefined
      };
    } else {
      const sel = 'id,notification_type,recipient_email,status,last_error,sent_at,created_at,subject,body_html,body_text';
      let r = await supabase.from('email_notifications').select(sel)
        .eq('id', q.id).eq('booking_id', q.booking_id).eq('tenant_id', tenant).maybeSingle();
      if (r.error) {
        r = await supabase.from('email_notifications')
          .select('id,notification_type,recipient_email,status,last_error,sent_at,created_at')
          .eq('id', q.id).eq('booking_id', q.booking_id).eq('tenant_id', tenant).maybeSingle();
      }
      if (r.error) { logServer('comm-detail', r.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
      if (!r.data) return sendError(res, 404, 'NOT_FOUND', 'Message not found');
      const d = r.data;
      // El staff no puede abrir correos internos del owner.
      if (isStaff && String(d.notification_type || '').indexOf('owner_') === 0) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');
      out = {
        kind: 'email', message_type: d.notification_type, recipient: d.recipient_email, subject: d.subject || null,
        status: d.status, error_message: d.last_error || null, sent_by_name: null,
        created_at: d.sent_at || d.created_at, document_label: null,
        body_html: d.body_html || null, body_text: d.body_text || null
      };
    }

    return sendJson(res, 200, { message: out });
  } catch (err) {
    logServer('comm-detail', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
