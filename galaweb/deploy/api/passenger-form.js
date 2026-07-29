'use strict';

/* =========================================================
   POST /api/passenger-form
   ---------------------------------------------------------
   Endpoint PÚBLICO protegido por TOKEN firmado (fragmento #, body POST).
   Acciones estrictas: load | save-draft | submit. No carga handlers
   arbitrarios. El token es la única autorización y da acceso SOLO a la
   reserva propia. Nunca requiere cuenta administrativa.

   Seguridad: Cache-Control no-store, Referrer-Policy no-referrer,
   frame-ancestors 'none', rate limiting, y errores genéricos para
   tokens inválidos. El número de documento se guarda CIFRADO (AES-256-GCM)
   y jamás se devuelve en claro (en load solo se indica ****last4).
   ========================================================= */

const { getSupabase } = require('../server/lib/supabase');
const {
  sendJson, sendError, methodNotAllowed, readJsonBody, rejectUnknownKeys,
  logServer, isRealYmd, todayInGalapagos, getTenantId
} = require('../server/lib/http');
const {
  verifyFormToken, isReadonlyStatus, syncBookingIntakeStatus
} = require('../server/lib/passenger-intake');
const { encryptDocumentNumber, decryptDocumentNumber, maskDocument } = require('../server/lib/passenger-crypto');
const { sendOwnerSubmitted } = require('../server/lib/passenger-intake-emails');
const { checkRateLimit } = require('../server/lib/rate-limit');
const { clientIpMasked } = require('../server/lib/passenger-audit');

const ACTIONS = ['load', 'save-draft', 'submit'];
const ALLOWED_KEYS = ['action', 'token', 'form', 'passengers', 'lodging'];
const DOC_TYPES = ['passport', 'national_id', 'other'];
const GENDERS = ['male', 'female', 'x', 'undisclosed'];
const CITIES = ['quito', 'guayaquil', 'either'];
const AIRPORTS_MAX = 80, NAME_MAX = 80, TEXT_MAX = 1000, DOC_MAX = 40, MAX_PAX = 50;

function setSecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
}

function optStr(v, max) {
  if (v == null) return null;
  if (typeof v !== 'string') return undefined;
  if (v.length > max) return undefined;
  return v.trim() || null;
}
function optInt(v, min, max) {
  if (v == null) return null;
  if (!Number.isInteger(v) || v < min || v > max) return undefined;
  return v;
}
function maskedHint(last4) { const m = maskDocument(last4); return m || null; }

