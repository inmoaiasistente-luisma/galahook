'use strict';

/* =========================================================
   Pruebas — Fase C: Visitantes únicos (panel)
   ---------------------------------------------------------
   A) Lib PURA de agregación por visitante (aggregateVisitors, visitorCode).
   B) Estructura: handler page-views (visitor_id + visitors + recent sin id),
      panel admin (tiles únicos-primero + tabla "N×").
   Sin red ni BD.
   ========================================================= */

const fs = require('fs');
const path = require('path');
const BASE = path.resolve(__dirname, '..');
const pv = require(BASE + '/server/admin-handlers/page-views');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }

/* =======================================================================
   A) LIB PURA — aggregateVisitors / visitorCode
   ======================================================================= */
// Filas ordenadas de más NUEVA a más VIEJA (como las devuelve el handler).
const rows = [
  { created_at: '2026-08-23T18:00:00Z', path: '/tarjeta', country: 'US', device: 'mobile', visitor_id: 'aaaaaaaa-1111' },
  { created_at: '2026-08-23T12:00:00Z', path: '/index.html', country: 'US', device: 'mobile', visitor_id: 'aaaaaaaa-1111' },
  { created_at: '2026-08-22T09:00:00Z', path: '/tours.html', country: 'US', device: 'mobile', visitor_id: 'aaaaaaaa-1111' },
  { created_at: '2026-08-23T10:00:00Z', path: '/index.html', country: 'EC', device: 'desktop', visitor_id: 'bbbbbbbb-2222' },
  { created_at: '2026-08-21T10:00:00Z', path: '/index.html', country: null, device: null, visitor_id: null },
  { created_at: '2026-08-20T10:00:00Z', path: '/contact.html', country: null, device: null, visitor_id: null }
];
const agg = pv.aggregateVisitors(rows);

ok('1 agrupa por visitante (2 con id + 1 fila "sin identificar" = 3)', agg.length === 3);
const top = agg[0];
ok('2 ordena por número de visitas desc (el de 3 visitas primero)', top.visits === 3 && top.anon === false);
ok('3 "última vez" = visita más reciente del visitante', top.last === '2026-08-23T18:00:00Z');
ok('4 "primera vez" = visita más antigua del visitante', top.first === '2026-08-22T09:00:00Z');
ok('5 cuenta páginas distintas', top.pages === 3);
ok('6 conserva país/dispositivo del visitante', top.country === 'US' && top.device === 'mobile');
const anon = agg.filter(function (v) { return v.anon; })[0];
ok('7 las visitas sin id se suman en UNA fila "sin identificar"', !!anon && anon.visits === 2 && anon.code === null);
ok('8 total de visitas agregadas == filas de entrada', agg.reduce(function (a, v) { return a + v.visits; }, 0) === rows.length);

ok('9 visitorCode: código corto en mayúsculas sin guiones', pv.visitorCode('abcdef12-3456-7890') === 'ABCDEF');
ok('10 visitorCode: NO devuelve el id completo (privacidad)', pv.visitorCode('abcdef12-3456-7890').length <= 6);
ok('11 visitorCode: vacío/no-string → null', pv.visitorCode('') === null && pv.visitorCode(null) === null);

/* =======================================================================
   B) HANDLER page-views
   ======================================================================= */
const src = read('server/admin-handlers/page-views.js');
ok('12 select incluye visitor_id para agrupar', /\.select\('created_at, path, country, device, visitor_id'\)/.test(src));
ok('13 respuesta incluye visitors (agregado)', /visitors: visitors/.test(src));
ok('14 el registro detallado NO expone visitor_id', /const recent = data\.map\(function \(r\) \{ return \{ created_at: r\.created_at, path: r\.path, country: r\.country, device: r\.device \}; \}\)/.test(src));
ok('15 ready:false también devuelve visitors:[]', /ready: false, stats: ZERO, recent: \[\], visitors: \[\]/.test(src));

/* =======================================================================
   C) PANEL admin — tiles únicos-primero + tabla de visitantes
   ======================================================================= */
const adm = read('assets/js/admin.js');
ok('16 panel: tabla de visitantes (visPeopleWrap)', /id="visPeopleWrap"/.test(adm));
ok('17 panel: encabezado "Visitantes (personas únicas)"', /Visitantes \(personas únicas\)/.test(adm) && /Visitors \(unique people\)/.test(adm));
ok('18 panel: muestra "N×" por cliente', /num\(v\.visits\)\+'×/.test(adm));
ok('19 panel: personas únicas es el PRIMER tile (fuerte)', /tiles\.innerHTML=\s*[\r\n]*\s*tile\(ES\?'Personas únicas':'Unique people', num\(s\.unique_visitors\), true\)/.test(adm));
ok('20 panel: conserva la bitácora detallada', /Actividad detallada \(cada visita\)/.test(adm) && /visTableWrap/.test(adm));
ok('21 panel: fila "sin identificar" para anónimos', /Sin identificar/.test(adm) && /Unidentified/.test(adm));

/* ------------------------------------------------------------------ */
console.log('\n' + pass + ' PASS · ' + fail + ' FAIL');
if (fail) process.exit(1);
