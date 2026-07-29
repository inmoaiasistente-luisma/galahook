'use strict';

/* =========================================================
   Milu Turismo — allowlist de hosts de compra/reserva
   ---------------------------------------------------------
   SERVER-ONLY. Todo purchase_url / booking_url que Milu guarde debe
   apuntar a un proveedor permitido. Un enlace fuera de esta lista se
   RECHAZA (no se guarda). Estos enlaces son INTERNOS: los usa el
   equipo de Hook Adventure para comprar/reservar; nunca se envían al
   cliente. Coincidencia por host EXACTO (los subdominios no listados
   se rechazan, por seguridad).
   ========================================================= */

const ALLOWED_HOSTS = [
  // Aerolíneas
  'latamairlines.com', 'www.latamairlines.com',
  'avianca.com', 'www.avianca.com',
  // Cadenas / OTAs de listado oficial
  'ihg.com', 'www.ihg.com',
  'booking.com', 'www.booking.com',
  'airbnb.com', 'www.airbnb.com',
  // Sitios oficiales de hoteles preferidos (placeholder configurable)
  'hotelmiconia.com', 'www.hotelmiconia.com',
  'casaopuntiagalapagos.com', 'www.casaopuntiagalapagos.com'
];

/** true solo si la URL es https y su host está EXACTAMENTE en la allowlist. */
function isAllowedPurchaseUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  if (u.protocol !== 'https:') return false;
  return ALLOWED_HOSTS.indexOf(u.hostname.toLowerCase()) !== -1;
}

module.exports = { ALLOWED_HOSTS, isAllowedPurchaseUrl };
