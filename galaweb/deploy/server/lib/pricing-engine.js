'use strict';

/* =========================================================
   LOAN-IX Booking Engine — motor único de precios
   ---------------------------------------------------------
   Única fuente para el importe de una reserva WEB. El navegador
   nunca decide el precio: envía tour_id + guests y el servidor
   calcula bruto, descuento (una sola regla), total y costo.

   NO acumula descuentos: elige UNA regla por prioridad. Los
   descuentos viven en public.discount_rules (configurables por
   owner); el antiguo −20 % fijo se retiró del catálogo.

   El snapshot que se guarda en la reserva contiene solo datos
   comerciales no secretos (nunca claves ni tokens).
   ========================================================= */

const catalog = require('./tour-catalog');
const { getSupabase } = require('./supabase');

/* ---- selección de regla ---------------------------------------------
   Entre las reglas aplicables se ordena y se toma la PRIMERA:
   1) tour específico antes que global (tour_id null)
   2) mayor priority
   3) mayor min_guests
   4) created_at más reciente (último desempate)                        */
function pickRule(rules, tourId, guests, nowIso) {
  const applicable = (rules || []).filter(function (r) {
    if (r.active !== true) return false;
    if (r.tour_id != null && r.tour_id !== tourId) return false;        // específico de otro tour
    const min = Number(r.min_guests || 1);
    if (guests < min) return false;
    if (r.max_guests != null && guests > Number(r.max_guests)) return false;
    if (r.starts_at && nowIso < new Date(r.starts_at).toISOString()) return false;
    if (r.ends_at && nowIso >= new Date(r.ends_at).toISOString()) return false;
    return true;
  });
  applicable.sort(function (a, b) {
    const aSpecific = a.tour_id != null ? 1 : 0;
    const bSpecific = b.tour_id != null ? 1 : 0;
    if (aSpecific !== bSpecific) return bSpecific - aSpecific;          // específico primero
    if (Number(a.priority) !== Number(b.priority)) return Number(b.priority) - Number(a.priority);
    if (Number(a.min_guests) !== Number(b.min_guests)) return Number(b.min_guests) - Number(a.min_guests);
    return String(b.created_at || '').localeCompare(String(a.created_at || '')); // más reciente
  });
  return applicable[0] || null;
}

/* ---- descuento en centavos a partir de la regla elegida -------------- */
function discountForRule(rule, gross, guests) {
  if (!rule) return 0;
  if (rule.discount_type === 'percentage') {
    return Math.round(gross * Number(rule.percentage_bps) / 10000);
  }
  if (rule.discount_type === 'fixed_total') {
    return Number(rule.amount_cents);
  }
  if (rule.discount_type === 'fixed_per_pax') {
    return Number(rule.amount_cents) * guests;
  }
  return 0;
}

/**
 * Calcula el precio de una reserva web.
 * @param {object} o { tenantId, tourId, guests, now?:Date }
 * @returns {Promise<{grossAmountCents,discountCents,amountCents,costCents,appliedDiscount,pricingSnapshot}>}
 * @throws  Error('QUOTE_ONLY') si el tour es de cotización.
 */
async function computeWebPricing(o) {
  const tenantId = o && o.tenantId;
  const guests = o && o.guests;
  const now = (o && o.now) || new Date();
  const nowIso = now.toISOString();

  const tour = catalog.getTour(o && o.tourId);
  if (!tour) throw new Error('INVALID_TOUR');
  if (tour.requiresQuote || tour.priceCents == null) throw new Error('QUOTE_ONLY');

  const gross = catalog.calculateGrossCents(tour, guests);

  const supabase = getSupabase();

  /* Reglas del tenant que apliquen a este tour o a todos (global). */
  let rules = [];
  try {
    const res = await supabase.from('discount_rules').select('*')
      .eq('tenant_id', tenantId).eq('active', true);
    if (!res.error && Array.isArray(res.data)) rules = res.data;
  } catch (e) { rules = []; }                    // sin reglas → sin descuento

  const rule = pickRule(rules, tour.id, guests, nowIso);

  /* Descuento con clamp: nunca deja el total < 1 centavo ni negativo. */
  let discount = discountForRule(rule, gross, guests);
  if (discount < 0) discount = 0;
  if (discount > gross - 1) discount = gross - 1;
  const amount = gross - discount;

  /* Costo desde tour_financial_settings activo; si no hay → null. */
  let costCents = null;
  let costSettings = null;
  try {
    const cs = await supabase.from('tour_financial_settings').select('*')
      .eq('tenant_id', tenantId).eq('tour_id', tour.id).eq('active', true).maybeSingle();
    if (!cs.error && cs.data) {
      costSettings = { fixed_cost_cents: Number(cs.data.fixed_cost_cents) || 0, cost_per_pax_cents: Number(cs.data.cost_per_pax_cents) || 0 };
      costCents = costSettings.fixed_cost_cents + costSettings.cost_per_pax_cents * guests;
    }
  } catch (e) { costCents = null; }

  const appliedDiscount = rule ? {
    id: rule.id,
    name: rule.name,
    type: rule.discount_type,
    value: rule.discount_type === 'percentage' ? Number(rule.percentage_bps) : Number(rule.amount_cents),
    discount_cents: discount
  } : null;

  const pricingSnapshot = {
    base_price_cents: tour.priceCents,
    unit: tour.unit,
    guests: guests,
    rule: rule ? { id: rule.id, name: rule.name, type: rule.discount_type,
      value_bps: rule.discount_type === 'percentage' ? Number(rule.percentage_bps) : null,
      value_cents: rule.discount_type !== 'percentage' ? Number(rule.amount_cents) : null } : null,
    cost_settings: costSettings,      // null si no hay configuración
    calculated_at: nowIso
  };

  return {
    grossAmountCents: gross,
    discountCents: discount,
    amountCents: amount,
    costCents: costCents,             // null si no hay configuración de costo
    appliedDiscount: appliedDiscount, // null si no hubo regla
    pricingSnapshot: pricingSnapshot
  };
}

/* Costo para una reserva de agencia (tour de catálogo con costo activo).
   No aplica descuentos web. Devuelve { costCents, costSettings } o nulls. */
async function computeAgencyCost(tenantId, tourId, guests) {
  if (!tourId || tourId === 'custom') return { costCents: null, costSettings: null };
  try {
    const supabase = getSupabase();
    const cs = await supabase.from('tour_financial_settings').select('*')
      .eq('tenant_id', tenantId).eq('tour_id', tourId).eq('active', true).maybeSingle();
    if (!cs.error && cs.data) {
      const settings = { fixed_cost_cents: Number(cs.data.fixed_cost_cents) || 0, cost_per_pax_cents: Number(cs.data.cost_per_pax_cents) || 0 };
      return { costCents: settings.fixed_cost_cents + settings.cost_per_pax_cents * guests, costSettings: settings };
    }
  } catch (e) { /* sin costo */ }
  return { costCents: null, costSettings: null };
}

module.exports = { computeWebPricing, computeAgencyCost, pickRule, discountForRule };
