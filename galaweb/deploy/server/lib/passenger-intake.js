'use strict';

/* =========================================================
   Hook Adventure — intake de pasajeros (token + ciclo de vida)
   ---------------------------------------------------------
   Token igual al del QR pero con secreto propio PASSENGER_FORM_SECRET:

     payloadB64 = base64url("<public_id>.<token_version>")
     signature  = base64url( HMAC_SHA256(payloadB64, PASSENGER_FORM_SECRET) )
     token      = payloadB64 + "." + signature
     url        = PUBLIC_SITE_URL + "/passengers.html#t=" + token

   El token viaja en el FRAGMENTO (#), nunca en la query. El estado
   (version, expiracion, revocacion) vive en booking_passenger_forms, no
   en el token. Rotar (renovar) = token_version + 1 -> invalida el anterior.

   El formulario se crea SOLO tras paid + confirmed (web o agencia), nunca
   para cotizaciones/pendientes/fallidas/canceladas/reembolsadas/test.
   Expiracion = created_at + 30 dias (independiente de la fecha del tour).
   ========================================================= */

const crypto = require('crypto');
const { getSupabase } = require('./supabase');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ELIGIBLE_BOOKING_STATUSES = ['confirmed', 'completed'];
const FORM_TTL_DAYS = 30;

/* Estados del formulario que se abren en modo lectura (no editable). */
const READONLY_STATUSES = ['submitted', 'reviewed', 'complete'];

/* Mapa formulario -> estado operativo en bookings.passenger_intake_status. */
const FORM_TO_BOOKING_STATUS = {
  pending: 'form_pending',
  in_progress: 'form_in_progress',
  submitted: 'form_submitted',
  reviewed: 'form_reviewed',
  changes_requested: 'changes_requested',
  complete: 'logistics_ready'
};

function getFormSecret() {
  const s = process.env.PASSENGER_FORM_SECRET;
  if (!s) throw new Error('PASSENGER_FORM_SECRET no está configurada');
  return s;
}
function getPublicSiteUrl() {
  const u = process.env.PUBLIC_SITE_URL;
  if (!u) throw new Error('PUBLIC_SITE_URL no está configurada');
  return String(u).replace(/\/+$/, '');
}

/* ---------------- token ---------------- */
function signFormToken(publicId, tokenVersion) {
  const payload = Buffer.from(String(publicId) + '.' + String(tokenVersion)).toString('base64url');
  const sig = crypto.createHmac('sha256', getFormSecret()).update(payload).digest('base64url');
  return payload + '.' + sig;
}

/** Verifica firma y formato. NO consulta la base de datos. */
function verifyFormToken(token) {
  try {
    if (typeof token !== 'string' || token.length < 8 || token.length > 512) return null;
    const dot = token.indexOf('.');
    if (dot < 1 || dot !== token.lastIndexOf('.')) return null;
    const payload = token.slice(0, dot);
    const provided = Buffer.from(token.slice(dot + 1), 'base64url');
    const expected = crypto.createHmac('sha256', getFormSecret()).update(payload).digest();
    if (provided.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(provided, expected)) return null;

    const raw = Buffer.from(payload, 'base64url').toString('utf8');
    const sep = raw.lastIndexOf('.');
    if (sep < 1) return null;
    const publicId = raw.slice(0, sep);
    const tokenVersion = parseInt(raw.slice(sep + 1), 10);
    if (!UUID_RE.test(publicId)) return null;
    if (!Number.isInteger(tokenVersion) || tokenVersion < 1) return null;
    return { publicId: publicId, tokenVersion: tokenVersion };
  } catch (e) { return null; }
}

function buildFormUrl(token) { return getPublicSiteUrl() + '/passengers.html#t=' + token; }

function buildFormUrlForAccess(form) {
  return buildFormUrl(signFormToken(form.public_id, form.token_version));
}

