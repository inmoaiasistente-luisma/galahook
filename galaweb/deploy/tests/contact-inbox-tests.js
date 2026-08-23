'use strict';

/* =========================================================
   Pruebas — Bandeja de mensajes de contacto (pedido interno)
   ---------------------------------------------------------
   A) Plantillas de correo PURAS (contact-notify): escape, pistas de
      respuesta, ack bilingüe, destinatario del owner.
   B) Estructura: migración 0023, endpoint público /api/contact-message,
      handlers admin (owner+admin), router/vercel, frontend (form + panel).
   Sin red ni BD: el flujo real solo se ve en Preview/Producción con 0023
   aplicada y las variables de correo configuradas (lo verifica el owner).
   ========================================================= */

const fs = require('fs');
const path = require('path');
const BASE = path.resolve(__dirname, '..');
const notify = require(BASE + '/server/lib/contact-notify');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }
function read(rel) { return fs.readFileSync(path.join(BASE, rel), 'utf8'); }

/* =======================================================================
   A) PLANTILLAS DE CORREO (PURAS)
   ======================================================================= */
const sampleOwner = notify.buildOwnerEmail({
  name: 'María <script>', email: 'maria@example.com', phone: null,
  interest: 'Diving', message: 'Hola & bienvenidos', source: 'contact_form',
  source_page: '/contact.html', country: 'US'
});
ok('1 owner: asunto con nombre', /Nuevo mensaje de contacto/.test(sampleOwner.subject));
ok('2 owner: escapa HTML del nombre (sin <script> crudo)', sampleOwner.html.indexOf('<script>') === -1 && /&lt;script&gt;/.test(sampleOwner.html));
ok('3 owner: escapa & del mensaje', /Hola &amp; bienvenidos/.test(sampleOwner.html));
ok('4 owner: con email → pista de "responde a este correo"', /Responde directamente a este correo/.test(sampleOwner.html));
ok('5 owner: incluye el email del visitante', sampleOwner.html.indexOf('maria@example.com') !== -1);
ok('6 owner: versión texto presente', typeof sampleOwner.text === 'string' && /Nombre: María/.test(sampleOwner.text));

const sampleOwnerPhone = notify.buildOwnerEmail({
  name: 'Bob', email: null, phone: '+593999999999', message: '', source: 'visit_nudge', source_page: '/'
});
ok('7 owner (solo teléfono): pista de WhatsApp', /Escríbele por WhatsApp/.test(sampleOwnerPhone.html));
ok('8 owner: etiqueta de origen "visitante recurrente"', /visitante recurrente/i.test(sampleOwnerPhone.html));

const ack = notify.buildClientAck({ name: 'Ann', email: 'ann@example.com', message: 'Quiero bucear' });
ok('9 ack: bilingüe (EN + ES)', /Thank you for reaching out/.test(ack.html) && /Gracias por escribirnos/.test(ack.html));
ok('10 ack: incluye el nombre', ack.html.indexOf('Ann') !== -1);
ok('11 ack: eco del mensaje del visitante', /Quiero bucear/.test(ack.html));

const prev = process.env.CONTACT_NOTIFICATION_EMAIL;
process.env.CONTACT_NOTIFICATION_EMAIL = 'OWNER@Example.com';
ok('12 ownerRecipient: usa CONTACT_NOTIFICATION_EMAIL (normalizado)', notify.ownerRecipient({ notifyTo: 'other@x.com' }) === 'owner@example.com');
delete process.env.CONTACT_NOTIFICATION_EMAIL;
ok('13 ownerRecipient: cae en cfg.notifyTo', notify.ownerRecipient({ notifyTo: 'Fallback@X.com' }) === 'fallback@x.com');
if (prev !== undefined) process.env.CONTACT_NOTIFICATION_EMAIL = prev;

/* =======================================================================
   B) MIGRACIÓN 0023
   ======================================================================= */
const mig = read('supabase/migrations/0023_contact_messages.sql');
ok('14 0023 crea contact_messages', /create table public\.contact_messages/.test(mig));
ok('15 0023 tenant_id text default hook-adventure', /tenant_id\s+text not null default 'hook-adventure'/.test(mig));
ok('16 0023 exige email O teléfono (chk_cm_contact)', /chk_cm_contact check \(email is not null or phone is not null\)/.test(mig));
ok('17 0023 check de status', /chk_cm_status\s+check \(status in \('new', 'read', 'replied', 'archived'\)\)/.test(mig));
ok('18 0023 check de source', /chk_cm_source\s+check \(source in \('contact_form', 'visit_nudge'\)\)/.test(mig));
ok('19 0023 NO guarda IP (sin columna ip)', !/\bip\b\s+(inet|text)/i.test(mig));
ok('20 0023 RLS enable + revoke', /enable row level security/.test(mig) && /revoke all on table public\.contact_messages from anon, authenticated/.test(mig));

