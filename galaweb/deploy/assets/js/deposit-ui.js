/* =========================================================
   GALÁPAGOS HOOK ADVENTURE — opción de depósito del 30 % (checkout)
   ---------------------------------------------------------
   window.GHADeposit:
     render(el, info, lang, S)  pinta la opción de pago en `el`
                                (info = bloque `deposit` de pricing-preview)
     plan()   -> 'full' | 'deposit'
     ack()    -> {accepted:true, version} | null (solo con depósito + casilla)
     reset()  -> vuelve a pago completo y borra la aceptación
     onChange(cb) avisa a app.js cuando el cliente cambia plan o casilla
   Ayudantes compartidos con /saldo: money(cents), date(ymd, lang),
   fill(plantilla, vars), tx(S, clave, lang).

   El navegador NUNCA manda montos: solo el plan y la aceptación; el
   servidor recalcula todo. Los textos viven en S.deposit (content.js).
   ========================================================= */
(function () {
  "use strict";

  var state = { plan: "full", acked: false, infoKey: null, version: null };
  var listeners = [];

  /* ---- formato (mismo estilo que app.js: $ en-US, fechas es-ES / en-US) ---- */
  function money(cents) {
    var v = Number(cents || 0) / 100;
    var whole = Math.round(v * 100) % 100 === 0;
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  }
  function date(ymd, lang) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
    if (!m) return "—";
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.toLocaleDateString(lang === "es" ? "es-ES" : "en-US", { day: "numeric", month: "short", year: "numeric" });
  }
  function fill(tpl, vars) {
    return String(tpl || "").replace(/\{(\w+)\}/g, function (all, k) { return vars && vars[k] != null ? vars[k] : all; });
  }
  function tx(S, key, lang) {
    var o = S && S.deposit && S.deposit[key];
    if (!o) return "";
    return o[lang] != null ? o[lang] : (o.en != null ? o.en : "");
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* Variables de los textos a partir del bloque del servidor. */
  function vars(info, lang) {
    return {
      total: money((info.depositCents || 0) + (info.balanceCents || 0)),
      deposit: money(info.depositCents),
      balance: money(info.balanceCents),
      due: date(info.balanceDueDate, lang),
      refund: date(info.depositRefundableUntil, lang)
    };
  }

  /* ¿Se muestra la línea "pagas el 100 % ahora"? No en cotizaciones ni sin precio ni con fecha mala. */
  function showsNotEligible(info) {
    return !info.eligible && ["quote_only", "no_price", "bad_date"].indexOf(info.reason) < 0;
  }

  function buildHtml(info, lang, S) {
    if (!info) return "";
    if (!info.eligible) {
      return showsNotEligible(info) ? '<p class="bk-plan-na">' + esc(tx(S, "notEligible", lang)) + "</p>" : "";
    }
    var v = vars(info, lang);
    var dep = state.plan === "deposit";
    return '<div class="bk-plan-box">'
      + '<div class="bk-plan-head">' + esc(tx(S, "heading", lang)) + "</div>"
      + '<label class="bk-plan-opt"><input type="radio" name="bkPlanOpt" value="full"' + (dep ? "" : " checked") + '> <span><b>'
      + esc(fill(tx(S, "full", lang), v)) + "</b></span></label>"
      + '<label class="bk-plan-opt"><input type="radio" name="bkPlanOpt" value="deposit"' + (dep ? " checked" : "") + '> <span><b>'
      + esc(fill(tx(S, "deposit", lang), v)) + "</b><small>" + esc(fill(tx(S, "depositSub", lang), v)) + "</small></span></label>"
      + '<p class="bk-plan-today" id="bkPlanToday">' + esc(fill(tx(S, "dueToday", lang), { amount: dep ? v.deposit : v.total })) + "</p>"
      + '<div class="bk-plan-more" id="bkPlanMore"' + (dep ? "" : ' style="display:none"') + ">"
      + "<p>" + esc(fill(tx(S, "policyRefund", lang), v)) + "</p>"
      + "<p>" + esc(fill(tx(S, "policyBalance", lang), v)) + "</p>"
      + "<p>" + esc(fill(tx(S, "policyCancel", lang), v)) + "</p>"
      + '<label class="bk-note-ack"><input type="checkbox" id="bkDepAck"' + (dep && state.acked ? " checked" : "") + "> <span>"
      + esc(fill(tx(S, "ack", lang), v)) + "</span></label>"
      + "</div></div>";
  }

  /* Sincroniza el DOM ya pintado con el estado, sin reconstruirlo (no pierde el foco). */
  function sync(el, info, lang, S) {
    if (!el || typeof el.querySelectorAll !== "function") return;
    var dep = state.plan === "deposit";
    Array.prototype.forEach.call(el.querySelectorAll('input[name="bkPlanOpt"]'), function (x) { x.checked = (x.value === state.plan); });
    var more = el.querySelector("#bkPlanMore"); if (more) more.style.display = dep ? "" : "none";
    var ack = el.querySelector("#bkDepAck"); if (ack) ack.checked = dep && state.acked;
    var today = el.querySelector("#bkPlanToday");
    if (today && info && info.eligible) {
      var v = vars(info, lang);
      today.textContent = fill(tx(S, "dueToday", lang), { amount: dep ? v.deposit : v.total });
    }
  }

  function fire() { listeners.forEach(function (cb) { try { cb(); } catch (e) { /* noop */ } }); }

  function render(el, info, lang, S) {
    if (!el) return;
    var eligible = !!(info && info.eligible);
    if (!eligible) { state.plan = "full"; state.acked = false; state.infoKey = null; state.version = null; }
    else {
      var infoKey = [info.depositCents, info.balanceCents, info.balanceDueDate, info.depositRefundableUntil, info.termsVersion].join("|");
      if (infoKey !== state.infoKey) state.acked = false;   // cambió monto o fecha: hay que aceptar de nuevo
      state.infoKey = infoKey; state.version = info.termsVersion || null;
    }
    var key = (eligible ? state.infoKey : (info ? "na:" + (info.reason || "") : "none")) + "|" + lang;
    if (el.__ghaDepKey !== key) { el.innerHTML = buildHtml(info, lang, S); el.__ghaDepKey = key; }
    if (el.style) el.style.display = el.innerHTML ? "" : "none";
    if (!el.__ghaDepBound && typeof el.addEventListener === "function") {
      el.__ghaDepBound = true;
      el.addEventListener("change", function (ev) {
        var t = ev && ev.target; if (!t) return;
        if (t.name === "bkPlanOpt") { state.plan = (t.value === "deposit") ? "deposit" : "full"; if (state.plan === "full") state.acked = false; }
        else if (t.id === "bkDepAck") { state.acked = !!t.checked; }
        else return;
        sync(el, el.__ghaDepInfo, el.__ghaDepLang, el.__ghaDepS);
        fire();
      });
    }
    el.__ghaDepInfo = info; el.__ghaDepLang = lang; el.__ghaDepS = S;
    sync(el, info, lang, S);
  }

  window.GHADeposit = {
    render: render,
    plan: function () { return state.plan; },
    ack: function () { return (state.plan === "deposit" && state.acked && state.version) ? { accepted: true, version: state.version } : null; },
    reset: function () { state.plan = "full"; state.acked = false; },
    onChange: function (cb) { if (typeof cb === "function") listeners.push(cb); },
    money: money,
    date: date,
    fill: fill,
    tx: tx
  };
})();
