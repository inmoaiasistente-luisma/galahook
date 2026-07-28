'use strict';

/* =========================================================
   Hook Adventure — cifrado de datos sensibles de pasajeros
   ---------------------------------------------------------
   SERVER-ONLY. Cifra el numero de documento con AES-256-GCM
   (cifrado autenticado). El numero NUNCA se guarda en claro.

   KEYRING por variables de entorno:
     PASSENGER_DATA_ENCRYPTION_ACTIVE_KEY_ID  -> id de la clave activa
     PASSENGER_DATA_ENCRYPTION_KEYS_JSON      -> { "k1": "<base64 32B>", ... }

   · Se cifra SIEMPRE con la clave activa.
   · Se descifra con la clave indicada por document_number_key_id.
   · AAD (datos adicionales autenticados) = tenant_id | passenger_form_id |
     passenger_number | document_type. Si el ciphertext se mueve a otro
     pasajero, formulario o tenant, el descifrado FALLA (GCM lo detecta).
   · Rotacion: para retirar una clave vieja, re-cifrar sus filas con la
     clave activa (decrypt con key_id viejo -> encrypt con el activo) y
     luego eliminarla del keyring. Ver docs/passenger-data-encryption.md.

   NUNCA se registran en logs: numero, ciphertext, iv, tag ni claves.
   ========================================================= */

const crypto = require('crypto');

/** Carga y valida el keyring. No memoiza (para respetar rotaciones/tests). */
function loadKeyring() {
  const activeId = process.env.PASSENGER_DATA_ENCRYPTION_ACTIVE_KEY_ID;
  const json = process.env.PASSENGER_DATA_ENCRYPTION_KEYS_JSON;
  if (!activeId) throw new Error('PASSENGER_DATA_ENCRYPTION_ACTIVE_KEY_ID no está configurada');
  if (!json) throw new Error('PASSENGER_DATA_ENCRYPTION_KEYS_JSON no está configurada');

  let map;
  try { map = JSON.parse(json); }
  catch (e) { throw new Error('PASSENGER_DATA_ENCRYPTION_KEYS_JSON no es JSON válido'); }
  if (!map || typeof map !== 'object' || Array.isArray(map)) throw new Error('keyring inválido');

  const keys = {};
  for (const id of Object.keys(map)) {
    let buf;
    try { buf = Buffer.from(String(map[id]), 'base64'); }
    catch (e) { throw new Error('clave del keyring no es base64: ' + id); }
    if (buf.length !== 32) throw new Error('clave del keyring debe ser de 32 bytes: ' + id);
    keys[id] = buf;
  }
  if (!keys[activeId]) throw new Error('la clave activa no existe en el keyring');
  return { activeId: activeId, keys: keys };
}

/** true si el keyring está bien configurado (para health checks / rotate). */
function keyringConfigured() {
  try { loadKeyring(); return true; }
  catch (e) { return false; }
}

/* AAD determinista: liga el ciphertext a la identidad del pasajero. */
function buildAad(parts) {
  parts = parts || {};
  return Buffer.from([
    String(parts.tenant_id == null ? '' : parts.tenant_id),
    String(parts.passenger_form_id == null ? '' : parts.passenger_form_id),
    String(parts.passenger_number == null ? '' : parts.passenger_number),
    String(parts.document_type == null ? '' : parts.document_type)
  ].join('|'), 'utf8');
}

function computeLast4(value) {
  return String(value == null ? '' : value).replace(/[^0-9A-Za-z]/g, '').slice(-4);
}

/**
 * Cifra un numero de documento.
 * @returns {null|{ciphertext,iv,authTag,last4,keyId}} (todo base64) o null si vacío.
 */
function encryptDocumentNumber(plaintext, aadParts) {
  const value = String(plaintext == null ? '' : plaintext).trim();
  if (!value) return null;

  const ring = loadKeyring();
  const key = ring.keys[ring.activeId];
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(buildAad(aadParts));
  const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    authTag: tag.toString('base64'),
    last4: computeLast4(value),
    keyId: ring.activeId
  };
}

/**
 * Descifra. Lanza si falta la clave o si la verificación GCM/AAD falla
 * (ciphertext manipulado o movido a otro pasajero/formulario/tenant).
 * @returns {string} numero en claro
 */
function decryptDocumentNumber(row, aadParts) {
  if (!row || !row.document_number_ciphertext) return null;
  const ring = loadKeyring();
  const keyId = row.document_number_key_id;
  const key = keyId && ring.keys[keyId];
  if (!key) throw new Error('clave de cifrado no disponible para el key_id almacenado');

  const iv = Buffer.from(String(row.document_number_iv || ''), 'base64');
  const tag = Buffer.from(String(row.document_number_auth_tag || ''), 'base64');
  const ct = Buffer.from(String(row.document_number_ciphertext || ''), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(buildAad(aadParts));
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]); // lanza si no autentica
  return pt.toString('utf8');
}

/** Valor enmascarado para staff cuando sea necesario: "****1234". */
function maskDocument(last4) {
  const s = String(last4 == null ? '' : last4).replace(/[^0-9A-Za-z]/g, '').slice(-4);
  return s ? ('****' + s) : '';
}

module.exports = {
  loadKeyring, keyringConfigured,
  encryptDocumentNumber, decryptDocumentNumber,
  computeLast4, maskDocument
};
