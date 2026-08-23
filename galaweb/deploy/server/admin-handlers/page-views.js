'use strict';

/* =========================================================
   GET /api/admin-page-views      (solo OWNER)
   ---------------------------------------------------------
   Devuelve el resumen de visitas del sitio público para el panel "Visitas":
     · contadores: total, personas únicas, hoy, últimos 7 días (excluye bots);
     · tabla: visitas recientes (hora de ingreso, página, país, dispositivo).

   Solo owner (requireWriter = ['owner']); admin y staff reciben 403 del
   servidor, no solo un botón oculto. sameOrigin como defensa CSRF.

   Tolerante: si la migración 0022 aún no está aplicada (tabla/función
   ausentes), responde ready:false con contadores en cero — el panel muestra
   "aún no activado" en lugar de un error.
   ========================================================= */

const { sendJson, sendError, logServer, getTenantId, todayInGalapagos } = require('../lib/http');
const { getSupabase } = require('../lib/supabase');
const { requireWriter, sameOrigin } = require('../lib/admin-auth');

const RECENT_DEFAULT = 200;
const RECENT_MAX = 500;

const ZERO = {
  total_visits: 0, unique_visitors: 0, today_visits: 0, today_unique: 0,
  week_visits: 0, week_unique: 0, bot_visits: 0
};

/* Código corto y estable a partir del id anónimo (localStorage). No es PII:
   solo sirve para AGRUPAR las visitas de un mismo navegador en una fila. No se
   devuelve el id completo al panel. */
function visitorCode(vid) {
  if (typeof vid !== 'string' || !vid) return null;
  return vid.replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || null;
}

/* Agrupa las filas (ordenadas de más nueva a más vieja) por visitante: una fila
   por navegador con su número de visitas (N×), primera/última vez, país,
   dispositivo y cuántas páginas distintas vio. Las visitas sin id (incógnito)
   se suman en una sola fila "sin identificar". */
function aggregateVisitors(rows) {
  const map = new Map();
  let anon = null;
  rows.forEach(function (r) {
    const vid = r.visitor_id;
    if (!vid) {
      if (!anon) anon = { code: null, anon: true, visits: 0, last: null, first: null, country: null, device: null, _paths: new Set() };
      anon.visits++; if (!anon.last) anon.last = r.created_at; anon.first = r.created_at;
      if (!anon.country && r.country) anon.country = r.country;
      if (!anon.device && r.device) anon.device = r.device;
      if (r.path) anon._paths.add(r.path);
      return;
    }
    let e = map.get(vid);
    if (!e) { e = { code: visitorCode(vid), anon: false, visits: 0, last: null, first: null, country: null, device: null, _paths: new Set() }; map.set(vid, e); }
    e.visits++;
    if (!e.last) e.last = r.created_at;   // filas desc: la 1ª vez que aparece = su visita más reciente
    e.first = r.created_at;               // se sobreescribe → termina en la más antigua de la ventana
    if (!e.country && r.country) e.country = r.country;
    if (!e.device && r.device) e.device = r.device;
    if (r.path) e._paths.add(r.path);
  });
  const list = Array.from(map.values());
  if (anon) list.push(anon);
  return list.map(function (e) {
    return { code: e.code, anon: e.anon, visits: e.visits, last: e.last, first: e.first, country: e.country, device: e.device, pages: e._paths.size };
  }).sort(function (a, b) { return b.visits - a.visits || (String(b.last) > String(a.last) ? 1 : -1); });
}

/* ¿El error de Supabase indica que la migración 0022 falta? */
function isMissing(err) {
  if (!err) return false;
  if (err.code === '42P01' || err.code === '42883') return true;  // tabla / función inexistente
  const m = String(err.message || '').toLowerCase();
  return m.indexOf('page_views') !== -1 || m.indexOf('page_view_stats') !== -1
    || m.indexOf('does not exist') !== -1 || m.indexOf('schema cache') !== -1;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed'); }

  const session = await requireWriter(req, res);   // SOLO owner
  if (!session) return;                            // 401/403 ya enviado
  if (!sameOrigin(req)) return sendError(res, 403, 'FORBIDDEN', 'Forbidden');

  let tenant;
  try { tenant = getTenantId(); }
  catch (e) { logServer('page-views', e.message); return sendError(res, 500, 'INTERNAL_ERROR', 'Server error'); }

  // Límite de la tabla reciente.
  let limit = RECENT_DEFAULT;
  try {
    const q = new URL(req.url, 'http://localhost').searchParams.get('limit');
    const n = parseInt(q, 10);
    if (Number.isFinite(n) && n > 0) limit = Math.min(n, RECENT_MAX);
  } catch (e) { /* usa el valor por defecto */ }

  // Límites de tiempo en hora de Galápagos (UTC-6): inicio de "hoy" y ventana de 7 días.
  const todayStartIso = todayInGalapagos() + 'T06:00:00.000Z';   // 00:00 Galápagos = 06:00 UTC
  const weekStartIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const supabase = getSupabase();

    const rpc = await supabase.rpc('page_view_stats', {
      p_tenant: tenant, p_today_start: todayStartIso, p_week_start: weekStartIso
    });
    if (rpc.error) {
      if (isMissing(rpc.error)) return sendJson(res, 200, { ready: false, stats: ZERO, recent: [], visitors: [] });
      logServer('page-views', rpc.error.message);
      return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
    }
    const stats = Object.assign({}, ZERO, rpc.data || {});

    const rows = await supabase.from('page_views')
      .select('created_at, path, country, device, visitor_id')
      .eq('tenant_id', tenant).eq('is_bot', false)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (rows.error) {
      if (isMissing(rows.error)) return sendJson(res, 200, { ready: false, stats: ZERO, recent: [], visitors: [] });
      logServer('page-views', rows.error.message);
      return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
    }

    const data = rows.data || [];
    const visitors = aggregateVisitors(data);
    // El registro detallado NO expone el id anónimo (solo los agregados lo usan).
    const recent = data.map(function (r) { return { created_at: r.created_at, path: r.path, country: r.country, device: r.device }; });

    return sendJson(res, 200, { ready: true, stats: stats, recent: recent, visitors: visitors });
  } catch (err) {
    if (isMissing(err)) return sendJson(res, 200, { ready: false, stats: ZERO, recent: [], visitors: [] });
    logServer('page-views', err && err.message);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Server error');
  }
};

/* Solo para pruebas: funciones puras de agregación por visitante (Fase C). */
module.exports.aggregateVisitors = aggregateVisitors;
module.exports.visitorCode = visitorCode;
