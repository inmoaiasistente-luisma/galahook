/* =========================================================
   GALÁPAGOS HOOK ADVENTURE — formulario de pasajeros
   ---------------------------------------------------------
   Página PÚBLICA protegida por token firmado. El token viaja en el
   FRAGMENTO (#t=…): el navegador no lo envía al servidor en la carga
   inicial, así que no aparece en logs ni en Referer. Se guarda SOLO en
   memoria (nunca localStorage) y se retira de la barra con
   history.replaceState. Se envía por POST en el cuerpo JSON.

   El número de documento nunca se muestra en claro: en la carga solo se
   indica ****last4. Se minimizan los datos médicos (solo necesidades
   operativas de accesibilidad/movilidad, sin diagnósticos).
   ========================================================= */
(function () {
  "use strict";

  var ES = (function () { try { return localStorage.getItem('GHA_LANG') === 'es'; } catch (e) { return false; } })();
  var root = document.getElementById('pfRoot');

  var TOKEN = (function () {
    try {
      var frag = String(window.location.hash || '').replace(/^#/, '');
      if (!frag) return '';
      var v = new URLSearchParams(frag).get('t');
      return v ? String(v) : '';
    } catch (e) { return ''; }
  })();
  (function stripTokenFromUrl() {
    try { if (window.history && history.replaceState) history.replaceState(null, document.title, window.location.pathname); }
    catch (e) { /* noop */ }
  })();

  var STATE = { editable: true, guests: 0, form: {}, passengers: [], lodging: null };

  function T(en, es) { return ES ? es : en; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function api(action, extra) {
    var body = Object.assign({ action: action, token: TOKEN }, extra || {});
    return fetch('/api/passenger-form', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); });
  }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function num(id) { var v = parseInt(val(id), 10); return Number.isInteger(v) ? v : null; }
  function checked(id) { var el = document.getElementById(id); return !!(el && el.checked); }

  function errorText(code) {
    var m = {
      INVALID_TOKEN: T('This link is invalid or has expired.', 'Este enlace no es válido o ha expirado.'),
      FORM_EXPIRED: T('This link has expired. Please ask us for a new one.', 'Este enlace expiró. Solicítanos uno nuevo.'),
      FORM_REVOKED: T('This link is no longer active.', 'Este enlace ya no está activo.'),
      NOT_EDITABLE: T('This form was already submitted.', 'Este formulario ya fue enviado.'),
      RATE_LIMITED: T('Too many requests. Please wait a moment.', 'Demasiadas solicitudes. Espera un momento.'),
      PASSENGER_COUNT_MISMATCH: T('Please complete every passenger.', 'Completa todos los pasajeros.'),
      MISSING_NAME: T('A legal name is missing.', 'Falta un nombre legal.'),
      MISSING_DOB: T('A date of birth is missing.', 'Falta una fecha de nacimiento.'),
      INVALID_DOB: T('Please check the dates of birth.', 'Revisa las fechas de nacimiento.'),
      MISSING_NATIONALITY: T('A nationality is missing.', 'Falta una nacionalidad.'),
      MISSING_DOC_TYPE: T('A document type is missing.', 'Falta un tipo de documento.'),
      MISSING_DOC_NUMBER: T('A document number is missing.', 'Falta un número de documento.'),
      MISSING_DOC_EXP: T('A document expiration date is missing.', 'Falta una fecha de expiración.'),
      DOC_EXPIRED: T('A document is expired.', 'Un documento está vencido.'),
      MISSING_CONNECTION_CITY: T('Please choose your connection city.', 'Elige tu ciudad de conexión.'),
      INVALID_LODGING: T('Please review the hotel details.', 'Revisa los datos del hotel.')
    };
    return m[code] || T('Please review the form and try again.', 'Revisa el formulario e inténtalo de nuevo.');
  }
  function msg(kind, text) {
    var box = document.getElementById('pfMsg');
    if (!box) return;
    box.className = 'pf-msg show ' + (kind === 'ok' ? 'ok' : 'err');
    box.textContent = text;
    try { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
  }

  /* ---------------- carga ---------------- */
  function boot() {
    if (!TOKEN) { root.innerHTML = '<div class="pf-card"><p class="pf-muted">' + esc(errorText('INVALID_TOKEN')) + '</p></div>'; return; }
    root.innerHTML = '<div class="pf-card"><p class="pf-muted">' + T('Loading…', 'Cargando…') + '</p></div>';
    api('load').then(function (r) {
      if (r.ok && r.data && r.data.booking) { STATE = normalize(r.data); render(); return; }
      var code = (r.data && r.data.error) || 'INVALID_TOKEN';
      root.innerHTML = '<div class="pf-card"><p class="pf-muted">' + esc(errorText(code)) + '</p></div>';
    }).catch(function () {
      root.innerHTML = '<div class="pf-card"><p class="pf-muted">' + T('Connection error. Please try again.', 'Error de conexión. Inténtalo de nuevo.') + '</p></div>';
    });
  }
  function normalize(d) {
    var byNum = {};
    (d.passengers || []).forEach(function (p) { byNum[p.passenger_number] = p; });
    return { editable: d.editable !== false, guests: (d.booking && d.booking.guests) || 0, booking: d.booking || {}, form: d.form || {}, lodging: d.lodging || null, byNum: byNum, status: d.status };
  }

  /* ---------------- render ---------------- */
  function selOpts(opts, cur) {
    return opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(cur) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  function field(id, label, value, type, ph) {
    return '<div class="pf-field"><label>' + esc(label) + '</label><input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(value == null ? '' : value) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '></div>';
  }
  function textarea(id, label, value, ph) {
    return '<div class="pf-field"><label>' + esc(label) + '</label><textarea id="' + id + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>' + esc(value == null ? '' : value) + '</textarea></div>';
  }
  function select(id, label, opts, cur) {
    return '<div class="pf-field"><label>' + esc(label) + '</label><select id="' + id + '">' + selOpts(opts, cur) + '</select></div>';
  }

  function passengerBlock(n) {
    var p = STATE.byNum[n] || {};
    var docHint = p.has_document ? (T('Saved: ', 'Guardado: ') + (p.document_hint || '••••') + T(' — leave blank to keep', ' — deja en blanco para conservar')) : '';
    return '<div class="pf-pax">'
      + '<div class="pf-pax-h">' + T('Passenger ', 'Pasajero ') + n + '</div>'
      + '<div class="pf-row">'
      + field('p' + n + '_fn', T('Legal first name', 'Nombre(s) legal'), p.legal_first_name)
      + field('p' + n + '_ln', T('Legal last name', 'Apellido(s) legal'), p.legal_last_name)
      + '</div>'
      + '<div class="pf-row">'
      + field('p' + n + '_mn', T('Middle name (optional)', 'Segundo nombre (opcional)'), p.legal_middle_name)
      + field('p' + n + '_dob', T('Date of birth', 'Fecha de nacimiento'), p.date_of_birth, 'date')
      + '</div>'
      + '<div class="pf-row">'
      + field('p' + n + '_nat', T('Nationality', 'Nacionalidad'), p.nationality)
      + select('p' + n + '_gen', T('Gender (if required by airline)', 'Género (si la aerolínea lo exige)'),
          [['', '—'], ['female', T('Female', 'Femenino')], ['male', T('Male', 'Masculino')], ['x', 'X'], ['undisclosed', T('Prefer not to say', 'Prefiero no decir')]], p.gender)
      + '</div>'
      + '<div class="pf-row">'
      + select('p' + n + '_dt', T('Document type', 'Tipo de documento'),
          [['', '—'], ['passport', T('Passport', 'Pasaporte')], ['national_id', T('National ID', 'Cédula / ID')], ['other', T('Other', 'Otro')]], p.document_type)
      + field('p' + n + '_dn', T('Document number', 'Número de documento'), '', 'text', p.has_document ? '••••' : '')
      + '</div>'
      + (docHint ? '<div class="pf-hint">' + esc(docHint) + '</div>' : '')
      + '<div class="pf-row">'
      + field('p' + n + '_de', T('Document expiration', 'Expiración del documento'), p.document_expiration_date, 'date')
      + field('p' + n + '_ic', T('Issuing country', 'País emisor'), p.issuing_country)
      + '</div>'
      + field('p' + n + '_sa', T('Special assistance (optional)', 'Asistencia especial (opcional)'), p.special_assistance)
      + field('p' + n + '_dr', T('Dietary requirements (optional)', 'Requisitos alimentarios (opcional)'), p.dietary_requirements)
      + textarea('p' + n + '_am', T('Accessibility or mobility needs (optional)', 'Necesidades de accesibilidad o movilidad (opcional)'), p.accessibility_or_mobility_needs)
      + '<div class="pf-hint">' + T('Do not include diagnoses or medical histories. Only describe the operational assistance required during the trip.', 'No incluya diagnósticos ni historiales médicos. Indique únicamente la asistencia operativa requerida durante el viaje.') + '</div>'
      + field('p' + n + '_bg', T('Baggage notes (optional)', 'Notas de equipaje (opcional)'), p.baggage_notes)
      + '</div>';
  }

  function render() {
    var b = STATE.booking, f = STATE.form, lo = STATE.lodging || {};
    var ro = !STATE.editable;
    var paxHtml = '';
    for (var n = 1; n <= STATE.guests; n++) paxHtml += passengerBlock(n);

    var flightsCur = (f.international_flights_purchased === true) ? 'yes' : (f.international_flights_purchased === false ? 'no' : '');
    var budgetDollars = (lo.approximate_budget_cents != null) ? Math.round(lo.approximate_budget_cents / 100) : '';

    var html = ''
      + '<div class="pf-card">'
      + '<h1 class="pf-h">' + T('Passenger details', 'Datos de los pasajeros') + '</h1>'
      + '<p class="pf-sub">' + T('Please complete the details for every traveler so we can start preparing your flights and, when needed, your connection hotel.', 'Completa los datos de cada viajero para comenzar a preparar tus vuelos y, cuando sea necesario, tu hotel de conexión.') + '</p>'
      + '<div class="pf-recap">'
      + '<div><span>' + T('Booking', 'Reserva') + '</span><b>' + esc(b.booking_code) + '</b></div>'
      + '<div><span>' + T('Tour', 'Tour') + '</span><b>' + esc(b.tour_name) + '</b></div>'
      + '<div><span>' + T('Date', 'Fecha') + '</span><b>' + esc(b.booking_date) + '</b></div>'
      + '<div><span>Pax</span><b>' + esc(b.guests) + '</b></div>'
      + '<div><span>' + T('Contact', 'Contacto') + '</span><b>' + esc(b.customer_name) + '</b></div>'
      + '</div>'
      + (ro ? '<div class="pf-ro">' + T('This form has been submitted and is now read-only. We will contact you if anything else is needed.', 'Este formulario fue enviado y ahora es de solo lectura. Te contactaremos si se necesita algo más.') + '</div>' : '')
      + (f.changes_requested_note ? '<div class="pf-ro"><b>' + T('Requested changes: ', 'Cambios solicitados: ') + '</b>' + esc(f.changes_requested_note) + '</div>' : '')
      + '</div>'

      + '<div class="pf-msg" id="pfMsg"></div>'

      // Datos generales del viaje
      + '<div class="pf-card">'
      + '<div class="pf-sec-h">' + T('Your trip', 'Tu viaje') + '</div>'
      + '<p class="pf-note">' + T('We request this information to begin preparing flight options to San Cristóbal and, when needed, accommodation in your connecting city.', 'Solicitamos esta información para comenzar a preparar opciones de vuelos hacia San Cristóbal y, cuando sea necesario, alojamiento en la ciudad de conexión.') + '</p>'
      + select('f_city', T('Which city would you prefer to continue your trip to Galápagos from?', '¿Desde qué ciudad prefiere continuar su viaje hacia Galápagos?'),
          [['', '—'], ['quito', 'Quito'], ['guayaquil', 'Guayaquil'], ['either', T('Either city', 'Cualquiera de las dos')]], f.preferred_connection_city)
      + '<div class="pf-row">'
      + select('f_intl', T('Have you already bought international flights?', '¿Ya compró vuelos internacionales?'), [['', '—'], ['yes', T('Yes', 'Sí')], ['no', 'No']], flightsCur)
      + field('f_arr_date', T('Arrival date in Ecuador', 'Fecha de llegada a Ecuador'), f.ecuador_arrival_date, 'date')
      + '</div>'
      + '<div class="pf-row">'
      + field('f_arr_time', T('Approx. arrival time', 'Hora aproximada de llegada'), f.ecuador_arrival_time, 'text', T('e.g. 14:30 / afternoon', 'ej. 14:30 / tarde'))
      + field('f_airport', T('Arrival airport', 'Aeropuerto de llegada'), f.arrival_airport, 'text', T('e.g. Quito (UIO)', 'ej. Quito (UIO)'))
      + '</div>'
      + textarea('f_notes', T('Connection notes (optional)', 'Observaciones de conexión (opcional)'), f.connection_notes)
      + '</div>'

      // Hotel de conexión
      + '<div class="pf-card">'
      + '<div class="pf-sec-h">' + T('Connection hotel (optional)', 'Hotel de conexión (opcional)') + '</div>'
      + '<p class="pf-note">' + T('If you need a hotel in your connection city before flying to Galápagos, tell us here. We will prepare options for you.', 'Si necesitas un hotel en tu ciudad de conexión antes de volar a Galápagos, indícanoslo aquí. Prepararemos opciones para ti.') + '</p>'
      + '<label class="pf-check"><input type="checkbox" id="l_needs"' + (lo.needs_hotel ? ' checked' : '') + '><span>' + T('I need a hotel in my connection city', 'Necesito un hotel en mi ciudad de conexión') + '</span></label>'
      + '<div class="pf-row">'
      + field('l_nights', T('Nights', 'Noches'), lo.nights, 'number')
      + field('l_rooms', T('Rooms', 'Habitaciones'), lo.rooms_required, 'number')
      + '</div>'
      + '<div class="pf-row">'
      + field('l_guests', T('Guests', 'Huéspedes'), lo.guest_count, 'number')
      + field('l_budget', T('Approx. budget per night (USD, optional)', 'Presupuesto aprox. por noche (USD, opcional)'), budgetDollars, 'number')
      + '</div>'
      + field('l_rp', T('Room preferences (optional)', 'Preferencias de habitación (opcional)'), lo.room_preferences)
      + field('l_an', T('Accessibility notes (optional)', 'Notas de accesibilidad (opcional)'), lo.accessibility_notes)
      + '</div>'

      // Pasajeros
      + '<div class="pf-card">'
      + '<div class="pf-sec-h">' + T('Passengers', 'Pasajeros') + ' (' + STATE.guests + ')</div>'
      + paxHtml
      + '</div>';

    if (!ro) {
      html += '<div class="pf-actions">'
        + '<button class="btn btn-ink" id="pfSave" type="button">' + T('Save draft', 'Guardar borrador') + '</button>'
        + '<button class="btn btn-gold" id="pfSubmit" type="button">' + T('Submit all passengers', 'Enviar todos los pasajeros') + '</button>'
        + '</div>';
    }
    root.innerHTML = html;

    if (!ro) {
      document.getElementById('pfSave').addEventListener('click', function () { save(false); });
      document.getElementById('pfSubmit').addEventListener('click', function () { save(true); });
    }
  }

  /* ---------------- envío ---------------- */
  function gatherPassengers() {
    var out = [];
    for (var n = 1; n <= STATE.guests; n++) {
      var p = { passenger_number: n };
      p.legal_first_name = val('p' + n + '_fn');
      p.legal_middle_name = val('p' + n + '_mn') || null;
      p.legal_last_name = val('p' + n + '_ln');
      p.date_of_birth = val('p' + n + '_dob') || null;
      p.nationality = val('p' + n + '_nat') || null;
      p.gender = val('p' + n + '_gen') || null;
      p.document_type = val('p' + n + '_dt') || null;
      var dn = val('p' + n + '_dn');
      if (dn && dn.trim() !== '') p.document_number = dn.trim();   // vacío → conservar el guardado
      p.document_expiration_date = val('p' + n + '_de') || null;
      p.issuing_country = val('p' + n + '_ic') || null;
      p.special_assistance = val('p' + n + '_sa') || null;
      p.dietary_requirements = val('p' + n + '_dr') || null;
      p.accessibility_or_mobility_needs = val('p' + n + '_am') || null;
      p.baggage_notes = val('p' + n + '_bg') || null;
      out.push(p);
    }
    return out;
  }
  function gatherForm() {
    var intl = val('f_intl');
    return {
      preferred_connection_city: val('f_city') || null,
      international_flights_purchased: intl === 'yes' ? true : (intl === 'no' ? false : null),
      ecuador_arrival_date: val('f_arr_date') || null,
      ecuador_arrival_time: val('f_arr_time') || null,
      arrival_airport: val('f_airport') || null,
      connection_notes: val('f_notes') || null
    };
  }
  function gatherLodging() {
    var budget = num('l_budget');
    return {
      needs_hotel: checked('l_needs'),
      nights: num('l_nights'),
      rooms_required: num('l_rooms'),
      guest_count: num('l_guests'),
      approximate_budget_cents: budget != null ? budget * 100 : null,
      room_preferences: val('l_rp') || null,
      accessibility_notes: val('l_an') || null
    };
  }

  function save(isSubmit) {
    var saveBtn = document.getElementById('pfSave'), subBtn = document.getElementById('pfSubmit');
    if (saveBtn) saveBtn.disabled = true; if (subBtn) subBtn.disabled = true;
    var payload = { form: gatherForm(), passengers: gatherPassengers(), lodging: gatherLodging() };
    api(isSubmit ? 'submit' : 'save-draft', payload).then(function (r) {
      if (saveBtn) saveBtn.disabled = false; if (subBtn) subBtn.disabled = false;
      if (r.ok && r.data && (r.data.submitted || r.data.saved)) {
        if (r.data.submitted) { renderThankYou(); return; }
        msg('ok', T('Draft saved. You can return to this link anytime.', 'Borrador guardado. Puedes volver a este enlace cuando quieras.'));
        return;
      }
      msg('err', errorText(r.data && r.data.error));
    }).catch(function () {
      if (saveBtn) saveBtn.disabled = false; if (subBtn) subBtn.disabled = false;
      msg('err', T('Connection error. Please try again.', 'Error de conexión. Inténtalo de nuevo.'));
    });
  }

  function renderThankYou() {
    root.innerHTML = '<div class="pf-card">'
      + '<h1 class="pf-h">' + T('Thank you', 'Gracias') + '</h1>'
      + '<p class="pf-sub">' + T('Thank you. We received the information for all passengers. Our team will begin preparing flight and accommodation options.', 'Gracias. Recibimos la información de todos los pasajeros. Nuestro equipo comenzará a preparar las opciones de vuelos y alojamiento.') + '</p>'
      + '</div>';
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
  }

  boot();
})();
