'use strict';

/* =========================================================
   Política del depósito del 30 % — módulo puro.
   ---------------------------------------------------------
   Reglas de elegibilidad, importes, fechas congeladas, acción
   del barrido diario y token del enlace de saldo. Sin red ni DB:
   recibe "hoy" (YYYY-MM-DD, Galápagos) como parámetro.

   Token de saldo:
     payloadB64 = base64url(bookingId)
     signature  = base64url( HMAC_SHA256('balance:' + payloadB64, QR_SIGNING_SECRET) )
     token      = payloadB64 + "." + signature
     url        = PUBLIC_SITE_URL + "/saldo#t=" + token
   El prefijo 'balance:' separa el dominio del token del QR de check-in.
   El token no contiene nombre, correo ni importes.
   ========================================================= */

const crypto = require('crypto');
const { daysUntil, shiftYmd } = require('./pretrip-reminders');

const DEPOSIT_PCT = 30;
const MIN_DAYS_AHEAD = 30;                 // se exige > 30 días de anticipación
const DEPOSIT_TERMS_VERSION = '2026-11-26';

/* ---------------- elegibilidad ---------------- */
function isDepositEligible(tour, bookingDate, todayYmd) {
  if (!tour || tour.requiresQuote) return { eligible: false, reason: 'quote_only' };
  if (tour.priceCents == null) return { eligible: false, reason: 'no_price' };
  const days = daysUntil(todayYmd, bookingDate);
  if (days == null) return { eligible: false, reason: 'bad_date' };
  if (days <= MIN_DAYS_AHEAD) return { eligible: false, reason: 'too_close' };
  return { eligible: true, reason: null };
}

/* ---------------- importes ---------------- */
function splitAmounts(totalCents) {
  const depositCents = Math.round(totalCents * DEPOSIT_PCT / 100);
  return { depositCents: depositCents, balanceCents: totalCents - depositCents };
}

/* ---------------- fechas congeladas al reservar ---------------- */
function depositDates(bookingDate) {
  return {
    balanceDueDate: shiftYmd(bookingDate, -6),            // último día para pagar el saldo
    depositRefundableUntil: shiftYmd(bookingDate, -31),
    balanceRefundableUntil: shiftYmd(bookingDate, -16)
  };
}

/* ---------------- barrido diario ----------------
   Ignora reminders_paused a propósito: la pausa de recordatorios
   pre-viaje no frena el cobro del saldo. */
function sweepAction(booking, todayYmd, opts) {
  const includeTest = !!(opts && opts.includeTest);
  const none = { action: null, days: null };
  const b = booking || {};
  if (b.payment_plan !== 'deposit' || b.payment_status !== 'deposit_paid' || b.booking_status !== 'confirmed') return none;
  if (b.deleted_at) return none;
  if (b.auto_cancelled_at) return none;                   // ya autocancelada: nunca se vuelve a barrer
  if (b.request_type && b.request_type !== 'booking') return none;
  if (b.is_test === true && !includeTest) return none;
  const days = daysUntil(todayYmd, b.booking_date);
  if (days == null) return none;
  if (days > 7) return { action: null, days: days };
  if (days === 7) return { action: 'remind_d7', days: days };
  if (days === 6) return { action: 'remind_d6', days: days };
  return { action: 'cancel', days: days };                // <= 5, incluye catch-up (negativos)
}

/* ---------------- token del enlace de saldo ---------------- */
function getSecret() {
  const s = process.env.QR_SIGNING_SECRET;
  if (!s) throw new Error('QR_SIGNING_SECRET no está configurada');
  return s;
}
function getPublicSiteUrl() {
  const u = process.env.PUBLIC_SITE_URL;
  if (!u) throw new Error('PUBLIC_SITE_URL no está configurada');
  return String(u).replace(/\/+$/, '');
}
function mac(payloadB64) {
  return crypto.createHmac('sha256', getSecret()).update('balance:' + payloadB64).digest();
}

function signBalanceToken(bookingId) {
  const payload = Buffer.from(String(bookingId)).toString('base64url');
  return payload + '.' + mac(payload).toString('base64url');
}

/** Verifica firma y formato. NO consulta la base de datos. @returns {string|null} bookingId */
function verifyBalanceToken(token) {
  try {
    if (typeof token !== 'string' || token.length < 8 || token.length > 512) return null;
    const dot = token.indexOf('.');
    if (dot < 1 || dot !== token.lastIndexOf('.')) return null;
    const payload = token.slice(0, dot);
    const sigB64 = token.slice(dot + 1);
    const provided = Buffer.from(sigB64, 'base64url');
    const expected = mac(payload);
    if (provided.toString('base64url') !== sigB64) return null;   // sin variantes no canónicas
    if (provided.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(provided, expected)) return null;
    const id = Buffer.from(payload, 'base64url').toString('utf8');
    return id || null;
  } catch (e) { return null; }
}

function balanceUrl(bookingId) {
  return getPublicSiteUrl() + '/saldo#t=' + signBalanceToken(bookingId);
}

module.exports = {
  DEPOSIT_PCT, MIN_DAYS_AHEAD, DEPOSIT_TERMS_VERSION,
  isDepositEligible, splitAmounts, depositDates, sweepAction,
  signBalanceToken, verifyBalanceToken, balanceUrl
};