function computeExpiry() {
  return new Date(Date.now() + FORM_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/* ---------------- elegibilidad ---------------- */
function isIntakeEligible(booking) {
  return !!booking
    && booking.request_type === 'booking'
    && booking.payment_status === 'paid'
    && ELIGIBLE_BOOKING_STATUSES.indexOf(booking.booking_status) !== -1
    && booking.is_test !== true
    && !booking.deleted_at;
}

/* ---------------- creacion idempotente ----------------
   Crea la fila si no existe; nunca duplica (booking_id es UNIQUE).
   Sincroniza bookings.passenger_intake_status a 'form_pending' al crear. */
async function ensurePassengerForm(booking) {
  if (!isIntakeEligible(booking)) return null;
  const supabase = getSupabase();

  const found = await supabase.from('booking_passenger_forms').select('*')
    .eq('booking_id', booking.id).maybeSingle();
  if (found.error) throw new Error('intake lookup failed');
  if (found.data) return found.data;

  const ins = await supabase.from('booking_passenger_forms').insert({
    booking_id: booking.id, tenant_id: booking.tenant_id
  }).select().single();

  if (!ins.error) {
    await syncBookingIntakeStatus(booking.id, 'pending').catch(function () {});
    return ins.data;
  }
  if (ins.error.code === '23505') {                       // carrera: ya la creo otra peticion
    const again = await supabase.from('booking_passenger_forms').select('*')
      .eq('booking_id', booking.id).maybeSingle();
    if (again.data) return again.data;
  }
  throw new Error('intake create failed');
}

/* Actualiza el estado operativo en bookings a partir del estado del formulario. */
async function syncBookingIntakeStatus(bookingId, formStatus) {
  const supabase = getSupabase();
  const mapped = FORM_TO_BOOKING_STATUS[formStatus] || 'form_pending';
  const patch = { passenger_intake_status: mapped };
  if (formStatus === 'complete') patch.passenger_intake_completed_at = new Date().toISOString();
  await supabase.from('bookings').update(patch).eq('id', bookingId);
}

function isReadonlyStatus(status) { return READONLY_STATUSES.indexOf(status) !== -1; }

/* ---------------- contrato para Milu Turismo ---------------- */
function ageCategoryAt(dob, travelDate) {
  if (!dob || !travelDate) return null;
  const b = String(dob).split('-'); const t = String(travelDate).split('-');
  if (b.length !== 3 || t.length !== 3) return null;
  let age = (+t[0]) - (+b[0]);
  const mDiff = (+t[1]) - (+b[1]);
  if (mDiff < 0 || (mDiff === 0 && (+t[2]) < (+b[2]))) age -= 1;
  if (age < 0) return null;
  if (age < 2) return 'infant';
  if (age < 12) return 'child';
  return 'adult';
}

/**
 * Construye el contrato server-side listo para el conector Milu (sin ejecutar
 * busquedas). Excluye finanzas internas, tokens, secretos y numeros de
 * documento completos. Incluye lodging por destino y hoteles preferidos.
 */
async function buildTravelRequirements(bookingId) {
  const supabase = getSupabase();

  const bq = await supabase.from('bookings')
    .select('id,tenant_id,booking_code,tour_id,tour_name,booking_date,guests')
    .eq('id', bookingId).maybeSingle();
  if (bq.error || !bq.data) throw new Error('booking not found');
  const booking = bq.data;
  const tenant = booking.tenant_id;

  const fq = await supabase.from('booking_passenger_forms').select('*')
    .eq('booking_id', bookingId).eq('tenant_id', tenant).maybeSingle();
  const form = fq.data || null;

  let passengers = [];
  let lodging = [];
  if (form) {
    const pq = await supabase.from('booking_passengers')
      .select('passenger_number,legal_first_name,legal_middle_name,legal_last_name,date_of_birth,nationality,document_type,document_expiration_date,issuing_country,special_assistance,dietary_requirements,accessibility_or_mobility_needs,baggage_notes,active')
      .eq('passenger_form_id', form.id).eq('active', true)
      .order('passenger_number', { ascending: true });
    passengers = pq.data || [];

    const lq = await supabase.from('booking_lodging_requirements')
      .select('destination,lodging_required,check_in_date,check_out_date,nights,guest_count,rooms_required,room_preferences,approximate_budget_cents,accessibility_notes,status,active')
      .eq('passenger_form_id', form.id).eq('active', true)
      .neq('status', 'not_required')
      .order('destination', { ascending: true });
    lodging = lq.data || [];
  }

  const hq = await supabase.from('hotel_search_preferences')
    .select('destination,hotel_name,priority,preference_notes,search_aliases')
    .eq('tenant_id', tenant).eq('active', true)
    .order('destination', { ascending: true })
    .order('priority', { ascending: true });
  const prefs = hq.data || [];

  return {
    booking_code: booking.booking_code,
    tour: { id: booking.tour_id, name: booking.tour_name },
    travel_date: booking.booking_date,
    passenger_count: booking.guests,
    preferred_connection_city: form ? form.preferred_connection_city : null,
    arrival: form ? {
      international_flights_purchased: form.international_flights_purchased,
      ecuador_arrival_date: form.ecuador_arrival_date,
      ecuador_arrival_time: form.ecuador_arrival_time,
      arrival_airport: form.arrival_airport
    } : null,
    passengers: passengers.map(function (p) {
      return {
        passenger_number: p.passenger_number,
        legal_first_name: p.legal_first_name,
        legal_middle_name: p.legal_middle_name,
        legal_last_name: p.legal_last_name,
        age_category: ageCategoryAt(p.date_of_birth, booking.booking_date),
        nationality: p.nationality,
        document_type: p.document_type,               // sin numero de documento
        document_expiration_date: p.document_expiration_date,
        issuing_country: p.issuing_country,
        special_assistance: p.special_assistance,
        dietary_requirements: p.dietary_requirements,
        accessibility_or_mobility_needs: p.accessibility_or_mobility_needs,
        baggage_notes: p.baggage_notes
      };
    }),
    lodging_requirements: lodging.map(function (l) {
      return {
        destination: l.destination,
        lodging_required: l.lodging_required,
        check_in_date: l.check_in_date,
        check_out_date: l.check_out_date,
        nights: l.nights,
        guest_count: l.guest_count,
        rooms_required: l.rooms_required,
        room_preferences: l.room_preferences,
        approximate_budget_cents: l.approximate_budget_cents,
        accessibility_notes: l.accessibility_notes,
        pending_resolution: l.destination === 'connection_tbd'    // no buscar hasta resolver
      };
    }),
    hotel_search_preferences: prefs.map(function (h) {
      return {
        destination: h.destination,
        hotel_name: h.hotel_name,
        priority: h.priority,
        preference_notes: h.preference_notes,
        search_aliases: h.search_aliases || []
      };
    })
  };
}

module.exports = {
  ELIGIBLE_BOOKING_STATUSES, READONLY_STATUSES, FORM_TO_BOOKING_STATUS, FORM_TTL_DAYS,
  signFormToken, verifyFormToken, buildFormUrl, buildFormUrlForAccess, computeExpiry,
  isIntakeEligible, ensurePassengerForm, syncBookingIntakeStatus, isReadonlyStatus,
  ageCategoryAt, buildTravelRequirements
};