module.exports = async function handler(req, res) {
  setSecurityHeaders(res);
  try {
    if (req.method !== 'POST') return methodNotAllowed(res);

    let tenant;
    try { tenant = getTenantId(); }
    catch (e) { logServer('passenger-form', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

    let body;
    try { body = await readJsonBody(req); } catch (e) { return sendError(res, 400, 'INVALID_JSON', 'Invalid JSON'); }
    if (rejectUnknownKeys(body, ALLOWED_KEYS)) return sendError(res, 400, 'INVALID_BODY', 'Unexpected or invalid fields');
    if (ACTIONS.indexOf(body.action) === -1) return sendError(res, 400, 'INVALID_ACTION', 'Unknown action');

    /* Rate limiting por IP enmascarada + acción (fail-open). */
    const ip = clientIpMasked(req) || 'unknown';
    const rl = await checkRateLimit({ tenant: tenant, bucketKey: 'pform:' + body.action + ':' + ip, limit: 40, windowSeconds: 60 });
    if (!rl.allowed) { res.setHeader('Retry-After', String(rl.retryAfter || 60)); return sendError(res, 429, 'RATE_LIMITED', 'Too many requests'); }

    /* Verificación de firma del token (sin BD). Error genérico. */
    const parsed = verifyFormToken(body.token);
    if (!parsed) return sendError(res, 400, 'INVALID_TOKEN', 'Invalid or expired link');

    const supabase = getSupabase();
    const fq = await supabase.from('booking_passenger_forms').select('*')
      .eq('public_id', parsed.publicId).eq('tenant_id', tenant).maybeSingle();
    if (fq.error) { logServer('passenger-form', fq.error.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    const form = fq.data;
    if (!form) return sendError(res, 400, 'INVALID_TOKEN', 'Invalid or expired link');   // sin revelar existencia
    if (Number(form.token_version) !== Number(parsed.tokenVersion)) return sendError(res, 400, 'INVALID_TOKEN', 'Invalid or expired link');
    if (form.active !== true) return sendError(res, 403, 'FORM_REVOKED', 'This link is no longer active');
    if (form.expires_at && new Date(form.expires_at).getTime() <= Date.now()) return sendError(res, 403, 'FORM_EXPIRED', 'This link has expired');

    const bq = await supabase.from('bookings')
      .select('id,tenant_id,booking_code,tour_name,booking_date,guests,customer_name,customer_email')
      .eq('id', form.booking_id).maybeSingle();
    if (bq.error || !bq.data) { logServer('passenger-form', 'booking lookup'); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }
    const booking = bq.data;
    const guests = booking.guests || 0;
    const editable = !isReadonlyStatus(form.status);

    if (body.action === 'load') return doLoad(res, supabase, form, booking, guests, editable);

    if (!editable) return sendError(res, 409, 'NOT_EDITABLE', 'This form has been submitted and is read-only');
    if (body.action === 'save-draft') return doSave(res, supabase, tenant, form, booking, guests, body, false);
    if (body.action === 'submit') return doSave(res, supabase, tenant, form, booking, guests, body, true);
    return sendError(res, 400, 'INVALID_ACTION', 'Unknown action');
  } catch (err) {
    logServer('passenger-form', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};

/* ---------------- load ---------------- */
async function doLoad(res, supabase, form, booking, guests, editable) {
  const pq = await supabase.from('booking_passengers').select('*')
    .eq('passenger_form_id', form.id).eq('active', true)
    .order('passenger_number', { ascending: true });
  const passengers = (pq.data || []).map(function (p) {
    return {
      passenger_number: p.passenger_number,
      legal_first_name: p.legal_first_name, legal_middle_name: p.legal_middle_name, legal_last_name: p.legal_last_name,
      date_of_birth: p.date_of_birth, nationality: p.nationality, gender: p.gender,
      document_type: p.document_type,
      document_hint: maskedHint(p.document_number_last4),   // nunca el número en claro
      has_document: !!p.document_number_ciphertext,
      document_expiration_date: p.document_expiration_date, issuing_country: p.issuing_country,
      special_assistance: p.special_assistance, dietary_requirements: p.dietary_requirements,
      accessibility_or_mobility_needs: p.accessibility_or_mobility_needs, baggage_notes: p.baggage_notes
    };
  });

  const lq = await supabase.from('booking_lodging_requirements').select('*')
    .eq('passenger_form_id', form.id).eq('source', 'customer').eq('active', true).maybeSingle();
  const lodging = lq.data ? {
    needs_hotel: lq.data.lodging_required, destination: lq.data.destination,
    nights: lq.data.nights, rooms_required: lq.data.rooms_required, guest_count: lq.data.guest_count,
    approximate_budget_cents: lq.data.approximate_budget_cents,
    room_preferences: lq.data.room_preferences, accessibility_notes: lq.data.accessibility_notes
  } : null;

  return sendJson(res, 200, {
    editable: editable,
    status: form.status,
    booking: {
      booking_code: booking.booking_code, tour_name: booking.tour_name,
      booking_date: booking.booking_date, guests: guests, customer_name: booking.customer_name
    },
    form: {
      preferred_connection_city: form.preferred_connection_city,
      international_flights_purchased: form.international_flights_purchased,
      ecuador_arrival_date: form.ecuador_arrival_date, ecuador_arrival_time: form.ecuador_arrival_time,
      arrival_airport: form.arrival_airport, connection_notes: form.connection_notes,
      changes_requested_note: form.changes_requested_note
    },
    passengers: passengers,
    lodging: lodging
  });
}

/* ---------------- validación de un pasajero ---------------- */
function validatePassenger(p, guests, strict) {
  const today = todayInGalapagos();
  if (!Number.isInteger(p.passenger_number) || p.passenger_number < 1 || p.passenger_number > guests) return 'INVALID_PASSENGER_NUMBER';
  const fn = optStr(p.legal_first_name, NAME_MAX), mn = optStr(p.legal_middle_name, NAME_MAX), ln = optStr(p.legal_last_name, NAME_MAX);
  if (fn === undefined || mn === undefined || ln === undefined) return 'INVALID_NAME';
  const nat = optStr(p.nationality, NAME_MAX), iss = optStr(p.issuing_country, NAME_MAX);
  if (nat === undefined || iss === undefined) return 'INVALID_TEXT';
  if (p.gender != null && GENDERS.indexOf(p.gender) === -1) return 'INVALID_GENDER';
  if (p.document_type != null && DOC_TYPES.indexOf(p.document_type) === -1) return 'INVALID_DOC_TYPE';
  if (p.date_of_birth != null) {
    if (!isRealYmd(p.date_of_birth) || p.date_of_birth > today || p.date_of_birth < '1900-01-01') return 'INVALID_DOB';
  }
  if (p.document_expiration_date != null) {
    if (!isRealYmd(p.document_expiration_date)) return 'INVALID_DOC_EXP';
    if (!(p.document_expiration_date > today)) return 'DOC_EXPIRED';
  }
  if (p.document_number != null && p.document_number !== '') {
    if (typeof p.document_number !== 'string' || p.document_number.trim().length < 3 || p.document_number.length > DOC_MAX) return 'INVALID_DOC_NUMBER';
  }
  for (const k of ['special_assistance', 'dietary_requirements', 'accessibility_or_mobility_needs', 'baggage_notes']) {
    if (optStr(p[k], TEXT_MAX) === undefined) return 'INVALID_TEXT';
  }
  if (strict) {
    if (!fn || !ln) return 'MISSING_NAME';
    if (!p.date_of_birth) return 'MISSING_DOB';
    if (!nat) return 'MISSING_NATIONALITY';
    if (DOC_TYPES.indexOf(p.document_type) === -1) return 'MISSING_DOC_TYPE';
    if (!p.document_expiration_date) return 'MISSING_DOC_EXP';
    // documento: debe venir ahora o ya estar guardado (se verifica con existing)
  }
  return null;
}

/* Campos cifrados del documento (mantener / reemplazar / limpiar + re-cifrado por cambio de tipo). */
function documentFields(existing, incomingNumber, aadBase, newDocType, oldDocType) {
  if (typeof incomingNumber === 'string' && incomingNumber.trim() !== '') {
    const enc = encryptDocumentNumber(incomingNumber.trim(), Object.assign({}, aadBase, { document_type: newDocType }));
    return { document_number_ciphertext: enc.ciphertext, document_number_iv: enc.iv, document_number_auth_tag: enc.authTag, document_number_last4: enc.last4, document_number_key_id: enc.keyId };
  }
  if (incomingNumber === '') {
    return { document_number_ciphertext: null, document_number_iv: null, document_number_auth_tag: null, document_number_last4: null, document_number_key_id: null };
  }
  // sin número nuevo: si cambió el tipo y hay valor guardado, re-cifrar con el AAD nuevo.
  if (existing && existing.document_number_ciphertext && newDocType !== oldDocType) {
    try {
      const plain = decryptDocumentNumber(existing, Object.assign({}, aadBase, { document_type: oldDocType }));
      const enc = encryptDocumentNumber(plain, Object.assign({}, aadBase, { document_type: newDocType }));
      return { document_number_ciphertext: enc.ciphertext, document_number_iv: enc.iv, document_number_auth_tag: enc.authTag, document_number_last4: enc.last4, document_number_key_id: enc.keyId };
    } catch (e) { return null; }
  }
  return null; // sin cambios
}

/* ---------------- save-draft / submit ---------------- */
async function doSave(res, supabase, tenant, form, booking, guests, body, strict) {
  const now = new Date().toISOString();

  /* --- datos generales del viaje --- */
  const f = (body.form && typeof body.form === 'object') ? body.form : {};
  if (f.preferred_connection_city != null && CITIES.indexOf(f.preferred_connection_city) === -1) return sendError(res, 400, 'INVALID_CITY', 'Invalid connection city');
  if (f.international_flights_purchased != null && typeof f.international_flights_purchased !== 'boolean') return sendError(res, 400, 'INVALID_FLIGHTS', 'international_flights_purchased must be boolean');
  const arrDate = f.ecuador_arrival_date;
  if (arrDate != null && arrDate !== '' && !isRealYmd(arrDate)) return sendError(res, 400, 'INVALID_ARRIVAL_DATE', 'ecuador_arrival_date invalid');
  const arrTime = optStr(f.ecuador_arrival_time, 40);
  const airport = optStr(f.arrival_airport, AIRPORTS_MAX);
  const connNotes = optStr(f.connection_notes, TEXT_MAX);
  if (arrTime === undefined || airport === undefined || connNotes === undefined) return sendError(res, 400, 'INVALID_TEXT', 'A field is too long');

  /* --- pasajeros --- */
  const incoming = Array.isArray(body.passengers) ? body.passengers : [];
  if (incoming.length > guests || incoming.length > MAX_PAX) return sendError(res, 400, 'TOO_MANY_PASSENGERS', 'More passengers than the booking allows');
  const seen = {};
  for (const p of incoming) {
    const err = validatePassenger(p, guests, strict);
    if (err) return sendError(res, 400, err, 'Please review the passenger details');
    if (seen[p.passenger_number]) return sendError(res, 400, 'DUPLICATE_PASSENGER', 'Duplicate passenger number');
    seen[p.passenger_number] = true;
  }
  if (strict) {
    if (incoming.length !== guests) return sendError(res, 400, 'PASSENGER_COUNT_MISMATCH', 'Exactly ' + guests + ' passengers are required');
    for (let n = 1; n <= guests; n++) if (!seen[n]) return sendError(res, 400, 'PASSENGER_COUNT_MISMATCH', 'Missing passenger ' + n);
  }
  if (strict && f.preferred_connection_city == null && form.preferred_connection_city == null) {
    return sendError(res, 400, 'MISSING_CONNECTION_CITY', 'Please choose your connection city');
  }

  try {
    /* Cargar pasajeros existentes para el manejo del documento. */
    const existQ = await supabase.from('booking_passengers').select('*').eq('passenger_form_id', form.id);
    const existingByNum = {};
    (existQ.data || []).forEach(function (r) { existingByNum[r.passenger_number] = r; });

    for (const p of incoming) {
      const existing = existingByNum[p.passenger_number] || null;
      const newDocType = p.document_type != null ? p.document_type : (existing ? existing.document_type : null);
      const oldDocType = existing ? existing.document_type : null;

      if (strict) {
        const willHaveDoc = (typeof p.document_number === 'string' && p.document_number.trim() !== '')
          || (existing && existing.document_number_ciphertext && p.document_number !== '');
        if (!willHaveDoc) return sendError(res, 400, 'MISSING_DOC_NUMBER', 'Document number is required for passenger ' + p.passenger_number);
      }

      const aadBase = { tenant_id: tenant, passenger_form_id: form.id, passenger_number: p.passenger_number };
      const docFields = documentFields(existing, p.document_number, aadBase, newDocType, oldDocType);

      const rowFields = {
        legal_first_name: (optStr(p.legal_first_name, NAME_MAX) || ''),
        legal_middle_name: optStr(p.legal_middle_name, NAME_MAX),
        legal_last_name: (optStr(p.legal_last_name, NAME_MAX) || ''),
        date_of_birth: p.date_of_birth || null,
        nationality: optStr(p.nationality, NAME_MAX),
        gender: p.gender || null,
        document_type: newDocType,
        document_expiration_date: p.document_expiration_date || null,
        issuing_country: optStr(p.issuing_country, NAME_MAX),
        special_assistance: optStr(p.special_assistance, TEXT_MAX),
        dietary_requirements: optStr(p.dietary_requirements, TEXT_MAX),
        accessibility_or_mobility_needs: optStr(p.accessibility_or_mobility_needs, TEXT_MAX),
        baggage_notes: optStr(p.baggage_notes, TEXT_MAX),
        active: true, updated_at: now
      };
      if (docFields) Object.assign(rowFields, docFields);

      if (existing) {
        const up = await supabase.from('booking_passengers').update(rowFields).eq('id', existing.id);
        if (up.error) throw new Error('passenger update: ' + up.error.message);
      } else {
        rowFields.tenant_id = tenant; rowFields.passenger_form_id = form.id; rowFields.passenger_number = p.passenger_number;
        const insP = await supabase.from('booking_passengers').insert(rowFields);
        if (insP.error) throw new Error('passenger insert: ' + insP.error.message);
      }
    }

    /* --- alojamiento de conexión (source=customer) --- */
    const city = f.preferred_connection_city != null ? f.preferred_connection_city : form.preferred_connection_city;
    if (body.lodging !== undefined) {
      const lodgeErr = await upsertCustomerLodging(supabase, tenant, form, city, body.lodging, now);
      if (lodgeErr) return sendError(res, 400, lodgeErr, 'Please review the hotel details');
    }

    /* --- actualizar el formulario --- */
    const formPatch = { updated_at: now };
    if (f.preferred_connection_city != null) formPatch.preferred_connection_city = f.preferred_connection_city;
    if (f.international_flights_purchased != null) formPatch.international_flights_purchased = f.international_flights_purchased;
    if (arrDate !== undefined) formPatch.ecuador_arrival_date = arrDate || null;
    formPatch.ecuador_arrival_time = arrTime;
    formPatch.arrival_airport = airport;
    formPatch.connection_notes = connNotes;

    let newStatus = form.status;
    if (strict) {
      newStatus = 'submitted';
      formPatch.status = 'submitted';
      formPatch.submitted_at = now;
      formPatch.submission_version = (form.submission_version || 0) + 1;
    } else if (form.status === 'pending' || form.status === 'changes_requested') {
      newStatus = 'in_progress';
      formPatch.status = 'in_progress';
    }

    const upF = await supabase.from('booking_passenger_forms').update(formPatch)
      .eq('id', form.id).eq('tenant_id', tenant).select().single();
    if (upF.error) throw new Error('form update: ' + upF.error.message);

    await syncBookingIntakeStatus(form.booking_id, newStatus).catch(function () {});

    if (strict) {
      try { await sendOwnerSubmitted(booking, upF.data); } catch (e) { logServer('passenger-form', 'owner email failed'); }
      return sendJson(res, 200, { submitted: true, status: 'submitted' });
    }
    return sendJson(res, 200, { saved: true, status: newStatus });
  } catch (err) {
    logServer('passenger-form', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Unable to save the form');
  }
}

/* Alta/edición del alojamiento de conexión del cliente (una fila activa). */
async function upsertCustomerLodging(supabase, tenant, form, city, lodgingIn, now) {
  const desiredDest = city === 'either' ? 'connection_tbd'
    : ((city === 'quito' || city === 'guayaquil') ? city : null);
  if (!desiredDest) return null;   // ciudad no elegida: no se crea fila aún
  if (lodgingIn == null || typeof lodgingIn !== 'object') return null;
  const needs = lodgingIn.needs_hotel === true;

  const nights = optInt(lodgingIn.nights, 0, 366);
  const rooms = optInt(lodgingIn.rooms_required, 0, 100);
  const gc = optInt(lodgingIn.guest_count, 1, 100);
  const budget = optInt(lodgingIn.approximate_budget_cents, 0, 100000000);
  const roomPrefs = optStr(lodgingIn.room_preferences, 1000);
  const accessNotes = optStr(lodgingIn.accessibility_notes, 1000);
  if ([nights, rooms, gc, budget].indexOf(undefined) !== -1 || roomPrefs === undefined || accessNotes === undefined) return 'INVALID_LODGING';

  const cur = await supabase.from('booking_lodging_requirements').select('*')
    .eq('passenger_form_id', form.id).eq('tenant_id', tenant).eq('source', 'customer').eq('active', true);
  const rows = cur.data || [];
  for (const r of rows) {
    if (r.destination !== desiredDest) await supabase.from('booking_lodging_requirements').update({ active: false }).eq('id', r.id);
  }
  const existing = rows.find(function (r) { return r.destination === desiredDest; });

  const fields = {
    destination: desiredDest, lodging_required: needs,
    check_in_date: null, check_out_date: null, nights: needs ? nights : null,
    rooms_required: needs ? rooms : null, guest_count: needs ? gc : null,
    approximate_budget_cents: needs ? budget : null,
    room_preferences: needs ? roomPrefs : null, accessibility_notes: needs ? accessNotes : null,
    source: 'customer', status: needs ? 'pending' : 'not_required', active: true, updated_at: now
  };
  if (existing) {
    const up = await supabase.from('booking_lodging_requirements').update(fields).eq('id', existing.id);
    if (up.error) throw new Error('lodging update: ' + up.error.message);
  } else {
    fields.tenant_id = tenant; fields.passenger_form_id = form.id;
    const ins = await supabase.from('booking_lodging_requirements').insert(fields);
    if (ins.error) throw new Error('lodging insert: ' + ins.error.message);
  }
  return null;
}
