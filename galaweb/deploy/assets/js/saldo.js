/* =========================================================
   GALÁPAGOS HOOK ADVENTURE — página /saldo (pago del 70 %)
   ---------------------------------------------------------
   El enlace del correo es  /saldo#t=<token>.  El token viaja en el
   FRAGMENTO de la URL (no llega a los logs del servidor ni al Referer).
   Aquí se lee SOLO de location.hash y el fragmento se queda en la barra,
   para que recargar o volver atrás siga funcionando. Nunca se guarda en
   almacenamiento del navegador ni cookies, ni se imprime en consola.

   Flujo: balance_info → (pagar) → balance → confirmCardPayment.
   El navegador manda exactamente {mode, token}; el monto lo calcula
   el servidor. Usa GHAPayments (Stripe Elements) y GHADeposit (formato).
   ========================================================= */
(function () {
  "use strict";

  var root = document.getElementById("saldoRoot");
  if (!root) return;

  var API = "/api/create-payment-intent";
  var token = readToken();
  var view = { name: "loading" };
  var busy = false;
  var shownLang = null;
  var G = window.GHADeposit;

  /* ---- token: solo del fragmento (location.hash), que se conserva ---- */
  function readToken() {
    var m = /(?:^#|&)t=([^&]+)/.exec(location.hash || "");
    return (m && /^\S{1,600}$/.test(m[1])) ? m[1] : null;
  }

  function lang() { return (window.GHA && GHA.lang) || "en"; }
  function T(k) { return G.tx(window.GHA && GHA.content, k, lang()); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function $(id) { return document.getElementById(id); }

  function api(mode) {
    return fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ mode: mode, token: token })
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, status: res.status, data: data || {} }; });
    });
  }

  /* ---- vistas ---- */
  function row(label, value, cls) {
    return "<div" + (cls ? ' class="' + cls + '"' : "") + "><span>" + esc(label) + "</span><b>" + esc(value) + "</b></div>";
  }
  function summary(info, paidOnly) {
    var h = '<div class="bk-recap saldo-recap">'
      + row(T("saldoBooking"), info.bookingCode)
      + row(T("saldoTour"), info.tourName)
      + row(T("saldoDate"), G.date(info.bookingDate, lang()))
      + (info.guests ? row(T("saldoGuests"), info.guests) : "");
    if (!paidOnly) {
      h += row(T("saldoTotal"), G.money(info.totalCents))
        + row(T("saldoDeposit"), G.money(info.depositCents))
        + row(T("saldoBalance"), G.money(info.balanceCents), "tot")
        + row(T("saldoDueBy"), G.date(info.balanceDueDate, lang()));
    }
    return h + "</div>";
  }
  function result(kind, title, msg, extra, retry) {
    var icon = (kind === "ok" && window.GHA && GHA.svg) ? '<div class="tick">' + GHA.svg("check") + "</div>" : "";
    return '<div class="saldo-card saldo-result saldo-' + kind + '">' + icon + "<h2>" + esc(title) + "</h2>"
      + (msg ? '<p class="lead">' + esc(msg) + "</p>" : "") + (extra || "")
      + (retry ? '<button type="button" class="btn btn-ink" id="saldoRetry">' + esc(T("saldoRetry")) + "</button>" : "") + "</div>";
  }
  function dueForm(info) {
    return '<div class="saldo-card"><p class="saldo-lead">' + esc(T("saldoLead")) + "</p>" + summary(info) + "</div>"
      + '<form class="saldo-card" id="saldoForm" novalidate>'
      + "<h3>" + esc(T("saldoPayTitle")) + "</h3>"
      + '<div class="field"><label for="saldoCardName">' + esc(T("saldoCardName")) + '</label><input id="saldoCardName" autocomplete="cc-name"></div>'
      + '<div class="field"><label>' + esc(T("saldoCardNumber")) + '</label><div id="saldoCardNumber" class="stripe-field"></div></div>'
      + '<div class="form-row">'
      + '<div class="field"><label>' + esc(T("saldoCardExpiry")) + '</label><div id="saldoCardExpiry" class="stripe-field"></div></div>'
      + '<div class="field"><label>CVC</label><div id="saldoCardCvc" class="stripe-field"></div></div>'
      + "</div>"
      + '<div class="field"><label for="saldoZip">' + esc(T("saldoZip")) + '</label><input id="saldoZip" autocomplete="postal-code"></div>'
      + '<p class="saldo-msg" id="saldoMsg" role="alert" style="display:none"></p>'
      + '<button type="submit" class="btn btn-gold btn-block" id="saldoPayBtn">' + esc(G.fill(T("saldoPay"), { amount: G.money(info.balanceCents) })) + "</button>"
      + '<p class="bk-secure">🔒 ' + esc(T("saldoSecure")) + "</p></form>";
  }

  /* Título de la pestaña en el idioma actual (se llama al pintar y al cambiar de idioma). */
  function setTitle() { document.title = T("saldoTitle") + " — Galápagos Hook Adventure"; }

  function draw() {
    setTitle();
    shownLang = lang();
    var keepName = ($("saldoCardName") || {}).value || "";
    var info = view.info || {}, html = "";
    switch (view.name) {
      case "loading": html = '<div class="saldo-card saldo-loading"><p>' + esc(T("saldoLoading")) + "</p></div>"; break;
      case "due": html = dueForm(info); break;
      case "paid": html = result("ok", T("saldoPaidTitle"), T("saldoPaidMsg"), info.bookingCode ? summary(info, true) : ""); break;
      case "cancelled": html = result("warn", T("saldoCancelledTitle"), T("saldoCancelledMsg"), ""); break;
      case "invalid": html = result("warn", T("saldoInvalidTitle"), T("saldoInvalidMsg"), ""); break;
      case "notdue": html = result("warn", T("saldoErrorTitle"), T("saldoNotDueMsg"), ""); break;
      case "success": html = result("ok", T("saldoSuccessTitle"), T("saldoSuccessMsg"), summary(info, true)); break;
      case "processing": html = result("ok", T("saldoProcessingTitle"), T("saldoProcessingMsg"), summary(info, true)); break;
      default: html = result("warn", T("saldoErrorTitle"), T("saldoErrorMsg"), "", true);
    }
    root.innerHTML = html;
    var retry = $("saldoRetry"); if (retry) retry.addEventListener("click", load);
    if (view.name === "due") {
      var nm = $("saldoCardName"); if (nm && keepName) nm.value = keepName;
      $("saldoForm").addEventListener("submit", function (e) { e.preventDefault(); pay(); });
      if (window.GHAPayments) {
        GHAPayments.mount({ number: "saldoCardNumber", expiry: "saldoCardExpiry", cvc: "saldoCardCvc" })
          .catch(function () { showMsg(T("saldoErrorMsg")); });
      }
    } else if (window.GHAPayments) { GHAPayments.unmount(); }
  }

  function showMsg(text) { var m = $("saldoMsg"); if (!m) return; m.textContent = text || ""; m.style.display = text ? "" : "none"; }
  function setBusy(on) {
    var b = $("saldoPayBtn"); if (!b) return;
    b.disabled = !!on;
    b.textContent = on ? T("saldoPaying") : G.fill(T("saldoPay"), { amount: G.money((view.info || {}).balanceCents) });
  }

  /* Mensajes de tarjeta claros; nunca se muestra error.message de Stripe. */
  function cardError(err) {
    var es = lang() === "es", code = (err && (err.code || err.decline_code || err.declineCode)) || "";
    if (code === "card_declined" || code === "insufficient_funds") return es ? "Tu tarjeta fue rechazada. Intenta con otra tarjeta." : "Your card was declined. Please try another card.";
    if (err && (err.type === "validation_error" || /incomplete|invalid/.test(code))) return es ? "Revisa la información de tu tarjeta." : "Please review your card information.";
    return es ? "No pudimos procesar tu pago. Inténtalo nuevamente o utiliza otra tarjeta." : "We could not process your payment. Please try again or use another card.";
  }

  /* ---- carga del resumen ---- */
  function load() {
    if (!token) { view = { name: "invalid" }; draw(); return; }
    view = { name: "loading" }; draw();
    api("balance_info").then(function (r) {
      var d = r.data;
      if (r.ok && (d.state === "due" || d.state === "paid" || d.state === "cancelled")) { view = { name: d.state, info: d }; }
      else if (d.error === "INVALID_TOKEN") view = { name: "invalid" };
      else if (d.error === "BALANCE_NOT_DUE") view = { name: "notdue" };
      else view = { name: "error" };
      draw();
    }).catch(function () { view = { name: "error" }; draw(); });
  }

  /* ---- pago: balance → confirmCardPayment ---- */
  function pay() {
    if (busy || view.name !== "due") return;
    if (!(window.GHAPayments && GHAPayments.ready())) { showMsg(T("saldoErrorMsg")); return; }
    busy = true; setBusy(true); showMsg("");
    var info = view.info;
    api("balance").then(function (r) {
      var d = r.data;
      if (!r.ok) {
        busy = false;
        if (d.error === "INVALID_TOKEN") { view = { name: "invalid" }; draw(); return; }
        if (d.error === "BALANCE_NOT_DUE") { view = { name: "notdue" }; draw(); return; }
        if (d.error === "BOOKING_CANCELLED") { view = { name: "cancelled", info: info }; draw(); return; }
        setBusy(false);
        showMsg(d.error === "PAYMENT_ATTEMPT_CANCELED" ? T("saldoAttemptCanceled")
          : d.error === "PAYMENT_ATTEMPT_UNAVAILABLE" ? T("saldoAttemptUnavailable") : T("saldoErrorMsg"));
        return;
      }
      if (d.alreadyPaid) { busy = false; view = { name: "paid", info: info }; draw(); return; }
      if (!d.clientSecret) { busy = false; setBusy(false); showMsg(T("saldoErrorMsg")); return; }
      var billing = { name: (($("saldoCardName") || {}).value || "").trim() || undefined, address: { postal_code: (($("saldoZip") || {}).value || "").trim() || undefined } };
      return GHAPayments.confirmCardPayment(d.clientSecret, billing).then(function (res) {
        busy = false;
        if (res.error) { setBusy(false); showMsg(cardError(res.error)); return; }
        var pi = res.paymentIntent;
        if (pi && pi.status === "succeeded") { view = { name: "success", info: info }; draw(); return; }
        if (pi && pi.status === "processing") { view = { name: "processing", info: info }; draw(); return; }
        setBusy(false); showMsg(T("saldoErrorMsg"));
      });
    }).catch(function () { busy = false; setBusy(false); showMsg(T("saldoErrorMsg")); });
  }

  /* El cambio de idioma lo hace app.js; aquí solo se repinta con el idioma nuevo. */
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-lang]") : null;
    if (b) setTitle();
    if (b && !busy && lang() !== shownLang) draw();
  });

  load();
})();
