'use strict';

/* =========================================================
   Hook Adventure — notas importantes por paquete
   ---------------------------------------------------------
   Fuente de verdad: public.tour_important_notes (owner/admin).
   · Las notas activas se muestran en la pagina, el modal, la
     confirmacion y el correo del cliente.
   · Si alguna nota activa requiere aceptacion, el checkout se bloquea
     server-side hasta que el cliente la acepte (no basta el navegador).
   · Al reservar/cotizar se guarda un SNAPSHOT inmutable en la reserva:
     cambiar una nota despues no altera reservas historicas.
   ========================================================= */

const crypto = require('crypto');
const { getSupabase } = require('./supabase');

/* Version determinista del conjunto de notas activas (id + updated_at).
   Si una nota cambia entre la carga y el envio, la version deja de
   coincidir y se exige volver a aceptar. */
function computeNotesVersion(notes) {
  const basis = (notes || [])
    .map(function (n) { return String(n.id) + ':' + String(n.updated_at); })
    .join('|');
  return 'sha256:' + crypto.createHash('sha256').update(basis).digest('hex');
}

/* Copia exacta para el snapshot de la reserva (solo campos de presentacion). */
function buildSnapshot(notes) {
  return (notes || []).map(function (n) {
    return {
      id: n.id,
      title_en: n.title_en,
      title_es: n.title_es,
      content_en: n.content_en,
      content_es: n.content_es,
      requires_acknowledgement: n.requires_acknowledgement === true,
      display_order: n.display_order,
      updated_at: n.updated_at
    };
  });
}

/* Version publica y saneada para exponer al navegador (sin timestamps ni ids
   internos que no aporten al cliente, pero manteniendo lo necesario para el UI). */
function toPublicNotes(notes) {
  return (notes || []).map(function (n) {
    return {
      id: n.id,
      title_en: n.title_en,
      title_es: n.title_es,
      content_en: n.content_en,
      content_es: n.content_es,
      requires_acknowledgement: n.requires_acknowledgement === true,
      display_order: n.display_order
    };
  });
}

async function loadActiveNotes(tenant, tourId) {
  if (!tourId) return [];
  const supabase = getSupabase();
  const q = await supabase.from('tour_important_notes')
    .select('id,tour_id,title_en,title_es,content_en,content_es,requires_acknowledgement,display_order,updated_at,active')
    .eq('tenant_id', tenant).eq('tour_id', tourId).eq('active', true)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (q.error) throw new Error('notes lookup failed');
  return q.data || [];
}

/* Para el navegador: notas publicas + version (para el gate de aceptacion). */
async function getPublicNotesForTour(tenant, tourId) {
  const notes = await loadActiveNotes(tenant, tourId);
  return {
    notes: toPublicNotes(notes),
    notes_version: computeNotesVersion(notes),
    requires_acknowledgement: notes.some(function (n) { return n.requires_acknowledgement === true; })
  };
}

/**
 * Gate + snapshot para create-payment-intent / quote-request.
 * @param {object} o { tenant, tourId, acknowledged, ackVersion }
 * @returns {Promise<{error?:string, snapshot?:Array, version?:string,
 *                    acknowledgedAt?:string|null, acknowledgementVersion?:string|null}>}
 */
async function resolveNotesForBooking(o) {
  o = o || {};
  const notes = await loadActiveNotes(o.tenant, o.tourId);
  const version = computeNotesVersion(notes);
  const needsAck = notes.some(function (n) { return n.requires_acknowledgement === true; });

  if (needsAck) {
    if (o.acknowledged !== true) return { error: 'NOTES_NOT_ACKNOWLEDGED' };
    if (!o.ackVersion) return { error: 'NOTES_NOT_ACKNOWLEDGED' };
    if (o.ackVersion !== version) return { error: 'NOTES_VERSION_MISMATCH' };
  }

  return {
    snapshot: buildSnapshot(notes),
    version: version,
    acknowledgedAt: needsAck ? new Date().toISOString() : null,
    acknowledgementVersion: needsAck ? version : null
  };
}

module.exports = {
  computeNotesVersion, buildSnapshot, toPublicNotes,
  loadActiveNotes, getPublicNotesForTour, resolveNotesForBooking
};
