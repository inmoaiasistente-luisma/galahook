'use strict';

/* =========================================================
   Fase 9 — Recordatorios automáticos pre-viaje
   ---------------------------------------------------------
   Cadencia definida por el owner: se empieza 7 días antes de la fecha de
   inicio del viaje y se envía cada 2 días, indicando SIEMPRE cuántos días
   faltan. El día del viaje el mensaje cambia de tono.

       7 días → 5 días → 3 días → 1 día → día 0

   Idempotencia: cada etapa tiene su propio notification_type
   ('pretrip_reminder_d7'…'_d0') y email_notifications ya tiene
   unique(booking_id, notification_type, recipient_email). Es decir, la
   base de datos garantiza que una etapa NO se envía dos veces, aunque el
   cron corra varias veces al día o se reintente.

   Este módulo es PURO: no consulta la base ni envía correos. Solo decide
   QUÉ corresponde enviar y CON QUÉ TEXTO, para poder probarlo sin red.
   ========================================================= */

/* Etapas, en orden descendente de días restantes. */
const REMINDER_DAYS = [7, 5, 3, 1, 0];

/* Ventana que el cron necesita consultar: de hoy a hoy+7. */
const WINDOW_DAYS = 7;

/** 'pretrip_reminder_d5' para 5 días. null si ese día no toca recordatorio. */
function typeForDays(days) {
  return REMINDER_DAYS.indexOf(days) === -1 ? null : 'pretrip_reminder_d' + days;
}

/** Todos los tipos de recordatorio (para validaciones y consultas). */
function allTypes() { return REMINDER_DAYS.map(function (d) { return 'pretrip_reminder_d' + d; }); }

/* --------- aritmética de fechas: UTC puro, sin husos ni horarios --------- */
function isYmd(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function toUtc(ymd) {
  const p = String(ymd).split('-');
  return Date.UTC(+p[0], +p[1] - 1, +p[2]);
}
/** Días enteros entre hoy y la fecha del viaje. Negativo = ya pasó. */
function daysUntil(todayYmd, tripYmd) {
  if (!isYmd(todayYmd) || !isYmd(tripYmd)) return null;
  return Math.round((toUtc(tripYmd) - toUtc(todayYmd)) / 86400000);
}
/** Desplaza una fecha YYYY-MM-DD un número de días. */
function shiftYmd(ymd, days) {
  const d = new Date(toUtc(ymd));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** Rango [desde, hasta] que el barrido diario debe consultar. */
function windowBounds(todayYmd) { return [todayYmd, shiftYmd(todayYmd, WINDOW_DAYS)]; }

/* ---------------------------- textos ----------------------------------
   El owner fijó las frases exactas en español. El inglés acompaña porque
   todos los correos del sitio son bilingües. */
function copyFor(days) {
  if (days === 0) {
    return {
      es: 'Tu aventura en Galápagos empieza hoy.',
      en: 'Your Galápagos adventure starts today.',
      subjectEs: 'Tu aventura en Galápagos empieza hoy',
      subjectEn: 'Your Galápagos adventure starts today'
    };
  }
  const unoEs = days === 1 ? 'Falta 1 día' : 'Faltan ' + days + ' días';
  const unoEn = days === 1 ? '1 day to go' : days + ' days to go';
  return {
    es: unoEs + ' para tu aventura en Galápagos.',
    en: unoEn + ' until your Galápagos adventure.',
    subjectEs: unoEs + ' para tu aventura en Galápagos',
    subjectEn: unoEn + ' until your Galápagos adventure'
  };
}

/* ------------------------- elegibilidad -------------------------------
   Solo se recuerda lo que de verdad va a viajar: una reserva real (no
   cotización), no cancelada, no borrada, no de prueba, con correo y con
   los recordatorios activos. */
function eligibility(booking) {
  const b = booking || {};
  if (!b.id) return { eligible: false, reason: 'no_booking' };
  if (b.request_type && b.request_type !== 'booking') return { eligible: false, reason: 'not_a_booking' };
  if (b.deleted_at) return { eligible: false, reason: 'deleted' };
  if (b.is_test === true) return { eligible: false, reason: 'test_data' };
  if (b.booking_status === 'cancelled' || b.booking_status === 'failed') return { eligible: false, reason: 'cancelled' };
  if (b.reminders_paused === true) return { eligible: false, reason: 'paused' };
  if (!b.customer_email) return { eligible: false, reason: 'no_recipient' };
  if (!isYmd(b.booking_date)) return { eligible: false, reason: 'no_date' };
  return { eligible: true, reason: null };
}

/**
 * ¿Le toca recordatorio HOY a esta reserva?
 * @returns {{due:boolean, days:number|null, type:string|null, reason:string|null}}
 */
function dueFor(booking, todayYmd) {
  const el = eligibility(booking);
  if (!el.eligible) return { due: false, days: null, type: null, reason: el.reason };

  const days = daysUntil(todayYmd, booking.booking_date);
  if (days == null) return { due: false, days: null, type: null, reason: 'no_date' };
  if (days < 0) return { due: false, days: days, type: null, reason: 'past_trip' };

  const type = typeForDays(days);
  if (!type) return { due: false, days: days, type: null, reason: 'not_a_reminder_day' };
  return { due: true, days: days, type: type, reason: null };
}

/** Filtra una lista de reservas y devuelve solo las que deben recibir correo hoy. */
function dueList(bookings, todayYmd) {
  const out = [];
  (bookings || []).forEach(function (b) {
    const d = dueFor(b, todayYmd);
    if (d.due) out.push({ booking: b, days: d.days, type: d.type });
  });
  return out;
}

/* --------------------- datos útiles del viaje -------------------------
   Se incluye lo que EXISTA; nunca se inventa un dato. Lo que falta
   sencillamente no aparece en el correo. */
function tripFacts(booking, extra) {
  const b = booking || {}, x = extra || {};
  const facts = [];
  function add(labelEs, labelEn, value) {
    if (value == null || value === '') return;
    facts.push({ es: labelEs, en: labelEn, value: String(value) });
  }
  add('Código', 'Booking code', b.booking_code);
  add('Programa', 'Program', b.tour_name);
  add('Fecha de inicio', 'Start date', b.booking_date);
  add('Viajeros', 'Guests', b.guests);
  add('Vuelos', 'Flights', x.flights);
  add('Hotel', 'Hotel', x.hotel);
  add('Punto de encuentro', 'Meeting point', x.meetingPoint);
  add('Horario', 'Schedule', x.schedule);
  add('Contacto', 'Contact', x.contact);
  add('Documentos', 'Documents', x.documents);
  return facts;
}

module.exports = {
  REMINDER_DAYS, WINDOW_DAYS,
  typeForDays, allTypes, isYmd, daysUntil, shiftYmd, windowBounds,
  copyFor, eligibility, dueFor, dueList, tripFacts
};
