/* Depósito del 30 % en el admin: ayudas de pintado (puras) y la acción
   "Saldo pagado por otro medio" (solo owner). Se expone como
   window.ghaAdminDeposit(deps); admin.js le pasa sus utilidades.
   Todo lo que viene del servidor o del usuario se escapa con escapeHtml. */
(function (root) {
  'use strict';

  var REASONS = {
    balance_paid_after_cancel: [
      'El cliente pagó el saldo después de cancelarse la reserva. Decide si reembolsas en Stripe o la reactivas; no se cambió nada automáticamente.',
      'The customer paid the balance after the booking was cancelled. Decide whether to refund in Stripe or reactivate it; nothing was changed automatically.'],
    balance_paid_twice: [
      'El saldo se marcó como pagado por otro medio Y además se pagó en Stripe. Reembolsa el cobro duplicado de Stripe.',
      'The balance was marked as paid by another means AND was also paid in Stripe. Refund the duplicate Stripe charge.'],
    refund_review: [
      'Hubo un reembolso en Stripe que el sistema no aplicó automáticamente. Revísalo.',
      'There was a refund in Stripe that the system did not apply automatically. Please review it.']
  };
  var METHODS = [['cash', 'Efectivo', 'Cash'], ['transfer', 'Transferencia bancaria', 'Bank transfer']];

  function make(deps) {
    deps = deps || {};
    var ES = !!deps.ES;
    function t(es, en) { return ES ? es : en; }
    function esc(s) {
      if (typeof deps.escapeHtml === 'function') return deps.escapeHtml(s);
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    }
    function money(c) { return typeof deps.money === 'function' ? deps.money(c, 'usd') : ('$' + (Number(c) / 100).toFixed(2)); }
    function day(s) { return typeof deps.fmtDate === 'function' ? deps.fmtDate(s) : esc(s); }
    function stamp(s) { return typeof deps.fmtDT === 'function' ? deps.fmtDT(s) : esc(s); }
    function dl(label, val) { return '<div class="bk-dl"><span>' + label + '</span><b>' + val + '</b></div>'; }

    function isDeposit(b) { return !!b && b.payment_plan === 'deposit'; }
    function payLabel(status) {
      if (status === 'deposit_paid') return t('Depósito pagado', 'Deposit paid');
      return status || '';
    }
    function methodName(m) {
      if (m === 'stripe') return 'Stripe';
      for (var i = 0; i < METHODS.length; i++) if (METHODS[i][0] === m) return t(METHODS[i][1], METHODS[i][2]);
      return m || '—';
    }
    function reasonText(reason) { var r = REASONS[reason]; return r ? t(r[0], r[1]) : ''; }

    /* Alerta roja cuando el sistema necesita que el owner decida algo. */
    function alertHtml(b) {
      var txt = b && reasonText(b.needs_review_reason);
      if (!txt) return '';
      return '<div class="dep-alert" role="alert" style="background:var(--a-bad-bg);border:1px solid var(--a-bad-bd);'
        + 'color:var(--a-bad-tx);font-weight:600;border-radius:8px;padding:10px 12px;margin:0 0 12px;line-height:1.45">'
        + '<b>' + t('REVISAR', 'REVIEW') + '</b> · ' + esc(txt) + '</div>';
    }
    /* Marca visible en la fila de la tabla. */
    function reviewMarker(b) {
      if (!b || !REASONS[b.needs_review_reason]) return '';
      return ' <span class="bdg bdg-bad dep-review" title="' + esc(reasonText(b.needs_review_reason)) + '">' + t('REVISAR', 'REVIEW') + '</span>';
    }
    /* Línea corta bajo el badge de pago en la tabla. */
    function tableLine(b) {
      if (!isDeposit(b)) return '';
      var line = '';
      if (b.cancel_reason === 'balance_unpaid') line = t('Cancelada por saldo sin pagar · depósito retenido', 'Cancelled for unpaid balance · deposit kept');
      else if (b.balance_paid_at) line = t('Saldo pagado', 'Balance paid');
      else if (b.payment_status === 'deposit_paid') line = t('Depósito pagado · saldo ', 'Deposit paid · balance ') + esc(money(b.balance_cents)) + t(' vence ', ' due ') + day(b.balance_due_date);
      return line ? '<div class="dep-line" style="font-size:11.5px;line-height:1.35;margin-top:3px">' + line + '</div>' : '';
    }
    /* Bloque del detalle (alerta + datos del depósito). */
    function detailHtml(b) {
      if (!b) return '';
      var h = alertHtml(b);
      if (!isDeposit(b)) return h;
      var rows = '';
      rows += dl(t('Plan de pago', 'Payment plan'), t('Depósito 30 % + saldo', '30 % deposit + balance'));
      rows += dl(t('Depósito pagado', 'Deposit paid'), esc(money(b.deposit_cents)) + (b.deposit_paid_at ? ' · ' + stamp(b.deposit_paid_at) : ''));
      rows += dl(t('Saldo', 'Balance'), esc(money(b.balance_cents)));
      rows += dl(t('Saldo vence', 'Balance due'), esc(b.balance_due_date || '—') + ' · 23:59 Galápagos');
      if (b.balance_paid_at) {
        rows += dl(t('Estado del saldo', 'Balance status'), t('Pagado', 'Paid') + ' · ' + stamp(b.balance_paid_at) + ' · ' + esc(methodName(b.balance_payment_method))
          + (b.balance_offline_note ? ' · ' + esc(b.balance_offline_note) : ''));
      } else {
        rows += dl(t('Estado del saldo', 'Balance status'), t('Pendiente', 'Pending'));
      }
      rows += dl(t('Reembolso 30 %', '30 % refund'), t('30 % reembolsable hasta ', '30 % refundable until ') + esc(b.deposit_refundable_until || '—'));
      if (b.balance_paid_at) rows += dl(t('Reembolso 70 %', '70 % refund'), t('70 % reembolsable hasta ', '70 % refundable until ') + esc(b.balance_refundable_until || '—'));
      if (b.cancel_reason === 'balance_unpaid') {
        rows += dl(t('Cancelación automática', 'Automatic cancellation'),
          t('Cancelada el ', 'Cancelled on ') + (b.auto_cancelled_at ? stamp(b.auto_cancelled_at) : '—') + ' · '
          + t('saldo sin pagar, depósito retenido', 'balance unpaid, deposit kept'));
      }
      return h + '<div class="bk-dls dep-block">' + rows + '</div>';
    }

    /* Acción owner: solo depósito pagado y reserva no cancelada. */
    function canOffline(b) {
      return typeof deps.canWrite === 'function' && !!deps.canWrite()
        && isDeposit(b) && b.payment_status === 'deposit_paid' && b.booking_status !== 'cancelled';
    }
    function validateOffline(method, note) {
      var n = String(note == null ? '' : note).trim();
      if (method !== 'cash' && method !== 'transfer') return t('Elige el método: efectivo o transferencia.', 'Choose a method: cash or bank transfer.');
      if (n.length < 3) return t('Escribe una nota (mínimo 3 caracteres).', 'Write a note (at least 3 characters).');
      if (n.length > 500) return t('La nota admite máximo 500 caracteres.', 'The note can be at most 500 characters.');
      return '';
    }
    function notDueMsg() { return t('Esta reserva ya no tiene saldo pendiente', 'This booking has no pending balance anymore'); }
    function failMsg() { return t('No se pudo registrar. Inténtalo nuevamente.', 'Could not save. Please try again.'); }
    /* Envía la acción y resuelve {kind, message}; admin.js refresca después. */
    function submitOffline(b, method, note) {
      var bad = validateOffline(method, note);
      if (bad) return Promise.resolve({ kind: 'invalid', message: bad });
      return deps.apiPost('/api/admin-booking-balance-offline', { booking_id: b.id, method: method, note: String(note).trim() }).then(function (r) {
        if (r.status === 401) return { kind: 'unauthorized' };
        if (r.ok && r.data && r.data.ok) return { kind: 'ok', message: t('Saldo marcado como pagado', 'Balance marked as paid') };
        var code = r.data && (r.data.code || r.data.error);
        if (r.status === 409 && (code === 'BALANCE_NOT_DUE' || !code)) return { kind: 'not_due', message: notDueMsg() };
        if (r.status === 403) return { kind: 'forbidden', message: t('Solo el owner puede hacer esto.', 'Only the owner can do this.') };
        if (r.status === 400) return { kind: 'invalid', message: t('Datos inválidos. Revisa el método y la nota.', 'Invalid data. Check the method and note.') };
        return { kind: 'error', message: failMsg() };
      }).catch(function () { return { kind: 'error', message: failMsg() }; });
    }
    function buttonLabel() { return t('Saldo pagado por otro medio', 'Balance paid by other means'); }
    /* Pinta el formulario en `host` (sin método por defecto) y lo conecta. */
    function renderOfflineForm(host, b, onDone) {
      var radios = METHODS.map(function (m) {
        return '<label style="margin-right:16px;color:inherit"><input type="radio" name="dep-method" value="' + m[0] + '"> ' + esc(t(m[1], m[2])) + '</label>';
      }).join('');
      host.innerHTML = '<div class="dep-offline-form" style="border:1px solid var(--a-border);border-radius:10px;padding:12px;margin-top:14px">'
        + '<div class="bk-sub-hint" style="font-weight:600">' + esc(t('Esto marca la reserva como pagada por completo y detiene la cancelación automática.', 'This marks the booking as fully paid and stops the automatic cancellation.')) + '</div>'
        + '<div style="margin:8px 0">' + radios + '</div>'
        + '<textarea data-dep-note maxlength="500" rows="3" style="width:100%" placeholder="' + esc(t('Nota (obligatoria, 3 a 500 caracteres)', 'Note (required, 3 to 500 characters)')) + '"></textarea>'
        + '<div class="bk-form-err" data-dep-err></div>'
        + '<div class="bk-modal-actions" style="margin-top:10px;padding-top:0;border-top:0">'
        + '<button class="btn btn-gold btn-sm" type="button" data-dep-confirm>' + esc(t('Confirmar', 'Confirm')) + '</button>'
        + '<button class="mini-btn" type="button" data-dep-cancel>' + esc(t('Cancelar', 'Cancel')) + '</button></div></div>';
      var err = host.querySelector('[data-dep-err]'), note = host.querySelector('[data-dep-note]');
      var okB = host.querySelector('[data-dep-confirm]'), noB = host.querySelector('[data-dep-cancel]');
      function method() {
        var rs = host.querySelectorAll('input[name="dep-method"]');
        for (var i = 0; i < rs.length; i++) if (rs[i].checked) return rs[i].value;
        return '';
      }
      noB.addEventListener('click', function () { host.innerHTML = ''; if (onDone) onDone({ kind: 'cancel' }); });
      okB.addEventListener('click', function () {
        var m = method(), n = note.value, bad = validateOffline(m, n);
        err.textContent = bad;
        if (bad) return;
        okB.disabled = true;
        submitOffline(b, m, n).then(function (res) {
          okB.disabled = false;
          if (res.kind === 'unauthorized') { if (deps.onUnauthorized) deps.onUnauthorized(); return; }
          if (res.kind === 'ok' || res.kind === 'not_due') { if (deps.adminToast) deps.adminToast(res.message); if (onDone) onDone(res); return; }
          err.textContent = res.message || '';
        });
      });
    }

    /* Tarjetas de Finanzas; `tile` es la función de tarjeta del panel. */
    function financeTilesHtml(d, tile, fin) {
      if (!d || d.collected_cents == null) return '';
      fin = fin || money;
      var cnt = d.retained_deposits_count;
      return tile(t('Cobrado', 'Collected'), fin(d.collected_cents), 'strong')
        + tile(t('Por cobrar', 'Pending'), fin(d.pending_cents))
        + tile(t('Depósitos retenidos', 'Retained deposits'), fin(d.retained_deposits_cents) + (cnt != null ? ' <small>(' + esc(cnt) + ')</small>' : ''));
    }
    function methodLabel() { return t('Cobrado por método', 'Collected by method'); }
    function reminderWarning() {
      return t('También revisa los depósitos: una reserva con saldo sin pagar a 5 días o menos del viaje se cancela automáticamente.',
        'Also check deposits: a booking with an unpaid balance 5 days or less before the trip is cancelled automatically.');
    }

    return {
      isDeposit: isDeposit, payLabel: payLabel, alertHtml: alertHtml, reviewMarker: reviewMarker, tableLine: tableLine,
      detailHtml: detailHtml, canOffline: canOffline, validateOffline: validateOffline, submitOffline: submitOffline,
      buttonLabel: buttonLabel, renderOfflineForm: renderOfflineForm, financeTilesHtml: financeTilesHtml,
      methodLabel: methodLabel, reminderWarning: reminderWarning, reasonText: reasonText, notDueMsg: notDueMsg
    };
  }
  root.ghaAdminDeposit = make;
})(typeof window !== 'undefined' ? window : this);
