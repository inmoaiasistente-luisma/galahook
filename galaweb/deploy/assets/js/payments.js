/* =========================================================
   GALÁPAGOS HOOK ADVENTURE — motor de pagos (Stripe Elements)
   ---------------------------------------------------------
   window.GHAPayments: carga la clave publicable desde
   /api/stripe-config, inicializa Stripe una sola vez, monta
   los Elements individuales (cardNumber, cardExpiry, cardCvc)
   con estilo igual a los inputs del sitio, y confirma el pago
   en la propia página con stripe.confirmCardPayment.

   Nunca imprime clientSecret ni datos sensibles. Los datos de
   tarjeta viven exclusivamente dentro de los iframes de Stripe.
   ========================================================= */
(function () {
  "use strict";

  var CONFIG_URL = "/api/stripe-config";

  var stripe = null;
  var elements = null;
  var initPromise = null;
  var card = { number: null, expiry: null, cvc: null };
  var mounted = false;
  var lastError = null;
  var errorCb = null;

  /* Estilo de los Elements, calcado a `.field input` del sitio. */
  var ELEMENT_STYLE = {
    base: {
      color: "#11302f",                                       // var(--ink)
      fontFamily: "'Hanken Grotesk', system-ui, sans-serif",  // var(--body)
      fontSize: "15px",
      fontSmoothing: "antialiased",
      "::placeholder": { color: "rgba(60,83,79,.55)" }
    },
    invalid: { color: "#c0392b", iconColor: "#c0392b" }
  };

  function loadConfig() {
    return fetch(CONFIG_URL, { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("config http " + r.status); return r.json(); })
      .then(function (d) { if (!d || !d.publishableKey) throw new Error("missing publishable key"); return d.publishableKey; });
  }

  function init() {
    if (initPromise) return initPromise;
    initPromise = new Promise(function (resolve, reject) {
      if (!window.Stripe) { initPromise = null; reject(new Error("Stripe.js not loaded")); return; }
      loadConfig().then(function (pk) {
        stripe = window.Stripe(pk);
        var locale = (window.GHA && GHA.lang === "es") ? "es" : "auto";
        elements = stripe.elements({ locale: locale });
        resolve();
      }).catch(function (err) { initPromise = null; reject(err); });
    });
    return initPromise;
  }

  function destroyCards() {
    ["number", "expiry", "cvc"].forEach(function (k) {
      if (card[k]) {
        try { card[k].unmount(); } catch (e) { /* noop */ }
        try { card[k].destroy(); } catch (e) { /* noop */ }
        card[k] = null;
      }
    });
    mounted = false;
  }

  /** Monta los tres Elements en los contenedores dados. Sin duplicados. */
  function mount(targets) {
    return init().then(function () {
      destroyCards();
      card.number = elements.create("cardNumber", { style: ELEMENT_STYLE, showIcon: true, placeholder: "1234 5678 9012 3456" });
      card.expiry = elements.create("cardExpiry", { style: ELEMENT_STYLE });
      card.cvc = elements.create("cardCvc", { style: ELEMENT_STYLE });
      card.number.mount(sel(targets.number));
      card.expiry.mount(sel(targets.expiry));
      card.cvc.mount(sel(targets.cvc));
      ["number", "expiry", "cvc"].forEach(function (k) {
        card[k].on("change", function (ev) {
          lastError = ev && ev.error ? ev.error.message : null;
          if (errorCb) { try { errorCb(k, lastError); } catch (e) { /* noop */ } }
        });
      });
      mounted = true;
      return true;
    });
  }

  function unmount() { destroyCards(); lastError = null; }

  function ready() { return !!(stripe && mounted && card.number); }

  /**
   * Confirma el pago en la propia página (sin redirect).
   * @param {string} clientSecret
   * @param {object} billingDetails { name, email, address:{ postal_code } }
   */
  function confirmCardPayment(clientSecret, billingDetails) {
    if (!ready()) return Promise.reject(new Error("payment fields not ready"));
    return stripe.confirmCardPayment(clientSecret, {
      payment_method: { card: card.number, billing_details: billingDetails || {} }
    });
  }

  function sel(t) {
    if (!t) throw new Error("missing mount target");
    return typeof t === "string" ? ("#" + String(t).replace(/^#/, "")) : t;
  }

  window.GHAPayments = {
    init: init,
    mount: mount,
    unmount: unmount,
    ready: ready,
    confirmCardPayment: confirmCardPayment,
    onError: function (cb) { errorCb = cb; },
    lastError: function () { return lastError; }
  };
})();
