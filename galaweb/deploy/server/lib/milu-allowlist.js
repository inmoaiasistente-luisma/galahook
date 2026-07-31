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

/* -------- Web Research (8D) --------
   Dominios registrables permitidos para pasar como `allowed_domains` a
   Anthropic Web Search / Web Fetch y para validar cada URL de origen
   (research_source_url). Bare domains, sin esquema. Para investigación se
   permiten SUBDOMINIOS del dominio registrable (las páginas de aerolíneas y
   hoteles usan www./m./booking. etc.). Nunca fuera de esta lista. */
const RESEARCH_DOMAIN_ALLOWLIST = [
  'latamairlines.com',
  'avianca.com',
  'ihg.com',
  'booking.com',
  'airbnb.com',
  'hotelmiconia.com',
  'casaopuntiagalapagos.com'
];

/** Host normalizado de una URL https, o null si es inválida / no https. */
function researchHostOf(url) {
  if (typeof url !== 'string' || !url) return null;
  let u;
  try { u = new URL(url); } catch (e) { return null; }
  if (u.protocol !== 'https:') return null;
  return u.hostname.toLowerCase();
}

/** true si la URL es https y su host es un dominio permitido o subdominio de él. */
function isAllowedResearchDomain(url) {
  const host = researchHostOf(url);
  if (!host) return false;
  for (var i = 0; i < RESEARCH_DOMAIN_ALLOWLIST.length; i++) {
    const d = RESEARCH_DOMAIN_ALLOWLIST[i];
    if (host === d || host.endsWith('.' + d)) return true;
  }
  return false;
}

/** Lista de dominios (bare) para el parámetro allowed_domains de los tools. */
function researchAllowedDomains() { return RESEARCH_DOMAIN_ALLOWLIST.slice(); }

module.exports = {
  ALLOWED_HOSTS, isAllowedPurchaseUrl,
  RESEARCH_DOMAIN_ALLOWLIST, isAllowedResearchDomain, researchAllowedDomains, researchHostOf
};
