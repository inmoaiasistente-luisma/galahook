'use strict';

/* =========================================================
   Milu Turismo — adapter del cliente Anthropic REAL (runner e2e)
   ---------------------------------------------------------
   SERVER-ONLY / uso local (fuera de /api). Puente FINO entre el SDK
   oficial de Anthropic y el contrato que el core espera:

       core:  client.messages({ model, system, input, tools })
       ->     { usage:{...,server_tool_use:{web_search_requests,web_fetch_requests}},
                content:[...], output:{ findings:[...] }, model_version }

   El SDK devuelve content + usage; la EXTRACCIÓN de findings (source_url,
   price_cents, currency, airline/hotel_name, origin, destination) la hace
   este adapter parseando el JSON final del modelo. El core vuelve a validar
   allowlist y coerciona precios, así que un hallazgo inválido se descarta
   aguas abajo (y entra el fallback por dominio).

   Herramientas BÁSICAS (Haiku): web_search_20250305 + web_fetch_20250910.
   web_fetch_20250910 es GA en client.messages.create (sin header beta) y
   solo lee URLs ya presentes en la conversación (las trae web_search).

   NUNCA imprime la API key: vive dentro del SDK. NUNCA registra prompt,
   respuesta ni PII: eso es responsabilidad del core (solo metadata).
   ========================================================= */

let Anthropic = null;
try { Anthropic = require('@anthropic-ai/sdk'); } catch (e) { Anthropic = null; }

const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_MAX_PAUSE_TURNS = 4;   // reanuda un pause_turn del bucle server-side

/* ---------------- construcción del prompt (sin PII) ---------------- */
function buildUserText(input) {
  const kind = (input && input.kind) || 'flights';
  const j = JSON.stringify(input || {}, null, 2);
  const shape = kind === 'lodging'
    ? '{ "source_url": "https://...", "price_cents": 123456, "currency": "USD", "hotel_name": "...", "destination": "..." }'
    : '{ "source_url": "https://...", "price_cents": 123456, "currency": "USD", "airline": "...", "origin": "...", "destination": "..." }';
  return [
    'Tarea de investigación de viajes. Usa SOLO las herramientas web_search (para localizar páginas) y web_fetch (para leerlas), y SOLO en los dominios autorizados de las herramientas:',
    j,
    '',
    'Reglas estrictas:',
    '- La fuente del precio es SIEMPRE la página externa que leíste (source_url real), NUNCA tu conocimiento.',
    '- price_cents solo si la página mostró un precio verificable, en centavos enteros; si no lo viste, usa null.',
    '- No inventes URLs ni precios. source_url debe ser una URL que realmente encontraste o leíste.',
    '',
    'Cuando termines, responde ÚNICAMENTE con un bloque JSON (sin texto adicional después):',
    '```json',
    '{ "findings": [ ' + shape + ' ] }',
    '```',
    'Si no hallaste nada verificable, devuelve exactamente { "findings": [] }.'
  ].join('\n');
}

const OUTPUT_CONTRACT =
  'Devuelve los hallazgos como un único objeto JSON { "findings": [...] } en un bloque ```json al final. ' +
  'Cada finding lleva source_url (obligatorio, URL real de dominio autorizado) y price_cents (entero o null).';

