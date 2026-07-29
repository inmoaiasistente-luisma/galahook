'use strict';

/* =========================================================
   GALÁPAGOS HOOK ADVENTURE — precios de paquetes en vivo
   ---------------------------------------------------------
   FUENTE ÚNICA server-side para el precio de los PAQUETES.
   El precio vigente vive en public.package_prices (fila
   `published`), editable por el owner desde el panel. Esta
   librería es la ÚNICA vía por la que el precio de un paquete
   entra al sistema:

     · pricing-engine.computeWebPricing  (checkout + preview)
     · pricing-preview (lista pública de tarjetas)
     · handlers admin (list/draft/publish/rollback/toggle/history)

   El navegador NUNCA envía ni decide importes.

   ATOMICIDAD: publish/rollback/deactivate/reactivate se ejecutan
   como UNA sola operación transaccional en Postgres (funciones RPC
   SECURITY DEFINER con advisory lock + SELECT ... FOR UPDATE). El
   JavaScript hace UNA llamada RPC por operación: no archiva ni
   inserta en pasos independientes. Si algo falla, la transacción
   completa hace rollback y el precio anterior sigue publicado.

   FALLBACK CONTROLADO (transición, antes de aplicar 0012):
     · Si la tabla package_prices AÚN NO EXISTE  -> se usa el
       catálogo server-side (tour-catalog.js) como respaldo y se
       registra un warning saneado.
     · Si la tabla existe pero NO hay `published` -> se BLOQUEA.
     · Cualquier otro error de Supabase -> se BLOQUEA (no hay
       fallback silencioso).
   Nunca se usa localStorage ni un precio del navegador como
   respaldo, ni números distintos por idioma/viewport.
   ========================================================= */

const catalog = require('./tour-catalog');
const { getSupabase } = require('./supabase');
const { logServer } = require('./http');

const TABLE = 'package_prices';
const HISTORY = 'package_price_history';
const DEFAULT_CURRENCY = 'USD';
const MAX_PRICE_CENTS = 100000000;              // $1,000,000 — tope de cordura
const HISTORY_ACTIONS = ['publish', 'rollback', 'deactivate', 'reactivate'];

/* ---- catálogo: ids de PAQUETE válidos (type === 'package') ---- */
function packageIds() {
  return Object.keys(catalog.TOURS).filter(function (id) { return catalog.TOURS[id].type === 'package'; });
}
function isPackageId(id) {
  return typeof id === 'string'
    && Object.prototype.hasOwnProperty.call(catalog.TOURS, id)
    && catalog.TOURS[id].type === 'package';
}
function catalogPriceCents(id) {
  const t = catalog.TOURS[id];
  return t ? t.priceCents : null;
}

/* ¿el error de Supabase indica que la TABLA todavía no existe?
   (migración 0012 no aplicada). Solo en ese caso se permite fallback. */
function isMissingTableError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202') return true;
  const blob = String(error.message || '') + ' ' + String(error.details || '') + ' ' + String(error.hint || '');
  return /does not exist|could not find the table|schema cache/i.test(blob)
    || /relation .* does not exist/i.test(blob);
}

/* ¿el error indica que la FUNCIÓN RPC no existe? (migración no aplicada) */
function isMissingRpc(error) {
  if (!error) return false;
  const code = String(error.code || '');
  if (code === '42883' || code === 'PGRST202' || code === 'PGRST203') return true;
  const blob = String(error.message || '') + ' ' + String(error.details || '') + ' ' + String(error.hint || '');
  return /could not find the function|function .* does not exist|schema cache/i.test(blob);
}

/* Traduce el error de un RPC (RAISE de plpgsql) a un código de error propio,
   saneado (nunca SQL ni stack traces hacia el frontend). */
function rpcError(error) {
  const msg = String((error && error.message) || '');
  const known = ['REASON_REQUIRED', 'INVALID_PACKAGE', 'INVALID_PRICE', 'INVALID_ACTION',
    'INVALID_ACTOR', 'INVALID_TENANT', 'NO_PREVIOUS', 'NOT_PUBLISHED', 'ALREADY_PUBLISHED', 'NO_PRICE_TO_REACTIVATE'];
  for (let i = 0; i < known.length; i++) { if (msg.indexOf(known[i]) !== -1) return known[i]; }
  if (isMissingRpc(error) || isMissingTableError(error)) return 'NOT_MIGRATED';
  return 'DB_ERROR';
}

