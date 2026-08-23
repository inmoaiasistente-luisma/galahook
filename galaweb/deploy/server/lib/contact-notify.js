'use strict';

/* =========================================================
   Galápagos Hook Adventure — correos de la bandeja de contacto
   ---------------------------------------------------------
   Envía, con Resend y best-effort (NUNCA lanza hacia arriba):
     · aviso INTERNO al buzón del owner, con reply-to = correo del
       visitante (así el owner responde directo desde Outlook);
     · confirmación automática al visitante SI dejó email.

   Destinatario interno: CONTACT_NOTIFICATION_EMAIL si está definido;
   si no, BOOKING_NOTIFICATION_EMAIL (el mismo buzón de las reservas).

   No usa el "ledger" de correos de reservas (ese va atado a un booking_id):
   el mensaje ya quedó guardado en contact_messages, el correo es solo aviso.
   ========================================================= */

const { getResend, getMailConfig } = require('./resend');
const { logServer, isEmail, normalizeEmail } = require('./http');

const BRAND = 'Galápagos Hook Adventure';
const INK = '#11302f', GOLD = '#cf9f54', PAPER = '#fbf8f1', SOFT = '#3c534f', LINE = '#e2ddd0';

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Envoltorio HTML de marca (tablas, compatible con Outlook). */
function shell(title, innerHtml) {
  return '<!doctype html><html><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc(title) + '</title></head>'
    + '<body style="margin:0;padding:0;background:' + PAPER + ';">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + PAPER + ';padding:24px 12px;">'
    + '<tr><td align="center">'
    + '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ' + LINE + ';border-radius:12px;overflow:hidden;font-family:Helvetica,Arial,sans-serif;">'
    + '<tr><td style="background:' + INK + ';padding:18px 26px;">'
    + '<div style="color:' + PAPER + ';font-size:19px;font-weight:700;letter-spacing:.02em;">' + BRAND + '</div>'
    + '<div style="color:' + GOLD + ';font-size:12px;letter-spacing:.14em;text-transform:uppercase;margin-top:4px;">San Cristóbal · Galápagos</div>'
    + '</td></tr>'
    + '<tr><td style="padding:26px;color:' + INK + ';font-size:15px;line-height:1.6;">' + innerHtml + '</td></tr>'
    + '</table></td></tr></table></body></html>';
}

function rows(pairs) {
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ' + LINE + ';border-radius:8px;overflow:hidden;margin:6px 0 18px;">'
    + pairs.filter(Boolean).map(function (p, i) {
      return '<tr style="background:' + (i % 2 ? '#faf8f3' : '#ffffff') + ';">'
        + '<td style="padding:9px 14px;color:' + SOFT + ';font-size:12px;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;vertical-align:top;">' + esc(p[0]) + '</td>'
        + '<td style="padding:9px 14px;color:' + INK + ';font-weight:600;">' + p[1] + '</td></tr>';
    }).join('') + '</table>';
}

function sourceLabel(s) {
  return s === 'visit_nudge' ? 'Aviso de visitante recurrente' : 'Formulario de contacto';
}

/* ---------------- plantillas ---------------- */
function buildOwnerEmail(m) {
  const subject = 'Nuevo mensaje de contacto — ' + (m.name || 'sin nombre');
  const contactBits = [];
  if (m.email) contactBits.push('<a href="mailto:' + esc(m.email) + '" style="color:' + INK + ';">' + esc(m.email) + '</a>');
  if (m.phone) contactBits.push('WhatsApp: ' + esc(m.phone));
  const inner =
    '<div style="font-size:22px;font-weight:700;color:' + INK + ';margin:0 0 4px;">Nuevo mensaje de contacto</div>'
    + '<div style="font-size:14px;color:' + SOFT + ';margin:0 0 18px;">Un visitante escribió desde el sitio.</div>'
    + rows([
        ['Nombre', esc(m.name)],
        ['Contacto', contactBits.join('<br>') || '—'],
        m.interest ? ['Interés', esc(m.interest)] : null,
        ['Origen', esc(sourceLabel(m.source)) + (m.source_page ? ' · ' + esc(m.source_page) : '')],
        m.country ? ['País', esc(m.country)] : null
      ])
    + (m.message
        ? '<div style="color:' + SOFT + ';font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin:0 0 6px;">Mensaje</div>'
          + '<div style="border:1px solid ' + LINE + ';border-radius:8px;padding:12px 14px;background:#faf8f3;white-space:pre-wrap;color:' + INK + ';">' + esc(m.message) + '</div>'
        : '')
    + (m.email
        ? '<p style="margin:18px 0 0;color:' + SOFT + ';font-size:13px;">Responde directamente a este correo para contestarle al visitante.</p>'
        : '<p style="margin:18px 0 0;color:' + SOFT + ';font-size:13px;">El visitante dejó WhatsApp. Escríbele por WhatsApp para responder.</p>');
  const text = 'Nuevo mensaje de contacto\n'
    + 'Nombre: ' + (m.name || '') + '\n'
    + (m.email ? 'Email: ' + m.email + '\n' : '')
    + (m.phone ? 'WhatsApp: ' + m.phone + '\n' : '')
    + (m.interest ? 'Interés: ' + m.interest + '\n' : '')
    + 'Origen: ' + sourceLabel(m.source) + (m.source_page ? ' · ' + m.source_page : '') + '\n'
    + (m.message ? '\nMensaje:\n' + m.message + '\n' : '');
  return { subject: subject, html: shell(subject, inner), text: text };
}