/* ---------------- parseo tolerante del JSON final ---------------- */
function tryParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function sliceBalanced(text, start) {
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

function parseLastJsonObject(text) {
  if (!text) return null;
  // 1) bloques ```json ... ``` (el último válido gana)
  const fences = [];
  const re = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m;
  while ((m = re.exec(text)) !== null) fences.push(m[1]);
  for (let i = fences.length - 1; i >= 0; i--) {
    const p = tryParse(fences[i].trim());
    if (p && typeof p === 'object') return p;
  }
  // 2) fallback: último objeto {...} que contenga "findings"
  const idx = text.lastIndexOf('"findings"');
  if (idx !== -1) {
    const start = text.lastIndexOf('{', idx);
    const sub = sliceBalanced(text, start);
    const p = sub && tryParse(sub);
    if (p && typeof p === 'object') return p;
  }
  return null;
}

function coerceFinding(f) {
  if (!f || typeof f !== 'object') return null;
  const url = typeof f.source_url === 'string' ? f.source_url.trim() : '';
  if (!url) return null;                                  // sin fuente → descartar
  const out = { source_url: url };
  out.price_cents = (typeof f.price_cents === 'number' && isFinite(f.price_cents) && f.price_cents >= 0)
    ? Math.round(f.price_cents) : null;
  if (typeof f.currency === 'string' && f.currency.trim()) out.currency = f.currency.trim();
  if (typeof f.airline === 'string') out.airline = f.airline;
  if (typeof f.hotel_name === 'string') out.hotel_name = f.hotel_name;
  if (typeof f.origin === 'string') out.origin = f.origin;
  if (typeof f.destination === 'string') out.destination = f.destination;
  return out;
}

function extractFindings(content) {
  const text = (Array.isArray(content) ? content : [])
    .filter(function (b) { return b && b.type === 'text' && typeof b.text === 'string'; })
    .map(function (b) { return b.text; })
    .join('\n');
  const obj = parseLastJsonObject(text);
  const arr = (obj && Array.isArray(obj.findings)) ? obj.findings : [];
  return arr.map(coerceFinding).filter(Boolean);
}

/* ---------------- fábrica del cliente ---------------- */
/**
 * Devuelve un cliente con la interfaz que el core espera:
 *   client.messages({ model, system, input, tools }) -> resp normalizada
 * @param {{apiKey:string, maxTokens?:number, maxPauseTurns?:number}} cfg
 */
function makeAnthropicResearchClient(cfg) {
  cfg = cfg || {};
  if (!Anthropic) throw new Error('missing_dependency: instala @anthropic-ai/sdk (npm install)');
  if (!cfg.apiKey) throw new Error('missing_api_key');
  const sdk = new Anthropic({ apiKey: cfg.apiKey });
  const maxTokens = cfg.maxTokens || DEFAULT_MAX_TOKENS;
  const maxPause = cfg.maxPauseTurns == null ? DEFAULT_MAX_PAUSE_TURNS : cfg.maxPauseTurns;

  return {
    messages: async function (req) {
      req = req || {};
      const sys = (req.system ? req.system + '\n\n' : '') + OUTPUT_CONTRACT;
      let messages = [{ role: 'user', content: buildUserText(req.input) }];
      const acc = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, web_search_requests: 0, web_fetch_requests: 0 };
      let lastContent = [];
      let modelVersion = null;
      let guard = 0;

      while (true) {
        const msg = await sdk.messages.create({
          model: req.model,
          max_tokens: maxTokens,
          system: sys,
          messages: messages,
          tools: req.tools || []
        });
        modelVersion = msg.model || modelVersion;
        const u = msg.usage || {};
        const stu = u.server_tool_use || {};
        acc.input_tokens += u.input_tokens || 0;
        acc.output_tokens += u.output_tokens || 0;
        acc.cache_read_tokens += u.cache_read_input_tokens || 0;      // normaliza nombres SDK → core
        acc.cache_write_tokens += u.cache_creation_input_tokens || 0;
        acc.web_search_requests += stu.web_search_requests || 0;
        acc.web_fetch_requests += stu.web_fetch_requests || 0;
        lastContent = msg.content || [];

        if (msg.stop_reason === 'pause_turn' && guard < maxPause) {
          guard++;
          messages = messages.concat([{ role: 'assistant', content: msg.content }]);
          continue;                                                   // reanuda el mismo turno
        }
        break;
      }

      return {
        usage: {
          input_tokens: acc.input_tokens, output_tokens: acc.output_tokens,
          cache_read_tokens: acc.cache_read_tokens, cache_write_tokens: acc.cache_write_tokens,
          server_tool_use: { web_search_requests: acc.web_search_requests, web_fetch_requests: acc.web_fetch_requests }
        },
        content: lastContent,
        output: { findings: extractFindings(lastContent) },
        model_version: modelVersion
      };
    }
  };
}

module.exports = {
  makeAnthropicResearchClient,
  // exportadas para pruebas del parser (no requieren el SDK ni red)
  buildUserText, parseLastJsonObject, coerceFinding, extractFindings,
  sdkAvailable: function () { return !!Anthropic; }
};