/* El RPC devuelve la fila (composite) o un array con una fila. */
function normalizeRpcRow(data) {
  if (!data) return null;
  return Array.isArray(data) ? (data[0] || null) : data;
}

/* ---- lectura del precio publicado de UN paquete ---- */
async function getPublishedPackagePrice(tenantId, packageId) {
  const supabase = getSupabase();
  let res;
  try {
    res = await supabase.from(TABLE)
      .select('base_price_cents,currency,pricing_version,published_at,status')
      .eq('tenant_id', tenantId).eq('package_id', packageId).eq('status', 'published')
      .maybeSingle();
  } catch (e) { return { status: 'error', message: e && e.message }; }

  if (res && res.error) {
    if (isMissingTableError(res.error)) return { status: 'table_missing' };
    return { status: 'error', code: res.error.code, message: res.error.message };
  }
  if (!res || !res.data) return { status: 'not_found' };

  const priceCents = Number(res.data.base_price_cents);
  if (!Number.isInteger(priceCents) || priceCents <= 0) return { status: 'error', message: 'invalid stored price' };
  return {
    status: 'published',
    priceCents: priceCents,
    currency: res.data.currency || DEFAULT_CURRENCY,
    pricingVersion: res.data.pricing_version != null ? Number(res.data.pricing_version) : null,
    publishedAt: res.data.published_at || null
  };
}

/**
 * Precio BASE efectivo (centavos) de un paquete para el motor de precios.
 * @returns {Promise<{priceCents,source,currency,pricingVersion,publishedAt}>}
 * @throws  Error('PACKAGE_PRICE_UNAVAILABLE') si no hay precio publicado ni
 *          fallback válido (checkout/preview deben bloquear).
 */
async function resolvePackageBasePriceCents(tenantId, tour) {
  const r = await getPublishedPackagePrice(tenantId, tour.id);
  if (r.status === 'published') {
    return { priceCents: r.priceCents, source: 'db', currency: r.currency, pricingVersion: r.pricingVersion, publishedAt: r.publishedAt };
  }
  if (r.status === 'table_missing') {
    const c = catalogPriceCents(tour.id);
    logServer('package-pricing', 'FALLBACK catalog price (package_prices table missing) for ' + tour.id);
    if (!(c > 0)) throw new Error('PACKAGE_PRICE_UNAVAILABLE');
    return { priceCents: c, source: 'fallback', currency: DEFAULT_CURRENCY, pricingVersion: null, publishedAt: null };
  }
  // not_found (tabla existe, sin published) o error real -> BLOQUEAR, sin fallback silencioso.
  logServer('package-pricing', 'BLOCK package price (' + r.status + (r.code ? ' ' + r.code : '') + ') for ' + tour.id);
  throw new Error('PACKAGE_PRICE_UNAVAILABLE');
}

/* ---- lista de precios publicados (proyección PÚBLICA) ---- */
async function listPublishedPackagePrices(tenantId) {
  const supabase = getSupabase();
  let res;
  try {
    res = await supabase.from(TABLE)
      .select('package_id,base_price_cents,currency,pricing_version,published_at')
      .eq('tenant_id', tenantId).eq('status', 'published');
  } catch (e) { return { status: 'error', message: e && e.message }; }

  if (res && res.error) {
    if (isMissingTableError(res.error)) return { status: 'table_missing' };
    return { status: 'error', code: res.error.code, message: res.error.message };
  }
  const rows = (res && res.data) || [];
  const prices = rows
    .filter(function (r) { return isPackageId(r.package_id) && Number(r.base_price_cents) > 0; })
    .map(function (r) {
      const cents = Number(r.base_price_cents);
      return {
        package_id: r.package_id,
        base_price_cents: cents,
        display_price_cents: cents,
        currency: r.currency || DEFAULT_CURRENCY,
        pricing_version: r.pricing_version != null ? Number(r.pricing_version) : null,
        published_at: r.published_at || null
      };
    });
  return { status: 'ok', prices: prices };
}

/* Lista pública para las tarjetas del sitio. Solo campos visibles. Durante la
   transición (tabla ausente) devuelve el catálogo como respaldo; un error real
   devuelve ok:false para que el frontend muestre "precio no disponible". */
