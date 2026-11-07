'use strict';

/* =========================================================
   Reseñas por QR — reglas compartidas
   ---------------------------------------------------------
   Validación de lo que llega del navegador y de lo que puede salir
   hacia el sitio público. Sin acceso a base de datos.
   ========================================================= */

const crypto = require('crypto');
const { isUuid } = require('./http');

/* Cambiar esta versión cuando cambie el aviso de publicación de /resena. */
const CONSENT_VERSION = '2026-11-reviews-v1';

const LANGS = ['en', 'es'];
const STATUSES = ['pending', 'published', 'rejected'];
const TRIPS = ['day_tour', 'sport_fishing', 'all_inclusive', 'diving', 'private_trip'];
const REJECT_REASONS = ['spam', 'abuse', 'third_party_data', 'not_passenger'];

const NAME_MIN = 2;
const NAME_MAX = 80;
const BODY_MAX = 1000;
const PUBLIC_LIMIT = 4;

const PUBLIC_FIELDS = 'rating,body,author_name,lang,trip,created_at';

/* Quita caracteres de control (conserva salto de línea y tabulador). */
function cleanText(v) {
  return String(v).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim();
}

/** @returns {{ok:true,row:object}|{ok:false,code:string,message:string}} */
function validateSubmission(body) {
  const fail = function (code, message) { return { ok: false, code: code, message: message }; };

  if (!isUuid(body.client_key)) return fail('INVALID_KEY', 'Invalid review key');
  if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) return fail('INVALID_RATING', 'Rating must be 1 to 5');

  const name = typeof body.name === 'string' ? cleanText(body.name) : '';
  if (name.length < NAME_MIN || name.length > NAME_MAX) return fail('INVALID_NAME', 'Name is required');

  if (body.text !== undefined && body.text !== null && typeof body.text !== 'string') return fail('INVALID_TEXT', 'Invalid review text');
  const text = typeof body.text === 'string' ? cleanText(body.text) : '';
  if (text.length > BODY_MAX) return fail('TEXT_TOO_LONG', 'Review text is too long');

  if (LANGS.indexOf(body.lang) === -1) return fail('INVALID_LANG', 'Invalid language');

  return {
    ok: true,
    row: {
      client_key: body.client_key,
      rating: body.rating,
      body: text || null,
      author_name: name,
      lang: body.lang,
      opened_google: body.opened_google === true,
      consent_version: CONSENT_VERSION,
      status: 'pending'
    }
  };
}

/* Lista blanca de lo que ve el público: sin id, estado, moderador ni clave. */
function toPublicReview(row) {
  return {
    rating: row.rating,
    body: row.body,
    author_name: row.author_name,
    lang: row.lang,
    trip: row.trip || null,
    month: String(row.created_at || '').slice(0, 7)
  };
}

/* Clave del limitador: hash de la IP, nunca en claro. */
function rateBucket(ip) {
  const h = crypto.createHash('sha256').update('reviews:' + String(ip || '')).digest('hex');
  return 'reviews:' + h.slice(0, 40);
}

/* ¿El error indica que la migración 0026 aún no está aplicada? */
function isMissingTable(err) {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  const m = String(err.message || '').toLowerCase();
  return m.indexOf('does not exist') !== -1 || m.indexOf('schema cache') !== -1;
}

module.exports = {
  CONSENT_VERSION, LANGS, STATUSES, TRIPS, REJECT_REASONS, PUBLIC_LIMIT, PUBLIC_FIELDS,
  cleanText, validateSubmission, toPublicReview, rateBucket, isMissingTable
};