/* =======================================================================
   C) ENDPOINT PÚBLICO /api/contact-message
   ======================================================================= */
const ep = read('api/contact-message.js');
ok('21 endpoint: solo POST', /req\.method !== 'POST'/.test(ep));
ok('22 endpoint: sameOrigin (CSRF)', /sameOrigin\(req\)/.test(ep));
ok('23 endpoint: honeypot company', /body\.company/.test(ep) && /ALLOWED_KEYS/.test(ep) && /'company'/.test(ep));
ok('24 endpoint: rate-limit por IP hasheada', /checkRateLimit/.test(ep) && /rateBucket/.test(ep) && /createHash\('sha256'\)/.test(ep));
ok('25 endpoint: exige email O teléfono', /CONTACT_REQUIRED/.test(ep) && /!email && !phone/.test(ep));
ok('26 endpoint: source restringido a la lista', /SOURCES\s*=\s*\['contact_form', 'visit_nudge'\]/.test(ep));
ok('27 endpoint: inserta en contact_messages', /from\('contact_messages'\)\.insert/.test(ep));
ok('28 endpoint: correos best-effort (no bloquean)', /sendContactEmails/.test(ep));
ok('29 endpoint: responde 201', /sendJson\(res, 201/.test(ep));
ok('30 endpoint: country viene de cabecera, no del cliente', /countryFromHeaders\(headers\)/.test(ep) && !/ALLOWED_KEYS = \[[^\]]*country/.test(ep));

/* =======================================================================
   D) HANDLERS ADMIN (owner + admin)
   ======================================================================= */
const list = read('server/admin-handlers/contact-messages-list.js');
ok('31 list: requireOwnerOrAdmin (owner y admin)', /requireOwnerOrAdmin\(req, res\)/.test(list));
ok('32 list: GET de solo lectura (no invoca sameOrigin, como los demás reads)', /req\.method !== 'GET'/.test(list) && !/sameOrigin\(req\)/.test(list));
ok('33 list: expone counts.new para la insignia', /counts: \{ new:/.test(list));
ok('34 list: tolera migración ausente (ready:false)', /ready: false/.test(list) && /isMissing/.test(list));
ok('35 list: valida filtro status', /STATUSES\.indexOf\(status\) === -1/.test(list));

const upd = read('server/admin-handlers/contact-message-update.js');
ok('36 update: requireOwnerOrAdmin', /requireOwnerOrAdmin\(req, res\)/.test(upd));
ok('37 update: sameOrigin + solo POST', /sameOrigin\(req\)/.test(upd) && /req\.method !== 'POST'/.test(upd));
ok('38 update: valida id UUID y status', /isUuid\(body\.id\)/.test(upd) && /STATUSES\.indexOf\(body\.status\)/.test(upd));
ok('39 update: registra handled_by/handled_at', /handled_by = session\.email/.test(upd) && /handled_at = new Date\(\)\.toISOString\(\)/.test(upd));
ok('40 update: al reabrir (new) limpia handled_*', /body\.status === 'new'/.test(upd) && /patch\.handled_by = null/.test(upd) && /patch\.handled_at = null/.test(upd));

/* =======================================================================
   E) ROUTER + VERCEL
   ======================================================================= */
const router = read('api/admin-router.js');
ok('41 router registra contact-messages', /ROUTES\['contact-messages'\] = require\('\.\.\/server\/admin-handlers\/contact-messages-list'\)/.test(router));
ok('42 router registra contact-message-update', /ROUTES\['contact-message-update'\] = require\('\.\.\/server\/admin-handlers\/contact-message-update'\)/.test(router));
const vercel = read('vercel.json');
ok('43 vercel rewrite admin-contact-messages', /"\/api\/admin-contact-messages"/.test(vercel) && /action=contact-messages"/.test(vercel));
ok('44 vercel rewrite admin-contact-message-update', /"\/api\/admin-contact-message-update"/.test(vercel) && /action=contact-message-update/.test(vercel));

/* =======================================================================
   F) FRONTEND — formulario público
   ======================================================================= */
const contact = read('contact.html');
ok('45 contact.html: campo teléfono/WhatsApp', /name="phone"/.test(contact));
ok('46 contact.html: honeypot company oculto', /name="company"/.test(contact) && /hp-field|left:-9999px/.test(contact));
ok('47 contact.html: botón "Enviar mensaje" (ya no "por WhatsApp")', /data-es="Enviar mensaje"/.test(contact) && !/data-wa-shortcut/.test(contact));
ok('48 contact.html: WhatsApp queda como secundario', /data-wa-secondary/.test(contact));
ok('49 contact.html: cache-buster app.js versionado', /app\.js\?v=[a-z0-9]+/.test(contact));

const app = read('assets/js/app.js');
ok('50 app.js: initForms postea al endpoint interno', /fetch\('\/api\/contact-message'/.test(app));
ok('51 app.js: source contact_form + página + idioma', /source:'contact_form'/.test(app) && /source_page:location\.pathname/.test(app) && /lang:L/.test(app));
ok('52 app.js: el submit YA NO abre WhatsApp', !/window\.open\(waLink\(msg\)/.test(app));
ok('53 app.js: exige nombre y (email o teléfono)', /!email && !phone/.test(app));

/* =======================================================================
   G) FRONTEND — panel admin (bandeja)
   ======================================================================= */
const adm = read('assets/js/admin.js');
ok('54 admin.js: panelMessages existe', /function panelMessages\(role\)/.test(adm));
ok('55 admin.js: entrada de menú "Mensajes" con insignia', /id:'messages'/.test(adm) && /id="msgBadge"/.test(adm));
ok('56 admin.js: insignia se refresca (owner y admin)', /function refreshMessagesBadge\(\)/.test(adm) && /refreshMessagesBadge\(\);/.test(adm));
ok('57 admin.js: lista desde /api/admin-contact-messages', /apiGet\('\/api\/admin-contact-messages/.test(adm));
ok('58 admin.js: cambia estado vía /api/admin-contact-message-update', /apiPost\('\/api\/admin-contact-message-update'/.test(adm));
ok('59 admin.js: responder por correo (mailto) o WhatsApp', /mailto:'\+encodeURIComponent\(m\.email\)/.test(adm) && /wa\.me\//.test(adm));
ok('60 admin.js: nav usa navLabel cuando existe', /def\.navLabel\|\|def\.label/.test(adm));

const html = read('admin.html');
ok('61 admin.html: cache-buster admin.js versionado', /admin\.js\?v=[a-z0-9]+/.test(html));

/* =======================================================================
   H) FASE B — aviso a visitantes recurrentes ("nudge") en app.js
   ======================================================================= */
ok('62 nudge: solo visitantes recurrentes (gha_first + umbral de regreso)', /K_FIRST='gha_first'/.test(app) && /RETURN_AFTER/.test(app) && /\(now\(\)-first\) < RETURN_AFTER/.test(app));
ok('63 nudge: no repite ~14 días (cooldown)', /COOLDOWN=14\*DAY/.test(app) && /K_NUDGE='gha_nudge'/.test(app) && /\(now\(\)-lastNudge\) < COOLDOWN/.test(app));
ok('64 nudge: solo páginas públicas (bloquea admin/pasajeros/checkin/lock/tarjeta)', /BLOCK=\['\/admin','\/passengers','\/checkin','\/lock','\/tarjeta'\]/.test(app));
ok('65 nudge: postea con source visit_nudge', /source:'visit_nudge'/.test(app) && /fetch\('\/api\/contact-message'/.test(app));
ok('66 nudge: honeypot company', /name="company"/.test(app) && /company:\(d\.company\|\|''\)/.test(app));
ok('67 nudge: exige nombre y (email o teléfono)', /!email && !phone/.test(app));
ok('68 nudge: texto EN con ES entre paréntesis + botón "Te ayudamos"', /We noticed your interest in Galápagos/.test(app) && /Notamos tu interés en Galápagos/.test(app) && /We can help · Te ayudamos/.test(app));
ok('69 nudge: descartable (cerrar / Escape / no gracias)', /data-dismiss/.test(app) && /e\.key==='Escape'/.test(app));
ok('70 nudge: marca cooldown al mostrarse (no en cada carga)', /setItem\(K_NUDGE, String\(now\(\)\)\)/.test(app));

/* ------------------------------------------------------------------ */
console.log('\n' + pass + ' PASS · ' + fail + ' FAIL');
if (fail) process.exit(1);