async function publicPackagePriceList(tenantId) {
  const r = await listPublishedPackagePrices(tenantId);
  if (r.status === 'ok') return { ok: true, source: 'db', packages: r.prices };
  if (r.status === 'table_missing') {
    logServer('package-pricing', 'FALLBACK catalog list (package_prices table missing)');
    const packages = packageIds().map(function (id) {
      const c = catalogPriceCents(id);
      return { package_id: id, base_price_cents: c, display_price_cents: c, currency: DEFAULT_CURRENCY, pricing_version: null, published_at: null };
    }).filter(function (p) { return p.base_price_cents > 0; });
    return { ok: true, source: 'fallback', packages: packages };
  }
  return { ok: false, source: 'error' };
}

/* ---- vista ADMIN: publicado + draft por paquete ---- */
async function listAllForAdmin(tenantId) {
  const supabase = getSupabase();
  let res;
  try {
    res = await supabase.from(TABLE).select('*')
      .eq('tenant_id', tenantId).in('status', ['published', 'draft']);
  } catch (e) { return { status: 'error', message: e && e.message }; }

  if (res && res.error) {
    if (isMissingTableError(res.error)) return { status: 'table_missing' };
    return { status: 'error', code: res.error.code, message: res.error.message };
  }
  const rows = (res && res.data) || [];
  const byId = {};
  packageIds().forEach(function (id) {
    byId[id] = {
      package_id: id, name: catalog.TOURS[id].name, catalog_price_cents: catalogPriceCents(id),
      published: null, draft: null
    };
  });
  rows.forEach(function (r) {
    if (!byId[r.package_id]) return;
    const item = {
      base_price_cents: Number(r.base_price_cents),
      currency: r.currency || DEFAULT_CURRENCY,
      pricing_version: r.pricing_version != null ? Number(r.pricing_version) : null,
      published_at: r.published_at || null,
      published_by_user_id: r.published_by_user_id || null,
      updated_at: r.updated_at || null,
      updated_by_user_id: r.updated_by_user_id || null
    };
    if (r.status === 'published') byId[r.package_id].published = item;
    else if (r.status === 'draft') byId[r.package_id].draft = item;
  });
  return { status: 'ok', packages: packageIds().map(function (id) { return byId[id]; }) };
}

/* ---- guardar/actualizar el DRAFT (owner + admin) ----
   Un draft NO afecta Production; es un upsert simple (no requiere atomicidad
   transaccional). Publicarlo sí es atómico (RPC). */
async function saveDraftPrice(o) {
  const tenantId = o.tenantId, packageId = o.packageId, basePriceCents = o.basePriceCents, userId = o.userId || null;
  if (!isPackageId(packageId)) return { ok: false, error: 'INVALID_PACKAGE' };
  if (!Number.isInteger(basePriceCents) || basePriceCents <= 0 || basePriceCents > MAX_PRICE_CENTS) return { ok: false, error: 'INVALID_PRICE' };
  const supabase = getSupabase();
  const nowIso = new Date().toISOString();

  const cur = await supabase.from(TABLE).select('id')
    .eq('tenant_id', tenantId).eq('package_id', packageId).eq('status', 'draft').maybeSingle();
  if (cur.error) { if (isMissingTableError(cur.error)) return { ok: false, error: 'NOT_MIGRATED' }; return { ok: false, error: 'DB_ERROR' }; }

  try {
    if (cur.data && cur.data.id) {
      const up = await supabase.from(TABLE)
        .update({ base_price_cents: basePriceCents, currency: DEFAULT_CURRENCY, updated_by_user_id: userId, updated_at: nowIso })
        .eq('id', cur.data.id).eq('tenant_id', tenantId).select().single();
      if (up.error) return { ok: false, error: 'DB_ERROR' };
      return { ok: true, draft: up.data };
    }
    const ins = await supabase.from(TABLE).insert({
      tenant_id: tenantId, package_id: packageId, base_price_cents: basePriceCents, currency: DEFAULT_CURRENCY,
      status: 'draft', pricing_version: null, created_by_user_id: userId, updated_by_user_id: userId
    }).select().single();
    if (ins.error) return { ok: false, error: 'DB_ERROR' };
    return { ok: true, draft: ins.data };
  } catch (e) { return { ok: false, error: 'DB_ERROR' }; }
}

