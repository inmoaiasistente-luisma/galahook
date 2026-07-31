'use strict';

/* =========================================================
   Pruebas — Fase 9, correcciones en Preview
   ---------------------------------------------------------
   A) Reservas por defecto / calendario / tabla sin scroll (por fuente).
   B) Subida real de documentos: lib PURA + estructura de endpoints,
      migración 0020, router/vercel y frontend.
   Sin red, sin Storage: la subida real solo puede probarla el owner en
   Preview con el bucket creado (0020 aplicada).
   ========================================================= */

const fs = require('fs');
const path = require('path');
const BASE = path.resolve(__dirname, '..');
const docs = require(BASE + '/server/lib/booking-documents');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }

const adm = read('assets/js/admin.js');
const html = read('admin.html');

/* =======================================================================
   A) RESERVAS / CALENDARIO / TABLA
   ======================================================================= */

ok('1 Reservas arranca mostrando TODAS: en modo tabla from/to vacíos, sin loadCal',
  /if\(isCal\)\{[\s\S]*?loadCal\(\); loadTable\(\);[\s\S]*?\}else\{[\s\S]*?fromF\.input\.value=''; toF\.input\.value='';[\s\S]*?loadTable\(\);/.test(adm));

ok('2 el arranque ya NO prefiltra siempre al mes actual',
  !/\(function\(\)\{ const b=bkMonthBounds\(state\.y,state\.m\); fromF\.input\.value=b\[0\]; toF\.input\.value=b\[1\]; \}\)\(\);\s*\n\s*loadCal\(\); loadTable\(\); loadFinance\(\);/.test(adm));

ok('3 loadCal solo corre en la pantalla Calendario',
  /function loadCal\(\)\{\s*if\(!isCal\) return;/.test(adm));

ok('4 "Ver todo" limpia fechas y muestra todas; "Hoy" y "Este mes" filtran',
  /allB\.addEventListener[\s\S]*?fromF\.input\.value=''; toF\.input\.value='';/.test(adm) &&
  /dayB\.addEventListener[\s\S]*?state\.selected=bkToday\(\)/.test(adm) &&
  /monthB\.addEventListener\('click',function\(\)\{ const d=new Date\(\); goMonth/.test(adm));

ok('5 la búsqueda funciona por código, cliente o tour',
  /Código, cliente o tour|Code, customer or tour/.test(adm) &&
  /searchInput\.addEventListener\('keydown'/.test(adm));

/* Tabla sin scroll horizontal en desktop. */
ok('6 la tabla usa table-layout:fixed y ellipsis; el min-width fijo se fue del desktop',
  /table\.bk-table\{width:100%;border-collapse:collapse;font-size:13\.5px;table-layout:fixed;\}/.test(html) &&
  /table\.bk-table tbody td\{[^}]*text-overflow:ellipsis/.test(html));

ok('7 el contenedor no desplaza en horizontal en desktop (solo vertical)',
  /\.bk-table-wrap\{[^}]*overflow-x:hidden;overflow-y:auto/.test(html));

ok('8 en móvil SÍ se permite scroll horizontal con ancho mínimo',
  /@media\(max-width:760px\)[\s\S]*?\.bk-table-wrap\{max-height:none;overflow-x:auto;\}[\s\S]*?table\.bk-table\{table-layout:auto;min-width:760px;\}/.test(html));

ok('9 la tabla emite un colgroup con anchos por columna',
  /const COLW = isStaff/.test(adm) && /'<colgroup>'\+COLW\.map/.test(adm));

ok('10 el calendario abre el MISMO detalle unificado (una sola ruta de detalle)',
  /function openDetail\(b\)\{ if\(isStaff\) bkStaffDetail\(b\); else bkAdminDetail\(b/.test(adm));

/* =======================================================================
   B) SUBIDA REAL DE DOCUMENTOS — lib pura
   ======================================================================= */

ok('11 extensiones permitidas: jpg/jpeg/png/webp/pdf/doc/docx',
  docs.ALLOWED_EXT.length === 7 &&
  ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'doc', 'docx'].every(function (e) { return docs.ALLOWED_EXT.indexOf(e) !== -1; }));

const okPdf = docs.validateUpload({ filename: 'Ticket AV1630.pdf', mime_type: 'application/pdf', file_size: 200000 });
ok('12 subida válida (PDF): saneada, con ext/mime/size',
  okPdf.ok === true && okPdf.meta.filename === 'Ticket_AV1630.pdf' && okPdf.meta.ext === 'pdf' && okPdf.meta.file_size === 200000);

ok('13 acepta imagen y docx',
  docs.validateUpload({ filename: 'foto.PNG', mime_type: 'image/png', file_size: 1000 }).ok === true &&
  docs.validateUpload({ filename: 'carta.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', file_size: 1000 }).ok === true);

ok('14 rechaza extensión no permitida (.exe)',
  docs.validateUpload({ filename: 'virus.exe', mime_type: 'application/octet-stream', file_size: 10 }).code === 'BAD_EXTENSION');

ok('15 rechaza MIME que no corresponde a la extensión',
  docs.validateUpload({ filename: 'x.pdf', mime_type: 'image/png', file_size: 10 }).code === 'BAD_MIME');

ok('16 rechaza tamaño inválido y tamaño excesivo',
  docs.validateUpload({ filename: 'x.pdf', mime_type: 'application/pdf', file_size: 0 }).code === 'BAD_SIZE' &&
  docs.validateUpload({ filename: 'x.pdf', mime_type: 'application/pdf', file_size: docs.maxBytes() + 1 }).code === 'FILE_TOO_LARGE');

ok('17 el límite de tamaño es configurable por entorno',
  (function () {
    const prev = process.env.DOCUMENT_MAX_BYTES;
    process.env.DOCUMENT_MAX_BYTES = '1000';
    const small = docs.maxBytes() === 1000;
    const rej = docs.validateUpload({ filename: 'x.pdf', mime_type: 'application/pdf', file_size: 2000 }).code === 'FILE_TOO_LARGE';
    if (prev == null) delete process.env.DOCUMENT_MAX_BYTES; else process.env.DOCUMENT_MAX_BYTES = prev;
    return small && rej;
  })());

ok('18 sanea el nombre: descarta la ruta por completo, sin caracteres raros, nunca vacío',
  docs.sanitizeFilename('../../etc/passwd') === 'passwd' &&      // solo el nombre base
  docs.sanitizeFilename('a b*c?.pdf') === 'a_b_c_.pdf' &&
  docs.sanitizeFilename('') === 'archivo' &&
  docs.sanitizeFilename('C:\\Users\\x\\ticket.pdf') === 'ticket.pdf');

ok('19 la ruta de Storage es tenant/booking/document/filename',
  docs.buildStoragePath('hook-adventure', 'bk1', 'doc1', 'a b.pdf') === 'hook-adventure/bk1/doc1/a_b.pdf');

ok('20 el staff nunca ve documentos con dinero (recibos)',
  docs.STAFF_HIDDEN_DOCS.indexOf('receipt') !== -1 && docs.BUCKET === 'booking-documents');

/* =======================================================================
   B) SUBIDA REAL — endpoints (estructura)
   ======================================================================= */

const up = read('server/admin-handlers/booking-document-upload-url.js');
ok('21 upload-url: solo owner + sameOrigin + valida con la lib',
  /requireWriter\(req, res\)/.test(up) && /sameOrigin\(req\)/.test(up) && /docs\.validateUpload\(/.test(up));
ok('22 upload-url: crea URL firmada de subida y deja la fila pendiente (active:false)',
  /createSignedUploadUrl\(/.test(up) && /active: false/.test(up) && /source: 'upload'/.test(up));
ok('23 upload-url: si el bucket no existe responde STORAGE_NOT_READY (0020 sin aplicar)',
  /STORAGE_NOT_READY/.test(up));

const conf = read('server/admin-handlers/booking-document-confirm.js');
ok('24 confirm: solo owner, verifica que el objeto existe y marca active:true',
  /requireWriter\(req, res\)/.test(conf) && /objectExists\(/.test(conf) && /active: true/.test(conf) && /uploaded_at:/.test(conf));

const dl = read('server/admin-handlers/booking-document-download-url.js');
ok('25 download-url: lo usan owner/admin/staff y devuelve URL FIRMADA temporal',
  /requireAdmin\(req, res, \['owner', 'admin', 'staff'\]\)/.test(dl) && /createSignedUrl\(/.test(dl) && /SIGN_TTL/.test(dl));
ok('26 download-url: el staff no obtiene documentos financieros',
  /session\.role === 'staff' && docs\.STAFF_HIDDEN_DOCS/.test(dl) && /FORBIDDEN/.test(dl));
ok('27 download-url: NO expone la ruta interna de Storage al cliente',
  !/storage_path:/.test(dl.slice(dl.indexOf('sendJson'))));

const send = read('server/admin-handlers/booking-communication-send.js');
ok('28 send: adjunta los bytes del archivo subido (descarga de Storage)',
  /storage\.from\(BUCKET\)\.download\(doc\.storage_path\)/.test(send) && /attachments\.push\(\{ filename:/.test(send));
ok('29 send: si el archivo es grande o falla, manda un enlace FIRMADO temporal',
  /ATTACH_MAX_BYTES/.test(send) && /createSignedUrl\(doc\.storage_path, 3600\)/.test(send));
ok('30 send: marca sent_to_passenger_at tras enviar con éxito',
  /sent_to_passenger_at: new Date\(\)\.toISOString\(\)/.test(send));

const save = read('server/admin-handlers/booking-document-save.js');
ok('31 el alta de enlace externo NO fija source (default link) → sirve aunque 0020 no esté',
  !/source: 'link'/.test(save) && /action:'remove'|action === 'remove'/.test(save));

/* =======================================================================
   B) SUBIDA REAL — migración 0020 (creada, no aplicada)
   ======================================================================= */

const m20 = read('supabase/migrations/0020_booking_document_uploads.sql');
ok('32 0020 crea el bucket PRIVADO booking-documents con límite y tipos',
  /insert into storage\.buckets/.test(m20) && /'booking-documents'/.test(m20) &&
  /false, 15728640/.test(m20) && /allowed_mime_types/.test(m20));
ok('33 0020 añade metadatos de subida y hace url NULLABLE',
  /add column if not exists source/.test(m20) && /add column if not exists storage_path/.test(m20) &&
  /add column if not exists file_size/.test(m20) && /alter column url drop not null/.test(m20));
ok('34 0020 exige coherencia: enlace→url, subida→storage_path',
  /chk_bdoc_source_ref/.test(m20) && /source = 'link'   and url is not null/.test(m20) && /source = 'upload' and storage_path is not null/.test(m20));
ok('35 0020 NO borra tablas ni columnas (aditiva)',
  !/drop table/i.test(m20) && !/drop column/i.test(m20));
ok('36 0020 no crea políticas anon/authenticated (bucket privado, solo backend)',
  !/create policy/i.test(m20));

/* =======================================================================
   B) SUBIDA REAL — router / vercel / frontend
   ======================================================================= */

const router = read('api/admin-router.js');
ok('37 el router registra los tres endpoints de subida',
  /ROUTES\['booking-document-upload-url'\]/.test(router) &&
  /ROUTES\['booking-document-confirm'\]/.test(router) &&
  /ROUTES\['booking-document-download-url'\]/.test(router));

const vj = JSON.parse(read('vercel.json'));
const wantRoutes = ['/api/admin-booking-document-upload-url', '/api/admin-booking-document-confirm', '/api/admin-booking-document-download-url'];
ok('38 vercel.json expone las rutas de subida', wantRoutes.every(function (p) { return vj.rewrites.some(function (r) { return r.source === p; }); }));
(function () {
  const seen = {}, dups = [];
  vj.rewrites.forEach(function (r) { if (seen[r.source]) dups.push(r.source); seen[r.source] = 1; });
  ok('39 vercel.json sin rutas duplicadas', dups.length === 0);
})();

ok('40 frontend: subir archivo es el flujo PRINCIPAL (input file + progreso + confirmar)',
  /Subir archivo|Upload file/.test(adm) && /admin-booking-document-upload-url/.test(adm) &&
  /admin-booking-document-confirm/.test(adm) && /up-progress/.test(adm) && /XMLHttpRequest/.test(adm));
ok('41 frontend: valida la extensión antes de subir y muestra errores claros',
  /function bkExtOk\(/.test(adm) && /function bkUploadErr\(/.test(adm) && /FILE_TOO_LARGE/.test(adm));
ok('42 frontend: Ver/Descargar pide URL firmada; el enlace externo es alternativa secundaria',
  /admin-booking-document-download-url/.test(adm) && /…o pegar un enlace externo|…or paste an external link/.test(adm));
ok('43 frontend: eliminar pide confirmación y es baja lógica (owner)',
  /¿Retirar este documento|Remove this document/.test(adm) && /action:'remove'/.test(adm));
ok('44 frontend: lista con etiqueta, tamaño y quién lo subió',
  /bkFileSize\(/.test(adm) && /uploaded_by_name/.test(adm) && /bk-doc-meta/.test(adm));
ok('45 CSS: barra de progreso dorada sobre arena',
  /\.up-progress > i\{[^}]*background:var\(--a-gold\)/.test(html));

ok('46 la subida firmada usa PUT con x-upsert + content-type (como el SDK)',
  /xhr\.open\('PUT', info\.signed_url/.test(adm) &&
  /setRequestHeader\('x-upsert','false'\)/.test(adm) &&
  /setRequestHeader\('content-type'/.test(adm));

/* =======================================================================
   C) RONDA DE CORRECCIONES FINALES
   ======================================================================= */

/* Calendario — la causa raíz era loadFinance tocando chanF null. */
ok('47 loadFinance no rompe el calendario: guarda isConnected + null en chanF/methF',
  /if\(!finance\.isConnected\) return;/.test(adm) &&
  /if\(chanF && chanF\.select\.value\)/.test(adm) && /if\(methF && methF\.select\.value\)/.test(adm));
ok('48 el calendario dibuja la rejilla de inmediato (no depende del fetch)',
  /if\(isCal\)\{[\s\S]{0,160}renderCal\(\);\s*\/\/[^\n]*\n\s*loadCal\(\); loadTable\(\);/.test(adm));

/* Tabla — encabezados legibles. */
ok('49 encabezados sin truncar: padding y tipografía compactos, sin ellipsis en th',
  /table\.bk-table thead th\{[^}]*font-size:10\.5px;[^}]*padding:11px 9px;[^}]*overflow:visible/.test(html));
ok('50 columnas clave (código/total/estados/canal/acciones) no se recortan',
  /table\.bk-table td\.mono,table\.bk-table td\.num\{overflow:visible;\}/.test(html) &&
  /td\.bk-actions\{overflow:visible/.test(html));
ok('51 texto secundario con tooltip (title) en tour/cliente/teléfono',
  /<td class="ell" title="'\+escapeHtml\(b\.tour_name/.test(adm) && /title="'\+escapeHtml\(b\.customer_name/.test(adm));

/* Eliminar reserva owner-only. */
const del = read('server/admin-handlers/booking-delete.js');
ok('52 booking-delete: SOLO owner + sameOrigin + baja lógica (deleted_at) + auditoría',
  /requireWriter\(req, res\)/.test(del) && /sameOrigin\(req\)/.test(del) &&
  /deleted_at: new Date\(\)\.toISOString\(\)/.test(del) && /recordAudit\(session/.test(del));
ok('53 booking-delete: el servidor rellena la razón (owner no la escribe) y no toca Stripe',
  /DEFAULT_REASON/.test(del) && !/stripe/i.test(del.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')));
ok('54 UI: eliminar en la fila y en el detalle, solo si canWrite; con confirmación',
  /function bkDeleteBooking\(b, onDone\)/.test(adm) && /if\(!canWrite\(\)\) return;/.test(adm) &&
  /confirm\(/.test(adm.slice(adm.indexOf('function bkDeleteBooking'), adm.indexOf('function bkDeleteBooking') + 700)) &&
  /Eliminar reserva|Delete booking/.test(adm));
ok('55 insignia TEST en la tabla; is_test llega del servidor',
  /function bkTestBadge\(b\)/.test(adm) && /is_test/.test(read('server/admin-handlers/bookings.js')));
const vjD = JSON.parse(read('vercel.json'));
ok('56 vercel.json expone booking-delete', vjD.rewrites.some(function (r) { return r.source === '/api/admin-booking-delete'; }));

/* Configuración simplificada (D3/D4). */
const settings = adm.slice(adm.indexOf('function panelSettings('), adm.indexOf('function panelSettings(') + 900);
ok('57 Configuración sin Notificaciones ni Datos de prueba',
  settings.indexOf("id:'notif'") === -1 && settings.indexOf("id:'testdata'") === -1 &&
  settings.indexOf("id:'record'") !== -1 && settings.indexOf("id:'descuentos'") !== -1);

/* Detalle más ancho (D6). */
ok('58 el detalle usa ~92vw con tope y scroll interno',
  /\.bk-modal-card\{position:relative;width:92vw;max-width:1180px;max-height:90vh;overflow:auto/.test(html));

/* Formulario completo del pasajero (D7). */
ok('59 "Ver formulario completo" con todas las respuestas reales',
  /function bkFullPaxForm\(d,b\)/.test(adm) && /Ver formulario completo|View full form/.test(adm) &&
  /date_of_birth/.test(adm) && /dietary/i.test(adm) && /accessibility/i.test(adm));

/* Emails clickeables + cuerpo (D8). */
const detH = read('server/admin-handlers/booking-communication-detail.js');
ok('60 endpoint de detalle: owner/admin/staff, devuelve cuerpo, staff sin correos owner_',
  /requireAdmin\(req, res, \['owner', 'admin', 'staff'\]\)/.test(detH) &&
  /body_html/.test(detH) && /indexOf\('owner_'\) === 0\) return sendError\(res, 403/.test(detH));
ok('61 send/email-service guardan el cuerpo (best-effort si 0021 no está)',
  /body_html: tpl\.html, body_text: tpl\.text/.test(read('server/admin-handlers/booking-communication-send.js')) &&
  /subject: tpl\.subject, body_html: tpl\.html/.test(read('server/lib/booking-email-service.js')));
ok('62 UI: historial clickeable (manual + automáticos) que abre el cuerpo',
  /bk-log-click/.test(adm) && /admin-booking-communication-detail/.test(adm) && /bk-msg-body/.test(adm) &&
  /openMsg\('comm'/.test(adm) && /openMsg\('email'/.test(adm));
ok('63 booking-comms devuelve también los correos automáticos (emails)',
  /emails: emails/.test(read('server/admin-handlers/booking-comms.js')));

/* Migración 0021 (creada, no aplicada). */
const m21 = read('supabase/migrations/0021_communication_bodies.sql');
ok('64 0021 añade body_html/body_text a comunicaciones y correos; aditiva',
  /alter table public\.booking_communications[\s\S]*add column if not exists body_html/.test(m21) &&
  /alter table public\.email_notifications[\s\S]*add column if not exists body_html/.test(m21) &&
  !/drop table/i.test(m21) && !/drop column/i.test(m21));

console.log('\n=== RESULTADO FASE 9 CORRECCIONES: ' + pass + ' PASS · ' + fail + ' FAIL ===');
if (fail) process.exitCode = 1;