function buildClientAck(m) {
  const subject = 'We received your message · Recibimos tu mensaje';
  const inner =
    '<div style="font-size:22px;font-weight:700;color:' + INK + ';margin:0 0 4px;">Thank you for reaching out!</div>'
    + '<div style="font-size:15px;color:' + SOFT + ';margin:0 0 18px;">¡Gracias por escribirnos!</div>'
    + '<p style="margin:0 0 6px;color:' + INK + ';">Hi ' + esc(m.name) + ', we received your message and a local from our family — not a call centre — will get back to you soon.</p>'
    + '<p style="margin:0 0 18px;color:' + SOFT + ';">Hola ' + esc(m.name) + ', recibimos tu mensaje y un local de nuestra familia — no un call center — te responderá pronto.</p>'
    + (m.message
        ? '<div style="color:' + SOFT + ';font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin:0 0 6px;">Your message · Tu mensaje</div>'
          + '<div style="border:1px solid ' + LINE + ';border-radius:8px;padding:12px 14px;background:#faf8f3;white-space:pre-wrap;color:' + INK + ';">' + esc(m.message) + '</div>'
        : '')
    + '<p style="margin:18px 0 0;color:' + SOFT + ';font-size:13px;">' + esc(BRAND) + ' · San Cristóbal, Galápagos</p>';
  const text = 'Thank you for reaching out! / ¡Gracias por escribirnos!\n\n'
    + 'Hi ' + (m.name || '') + ', we received your message and will get back to you soon.\n'
    + 'Hola ' + (m.name || '') + ', recibimos tu mensaje y te responderemos pronto.\n'
    + (m.message ? '\nYour message / Tu mensaje:\n' + m.message + '\n' : '');
  return { subject: subject, html: shell(subject, inner), text: text };
}

/* ---------------- envío (best-effort) ---------------- */
function ownerRecipient(cfg) {
  return normalizeEmail(process.env.CONTACT_NOTIFICATION_EMAIL || cfg.notifyTo || '');
}

async function sendOne(payload) {
  const resp = await getResend().emails.send(payload);
  if (!resp || resp.error) throw new Error('resend error');
  if (!resp.data || !resp.data.id) throw new Error('resend: sin id');
  return resp.data.id;
}

/**
 * Envía aviso interno + confirmación al cliente. NUNCA lanza.
 * @param {object} m fila de contact_messages (name, email, phone, interest, message, source, source_page, country)
 * @returns {Promise<{owner:string, client:string}>} estado por destinatario
 */
async function sendContactEmails(m) {
  const out = { owner: 'skipped', client: 'skipped' };
  let cfg;
  try { cfg = getMailConfig(); }
  catch (e) { logServer('contact-notify', 'mail config: ' + (e && e.message)); return out; }

  // 1) aviso interno al owner (reply-to = correo del visitante si lo dejó)
  try {
    const to = ownerRecipient(cfg);
    if (isEmail(to)) {
      const t = buildOwnerEmail(m);
      const payload = { from: cfg.from, to: [to], subject: t.subject, html: t.html, text: t.text };
      const replyTo = isEmail(normalizeEmail(m.email || '')) ? normalizeEmail(m.email) : cfg.replyTo;
      if (replyTo) payload.replyTo = replyTo;
      await sendOne(payload);
      out.owner = 'sent';
    } else { out.owner = 'no_recipient'; }
  } catch (e) { out.owner = 'failed'; logServer('contact-notify', 'owner: ' + (e && e.message)); }

  // 2) confirmación al visitante (solo si dejó email)
  try {
    const client = normalizeEmail(m.email || '');
    if (isEmail(client)) {
      const t = buildClientAck(m);
      const payload = { from: cfg.from, to: [client], subject: t.subject, html: t.html, text: t.text };
      if (cfg.replyTo) payload.replyTo = cfg.replyTo;
      await sendOne(payload);
      out.client = 'sent';
    } else { out.client = 'no_recipient'; }
  } catch (e) { out.client = 'failed'; logServer('contact-notify', 'client: ' + (e && e.message)); }

  return out;
}

module.exports = { sendContactEmails, buildOwnerEmail, buildClientAck, ownerRecipient };