/* ---- PUBLICAR (owner) — RPC atómico ---- */
async function publishPackagePrice(o) {
  if (!isPackageId(o.packageId)) return { ok: false, error: 'INVALID_PACKAGE' };
  if (!Number.isInteger(o.basePriceCents) || o.basePriceCents <= 0 || o.basePriceCents > MAX_PRICE_CENTS) return { ok: false, error: 'INVALID_PRICE' };
  if ((o.reason || '').trim().length < 5) return { ok: false, error: 'REASON_REQUIRED' };
  const supabase = getSupabase();
  let res;
  try {
    res = await supabase.rpc('publish_package_price_atomic', {
      p_tenant: o.tenantId, p_package: o.packageId, p_price_cents: o.basePriceCents, p_user: o.userId || null, p_reason: (o.reason || '').trim()
    });
  } catch (e) { logServer('package-pricing:publish', e && e.message); return { ok: false, error: 'DB_ERROR' }; }
  if (res.error) { logServer('package-pricing:publish', res.error.message); return { ok: false, error: rpcError(res.error) }; }
  const row = normalizeRpcRow(res.data);
  if (!row) return { ok: false, error: 'DB_ERROR' };
  return { ok: true, published: row, version: row.pricing_version != null ? Number(row.pricing_version) : null };
}

/* ---- ROLLBACK (owner) — RPC atómico ---- */
async function rollbackPackagePrice(o) {
  if (!isPackageId(o.packageId)) return { ok: false, error: 'INVALID_PACKAGE' };
  if ((o.reason || '').trim().length < 5) return { ok: false, error: 'REASON_REQUIRED' };
  const supabase = getSupabase();
  let res;
  try {
    res = await supabase.rpc('rollback_package_price_atomic', {
      p_tenant: o.tenantId, p_package: o.packageId, p_user: o.userId || null, p_reason: (o.reason || '').trim()
    });
  } catch (e) { logServer('package-pricing:rollback', e && e.message); return { ok: false, error: 'DB_ERROR' }; }
  if (res.error) { logServer('package-pricing:rollback', res.error.message); return { ok: false, error: rpcError(res.error) }; }
  const row = normalizeRpcRow(res.data);
  if (!row) return { ok: false, error: 'DB_ERROR' };
  return { ok: true, published: row, version: row.pricing_version != null ? Number(row.pricing_version) : null };
}

/* ---- DESACTIVAR / REACTIVAR (owner) — RPC atómico ---- */
async function togglePackagePrice(o) {
  const action = o.action;
  if (!isPackageId(o.packageId)) return { ok: false, error: 'INVALID_PACKAGE' };
  if (action !== 'deactivate' && action !== 'reactivate') return { ok: false, error: 'INVALID_ACTION' };
  if ((o.reason || '').trim().length < 5) return { ok: false, error: 'REASON_REQUIRED' };
  const supabase = getSupabase();
  let res;
  try {
    res = await supabase.rpc('set_package_price_active_atomic', {
      p_tenant: o.tenantId, p_package: o.packageId, p_action: action, p_user: o.userId || null, p_reason: (o.reason || '').trim()
    });
  } catch (e) { logServer('package-pricing:toggle', e && e.message); return { ok: false, error: 'DB_ERROR' }; }
  if (res.error) { logServer('package-pricing:toggle', res.error.message); return { ok: false, error: rpcError(res.error) }; }
  const row = normalizeRpcRow(res.data);
  if (action === 'deactivate') return { ok: true, deactivated: true };
  return { ok: true, published: row };
}

/* ---- historial de un paquete (owner + admin) ---- */
async function getPackagePriceHistory(tenantId, packageId) {
  if (!isPackageId(packageId)) return { status: 'error', error: 'INVALID_PACKAGE' };
  const supabase = getSupabase();
  const res = await supabase.from(HISTORY).select('*')
    .eq('tenant_id', tenantId).eq('package_id', packageId)
    .order('created_at', { ascending: false }).limit(100);
  if (res.error) { if (isMissingTableError(res.error)) return { status: 'table_missing' }; return { status: 'error' }; }
  return { status: 'ok', history: res.data || [] };
}

module.exports = {
  DEFAULT_CURRENCY, MAX_PRICE_CENTS, HISTORY_ACTIONS,
  packageIds, isPackageId, catalogPriceCents, isMissingTableError, isMissingRpc,
  getPublishedPackagePrice, resolvePackageBasePriceCents,
  listPublishedPackagePrices, publicPackagePriceList, listAllForAdmin,
  saveDraftPrice, publishPackagePrice, rollbackPackagePrice, togglePackagePrice,
  getPackagePriceHistory
};
