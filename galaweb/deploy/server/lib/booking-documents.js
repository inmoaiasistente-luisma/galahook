'use strict';

/* =========================================================
   Fase 9 — Documentos de reserva: validación y rutas (PURO)
   ---------------------------------------------------------
   SERVER-ONLY, sin red: valida la subida (extensión, MIME, tamaño, nombre),
   sanea el nombre de archivo y construye la ruta de Storage. Se puede probar
   sin base ni Storage.

   Almacenamiento: bucket PRIVADO `booking-documents`. Ruta por
   tenant/booking/document/filename para que dos reservas nunca colisionen y
   se pueda razonar sobre el árbol de un vistazo.
   ========================================================= */

const BUCKET = 'booking-documents';

/* Categorías (coinciden con chk_bdoc_type de 0019). */
const DOC_TYPES = ['air_ticket', 'hotel_voucher', 'itinerary', 'instructions',
  'insurance', 'receipt', 'other'];

/* El staff nunca ve documentos con dinero. */
const STAFF_HIDDEN_DOCS = ['receipt'];

/* Extensión → MIME(s) aceptados. La verdad de tipos permitidos está aquí y,
   duplicada como defensa, en allowed_mime_types del bucket (migración 0020). */
const ALLOWED = {
  jpg:  ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png:  ['image/png'],
  webp: ['image/webp'],
  pdf:  ['application/pdf'],
  doc:  ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']
};
const ALLOWED_EXT = Object.keys(ALLOWED);

/* Límite de tamaño configurable (por defecto 15 MiB). Debe coincidir con el
   file_size_limit del bucket. */
function maxBytes() {
  const n = Number(process.env.DOCUMENT_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 15 * 1024 * 1024;
}

function extOf(name) {
  const s = String(name || '');
  const dot = s.lastIndexOf('.');
  return dot > 0 ? s.slice(dot + 1).toLowerCase() : '';
}

/* Nombre seguro: sin rutas, sin caracteres raros, longitud acotada, con
   extensión preservada. "../../etc/passwd" → "etc_passwd" (sin subir de
   directorio). Nunca queda vacío. */
function sanitizeFilename(name) {
  let s = String(name == null ? '' : name);
  s = s.replace(/\\/g, '/');
  s = s.slice(s.lastIndexOf('/') + 1);        // quita cualquier ruta
  s = s.normalize('NFKD').replace(/[^\w.\- ]+/g, '_');  // solo seguros
  s = s.replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^[_.]+/, '');
  if (!s) s = 'archivo';
  if (s.length > 120) {
    const e = extOf(s);
    s = s.slice(0, 100) + (e ? '.' + e : '');
  }
  return s;
}

function mimeMatchesExt(ext, mime) {
  const list = ALLOWED[ext];
  return !!list && list.indexOf(String(mime || '').toLowerCase()) !== -1;
}

/**
 * Valida una subida propuesta. PURA.
 * @param {object} o { filename, mime_type, file_size }
 * @returns {{ok:true, meta:{ext,filename,mime_type,file_size}} | {ok:false, code}}
 */
function validateUpload(o) {
  o = o || {};
  const filename = sanitizeFilename(o.filename);
  const ext = extOf(filename);
  if (ALLOWED_EXT.indexOf(ext) === -1) return { ok: false, code: 'BAD_EXTENSION' };

  const mime = String(o.mime_type || '').toLowerCase();
  if (!mime || !mimeMatchesExt(ext, mime)) return { ok: false, code: 'BAD_MIME' };

  const size = Number(o.file_size);
  if (!Number.isFinite(size) || size <= 0) return { ok: false, code: 'BAD_SIZE' };
  if (size > maxBytes()) return { ok: false, code: 'FILE_TOO_LARGE' };

  return { ok: true, meta: { ext: ext, filename: filename, mime_type: mime, file_size: Math.floor(size) } };
}

/* Ruta de Storage: tenant/booking/document/filename. Los ids ya son seguros
   (uuid); el filename viene saneado. */
function buildStoragePath(tenantId, bookingId, documentId, filename) {
  return [String(tenantId), String(bookingId), String(documentId), sanitizeFilename(filename)].join('/');
}

module.exports = {
  BUCKET, DOC_TYPES, STAFF_HIDDEN_DOCS, ALLOWED, ALLOWED_EXT,
  maxBytes, extOf, sanitizeFilename, mimeMatchesExt, validateUpload, buildStoragePath
};
