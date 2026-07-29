'use strict';

/* =========================================================
   GET /api/admin-passenger-intake-detail (action=passenger-intake-detail)
   ---------------------------------------------------------
   Expediente de un formulario. ?form_id=<uuid>.
   owner/admin: expediente completo, con documento SOLO enmascarado
     (****1234). El número en claro se pide aparte (passenger-document-reveal).
   staff: vista operativa reducida — sin número de documento, sin fecha de
     nacimiento completa y sin presupuesto.
   ========================================================= */

const { sendJson, sendError, logServer, isUuid, getTenantId } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireAdmin } = require('../lib/admin-auth');
const { maskDocument } = require('../lib/passenger-crypto');

function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { const u = new URL(req.url, 'http://localhost'); const o = {}; u.searchParams.forEach(function (v, k) { o[k] = v; }); return o; }
  catch (e) { return {}; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }
  const session = await requireAdmin(req, res, ['owner', 'admin', 'staff']);
  if (!session) return;
  const isStaff = session.role === 'staff';

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('intake-detail', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  const q = getQuery(req);
  if (!isUuid(q.form_id)) return sendError(res, 400, 'INVALID_FORM_ID', 'form_id must be a UUID');

  try {
    const supabase = getSupabase();
    const fq = await supabase.from('booking_passenger_forms').select('*')
      .eq('id', q.form_id).eq('tenant_id', tenant).maybeSingle();
    if (fq.error) { logServer('intake-detail', fq.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    if (!fq.data) return sendError(res, 404, 'NOT_FOUND', 'Passenger form not found');
    const form = fq.data;

    const bq = await supabase.from('bookings')
      .select('id,booking_code,tour_name,tour_id,booking_date,guests,customer_name,customer_email')
      .eq('id', form.booking_id).maybeSingle();
    const booking = bq.data || {};

    const pq = await supabase.from('booking_passengers').select('*')
      .eq('passenger_form_id', form.id).eq('active', true)
      .order('passenger_number', { ascending: true });
    const passengers = (pq.data || []).map(function (p) {
      const base = {
        passenger_number: p.passenger_number,
        legal_first_name: p.legal_first_name,
        legal_middle_name: p.legal_middle_name,
        legal_last_name: p.legal_last_name,
        nationality: p.nationality,
        document_type: p.document_type,
        document_expiration_date: p.document_expiration_date,
        issuing_country: p.issuing_country,
        special_assistance: p.special_assistance,
        dietary_requirements: p.dietary_requirements,
        accessibility_or_mobility_needs: p.accessibility_or_mobility_needs,
        baggage_notes: p.baggage_notes,
        has_document: !!p.document_number_ciphertext
      };
      if (!isStaff) {
        base.passenger_id = p.id;                       // para reveal owner/admin
        base.date_of_birth = p.date_of_birth;
        base.gender = p.gender;
        base.document_masked = maskDocument(p.document_number_last4);
      }
      return base;
    });

    const lq = await supabase.from('booking_lodging_requirements').select('*')
      .eq('passenger_form_id', form.id).eq('active', true)
      .order('destination', { ascending: true });
    const lodging = (lq.data || []).map(function (l) {
      const base = {
        id: l.id, destination: l.destination, lodging_required: l.lodging_required,
        check_in_date: l.check_in_date, check_out_date: l.check_out_date, nights: l.nights,
        guest_count: l.guest_count, rooms_required: l.rooms_required,
        room_preferences: l.room_preferences, accessibility_notes: l.accessibility_notes,
        lodging_notes: l.lodging_notes, source: l.source, status: l.status
      };
      if (!isStaff) base.approximate_budget_cents = l.approximate_budget_cents;   // presupuesto: solo owner/admin
      return base;
    });

    const formOut = {
      form_id: form.id,
      status: form.status,
      preferred_connection_city: form.preferred_connection_city,
      international_flights_purchased: form.international_flights_purchased,
      ecuador_arrival_date: form.ecuador_arrival_date,
      ecuador_arrival_time: form.ecuador_arrival_time,
      arrival_airport: form.arrival_airport,
      connection_notes: form.connection_notes,
      submitted_at: form.submitted_at
    };
    if (!isStaff) {
      formOut.submission_version = form.submission_version;
      formOut.review_cycle = form.review_cycle;
      formOut.reviewed_at = form.reviewed_at;
      formOut.changes_requested_note = form.changes_requested_note;
      formOut.expires_at = form.expires_at;
      formOut.active = form.active;
    }

    const bookingOut = {
      booking_code: booking.booking_code, tour_name: booking.tour_name,
      booking_date: booking.booking_date, guests: booking.guests, customer_name: booking.customer_name
    };
    if (!isStaff) bookingOut.customer_email = booking.customer_email;

    return sendJson(res, 200, { form: formOut, booking: bookingOut, passengers: passengers, lodging: lodging });
  } catch (err) {
    logServer('intake-detail', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};
