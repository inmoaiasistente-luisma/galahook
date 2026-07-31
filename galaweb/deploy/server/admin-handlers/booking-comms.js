'use strict';

/* =========================================================
   GET /api/admin-booking-comms?booking_id=…  (action=booking-comms)
   ---------------------------------------------------------
   Todo lo que necesita la sección "Comunicaciones y documentos" del
   detalle de la reserva, en UNA sola lectura:
     · documentos asociados (tickets, vouchers, itinerarios…),
     · bitácora de envíos manuales (a quién, cuándo, qué, con qué archivo,
       quién lo mandó y si salió o falló),
     · estado de los recordatorios pre-viaje (pausados o no + etapas ya
       enviadas, leídas del registro de correos).

   Roles: owner y admin ven todo. El staff ve lo OPERATIVO y nunca los
   documentos con dinero (recibos): eso se filtra aquí, en el servidor.

   Tolerante a que la migración 0019 no esté aplicada: si las tablas nuevas
   no existen, devuelve listas vacías y `storage_ready:false` en vez de
   romper el detalle de la reserva.
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId, isUuid } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin } = require('../lib/admin-auth');
const rem = require('../lib/pretrip-reminders');

/* Tipos de documento que el staff NO puede ver (contienen importes). */
const STAFF_HIDDEN_DOCS = ['receipt'];

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin', 'staff']);
  if (!session) return;

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('booking-comms', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  const q = req.query || {};
  if (!isUuid(q.booking_id)) return sendError(res, 400, 'INVALID_BOOKING', 'booking_id must be a UUID');

  const isStaff = session.role === 'staff';

  try {
    const supabase = getSupabase();

    const bq = await supabase.from('bookings').select('*')
      .eq('id', q.booking_id).eq('tenant_id', tenant).maybeSingle();
    if (bq.error) { logServer('booking-comms', bq.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!bq.data) return sendError(res, 404, 'BOOKING_NOT_FOUND', 'Booking not found');

    let storageReady = true;
    let documents = [], communications = [];

    try {
      /* Se piden también los campos de subida (0020). Si 0020 no está aplicada,
         el select falla y se marca storage_ready=false, cayendo al modo enlace. */
      const dq = await supabase.from('booking_documents')
        .select('id,doc_type,label,url,notes,created_at,source,original_filename,mime_type,file_size,uploaded_at,sent_to_passenger_at,created_by_user_id')
        .eq('booking_id', q.booking_id).eq('tenant_id', tenant).eq('active', true);
      if (dq.error) throw new Error(dq.error.message);
      documents = dq.data || [];
    } catch (e) {
      storageReady = false;
      // Reintento compatible con solo-0019 (sin columnas de subida): que la
      // lista de enlaces siga viéndose aunque las subidas no estén disponibles.
      try {
        const dq2 = await supabase.from('booking_documents')
          .select('id,doc_type,label,url,notes,created_at')
          .eq('booking_id', q.booking_id).eq('tenant_id', tenant).eq('active', true);
        if (!dq2.error) documents = dq2.data || [];
      } catch (e2) { /* sin documentos */ }
    }

    try {
      const cq = await supabase.from('booking_communications')
        .select('id,channel,message_type,recipient,subject,document_label,status,error_message,sent_by_name,created_at')
        .eq('booking_id', q.booking_id).eq('tenant_id', tenant)
        .order('created_at', { ascending: false }).limit(100);
      if (cq.error) throw new Error(cq.error.message);
      communications = cq.data || [];
    } catch (e) { storageReady = false; }

    /* Correos automáticos y recordatorios (email_notifications): también forman
       parte del historial clickeable. El staff solo ve los correos al cliente,
       nunca los internos del owner (owner_*). */
    let emails = [];
    try {
      const eq = await supabase.from('email_notifications')
        .select('id,notification_type,recipient_email,status,sent_at,created_at,subject')
        .eq('booking_id', q.booking_id).eq('tenant_id', tenant)
        .order('created_at', { ascending: false }).limit(100);
      if (!eq.error) emails = eq.data || [];
    } catch (e) {
      // subject llega con 0021; reintento sin esa columna para no perder la lista
      try {
        const eq2 = await supabase.from('email_notifications')
          .select('id,notification_type,recipient_email,status,sent_at,created_at')
          .eq('booking_id', q.booking_id).eq('tenant_id', tenant)
          .order('created_at', { ascending: false }).limit(100);
        if (!eq2.error) emails = eq2.data || [];
      } catch (e2) { /* sin correos */ }
    }
    if (isStaff) emails = emails.filter(function (e) { return String(e.notification_type || '').indexOf('owner_') !== 0; });

    if (isStaff) {
      documents = documents.filter(function (d) { return STAFF_HIDDEN_DOCS.indexOf(d.doc_type) === -1; });
    }

    /* Resuelve el nombre de quién subió cada documento (una consulta a
       admin_profiles). Best-effort: si falla, la lista no lleva el nombre. */
    try {
      const ids = {};
      documents.forEach(function (d) { if (d.created_by_user_id) ids[d.created_by_user_id] = 1; });
      const list = Object.keys(ids);
      if (list.length) {
        const pq = await supabase.from('admin_profiles').select('user_id,full_name').in('user_id', list);
        if (!pq.error && pq.data) {
          const nameOf = {};
          pq.data.forEach(function (p) { nameOf[p.user_id] = p.full_name; });
          documents.forEach(function (d) { d.uploaded_by_name = d.created_by_user_id ? (nameOf[d.created_by_user_id] || null) : null; });
        }
      }
    } catch (e) { /* sin nombres: no es motivo para fallar la sección */ }
    // No exponer el uuid del usuario al cliente; basta el nombre.
    documents.forEach(function (d) { delete d.created_by_user_id; });

    /* Etapas de recordatorio ya registradas (el ledger de correos existe
       desde 0007, así que esto funciona aunque 0019 no esté aplicada). */
    let reminderLog = [];
    try {
      const rq = await supabase.from('email_notifications')
        .select('notification_type,status,recipient_email,sent_at')
        .eq('booking_id', q.booking_id).eq('tenant_id', tenant)
        .in('notification_type', rem.allTypes());
      if (!rq.error) reminderLog = rq.data || [];
    } catch (e) { /* sin bitácora de recordatorios: no es motivo para fallar */ }

    return sendJson(res, 200, {
      storage_ready: storageReady,
      documents: documents,
      communications: communications,
      emails: emails,
      reminders: {
        paused: bq.data.reminders_paused === true,
        booking_date: bq.data.booking_date,
        stages: rem.REMINDER_DAYS,
        sent: reminderLog
      }
    });
  } catch (err) {
    logServer('booking-comms', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
