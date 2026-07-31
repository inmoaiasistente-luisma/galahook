'use strict';

/* =========================================================
   Finanzas reales por reserva (Fase 9, Etapa 3) — cálculo/validación
   SERVER-SIDE puro (sin DB). Aquí vive toda la aritmética de dinero para
   que el navegador NUNCA calcule utilidades: valida líneas de costo y
   computa costo total, utilidad y margen.

   Estados: 'unset' (sin líneas ni costo) · 'estimated' (con líneas, aún NO
   confirmado, o snapshot de plantilla) · 'confirmed' (el owner confirmó los
   costos reales; recién ahí cuenta como utilidad OFICIAL).
   ========================================================= */

const COST_CATEGORIES = [
  'flight', 'hotel_mainland', 'hotel_galapagos', 'operator', 'transport',
  'interisland_boat', 'food', 'fuel', 'captain', 'crew', 'bait_ice', 'guide',
  'entrance_fees', 'commission', 'taxes', 'other'
];
const SALE_SOURCES = ['web', 'agency', 'phone', 'in_person', 'partner', 'other'];
const COST_STATUSES = ['unset', 'estimated', 'confirmed'];
const MAX_UNIT_COST_CENTS = 100000000;   // $1,000,000 por línea
const MAX_QTY = 100000;

function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }

/** Valida y normaliza una línea de costo entrante.
 * @returns {ok:true, line} | {ok:false, code} */
function validateCostLine(input) {
  input = input || {};
  if (COST_CATEGORIES.indexOf(input.category) === -1) return { ok: false, code: 'INVALID_CATEGORY' };
  const qtyRaw = (input.quantity == null || input.quantity === '') ? 1 : Number(input.quantity);
  if (!isFiniteNum(qtyRaw) || qtyRaw <= 0 || qtyRaw > MAX_QTY) return { ok: false, code: 'INVALID_QUANTITY' };
  const unit = Number(input.unit_cost_cents);
  if (!Number.isInteger(unit) || unit < 0 || unit > MAX_UNIT_COST_CENTS) return { ok: false, code: 'INVALID_UNIT_COST' };
  const quantity = Math.round(qtyRaw * 1000) / 1000;             // 3 decimales = numeric(12,3)
  const total_cents = Math.round(quantity * unit);              // MISMO cálculo que la columna GENERATED de la BD
  function clean(v, max) { return (typeof v === 'string' && v.trim()) ? v.trim().slice(0, max) : null; }
  return {
    ok: true,
    line: {
      category: input.category,
      description: clean(input.description, 300),
      quantity: quantity,
      unit_cost_cents: unit,
      total_cents: total_cents,
      vendor: clean(input.vendor, 160),
      notes: clean(input.notes, 500),
      currency: 'usd'
    }
  };
}

/** Suma de líneas ACTIVAS + utilidad/margen respecto al total cobrado.
 * @param amountCents total cobrado (null en cotización o sin importe).
 * @param lines array de líneas (usa total_cents; ignora active===false).
 * @returns { line_count, cost_total_cents, amount_cents, profit_cents, margin_percent } */
function computeFinance(amountCents, lines) {
  const active = (Array.isArray(lines) ? lines : []).filter(function (l) { return l && l.active !== false; });
  const cost_total_cents = active.reduce(function (s, l) { return s + (Number(l.total_cents) || 0); }, 0);
  // null/''/no numérico → sin importe cobrado (NO se asume 0, que Number(null) daría).
  const amount = (amountCents == null || amountCents === '' || !isFiniteNum(Number(amountCents))) ? null : Number(amountCents);
  const hasCost = active.length > 0;
  // Utilidad/margen solo si hay importe cobrado Y al menos una línea de costo.
  const profit_cents = (amount != null && hasCost) ? (amount - cost_total_cents) : null;
  const margin_percent = (profit_cents != null && amount && amount > 0) ? Math.round(profit_cents / amount * 1000) / 10 : null;
  return {
    line_count: active.length,
    cost_total_cents: cost_total_cents,
    amount_cents: amount,
    profit_cents: profit_cents,
    margin_percent: margin_percent
  };
}

/** Estado derivado de líneas (el bookings.cost_status persistido manda; esto
 * ayuda a los endpoints a decidir el nuevo estado tras add/delete).
 * confirmado → 'confirmed'; con líneas → 'estimated'; sin líneas → 'unset'. */
function deriveCostStatus(lineCount, confirmed) {
  if (confirmed) return 'confirmed';
  return (lineCount > 0) ? 'estimated' : 'unset';
}

module.exports = {
  COST_CATEGORIES, SALE_SOURCES, COST_STATUSES, MAX_UNIT_COST_CENTS, MAX_QTY,
  validateCostLine, computeFinance, deriveCostStatus
};
