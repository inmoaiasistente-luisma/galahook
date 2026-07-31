'use strict';

/* =========================================================
   Fase 9 — Auditoría automática del panel admin
   ---------------------------------------------------------
   SERVER-ONLY. Registra quién hizo qué, cuándo y con qué valores
   antes/después, SIN pedirle una razón al owner: el registro es
   automático y ocurre en segundo plano.

   Dos reglas de diseño:

   1) FAIL-OPEN. La auditoría NUNCA bloquea la operación del usuario.
      Si la tabla todavía no existe (migración 0019 sin aplicar), si la
      red falla o si el registro es inválido, se traga el error y la
      acción del owner continúa. Auditar es importante; impedir que el
      owner trabaje porque el log falló, no.

   2) SOLO EL DIFERENCIAL. before_data/after_data guardan únicamente los
      campos que CAMBIARON. Así el log se lee de un vistazo y no se
      convierte en una copia completa de cada fila.

   Nunca se auditan secretos: los valores sensibles se enmascaran
   (ver REDACTED_KEYS) antes de escribir.
   ========================================================= */

const { getSupabase } = require('./supabase');
const { getTenantId, logServer } = require('./http');

const TABLE = 'admin_audit_log';

/* Claves cuyo valor jamás se guarda en claro en la auditoría. */
const REDACTED_KEYS = [
  'password', 'token', 'secret', 'api_key', 'apikey', 'authorization',
  'document_number', 'document_ciphertext', 'ciphertext', 'qr_token',
  'stripe_payment_intent_id', 'client_secret'
];

function isRedacted(key) {
  const k = String(key || '').toLowerCase();
  return REDACTED_KEYS.some(function (r) { return k === r || k.indexOf(r) !== -1; });
}

/** Valor comparable y serializable. Fechas → ISO; objetos → tal cual. */
function normValue(v) {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return v;
}

function sameValue(a, b) {
  const x = normValue(a), y = normValue(b);
  if (x === y) return true;
  if (x == null || y == null) return false;
  if (typeof x === 'object' || typeof y === 'object') {
    try { return JSON.stringify(x) === JSON.stringify(y); } catch (e) { return false; }
  }
  return false;
}

/**
 * Diferencia campo a campo entre el estado anterior y el nuevo.
 * Devuelve { before, after } SOLO con las claves que cambiaron, o null si
 * no cambió nada (en ese caso no vale la pena escribir un registro).
 *
 * Se recorren las claves de `after` (lo que el endpoint quiso cambiar); las
 * claves que sólo existen en `before` no se consideran un cambio.
 */
function diffFields(before, after) {
  const b = before && typeof before === 'object' ? before : {};
  const a = after && typeof after === 'object' ? after : {};
  const outB = {}, outA = {};
  let n = 0;
  Object.keys(a).forEach(function (k) {
    if (sameValue(b[k], a[k])) return;
    n++;
    if (isRedacted(k)) { outB[k] = '[redacted]'; outA[k] = '[redacted]'; return; }
    outB[k] = normValue(b[k]);
    outA[k] = normValue(a[k]);
  });
  return n ? { before: outB, after: outA } : null;
}

/**
 * Construye la fila de auditoría. PURA (sin red) para poder probarla.
 * Devuelve null cuando no hay nada que registrar.
 *
 * @param {object} session  { user_id, email, role, tenant_id }
 * @param {object} entry    { action, entity_type, entity_id, before, after, always }
 */
function buildAuditRow(session, entry, tenantFallback) {
  if (!session || !entry || !entry.action || !entry.entity_type) return null;

  const d = diffFields(entry.before, entry.after);
  // `always: true` registra la acción aunque no haya diferencial (envíos,
  // reenvíos, rotaciones de QR… donde el hecho ES el dato).
  if (!d && !entry.always) return null;

  return {
    tenant_id: session.tenant_id || tenantFallback || null,
    actor_user_id: session.user_id || null,
    actor_email: session.email || null,
    actor_role: session.role || null,
    action: String(entry.action).slice(0, 120),
    entity_type: String(entry.entity_type).slice(0, 60),
    entity_id: entry.entity_id == null ? null : String(entry.entity_id).slice(0, 120),
    before_data: d ? d.before : null,
    after_data: d ? d.after : null
  };
}

/**
 * Escribe la auditoría en segundo plano. SIEMPRE resuelve (nunca rechaza).
 * Devuelve true si se registró, false si se omitió o falló.
 *
 * Uso: `recordAudit(session, {...})` — se puede esperar o no; los endpoints
 * la esperan para no cortar la ejecución de la función serverless antes de
 * que termine el insert, pero un fallo no cambia la respuesta al usuario.
 */
async function recordAudit(session, entry) {
  let tenant = null;
  try { tenant = getTenantId(); } catch (e) { /* sin tenant → se usa el de la sesión */ }

  let row;
  try { row = buildAuditRow(session, entry, tenant); }
  catch (e) { logServer('audit', 'build failed: ' + e.message); return false; }
  if (!row) return false;

  try {
    const supabase = getSupabase();
    const { error } = await supabase.from(TABLE).insert(row);
    if (error) { logServer('audit', 'insert failed: ' + error.message); return false; }
    return true;
  } catch (e) {
    // Tabla ausente (0019 sin aplicar), red caída, credenciales… da igual:
    // la acción del usuario ya se completó y no se revierte por esto.
    logServer('audit', 'skipped: ' + (e && e.message ? e.message : 'unknown'));
    return false;
  }
}

module.exports = {
  TABLE, REDACTED_KEYS, isRedacted, diffFields, buildAuditRow, recordAudit
};
