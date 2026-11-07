'use strict';

/* Doble en memoria del cliente de Supabase para probar handlers reales sin red.
   Cubre lo que usan las reseñas, la sesión admin y el limitador: select con
   conteo, eq/gte/lt/in, order, range/limit, single/maybeSingle, insert, update,
   upsert y delete. `fail[tabla]` hace que esa tabla devuelva un error. */

const crypto = require('crypto');

function createFakeSupabase(seed) {
  const db = { tables: Object.assign({}, seed || {}), fail: {}, unique: {}, writes: [] };

  function rows(table) {
    if (!db.tables[table]) db.tables[table] = [];
    return db.tables[table];
  }

  function from(table) {
    const state = { op: 'select', filters: [], orderBy: null, offset: 0, max: null, head: false, count: false, payload: null, mode: 'many', fields: null };
    const q = {
      select(fields, opts) {
        if (state.op === 'select') state.fields = fields;
        state.count = !!(opts && opts.count);
        state.head = !!(opts && opts.head);
        return q;
      },
      insert(payload) { state.op = 'insert'; state.payload = payload; return q; },
      update(payload) { state.op = 'update'; state.payload = payload; return q; },
      upsert(payload, opts) { state.op = 'upsert'; state.payload = payload; state.conflict = opts && opts.onConflict; return q; },
      delete() { state.op = 'delete'; return q; },
      eq(k, v) { state.filters.push(function (r) { return r[k] === v; }); return q; },
      gte(k, v) { state.filters.push(function (r) { return r[k] >= v; }); return q; },
      lt(k, v) { state.filters.push(function (r) { return r[k] < v; }); return q; },
      not(k, op, v) { state.filters.push(function (r) { return r[k] !== v; }); return q; },
      is(k, v) { state.filters.push(function (r) { return r[k] === v; }); return q; },
      order(k, opts) { state.orderBy = { k: k, asc: !opts || opts.ascending !== false }; return q; },
      range(a, b) { state.offset = a; state.max = b - a + 1; return q; },
      limit(n) { state.max = n; return q; },
      single() { state.mode = 'single'; return run(); },
      maybeSingle() { state.mode = 'maybe'; return run(); },
      then(ok, no) { return run().then(ok, no); }
    };

    function match() {
      return rows(table).filter(function (r) { return state.filters.every(function (f) { return f(r); }); });
    }

    function shape(list) {
      const count = list.length;
      if (state.orderBy) {
        const o = state.orderBy;
        list = list.slice().sort(function (a, b) {
          if (a[o.k] === b[o.k]) return 0;
          return (a[o.k] < b[o.k] ? -1 : 1) * (o.asc ? 1 : -1);
        });
      }
      if (state.max != null) list = list.slice(state.offset, state.offset + state.max);
      if (state.head) return { data: null, error: null, count: count };
      if (state.fields && state.fields !== '*') {
        const keys = state.fields.split(',').map(function (s) { return s.trim(); });
        list = list.map(function (r) {
          const o = {};
          keys.forEach(function (k) { o[k] = r[k] === undefined ? null : r[k]; });
          return o;
        });
      }
      if (state.mode === 'single') {
        if (list.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'no rows' } };
        return { data: list[0], error: null };
      }
      if (state.mode === 'maybe') return { data: list[0] || null, error: null };
      return { data: list, error: null, count: state.count ? count : null };
    }

    async function run() {
      if (db.fail[table]) return { data: null, error: db.fail[table], count: null };
      if (state.op === 'select') return shape(match());
      if (state.op === 'delete') {
        const gone = match();
        db.tables[table] = rows(table).filter(function (r) { return gone.indexOf(r) === -1; });
        return { data: null, error: null };
      }
      db.writes.push({ table: table, op: state.op, payload: state.payload });
      if (state.op === 'insert') {
        const row = Object.assign({ id: crypto.randomUUID(), created_at: new Date().toISOString() }, state.payload);
        const key = db.unique[table];
        if (key && rows(table).some(function (r) { return r[key] === row[key]; })) {
          return { data: null, error: { code: '23505', message: 'duplicate key value' } };
        }
        rows(table).push(row);
        return shape([row]);
      }
      if (state.op === 'upsert') {
        const key = state.conflict;
        const found = rows(table).filter(function (r) { return r[key] === state.payload[key]; })[0];
        if (found) { Object.assign(found, state.payload); return shape([found]); }
        rows(table).push(Object.assign({}, state.payload));
        return shape([state.payload]);
      }
      const hit = match();
      hit.forEach(function (r) { Object.assign(r, state.payload); });
      return shape(hit);
    }

    return q;
  }

  return { from: from, db: db };
}

module.exports = { createFakeSupabase };
