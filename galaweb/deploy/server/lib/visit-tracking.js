'use strict';

/* =========================================================
   Hook Adventure — utilidades del contador de visitas
   ---------------------------------------------------------
   Funciones PURAS (sin red ni BD) para el endpoint público /api/track:
   clasificar dispositivo, detectar bots, sanear la ruta, extraer el host
   de procedencia y el país (cabecera geo del servidor).

   PRIVACIDAD: nada de esto guarda IP ni identidad. La IP solo se usa,
   ya hasheada, como clave del limitador de tasa (no se almacena en claro).
   ========================================================= */

const crypto = require('crypto');
const { clientIp } = require('./http');   // IP confiable (no el primer hop falsificable)

/* Rastreadores automáticos conocidos: se marcan is_bot para excluirlos de los
   conteos "reales", sin dejar de registrarlos. Lista deliberadamente amplia. */
const BOT_RE = /(bot|crawl|spider|slurp|bingpreview|facebookexternalhit|facebot|embedly|quora|pinterest|vkshare|whatsapp|telegrambot|discordbot|slackbot|linkedinbot|twitterbot|applebot|petalbot|semrush|ahrefs|mj12|dotbot|dataforseo|screaming frog|headlesschrome|phantomjs|python-requests|curl\/|wget|go-http-client|axios\/|node-fetch|lighthouse|gtmetrix|pingdom|uptimerobot|monitor)/i;

function isBotUA(ua) {
  if (typeof ua !== 'string' || !ua) return true;   // sin UA → tratar como bot
  return BOT_RE.test(ua);
}

/* Clasificación gruesa del dispositivo (no identifica al usuario). */
function classifyDevice(ua) {
  const s = typeof ua === 'string' ? ua.toLowerCase() : '';
  if (!s) return null;
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(s)) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobile|windows phone|blackberry|iemobile|opera mini/.test(s)) return 'mobile';
  return 'desktop';
}

/* Saneo de la ruta: solo pathname público, sin query ni hash. Devuelve una
   ruta segura ('/...') o null si no es válida. Nunca lanza. */
function sanitizePath(p) {
  if (typeof p !== 'string') return null;
  let s = p.trim();
  if (!s) return null;
  const cut = s.search(/[?#]/);              // corta query y fragmento
  if (cut !== -1) s = s.slice(0, cut);
  if (s.charAt(0) !== '/') return null;      // debe ser una ruta absoluta del sitio
  if (/[\x00-\x1f\x7f]/.test(s)) return null; // sin caracteres de control
  s = s.replace(/[<>"'`\\]/g, '');           // defensa en profundidad: sin metacaracteres HTML
  if (s.length > 200) s = s.slice(0, 200);
  return s;
}

/** true si la ruta es del panel admin (no se cuenta como visita pública). */
function isAdminPath(p) {
  return typeof p === 'string' && /^\/admin(\.html|\/|$)/i.test(p);
}

/* Host de procedencia (sin ruta ni query). Devuelve el host o null. */
function refHost(ref) {
  if (typeof ref !== 'string' || !ref) return null;
  try {
    const h = new URL(ref).host;
    return h ? h.slice(0, 120) : null;
  } catch (e) { return null; }
}

/* País (ISO-2) desde la cabecera geo de Vercel. Coarse, sin ciudad ni IP. */
function countryFromHeaders(headers) {
  const raw = headers && (headers['x-vercel-ip-country'] || headers['x-country']);
  if (typeof raw !== 'string') return null;
  const c = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

/* Clave de limitador de tasa: hash de la IP (nunca la IP en claro). */
function rateBucket(ip) {
  const h = crypto.createHash('sha256').update('track:' + String(ip || '')).digest('hex');
  return 'track:' + h.slice(0, 40);
}

module.exports = {
  isBotUA, classifyDevice, sanitizePath, isAdminPath,
  refHost, countryFromHeaders, clientIp, rateBucket
};
